// Safety check for PyTorch checkpoints from the internet (GPT-SoVITS .ckpt / .pth voice packs).
// A checkpoint is a zip with a pickle (data.pkl); unpickling can run any Python function the pickle names, and the
// GPT-SoVITS loader unpickles fully. So before a pack is accepted, every function or class the pickle refers to is
// read without running anything, and the pack is refused unless all of them are on a short list of what plain model
// weights need (tensors, storages, dicts, GPT-SoVITS's own hyper-parameter object).
const fs=require('node:fs');

const ALLOWED=new Set([
  'collections.OrderedDict','builtins.set','builtins.frozenset','builtins.object','copyreg._reconstructor','_codecs.encode','argparse.Namespace',
  'torch._utils._rebuild_tensor_v2','torch._utils._rebuild_tensor_v3','torch._utils._rebuild_parameter','torch._utils._rebuild_parameter_with_state','torch.Size',
  ...['Half','Float','BFloat16','Double','Long','Int','Short','Char','Byte','Bool'].map(t=>`torch.${t}Storage`),'torch.storage.UntypedStorage','torch.storage.TypedStorage',
  ...['float16','float32','float64','bfloat16','int64','int32','int16','int8','uint8','bool'].map(t=>`torch.${t}`),
  'utils.HParams','GPT_SoVITS.utils.HParams','module.utils.HParams',
  'numpy.core.multiarray.scalar','numpy._core.multiarray.scalar','numpy.dtype','numpy.core.multiarray._reconstruct','numpy._core.multiarray._reconstruct','numpy.ndarray'
]);
const fail=message=>Object.assign(new Error(message),{code:'UNSAFE_PICKLE'});

// Walks the opcodes and returns the "module.name" of every GLOBAL / INST / STACK_GLOBAL. Throws on anything it cannot
// account for (extension codes, a STACK_GLOBAL whose names are not the two strings pushed just before it, truncation).
function pickleGlobals(buf){
  const out=new Set(),memo=new Map();let p=0,memoNext=0;
  // the last pushed values, for STACK_GLOBAL; only memo bookkeeping may sit between them and the opcode
  let recent=[];const push=v=>{recent.push(v);if(recent.length>2)recent.shift();};
  const need=n=>{if(p+n>buf.length)throw fail('檔案不完整（pickle 被截斷）。');};
  const line=()=>{const end=buf.indexOf(0x0a,p);if(end<0)throw fail('檔案不完整（pickle 被截斷）。');const s=buf.toString('latin1',p,end);p=end+1;return s;};
  const bytes=n=>{need(n);const s=buf.subarray(p,p+n);p+=n;return s;};
  const u=n=>{need(n);const v=n===1?buf[p]:n===2?buf.readUInt16LE(p):n===4?buf.readUInt32LE(p):Number(buf.readBigUInt64LE(p));p+=n;return v;};
  while(p<buf.length){
    const op=buf[p++];const c=String.fromCharCode(op);
    switch(c){
      case '.':return [...out];
      case 'c':case 'i':{const mod=line(),name=line();out.add(`${mod}.${name}`);push(null);break;}
      case '\x93':{if(recent.length<2||typeof recent[0]!=='string'||typeof recent[1]!=='string')throw fail('檔案用了無法檢查的寫法（STACK_GLOBAL）。');out.add(`${recent[0]}.${recent[1]}`);recent=[];push(null);break;}
      case '\x94':memo.set(memoNext++,recent.at(-1));break;
      case 'q':memo.set(u(1),recent.at(-1));break;
      case 'r':memo.set(u(4),recent.at(-1));break;
      case 'p':memo.set(Number(line()),recent.at(-1));break;
      case 'h':push(memo.get(u(1))??null);break;
      case 'j':push(memo.get(u(4))??null);break;
      case 'g':push(memo.get(Number(line()))??null);break;
      case '\x8c':push(bytes(u(1)).toString('utf8'));break;
      case 'X':push(bytes(u(4)).toString('utf8'));break;
      case '\x8d':push(bytes(u(8)).toString('utf8'));break;
      case 'V':push(line());break;
      case 'U':push(bytes(u(1)).toString('latin1'));break;
      case 'T':push(bytes(u(4)).toString('latin1'));break;
      case 'S':push(line());break;
      case 'C':bytes(u(1));push(null);break;
      case 'B':bytes(u(4));push(null);break;
      case '\x8e':case '\x96':bytes(u(8));push(null);break;
      case '\x8a':bytes(u(1));push(null);break;
      case '\x8b':bytes(u(4));push(null);break;
      case 'K':u(1);push(null);break;
      case 'M':u(2);push(null);break;
      case 'J':u(4);push(null);break;
      case 'G':bytes(8);push(null);break;
      case 'I':case 'L':case 'F':line();push(null);break;
      case 'P':line();push(null);break;
      case '\x80':u(1);break;
      case '\x95':u(8);break;
      case '\x82':case '\x83':case '\x84':throw fail('檔案用了 pickle 擴充碼，無法確認安全。');
      // no-argument opcodes
      case '(':case 'N':case ']':case '}':case ')':case '\x88':case '\x89':case '\x8f':case '2':case 'l':case 't':case 'd':case '\x85':case '\x86':case '\x87':
      case 'R':case 'b':case 'a':case 'e':case 's':case 'u':case '0':case '1':case '\x81':case '\x92':case 'Q':case 'o':case '\x90':case '\x91':case '\x97':case '\x98':
        push(null);break;
      default:throw fail(`檔案裡有看不懂的 pickle 指令（0x${op.toString(16)}）。`);
    }
  }
  throw fail('檔案不完整（pickle 沒有結尾）。');
}

