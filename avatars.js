(() => {
  const ink='var(--ink)', body='var(--body)', light='var(--bodyLight)', belly='var(--belly)', accent='var(--accent)';
  const models = {
    cat:`<path d="M258 217 Q322 208 299 165 Q284 144 281 165 Q309 200 250 192" fill="${body}"/><path d="M84 106 L78 36 Q80 22 96 33 L137 76 M204 78 L249 32 Q263 25 261 44 L255 110" fill="${body}"/><path d="M89 49 L97 90 L122 76 M248 48 L242 90 L218 78" fill="var(--cheek)" stroke="none"/><path d="M173 73 C105 66 66 107 69 166 C70 207 93 216 93 230 C84 259 116 270 136 249 C156 265 193 265 207 249 C231 275 263 257 250 228 C278 201 285 138 255 104 C233 80 204 72 173 73Z" fill="url(#body-gradient)"/><ellipse cx="173" cy="224" rx="57" ry="29" fill="${belly}" stroke="none"/><path d="M148 80 L151 99 M174 77 L174 98 M197 81 L195 99" stroke-width="9" opacity=".55"/><path d="M60 179 L96 185 M57 194 L96 194 M249 185 L283 179 M249 194 L285 194"/><path d="M161 199 L183 199 L172 209Z" fill="${accent}" stroke-width="3"/>`,
    robot:`<path d="M169 71 L169 44"/><circle cx="169" cy="30" r="12" fill="${accent}"/><rect x="39" y="119" width="35" height="67" rx="15" fill="${body}"/><rect x="267" y="119" width="35" height="67" rx="15" fill="${body}"/><path d="M112 235 L106 266 L143 266 L148 235 M196 235 L199 266 L237 266 L230 235" fill="${body}"/><rect x="71" y="70" width="198" height="175" rx="45" fill="url(#body-gradient)"/><rect x="90" y="107" width="160" height="90" rx="27" fill="${belly}" stroke-width="4"/><rect x="125" y="213" width="95" height="22" rx="11" fill="${belly}" stroke-width="3"/><circle cx="145" cy="224" r="5" fill="${accent}" stroke="none"/><path d="M161 224 L200 224" stroke-width="3"/>`
  };
  const face=`<g class="eyes"><ellipse cx="122" cy="146" rx="25" ry="31" fill="white" stroke-width="3"/><ellipse cx="220" cy="146" rx="25" ry="31" fill="white" stroke-width="3"/><g class="pupils"><ellipse cx="130" cy="149" rx="12" ry="20" fill="${ink}" stroke="none"/><ellipse cx="212" cy="149" rx="12" ry="20" fill="${ink}" stroke="none"/><circle cx="134" cy="140" r="5" fill="white" stroke="none"/><circle cx="216" cy="140" r="5" fill="white" stroke="none"/></g></g><g class="blink" fill="none"><path d="M102 150 Q122 159 142 150"/><path d="M200 150 Q220 159 240 150"/></g><g class="brows"><path d="M104 110 L140 120 M202 118 L238 108"/></g><g stroke="none" fill="var(--cheek)"><ellipse cx="97" cy="181" rx="16" ry="8"/><ellipse cx="245" cy="181" rx="16" ry="8"/></g><path class="smile" d="M152 183 Q171 200 190 183" fill="none" stroke-width="5"/><ellipse class="open-mouth" cx="171" cy="189" rx="14" ry="12" fill="${ink}" stroke-width="3"/><path class="sad-mouth" d="M152 194 Q171 179 190 194" fill="none" stroke-width="5"/><path class="sweat" d="M261 109 Q245 134 263 136 Q279 134 261 109" fill="#dcfaff" stroke-width="3"/><g class="tears" fill="#9ae8ff" stroke="none"><path d="M111 173 Q108 208 120 204 Q130 200 121 173Z M221 173 Q214 207 227 205 Q238 200 230 173Z"/></g>`;
  const accessories={none:'',stars:`<g fill="${accent}" stroke="${ink}" stroke-width="2"><path d="M267 67 L272 80 L285 84 L272 89 L267 102 L262 89 L249 84 L262 80Z"/><path d="M76 228 L81 238 L93 241 L81 246 L76 257 L71 246 L60 241 L71 238Z"/></g>`,visor:`<path d="M95 126 Q169 96 245 126 L244 169 Q171 143 96 169Z" fill="${accent}" opacity=".25" stroke-width="3"/>`
  };
  const controllers=new WeakMap();
  // Model renderers draw into a canvas and share one controller interface; 'live2d' is 2D, the rest are three.js.
  const MODELS=['vrm','gltf','mmd','live2d'];
  const esc=value=>String(value).replace(/[&<>"]/g,ch=>`&#${ch.charCodeAt(0)};`);
  const asset=(mod,file)=>`mods/${encodeURIComponent(mod.id)}/${encodeURIComponent(file)}`;
  // Mod assets go through this hook: Electron pages read them over IPC, the web wardrobe over HTTP.
  let loadAsset=async url=>{const response=await fetch(url);if(!response.ok)throw new Error(`Asset ${url} failed`);return response.arrayBuffer();};
  function frame(mod,skin,id,inner,{viewBox='0 0 340 300',shadowY=280,strokeWidth=6}={}){
    return `<svg class="avatar" viewBox="${viewBox}" role="img"><defs><linearGradient id="${id}-gradient" x2=".7" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${body}"/></linearGradient></defs><ellipse cx="170" cy="${shadowY}" rx="88" ry="8" fill="${ink}" opacity=".12"/><g class="character" stroke="${ink}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round">${inner.replaceAll('url(#body-gradient)',`url(#${id}-gradient)`)}</g></svg>`;
  }
  function builtin(mod,skin,id){
    if(!models[mod.model]||!accessories.hasOwnProperty(skin.accessory))throw new Error('Unsupported avatar');
    return frame(mod,skin,id,models[mod.model]+face+accessories[skin.accessory]);
  }
  // SVG parts were sanitized by the main process (mod-assets.cjs) before reaching any page.
  function svgParts(mod,skin,id){
    const parts=mod.parts,outfit=parts.accessories[skin.accessory];if(!outfit)throw new Error('Unsupported accessory');
    const inner=parts.rig+(parts.face||'')+outfit.svg;
    return frame(mod,skin,id,parts.transform?`<g transform="${esc(parts.transform)}">${inner}</g>`:inner,{shadowY:parts.shadowY||280});
  }
  // PNG layers use the same class contract as SVG parts, so CSS drives blink, talk and emotions.
  function pngLayers(mod,skin,id){
    const parts=mod.parts,[w,h]=parts.frame||[340,300];
    const image=(layer,cls)=>layer?`<g class="${cls}"><image href="${asset(mod,layer.src)}" x="${+layer.x}" y="${+layer.y}" width="${+layer.w}" height="${+layer.h}"/></g>`:'';
    const eyes=parts.eyes||{},mouth=parts.mouth||{},extras=parts.extras||{};
    const inner=`<image href="${asset(mod,skin.image)}" x="0" y="0" width="${w}" height="${h}"/>`
      +(extras.cheeks?image(extras.cheeks,'cheeks'):'')
      +`<g class="eyes"><g class="pupils">${image(eyes.open,'open')}</g></g>`+image(eyes.closed,'blink')+image(eyes.joy,'joy-eyes')+image(eyes.wink,'wink')+image(eyes.love,'love-eyes')
      +image(mouth.smile,'smile')+image(mouth.open,'open-mouth')+image(mouth.sad,'sad-mouth')+image(extras.sweat,'sweat')+image(extras.tears,'tears');
    return `<svg class="avatar" viewBox="0 0 ${w} ${h}" role="img"><g class="character">${inner}</g></svg>`;
  }
  function decorate(el,mod,skin,id){
    el.id=id;el.setAttribute('aria-label',mod.name);
    el.dataset.model=mod.model||mod.renderer;el.dataset.renderer=mod.renderer||'builtin';el.dataset.accessory=skin.accessory||'';el.dataset.emotion='neutral';el.dataset.activity='idle';
    for(const [key,value] of Object.entries(skin.palette||{}))el.style.setProperty(`--${key}`,value);
  }
  function mount(container,mod,skin,id='bula',options={}) {
    controllers.get(container.firstElementChild)?.dispose();
    container.replaceChildren();
    if(MODELS.includes(mod.renderer)){
      const host=document.createElement('div');host.className=`avatar avatar-3d${mod.renderer==='live2d'?' avatar-live2d':''}`;container.append(host);decorate(host,mod,skin,id);
      const controller=(mod.renderer==='live2d'?createLive2d:createVrm)(host,mod,skin,options);controllers.set(host,controller);return host;
    }
    container.innerHTML=mod.renderer==='svg'?svgParts(mod,skin,id):mod.renderer==='png'?pngLayers(mod,skin,id):builtin(mod,skin,id);
    const svg=container.firstElementChild;decorate(svg,mod,skin,id);
    if(mod.renderer==='svg'){
      const outfit=mod.parts.accessories[skin.accessory];
      for(const cls of outfit.hide||[])for(const node of svg.querySelectorAll(`.${cls}`))node.style.display='none';
      for(const [cls,color] of Object.entries(outfit.fills||{}))for(const node of svg.querySelectorAll(`.${cls}`))node.setAttribute('fill',color);
      if(mod.parts.mouth)for(const node of svg.querySelectorAll('.open-mouth'))node.style.transformOrigin=`${mod.parts.mouth[0]}px ${mod.parts.mouth[1]}px`;
    }
    if(mod.renderer==='png')for(const node of svg.querySelectorAll('.open-mouth image')){node.style.transformBox='fill-box';node.style.transformOrigin='center';}
    return svg;
  }
  function update(el,state) {
    const display=state.displayState||state.activity||'idle';
    el.dataset.activity=display; el.dataset.emotion=state.activity==='idle' ? state.emotion : state.skin.states[display]||state.emotion;
    el.classList.toggle('talking',Boolean(state.speaking));
    controllers.get(el)?.update(el.dataset.emotion,display,Boolean(state.speaking));
  }
  const has=(el,cls)=>Boolean(el?.querySelector?.(`.${cls}`))||Boolean(controllers.get(el)?.has?.(cls));
  function blink(el){const c=controllers.get(el);if(c)return c.blink();if(!has(el,'blink'))return;el.classList.add('blinking');setTimeout(()=>el.classList.remove('blinking'),140);}
  function look(el,dx,dy){
    const c=controllers.get(el);if(c)return c.look(dx,dy);
    const scale={parts:.35,png:.6}[el?.dataset.renderer]||1;
    for(const group of el?.querySelectorAll('.pupils')||[])group.style.transform=`translate(${(dx*6*scale).toFixed(1)}px,${(dy*4*scale).toFixed(1)}px)`;
  }
  let reactTimer;
  function react(el,kind,ms=1300){
    const c=controllers.get(el);if(c)return c.react(kind,ms);
    el.dataset.react=kind;clearTimeout(reactTimer);reactTimer=setTimeout(()=>{delete el.dataset.react;},ms);
  }
  function setAssetLoader(fn){loadAsset=fn;}
  // Live2D's Cubism Core is Live2D Inc.'s own runtime and never ships with the app. The page says where the downloaded copy is
  // (url) and, on the Mac, how to fetch it once the user agrees (install). The phone only uses a copy the Mac already has.
  // kit: where vendor/live2d-kit.js is, for pages that do not sit next to vendor/.
  let live2dCore={url:async()=>{try{return (await fetch('vendor/live2dcubismcore.min.js',{method:'HEAD'})).ok?'vendor/live2dcubismcore.min.js':null;}catch{return null;}},install:null};
  function setLive2dCore(options){live2dCore={...live2dCore,...options};}
  function script(src){return new Promise((resolve,reject)=>{const node=document.createElement('script');node.src=src;node.onload=resolve;node.onerror=()=>reject(new Error(`Could not load ${src}`));document.head.append(node);});}
  // --- three.js models (VRM, plain glTF, MMD), bundled locally in vendor/vrm-kit.js and loaded on first use.
  let kit,l2dKit;
  function vrmKit(){
    if(!kit)kit=(window.VRMKit?Promise.resolve(window.VRMKit):script('vendor/vrm-kit.js').then(()=>window.VRMKit)).catch(()=>{kit=null;throw new Error('3D runtime unavailable');});
    return kit;
  }
  // Multi-file models and motion files become blob: URLs, so loaders only ever see files from the Mod's checked asset list.
  const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',json:'application/json'};
  const BLANK='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  const norm=p=>{const out=[];for(const part of String(p).replace(/\\/g,'/').split('/')){if(!part||part==='.')continue;if(part==='..')out.pop();else out.push(part);}return out.join('/');};
  const fold=p=>norm(p).normalize('NFC').toLowerCase();
  async function blobs(mod,files,urls){
    const map=new Map();
    await Promise.all(files.map(async file=>{const data=await loadAsset(asset(mod,file));const url=URL.createObjectURL(new Blob([data],{type:MIME[file.split('.').pop().toLowerCase()]||'application/octet-stream'}));urls.push(url);map.set(file,url);}));
    return map;
  }
  // Motions: the skin's list, or every motion file of the Mod when it names none (MMD archives rarely say which is which).
  // An explicit `use` wins; otherwise an idle-sounding name idles, the first one idles if none does, and the rest are reactions.
  const IDLE=/idle|待機|stand|wait|loop|breath|呼吸/i;
  function motionsOf(mod,skin,type){const listed=(skin.motions||[]).filter(m=>type.test(m.file));return listed.length?listed:(mod.assets||[]).filter(f=>type.test(f)).map(file=>({file,name:file.split('/').pop().replace(/\.[^.]+$/,'')}));}
  function roles(list){const out=list.map(m=>({...m,use:m.use||(IDLE.test(m.name||m.file||'')?'idle':'react')}));if(out.length&&!out.some(m=>m.use==='idle'))out[0].use='idle';return out;}
  const EXPRESSIONS={happy:'happy',sad:'sad',surprised:'surprised',nervous:'sad',smug:'relaxed',neutral:null};
  // MMD morphs (Japanese names, with common alternatives) stand in for the VRM expressions; bones for the humanoid ones used here.
  const MORPHS={blink:['まばたき','瞬き','blink'],blinkLeft:['ウィンク','ウィンク２','wink'],aa:['あ','あ２','a'],happy:['笑い','にっこり','にこり','smile'],sad:['困る','悲しい','sad'],surprised:['びっくり','驚き','surprised'],relaxed:['にこり','なごみ']};
  const MMD_BONES={head:'頭',leftUpperArm:'左腕',rightUpperArm:'右腕',leftHand:'左手首'};
  function createVrm(host,mod,skin,{orbit='drag'}={}){
    // View orbit around the upper body: yaw/pitch in radians, reset with a double-click.
    let yaw=0,pitch=0,radius=2.35,focus=null;
    const clampPitch=v=>Math.max(-.5,Math.min(.6,v));
    function orbitBy(dx,dy){yaw+=dx;pitch=clampPitch(pitch+dy);}
    // Plain drag rotates. In the companion window (orbit:'window') ⌥-drag is left to the page so it moves the window.
    let dragging=null;
    host.addEventListener('pointerdown',event=>{
      if(event.button!==0||(orbit==='window'&&event.altKey))return;
      event.stopPropagation();event.preventDefault();host.setPointerCapture(event.pointerId);dragging={x:event.clientX,y:event.clientY,moved:false};host.style.cursor='grabbing';
    });
    host.addEventListener('pointermove',event=>{if(!dragging)return;const dx=event.clientX-dragging.x,dy=event.clientY-dragging.y;dragging.x=event.clientX;dragging.y=event.clientY;if(Math.abs(dx)+Math.abs(dy)>0)dragging.moved=true;orbitBy(-dx*.012,dy*.008);});
    const endDrag=event=>{if(!dragging)return;if(dragging.moved)event.stopPropagation();dragging=null;host.style.cursor='';};
    host.addEventListener('pointerup',endDrag);host.addEventListener('pointercancel',endDrag);
    host.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey)return;event.preventDefault();orbitBy(-(event.deltaX||event.deltaY)*.006,0);},{passive:false});
    host.addEventListener('dblclick',event=>{event.stopPropagation();yaw=0;pitch=0;});
    let disposed=false,baseYaw=0,vrm,step,renderer,scene,camera,clock,frameId,lookTarget,emotion='neutral',talking=false,activity='idle',reaction=null,reactionUntil=0,blinkUntil=0,unit=1;
    // Motion clips: one idle loop, reactions played once (pokes, success) and an optional talking loop.
    let THREE,mixer=null,current=null,mmd=null;const actions={idle:null,react:[],talk:null},urls=[];
    function addClip(m,clip,root){
      mixer||=new THREE.AnimationMixer(root);clip.name=m.name||clip.name||m.file;const action=mixer.clipAction(clip);
      if(m.use==='react'){action.setLoop(THREE.LoopOnce,1);actions.react.push(action);}else if(!actions[m.use])actions[m.use]=action;
    }
    function fadeTo(action){
      if(action===current)return;if(action)action.reset().play();
      if(current&&action)current.crossFadeTo(action,.3,false);else if(current)current.fadeOut(.3);current=action||null;
    }
    const playReaction=()=>{if(actions.react.length)fadeTo(actions.react[Math.floor(Math.random()*actions.react.length)]);};
    const ready=(async()=>{
      const K=await vrmKit();THREE=K.THREE;
      if(mod.renderer==='mmd'){
        // the PMX and its textures as blob: URLs; texture names in the PMX match files whatever their case or slash direction
        const files=(mod.assets||[]).filter(f=>!/\.(vmd|vrma|txt)$/i.test(f)),map=await blobs(mod,files,urls);if(disposed)return;
        const byName=new Map(files.map(f=>[fold(f),map.get(f)]));
        const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(/^(blob|data):/.test(url))return url;let rel=url.replace(/^.*?mmd-model\//,'');try{rel=decodeURI(rel);}catch{}return byName.get(fold(rel))||BLANK;});
        mmd=await new K.MMDLoader(manager).loadAsync(`mmd-model/${skin.model}`);if(disposed)return;
        const mesh=mmd.mesh,dict=mesh.morphTargetDictionary||{},morph=Object.fromEntries(Object.entries(MORPHS).map(([key,names])=>[key,names.map(n=>dict[n]).find(i=>i!==undefined)]));
        const root=new THREE.Group();root.add(mesh);
        vrm={scene:root,bone:name=>MMD_BONES[name]&&mesh.skeleton.bones.find(b=>b.name===MMD_BONES[name]),expressionManager:{setValue(name,v){const i=morph[name];if(i!==undefined&&mesh.morphTargetInfluences)mesh.morphTargetInfluences[i]=v;}}};
        for(const m of roles(motionsOf(mod,skin,/\.vmd$/i)))try{
          const url=URL.createObjectURL(new Blob([await loadAsset(asset(mod,m.file))]));urls.push(url);if(disposed)return;
          addClip(m,K.buildAnimation(await new K.VMDLoader().loadAsync(url),mesh),mesh);
        }catch(error){console.warn(`Motion ${m.file} skipped: ${error.message}`);}  // a broken motion leaves the model standing
        step=delta=>{if(mixer)mmd.updateWithMixer(delta,mixer);else mmd.update(delta);};
      }else{
        const data=await loadAsset(asset(mod,skin.model));if(disposed)return;
        const loader=new K.GLTFLoader();loader.register(parser=>new K.VRMLoaderPlugin(parser));
        const gltf=await new Promise((resolve,reject)=>loader.parse(data,'',resolve,reject));if(disposed)return;
        if(gltf.userData.vrm){
          vrm=gltf.userData.vrm;K.VRMUtils.removeUnnecessaryVertices(gltf.scene);K.VRMUtils.combineSkeletons?.(gltf.scene);K.VRMUtils.rotateVRM0(vrm);
          // VRM Animation (.vrma) clips are retargeted onto this model's humanoid; .vmd is only played on MMD models for now
          const animations=new K.GLTFLoader();animations.register(parser=>new K.VRMAnimationLoaderPlugin(parser));
          for(const m of roles(motionsOf(mod,skin,/\.vrma$/i)))try{
            const data=await loadAsset(asset(mod,m.file)),file=await new Promise((resolve,reject)=>animations.parse(data,'',resolve,reject));if(disposed)return;
            const animation=file.userData.vrmAnimations?.[0];if(animation)addClip(m,K.createVRMAnimationClip(animation,vrm),vrm.scene);
          }catch(error){console.warn(`Motion ${m.file} skipped: ${error.message}`);}
        }else{
          // a plain glTF model (no VRM humanoid) plays its own clips: an idle-named one loops, the others are reactions
          vrm={scene:gltf.scene,update(){}};
          for(const m of roles((gltf.animations||[]).map(clip=>({name:clip.name,clip}))))addClip(m,m.clip,gltf.scene);
        }
        step=delta=>{mixer?.update(delta);vrm.update(delta);};
      }
      // Models differ (VRM 0.x / 1.0, MMD, exporters), so face and arms are checked on the model itself rather than assumed.
      const bone=name=>vrm.humanoid?.getNormalizedBoneNode(name),world=name=>{const node=vrm.humanoid?.getRawBoneNode(name)||bone(name)||vrm.bone?.(name);return node?node.getWorldPosition(new THREE.Vector3()):null;};
      const settle=()=>{vrm.update?.(0);vrm.scene.updateMatrixWorld(true);};
      settle();const l=world('leftUpperArm'),r=world('rightUpperArm');
      // facing the camera (+Z) puts the character's left shoulder on the viewer's right
      if(l&&r&&l.x<r.x)vrm.scene.rotation.y+=Math.PI;baseYaw=vrm.scene.rotation.y;
      // Relaxed idle pose instead of the T-pose models ship in; if that lifts the hands, the arm axis is the other way round.
      // An idle motion that moves the arms is left to do so.
      const pose=sign=>{for(const [name,z] of [['leftUpperArm',-1.15],['rightUpperArm',1.15],['leftLowerArm',-.15],['rightLowerArm',.15]]){const node=bone(name);if(node)node.rotation.z=z*sign;}settle();};
      const arm=bone('leftUpperArm'),armsMoving=Boolean(arm&&actions.idle?.getClip().tracks.some(track=>track.name.startsWith(`${arm.name}.`)));
      if(!armsMoving){pose(1);const hand=world('leftHand'),shoulder=world('leftUpperArm');if(vrm.humanoid&&hand&&shoulder&&hand.y>shoulder.y)pose(-1);}
      fadeTo(actions.idle);
      renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.setClearColor(0,0);
      host.append(renderer.domElement);scene=new THREE.Scene();scene.add(vrm.scene);
      const light=new THREE.DirectionalLight(0xffffff,Math.PI);light.position.set(1,1.5,2);scene.add(light,new THREE.AmbientLight(0xffffff,1.2));
      // Frame the upper body like the 2D companions: camera aimed at the chest, slightly below the head,
      // from the model's own size (avatars range from chibi to tall, and MMD units are about 8 cm)
      const box=new THREE.Box3().setFromObject(vrm.scene),height=Math.max(.3,box.max.y-box.min.y),head=world('head')||new THREE.Vector3(0,box.max.y-height*.15,0);unit=height/1.6;
      camera=new THREE.PerspectiveCamera(26,340/300,height/200,Math.max(50,height*30));focus=new THREE.Vector3(head.x,Math.min(head.y,box.max.y)-height*.1,head.z);radius=height*1.75;
      lookTarget=new THREE.Object3D();camera.add(lookTarget);scene.add(camera);if(vrm.lookAt)vrm.lookAt.target=lookTarget;
      mixer?.addEventListener('finished',event=>{if(event.action===current)fadeTo(talking&&actions.talk||actions.idle);});
      clock=new THREE.Clock();resize();
      const tick=()=>{if(disposed)return;frameId=setTimeout(()=>requestAnimationFrame(tick),1000/30);if(document.hidden)return;render(clock.getDelta());};tick();
    })().catch(error=>{host.dataset.error=error.message;console.error(error);});
    const resize=()=>{if(!renderer)return;const w=host.clientWidth||290,h=Math.round(w*300/340);renderer.setSize(w,h,false);renderer.domElement.style.width='100%';renderer.domElement.style.height='auto';};
    const observer=new ResizeObserver(resize);observer.observe(host);
    function render(delta){
      const em=vrm.expressionManager,now=performance.now(),t=now/1000;
      if(em){
        for(const name of ['happy','sad','surprised','relaxed','aa','blink','blinkLeft'])em.setValue(name,0);
        const active=reaction&&now<reactionUntil?reaction:null;
        const mood=active==='joy'||active==='love'?'happy':active==='surprised'?'surprised':EXPRESSIONS[emotion];
        if(mood)em.setValue(mood,emotion==='nervous'&&!active?.5:1);
        if(active==='wink')em.setValue('blinkLeft',1);
        if(now<blinkUntil&&mood!=='happy')em.setValue('blink',1);
        if(talking)em.setValue('aa',.35+.35*Math.sin(t*18));
      }
      // the hand-made bob and sway only when no motion is playing
      if(!current){
        vrm.scene.position.y=unit*((activity==='working'?.012*Math.sin(t*6):.008*Math.sin(t*1.6))+(reaction&&now<reactionUntil?.03*Math.max(0,Math.sin((reactionUntil-now)/180)):0));
        vrm.scene.rotation.y=baseYaw+.06*Math.sin(t*.8);
      }
      camera.position.set(focus.x+radius*Math.sin(yaw)*Math.cos(pitch),focus.y+radius*.04+radius*Math.sin(pitch),focus.z+radius*Math.cos(yaw)*Math.cos(pitch));camera.lookAt(focus);
      step(delta);renderer.render(scene,camera);
    }
    return {
      ready,
      has:cls=>['blink','joy-eyes','wink','love-eyes','open-mouth'].includes(cls),
      update(e,a,s){if(a==='success'&&activity!=='success')playReaction();if(actions.talk&&s!==talking&&(current===actions.idle||current===actions.talk))fadeTo(s?actions.talk:actions.idle);emotion=e;activity=a;talking=s;},
      blink(){blinkUntil=performance.now()+140;},
      look(dx,dy){if(lookTarget)lookTarget.position.set(dx*.6,-dy*.4,-1);},
      react(kind,ms){reaction=kind;reactionUntil=performance.now()+ms;playReaction();},
      motion:()=>current?.getClip().name||null,
      orbit(dx,dy){orbitBy(dx,dy);},view:()=>({yaw,pitch}),resetView(){yaw=0;pitch=0;},
      dispose(){disposed=true;clearTimeout(frameId);observer.disconnect();mixer?.stopAllAction();mmd?.dispose();renderer?.dispose();renderer?.forceContextLoss?.();for(const url of urls)URL.revokeObjectURL(url);}
    };
  }
  // --- Live2D (Cubism 3-5): PixiJS 8 and a Live2D renderer in vendor/live2d-kit.js, after Live2D's own Cubism Core.
  function live2dKit(){
    if(!l2dKit)l2dKit=(async()=>{
      if(!window.Live2DCubismCore){const url=await live2dCore.url();if(!url)throw Object.assign(new Error('Live2D Cubism Core is not installed'),{needsCore:true});await script(url);if(!window.Live2DCubismCore)throw new Error('Live2D Cubism Core did not load');}
      if(!window.Live2DKit)await script(live2dCore.kit||'vendor/live2d-kit.js');return window.Live2DKit;
    })().catch(error=>{l2dKit=null;throw error;});
    return l2dKit;
  }
  // Model authors name expressions freely; these cover the usual English and Japanese names.
  const L2D_EXPRESSIONS={happy:/happy|smile|joy|笑|喜|嬉/i,sad:/sad|cry|泣|悲/i,surprised:/surpris|shock|驚|びっくり/i,nervous:/nervous|sweat|trouble|焦|汗|困/i,smug:/smug|proud|得意|ドヤ/i};
  function createLive2d(host,mod,skin){
    let disposed=false,app=null,model=null,emotion='neutral',activity='idle',talking=false,blinkUntil=0,groups={idle:null,react:[],talk:null},expressions=[];const urls=[];
    // Without the Core the character cannot be drawn: say why and, on the Mac, offer the download from Live2D's own server.
    function askForCore(){
      host.dataset.needs='live2d-core';const box=document.createElement('div');box.className='live2d-consent';box.addEventListener('pointerdown',event=>event.stopPropagation());
      const note=document.createElement('p');note.textContent='這是 Live2D 角色，要用 Live2D 官方的 Cubism Core 才能顯示。Cubism Core 是 Live2D 公司自己的軟體，依 Live2D 的授權條款（Live2D Proprietary Software License）使用，不會隨本 App 散布。';box.append(note);
      if(live2dCore.install){const button=document.createElement('button');button.type='button';button.textContent='同意條款，從 Live2D 官網下載';
        button.addEventListener('click',async event=>{event.stopPropagation();button.disabled=true;button.textContent='下載中…';
          try{await live2dCore.install();box.remove();delete host.dataset.needs;controller.ready=load();}catch(error){button.disabled=false;button.textContent='再試一次';note.textContent=`下載失敗：${error.message}`;}});
        box.append(button);}
      else{const more=document.createElement('p');more.textContent='請先在 Mac 上的角色視窗同意並下載。';box.append(more);}
      host.append(box);
    }
    async function load(){
      try{
        const kit=await live2dKit();if(disposed)return;
        const json=JSON.parse(new TextDecoder().decode(await loadAsset(asset(mod,skin.model))));if(disposed)return;
        // every file the model3.json names becomes a blob: URL; motions the skin adds join a group by their use
        const folder=skin.model.includes('/')?skin.model.slice(0,skin.model.lastIndexOf('/')+1):'',local=ref=>norm(folder+String(ref).replace(/\\/g,'/'));
        const refs=json.FileReferences||{},motions=refs.Motions||{},listed=new Map();
        for(const [group,items] of Object.entries(motions))for(const item of items||[])if(item?.File)listed.set(local(item.File),group);
        const have=new Set(mod.assets||[]),need=[refs.Moc,...(refs.Textures||[]),refs.Physics,refs.Pose,refs.DisplayInfo,...(refs.Expressions||[]).map(e=>e?.File),...listed.keys()].filter(Boolean).map(r=>listed.has(r)?r:local(r));
        for(const m of skin.motions||[])need.push(norm(m.file));
        const map=await blobs(mod,[...new Set(need)].filter(f=>have.has(f)),urls);if(disposed)return;
        const to=ref=>map.get(local(ref));
        refs.Moc=to(refs.Moc);refs.Textures=(refs.Textures||[]).map(to);for(const key of ['Physics','Pose','DisplayInfo'])if(refs[key])refs[key]=to(refs[key]);delete refs.UserData;
        refs.Expressions=(refs.Expressions||[]).filter(e=>to(e.File)).map(e=>({...e,File:to(e.File)}));expressions=refs.Expressions.map(e=>e.Name);
        for(const [group,items] of Object.entries(motions))motions[group]=(items||[]).filter(m=>to(m.File)).map(({Sound,...m})=>({...m,File:to(m.File)}));  // motion sounds are not shipped
        for(const m of skin.motions||[]){const file=norm(m.file);if(!listed.has(file)){const group={idle:'Idle',talk:'Talk'}[m.use]||'TapBody';(motions[group]||=[]).push({File:map.get(file)});listed.set(file,group);}}
        refs.Motions=motions;json.FileReferences=refs;json.url=location.href;
        // groups: the skin's choice first, then the usual names (Idle, TapBody/Tap/Flick...), then any other group reacts
        const used=use=>(skin.motions||[]).filter(m=>m.use===use).map(m=>listed.get(norm(m.file))).filter(Boolean),names=Object.keys(motions).filter(g=>motions[g].length);
        groups.idle=used('idle')[0]||names.find(g=>/^idle$/i.test(g))||names.find(g=>IDLE.test(g))||null;
        groups.talk=used('talk')[0]||names.find(g=>/talk|speak/i.test(g))||null;
        groups.react=used('react').length?used('react'):names.filter(g=>/tap|flick|shake|react|body/i.test(g));if(!groups.react.length)groups.react=names.filter(g=>g!==groups.idle&&g!==groups.talk);
        app=new kit.Application();await app.init({width:340,height:300,backgroundAlpha:0,antialias:true,preference:'webgl',preserveDrawingBuffer:true,resolution:Math.min(2,devicePixelRatio||1)});
        if(disposed){app.destroy(true);return;}
        model=await kit.Live2DModel.from(json,{autoFocus:false,autoHitTest:false,ticker:app.ticker});if(disposed)return;
        // the whole character by default; a double-click switches a tall (full-length) model to an upper-body close-up and back
        const w=model.width||1,h=model.height||1,tall=h/w>1.5,key=`live2d-frame:${mod.id}`;
        const frame=close=>{const scale=Math.min(340*.96/w,300*(close?1:.96)/(h*(close?.62:1)));model.scale.set(scale);model.anchor.set(.5,0);model.position.set(170,close?6:Math.max(0,(300-h*scale)/2));};
        let close=false;try{close=tall&&localStorage.getItem(key)==='upper';}catch{}frame(close);app.stage.addChild(model);
        host.addEventListener('dblclick',event=>{if(!tall)return;event.stopPropagation();close=!close;frame(close);try{localStorage.setItem(key,close?'upper':'full');}catch{}});
        const canvas=app.canvas;canvas.style.width='100%';canvas.style.height='auto';host.append(canvas);
        const internal=model.internalModel,core=internal.coreModel,id=name=>internal.getIdSafe?internal.getIdSafe(name):name;
        const set=(name,v)=>{try{core.setParameterValueById(id(name),v);}catch{}},add=(name,v)=>{try{core.addParameterValueById(id(name),v);}catch{}};
        internal.on('beforeModelUpdate',()=>{
          const now=performance.now(),t=now/1000;
          if(talking)set('ParamMouthOpenY',.35+.35*Math.sin(t*18));
          if(now<blinkUntil){set('ParamEyeLOpen',0);set('ParamEyeROpen',0);}
          if(!groups.idle){add('ParamBodyAngleX',3*Math.sin(t*.8));add('ParamAngleZ',2*Math.sin(t*.6));}  // no idle motion: a gentle sway
        });
        if(groups.idle){internal.motionManager.groups.idle=groups.idle;model.motion(groups.idle,undefined,1);}
        express(emotion);
      }catch(error){
        if(error.needsCore&&!disposed)return askForCore();
        host.dataset.error=error.message;console.error(error);
      }
    }
    function express(e){
      if(!model)return;const name=L2D_EXPRESSIONS[e]&&expressions.find(n=>L2D_EXPRESSIONS[e].test(n));
      if(name)model.expression?.(name);else model.internalModel.motionManager.expressionManager?.resetExpression?.();
    }
    // reactions play once even when their motion3.json says Loop; the idle group is restarted by the engine
    const play=(group,priority=3)=>{if(model&&group)model.motion(group,undefined,priority,{loop:false}).catch(()=>{});};
    const playReaction=()=>play(groups.react[Math.floor(Math.random()*groups.react.length)]);
    const controller={
      ready:load(),
      has:cls=>['blink','open-mouth'].includes(cls)||cls==='joy-eyes'&&expressions.some(n=>L2D_EXPRESSIONS.happy.test(n)),
      update(e,a,s){if(e!==emotion)express(e);if(a==='success'&&activity!=='success')playReaction();if(groups.talk&&s&&!talking)play(groups.talk,2);emotion=e;activity=a;talking=s;},
      blink(){blinkUntil=performance.now()+140;},
      look(dx,dy){model?.internalModel.focusController.focus(Math.max(-1,Math.min(1,dx)),Math.max(-1,Math.min(1,-dy)));},
      react(kind){if(kind==='joy'||kind==='love')express('happy');else if(kind==='surprised')express('surprised');setTimeout(()=>express(emotion),1300);playReaction();},
      motion:()=>model?.internalModel.motionManager.state.currentGroup||null,
      // Live2D is flat: drags move the window as for the 2D companions
      orbit(){},view:()=>({yaw:0,pitch:0}),resetView(){},
      dispose(){disposed=true;try{app?.destroy(true,{children:true});}catch{}for(const url of urls)URL.revokeObjectURL(url);}
    };
    return controller;
  }
  window.Avatars={mount,update,blink,look,react,has,setAssetLoader,setLive2dCore,orbit:(el,dx,dy)=>controllers.get(el)?.orbit(dx,dy),view:el=>controllers.get(el)?.view(),motion:el=>controllers.get(el)?.motion?.()||null,ready:el=>controllers.get(el)?.ready||Promise.resolve()};
})();
