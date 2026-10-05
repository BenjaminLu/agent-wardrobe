// Codex draws a brand-new character from a photo, as SVG parts in Annie's style that obey the face contract,
// then compares a render of its drawing with the photo and revises. Uses the user's own Codex sign-in.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');

const SCHEMA={type:'object',additionalProperties:false,required:['gender','summary','palette','rig','face','outfit','mouth'],properties:{
  gender:{type:'string',enum:['male','female','neutral']},
  summary:{type:'string',description:'One short Traditional Chinese sentence describing the character'},
  palette:{type:'object',additionalProperties:false,required:['body','bodyLight','belly','accent','ink','cheek'],properties:Object.fromEntries(['body','bodyLight','belly','accent','ink','cheek'].map(k=>[k,{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}]))},
  rig:{type:'string'},face:{type:'string'},
  outfit:{type:'object',additionalProperties:false,required:['svg','hide'],properties:{svg:{type:'string'},hide:{type:'array',items:{type:'string',enum:['hands','legs']}}}},
  mouth:{type:'array',items:{type:'number'},minItems:2,maxItems:2}}};

const SUBJECT={
  photo:`Draw ONE NEW character based on the real person in the FIRST attached image (a photo). It must be recognisably that person as a chibi:
gender presentation, face shape, hairstyle and parting, hair colour, eyebrows, glasses or facial hair if any, and their clothes (style and colours).
A man gets a man's hairstyle, shoulders and trousers; do not reuse the reference girl's bob or skirt unless the photo has them.`,
  outfit:`The FIRST attached image is a photo of clothes (on a person, a hanger or laid flat). Dress the EXISTING character below in those clothes:
copy the garment types, colours, patterns and details into outfit.svg and palette. Keep its rig, face and mouth exactly as they are (same hair, same face).`,
  character:`The FIRST attached image is an existing app character (not a photo). Redraw THIS character as SVG parts so it can be edited:
keep its species and silhouette, colours, face, outfit and accessories as close to the image as you can. It may be an animal, a robot or a person;
adapt the animation contract to it (its eyes still need the eyes/pupils/blink classes, its mouth the smile/open-mouth classes).`};
function brief(annie,reference='photo'){return `You draw cute chibi desktop-companion characters as SVG fragments for an app.
${SUBJECT[reference]||SUBJECT.photo}

House style: exactly like the reference character "Annie" (JSON below): same canvas, proportions and stroke weight —
big round head (about 60% of the height), tiny body, rounded mitten hands, short legs, soft cel shading with 2-3 tones per colour,
outlines inherited from the outer group (stroke = ink colour, stroke-width 6; use thinner stroke-width for inner details).
Canvas 340x300, character centred on x=170, feet near y=280. Annie draws her head inside <g transform="translate(170 205) scale(1.1) translate(-170 -205)">; you may do the same.

Animation contract (the app shows/hides these by class — keep positions close to Annie's so the face animates correctly):
- face must contain <g class="eyes"> with a <g class="pupils"> inside (pupils move ±6/±4, leave room), plus class "blink" (closed eyes),
  "joy-eyes" (^ ^), "wink", "love-eyes", "brows", "smile", "open-mouth" (talking, scaled vertically around "mouth"), "sad-mouth", "sweat", "tears", "cheeks".
- rig = body, legs, arms/hands, hair behind the head, head shape and front hair. Mark hand shapes class="hands" and leg shapes class="legs".
- outfit.svg = clothes drawn over the rig (top, trousers or skirt, collar, shoes details); outfit.hide may hide "hands" or "legs" under long sleeves/gowns.
- mouth = [x, y] pivot of the mouth for talking.

Allowed: elements g, path, circle, ellipse, rect, line, polyline, polygon; attributes d cx cy r rx ry x y width height x1 y1 x2 y2 points fill stroke stroke-width
stroke-opacity fill-opacity opacity stroke-linecap stroke-linejoin transform class. Colours: #hex, none, var(--body|bodyLight|belly|accent|ink|cheek), url(#body-gradient).
No text, style, gradients other than url(#body-gradient), images, scripts, links or comments. Use double quotes for attributes. Keep rig+face+outfit under 18000 characters.
palette: body/bodyLight = main clothing colours (url(#body-gradient) blends them), belly = light inner colour, accent = trim, ink = outline (dark), cheek = blush.

Reference character Annie (parts.json):
${JSON.stringify({rig:annie.rig,face:annie.face,mouth:annie.mouth,outfitExample:annie.accessories['lace-collar'].svg})}

Reply with JSON only, matching the given schema.`;}

