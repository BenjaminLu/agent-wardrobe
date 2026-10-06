// Take or pick a photo; Codex draws a new chibi character of that person; ask for changes; save it as a private character.
const $=id=>document.getElementById(id);
let stream=null,pet=null;
const clean=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
// Text this script writes is kept as a locale key (data-i18n + data-i18n-vars), so a new interface language redraws it.
function say(el,key,vars){el.dataset.i18n=key;if(vars)el.dataset.i18nVars=JSON.stringify(vars);else delete el.dataset.i18nVars;window.i18n.apply(el);}
function plain(el,text){delete el.dataset.i18n;delete el.dataset.i18nVars;el.textContent=text;}
const status=(key,vars)=>say($('status'),key,vars);
const STEPS={draw:'person.progress.draw',revise:'person.progress.revise',thinking:'person.progress.thinking',fix:'person.progress.fix',done:'person.progress.done'};
window.person.onProgress(({step,detail})=>{if(STEPS[step])status(STEPS[step],{detail:detail??''});else plain($('status'),`${step}…`);});
// Every look the app can show, so the whole design can be checked before saving.
const LOOKS=[['neutral',{emotion:'neutral'}],['happy',{emotion:'happy'}],['smug',{emotion:'smug'}],['surprised',{emotion:'surprised'}],['nervous',{emotion:'nervous'}],
  ['sad',{emotion:'sad'}],['talking',{emotion:'neutral',talking:true}],['blink',{emotion:'neutral',className:'blinking'}],['wink',{emotion:'neutral',react:'wink'}],['love',{emotion:'neutral',react:'love'}]];
function showLooks(mod){
  $('expressions').replaceChildren(...LOOKS.map(([label,look],i)=>{const figure=document.createElement('figure'),cell=document.createElement('div');cell.className='cell';const caption=document.createElement('figcaption');say(caption,`person.look.${label}`);figure.append(cell,caption);
    const el=Avatars.mount(cell,mod,mod.skins[0],`look-${i}`);Avatars.update(el,{activity:'idle',emotion:look.emotion,displayState:'idle',speaking:Boolean(look.talking)});
    if(look.className)el.classList.add(look.className);if(look.react)el.dataset.react=look.react;return figure;}));
  $('expressions').hidden=false;
}
function show(result){$('pet').replaceChildren();pet=Avatars.mount($('pet'),result.mod,result.mod.skins[0],'person-preview');Avatars.update(pet,{activity:'idle',emotion:'neutral',displayState:'idle'});showLooks(result.mod);
  $('summary').textContent=result.summary;$('revise-form').hidden=false;$('save').disabled=false;status('person.status.drawn');}
async function busy(job,key,vars){
  $('save').disabled=true;$('camera').disabled=true;$('revise-form').querySelector('button').disabled=true;status(key,vars);
  try{show(await job());}catch(error){plain($('status'),clean(error));}
  finally{$('camera').disabled=false;$('revise-form').querySelector('button').disabled=false;}
}
// The photo is shrunk to 1024 px here and goes to Codex only; it is deleted after drawing.
function useImage(source,width,height){
  const scale=Math.min(1,1024/Math.max(width,height)),canvas=$('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);const dataUrl=canvas.toDataURL('image/jpeg',.88);
  $('photo').src=dataUrl;$('photo').hidden=false;$('video').hidden=true;$('hint').hidden=true;stopCamera();
  busy(()=>window.person.draw(dataUrl),'person.status.drawing');
}
function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;$('snap').hidden=true;$('camera').hidden=false;}
$('camera').onclick=async()=>{
  try{if(!await window.person.cameraAccess())throw new Error('camera');
    stream=await navigator.mediaDevices.getUserMedia({video:{width:1280,height:960},audio:false});$('video').srcObject=stream;await $('video').play();
    $('video').hidden=false;$('photo').hidden=true;$('hint').hidden=true;$('snap').hidden=false;$('camera').hidden=true;status('person.status.aim');}
  catch{status('person.status.noCamera');}
};
$('snap').onclick=async()=>{for(const n of [3,2,1]){$('count').hidden=false;$('count').textContent=n;await new Promise(r=>setTimeout(r,1000));}$('count').hidden=true;const v=$('video');useImage(v,v.videoWidth,v.videoHeight);};
$('file').onchange=()=>{const file=$('file').files[0];if(!file)return;const img=new Image();img.onload=()=>{useImage(img,img.naturalWidth,img.naturalHeight);URL.revokeObjectURL(img.src);};img.onerror=()=>{status('person.status.badPhoto');};img.src=URL.createObjectURL(file);$('file').value='';};
$('revise-form').onsubmit=event=>{event.preventDefault();const text=$('revise').value.trim();if(!text)return;$('revise').value='';busy(()=>window.person.revise(text),'person.status.revising',{text});};
$('save').onclick=async()=>{if(!$('name').value.trim()){status('person.status.needName');$('name').focus();return;}
  $('save').disabled=true;try{await window.person.save($('name').value.trim());}catch(error){plain($('status'),clean(error));$('save').disabled=false;}};
$('cancel').onclick=()=>{stopCamera();window.person.close();};
window.addEventListener('beforeunload',stopCamera);
// Editing a saved character: show it and go straight to asking for changes (or a new photo for a fresh drawing).
window.person.loaded().then(saved=>{if(!saved)return;say(document.querySelector('title'),'person.heading.editTitle',{name:saved.name});
  if(saved.copy||saved.redraw)say(document.querySelector('h1'),'person.heading.copy',{name:saved.baseName??saved.name});else say(document.querySelector('h1'),'person.heading.edit',{name:saved.name});$('name').value=saved.name;
  // characters that are not drawn in SVG (built-in, PNG, 3D) are redrawn by Codex first
  if(saved.redraw){const img=document.createElement('img');img.src=saved.image;img.alt='';img.className='reference';$('pet').replaceChildren(img);$('redraw').hidden=false;
    status('person.status.needRedraw');return;}
  show(saved);status(saved.copy?'person.status.copy':'person.status.edit');}).catch(error=>{plain($('status'),clean(error));});
$('redraw').onclick=()=>{$('redraw').hidden=true;busy(()=>window.person.redraw(),'person.status.redrawing');};