// Reads the zip's central directory from the end of the file (no need to load a 900 MB checkpoint), then data.pkl.
function readZipEntry(file,match){
  const fd=fs.openSync(file,'r');
  try{
    const size=fs.fstatSync(fd).size,tailSize=Math.min(size,66000),tail=Buffer.alloc(tailSize);fs.readSync(fd,tail,0,tailSize,size-tailSize);
    let end=-1;for(let i=tailSize-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){end=i;break;}
    if(end<0)throw fail('不是 PyTorch 模型檔（找不到 zip 目錄）。');
    let count=tail.readUInt16LE(end+10),cdSize=tail.readUInt32LE(end+12),cdOffset=tail.readUInt32LE(end+16);
    // ZIP64 (PyTorch writes it for large files): the real numbers are in the ZIP64 end record
    if(cdOffset===0xffffffff||count===0xffff){
      const loc=end-20;if(loc<0||tail.readUInt32LE(loc)!==0x07064b50)throw fail('模型檔的 zip 目錄損壞。');
      const recAt=Number(tail.readBigUInt64LE(loc+8)),rec=Buffer.alloc(56);fs.readSync(fd,rec,0,56,recAt);
      if(rec.readUInt32LE(0)!==0x06064b50)throw fail('模型檔的 zip 目錄損壞。');
      count=Number(rec.readBigUInt64LE(32));cdSize=Number(rec.readBigUInt64LE(40));cdOffset=Number(rec.readBigUInt64LE(48));
    }
    if(cdSize>64e6||cdOffset+cdSize>size)throw fail('模型檔的 zip 目錄損壞。');
    const cd=Buffer.alloc(cdSize);fs.readSync(fd,cd,0,cdSize,cdOffset);
    const names=[];let p=0,found=null;
    for(let n=0;n<count&&p+46<=cd.length;n++){
      if(cd.readUInt32LE(p)!==0x02014b50)throw fail('模型檔的 zip 目錄損壞。');
      const method=cd.readUInt16LE(p+10),csize=cd.readUInt32LE(p+20),nl=cd.readUInt16LE(p+28),el=cd.readUInt16LE(p+30),cl=cd.readUInt16LE(p+32);let local=cd.readUInt32LE(p+42);
      const name=cd.toString('utf8',p+46,p+46+nl);
      if(local===0xffffffff){const extra=cd.subarray(p+46+nl,p+46+nl+el);for(let e=0;e+4<=extra.length;){const id=extra.readUInt16LE(e),len=extra.readUInt16LE(e+2);if(id===1){const vals=[];for(let k=e+4;k+8<=e+4+len;k+=8)vals.push(Number(extra.readBigUInt64LE(k)));local=vals.at(-1);}e+=4+len;}}
      names.push(name);if(!found&&match(name))found={name,method,csize,local};
      p+=46+nl+el+cl;
    }
    if(!found)return {names,data:null};
    if(found.method!==0)throw fail('模型檔的 data.pkl 被壓縮了，這不是 PyTorch 存的格式。');
    if(found.csize>256e6)throw fail('模型檔的 pickle 太大。');
    const head=Buffer.alloc(30);fs.readSync(fd,head,0,30,found.local);
    const start=found.local+30+head.readUInt16LE(26)+head.readUInt16LE(28),data=Buffer.alloc(found.csize);fs.readSync(fd,data,0,found.csize,start);
    return {names,data};
  }finally{fs.closeSync(fd);}
}

// {ok:true, globals, header} for a checkpoint whose pickle only names allowed things; throws otherwise.
// header is the first two bytes: 'PK' (plain zip) or GPT-SoVITS's version marker ('05' = v2Pro, '06' = v2ProPlus …).
function scanCheckpoint(file){
  const fd=fs.openSync(file,'r'),head=Buffer.alloc(4);fs.readSync(fd,head,0,4,0);fs.closeSync(fd);
  const marker=head.toString('latin1',0,2);
  if(!(marker==='PK'||/^0[0-6]$/.test(marker))||head[2]!==0x03||head[3]!==0x04)throw fail('不是 PyTorch 模型檔（舊格式或其他檔案）。只接受 zip 格式的 .ckpt / .pth。');
  const {data,names}=readZipEntry(file,name=>/(^|\/)data\.pkl$/.test(name));
  if(!data)throw fail('模型檔裡沒有 data.pkl。');
  if(names.some(n=>/\.pkl$/.test(n)&&!/(^|\/)data\.pkl$/.test(n)))throw fail('模型檔裡有額外的 pickle，無法確認安全。');
  const globals=pickleGlobals(data),bad=globals.filter(g=>!ALLOWED.has(g));
  if(bad.length)throw fail(`模型檔要求執行不明的程式（${bad.slice(0,3).join(', ')}），為了安全沒有匯入。`);
  return {ok:true,globals,header:marker};
}
module.exports={pickleGlobals,scanCheckpoint,readZipEntry,ALLOWED};
