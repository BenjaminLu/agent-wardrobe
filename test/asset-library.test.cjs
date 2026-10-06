const test=require('node:test');const assert=require('node:assert/strict');
require('../locales.cjs').setLanguage('zh-Hant');
const {createLibrary,license,translate,vroidLicense}=require('../asset-library.cjs');const {fetchFixture}=require('./fixtures/library/make.cjs');
test('only licences that allow reuse and changes are accepted, with credit noted',()=>{
  assert.deepEqual(license('CC0'),{id:'cc0',label:'CC0',commercial:true,credit:false,shareAlike:false,tier:'open'});
  assert.equal(license('Public domain').id,'cc0');assert.equal(license('CC BY 4.0').credit,true);assert.equal(license('CC-BY-SA 3.0').shareAlike,true);assert.equal(license('OGA-BY 3.0').id,'oga-by');
  for(const bad of ['CC BY-NC 4.0','CC-BY-ND 4.0','CC BY-NC-SA 3.0','GPL 3.0','All rights reserved','',null])assert.equal(license(bad),null,bad);
});
const accounts={vroid:{token:async()=>'fixture-token'},sketchfab:{token:()=>'f'.repeat(32)}};
test('the store opens with featured characters and VRoid Hub staff picks, each with its terms',async()=>{
  const lib=createLibrary({fetchImpl:fetchFixture(),accounts});
  const {items,needs}=await lib.search('',['featured','vroid','vrm','booru']);assert.deepEqual(needs,[]);
  assert.ok(items.some(i=>i.title.includes('Shino')&&i.license.label==='CC0'&&i.license.tier==='open'));
  assert.ok(items.some(i=>i.kind==='assisted'&&/Unity-chan/.test(i.title)&&i.license.tier==='rules'));
  assert.ok(items.some(i=>i.source==='VRoid Hub'&&i.title==='Staff Pick Girl'));
  assert.ok(!items.some(i=>i.source==='Open Source Avatars'||i.source==='Safebooru'),'keyword-only libraries wait for a search');
  const shino=items.find(i=>i.title.includes('Shino'));const {data,credit}=await lib.download(shino.key);assert.equal(data.subarray(0,4).toString(),'glTF');assert.match(credit,/\(CC0\)/);
  await assert.rejects(lib.download(items.find(i=>i.kind==='assisted').key),/AI 輔助下載/);
});
test('VRoid Hub lists only models other apps may use, with the author\'s conditions, and downloads through a licence',async()=>{
  const lib=createLibrary({fetchImpl:fetchFixture(),accounts});
  const {items}=await lib.search('miko',['vroid']);assert.deepEqual(items.map(i=>i.title),['Shrine Miko']);
  assert.equal(items[0].license.label,'VRoid 條件：個人營利可・可改造・需標註');assert.equal(items[0].license.tier,'rules');
  assert.match(await lib.thumbnail(items[0].key),/^data:image\/png;base64,/);
  const {data}=await lib.download(items[0].key);assert.equal(data.subarray(0,4).toString(),'glTF');
  const signedOut=createLibrary({fetchImpl:fetchFixture()});assert.deepEqual(await signedOut.search('miko',['vroid','featured']),{items:[],needs:['VROID_LOGIN']});
});
test('Sketchfab keeps open licences only and needs the user\'s token to download; Safebooru pictures are reference-only',async()=>{
  const lib=createLibrary({fetchImpl:fetchFixture(),accounts});
  const sf=(await lib.search('貓耳',['sketchfab'])).items;assert.deepEqual(sf.map(i=>[i.title,i.license.label,i.kind]),[['Anime Knight Girl','CC BY 4.0','glb']]);
  const {data,credit}=await lib.download(sf[0].key);assert.equal(data.subarray(0,4).toString(),'glTF');assert.match(credit,/by Low Poly Lab \(CC BY 4\.0\)/);
  const noToken=createLibrary({fetchImpl:fetchFixture()});const [again]=(await noToken.search('knight',['sketchfab'])).items;await assert.rejects(noToken.download(again.key),/Sketchfab API token/);
  const booru=(await lib.search('貓耳',['booru'])).items;assert.equal(booru.length,1,'questionable ratings are dropped');
  assert.equal(booru[0].kind,'image');assert.equal(booru[0].license.tier,'personal');assert.equal(booru[0].title,'animal ears cat ears smile');
});
test('Chinese words become the tags the libraries use',()=>{
  assert.deepEqual(translate('貓耳 女僕'),['cat_ears','maid']);assert.deepEqual(translate('魔法少女 vtuber'),['magical_girl','vtuber']);
  assert.equal(vroidLicense({}).label,'VRoid 條件：個人非商用・不可改造');
});
test('downloads happen only by result key and only from the library hosts',async()=>{
  const seen=[];const lib=createLibrary({fetchImpl:fetchFixture(seen)});
  await assert.rejects(lib.download('http://evil.example/x.vrm'),/找不到/);
  lib.results.set('bad',{kind:'image',title:'x',license:license('CC0'),download:'http://127.0.0.1:22/secret'});await assert.rejects(lib.download('bad'),/不允許/);
  assert.ok(seen.every(url=>url.startsWith('https://')));
});
test('a rate-limited IPFS gateway is retried on the next one, and big previews are shrunk',async()=>{
  const base=fetchFixture(),seen=[];
  const fetchImpl=async url=>{seen.push(url);if(/^https:\/\/(dweb\.link|ipfs\.io)\/ipfs\/elf\.png/.test(url))return {ok:false,status:429,arrayBuffer:async()=>new ArrayBuffer(0)};return base(url.replace('https://gateway.pinata.cloud','https://dweb.link').replace(/^https:\/\/dweb\.link\/ipfs\/elf\.png$/,'https://dweb.link/ipfs/elf.png'));};
  const lib=createLibrary({fetchImpl:async url=>url==='https://gateway.pinata.cloud/ipfs/elf.png'?base('https://dweb.link/ipfs/elf.png'):fetchImpl(url),shrink:()=>Buffer.from('small')});
  const [elf]=(await lib.search('elf',['vrm'])).items;
  assert.equal(await lib.thumbnail(elf.key),`data:image/png;base64,${Buffer.from('small').toString('base64')}`);
  assert.deepEqual(seen.filter(u=>u.includes('elf.png')),['https://dweb.link/ipfs/elf.png','https://ipfs.io/ipfs/elf.png'],'tried the busy gateways first, then the next');
  assert.equal(await lib.thumbnail(elf.key),`data:image/png;base64,${Buffer.from('small').toString('base64')}`,'cached for the session');
  assert.equal(seen.filter(u=>u.includes('elf.png')).length,2);
});
test('bundled store thumbnails are only the CC0 VRoid samples; the others show their preview after download',async()=>{
  const fs=require('node:fs');const path=require('node:path');const {FEATURED}=require('../asset-library.cjs');
  const dir=path.join(__dirname,'..','library-thumbs');const local=FEATURED.filter(i=>i.thumb?.startsWith('local:'));
  assert.ok(local.length&&local.every(i=>i.license.label==='CC0'),'only CC0 entries carry a bundled thumbnail');
  assert.deepEqual(fs.readdirSync(dir).filter(f=>f!=='README.md').sort(),local.map(i=>`${i.thumb.slice(6)}.png`).sort(),'library-thumbs/ holds exactly those');
  const readme=fs.readFileSync(path.join(dir,'README.md'),'utf8');for(const i of local)assert.ok(readme.includes(`${i.thumb.slice(6)}.png`),`README lists ${i.thumb}`);
  const lib=createLibrary({fetchImpl:fetchFixture(),accounts});const {items}=await lib.search('',['featured']);
  for(const title of ['AvatarSample A','Seed-san']){const item=items.find(i=>i.title===title);assert.equal(item.previewAfterDownload,true,title);assert.equal(await lib.thumbnail(item.key),null);}
  assert.ok(!items.find(i=>i.title.includes('Shino')).previewAfterDownload);
});
