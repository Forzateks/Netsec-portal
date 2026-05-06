// == NOTIFICATIONS (manager bell) ==============================
// Polls every 60s and on window focus. Only renders when the current
// user is the recipient of at least one notification (today, that's
// the manager — any employee whose RLS-filtered SELECT returns rows).

let _notifPollTimer = null;

async function renderNotifications() {
  var bellWrap = document.getElementById('notif-bell-wrap');
  var listEl   = document.getElementById('notif-dropdown-list');
  var countEl  = document.getElementById('notif-bell-count');
  if (!bellWrap || !listEl || !countEl) return;

  var res = await sb.from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (res.error) {
    console.error('notif fetch failed:', res.error);
    return;
  }
  var rows = res.data || [];
  // RLS already restricts; just show what came back
  if (!rows.length) {
    bellWrap.style.display = 'none';
    return;
  }
  bellWrap.style.display = '';

  var unread = rows.filter(function(r){ return !r.read_at; }).length;
  if (unread > 0) {
    countEl.textContent = unread > 99 ? '99+' : String(unread);
    countEl.style.display = '';
  } else {
    countEl.style.display = 'none';
  }

  var typeIcons = {
    ot_edited_after_approval:  '✏️',
    ot_deleted_after_approval: '🗑️',
  };

  listEl.innerHTML = rows.map(function(n){
    var icon = typeIcons[n.type] || '🔔';
    var age = n.created_at ? fmtNotifAge(n.created_at) : '';
    var bg = n.read_at ? 'transparent' : '#FEF3C7';
    return '<div class="notif-item" data-notif-id="'+n.id+'" '+
      'onclick="markNotificationRead('+n.id+')" '+
      'style="padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;background:'+bg+'">'+
      '<div style="display:flex;gap:8px;align-items:flex-start">'+
        '<div style="font-size:18px;line-height:1">'+icon+'</div>'+
        '<div style="flex:1;font-size:13px;line-height:1.4;color:var(--navy)">'+esc2(n.message||'')+'</div>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:4px;margin-left:26px">'+age+(n.read_at?'  · read':'')+'</div>'+
      '</div>';
  }).join('');
}

function fmtNotifAge(iso) {
  var t = new Date(iso).getTime();
  var diff = Math.max(0, Date.now() - t);
  var min = Math.floor(diff / 60000);
  if (min < 1)   return 'just now';
  if (min < 60)  return min + ' min ago';
  var hrs = Math.floor(min / 60);
  if (hrs < 24)  return hrs + ' hr ago';
  var days = Math.floor(hrs / 24);
  if (days < 7)  return days + ' day' + (days===1?'':'s') + ' ago';
  return new Date(iso).toLocaleDateString();
}

async function markNotificationRead(id) {
  var nowIso = new Date().toISOString();
  await sb.from('notifications').update({ read_at: nowIso }).eq('id', id).is('read_at', null);
  renderNotifications();
}

function toggleNotifDropdown() {
  var dd = document.getElementById('notif-dropdown');
  if (!dd) return;
  var visible = dd.style.display === 'block';
  dd.style.display = visible ? 'none' : 'block';
  if (!visible) renderNotifications();
}

function startNotifPolling() {
  // Initial render + 60s polling + focus refresh
  renderNotifications();
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  _notifPollTimer = setInterval(renderNotifications, 60000);
  window.addEventListener('focus', renderNotifications);
}

// Helper used by unified-sessions.js when an approved OT session is
// edited or deleted. Inserts a notification row; failures are logged
// but never block the user's main action.
async function notifyManagerOTEvent(eventType, sessionId, message) {
  try {
    await sb.from('notifications').insert({
      recipient:    'Venkatesan',
      type:         eventType,
      message:      message,
      reference_id: sessionId,
    });
  } catch (e) {
    console.error('notification insert failed:', e);
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e){
  var dd = document.getElementById('notif-dropdown');
  var bell = document.getElementById('notif-bell-wrap');
  if (!dd || !bell) return;
  if (dd.style.display !== 'block') return;
  if (bell.contains(e.target)) return;
  dd.style.display = 'none';
});
