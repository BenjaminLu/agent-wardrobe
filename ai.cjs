const SYSTEM = `你是使用者的桌面 AI 夥伴。
聰明、俏皮、有一點嘴硬，但對人友善。每次通常 1–3 句，最多 180 字。優先使用使用者最近一則訊息的語言；沒有明確語言時使用電腦偏好語言。
你目前只擁有聊天能力，沒有即時行情、錢包、收款或交易工具；不能編造已經成交、收款、爆倉或查到價格。
不能將角色台詞說成真實操作。不必每次都說免責聲明。
請回覆 JSON：{"text":"你要說的話","emotion":"neutral|smug|happy|surprised|nervous|sad"}。
emotion 選最符合內容的一個值。`;
const L = require('./locales.cjs');
const EMOTIONS = new Set(['neutral', 'smug', 'happy', 'surprised', 'nervous', 'sad']);
// Auto mode: the model may hand a request to an operation task instead of answering in chat.
const ACTIONS = new Set(['browser', 'computer', 'files']);
// Servers that support it (the built-in llama-server) are held to this shape, so small models never drop the emotion.
const REPLY_SCHEMA = { type: 'object', properties: { text: { type: 'string' }, emotion: { type: 'string', enum: [...EMOTIONS] }, action: { type: 'string', enum: ['none', ...ACTIONS] } }, required: ['text', 'emotion'] };

function localBase(value = 'http://127.0.0.1:1234/v1') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw L.error('ai.localOnly');
  }
  url.hash = ''; url.search = '';
  return url.toString().replace(/\/+$/, '');
}

// The built-in server is started with a random key; LM Studio may use BULA_LOCAL_TOKEN.
const keys = new Map();
function setKey(base, key) { keys.set(new URL(localBase(base)).origin, key); }
function authHeader(base) { const key = keys.get(new URL(localBase(base)).origin) || process.env.BULA_LOCAL_TOKEN; return key ? { Authorization: `Bearer ${key}` } : {}; }

function parseReply(content) {
  if (typeof content !== 'string' || !content.trim()) throw L.error('ai.noText');
  // A reasoning model that hits max_tokens leaves an unclosed <think>; never show that as the reply.
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  const json = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const result = JSON.parse(json);
    if (typeof result.text === 'string' && result.text.trim()) {
      const reply = { text: result.text.trim().slice(0, 600), emotion: EMOTIONS.has(result.emotion) ? result.emotion : 'neutral' };
      if (ACTIONS.has(result.action)) reply.action = result.action;
      return reply;
    }
  } catch {}
  if (!cleaned) throw L.error('ai.reasoningOnly');
  return { text: cleaned.slice(0, 600), emotion: 'neutral' };
}

async function request(base, path, options = {}, timeout = 45000) {
  const headers = { 'Content-Type': 'application/json', ...authHeader(base) };
  const response = await fetch(`${localBase(base)}${path}`, {
    ...options, headers, redirect: 'error', signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    const reason = await response.text();
    throw L.error('ai.httpError', { status: response.status, reason: reason.slice(0, 180) });
  }
  return response.json();
}

// LM Studio's /v1/models lists every downloaded model; its /api/v0/models also says which one is loaded.
async function defaultModel(base) {
  try {
    const result = await request(`${new URL(localBase(base)).origin}/api/v0`, '/models', {}, 3000);
    const loaded = (Array.isArray(result.data) ? result.data : []).find(m => m.state === 'loaded' && ['llm', 'vlm'].includes(m.type) && typeof m.id === 'string');
    if (loaded) return loaded.id;
  } catch {}
  return (await models(base))[0];
}

async function models(base) {
  const result = await request(base, '/models', {}, 5000);
  return (Array.isArray(result.data) ? result.data : [])
    .filter(m => typeof m.id === 'string' && !/embed/i.test(m.id))
    .map(m => m.id);
}

async function chat(settings, history) {
  if (!Array.isArray(history)) throw L.error('ai.badHistory');
  const messages = history.slice(-20).filter(m =>
    m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'
  ).map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages.at(-1).role !== 'user') throw L.error('ai.enterMessage');
  const model = settings.model || await defaultModel(settings.base);
  if (!model) throw L.error('ai.noModel');
  const timeout = settings.timeout || 90000;
  let result;
  try {
    result = await request(settings.base, '/chat/completions', {
      method: 'POST', body: JSON.stringify({
        model, messages: [{ role: 'system', content: settings.systemPrompt || `${SYSTEM}\n電腦偏好語言：${settings.language || 'en'}。` }, ...messages],
        // Reasoning models (e.g. in LM Studio) spend several hundred tokens thinking before the short JSON reply.
        temperature: 0.8, max_tokens: 2048, stream: false,
        ...(settings.structured ? { response_format: { type: 'json_schema', json_schema: { name: 'reply', schema: REPLY_SCHEMA } } } : {})
      })
    }, timeout);
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    throw L.error('ai.timeout', { model, seconds: Math.round(timeout / 1000) });
  }
  const choice = result.choices?.[0];
  if (!choice?.message?.content?.trim() && choice?.finish_reason === 'length') throw L.error('ai.outOfTokens', { model });
  return { ...parseReply(choice?.message?.content), model };
}

module.exports = { SYSTEM, localBase, setKey, authHeader, parseReply, chat, models, defaultModel };
