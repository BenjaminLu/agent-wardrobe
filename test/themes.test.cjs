const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const css=fs.readFileSync(require.resolve('../styles.css'),'utf8');
const base={
  'panel-border':'#c4e3ef','panel-bg-1':'#fffffff5','panel-bg-2':'#effafff2',text:'#172c47',
  'toggle-border':'#a9d6ef','toggle-bg':'#e2f3ff','toggle-hover-bg':'#cceaff','toggle-hover-border':'#68b7e5',
  'chip-bg':'#e4f2fb','chip-text':'#155f91','assistant-bg':'#e2f3fc','user-bg':'#263e58','user-text':'white',
  'error-bg':'#fff0e6','error-text':'#915523','artifact-border':'#bbd9ea','artifact-btn-text':'white',
  'input-bg':'white','input-border':'#d8e9f0','voice-bg':'#eef5fa','voice-pressed-bg':'#ffd8e2','voice-pressed-text':'#aa1838',
  accent:'#1c8fe1','accent-text':'white','tasks-border':'#bccdde','tasks-bg':'#f6faff','tasks-text':'#253852','tasks-btn-bg':'#e4effa'
};
function theme(name){
  const props={};for(const [,selectors,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    if(selectors.split(',').some(s=>s.trim()===`[data-theme=${name}]`||(name==='ocean'&&s.trim()==='body')))
      for(const [,key,value] of body.matchAll(/--([\w-]+)\s*:\s*([^;{}]+)/g))props[key]=value.trim();
  }return props;
}
function rgba(value){
  if(value==='white')value='#ffffff';if(value==='black')value='#000000';
  assert.match(value||'',/^#[\da-f]{6}([\da-f]{2})?$/i);
  return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255).concat(value.length===9?parseInt(value.slice(7),16)/255:1);
}
function luminance(rgb){return rgb.slice(0,3).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);}
function ratio(fg,bg,backdrop){const a=rgba(fg),b=rgba(bg);const composited=b.slice(0,3).map(v=>v*b[3]+backdrop*(1-b[3]));const x=luminance(a),y=luminance(composited);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
const pairs=[['toggle-text','toggle-bg'],['toggle-text','toggle-hover-bg'],['chip-text','chip-bg'],['text','assistant-bg'],['user-text','user-bg'],['error-text','error-bg'],['text','input-bg'],['voice-pressed-text','voice-pressed-bg'],['tasks-text','tasks-bg'],['tasks-text','tasks-btn-bg'],['artifact-btn-text','artifact-btn-bg']];
for(const fg of ['text','muted'])for(const bg of ['panel-bg-1','panel-bg-2'])pairs.push([fg,bg]);
for(const name of ['ocean','mint','sakura','dark'])test(`${name} defines every colour and meets WCAG contrast over light and dark desktops`,()=>{
  const props=theme(name);for(const key of [...Object.keys(base),'muted','artifact-btn-bg','toggle-text'])assert.ok(props[key],`${name} --${key}`);
  for(const [fg,bg,min=4.5] of [...pairs,['accent-text','accent',3]])for(const backdrop of [0,1])assert.ok(ratio(props[fg],props[bg],backdrop)>=min,`${name} ${fg}/${bg} over ${backdrop}: ${ratio(props[fg],props[bg],backdrop)}`);
});
test('ocean preserves every original colour except the three contrast corrections',()=>{
  const ocean=theme('ocean');for(const [key,value] of Object.entries(base))assert.equal(ocean[key],value,key);
});
