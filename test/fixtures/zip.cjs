// A small zip writer for tests: names as raw bytes (e.g. Shift-JIS without the UTF-8 flag), symlinks, and lying sizes.
const zlib=require('node:zlib');const {crc32}=require('../../src/main/archive.cjs');
// entries: [{name: string|Buffer, data: Buffer|string, utf8?: true (sets the UTF-8 flag), deflate?: true, symlink?: true, size?: declared size}]
function makeZip(entries){
  const locals=[],centrals=[];let offset=0;
  for(const e of entries){
    const name=Buffer.isBuffer(e.name)?e.name:Buffer.from(e.name,'utf8'),raw=Buffer.from(e.data??''),body=e.deflate?zlib.deflateRawSync(raw):raw;
    const flags=e.utf8?0x800:0,method=e.deflate?8:0,crc=crc32(raw),size=e.size??raw.length,mode=e.symlink?0o120777:name.at(-1)===0x2f?0o040755:0o100644;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(size,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE((3<<8)|20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(size,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE((mode<<16)>>>0,38);central.writeUInt32LE(offset,42);
    locals.push(local,name,body);centrals.push(central,name);offset+=30+name.length+body.length;
  }
  const cd=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,cd,end]);
}
const sjis=text=>{const map=new Map();const dec=new TextDecoder('shift_jis');
  // build the Shift-JIS bytes by searching the decoder's table for each character (fine for short names in tests)
  return Buffer.concat([...text].map(ch=>{if(ch.charCodeAt(0)<0x80)return Buffer.from(ch,'latin1');if(map.has(ch))return map.get(ch);
    for(let a=0x81;a<=0xfc;a++)for(let b=0x40;b<=0xfc;b++){const bytes=Buffer.from([a,b]);if(dec.decode(bytes)===ch){map.set(ch,bytes);return bytes;}}throw new Error(`no Shift-JIS for ${ch}`);}));};
module.exports={makeZip,sjis};
