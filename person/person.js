// Take or pick a photo; Codex draws a new chibi character of that person; ask for changes; save it as a private character.
const $=id=>document.getElementById(id);
let stream=null,pet=null;
const clean=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
const STEPS={draw:'Codex 正在畫第一版',revise:'Codex 對照照片修改中',thinking:'Codex 構思中…',fix:'修正不合規格的地方',done:'畫好了！'};
window.person.onProgress(({step,detail})=>{$('status').textContent=`${STEPS[step]||step}${detail&&step!=='fix'?`（${detail}）`:''}…`.replace('！…','！');});
// Every look the app can show, so the whole design can be checked before saving.
const LOOKS=[['一般',{emotion:'neutral'}],['開心',{emotion:'happy'}],['得意',{emotion:'smug'}],['驚訝',{emotion:'surprised'}],['緊張',{emotion:'nervous'}],
  ['難過',{emotion:'sad'}],['說話',{emotion:'neutral',talking:true}],['眨眼',{emotion:'neutral',className:'blinking'}],['眨單眼',{emotion:'neutral',react:'wink'}],['愛心眼',{emotion:'neutral',react:'love'}]];
function showLooks(mod){
  $('expressions').replaceChildren(...LOOKS.map(([label,look],i)=>{const figure=document.createElement('figure'),cell=document.createElement('div');cell.className='cell';const caption=document.createElement('figcaption');caption.textContent=label;figure.append(cell,caption);
    const el=Avatars.mount(cell,mod,mod.skins[0],`look-${i}`);Avatars.update(el,{activity:'idle',emotion:look.emotion,displayState:'idle',speaking:Boolean(look.talking)});
    if(look.className)el.classList.add(look.className);if(look.react)el.dataset.react=look.react;return figure;}));
  $('expressions').hidden=false;
}
function show(result){$('pet').replaceChildren();pet=Avatars.mount($('pet'),result.mod,result.mod.skins[0],'person-preview');Avatars.update(pet,{activity:'idle',emotion:'neutral',displayState:'idle'});showLooks(result.mod);
  $('summary').textContent=result.summary;$('revise-form').hidden=false;$('save').disabled=false;$('status').textContent='畫好了！不滿意可以寫下想怎麼改，或取名字後儲存。';}
async function busy(job,label){
  $('save').disabled=true;$('camera').disabled=true;$('revise-form').querySelector('button').disabled=true;$('status').textContent=label;
  try{show(await job());}catch(error){$('status').textContent=clean(error);}
  finally{$('camera').disabled=false;$('revise-form').querySelector('button').disabled=false;}
}
// The photo is shrunk to 1024 px here and goes to Codex only; it is deleted after drawing.
function useImage(source,width,height){
  const scale=Math.min(1,1024/Math.max(width,height)),canvas=$('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);const dataUrl=canvas.toDataURL('image/jpeg',.88);
  $('photo').src=dataUrl;$('photo').hidden=false;$('video').hidden=true;$('hint').hidden=true;stopCamera();
  busy(()=>window.person.draw(dataUrl),'交給 Codex 畫…（第一次約 3–6 分鐘，會自己對照照片修改兩輪）');
}
function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;$('snap').hidden=true;$('camera').hidden=false;}
$('camera').onclick=async()=>{
  try{stream=await navigator.mediaDevices.getUserMedia({video:{width:1280,height:960},audio:false});$('video').srcObject=stream;await $('video').play();
    $('video').hidden=false;$('photo').hidden=true;$('hint').hidden=true;$('snap').hidden=false;$('camera').hidden=true;$('status').textContent='對準臉和上半身，按「拍照」後 3 秒拍下';}
  catch{$('status').textContent='開不了相機：請到「系統設定 → 隱私權與安全性 → 相機」允許 Agent Wardrobe，或改用「選照片」。';}
};
$('snap').onclick=async()=>{for(const n of [3,2,1]){$('count').hidden=false;$('count').textContent=n;await new Promise(r=>setTimeout(r,1000));}$('count').hidden=true;const v=$('video');useImage(v,v.videoWidth,v.videoHeight);};
$('file').onchange=()=>{const file=$('file').files[0];if(!file)return;const img=new Image();img.onload=()=>{useImage(img,img.naturalWidth,img.naturalHeight);URL.revokeObjectURL(img.src);};img.onerror=()=>{$('status').textContent='讀不了這張照片，換一張 JPEG 或 PNG 試試。';};img.src=URL.createObjectURL(file);$('file').value='';};
$('revise-form').onsubmit=event=>{event.preventDefault();const text=$('revise').value.trim();if(!text)return;$('revise').value='';busy(()=>window.person.revise(text),`請 Codex 修改：${text}（約 1–3 分鐘）`);};
$('save').onclick=async()=>{if(!$('name').value.trim()){$('status').textContent='幫角色取個名字吧';$('name').focus();return;}
  $('save').disabled=true;try{await window.person.save($('name').value.trim());}catch(error){$('status').textContent=clean(error);$('save').disabled=false;}};
$('cancel').onclick=()=>{stopCamera();window.person.close();};
window.addEventListener('beforeunload',stopCamera);
// Editing a saved character: show it and go straight to asking for changes (or a new photo for a fresh drawing).
window.person.loaded().then(saved=>{if(!saved)return;document.title=`修改：${saved.name}`;document.querySelector('h1').textContent=saved.copy||saved.redraw?`做一個我的版本：${saved.name.replace(/（我的版本）$/,'')}`:`修改角色：${saved.name}`;$('name').value=saved.name;
  // characters that are not drawn in SVG (built-in, PNG, 3D) are redrawn by Codex first
  if(saved.redraw){const img=document.createElement('img');img.src=saved.image;img.alt='';img.className='reference';$('pet').replaceChildren(img);$('redraw').hidden=false;
    $('status').textContent='這個角色不是用可編輯的 SVG 畫的。先請 Codex 照目前的樣子重畫一份（約 3–5 分鐘），之後就能一直修改；原本的角色不會被改動。';return;}
  show(saved);$('status').textContent=saved.copy?'會另存成你的版本，原本的角色不會被改動。寫下想怎麼改，Codex 會照著修改。':'寫下想怎麼改，Codex 會照著修改；也可以重新拍照或選照片，請它對照新照片重畫。';}).catch(error=>{$('status').textContent=clean(error);});
$('redraw').onclick=()=>{$('redraw').hidden=true;busy(()=>window.person.redraw(),'Codex 正在照目前的樣子重畫…（約 3–5 分鐘）');};
