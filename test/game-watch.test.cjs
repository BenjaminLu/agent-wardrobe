const test=require('node:test');const assert=require('node:assert/strict');
const {spoilerFree,watchPrompt,changed,wikiLookup}=require('../src/main/game-watch.cjs');
const ARTICLE=`《空洞騎士》是一款銀河惡魔城類型的動作冒險遊戲。
== 遊戲玩法 ==
玩家操控小騎士探索地下王國，以骨釘攻擊敵人，收集吉歐購買道具。
=== 護符 ===
護符可以改變能力。
== 劇情 ==
騎士最後發現自己其實是……
=== 結局 ===
真結局需要……
== 開發 ==
由 Team Cherry 開發。
== 參考資料 ==
[1] 某網站`;
test('the game brief keeps the summary and gameplay but never the story',()=>{
  const brief=spoilerFree(ARTICLE);
  assert.match(brief,/銀河惡魔城/);assert.match(brief,/【遊戲玩法】.*骨釘/);assert.match(brief,/【護符】/);assert.match(brief,/Team Cherry/);
  assert.doesNotMatch(brief,/其實是|真結局|劇情|結局|某網站/);
  assert.doesNotMatch(spoilerFree('Intro.\n== Plot ==\nThe hero dies.\n=== Ending ===\nTwist.\n== Gameplay ==\nJump.'),/hero dies|Twist/);
});
test('the watch prompt carries the spoiler rules, progress and recent lines',()=>{
  const prompt=watchPrompt({persona:'You are Annie.',game:'空洞騎士',brief:'探索地下王國',progress:['德特茅斯','遺忘十字路'],recent:['這隻蟲好可愛'],language:'Traditional Chinese'});
  assert.match(prompt,/never mention story events.*not appeared on screen/);assert.match(prompt,/德特茅斯 → 遺忘十字路/);assert.match(prompt,/這隻蟲好可愛/);assert.match(prompt,/"speak": true\|false/);
});
test('unchanged screens are skipped',()=>{const a=new Uint8Array(576).fill(100),b=a.slice();assert.equal(changed(a,b),false);b.fill(140);assert.equal(changed(a,b),true);assert.equal(changed(null,a),true);});
test('lookup tries Chinese, then English, and filters the article',async()=>{
  const calls=[];const fetchImpl=async url=>{calls.push(url);const u=new URL(url),lang=u.hostname.split('.')[0];
    if(u.searchParams.get('action')==='opensearch')return {json:async()=>lang==='zh'?['x',[]]:['x',['Hollow Knight']]};
    return {json:async()=>({query:{pages:{1:{title:'Hollow Knight',extract:'A game.\n== Plot ==\nSecret.\n== Gameplay ==\nExplore.'}}}})};};
  const found=await wikiLookup('Hollow Knight',{fetchImpl});
  assert.equal(found.lang,'en');assert.match(found.brief,/Explore/);assert.doesNotMatch(found.brief,/Secret/);assert.ok(calls[0].includes('zh.wikipedia.org'));
});
test('a near-repeat of a recent line is not spoken again',()=>{
  const {similar}=require('../src/main/game-watch.cjs');
  assert.equal(similar('哇！皮卡丘兩邊都是零分！這算是一場精彩的對戰開始吧','哇！皮卡丘兩邊都是零分！這算是一場精彩的對戰開始吧，加油！'),true);
  assert.equal(similar('這球殺得漂亮！','電腦又在網前偷吃一分'),false);
});
test('the reply language is named, not coded',()=>{
  const {languageName}=require('../src/main/game-watch.cjs');
  assert.match(languageName({replyLanguage:'zh-Hant'}),/Traditional Chinese/);assert.match(languageName({replyLanguage:'auto',language:'zh-TW'}),/Traditional Chinese/);
  assert.match(languageName({replyLanguage:'auto',language:'ja-JP'}),/Japanese/);assert.equal(languageName({replyLanguage:'auto',language:'en-US'}),'English');
});
