// The "no hard-coded interface text" check: every page script, page and main-process / service file is scanned for
// string literals (and HTML text and attribute values) that contain Chinese or Japanese. Interface text belongs in
// locales/*.json and is shown through t(); what is left must be on the short, documented ALLOW list below.
// Comments are not checked; tests, scripts, fixtures and vendored code are not scanned.
// Usage: node scripts/i18n-lint.cjs [files…]   (no files: the whole app). Exit code 1 when something is found.
const fs=require('node:fs');const path=require('node:path');
const ROOT=path.join(__dirname,'..');
// Chinese / Japanese characters and their punctuation (、。「」（）… as list separators and quotes are language-specific too)
const CJK=/[\u3001-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff60]/;

// What may stay as it is, and why. A rule names a file and either a region (the bracketed expression that follows the
// marker text: an object, array, call or template) or a literal pattern. Keep this list short.
const ALLOW=[
  {file:'i18n.js',region:'const WORDS=',why:'per-language platform wording rules: patterns that rewrite translated text, not text'},
  {file:'i18n.js',region:'const KEYS=',why:'shortcut rewriting rules (⌘＋捲動 → Ctrl＋): patterns, not text'},
  // AI prompts sent to models stay exactly as they are
  {file:'src/main/ai.cjs',region:'const SYSTEM =',why:'AI prompt: the chat system prompt sent to the model'},
  {file:'src/main/ai.cjs',region:'model, messages: ',why:'AI prompt: the messages sent to the local model'},
  {file:'src/main/cli.cjs',region:'child.stdin.end',why:'AI prompt: the prompt piped into the Claude / Codex CLI'},
  {file:'src/main/assisted.cjs',region:"function termsPrompt({title='',url='',page='',files='',meta=''}){",why:'AI prompt: Codex reads a model page for its terms (names 利用規約 so Japanese terms files are recognised)'},
  {file:'src/main/game-watch.cjs',region:'keep.push',why:'AI prompt: the 【name】 wiki brief given to the screen-watching model'},
  {file:'src/main/game-watch.cjs',region:'const LANGUAGE_NAMES=',why:'AI prompt: language names inside the "Reply in …" instruction'},
  {file:'src/main/wake-service.cjs',region:'const WAKE_PHRASES =',why:'default wake phrases (嘿安妮…): words people say, matched by the speech recogniser'},
  // what a voice reads aloud (recording scripts, engine warm-up, voice-design samples): per-language content, not labels
  {file:'src/main/voice-lab.cjs',region:'const PROMPTS=',why:'recording scripts people read aloud, one set per language'},
  {file:'voice-engines/cosyvoice.cjs',region:'const WARM_TEXT=',why:'a warm-up sentence the engine synthesises silently, in the voice’s language'},
  {file:'voice-engines/elevenlabs.cjs',region:'const SAMPLES=',why:'sample text a designed voice reads, picked by the description’s language'},
  {file:'renderer.js',region:'const VOICE_SAMPLES=',why:'preview sentences in a voice’s own language when it differs from the interface (a Mandarin voice cannot read English)'},
  // model data
  {file:'avatars.js',region:'const MORPHS=',why:'MMD morph names inside model files'},
  {file:'avatars.js',region:'const MMD_BONES=',why:'MMD bone names inside model files'},
  // saved data: person Mods record their origin in the description and read it back
  {file:'src/main/person-service.cjs',region:'const ORIGIN=',why:'origin markers saved in a person Mod’s description and parsed back (old saves use them)'},
  {file:'src/main/person-service.cjs',region:'const describe=(name,summary,origin)=>',why:'the saved description format whose punctuation the parser matches'},
  // search data: what people type, matched against tags and names
  {file:'src/main/asset-library.cjs',region:'const WORDS=',why:'search aliases: Chinese words → booru tags'},
  {file:'src/main/asset-library.cjs',region:'const FEATURED=',why:'proper names of featured third-party characters, sources and companies, and their search tags'},
  {file:'marketplace.js',region:'const aliases=',why:'search aliases: Chinese words people type for Mods and skins'}
];

