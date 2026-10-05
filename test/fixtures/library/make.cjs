// Builds a fetch stand-in that answers with data shaped like the real avatar-store libraries.
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..','..','..');
const PNG=fs.readFileSync(path.join(root,'build','icon-256.png')),VRM=fs.readFileSync(path.join(root,'mods','vrm-sample','sample.vrm'));
// a minimal plain glTF (one triangle, no VRM), like a Sketchfab character
function glb(){
  const positions=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>positions.writeFloatLE(v,i*4));
  const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],bufferViews:[{buffer:0,byteLength:36}],buffers:[{byteLength:36}]}));
  const pad=(b,c)=>Buffer.concat([b,Buffer.alloc((4-b.length%4)%4,c)]);const j=pad(json,0x20),bin=pad(positions,0);
  const head=Buffer.alloc(12);head.write('glTF',0,'latin1');head.writeUInt32LE(2,4);head.writeUInt32LE(12+8+j.length+8+bin.length,8);
  const chunk=(data,type)=>{const h=Buffer.alloc(8);h.writeUInt32LE(data.length,0);h.write(type,4,'latin1');return Buffer.concat([h,data]);};
  return Buffer.concat([head,chunk(j,'JSON'),chunk(bin,'BIN\0')]);
}
const GLB=glb();
const OSA='https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data';
const vroidModel=(id,name,extra={})=>({id,name,is_downloadable:true,is_other_users_available:true,age_limit:{is_r18:false,is_r15:false,is_adult:false},
  license:{modification:'allow',redistribution:'disallow',credit:'necessary',personal_commercial_use:'profit',corporate_commercial_use:'disallow'},
  portrait_image:{sq300:{url:`https://vroid-hub.pximg.net/images/${id}.png`}},character:{id:`c${id}`,name,user:{name:'Miko Maker'}},...extra});
const routes={
  [`${OSA}/projects.json`]:JSON.stringify([{id:'elves',name:'Xmas Chibis',creator_id:'Polygonal-Mind',license:'CC0',is_public:true,avatar_data_file:'avatars/elves.json'},{id:'closed',name:'Closed',license:'CC-BY-NC',is_public:true,avatar_data_file:'avatars/closed.json'}]),
  [`${OSA}/avatars/elves.json`]:JSON.stringify([{name:'Elel Silverbell',description:'Merry elf',format:'VRM',is_public:true,is_draft:false,model_file_url:'https://dweb.link/ipfs/elf.vrm',thumbnail_url:'https://dweb.link/ipfs/elf.png'},{name:'Draft Elf',format:'VRM',is_public:true,is_draft:true,model_file_url:'https://dweb.link/ipfs/x.vrm'}]),
  [`${OSA}/avatars/closed.json`]:JSON.stringify([{name:'Elf NC',format:'VRM',is_public:true,model_file_url:'https://dweb.link/ipfs/nc.vrm'}]),
  'https://dweb.link/ipfs/elf.vrm':VRM,'https://dweb.link/ipfs/elf.png':PNG,
  'https://raw.githubusercontent.com/madjin/vrm-samples/master/vroid/beta/Sendagaya_Shino.vrm':VRM,
  // VRoid Hub: staff picks, a search with one usable model, one locked to its author and one age-restricted
  'https://hub.vroid.com/api/staff_picks?count=40':JSON.stringify({data:[vroidModel('100','Staff Pick Girl')]}),
  'https://hub.vroid.com/api/search/character_models?keyword=miko&count=40':JSON.stringify({data:[vroidModel('200','Shrine Miko'),vroidModel('201','Private Miko',{is_other_users_available:false}),vroidModel('202','R15 Miko',{age_limit:{is_r15:true}})]}),
  'https://hub.vroid.com/api/download_licenses/L200/download':VRM,
  'https://vroid-hub.pximg.net/images/100.png':PNG,'https://vroid-hub.pximg.net/images/200.png':PNG,
  // Sketchfab: one CC BY character, one non-commercial (skipped)
  'https://api.sketchfab.com/v3/models/sf1/download':JSON.stringify({glb:{url:'https://sketchfab-prod-media.s3.amazonaws.com/archives/sf1.glb?sig=x'}}),
  'https://sketchfab-prod-media.s3.amazonaws.com/archives/sf1.glb?sig=x':GLB,'https://media.sketchfab.com/models/sf1/thumbnails/a/448.jpeg':PNG,
  'https://safebooru.org/thumbnails/1/thumbnail_a.jpg':PNG,'https://safebooru.org/samples/1/sample_a.jpg':PNG
};
function fetchFixture(seen=[]){return async(url,options={})=>{seen.push(url);
  if(url==='https://hub.vroid.com/api/download_licenses'&&options.method==='POST'){const id=JSON.parse(options.body).character_model_id;return reply(JSON.stringify({data:{id:`L${id}`}}));}
  if(url.startsWith('https://hub.vroid.com/')&&options.headers?.Authorization!=='Bearer fixture-token')return {ok:false,status:401,arrayBuffer:async()=>new ArrayBuffer(0)};
  if(url.startsWith('https://api.sketchfab.com/v3/search?'))return reply(JSON.stringify({results:[
    {uid:'sf1',name:'Anime Knight Girl',license:{label:'CC Attribution'},user:{displayName:'Low Poly Lab'},viewerUrl:'https://sketchfab.com/3d-models/sf1',thumbnails:{images:[{width:448,url:'https://media.sketchfab.com/models/sf1/thumbnails/a/448.jpeg'},{width:1024,url:'https://media.sketchfab.com/models/sf1/thumbnails/a/1024.jpeg'}]}},
    {uid:'sf2',name:'NC Girl',license:{label:'CC Attribution-NonCommercial'},user:{displayName:'x'},thumbnails:{images:[]}}]}));
  if(url.startsWith('https://api.sketchfab.com/v3/models/')&&options.headers?.Authorization!==`Token ${'f'.repeat(32)}`)return {ok:false,status:401,arrayBuffer:async()=>new ArrayBuffer(0)};
  if(url.startsWith('https://safebooru.org/index.php?'))return reply(JSON.stringify([
    {id:1,image:'a.jpg',rating:'general',tags:'1girl animal_ears cat_ears smile solo',preview_url:'https://safebooru.org/thumbnails/1/thumbnail_a.jpg',sample_url:'https://safebooru.org/samples/1/sample_a.jpg',sample:true,file_url:'https://safebooru.org/images/1/a.jpg'},
    {id:2,image:'b.jpg',rating:'questionable',tags:'1girl cat_ears',preview_url:'https://safebooru.org/thumbnails/2/thumbnail_b.jpg',file_url:'https://safebooru.org/images/2/b.jpg'}]));
  if(routes[url]!==undefined)return reply(routes[url]);return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};};}
const reply=body=>({ok:true,status:200,arrayBuffer:async()=>{const b=Buffer.isBuffer(body)?body:Buffer.from(body);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length);},json:async()=>JSON.parse(Buffer.from(body).toString())});
module.exports={fetchFixture,GLB};
