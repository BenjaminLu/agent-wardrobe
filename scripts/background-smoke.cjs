const assert=require('node:assert/strict');const {app}=require('electron');
// Closing the companion hides it; the app keeps running and comes back from the Dock (activate) or the menu bar.
async function run({win}){
  const js=code=>win.webContents.executeJavaScript(code);
  win.show();await new Promise(r=>setTimeout(r,500));
  await js(`document.querySelector('#close').click();true`);await new Promise(r=>setTimeout(r,500));
  assert.equal(win.isDestroyed(),false,'window still exists');assert.equal(win.isVisible(),false,'closed to the background');
  win.close();await new Promise(r=>setTimeout(r,300));
  assert.equal(win.isDestroyed(),false,'⌘W / close also only hides');
  assert.equal(await js(`document.body.dataset.ready`),'true','renderer keeps running while hidden');
  app.emit('activate');await new Promise(r=>setTimeout(r,300));
  assert.equal(win.isVisible(),true,'Dock click brings it back');
  console.log('BACKGROUND_SMOKE',JSON.stringify({closeHides:true,windowCloseHides:true,keepsRunning:true,dockRestores:true}));
}
module.exports={run};
