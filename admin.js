
(()=>{'use strict';

const $=id=>document.getElementById(id);
const cfg=window.KRAVN_CONFIG||{};
const status=t=>{$('status').textContent=t;};

if(!window.supabase||!cfg.supabaseUrl||!cfg.supabaseAnonKey){
  status('Помилка підключення: перевірте config.js та Supabase SDK.');
  return;
}

const db=window.supabase.createClient(
  cfg.supabaseUrl,
  cfg.supabaseAnonKey
);

const ADMIN_ID='5e12e252-c26b-4438-86bc-834a845aa851';
let records=[],busy=false;

const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c]));

const errText=e=>e?.message||String(e);

async function refresh(){
  const {data,error}=await db.from('works')
    .select('*')
    .order('is_pinned',{ascending:false})
    .order('sort_order',{ascending:true});

  if(error)throw error;

  records=data||[];

  $('items').innerHTML=records.map(w=>`
    <article class="work">
      <img src="${safe(w.cover_url||w.media_url)}"
           alt="" loading="lazy">
      <h3>${safe(w.title)}</h3>
      <p class="muted">
        ${safe(w.category)} ·
        ${w.is_visible?'Опубліковано':'Приховано'}
        ${w.is_pinned?'· Закріплено':''}
      </p>
      <div class="actions">
        <button data-action="edit" data-id="${w.id}">
          Редагувати
        </button>
        <button data-action="up" data-id="${w.id}">↑</button>
        <button data-action="down" data-id="${w.id}">↓</button>
        <button data-action="pin" data-id="${w.id}">
          ${w.is_pinned?'Відкріпити':'Закріпити'}
        </button>
        <button data-action="hide" data-id="${w.id}">
          ${w.is_visible?'Приховати':'Показати'}
        </button>
        <button class="danger" data-action="delete" data-id="${w.id}">
          Видалити
        </button>
      </div>
    </article>
  `).join('')||'<p>Поки немає робіт.</p>';
}

function reset(){
  $('workForm').reset();
  $('editId').value='';
  $('formHeading').textContent='Додати роботу';
  $('visible').checked=true;
}

$('reset').onclick=reset;

async function upload(file,folder){
  const ext=(file.name.split('.').pop()||'bin').toLowerCase();
  const path=`${folder}/${crypto.randomUUID()}.${ext}`;

  const {error}=await db.storage.from('portfolio')
    .upload(path,file,{
      contentType:file.type||'application/octet-stream',
      upsert:false
    });

  if(error){
    throw new Error(`Завантаження ${folder}: ${error.message}`);
  }

  return {
    path,
    url:db.storage.from('portfolio').getPublicUrl(path).data.publicUrl
  };
}

async function thumbnail(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const v=document.createElement('video');
    let done=false;

    const finish=(error,blob)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      v.pause();
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);

      if(error)reject(error);
      else resolve(new File([blob],'cover.jpg',{
        type:'image/jpeg'
      }));
    };

    const timer=setTimeout(
      ()=>finish(new Error('Час створення обкладинки вичерпано')),
      10000
    );

    v.muted=true;
    v.playsInline=true;
    v.preload='auto';

    v.onloadeddata=()=>{
      try{
        if(v.duration&&Number.isFinite(v.duration)&&v.duration>0.5){
          v.currentTime=Math.min(0.5,v.duration/2);
        }else{
          render();
        }
      }catch(e){
        finish(e);
      }
    };

    v.onseeked=render;

    v.onerror=()=>finish(
      new Error('Браузер не зміг прочитати відео')
    );

    function render(){
      if(done)return;

      try{
        if(!v.videoWidth||!v.videoHeight){
          throw Error('Немає кадру відео');
        }

        const c=document.createElement('canvas');
        const scale=Math.min(1,960/v.videoWidth);

        c.width=Math.round(v.videoWidth*scale);
        c.height=Math.round(v.videoHeight*scale);

        c.getContext('2d').drawImage(
          v,0,0,c.width,c.height
        );

        c.toBlob(
          blob=>blob
            ?finish(null,blob)
            :finish(new Error('Не вдалося створити JPG')),
          'image/jpeg',
          0.84
        );
      }catch(e){
        finish(e);
      }
    }

    v.src=url;
    v.load();
  });
}

