const fs = require('node:fs');
const path = require('node:path');
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const STATES = ['idle','working','waiting_for_approval','speaking','success','error'];
const PALETTE = ['body','bodyLight','belly','accent','ink','cheek'];
const {sanitizeSvg,checkPng,checkVrm,checkGltf,checkModel,checkMotions,CLASSES}=require('./mod-assets.cjs');
const EMOTIONS=['neutral','smug','happy','surprised','nervous','sad'];
const BUILTIN_RIGS=['cat','robot'];
const RENDERERS=['svg','png','vrm','gltf','live2d','mmd'];
const FRAME_PART=['src','x','y','w','h'];
function plainObject(value,what){ if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Invalid ${what}`); return value; }
function onlyKeys(value,keys,what){ if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error(`Unsupported ${what} field`); }
// schemaVersion 1: a built-in code-drawn rig. schemaVersion 2: the Mod ships its own SVG parts, PNG layers, VRM/glTF model,
// or a Live2D / MMD model folder (skin.model is then a path inside the Mod folder and every file of the folder is an asset).
function validate(mod, dir, { personal = false } = {}) {
  if (!mod || ![1,2].includes(mod.schemaVersion) || !ID.test(mod.id) || typeof mod.name !== 'string' || !mod.name.trim() || mod.name.length > 80) throw new Error('Invalid Mod manifest');
  if (typeof mod.identity !== 'string' || mod.identity.length > 1500 || !mod.identity.trim()) throw new Error('Invalid character identity');
  const v2=mod.schemaVersion===2;
  if (v2 ? !RENDERERS.includes(mod.renderer) : !BUILTIN_RIGS.includes(mod.model)) throw new Error(v2?'Unsupported renderer':'Unsupported character model');
  if (v2 && !dir) throw new Error('A schemaVersion 2 Mod must be loaded from its folder');
  if (!Array.isArray(mod.skins) || !mod.skins.length || mod.skins.length > 20) throw new Error('Invalid skins');
  const unique = (items, kind) => { const ids = new Set(); for (const item of items) { if (!ID.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new Error(`Invalid ${kind}`); ids.add(item.id); } return ids; };
  const skins = unique(mod.skins, 'skin');
  const model3d = ['vrm','gltf','live2d','mmd'].includes(mod.renderer);
  const parts = v2 && !model3d ? loadParts(mod, dir) : null;
  const assets=new Set(), models={};
  if (parts?.images) for (const name of parts.images) assets.add(checkPng(dir,name));
  for (const skin of mod.skins) {
    const usesPalette = !v2 || mod.renderer==='svg';
    if (usesPalette || skin.palette) { if (!skin.palette || PALETTE.some(key => !HEX.test(skin.palette[key])) || Object.keys(skin.palette).some(key => !PALETTE.includes(key))) throw new Error('Invalid skin palette'); }
    if (!v2 && !['none','stars','visor'].includes(skin.accessory)) throw new Error('Unsupported accessory');
    if (mod.renderer==='svg' && !Object.hasOwn(parts.accessories, skin.accessory)) throw new Error(`Unsupported accessory ${skin.accessory}`);
    if (mod.renderer==='png') assets.add(checkPng(dir, skin.image));
    if (mod.renderer==='vrm') { const {license}=checkVrm(dir, skin.model, { personal }); models[skin.model]=license; assets.add(skin.model); }
    if (mod.renderer==='gltf') { checkGltf(dir, skin.model, { personal }); assets.add(skin.model); }
    if (mod.renderer==='live2d'||mod.renderer==='mmd') for (const file of checkModel(dir, skin.model, mod.renderer, { personal }).files) assets.add(file);
    if (model3d) for (const file of checkMotions(dir, skin.motions, mod.renderer, { personal })) assets.add(file); else if (skin.motions!==undefined) throw new Error('Motions need a 3D model');
    if (!skin.states || STATES.some(key => !EMOTIONS.includes(skin.states[key]))) throw new Error('Missing animation state');
    const fields=['id','name','palette','states', ...(!v2||mod.renderer==='svg'?['accessory']:[]), ...(mod.renderer==='png'?['image']:[]), ...(model3d?['model','motions']:[])];
    if (Object.keys(skin).some(key => !fields.includes(key))) throw new Error('Unsupported skin field');
  }
  if (!Array.isArray(mod.personas) || !mod.personas.length || mod.personas.length > 10) throw new Error('Invalid personas');
  const personas = unique(mod.personas, 'persona');
  for (const persona of mod.personas) if (typeof persona.prompt !== 'string' || !persona.prompt.trim() || persona.prompt.length > 1500 || Object.keys(persona).some(key=>!['id','name','prompt'].includes(key))) throw new Error('Invalid persona prompt');
  if (!skins.has(mod.defaultSkin) || !personas.has(mod.defaultPersona)) throw new Error('Invalid defaults');
  if (Object.keys(mod).some(key => !['schemaVersion','id','name','description','author','identity','model','renderer','parts','skins','personas','defaultSkin','defaultPersona','license','source'].includes(key))) throw new Error('Unsupported Mod field');
  for (const key of ['author','license','source','description']) if (mod[key]!==undefined && (typeof mod[key]!=='string' || mod[key].length>1000)) throw new Error(`Invalid ${key}`);
  if (!v2) return mod;
  const result={...mod,assets:[...assets]};
  if (parts) { delete parts.images; result.parts=parts; }
  if (model3d) result.license={text:mod.license,models};
  return result;
}
function loadParts(mod, dir) {
  const name=mod.parts||'parts.json';
  if (!/^[a-z0-9][a-z0-9_-]{0,63}\.json$/i.test(name)) throw new Error('Invalid parts file name');
  const file=path.join(dir,name);const stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.size>400000) throw new Error('Invalid parts file');
  const parts=plainObject(JSON.parse(fs.readFileSync(file,'utf8')),'parts');
  if (mod.renderer==='svg') {
    onlyKeys(parts,['rig','face','accessories','mouth','transform','shadowY'],'svg parts');
    if (parts.transform!==undefined) sanitizeSvg(`<g transform="${parts.transform}"></g>`);
    if (parts.shadowY!==undefined && !(Number.isFinite(parts.shadowY)&&parts.shadowY>0&&parts.shadowY<=300)) throw new Error('Invalid shadowY');
    sanitizeSvg(parts.rig); sanitizeSvg(parts.face||'');
    for (const [key,item] of Object.entries(plainObject(parts.accessories,'accessories'))) {
      if (!ID.test(key)) throw new Error('Invalid accessory id');
      plainObject(item,'accessory'); onlyKeys(item,['svg','hide','fills'],'accessory'); sanitizeSvg(item.svg);
      for (const cls of item.hide||[]) if (!CLASSES.has(cls)) throw new Error(`Unknown class ${cls}`);
      for (const [cls,color] of Object.entries(item.fills||{})) if (!CLASSES.has(cls) || !HEX.test(color)) throw new Error('Invalid accessory fill');
    }
    if (parts.mouth && !(Array.isArray(parts.mouth) && parts.mouth.length===2 && parts.mouth.every(Number.isFinite))) throw new Error('Invalid mouth origin');
    return parts;
  }
  // PNG layers: positioned images in the frame, swapped by the same face contract as SVG parts.
  onlyKeys(parts,['frame','eyes','mouth','extras'],'png parts');
  if (parts.frame && !(Array.isArray(parts.frame) && parts.frame.length===2 && parts.frame.every(n=>Number.isFinite(n)&&n>0&&n<=4096))) throw new Error('Invalid frame');
  const groups={eyes:['open','closed','joy','wink','love'],mouth:['smile','open','sad'],extras:['sweat','tears','cheeks']};
  const images=new Set();
  for (const [group,keys] of Object.entries(groups)) {
    const layer=parts[group]; if (layer===undefined) continue; plainObject(layer,group); onlyKeys(layer,keys,group);
    for (const item of Object.values(layer)) { plainObject(item,'layer'); onlyKeys(item,FRAME_PART,'layer'); if (!['x','y','w','h'].every(k=>Number.isFinite(item[k]))) throw new Error('Invalid layer box'); images.add(item.src); }
  }
  if (!parts.eyes?.open) throw new Error('PNG Mods need at least eyes.open');
  return {...parts,images:[...images]};
}
// A broken or unsafe Mod is skipped and reported through onError; only an empty catalog stops the app.
function loadCatalog(root = path.join(__dirname, 'mods'), { onError = (id, error) => { throw error; }, personal = false } = {}) {
  const catalog = [];
  for (const entry of fs.readdirSync(root, { withFileTypes:true }).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      if (!ID.test(entry.name)) throw new Error('Invalid Mod directory name');
      const dir = path.join(root, entry.name), filename = path.join(dir, 'mod.json');
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.size > 65536) throw new Error('Invalid manifest file');
      const mod = validate(JSON.parse(fs.readFileSync(filename,'utf8')), dir, { personal });
      if (mod.id !== entry.name) throw new Error('Mod directory does not match id');
      catalog.push(mod);
    } catch (error) { onError(entry.name, error); }
  }
  if (!catalog.length) throw new Error('No Mods available');
  return catalog;
}
function selection(catalog, value) {
  const mod = catalog.find(mod => mod.id === value.modId);
  if (!mod) throw new Error('Unknown Mod');
  const skin = mod.skins.find(skin => skin.id === value.skinId);
  const persona = mod.personas.find(persona => persona.id === value.personaId);
  if (!skin || !persona) throw new Error('Unknown skin or persona');
  return { mod, skin, persona };
}
// The reply-language setting: 'auto' (null) lets the model follow the user; otherwise the reply is pinned.
const REPLY_LANGUAGES={ 'zh-Hant':'Traditional Chinese (Taiwan)', 'zh-Hans':'Simplified Chinese', en:'English', ja:'Japanese' };
function replyLanguage(choice){ return REPLY_LANGUAGES[choice] ? `Always reply in ${REPLY_LANGUAGES[choice]}, whatever language the user writes in.` : null; }
function prompt(catalog, value, language='en', reply='auto') {
  const {mod,persona} = selection(catalog,value);
  return `You are ${mod.name}. Character identity: ${mod.identity}\nPersonality: ${persona.prompt}\n${replyLanguage(reply) || `Default language: ${language}. Follow the user's current language when clear.`} Keep replies friendly and concise, usually 1–3 sentences. You cannot access live markets, wallets or trading tools, and in chat you cannot act yourself. Never pretend to execute actions or receive payments. When the user wants something done rather than discussed, hand it to an operation task with "action": "browser" to open, search or read websites; "computer" to operate desktop apps on this Mac; "files" to organize information into a saved report or table on the Desktop. Then "text" is a one-sentence acknowledgement, not a claim that it is done. Questions you can answer from knowledge, opinions and small talk stay in chat with "action": "none". Return JSON only: {"text":"your reply","emotion":"neutral|smug|happy|surprised|nervous|sad","action":"none|browser|computer|files"}.`;
}
// Mods bundled in this repository must be openly licensed and say who made them (the Mod PR check runs this).
// Mods a user adds on their own Mac are not held to it: those stay under their own terms on that Mac.
const OPEN_LICENCES=[/\bCC0\b/i,/\bCC[ -]BY(?:[ -]SA)?(?![ -]?(?:NC|ND))\b/i,/\bMIT\b/,/\bApache(?: License)?[ ,-]*(?:v(?:ersion)?\s*)?2\.0\b/i,/\bVRM Public License\b/i];
const CLOSED_LICENCE=/\bprivate\b|\bprototype only\b|\bfan(?:s|art|[ -]?made|[ -]?inspired|[ -]art)?\b|not for (?:public )?(?:distribution|redistribution)|\bnon[ -]?commercial\b|\bNC\b|\bND\b|all rights reserved/i;
function bundledLicenceProblems(mod) {
  const problems=[], raw=typeof mod?.license==='string'?mod.license:mod?.license?.text, text=typeof raw==='string'?raw.trim():'';  // loaded 3D Mods carry {text, models}
  if (!text) problems.push('declares no licence');
  else {
    if (CLOSED_LICENCE.test(text)) problems.push(`licence "${text}" is not an open licence (private, prototype-only, fan, non-commercial or not-for-distribution terms)`);
    else if (!OPEN_LICENCES.some(re => re.test(text))) problems.push(`licence "${text}" is not one of CC0, CC BY, CC BY-SA, MIT, Apache-2.0 or the VRM Public License`);
    if (/VRM Public License/i.test(text) && !/\bCC0\b|\bCC[ -]BY|\bMIT\b|Apache/i.test(text)) {
      if (mod.renderer!=='vrm') problems.push('the VRM Public License only covers VRM models');
      else if (Object.values(mod.license?.models||{}).some(model => !model.redistribution)) problems.push('a VRM model does not allow redistribution');
    }
  }
  const credit=[mod?.author,mod?.source].filter(v => typeof v==='string' && v.trim());
  if (!credit.length) problems.push('names no author or source');
  return problems;
}
module.exports = { STATES, validate, loadCatalog, selection, prompt, replyLanguage, REPLY_LANGUAGES, bundledLicenceProblems };