function files(){
  const out=[];
  const skipDirs=new Set(['node_modules','.git','vendor','vendor-src','test','scripts','build','design','dist','evidence','bin','locales','mods','models','library-thumbs','.smoke-userdata','.laya','docs']);
  (function walk(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){if(!skipDirs.has(entry.name))walk(full);continue;}
      if(/\.(js|cjs|mjs|html)$/.test(entry.name))out.push(path.relative(ROOT,full).split(path.sep).join('/'));
    }
  })(ROOT);
  return out.sort();
}

// --- JavaScript: string literals and the text parts of template literals, with their offsets
function jsLiterals(src){
  const found=[];let i=0;const n=src.length;
  let prev='';  // the previous significant token, to tell a regex from a division
  const regexAllowed=()=>prev===''||/^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev)||/^(return|typeof|case|in|of|new|delete|void|throw|else|do|yield|await|=>|&&|\|\||\?\?)$/.test(prev);
  function skipString(q){const start=i;i++;while(i<n&&src[i]!==q){if(src[i]==='\\')i++;else if(src[i]==='\n'&&q!=='`')break;i++;}i++;found.push({start,end:i,text:src.slice(start,i)});}
  function skipRegex(){i++;let cls=false;while(i<n){const c=src[i];if(c==='\\'){i+=2;continue;}if(c==='\n')break;if(cls){if(c===']')cls=false;}else if(c==='[')cls=true;else if(c==='/'){i++;break;}i++;}while(i<n&&/[a-z]/i.test(src[i]))i++;}
  function template(){
    // from the opening backtick to the closing one; ${…} parts are code
    let partStart=i;i++;
    while(i<n){
      const c=src[i];
      if(c==='\\'){i+=2;continue;}
      if(c==='`'){i++;found.push({start:partStart,end:i,text:src.slice(partStart,i)});return;}
      if(c==='$'&&src[i+1]==='{'){found.push({start:partStart,end:i,text:src.slice(partStart,i)});i+=2;code(true);partStart=i;continue;}
      i++;
    }
  }
  function code(untilBrace){
    let depth=0;
    while(i<n){
      const c=src[i],d=src[i+1];
      if(c==='/'&&d==='/'){while(i<n&&src[i]!=='\n')i++;continue;}
      if(c==='/'&&d==='*'){const end=src.indexOf('*/',i+2);i=end<0?n:end+2;continue;}
      if(c==='"'||c==="'"){skipString(c);prev='str';continue;}
      if(c==='`'){template();prev='str';continue;}
      if(c==='/'){if(regexAllowed()){skipRegex();prev='re';continue;}i++;prev='/';continue;}
      if(c==='{'){depth++;i++;prev='{';continue;}
      if(c==='}'){if(untilBrace&&depth===0){i++;prev='}';return;}depth--;i++;prev='}';continue;}
      if(/\s/.test(c)){i++;continue;}
      if(/[A-Za-z_$0-9\u0080-\uffff]/.test(c)){let j=i;while(j<n&&/[A-Za-z_$0-9\u0080-\uffff]/.test(src[j]))j++;prev=src.slice(i,j);i=j;continue;}
      if(c==='='&&d==='>'){prev='=>';i+=2;continue;}
      if((c==='&'&&d==='&')||(c==='|'&&d==='|')||(c==='?'&&d==='?')){prev=c+d;i+=2;continue;}
      if(c===')'||c===']'){prev=c;i++;continue;}
      prev=c;i++;
    }
  }
  code(false);
  return found;
}

