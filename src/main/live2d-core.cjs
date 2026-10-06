// Live2D's Cubism Core (live2dcubismcore.min.js) is Live2D Inc.'s proprietary runtime, used under Live2D's own licence.
// It is never bundled or committed: when a Live2D character first needs it and the user agrees in the app, it is downloaded
// once from Live2D's own server into userData, and pages load it from there.
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');const L=require('./locales.cjs');
const SOURCE='https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
function createLive2dCore({dir,fetchImpl=(...args)=>fetch(...args),source=SOURCE}){
  const file=path.join(dir,'live2dcubismcore.min.js');
  const installed=()=>{try{return fs.statSync(file).isFile();}catch{return false;}};
  let pending=null;
  async function download(){
    const response=await fetchImpl(source);if(!response.ok)throw L.error('live2d.downloadFailed',{status:response.status});
    const data=Buffer.from(await response.arrayBuffer());
    if(data.length>8*1024*1024||!data.includes('Live2DCubismCore'))throw L.error('live2d.notCore');
    fs.mkdirSync(dir,{recursive:true});const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,data);fs.renameSync(temp,file);return file;
  }
  // only called after the user agreed in the window; concurrent windows share one download
  function install(){if(installed())return Promise.resolve(file);return pending||=download().finally(()=>{pending=null;});}
  return {file,source,installed,install,url:()=>installed()?pathToFileURL(file).href:null};
}
module.exports={createLive2dCore,SOURCE};