$('workForm').onsubmit=async e=>{
  e.preventDefault();
  if(busy)return;

  busy=true;
  const btn=$('save');
  btn.disabled=true;
  const uploadedPaths=[];

  try{
    const id=$('editId').value;
    const old=records.find(w=>w.id===id);
    const file=$('media').files[0];
    const cover=$('cover').files[0];

    if(!id&&!file)throw Error('Оберіть медіафайл');
    if(id&&!old)throw Error('Роботу не знайдено. Оновіть сторінку.');

    const title=$('title').value.trim();
    if(!title)throw Error('Введіть назву роботи');

    const type=file
      ?(file.type.startsWith('video/')?'video':
        file.type.startsWith('image/')?'image':null)
      :(old?.media_type||null);

    if(!type)throw Error('Непідтримуваний тип файлу');

    if(file&&file.size>50*1024*1024){
      throw Error('Файл перевищує 50 МБ — ліміт одного файлу на Supabase Free. Стисніть відео.');
    }

    if(cover&&cover.size>50*1024*1024){
      throw Error('Обкладинка перевищує 50 МБ');
    }

    let mediaUrl=old?.media_url||'';
    let mediaPath=old?.media_path||null;
    let coverUrl=old?.cover_url||'';
    let coverPath=old?.cover_path||null;

    if(file){
      status('Завантаження медіафайлу…');
      const u=await upload(file,'media');
      uploadedPaths.push(u.path);
      mediaUrl=u.url;
      mediaPath=u.path;
    }

    let selectedCover=cover||null;

    if(!selectedCover&&file&&type==='video'){
      status('Створення обкладинки…');

      try{
        selectedCover=await thumbnail(file);
      }catch(err){
        status('Не вдалося створити обкладинку автоматично. Роботу буде збережено без неї.');
      }
    }

    if(selectedCover){
      status('Завантаження обкладинки…');
      const u=await upload(selectedCover,'covers');
      uploadedPaths.push(u.path);
      coverUrl=u.url;
      coverPath=u.path;
    }else if(file){
      coverUrl=type==='image'?mediaUrl:'';
      coverPath=null;
    }

    status('Збереження в базі даних…');

    const payload={
      title,
      description:$('description').value.trim(),
      category:$('category').value,
      media_type:type,
      media_url:mediaUrl,
      media_path:mediaPath,
      cover_url:coverUrl||null,
      cover_path:coverPath,
      is_pinned:$('pinned').checked,
      is_visible:$('visible').checked
    };

    if(!id)payload.sort_order=records.length;

    const {error}=await (
      id
        ?db.from('works').update(payload).eq('id',id).select('id')
        :db.from('works').insert(payload).select('id')
    );

    if(error)throw error;

    if(old){
      const stale=[
        old.media_path!==mediaPath?old.media_path:null,
        old.cover_path!==coverPath?old.cover_path:null
      ].filter(Boolean);

      if(stale.length){
        const r=await db.storage.from('portfolio').remove(stale);
        if(r.error)console.warn(
          'Old media cleanup:',r.error.message
        );
      }
    }

    reset();
    await refresh();

    status('Збережено! Робота доступна на сайті (якщо увімкнено показ).');

  }catch(err){
    console.error('KRAVN save error:',err);
    status('Помилка: '+errText(err));

    if(uploadedPaths.length){
      const r=await db.storage.from('portfolio')
        .remove(uploadedPaths);

      if(r.error)console.warn(
        'Upload cleanup:',r.error.message
      );
    }
  }finally{
    busy=false;
    btn.disabled=false;
  }
};

$('items').onclick=async e=>{
  const btn=e.target.closest('button[data-action]');
  if(!btn||busy)return;

  const id=btn.dataset.id;
  const w=records.find(x=>x.id===id);
  const action=btn.dataset.action;

  if(!w)return;

  if(action==='edit'){
    $('editId').value=w.id;
    $('title').value=w.title;
    $('description').value=w.description||'';
    $('category').value=w.category;
    $('pinned').checked=w.is_pinned;
    $('visible').checked=w.is_visible;
    $('formHeading').textContent='Редагувати роботу';
    window.scrollTo({top:0,behavior:'smooth'});
    return;
  }

  busy=true;
  btn.disabled=true;

  try{
    let error;

    if(action==='delete'){
      if(!confirm('Назавжди видалити роботу та її файли?')){
        return;
      }

      ({error}=await db.from('works')
        .delete().eq('id',id).select('id'));

      if(error)throw error;

      const paths=[w.media_path,w.cover_path].filter(Boolean);

      if(paths.length){
        const r=await db.storage.from('portfolio').remove(paths);

        if(r.error){
          status('Запис видалено, але файли потребують очищення: '+r.error.message);
        }
      }

    }else if(action==='up'||action==='down'){
      const sorted=[...records];
      const i=sorted.findIndex(x=>x.id===id);
      const j=i+(action==='up'?-1:1);

      if(j<0||j>=sorted.length)return;

      [sorted[i],sorted[j]]=[sorted[j],sorted[i]];

      for(let k=0;k<sorted.length;k++){
        const r=await db.from('works')
          .update({sort_order:k})
          .eq('id',sorted[k].id)
          .select('id');

        if(r.error)throw r.error;
      }

    }else{
      ({error}=await db.from('works')
        .update(
          action==='pin'
            ?{is_pinned:!w.is_pinned}
            :{is_visible:!w.is_visible}
        )
        .eq('id',id)
        .select('id'));

      if(error)throw error;
    }

    await refresh();

    if(action!=='delete')status('Зміни збережено.');

  }catch(err){
    console.error(err);
    status('Помилка: '+errText(err));
  }finally{
    busy=false;
    btn.disabled=false;
  }
};

$('loginForm').onsubmit=async e=>{
  e.preventDefault();
  status('Перевірка…');

  const {error}=await db.auth.signInWithPassword({
    email:$('email').value,
    password:$('password').value
  });

  status(error?'Помилка входу: '+error.message:'');
};

$('logout').onclick=async()=>{
  const {error}=await db.auth.signOut();
  if(error)status(error.message);
};

async function check(session){
  if(!session){
    $('login').classList.remove('hidden');
    $('dashboard').classList.add('hidden');
    $('logout').classList.add('hidden');
    return;
  }

  if(session.user.id!==ADMIN_ID){
    status('Цей обліковий запис не має доступу адміністратора.');
    await db.auth.signOut();
    return;
  }

  $('login').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
  $('logout').classList.remove('hidden');

  try{
    await refresh();
  }catch(err){
    status('Помилка завантаження робіт: '+errText(err));
  }
}

db.auth.getSession().then(({data,error})=>
  error?status(error.message):check(data.session)
);

db.auth.onAuthStateChange((_event,session)=>{
  setTimeout(()=>check(session),0);
});

})();
