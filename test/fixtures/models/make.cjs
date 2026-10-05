// Tiny Live2D and MMD models built in code for the unit tests and the offline smoke. They are made up here,
// so nothing from Live2D Inc. or a model author is shipped: the .moc3 is a header only and needs the stand-in Core.
const fs=require('node:fs');const path=require('node:path');const zlib=require('node:zlib');

const CRC=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=buf=>{let c=0xffffffff;for(const b of buf)c=CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
// an RGBA PNG: colour(x,y) -> [r,g,b,a]
function png(w,h,colour){
  const rows=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)Buffer.from(colour(x,y)).copy(rows,y*(w*4+1)+1+x*4);
  const chunk=(type,data)=>{const t=Buffer.from(type,'latin1'),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const checker=(a,b)=>(x,y)=>((x>>3)+(y>>3))%2?a:b;

// --- PMX 2.0 writer: UTF-16 text, 4-byte indices, BDEF1 weights. Enough for three-mmd to load and animate.
class Out{constructor(){this.parts=[];}
  i8(v){const b=Buffer.alloc(1);b.writeInt8(v);this.parts.push(b);return this;}u8(v){this.parts.push(Buffer.from([v]));return this;}
  i32(v){const b=Buffer.alloc(4);b.writeInt32LE(v);this.parts.push(b);return this;}u16(v){const b=Buffer.alloc(2);b.writeUInt16LE(v);this.parts.push(b);return this;}
  f(...vs){for(const v of vs){const b=Buffer.alloc(4);b.writeFloatLE(v);this.parts.push(b);}return this;}
  text(s){const b=Buffer.from(s,'utf16le');this.i32(b.length);this.parts.push(b);return this;}raw(b){this.parts.push(Buffer.from(b));return this;}
  done(){return Buffer.concat(this.parts);}}
// A body panel on bone センター and a head panel on bone 頭; morphs まばたき (blink), あ (mouth) and 笑い (smile) move head vertices.
function pmx({name='テストモデル',textures=['tex\\Body.PNG','tex/face.png','toon01.bmp']}={}){
  const o=new Out();o.raw('PMX ').f(2).u8(8).raw([0,0,4,4,4,4,4,4]);
  o.text(name).text('Test model').text('Made in code for tests.').text('');
  const quad=(x0,x1,y0,y1,bone)=>[[x0,y0,0,1],[x1,y0,1,1],[x0,y1,0,0],[x1,y1,1,0]].map(([x,y,u,v])=>({x,y,u,v,bone}));
  const verts=[...quad(-3,3,0,10,0),...quad(-2.5,2.5,10,16,1)];
  o.i32(verts.length);for(const v of verts)o.f(v.x,v.y,0,0,0,-1,v.u,v.v).u8(0).i32(v.bone).f(1);
  const faces=[0,1,2,2,1,3,4,5,6,6,5,7];o.i32(faces.length);for(const i of faces)o.i32(i);
  o.i32(textures.length);for(const t of textures)o.text(t);
  const material=(n,tex,count)=>o.text(n).text(n).f(1,1,1,1, 0,0,0, 5, .6,.6,.6).u8(0x01|0x02|0x04|0x08).f(0,0,0,1, 1).i32(tex).i32(-1).u8(0).u8(1).u8(0).text('').i32(count);
  o.i32(2);material('体',0,6);material('顔',1,6);
  o.i32(2);
  o.text('センター').text('center').f(0,8,0).i32(-1).i32(0).u16(0x001f).i32(-1);
  o.text('頭').text('head').f(0,10,0).i32(0).i32(0).u16(0x000b).i32(-1);
  const morph=(n,panel,offsets)=>{o.text(n).text(n).u8(panel).u8(1).i32(offsets.length);for(const [i,x,y] of offsets)o.i32(i).f(x,y,0);};
  o.i32(3);morph('まばたき',2,[[6,0,-2],[7,0,-2]]);morph('あ',3,[[4,0,-3],[5,0,-3]]);morph('笑い',4,[[6,1,0],[7,-1,0]]);
  o.i32(0).i32(0).i32(0);  // display frames, rigid bodies, joints
  return o.done();
}
// --- VMD: bone names are Shift-JIS (written as bytes, Node has no Shift-JIS encoder).
const SJIS={'頭':[0x93,0xaa],'センター':[0x83,0x5a,0x83,0x93,0x83,0x5e,0x81,0x5b],'あ':[0x82,0xa0]};
const fixed=(bytes,n)=>{const b=Buffer.alloc(n);Buffer.from(bytes).copy(b);return b;};
const LINEAR=Buffer.concat(Array(4).fill(Buffer.from([20,20,20,20,20,20,20,20,107,107,107,107,107,107,107,107])));
// the head swings left and right over one second, the mouth opens and closes
function vmd({frames=30,angle=.6}={}){
  const o=new Out();o.raw(fixed(Buffer.from('Vocaloid Motion Data 0002','latin1'),30)).raw(fixed(Buffer.from('fixture','latin1'),20));
  const keys=[[0,0],[frames/4,angle],[frames*3/4,-angle],[frames,0]];
  o.i32(keys.length);for(const [frame,a] of keys)o.raw(fixed(SJIS['頭'],15)).i32(frame).f(0,0,0, 0,0,Math.sin(a/2),Math.cos(a/2)).raw(LINEAR);
  o.i32(3);for(const [frame,w] of [[0,0],[frames/2,1],[frames,0]])o.raw(fixed(SJIS['あ'],15)).i32(frame).f(w);
  o.i32(0).i32(0).i32(0).i32(0);
  return o.done();
}
// An MMD folder the way archives come: textures in a sub-folder whose names differ in case from what the PMX says.
function mmdFolder(dir,{motions=true,extra=true}={}){
  fs.mkdirSync(path.join(dir,'Model','Tex'),{recursive:true});
  fs.writeFileSync(path.join(dir,'Model','テストモデル.pmx'),pmx());
  fs.writeFileSync(path.join(dir,'Model','Tex','body.png'),png(32,32,checker([240,150,170,255],[250,210,220,255])));
  fs.writeFileSync(path.join(dir,'Model','Tex','Face.png'),png(32,32,checker([255,230,200,255],[90,60,60,255])));
  if(motions){fs.mkdirSync(path.join(dir,'Model','motion'),{recursive:true});fs.writeFileSync(path.join(dir,'Model','motion','待機.vmd'),vmd());fs.writeFileSync(path.join(dir,'Model','motion','wave.vmd'),vmd({angle:1}));}
  if(extra){fs.writeFileSync(path.join(dir,'Model','readme.txt'),'利用規約');fs.writeFileSync(path.join(dir,'Model','unused.png'),png(2,2,()=>[0,0,0,255]));}
  return {entry:'Model/テストモデル.pmx'};
}
// --- Live2D: a model3.json with textures, an expression and two motion groups; the moc3 is a header for the stand-in Core.
function motion3(id,values,duration=2,loop=true){
  const segments=[0,values[0]];values.slice(1).forEach((v,i)=>segments.push(0,(i+1)*duration/(values.length-1),v));
  return JSON.stringify({Version:3,Meta:{Duration:duration,Fps:30,Loop:loop,AreBeziersRestricted:true,CurveCount:1,TotalSegmentCount:values.length-1,TotalPointCount:values.length,UserDataCount:0,TotalUserDataSize:0},Curves:[{Target:'Parameter',Id:id,Segments:segments}]});
}
function live2dFolder(dir,{name='hiyori'}={}){
  const root=path.join(dir,name,'runtime');for(const sub of ['textures','motions','expressions'])fs.mkdirSync(path.join(root,sub),{recursive:true});
  fs.writeFileSync(path.join(root,`${name}.model3.json`),JSON.stringify({Version:3,FileReferences:{Moc:`${name}.moc3`,Textures:['textures/texture_00.png'],Physics:`${name}.physics3.json`,
    Expressions:[{Name:'smile',File:'expressions/smile.exp3.json'}],Motions:{Idle:[{File:'motions/idle.motion3.json'}],TapBody:[{File:'motions/tap.motion3.json',Sound:'sounds/tap.wav'}]}},
    Groups:[{Target:'Parameter',Name:'EyeBlink',Ids:['ParamEyeLOpen','ParamEyeROpen']},{Target:'Parameter',Name:'LipSync',Ids:['ParamMouthOpenY']}]}));
  fs.writeFileSync(path.join(root,`${name}.moc3`),Buffer.concat([Buffer.from('MOC3','latin1'),Buffer.alloc(60)]));
  fs.writeFileSync(path.join(root,`${name}.physics3.json`),JSON.stringify({Version:3,Meta:{PhysicsSettingCount:0,TotalInputCount:0,TotalOutputCount:0,VertexCount:0,Fps:30,EffectiveForces:{Gravity:{X:0,Y:-1},Wind:{X:0,Y:0}},PhysicsDictionary:[]},PhysicsSettings:[]}));
  fs.writeFileSync(path.join(root,'textures','texture_00.png'),png(64,64,(x,y)=>y>40&&y<52&&x>24&&x<40?[120,40,60,255]:checker([255,200,120,255],[255,170,90,255])(x,y)));
  fs.writeFileSync(path.join(root,'expressions','smile.exp3.json'),JSON.stringify({Type:'Live2D Expression',Parameters:[{Id:'ParamMouthForm',Value:1,Blend:'Add'}]}));
  fs.writeFileSync(path.join(root,'motions','idle.motion3.json'),motion3('ParamAngleX',[-30,30,-30]));
  fs.writeFileSync(path.join(root,'motions','tap.motion3.json'),motion3('ParamBodyAngleX',[0,10,0],1,false));
  fs.writeFileSync(path.join(root,'readme.txt'),'sample');
  return {entry:`${name}/runtime/${name}.model3.json`};
}
// --- VRM Animation (.vrma): a glTF with a humanoid map and one clip that sways the upper body side to side over a second.
function vrma({angle=.5}={}){
  const times=[0,.25,.75,1],quats=[0,angle,-angle,0].flatMap(a=>[0,0,Math.sin(a/2),Math.cos(a/2)]);
  const bin=Buffer.alloc(16+64);times.forEach((t,i)=>bin.writeFloatLE(t,i*4));quats.forEach((q,i)=>bin.writeFloatLE(q,16+i*4));
  const json={asset:{version:'2.0'},extensionsUsed:['VRMC_vrm_animation'],scene:0,scenes:[{nodes:[0]}],
    nodes:[{name:'hips',translation:[0,1,0],children:[1]},{name:'spine',translation:[0,.1,0],children:[2]},{name:'chest',translation:[0,.15,0],children:[3]},{name:'neck',translation:[0,.2,0],children:[4]},{name:'head',translation:[0,.1,0]}],
    extensions:{VRMC_vrm_animation:{specVersion:'1.0',humanoid:{humanBones:{hips:{node:0},spine:{node:1},chest:{node:2},neck:{node:3},head:{node:4}}}}},
    animations:[{name:'sway',channels:[{sampler:0,target:{node:1,path:'rotation'}}],samplers:[{input:0,output:1,interpolation:'LINEAR'}]}],
    accessors:[{bufferView:0,componentType:5126,count:4,type:'SCALAR',min:[0],max:[1]},{bufferView:1,componentType:5126,count:4,type:'VEC4'}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:16},{buffer:0,byteOffset:16,byteLength:64}],buffers:[{byteLength:bin.length}]};
  const pad=(b,fill)=>Buffer.concat([b,Buffer.alloc((4-b.length%4)%4,fill)]);const j=pad(Buffer.from(JSON.stringify(json)),0x20),b=pad(bin,0);
  const chunk=(data,type)=>{const h=Buffer.alloc(8);h.writeUInt32LE(data.length,0);h.write(type,4,'latin1');return Buffer.concat([h,data]);};
  const head=Buffer.alloc(12);head.write('glTF',0,'latin1');head.writeUInt32LE(2,4);head.writeUInt32LE(12+8+j.length+8+b.length,8);
  return Buffer.concat([head,chunk(j,'JSON'),chunk(b,'BIN\0')]);
}
const STANDIN_CORE=path.join(__dirname,'live2dcubismcore.standin.js');
module.exports={png,pmx,vmd,vrma,motion3,mmdFolder,live2dFolder,STANDIN_CORE};
