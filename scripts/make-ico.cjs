// build/icon.ico for the Windows build, from build/icon.png: PNG-compressed entries at the sizes Explorer and the taskbar ask for.
// Usage: npx electron scripts/make-ico.cjs   (scripts/make-icon.cjs redraws icon.png; run this after it)
const fs=require('node:fs');const path=require('node:path');
const SIZES=[16,24,32,48,64,128,256];
// ICONDIR + one ICONDIRENTRY per image (a width/height byte of 0 means 256), then the PNG data.
function ico(images){
  const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
  let offset=header.length;
  images.forEach(({size,png},i)=>{const at=6+16*i;header.writeUInt8(size>=256?0:size,at);header.writeUInt8(size>=256?0:size,at+1);header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(png.length,at+8);header.writeUInt32LE(offset,at+12);offset+=png.length;});
  return Buffer.concat([header,...images.map(image=>image.png)]);
}
module.exports={ico,SIZES};
if(process.argv.some(arg=>/make-ico\.cjs$/.test(arg))){
  const {app,nativeImage}=require('electron');
  app.whenReady().then(()=>{
    const build=path.join(__dirname,'..','build'),image=nativeImage.createFromPath(path.join(build,'icon.png'));
    fs.writeFileSync(path.join(build,'icon.ico'),ico(SIZES.map(size=>({size,png:image.resize({width:size,height:size,quality:'best'}).toPNG()}))));
    console.log('ICO_DONE',path.join(build,'icon.ico'));app.quit();
  });
}