const binary=()=>[process.env.CODEX_BIN,'/opt/homebrew/bin/codex','/usr/local/bin/codex',path.join(os.homedir(),'.local','bin','codex')].find(p=>p&&fs.existsSync(p));
// schema: the JSON shape Codex must answer in (the character drawing by default); words: the messages for a timeout / no answer / bad JSON
const DRAW_WORDS={slow:'Codex 畫太久了，請再試一次。',none:'Codex 沒有畫出結果',bad:'Codex 回傳的不是完整的角色資料，請再試一次。'};
function runCodex({prompt,images=[],dir,schema=SCHEMA,words=DRAW_WORDS,timeoutMs=8*60*1000,onEvent=()=>{}}){
  return new Promise((resolve,reject)=>{
    const bin=binary();if(!bin)return reject(new Error('找不到 Codex：請先在「設定 → AI 大腦」安裝並登入 Codex。'));
    const schemaFile=path.join(dir,'schema.json');fs.writeFileSync(schemaFile,JSON.stringify(schema));
    const args=['exec','--ephemeral','--skip-git-repo-check','-s','read-only','-C',dir,'--output-schema',schemaFile,'--json',...images.flatMap(i=>['-i',i]),'-'];
    const child=spawn(bin,args,{stdio:['pipe','pipe','pipe']});let buffer='',last=null,err='';
    const timer=setTimeout(()=>{child.kill();reject(new Error(words.slow));},timeoutMs);
    child.stdout.on('data',data=>{buffer+=data;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let event;try{event=JSON.parse(line);}catch{continue;}
      onEvent(event);if(event.type==='item.completed'&&event.item?.type==='agent_message')last=event.item.text;}});
    child.stderr.on('data',d=>{err=(err+d).slice(-2000);});
    child.on('close',code=>{clearTimeout(timer);if(!last)return reject(new Error(`${words.none}${code?`（${err.trim().split('\n').slice(-1)[0]||code}）`:''}`));
      try{resolve(JSON.parse(last.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));}catch{reject(new Error(words.bad));}});
    child.stdin.end(prompt);
  });
}

// draw → check (sanitiser and face contract) → render → compare with the photo and revise
async function drawCharacter({photo,annie,validate,render,rounds=2,instruction=null,current=null,reference='photo',onProgress=()=>{}}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-draw-'));fs.chmodSync(dir,0o700);
  const progress=(step,detail)=>onProgress({step,detail});
  try{
    const base=brief(annie,reference);let drawing=current,mod=current?validate(current):null,feedback=instruction?`The user asks for this change: ${instruction}`:null;
    const total=current?1:rounds+1;
    for(let round=0;round<total;round++){
      const images=photo?[photo]:[];let prompt=base;
      if(drawing){const shot=path.join(dir,`render-${round}.png`);fs.writeFileSync(shot,await render(mod));images.push(shot);
        prompt+=`\n\nYour current drawing (JSON):\n${JSON.stringify(drawing)}\n${photo?'The SECOND image is how it renders.':'There is no photo this time: the ONLY image is how your drawing renders. Keep the likeness you already drew.'} ${feedback||'Compare it with the first image and fix the biggest differences in likeness and style (hair shape, face, clothes, colours, proportions). Keep what already works.'}\nReturn the full revised JSON.`;}
      progress(drawing?'revise':'draw',`${round+1}/${total}`);
      let reply=await runCodex({prompt,images,dir,onEvent:e=>{if(e.type==='item.completed'&&e.item?.type==='reasoning')progress('thinking',round+1);}});
      // a drawing that breaks the rules goes back once with the error
      for(let attempt=0;;attempt++){
        try{mod=validate(reply);drawing=reply;break;}
        catch(error){if(attempt>=1)throw new Error(`Codex 畫的圖沒通過檢查：${error.message}`);progress('fix',error.message);
          reply=await runCodex({prompt:`${base}\n\nYour drawing (JSON):\n${JSON.stringify(reply)}\nThe app rejected it: ${error.message}\nFix exactly that and return the full JSON.`,images:photo?[photo]:[],dir});}
      }
      feedback=null;
    }
    progress('done');return {drawing,mod};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={drawCharacter,brief,SCHEMA,runCodex,codexBinary:binary};