// --- HTML: text and attribute values outside <script>/<style>, skipping anything inside translate="no"
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
function htmlStrings(src){
  const found=[];const stack=[];let i=0;const n=src.length;
  const keep=()=>stack.some(e=>e.no);
  while(i<n){
    if(src.startsWith('<!--',i)){const end=src.indexOf('-->',i);i=end<0?n:end+3;continue;}
    if(src[i]==='<'){
      const end=src.indexOf('>',i);if(end<0)break;
      const tag=src.slice(i,end+1);i=end+1;
      if(/^<\//.test(tag)){const name=tag.slice(2,-1).trim().toLowerCase();const at=stack.map(e=>e.name).lastIndexOf(name);if(at>=0)stack.length=at;continue;}
      if(/^<!/.test(tag))continue;
      const name=(tag.match(/^<([a-zA-Z0-9-]+)/)||[])[1]?.toLowerCase();if(!name)continue;
      const no=/\btranslate\s*=\s*["']?no\b/i.test(tag);
      if(!no&&!keep())for(const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)){const value=m[3]??m[4];if(CJK.test(value))found.push({start:i-tag.length+m.index,end:i-tag.length+m.index+m[0].length,text:m[0]});}
      if(name==='script'||name==='style'){const close=src.toLowerCase().indexOf(`</${name}`,i);i=close<0?n:close;continue;}
      if(!VOID.has(name)&&!/\/>$/.test(tag))stack.push({name,no});
      continue;
    }
    const next=src.indexOf('<',i);const end=next<0?n:next;const text=src.slice(i,end);
    if(CJK.test(text)&&!keep())found.push({start:i,end,text:text.trim()});
    i=end;
  }
  return found;
}

// the [start, end) of the bracketed expression after a marker, or null
function region(src,marker){
  const at=src.indexOf(marker);if(at<0)return null;
  let i=at+marker.length;while(i<src.length&&!'{[(`'.includes(src[i]))i++;
  const open=src[i],close={'{':'}','[':']','(':')','`':'`'}[open];if(!close)return null;
  if(open==='`'){const lits=jsLiterals(src.slice(i));const last=lits.find(l=>l.start===0);return [i,i+(last?last.end:1)];}
  // balance brackets, skipping strings, templates, comments and regexes via the tokenizer's literal ranges
  const lits=jsLiterals(src.slice(i));let depth=0,j=0;const s=src.slice(i);
  let k=0;
  while(j<s.length){
    while(k<lits.length&&lits[k].end<=j)k++;
    if(k<lits.length&&lits[k].start<=j&&j<lits[k].end){j=lits[k].end;continue;}
    const c=s[j];
    if(c==='/'&&s[j+1]==='/'){j=s.indexOf('\n',j);if(j<0)break;continue;}
    if(c==='/'&&s[j+1]==='*'){j=s.indexOf('*/',j)+2;if(j<2)break;continue;}
    if('{[('.includes(c))depth++;else if('}])'.includes(c)){depth--;if(depth===0)return [i,i+j+1];}
    j++;
  }
  return [i,src.length];
}

function scan(file,src=fs.readFileSync(path.join(ROOT,file),'utf8')){
  const items=(file.endsWith('.html')?htmlStrings(src):jsLiterals(src)).filter(l=>CJK.test(l.text));
  const rules=ALLOW.filter(r=>r.file===file);
  const regions=rules.filter(r=>r.region).map(r=>({rule:r,range:region(src,r.region)}));
  const line=offset=>src.slice(0,offset).split('\n').length;
  return items.filter(item=>!regions.some(({range})=>range&&item.start>=range[0]&&item.end<=range[1])&&!rules.some(r=>r.literal&&r.literal.test(item.text)))
    .map(item=>({file,line:line(item.start),text:item.text.replace(/\s+/g,' ').slice(0,120)}));
}
// rules whose marker no longer exists (so the list stays honest)
function staleRules(){
  return ALLOW.filter(r=>{const p=path.join(ROOT,r.file);if(!fs.existsSync(p))return true;const src=fs.readFileSync(p,'utf8');
    if(r.region)return !src.includes(r.region);
    return !(r.file.endsWith('.html')?htmlStrings(src):jsLiterals(src)).some(l=>r.literal.test(l.text));});
}

module.exports={files,scan,jsLiterals,htmlStrings,staleRules,ALLOW,CJK};
if(require.main===module){
  const list=process.argv.slice(2).length?process.argv.slice(2).map(f=>path.relative(ROOT,path.resolve(f)).split(path.sep).join('/')):files();
  const problems=list.flatMap(f=>scan(f));
  const counts={};for(const p of problems)counts[p.file]=(counts[p.file]||0)+1;
  for(const p of problems)console.log(`${p.file}:${p.line}  ${p.text}`);
  if(problems.length)console.log('\n'+Object.entries(counts).map(([f,c])=>`${c}\t${f}`).join('\n'));
  console.log(problems.length?`${problems.length} hard-coded string(s)`:'no hard-coded interface text');
  process.exit(problems.length?1:0);
}
