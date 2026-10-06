const $=id=>document.getElementById(id);let sequence=0;
function failure(error){$('notice').textContent=error.message;}
// interface buttons inside #results (translate="no": task titles and file names are the user's) opt back in with translate=true
function button(label,action,className,ui){const node=document.createElement('button');node.textContent=label;node.className=className||'';if(ui)node.translate=true;node.onclick=()=>Promise.resolve().then(action).catch(failure);return node;}
async function refresh(){
  const request=++sequence;try{
    const data=await window.wardrobeFiles.list($('search').value);if(request!==sequence)return;
    $('location').textContent=data.root;$('notice').textContent='';$('results').replaceChildren();
    for(const task of data.items){const card=document.createElement('section');card.className='task';const head=document.createElement('div');head.className='task-head';const info=document.createElement('div');const title=document.createElement('h2');title.textContent=task.title;const date=document.createElement('time');date.dateTime=task.updatedAt;date.textContent=new Date(task.updatedAt).toLocaleString(i18n.lang);info.append(title,date);head.append(info,button(t('files.openFolder'),()=>window.wardrobeFiles.openFolder(task.id),'folder',true));card.append(head);
      for(const name of task.files){const row=document.createElement('div');row.className='file';row.append(button(name,()=>window.wardrobeFiles.openFile({id:task.id,name}),'file-name'),button(t('files.reveal'),()=>window.wardrobeFiles.reveal({id:task.id,name}),'',true));card.append(row);} $('results').append(card);
    }
    if(!data.items.length){const empty=document.createElement('div');empty.className='empty';empty.translate=true;empty.textContent=$('search').value?t('files.noMatch'):t('files.empty');$('results').append(empty);}
  }catch(error){if(request===sequence)failure(error);}
}
$('search').oninput=refresh;$('open-root').onclick=()=>window.wardrobeFiles.openRoot().catch(failure);window.wardrobeFiles.onRefresh(()=>{refresh();$('search').focus();});window.addEventListener('focus',refresh);i18n.onChange(refresh);document.addEventListener('keydown',event=>{if(event.key==='Escape')window.wardrobeFiles.close();if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();$('search').focus();$('search').select();}});refresh();
