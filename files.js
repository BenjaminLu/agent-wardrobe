const $=id=>document.getElementById(id);let sequence=0,english=false;
function failure(error){$('notice').textContent=error.message;}
function button(label,action,className){const node=document.createElement('button');node.textContent=label;node.className=className||'';node.onclick=()=>Promise.resolve().then(action).catch(failure);return node;}
async function refresh(){
  const request=++sequence;try{
    const data=await window.wardrobeFiles.list($('search').value);if(request!==sequence)return;
    english=!data.language.startsWith('zh');document.documentElement.lang=data.language;
    $('title').textContent=english?'Character files':'角色文件';$('description').textContent=english?'Your saved reports and tables, in one place.':'整理好的報告與表格，都在這裡。';$('search-label').textContent=english?'Search tasks or filenames':'搜尋任務或檔名';$('search').placeholder=english?'Fridge, comparison, CSV…':'冰箱、比較表、CSV…';$('open-root').textContent=english?'Open Desktop folder':'開啟桌面資料夾';$('location').textContent=data.root;$('notice').textContent='';$('results').replaceChildren();
    for(const task of data.items){const card=document.createElement('section');card.className='task';const head=document.createElement('div');head.className='task-head';const info=document.createElement('div');const title=document.createElement('h2');title.textContent=task.title;const date=document.createElement('time');date.dateTime=task.updatedAt;date.textContent=new Date(task.updatedAt).toLocaleString(data.language);info.append(title,date);head.append(info,button(english?'Open folder':'開啟資料夾',()=>window.wardrobeFiles.openFolder(task.id),'folder'));card.append(head);
      for(const name of task.files){const row=document.createElement('div');row.className='file';row.append(button(name,()=>window.wardrobeFiles.openFile({id:task.id,name}),'file-name'),button(english?'Show in Finder':'在 Finder 顯示',()=>window.wardrobeFiles.reveal({id:task.id,name})));card.append(row);} $('results').append(card);
    }
    if(!data.items.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=$('search').value?(english?'No matching files.':'沒有符合的文件。'):(english?'Ask your character to organize information or save a report.':'請角色整理資料或儲存報告，完成的文件就會出現在這裡。');$('results').append(empty);}
  }catch(error){if(request===sequence)failure(error);}
}
$('search').oninput=refresh;$('open-root').onclick=()=>window.wardrobeFiles.openRoot().catch(failure);window.wardrobeFiles.onRefresh(()=>{refresh();$('search').focus();});window.addEventListener('focus',refresh);document.addEventListener('keydown',event=>{if(event.key==='Escape')window.wardrobeFiles.close();if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();$('search').focus();$('search').select();}});refresh();
