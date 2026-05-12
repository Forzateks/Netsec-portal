// == KNOWLEDGE BASE MODULE ==========================================

var _kbData = [];
var _kbViewId = null;

async function refreshKBViews() {
  await loadKBArticles();
  var mineTab = document.getElementById('kbtab-mine');
  if (mineTab && mineTab.style.display !== 'none') {
    await loadMyKBArticles();
  }
}

function showKBTab(tab) {
  ['browse','submit','mine'].forEach(function(t) {
    var el  = document.getElementById('kbtab-'+t);
    var sub = document.getElementById('kbsub-'+t);
    if (!el) return;
    el.style.display = t===tab ? 'block' : 'none';
    if (!sub) return;
    if (t===tab) { sub.classList.add('active'); sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid var(--teal);color:var(--navy);white-space:nowrap'; }
    else         { sub.classList.remove('active'); sub.style.cssText='padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);white-space:nowrap'; }
  });
  if (tab==='browse') loadKBArticles();
  if (tab==='submit') resetKBForm();
  if (tab==='mine')   loadMyKBArticles();
  setSidebarSubActive('kb', tab);
}

async function loadKBArticles() {
  var wrap = document.getElementById('kb-articles-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div>Loading articles...</div>';
  var {data,error} = await sb.from('kb_articles').select('*').order('created_at',{ascending:false});
  if (error) { wrap.innerHTML='<div class="alert alert-error show">Error: '+error.message+'</div>'; return; }
  _kbData = data || [];
  renderKBArticles(_kbData);
}

function applyKBFilters() {
  var search = (document.getElementById('kb-search').value||'').toLowerCase();
  var catF   = document.getElementById('kb-filter-cat').value;
  var filtered = _kbData.filter(function(a) {
    var matchSearch = !search ||
      (a.title||'').toLowerCase().includes(search) ||
      (a.content||'').toLowerCase().includes(search) ||
      (a.tags||'').toLowerCase().includes(search) ||
      (a.submitted_by||'').toLowerCase().includes(search);
    var matchCat = !catF || a.category===catF;
    return matchSearch && matchCat;
  });
  renderKBArticles(filtered);
}

function kbCatClass(cat) {
  var map={'Network':'kb-cat-Network','Security':'kb-cat-Security','Configuration':'kb-cat-Configuration','Troubleshooting':'kb-cat-Troubleshooting','General':'kb-cat-General'};
  return map[cat]||'kb-cat-General';
}

function renderKBArticles(data) {
  var wrap = document.getElementById('kb-articles-wrap');
  if (!data.length) {
    wrap.innerHTML = renderEmptyState({
      icon: 'book-open',
      heading: 'Knowledge base is empty',
      sub: 'Share configuration guides, troubleshooting steps, and lessons learned with the team.',
      btnText: 'Write the first article',
      btnOnclick: "navigateSub('kb','submit')"
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  var cards = data.map(function(a) {
    var tags = (a.tags||'').split(',').map(function(t){return t.trim();}).filter(Boolean);
    var tagHtml = tags.map(function(t){return '<span class="kb-tag">'+esc2(t)+'</span>';}).join('');
    var excerpt = (a.content||'').slice(0,180).trim() + ((a.content||'').length>180?'…':'');
    return '<div class="kb-card">'+
      '<div class="kb-card-meta">'+
      '<span class="badge '+kbCatClass(a.category)+'">'+esc2(a.category||'General')+'</span>'+
      '<span class="kb-author">by <strong>'+esc2(a.submitted_by)+'</strong> · '+fmtDate(a.created_at)+'</span>'+
      '</div>'+
      '<div class="kb-title">'+esc2(a.title)+'</div>'+
      '<div class="kb-excerpt">'+esc2(excerpt)+'</div>'+
      (tagHtml?'<div class="kb-tags">'+tagHtml+'</div>':'')+
      '<div style="display:flex;gap:8px;margin-top:4px">'+
      '<button class="btn btn-sm btn-primary" onclick="openKBArticle('+a.id+')">Read More</button>'+
      (a.file_url?'<a href="'+esc2(a.file_url)+'" target="_blank" class="btn btn-sm btn-ghost">🔍— Reference</a>':'')+
      '</div>'+
      '</div>';
  }).join('');
  wrap.innerHTML = '<div class="kb-grid">'+cards+'</div>';
}

function openKBArticle(id) {
  var a = _kbData.find(function(x){return x.id===id;});
  if (!a) return;
  _kbViewId = id;
  var tags = (a.tags||'').split(',').map(function(t){return t.trim();}).filter(Boolean);
  document.getElementById('kb-view-cat').innerHTML='<span class="badge '+kbCatClass(a.category)+'">'+esc2(a.category||'General')+'</span>';
  document.getElementById('kb-view-title').textContent=a.title;
  document.getElementById('kb-view-meta').innerHTML='Submitted by <strong>'+esc2(a.submitted_by)+'</strong> &nbsp;·&nbsp; '+fmtDate(a.created_at);
  document.getElementById('kb-view-tags').innerHTML=tags.map(function(t){return '<span class="kb-tag">'+esc2(t)+'</span>';}).join('');
  document.getElementById('kb-view-body').textContent=a.content;
  var urlEl=document.getElementById('kb-view-url');
  if (a.file_url){urlEl.style.display='block';document.getElementById('kb-view-url-link').href=a.file_url;}
  else{urlEl.style.display='none';}
  // show edit/delete for own articles or manager
  var editBtns=document.getElementById('kb-view-edit-btns');
  if (a.submitted_by===currentUser||isManager){
    editBtns.innerHTML='<button class="btn btn-ghost" onclick="openKBEditModal('+id+')">✏️ Edit</button>'+
      (isManager||a.submitted_by===currentUser?'<button class="btn btn-danger" onclick="deleteKBArticle('+id+')" style="margin-left:8px">🗑 Delete</button>':'');
  } else { editBtns.innerHTML=''; }
  document.getElementById('kb-view-modal').classList.add('show');
}

function closeKBModal() {
  document.getElementById('kb-view-modal').classList.remove('show');
  _kbViewId=null;
}

function resetKBForm() {
  ['kb-title','kb-category','kb-tags','kb-content','kb-url'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
}

async function submitKBArticle() {
  var title   = (document.getElementById('kb-title').value||'').trim();
  var category= document.getElementById('kb-category').value;
  var content = (document.getElementById('kb-content').value||'').trim();
  if (!title||!category||!content){alert('Title, Category and Content are required.');return;}
  var btn=document.getElementById('kb-submit-btn');
  btn.disabled=true; btn.textContent='⏳ Publishing...';
  var {error}=await sb.from('kb_articles').insert({
    title:title, category:category,
    tags:document.getElementById('kb-tags').value.trim(),
    content:content,
    file_url:document.getElementById('kb-url').value.trim()||null,
    submitted_by:currentUser
  });
  btn.disabled=false; btn.innerHTML='<i data-lucide="send" class="btn-icon"></i>Publish Article'; if (typeof renderIcons === 'function') renderIcons();
  if (error){alert('Error: '+error.message);return;}
  showAlert('kb-submit-success');
  resetKBForm();
  showKBTab('browse');
}

async function loadMyKBArticles() {
  var wrap=document.getElementById('kb-mine-wrap');
  wrap.innerHTML='<div class="loading"><div class="spinner"></div>Loading...</div>';
  var {data,error}=await sb.from('kb_articles').select('*').eq('submitted_by',currentUser).order('created_at',{ascending:false});
  if (error){wrap.innerHTML='<div class="alert alert-error show">Error: '+error.message+'</div>';return;}
  if (!data||!data.length){
    wrap.innerHTML = renderEmptyState({
      icon: 'file-text',
      heading: "You haven't written any articles",
      sub: "Share what you've learned. Configuration tricks, troubleshooting steps, customer-specific tips.",
      btnText: 'Write your first article',
      btnOnclick: "navigateSub('kb','submit')"
    });
    if (typeof renderIcons === 'function') renderIcons();
    return;
  }
  // Update _kbData so openKBArticle works from My Articles tab
  data.forEach(function(a){if(!_kbData.find(function(x){return x.id===a.id;}))_kbData.push(a);});
  var rows=data.map(function(a){
    return '<tr>'+
      '<td style="font-weight:600">'+esc2(a.title)+'</td>'+
      '<td><span class="badge '+kbCatClass(a.category)+'">'+esc2(a.category||'—')+'</span></td>'+
      '<td style="font-size:12px;color:var(--muted)">'+fmtDate(a.created_at)+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button class="btn btn-sm btn-ghost" onclick="openKBArticle('+a.id+')" style="margin-right:6px">👁 View</button>'+
        '<button class="btn btn-sm btn-ghost" onclick="openKBEditModal('+a.id+')" style="margin-right:6px">✏️ Edit</button>'+
        '<button class="btn btn-sm btn-danger" onclick="deleteKBArticle('+a.id+')">🗑</button>'+
      '</td>'+
    '</tr>';
  }).join('');
  wrap.innerHTML='<div class="table-wrap"><table><thead><tr><th>Title</th><th>Category</th><th>Date</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function openKBEditModal(id) {
  var a=_kbData.find(function(x){return x.id===id;});
  if (!a) return;
  if (a.submitted_by!==currentUser && !isManager){alert('You can only edit your own articles.');return;}
  document.getElementById('kb-edit-id').value=id;
  document.getElementById('kb-edit-title').value=a.title||'';
  document.getElementById('kb-edit-category').value=a.category||'';
  document.getElementById('kb-edit-tags').value=a.tags||'';
  document.getElementById('kb-edit-content').value=a.content||'';
  document.getElementById('kb-edit-url').value=a.file_url||'';
  closeKBModal();
  document.getElementById('kb-edit-modal').classList.add('show');
}

function closeKBEditModal() {
  document.getElementById('kb-edit-modal').classList.remove('show');
}

async function saveKBEdit() {
  var id=parseInt(document.getElementById('kb-edit-id').value);
  var title=(document.getElementById('kb-edit-title').value||'').trim();
  var content=(document.getElementById('kb-edit-content').value||'').trim();
  if (!title||!content){alert('Title and Content are required.');return;}
  var btn=document.getElementById('kb-edit-save-btn');
  btn.disabled=true; btn.textContent='⏳ Saving...';
  var {error}=await sb.from('kb_articles').update({
    title:title,
    category:document.getElementById('kb-edit-category').value,
    tags:document.getElementById('kb-edit-tags').value.trim(),
    content:content,
    file_url:document.getElementById('kb-edit-url').value.trim()||null,
    updated_at:new Date().toISOString()
  }).eq('id',id);
  btn.disabled=false; btn.innerHTML='<i data-lucide="save" class="btn-icon"></i>Save'; if (typeof renderIcons === 'function') renderIcons();
  if (error){alert('Error: '+error.message);return;}
  closeKBEditModal();
  refreshKBViews();
}

async function deleteKBArticle(id) {
  var a=_kbData.find(function(x){return x.id===id;});
  if (!a) return;
  if (a.submitted_by!==currentUser && !isManager){alert('You can only delete your own articles.');return;}
  if (!confirm('Delete "'+a.title+'"? This cannot be undone.')) return;
  closeKBModal();
  var {error}=await sb.from('kb_articles').delete().eq('id',id);
  if (error){alert('Error: '+error.message);return;}
  refreshKBViews();
}
