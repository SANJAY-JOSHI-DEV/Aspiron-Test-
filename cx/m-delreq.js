/* =====================================================================
   Deletion requests: a student asks (in the app: Profile → Account deletion) for the account and data to be removed.
   Server: cbt_admin_delreq (supabase_v102_delete_requests.sql). Who may use it: the Students module
   (View = read, Full access = delete / reject). "Delete now" removes the student for good, like Students → Delete.
   The student sees a 24-hour countdown; nothing is deleted by itself when it ends, it only turns red here.
   ===================================================================== */
(function () {
'use strict';
const { h, icon, join, ui: UI, fmt } = AX;
const can = () => AX.can('students', 'manage');
const DAY = 864e5;
const D = { items: [], now: 0, pending: 0 };
async function load() {
  return AX.cache.get('delreq', async () => { const r = await AX.api.call('cbt_admin_delreq', 'get', {}); if (r.ok) { D.items = r.items || []; D.now = +r.now || Date.now(); D.pending = +r.pending || 0; } return r; });
}
const left = x => { const m = x.at + DAY - Date.now(); if (m <= 0) return null; const t = Math.ceil(m / 6e4); return Math.floor(t / 60) + 'h ' + String(t % 60).padStart(2, '0') + 'm left'; };

AX.mod({
  id: 'delreq', title: 'Deletion requests', short: 'Deletions', icon: 'trash', group: 'Students & accounts', order: 18, perm: 'students',
  sub: 'Students who asked to delete their account and data. You decide: Delete now, or Reject.',
  async render(ctx) {
    const f = ctx.q.f || 'pending';
    ctx.head({ title: 'Deletion requests', sub: 'A student asks from the app (Profile → Account deletion) and sees a 24-hour countdown. Nothing is deleted until you press Delete now. Store orders and payment records are kept for your accounts.' });
    AX.set(ctx.el, UI.skeleton(3));
    AX.cache.drop('delreq');
    const r = await load();
    if (!ctx.alive()) return;
    if (!r.ok) {
      AX.set(ctx.el, h`<div class="card">${r.error === 'missing' || r.error === 'server'
        ? UI.empty({ tone: 'lock', icon: 'db', title: 'One-time setup needed', text: 'Run supabase_v101_orders_delete.sql and supabase_v102_delete_requests.sql once in Supabase (SQL Editor), then run supabase_v35_admin_team.sql again.', action: h`<button class="btn" data-act="retry">Check again</button>` })
        : UI.empty({ icon: 'trash', title: 'Could not load the requests', text: AX.errText(r), action: h`<button class="btn" data-act="retry">Try again</button>` })}</div>`);
      AX.act(ctx.el, { retry: () => ctx.reload() }); return;
    }
    const cnt = k => k === 'all' ? D.items.length : D.items.filter(x => x.status === k).length;
    const L = D.items.filter(x => f === 'all' || x.status === f);
    const row = x => { const over = x.status === 'pending' && !left(x);
      return h`<div class="card"><div class="row top">${UI.avatar(x.name || 'Student', x.mobile)}
        <div class="grow"><div class="row wrap gap6"><b>${x.name || 'Deleted student'}</b>
          ${x.status === 'pending' ? (over ? UI.pill('Overdue', 'bad') : UI.pill(left(x), 'warn')) : x.status === 'done' ? UI.pill('Deleted', 'ok') : x.status === 'rejected' ? UI.pill('Kept', 'gold') : UI.pill('Withdrawn by student', '')}
          ${x.status === 'pending' && !x.alive ? UI.pill('Account already gone', '') : ''}</div>
          <div class="xs mut">${x.status === 'done' ? x.mobile : fmt.mobile(x.mobile)} · asked ${fmt.dt(x.at)}${x.closed ? ' · closed ' + fmt.dt(x.closed) : ''}</div>
          ${x.reason ? h`<p class="mt8 sm">Reason: ${x.reason}</p>` : ''}</div></div>
        ${x.status === 'pending' && can() ? h`<div class="row wrap mt12 end"><button class="btn sm" data-act="rej" data-id="${x.id}">Reject (keep account)</button><button class="btn sm danger" data-act="del" data-id="${x.id}">${icon('trash', 14)} Delete now</button></div>` : ''}</div>`; };
    AX.set(ctx.el, h`<div class="chips">${join([['pending', 'Waiting'], ['done', 'Deleted'], ['rejected', 'Kept'], ['cancelled', 'Withdrawn'], ['all', 'All']], ([k, l]) => h`<a class="chip ${f === k ? 'on' : ''}" href="#/delreq?f=${k}">${l}${cnt(k) ? ' ' + cnt(k) : ''}</a>`)}</div>
      <div class="col gap16 mt16">${L.length ? join(L, row) : h`<div class="card">${UI.empty({ icon: 'trash', title: 'No requests here', text: 'When a student asks to delete their account it shows up here.' })}</div>`}</div>`);
    const act = async (id, action, msg) => { const x = await AX.api.call('cbt_admin_delreq', action, { id }); if (!x.ok) return UI.err(x); UI.toast(msg); AX.cache.drop('delreq'); AX.cache.drop('students'); AX.emit('data:changed'); ctx.reload(); };
    AX.act(ctx.el, {
      async del(el) { const x = D.items.find(i => i.id === el.dataset.id); if (!x) return;
        if (!(await UI.confirm({ title: 'Delete ' + (x.name || 'this student') + ' for good?', text: 'The account and everything tied to it (results, XP, notes, doubts, devices) is removed. This cannot be undone. Store orders and payment records stay. Their Supabase login (if they used email or Google) stays until you remove it in Supabase → Authentication → Users.', yes: 'Delete now', tone: 'danger' }))) return;
        act(x.id, 'delete', 'Account deleted'); },
      async rej(el) { const x = D.items.find(i => i.id === el.dataset.id); if (!x) return;
        if (!(await UI.confirm({ title: 'Keep this account?', text: 'The request is closed and the student keeps the account. Their app goes back to normal.', yes: 'Reject request' }))) return;
        act(x.id, 'reject', 'Request closed, account kept'); }
    });
  },
  async attention() {
    const r = await load(); if (!r.ok) return [];
    const p = D.items.filter(x => x.status === 'pending'), n = p.length, od = p.filter(x => !left(x)).length;
    return n ? [{ title: fmt.plural(n, 'account deletion request'), sub: od ? od + ' overdue (more than 24 hours)' : 'Students are waiting for a decision', count: n, go: '#/delreq', icon: 'trash', tone: od ? 'bad' : 'gold', badge: true }] : [];
  }
});
})();
