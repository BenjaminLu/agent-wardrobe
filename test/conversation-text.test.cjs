const test=require('node:test');const assert=require('node:assert/strict');const {conversationText}=require('../conversation-text.cjs');
test('avatar hides standalone tool transport but keeps human progress and technical mentions in prose',()=>{
  for(const text of ['Running: mcp___claude-in-chrome__javascript_tool','chrom_javascript_tool, Running: mcp___claude-in-crhome__javascript_tool','browser_read','正在執行：computer_click'])assert.equal(conversationText(text),'');
  const prose='「日系冰箱」這關鍵字在三家都只撈到收納小物，我改用品牌＋型號去搜，順便抓尺寸。';
  assert.equal(conversationText(prose),prose);assert.equal(conversationText('Running: browser_read\n'+prose),prose);
  assert.equal(conversationText('The browser_read operation found no matching products.'),'The browser_read operation found no matching products.');
});
