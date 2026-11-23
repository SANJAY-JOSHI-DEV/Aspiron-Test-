/* =====================================================================
   Promotions — one link per influencer or campaign: clicks, real leads, paid students, commission, owed, profit.
   Board (one line per influencer) or cards. A click on a line / card opens the influencer's dashboard: every lead
   (name, mobile), every order, sales per test series, commission per test series, payouts, and a short report to
   send to the influencer (no student details in it). Optional influencer code (on / off) typed in the store's coupon box.
   Server: cbt_admin_promos (get, create, update, orders, rates, set_valid, payout_add, payout_delete)
   SQL: supabase_v30_promotions.sql + supabase_v95_promo_board.sql
   ===================================================================== */
(function () {
'use strict';
const { h, raw, icon, join, ui: UI, fmt } = AX;
const P = { links: [], payouts: [], rates: [], items: null, at: 0, seg: 'all', q: '', view: AX.ls.get('cx_pr_view', 'board') === 'cards' ? 'cards' : 'board', sort: '', dir: -1 };
const ERR = { name: 'Enter a name (at least 2 letters).', code: 'Code: 3–30 letters, numbers or dashes, starting and ending with a letter or number.', exists: 'This code is already used. Choose another.',
  commission: 'Commission must be a whole number, for example 25.', claimed: 'Claimed must be a whole number, or empty.', amount: 'Enter an amount above 0.', date: 'Check the date.',
  link: 'Link not found. Refresh the page.', payout: 'Payout not found. Refresh the page.', order: 'Order not found. Refresh the page.',
  ucode: 'Code: 3–20 letters or numbers, for example RAHUL10.', ucode_empty: 'Type the code first, or switch the code off.', ucode_exists: 'Another influencer already has this code. Choose another.',
  rates: 'Check the commissions: whole numbers only, and a % from 0 to 100.', pct: 'A % must be from 0 to 100.', action: 'Run the newest promotions SQL (supabase_v96_promo_percent.sql) in Supabase first.', missing: 'Run supabase_v30_promotions.sql in Supabase first.', network: 'No internet. Try again.' };
const FIELD = { pct: 'commission', name: 'name', code: 'code', exists: 'code', commission: 'commission', claimed: 'claimed', amount: 'amount', date: 'paid_on', ucode: 'ucode', ucode_empty: 'ucode', ucode_exists: 'ucode' };
const errText = r => ERR[r && r.error] || (r && r.error === 'forbidden' ? AX.errText(r) : 'Could not save. Try again.');
const can = () => AX.can('promotions', 'manage');
const base = () => (AX.sto && AX.sto.siteBase ? AX.sto.siteBase() : location.href.replace(/[#?].*$/, '').replace(/[^/]*\.html$/, ''));
const url = code => base() + 'store?ref=' + encodeURIComponent(code);
const ymd = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fromYmd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : AX.fmt.ms(s); };
const suggest = n => String(n || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const calc = l => { const earned = Number(l.earned) || 0, paid = Number(l.paid_out) || 0, rev = Number(l.revenue) || 0;
  return { owed: Math.max(0, earned - paid), conv: l.clicks ? Math.round((l.paid_n || 0) / l.clicks * 1000) / 10 : null, cpl: l.leads ? Math.round(earned / l.leads) : null, profit: rev - earned, earned, paid, rev }; };
const full = l => Object.assign({ id: l.id, name: l.name, contact: l.contact || '', note: l.note || '', commission: String(l.commission == null ? 0 : l.commission), claimed: l.claimed == null || l.claimed === '' ? '' : String(l.claimed), active: !!l.active },
  'ucode' in l ? { ucode: l.ucode || '', ucode_on: !!l.ucode_on } : {}, 'commission_pct' in l ? { pct: !!l.commission_pct } : {});
const people = l => l.people == null ? Number(l.leads) || 0 : Number(l.people) || 0;   // v95: leads + buyers (before v95: orders)
// v96: a commission is ₹ per paid student or a % of what the student paid
const rateOf = (l, item) => { const r = P.rates.find(x => x.link_id === l.id && x.item_id === item); return r ? { c: Number(r.commission) || 0, pct: !!r.pct } : { c: Number(l.commission) || 0, pct: !!l.commission_pct }; };
const rateTxt = (c, pct) => pct ? (Number(c) || 0) + '%' : fmt.inr(c);
const normTxt = l => rateTxt(l.commission, l.commission_pct);
const rateOn = (rt, amount) => rt.pct ? Math.round((Number(amount) || 0) * Math.min(rt.c, 100) / 100) : rt.c;
const typeSel = (name, pct, dis) => h`<select class="inp pr-ty" name="${name}" aria-label="₹ or %" ${dis ? raw('disabled') : ''}><option value="inr" ${pct ? '' : raw('selected')}>₹</option><option value="pct" ${pct ? raw('selected') : ''}>%</option></select>`;
const m10 = m => AX.sto ? AX.sto.m10(m) : String(m || '').replace(/\D/g, '').slice(-10);
const ukey = m => /•/.test(m || '') ? String(m) : String(m || '').replace(/\D/g, '').slice(-10);
const ucodePill = l => l.ucode ? (l.ucode_on && l.active ? h`<span class="pill gold mono" title="Influencer code is on">${icon('tag', 12)} ${l.ucode}</span>` : h`<span class="pill mono pr-uoff" title="Influencer code is off">${icon('tag', 12)} ${l.ucode} · off</span>`) : '';
const shareMsg = l => `Hi ${String(l.name || '').split(/[\s(]/)[0] || ''} 👋\nHere is your link for ${(AX.cfg || {}).SITE_NAME || 'our test series'}:\n${url(l.code)}\nEvery student who buys through this link is counted for you.`;

async function load(force) {
  if (!force && P.at && Date.now() - P.at < 20000) return { ok: true };
  const r = await AX.api.call('cbt_admin_promos', 'get');
  if (r.ok) { P.links = r.links || []; P.payouts = r.payouts || []; P.rates = r.rates || []; P.items = r.items || null; P.at = Date.now(); }
  return r;
}
let VIEW = null;
const repaint = async () => { await load(true); if (VIEW && VIEW.alive()) VIEW.paint(); if (DASH && DASH.alive()) DASH.paint(); };
let DASH = null;

AX.mod({
  id: 'promos', title: 'Promotions', short: 'Promos', icon: 'megaphone', group: 'Sales & billing', order: 30, perm: 'promotions',
  sub: 'One link per influencer or campaign — clicks, paid students, commission owed and profit.',
  async render(ctx) {
    ctx.head({ title: 'Promotions', sub: 'One link per influencer or campaign. See clicks, real paid students, commission owed and profit. Tap an influencer to see every lead, order and test series.',
      actions: can() ? h`<button class="btn" data-act="bulk">${icon('rupee', 17)} Commission for everyone</button><button class="btn pri" data-act="new">${icon('plus', 17)} New link</button>` : '' });
    const ph = document.getElementById('ax-ph'); if (ph) AX.act(ph, { new: () => edit(null), bulk: () => bulkComm() });
    const r = await load(true);
    if (!ctx.alive()) return;
    if (!r.ok) {
      AX.set(ctx.el, r.error === 'missing' ? h`<div class="card">${UI.empty({ tone: 'lock', icon: 'db', title: 'One-time setup needed', text: 'Open Supabase → SQL Editor, paste supabase_v30_promotions.sql and press Run once. Then refresh.', action: h`<button class="btn sm" data-act="retry">${icon('refresh', 15)} Try again</button>` })}</div>` : UI.errorBox(r, 'supabase_v30_promotions.sql'));
      AX.act(ctx.el, { retry: () => ctx.reload() }); return;
    }
    AX.set(ctx.el, h`<div id="pr-k"></div><div class="row wrap gap16 pr-tools"><label class="inp-wrap search grow">${icon('search', 17)}<input class="inp" id="pr-q" type="search" placeholder="Search name or code" value="${P.q}" aria-label="Search links"></label><div class="seg" id="pr-seg"></div><div class="seg" id="pr-view" role="tablist" aria-label="View"></div></div><div id="pr-l"></div>`);
    const $ = id => ctx.el.querySelector('#' + id);
    const paint = () => {
      const L = P.links, c = L.map(calc), sum = k => c.reduce((s, x) => s + (x[k] || 0), 0), tot = k => L.reduce((s, l) => s + (Number(l[k]) || 0), 0);
      const profit = sum('profit'), owed = sum('owed');
      AX.set($('pr-k'), h`<div class="kpis pr-kpis">
        ${UI.kpi({ label: 'Revenue', value: fmt.inr(tot('revenue')), icon: 'rupee', hero: true, foot: fmt.plural(tot('paid_n'), 'paid student') })}
        ${UI.kpi({ label: 'Profit', value: fmt.inr(profit), icon: 'trophy', tone: profit >= 0 ? '' : 'bad', foot: 'revenue − commission' })}
        ${UI.kpi({ label: 'Owed now', value: fmt.inr(owed), icon: 'wallet', tone: owed > 0 ? 'warn' : '', foot: fmt.inr(tot('earned')) + ' commission · ' + fmt.inr(tot('paid_out')) + ' paid' })}
        ${UI.kpi({ label: 'Clicks → leads', value: fmt.num(tot('clicks')), icon: 'activity', tone: 'info', foot: fmt.plural(L.reduce((s, l) => s + people(l), 0), 'real lead') + ' · ' + (tot('clicks') ? Math.round(tot('paid_n') / tot('clicks') * 1000) / 10 + '% paid' : '—') })}</div>`);
      const n = { all: L.length, on: L.filter(l => l.active).length, off: L.filter(l => !l.active).length };
      AX.set($('pr-seg'), join([['all', 'All'], ['on', 'Active'], ['off', 'Paused']], ([k, t]) => h`<button type="button" class="${P.seg === k ? 'on' : ''}" data-act="seg" data-v="${k}">${t} <span class="mut">${n[k]}</span></button>`));
      AX.set($('pr-view'), join([['board', 'list', 'Board'], ['cards', 'grid', 'Cards']], ([k, ic, t]) => h`<button type="button" role="tab" aria-selected="${P.view === k}" class="${P.view === k ? 'on' : ''}" data-act="view" data-v="${k}">${icon(ic, 14)} ${t}</button>`));
      list();
    };
    const list = () => {
      const q = P.q.trim().toLowerCase();
      const L = P.links.filter(l => P.seg === 'all' || (P.seg === 'on') === !!l.active).filter(l => !q || (l.name + ' ' + l.code + ' ' + (l.ucode || '') + ' ' + (l.contact || '')).toLowerCase().includes(q));
      AX.set($('pr-l'), L.length ? (P.view === 'board' ? board(L) : h`<div class="pr-grid">${join(L, card)}</div>`) : h`<div class="card">${P.links.length ? UI.empty({ icon: 'search', title: 'No link matches', text: 'Try another filter or search.' })
        : UI.empty({ icon: 'megaphone', title: 'No promotion links yet', text: 'Tap “New link”, give the link to an influencer, and every student who buys through it is counted here.', action: can() ? h`<button class="btn pri" data-act="new">${icon('plus', 16)} New link</button>` : '' })}</div>`);
    };
    VIEW = { alive: ctx.alive, paint };
    const byId = id => P.links.find(l => l.id === id);
    AX.act(ctx.el, {
      seg: el => { P.seg = el.dataset.v; paint(); },
      view: el => { P.view = el.dataset.v; AX.ls.set('cx_pr_view', P.view); paint(); },
      sort: el => { const k = el.dataset.k; if (P.sort === k) P.dir = -P.dir; else { P.sort = k; P.dir = k === 'name' ? 1 : -1; } list(); },
      open: (el, ev) => { if (ev && ev.target.closest('a,button,input,select,textarea') && ev.target.closest('[data-act]') !== el) return; dash(byId(el.dataset.id)); },
      new: () => edit(null),
      edit: el => edit(byId(el.dataset.id)),
      orders: el => orders(byId(el.dataset.id)),
      pay: el => payout(byId(el.dataset.id)),
      toggle: el => UI.busy(el, () => toggle(byId(el.dataset.id))),
      share: el => shareMenu(el, byId(el.dataset.id))
    });
    AX.act(ctx.el, { open: (el, ev) => { if (ev.key !== 'Enter' && ev.key !== ' ') return; if (ev.target !== el) return; ev.preventDefault(); dash(byId(el.dataset.id)); } }, 'keydown');
    $('pr-q').addEventListener('input', AX.u.debounce(e => { P.q = e.target.value; list(); }, 150));
    paint();
  },
  search(q) {
    return P.links.filter(l => (l.name + ' ' + l.code + ' ' + (l.ucode || '')).toLowerCase().includes(q)).slice(0, 5).map(l => ({ g: 'Promotions', title: l.name || l.code, sub: l.code + ' · ' + fmt.plural(l.paid_n || 0, 'paid student'), icon: 'megaphone', go: '#/promos', tag: l.active ? 'Active' : 'Paused', tone: l.active ? 'ok' : '' }));
  }
});
AX.creates.push({ label: 'Promotion link', icon: 'megaphone', perm: ['promotions', 'manage'], run() { AX.go('promos'); setTimeout(() => edit(null), 300); } });

function card(l) {
  const c = calc(l), m = can(), claimed = l.claimed != null && l.claimed !== '' ? Number(l.claimed) : null;
  const k = (t, v, tone) => h`<div class="pr-k ${tone || ''}"><span>${t}</span><b>${v}</b></div>`;
  return h`<article class="card pr-card ${l.active ? '' : 'off'}" data-act="open" data-id="${l.id}" tabindex="0" aria-label="Open ${l.name || l.code}">
    <header class="row top"><span class="av" style="--c:${AX.u.hue(l.code)}">${icon('megaphone', 18)}</span><div class="grow"><div class="row gap6 wrap"><b class="lg ell">${l.name || l.code}</b>${l.active ? h`<span class="pill ok"><span class="d"></span>Active</span>` : UI.pill('Paused', 'warn', true)}</div>
      <div class="xs mut">${l.contact || 'No contact saved'} · ${normTxt(l)} per paid student · created ${fmt.date(l.created_at)}</div></div>
      ${m ? h`<button class="ibtn sm line" data-act="edit" data-id="${l.id}" aria-label="Edit ${l.name}" title="Edit">${icon('edit', 15)}</button>` : ''}</header>
    <div class="pr-url"><span class="pill pri mono">${l.code}</span>${ucodePill(l)}<span class="mono xs ell grow">${url(l.code)}</span><button class="btn xs" data-act="share" data-id="${l.id}">${icon('send', 13)} Share</button></div>
    <div class="pr-ks">${k('Clicks', fmt.num(l.clicks))}${k('Leads', fmt.num(l.leads))}${k('Paid', fmt.num(l.paid_n), 'ok')}${k('Conversion', c.conv == null ? '–' : c.conv + '%')}${k('Revenue', fmt.inr(c.rev))}${k('Commission', fmt.inr(c.earned))}${k('Paid out', fmt.inr(c.paid))}${k('Profit', fmt.inr(c.profit), c.profit >= 0 ? 'ok' : 'bad')}${k('Cost / lead', c.cpl == null ? '–' : fmt.inr(c.cpl))}</div>
    ${claimed != null ? (claimed > (l.paid_n || 0) ? h`<div class="callout bad sm">${icon('alert', 16)}<div>Influencer says <b>${claimed}</b> · system counts <b>${l.paid_n || 0}</b> paid · <b>${claimed - (l.paid_n || 0)}</b> not found</div></div>` : h`<div class="callout ok sm">${icon('checkCircle', 16)}<div>Influencer says <b>${claimed}</b> · system counts <b>${l.paid_n || 0}</b> paid</div></div>`) : ''}
    ${l.note ? h`<p class="xs mut pr-note">${icon('edit', 12)} ${l.note}</p>` : ''}
    <footer class="pr-f"><div class="grow"><div class="xs mut">Owed to influencer</div><b class="pr-owed ${c.owed > 0 ? 'warn' : ''}">${fmt.inr(c.owed)}</b></div>
      <button class="btn sm pri" data-act="open" data-id="${l.id}">${icon('chart', 14)} Details</button>
      <button class="btn sm" data-act="orders" data-id="${l.id}">${icon('cart', 14)} Orders</button>
      ${m ? h`<button class="btn sm" data-act="pay" data-id="${l.id}">${icon('rupee', 14)} Payouts</button><button class="btn sm ghost" data-act="toggle" data-id="${l.id}">${icon(l.active ? 'pause' : 'play', 14)} ${l.active ? 'Pause' : 'Resume'}</button>` : h`<button class="btn sm" data-act="pay" data-id="${l.id}">${icon('rupee', 14)} Payouts</button>`}</footer>
  </article>`;
}
/* ---------- board: one line per influencer ---------- */
const COLS = [['name', 'Influencer'], ['ucode', 'Code'], ['clicks', 'Clicks'], ['people', 'Leads'], ['leads', 'Orders'], ['paid_n', 'Paid'], ['conv', 'Conv.'], ['revenue', 'Revenue'], ['earned', 'Commission'], ['owed', 'Owed']];
const sortVal = (l, k) => k === 'name' ? String(l.name || l.code).toLowerCase() : k === 'ucode' ? String(l.ucode || '').toLowerCase() : k === 'people' ? people(l) : k === 'owed' ? calc(l).owed : k === 'conv' ? (calc(l).conv || 0) : Number(l[k]) || 0;
function board(L) {
  if (P.sort) L = L.slice().sort((a, b) => { const x = sortVal(a, P.sort), y = sortVal(b, P.sort); return (x < y ? -1 : x > y ? 1 : 0) * P.dir; });
  const T = k => L.reduce((s, l) => s + (k === 'people' ? people(l) : k === 'owed' ? calc(l).owed : Number(l[k]) || 0), 0);
  const num = (v, tone) => h`<td class="num r ${tone || ''}">${v}</td>`;
  return h`<div class="tbl-wrap pr-bw"><table class="tbl pr-tbl"><thead><tr>${join(COLS, ([k, t], i) => h`<th class="sort ${i > 1 ? 'r' : ''} ${P.sort === k ? 'on' : ''}" data-act="sort" data-k="${k}" aria-sort="${P.sort === k ? (P.dir > 0 ? 'ascending' : 'descending') : 'none'}">${t}${P.sort === k ? (P.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`)}<th aria-label="Open"></th></tr></thead>
    <tbody>${join(L, l => { const c = calc(l); return h`<tr class="click ${l.active ? '' : 'off'}" data-act="open" data-id="${l.id}" tabindex="0" aria-label="Open ${l.name || l.code}">
      <td class="pr-nm"><div class="row gap6"><span class="av sm" style="--c:${AX.u.hue(l.code)}">${AX.u.initials(String(l.name || l.code).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || l.code)}</span><div class="grow" style="min-width:0"><b class="ell" style="display:block;max-width:200px">${l.name || l.code}</b><span class="xs mut mono">${l.code}</span>${l.active ? '' : h` ${UI.pill('Paused', 'warn')}`}</div></div></td>
      <td>${ucodePill(l) || h`<span class="mut">—</span>`}</td>
      ${num(fmt.num(l.clicks))}${num(fmt.num(people(l)))}${num(fmt.num(l.leads))}${num(fmt.num(l.paid_n), 'pr-ok')}${num(c.conv == null ? '–' : c.conv + '%')}
      ${num(fmt.inr(c.rev))}${num(fmt.inr(c.earned))}${num(fmt.inr(c.owed), c.owed > 0 ? 'pr-warn' : '')}
      <td class="r">${icon('chevR', 16)}</td></tr>`; })}</tbody>
    <tfoot><tr><td colspan="2"><b>${fmt.plural(L.length, 'influencer')}</b></td>${join(['clicks', 'people', 'leads', 'paid_n'], k => h`<td class="num r"><b>${fmt.num(T(k))}</b></td>`)}<td></td>${join(['revenue', 'earned', 'owed'], k => h`<td class="num r"><b>${fmt.inr(T(k))}</b></td>`)}<td></td></tr></tfoot></table></div>
    <p class="xs mut mt8">Tap a line to see every lead, order and test series of that influencer. <b>Leads</b> = students who entered their name and number after opening the link, or ordered through it.</p>`;
}
function shareMenu(el, l) {
  UI.menu(el, [{ head: 'Share ' + l.code }, { label: 'Copy link', icon: 'copy', fn: () => AX.u.copy(url(l.code)).then(() => UI.toast('Link copied')) }, { label: 'Copy message with link', icon: 'msg', fn: () => AX.u.copy(shareMsg(l)).then(() => UI.toast('Message copied')) },
    l.ucode ? { label: 'Copy influencer code ' + l.ucode, icon: 'tag', fn: () => AX.u.copy(l.ucode).then(() => UI.toast('Code copied')) } : null,
    { label: 'Send on WhatsApp', icon: 'whatsapp', href: 'https://wa.me/?text=' + encodeURIComponent(shareMsg(l)) }, { label: 'Open the link', icon: 'external', href: url(l.code) },
    { sep: true }, { label: 'Report for the influencer', icon: 'chart', fn: () => report(l) }]);
}

/* ---------- one influencer's dashboard (owner / team only: student names and numbers) ---------- */
// every person the link brought: leads (name + number in the store) and buyers, joined by mobile number
function folks(D) {
  const M = new Map();
  D.leads.forEach(x => M.set(ukey(x.mobile), { name: x.name, mobile: x.mobile, course: x.course || '', at: x.at, via: 'link', orders: [] }));
  D.orders.slice().reverse().forEach(o => {
    const k = ukey(o.mobile); let p = M.get(k);
    if (!p) { p = { name: o.name, mobile: o.mobile, course: '', at: o.at, via: o.via || 'link', orders: [] }; M.set(k, p); }
    if (o.via === 'code') p.via = 'code';
    if (o.name) p.name = o.name;
    if ((fmt.ms(o.at) || 0) < (fmt.ms(p.at) || 0)) p.at = o.at;
    p.orders.push(o);
  });
  return [...M.values()].map(p => {
    const ok = p.orders.filter(o => o.valid !== false), paid = ok.filter(o => o.status === 'paid');
    return Object.assign(p, { paid, st: paid.length ? 'paid' : ok.some(o => o.status === 'pending') ? 'pending' : p.orders.length ? 'other' : 'none',
      comm: paid.reduce((s, o) => s + (Number(o.rate) || 0), 0), spent: paid.reduce((s, o) => s + (Number(o.amount) || 0), 0) });
  }).sort((a, b) => (fmt.ms(b.at) || 0) - (fmt.ms(a.at) || 0));
}
// sales per test series (orders that are counted)
function bySeries(l, D) {
  const M = new Map();
  D.orders.filter(o => o.valid !== false && o.status !== 'rejected').forEach(o => {
    const k = o.item_id || o.item_title; let x = M.get(k);
    if (!x) { x = { id: o.item_id, title: o.item_title || 'Test series', orders: 0, paid: 0, rev: 0, comm: 0 }; M.set(k, x); }
    x.orders++; if (o.status === 'paid') { x.paid++; x.rev += Number(o.amount) || 0; x.comm += Number(o.rate) || 0; }
  });
  return [...M.values()].sort((a, b) => b.paid - a.paid || b.orders - a.orders);
}
function dash(l) {
  if (!l) return;
  const T = { tab: 'leads', f: 'all', q: '' }; let D = null, ERRR = null;
  UI.drawer({ size: 'wide', title: l.name || l.code, body: UI.skeleton(5),
    onClose() { DASH = null; },
    onOpen(el, close, api) {
      const cur = () => P.links.find(z => z.id === l.id) || l;
      const head = () => { const x = cur(); api.head(h`<div class="row gap6 top"><span class="av" style="--c:${AX.u.hue(x.code)}">${icon('megaphone', 18)}</span><div class="grow" style="min-width:0">
        <div class="row gap6 wrap"><h2 class="ell">${x.name || x.code}</h2>${x.active ? h`<span class="pill ok"><span class="d"></span>Active</span>` : UI.pill('Paused', 'warn', true)}</div>
        <div class="row gap6 wrap mt4"><span class="pill pri mono">${x.code}</span>${ucodePill(x)}<span class="xs mut">${x.contact || 'No contact saved'} · ${normTxt(x)} normal commission</span></div></div></div>`); };
      const paint = () => {
        head();
        if (ERRR) return api.set(h`<div class="callout bad">${icon('alert')}<div>${errText(ERRR)}</div></div>`);
        if (!D) return;
        const x = cur(), c = calc(x), m = can(), F = folks(D), S = bySeries(x, D);
        const k = (t, v, tone, sub) => h`<div class="pr-k ${tone || ''}"><span>${t}</span><b>${v}</b>${sub ? h`<small>${sub}</small>` : ''}</div>`;
        const n = { leads: F.length, orders: D.orders.length, series: S.length };
        api.set(h`<div class="row wrap gap6 pr-dact">
            ${m ? h`<button class="btn sm" data-act="edit">${icon('edit', 14)} Edit</button>` : ''}
            <button class="btn sm" data-act="share">${icon('send', 14)} Share</button>
            <button class="btn sm" data-act="pay">${icon('rupee', 14)} Payouts</button>
            <button class="btn sm soft" data-act="report">${icon('chart', 14)} Report for influencer</button>
            <span class="sp grow"></span>${m ? h`<button class="btn sm ghost" data-act="toggle">${icon(x.active ? 'pause' : 'play', 14)} ${x.active ? 'Pause' : 'Resume'}</button>` : ''}</div>
          <div class="pr-ks pr-ks5 mt16">${k('Clicks', fmt.num(x.clicks))}${k('Leads', fmt.num(F.length), '', F.filter(p => p.st === 'none').length + ' not bought yet')}${k('Orders', fmt.num(D.orders.filter(o => o.valid !== false && o.status !== 'rejected').length), '', (x.pending_n || 0) + ' waiting')}${k('Paid students', fmt.num(x.paid_n), 'ok', c.conv == null ? '' : c.conv + '% of clicks')}${k('Revenue', fmt.inr(c.rev))}
            ${k('Commission', fmt.inr(c.earned))}${k('Paid out', fmt.inr(c.paid))}${k('Owed now', fmt.inr(c.owed), c.owed > 0 ? 'warn' : '')}${k('Profit', fmt.inr(c.profit), c.profit >= 0 ? 'ok' : 'bad')}${k('Came by code', fmt.num(x.via_code || 0), '', x.ucode ? x.ucode : 'no code')}</div>
          <nav class="ptabs mt16" role="tablist">${join([['leads', 'users', 'Leads'], ['orders', 'cart', 'Orders'], ['series', 'layers', 'By test series'], ['rates', 'rupee', 'Commission']], ([t, ic, lb]) => h`<a href="#" role="tab" aria-selected="${T.tab === t}" class="${T.tab === t ? 'on' : ''}" data-act="tab" data-v="${t}">${icon(ic, 15)} ${lb}${n[t] != null ? h` <span class="mut">${n[t]}</span>` : ''}</a>`)}</nav>
          <div id="pd-b">${T.tab === 'leads' ? leadsTab(F) : T.tab === 'orders' ? ordersTab(x, D) : T.tab === 'series' ? seriesTab(x, S) : ratesTab(x)}</div>`);
      };
      const leadsTab = F => {
        const q = T.q.trim().toLowerCase();
        const L = F.filter(p => T.f === 'all' || (T.f === 'paid' ? p.st === 'paid' : T.f === 'pending' ? p.st === 'pending' : p.st === 'none' || p.st === 'other'))
          .filter(p => !q || (p.name + ' ' + p.mobile).toLowerCase().includes(q));
        const cnt = f => F.filter(p => f === 'all' || (f === 'paid' ? p.st === 'paid' : f === 'pending' ? p.st === 'pending' : p.st === 'none' || p.st === 'other')).length;
        return h`<div class="row wrap gap6 pr-mb"><div class="seg">${join([['all', 'All'], ['paid', 'Bought'], ['pending', 'Order waiting'], ['none', 'Not bought']], ([f, t]) => h`<button type="button" class="${T.f === f ? 'on' : ''}" data-act="lf" data-v="${f}">${t} <span class="mut">${cnt(f)}</span></button>`)}</div>
            <label class="inp-wrap search grow" style="min-width:180px">${icon('search', 16)}<input class="inp" id="pd-q" type="search" placeholder="Search name or number" value="${T.q}" aria-label="Search leads"></label>
            <button class="btn sm ghost" data-act="csv">${icon('download', 14)} CSV</button></div>
          ${L.length ? h`<div class="card pad0 list">${join(L, p => h`<div class="li pr-ld">${UI.avatar(p.name || 'Student', p.mobile, 'sm')}<div class="grow" style="min-width:0">
              <div class="row gap6 wrap"><b class="ell">${p.name || 'Student'}</b>${p.st === 'paid' ? UI.pill('Bought', 'ok') : p.st === 'pending' ? UI.pill('Order waiting', 'warn') : p.st === 'other' ? UI.pill('Order not counted', '') : UI.pill('Not bought yet', '')}${p.via === 'code' ? UI.pill('Used code', 'gold') : ''}${p.course ? UI.pill(String(p.course).toUpperCase(), 'info') : ''}</div>
              <div class="xs mut"><span class="mono">${fmt.mobile(m10(p.mobile))}</span> · joined ${fmt.dt(p.at)}</div>
              ${p.orders.length ? h`<div class="xs tx2">${join(p.orders, (o, i) => h`${i ? ' · ' : ''}${o.item_title} ${o.status === 'paid' ? h`<b>${fmt.inr(o.amount)}</b>` : h`<span class="mut">(${o.valid === false ? 'not counted' : o.status})</span>`}`)}${p.comm ? h` · commission <b>${fmt.inr(p.comm)}</b>` : ''}</div>` : ''}</div>
            <div class="row gap6 pr-call"><a class="ibtn sm line" href="${AX.u.tel(p.mobile)}" title="Call" aria-label="Call ${p.name || ''}">${icon('phone', 15)}</a><a class="ibtn sm line" href="${AX.u.wa(p.mobile, 'Hi ' + String(p.name || '').split(' ')[0] + ', ')}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp ${p.name || ''}">${icon('whatsapp', 15)}</a></div></div>`)}</div>`
            : UI.empty({ icon: 'users', title: F.length ? 'No lead matches' : 'No leads yet', text: F.length ? 'Try another filter or search.' : 'Students who open this link and enter their name and number in the store show here, with everything they buy.' })}`;
      };
      const ordersTab = (x, D) => {
        const own = (x.contact || '').replace(/\D/g, ''), self = o => own.length >= 10 && own.slice(-10) === String(o.mobile || '').replace(/\D/g, '').slice(-10), m = can();
        const L = D.orders;
        return L.length ? h`<div class="card pad0 list">${join(L, o => h`<div class="li pr-or ${o.valid === false ? 'off' : ''}">${UI.avatar(o.name || 'Student', o.mobile, 'sm')}<div class="grow" style="min-width:0"><div class="row gap6 wrap"><b class="ell">${o.name || 'Student'}</b>${UI.pill(o.status === 'paid' ? 'Paid' : o.status === 'rejected' ? 'Rejected' : 'Pending', o.status === 'paid' ? 'ok' : o.status === 'rejected' ? 'bad' : '')}${o.valid === false ? UI.pill('Not counted', 'warn') : ''}${o.via === 'code' ? UI.pill('By code', 'gold') : ''}${self(o) ? UI.pill('Promoter\'s own number', 'bad') : ''}</div>
            <div class="xs mut"><span class="mono">${fmt.mobile(m10(o.mobile))}</span> · ${fmt.dt(o.at)}${o.code ? ' · ' + o.code : ''}</div>
            <div class="xs tx2">${o.item_title} · ${fmt.inr(o.amount)}${o.status === 'paid' && o.rate != null ? h` · commission <b>${fmt.inr(o.rate)}</b>` : o.status === 'pending' && o.item_id ? h` · commission if paid ${fmt.inr(rateOn(rateOf(x, o.item_id), o.amount))}` : ''}</div>${o.note ? h`<div class="xs mut">Note: ${o.note}</div>` : ''}</div>
          ${m ? h`<button class="btn xs ${o.valid === false ? 'soft' : 'ghost'}" data-act="valid" data-code="${o.code}">${o.valid === false ? h`${icon('check', 13)} Count again` : h`${icon('ban', 13)} Not counted`}</button>` : ''}</div>`)}</div>`
          : UI.empty({ icon: 'cart', title: 'No orders yet', text: 'No student has ordered through this link yet.' });
      };
      const seriesTab = (x, S) => S.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Test series</th><th class="r">Commission / student</th><th class="r">Orders</th><th class="r">Paid</th><th class="r">Revenue</th><th class="r">Commission earned</th></tr></thead><tbody>
          ${join(S, r => h`<tr><td><b>${r.title}</b></td><td class="num r">${r.id ? (rt => rateTxt(rt.c, rt.pct))(rateOf(x, r.id)) : '—'}</td><td class="num r">${fmt.num(r.orders)}</td><td class="num pr-ok">${fmt.num(r.paid)}</td><td class="num r">${fmt.inr(r.rev)}</td><td class="num r"><b>${fmt.inr(r.comm)}</b></td></tr>`)}</tbody>
          <tfoot><tr><td><b>Total</b></td><td></td><td class="num r"><b>${fmt.num(S.reduce((s, r) => s + r.orders, 0))}</b></td><td class="num r"><b>${fmt.num(S.reduce((s, r) => s + r.paid, 0))}</b></td><td class="num r"><b>${fmt.inr(S.reduce((s, r) => s + r.rev, 0))}</b></td><td class="num r"><b>${fmt.inr(S.reduce((s, r) => s + r.comm, 0))}</b></td></tr></tfoot></table></div>
          <p class="xs mut mt8">Commission earned is what was saved on each order when it was paid. “Commission / student” is the rate for new paid orders.</p>`
        : UI.empty({ icon: 'layers', title: 'No sales yet', text: 'Each test series bought through this link shows here with its count and commission.' });
      const ratesTab = x => {
        if (!P.items) return h`<div class="callout warn">${icon('db', 16)}<div>To set a commission for each test series, run <b>supabase_v95_promo_board.sql</b> in Supabase → SQL Editor once, then refresh.</div></div>`;
        const m = can();
        const ex = (it, c, pct) => c === '' || c == null ? '' : pct ? '= ' + fmt.inr(Math.round((Number(it.price) || 0) * Math.min(+c, 100) / 100)) + ' on ' + fmt.inr(it.price) : '';
        return h`<p class="sm tx2 pr-mb">Normal commission: <b>${normTxt(x)}</b> per paid student (change it with Edit). Set a different one for any test series below, in ₹ or as a % of what the student pays; leave it empty to use the normal one. A change counts only for students who pay from now on.</p>
          ${P.items.length ? h`<form id="pd-r" autocomplete="off">
            ${m ? h`<div class="pr-all"><b class="sm">Same for every series:</b><input class="inp pr-ri" id="pd-av" type="number" min="0" inputmode="numeric" placeholder="e.g. 10" aria-label="Commission for every series">${typeSel('pd_at', true)}
              <button type="button" class="btn sm" data-act="rfill">${icon('check', 14)} Fill all</button><button type="button" class="btn sm ghost" data-act="rclear">Clear all</button></div>` : ''}
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Test series</th><th class="r">Price</th><th>Commission</th></tr></thead><tbody>
            ${join(P.items, it => { const r = P.rates.find(z => z.link_id === x.id && z.item_id === it.id); return h`<tr data-price="${it.price}"><td><b>${it.title || 'Test series'}</b>${it.active === false ? h` ${UI.pill('Hidden', '')}` : ''}</td><td class="num r">${fmt.inr(it.price)}</td>
              <td><div class="row gap6 pr-rc"><input class="inp pr-ri" name="r_${it.id}" type="number" min="0" max="100000" inputmode="numeric" value="${r ? r.commission : ''}" placeholder="${normTxt(x)} (normal)" aria-label="Commission for ${it.title || 'this series'}" ${m ? '' : raw('disabled')}>${typeSel('t_' + it.id, r ? !!r.pct : !!x.commission_pct, !m)}<span class="xs mut pr-ex">${ex(it, r ? r.commission : '', r ? r.pct : false)}</span></div></td></tr>`; })}</tbody></table></div>
            ${m ? h`<div class="row end wrap gap6 mt12"><button type="button" class="btn ghost" data-act="rsave" data-all="1" data-busy="Copying…">${icon('users', 16)} Save + use for every influencer</button><button type="button" class="btn pri" data-act="rsave" data-busy="Saving…">${icon('check', 16)} Save commissions</button></div>` : ''}</form>`
          : UI.empty({ icon: 'layers', title: 'No test series in the store', text: 'Add test series in Store first.' })}`;
      };
      const get = async () => {
        const r = await AX.api.call('cbt_admin_promos', 'orders', { code: l.code });
        if (!el.isConnected) return;
        if (!r.ok) { ERRR = r; return paint(); }
        ERRR = null; D = { orders: r.orders || [], leads: r.leads || [] }; paint();
      };
      DASH = { alive: () => el.isConnected, paint, get };
      AX.act(api.el, {
        tab: b => { T.tab = b.dataset.v; paint(); },
        lf: b => { T.f = b.dataset.v; paint(); },
        edit: () => edit(cur()),
        share: b => shareMenu(b, cur()),
        pay: () => payout(cur()),
        report: () => report(cur(), D),
        toggle: b => UI.busy(b, () => toggle(cur())),
        csv: () => { const x = cur(); AX.u.csvDownload('leads-' + x.code + '.csv', [['Name', 'Mobile', 'Course', 'Joined', 'Came by', 'Status', 'Bought', 'Paid ₹', 'Commission ₹'], ...folks(D).map(p => [p.name, m10(p.mobile), p.course, fmt.dt(p.at), p.via === 'code' ? 'Code' : 'Link', p.st === 'paid' ? 'Bought' : p.st === 'pending' ? 'Order waiting' : 'Not bought', p.paid.map(o => o.item_title).join(' + '), p.spent, p.comm])]); },
        async valid(b) {
          const o = D.orders.find(z => z.code === b.dataset.code); if (!o) return;
          const valid = o.valid === false; let note = '';
          if (!valid) { const v = await UI.prompt({ title: 'Do not count this order?', label: 'Why? (optional)', placeholder: 'e.g. fake, refunded, duplicate', required: false, yes: 'Do not count', max: 500 }); if (v == null) return; note = v; }
          const r = await AX.api.call('cbt_admin_promos', 'set_valid', { order: o.code, valid, note });
          if (!r.ok) return UI.toast(errText(r), { tone: 'bad' });
          UI.toast(valid ? 'Counted again' : 'Not counted'); await get(); repaint();
        },
        async rsave(btn) {
          const f = el.querySelector('#pd-r'), x = cur(), rates = []; let bad = null;
          f.querySelectorAll('input.pr-ri[name^="r_"]').forEach(i => { const v = i.value.trim(), id = i.name.slice(2), pct = f.querySelector('[name="t_' + id + '"]').value === 'pct'; i.classList.remove('bad'); if (v === '') return; if (!/^[0-9]{1,6}$/.test(v) || +v > (pct ? 100 : 100000)) { bad = bad || i; i.classList.add('bad'); return; } rates.push({ item: id, commission: v, pct }); });
          if (bad) { bad.focus(); return UI.toast(ERR.rates, { tone: 'bad' }); }
          const all = btn.dataset.all === '1';
          if (all && !(await UI.confirm({ title: 'Use these for every influencer?', text: 'Every other influencer gets these per-series commissions and the same normal commission (' + normTxt(x) + '). Their own per-series commissions are replaced. Past paid orders do not change.', yes: 'Use for everyone' }))) return;
          await UI.busy(btn, async () => {
            const r = await AX.api.call('cbt_admin_promos', 'rates', { id: x.id, rates });
            if (!r.ok) return UI.toast(errText(r), { tone: 'bad' });
            if (all) { const r2 = await AX.api.call('cbt_admin_promos', 'rates_all', { id: x.id, normal: true }); if (!r2.ok) return UI.toast(errText(r2), { tone: 'bad' }); UI.toast('Saved for ' + fmt.plural((r2.n || 0) + 1, 'influencer')); }
            else UI.toast('Commissions saved');
            repaint();
          });
        },
        rfill() { const f = el.querySelector('#pd-r'), v = f.querySelector('#pd-av').value.trim(), t = f.querySelector('[name=pd_at]').value;
          if (!/^[0-9]{1,6}$/.test(v) || (t === 'pct' && +v > 100)) { f.querySelector('#pd-av').classList.add('bad'); return UI.toast(t === 'pct' ? ERR.pct : ERR.rates, { tone: 'bad' }); }
          f.querySelector('#pd-av').classList.remove('bad');
          f.querySelectorAll('input.pr-ri[name^="r_"]').forEach(i => { i.value = v; f.querySelector('[name="t_' + i.name.slice(2) + '"]').value = t; exUp(i); });
          UI.toast('Filled — press Save to keep it'); },
        rclear() { const f = el.querySelector('#pd-r'); f.querySelectorAll('input.pr-ri[name^="r_"]').forEach(i => { i.value = ''; exUp(i); }); UI.toast('Cleared — press Save to keep it'); }
      });
      // "= ₹30 on ₹299" next to a % while typing
      const exUp = i => { const tr = i.closest('tr'), id = i.name.slice(2), t = el.querySelector('[name="t_' + id + '"]'), e = tr && tr.querySelector('.pr-ex'); if (!e) return; const v = i.value.trim(), p = Number(tr.dataset.price) || 0;
        e.textContent = v !== '' && t.value === 'pct' && /^[0-9]+$/.test(v) ? '= ' + fmt.inr(Math.round(p * Math.min(+v, 100) / 100)) + ' on ' + fmt.inr(p) : ''; };
      const exAny = ev => { const t = ev.target; if (t.matches && t.matches('input.pr-ri[name^="r_"]')) exUp(t); else if (t.matches && t.matches('select[name^="t_"]')) { const i = el.querySelector('[name="r_' + t.name.slice(2) + '"]'); if (i) exUp(i); } };
      api.el.addEventListener('input', exAny); api.el.addEventListener('change', exAny);
      api.el.addEventListener('input', AX.u.debounce(e => { if (e.target.id !== 'pd-q') return; T.q = e.target.value; const b = el.querySelector('#pd-b'); if (b && D) { AX.set(b, leadsTab(folks(D))); const i = el.querySelector('#pd-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } } }, 200));
      get();
    } });
}

/* ---------- report for the influencer: only counts and money, never a student's name or number ---------- */
function report(l, D) {
  UI.modal({ title: 'Report for ' + (l.name || l.code), sub: 'Take a screenshot or copy the text and send it. It has no student names or numbers.', body: UI.skeleton(4),
    async onOpen(el, close, api) {
      if (!D) { const r = await AX.api.call('cbt_admin_promos', 'orders', { code: l.code }); if (!el.isConnected) return; if (!r.ok) return api.set(h`<div class="callout bad">${icon('alert')}<div>${errText(r)}</div></div>`); D = { orders: r.orders || [], leads: r.leads || [] }; }
      const x = P.links.find(z => z.id === l.id) || l, c = calc(x), S = bySeries(x, D).filter(r => r.paid), joined = folks(D).length, site = (AX.cfg || {}).SITE_NAME || 'Aspiron Education';
      const text = [`📊 ${site} × ${x.name || x.code}`, `Report till ${fmt.date(Date.now())}`, '', `Link clicks: ${fmt.num(x.clicks)}`, `Students who joined: ${fmt.num(joined)}`, `Paid students: ${fmt.num(x.paid_n)}`,
        ...(S.length ? ['', ...S.map(r => `• ${r.title}: ${r.paid} paid → ${fmt.inr(r.comm)}`)] : []), '', `Commission earned: ${fmt.inr(c.earned)}`, `Paid to you: ${fmt.inr(c.paid)}`, `Balance due: ${fmt.inr(c.owed)}`].join('\n');
      api.set(h`<div class="pr-rep"><div class="pr-rh"><b>${site}</b><span>× ${x.name || x.code}</span><small>Report till ${fmt.date(Date.now())}</small></div>
        <div class="pr-rk"><div><span>Link clicks</span><b>${fmt.num(x.clicks)}</b></div><div><span>Students joined</span><b>${fmt.num(joined)}</b></div><div class="ok"><span>Paid students</span><b>${fmt.num(x.paid_n)}</b></div></div>
        ${S.length ? h`<div class="pr-rs">${join(S, r => h`<div><span class="grow">${r.title}</span><span class="mut">${r.paid} paid</span><b>${fmt.inr(r.comm)}</b></div>`)}</div>` : ''}
        <div class="pr-rm"><div><span>Commission earned</span><b>${fmt.inr(c.earned)}</b></div><div><span>Paid to you</span><b>${fmt.inr(c.paid)}</b></div><div class="due"><span>Balance due</span><b>${fmt.inr(c.owed)}</b></div></div></div>`);
      api.foot(h`<span class="sp"></span><button class="btn ghost" data-close>Close</button><a class="btn" href="${'https://wa.me/' + (/^(\+?91)?[6-9]\d{9}$/.test((x.contact || '').replace(/[\s-]/g, '')) ? '91' + x.contact.replace(/\D/g, '').slice(-10) : '') + '?text=' + encodeURIComponent(text)}" target="_blank" rel="noopener">${icon('whatsapp', 16)} WhatsApp</a><button class="btn pri" data-act="copy">${icon('copy', 16)} Copy text</button>`);
      AX.act(el, { copy: () => AX.u.copy(text).then(() => UI.toast('Report copied')) });
    } });
}

/* ---------- v96: one commission for every influencer at once ---------- */
function bulkComm() {
  if (!can()) return UI.toast('You can view promotions but not change them.', { tone: 'warn' });
  UI.modal({ title: 'Commission for everyone', sub: 'Sets the normal commission of every influencer at once. It counts only for students who pay from now on; past paid orders do not change.',
    body: h`<form id="pb" class="form-grid" autocomplete="off">
      <div class="fld full"><label for="f-bc">Commission per paid student</label><div class="row gap6"><input class="inp grow" id="f-bc" name="commission" type="number" min="0" inputmode="numeric" placeholder="e.g. 10" autofocus>${typeSel('ctype', true)}</div>
        <div class="hint">% = of what each student pays: 10% → ₹30 on a ₹299 series, ₹80 on a ₹799 series.</div><div class="err" data-err="commission"></div></div>
      <div class="full">${AX.f.switch({ name: 'clear', value: true, label: 'Same for every test series', hint: 'Removes the per-series commissions of every influencer, so this one counts everywhere. Off = per-series commissions you set stay.' })}</div>
      <div class="full">${AX.f.switch({ name: 'paused', value: false, label: 'Also paused influencers' })}</div></form>`,
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="go" data-busy="Saving…">${icon('check', 16)} Apply to everyone</button>`,
    onOpen(el, close) {
      AX.act(el, { async go(btn) {
        const f = el.querySelector('#pb'); AX.f.clearErrors(f); const v = AX.f.read(f), c = String(v.commission).trim(), pct = v.ctype === 'pct';
        if (!/^[0-9]{1,6}$/.test(c) || +c > 100000) return AX.f.error(f, 'commission', ERR.commission);
        if (pct && +c > 100) return AX.f.error(f, 'commission', ERR.pct);
        if (!(await UI.confirm({ title: 'Apply ' + rateTxt(c, pct) + ' to every influencer?', text: v.clear ? 'Their own per-series commissions are removed too.' : 'Per-series commissions you set stay.', yes: 'Apply' }))) return;
        await UI.busy(btn, async () => {
          const r = await AX.api.call('cbt_admin_promos', 'bulk', { commission: c, pct, clear: !!v.clear, paused: !!v.paused });
          if (!r.ok) return r.error === 'pct' || r.error === 'commission' ? AX.f.error(f, 'commission', errText(r)) : UI.toast(errText(r), { tone: 'bad' });
          close(); UI.toast(rateTxt(c, pct) + ' set for ' + fmt.plural(r.n || 0, 'influencer')); repaint();
        });
      } });
    } });
}
async function toggle(l) {
  if (l.active && !(await UI.confirm({ title: 'Pause ' + (l.name || l.code) + '?', text: 'Students who open this link from now on are not counted. Orders already counted stay.', yes: 'Pause link' }))) return;
  const r = await AX.api.call('cbt_admin_promos', 'update', Object.assign(full(l), { active: !l.active }));
  if (!r.ok) return UI.toast(errText(r), { tone: 'bad' });
  UI.toast(l.active ? 'Link paused' : 'Link resumed'); repaint();
}
function edit(l) {
  if (!can()) return UI.toast('You can view promotions but not change them.', { tone: 'warn' });
  const isNew = !l; l = l || { name: '', code: '', commission: 25, claimed: '', contact: '', note: '', active: true };
  UI.modal({ title: isNew ? 'New promotion link' : 'Edit link · ' + l.code, size: 'wide',
    sub: isNew ? 'Give this link to the influencer. Every student who buys through it is counted here.' : 'A new commission applies only to students who pay from now on. Students already counted keep the rate they were counted with.',
    body: h`<form id="pf" class="form-grid" autocomplete="off">
      ${AX.f.input({ name: 'name', label: 'Influencer or campaign name', value: l.name, max: 80, placeholder: 'e.g. Rahul (YouTube)' })}
      ${isNew ? AX.f.input({ name: 'code', label: 'Link code', value: '', max: 30, placeholder: 'rahul-yt', hint: 'Letters, numbers, dash · cannot be changed later', auto: 'off' }) : h`<div class="fld"><label>Link code</label><div class="inp row" style="background:var(--hover)"><span class="mono">${l.code}</span></div><div class="hint">The code cannot be changed.</div></div>`}
      <div class="fld"><label for="f-commission">Normal commission per paid student</label><div class="row gap6"><input class="inp grow" id="f-commission" name="commission" type="number" min="0" inputmode="numeric" value="${l.commission}">${typeSel('ctype', !!l.commission_pct)}</div>
        <div class="hint">₹ per paid student, or % of what the student pays (10% of ₹299 = ₹30). A different one per test series: open the influencer → Commission tab.</div><div class="err" data-err="commission"></div></div>
      ${AX.f.input({ name: 'claimed', label: 'Claimed by influencer (optional)', type: 'number', value: l.claimed == null ? '' : l.claimed, min: 0, placeholder: 'e.g. 100', inputmode: 'numeric', hint: 'How many paid students they say they sent' })}
      ${AX.f.input({ name: 'ucode', label: 'Influencer code (optional)', value: l.ucode || '', max: 20, placeholder: 'e.g. RAHUL10', auto: 'off', hint: 'Students can type it in the coupon box of the store instead of opening the link. 3–20 letters or numbers.' })}
      <div class="fld pr-uon">${AX.f.switch({ name: 'ucode_on', value: isNew ? true : !!l.ucode_on, label: 'Code is on', hint: 'Off = the code is kept but does nothing in the store. A coupon (Coupons & Refer) with the same code also gives its discount.' })}</div>
      ${AX.f.input({ name: 'contact', label: 'Contact (only your team sees this)', value: l.contact, max: 120, placeholder: 'Telegram, WhatsApp or phone', full: true })}
      ${AX.f.textarea({ name: 'note', label: 'Note', value: l.note, max: 500, rows: 3, full: true })}
      ${isNew ? '' : h`<div class="full">${AX.f.switch({ name: 'active', value: !!l.active, label: 'Link is active', hint: 'Off = students who open it are not counted.' })}</div>`}
      ${isNew ? h`<div class="full well xs mono ell" id="pf-u">${url('your-code')}</div>` : ''}
    </form>`,
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="save" data-busy="Saving…">${icon('check', 16)} ${isNew ? 'Create link' : 'Save changes'}</button>`,
    onOpen(el, close) {
      const f = el.querySelector('#pf'), ci = f.querySelector('[name=code]'), ui = f.querySelector('[name=ucode]');
      ui.addEventListener('input', () => { const p = ui.selectionStart, v = ui.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (v !== ui.value) { ui.value = v; try { ui.setSelectionRange(Math.min(p, v.length), Math.min(p, v.length)); } catch (e) {} } });
      if (ci) {
        const show = () => AX.set(el.querySelector('#pf-u'), url(ci.value.trim().toLowerCase() || 'your-code'));
        f.querySelector('[name=name]').addEventListener('input', e => { if (!ci.dataset.t) { ci.value = suggest(e.target.value); show(); } });
        ci.addEventListener('input', () => { ci.dataset.t = '1'; show(); });
      }
      AX.act(el, { async save(btn) {
        AX.f.clearErrors(f); const v = AX.f.read(f);
        const d = { name: v.name.trim(), contact: v.contact.trim(), note: v.note.trim(), commission: String(v.commission).trim(), claimed: String(v.claimed).trim(), ucode: String(v.ucode || '').trim().toUpperCase(), ucode_on: !!v.ucode_on, pct: v.ctype === 'pct' };
        if (d.ucode && !/^[A-Z0-9]{3,20}$/.test(d.ucode)) return AX.f.error(f, 'ucode', ERR.ucode);
        if (!d.ucode) d.ucode_on = false;
        if (d.name.length < 2) return AX.f.error(f, 'name', ERR.name);
        if (!/^[0-9]{1,6}$/.test(d.commission) || +d.commission > 100000) return AX.f.error(f, 'commission', ERR.commission);
        if (d.pct && +d.commission > 100) return AX.f.error(f, 'commission', ERR.pct);
        if (d.claimed && !/^[0-9]{1,8}$/.test(d.claimed)) return AX.f.error(f, 'claimed', ERR.claimed);
        if (isNew) { d.code = v.code.trim().toLowerCase(); if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(d.code)) return AX.f.error(f, 'code', ERR.code); }
        else { d.id = l.id; d.active = !!v.active; }
        await UI.busy(btn, async () => {
          const r = await AX.api.call('cbt_admin_promos', isNew ? 'create' : 'update', d);
          if (!r.ok) return FIELD[r.error] && f.querySelector('[name=' + FIELD[r.error] + ']') ? AX.f.error(f, FIELD[r.error], errText(r)) : UI.toast(errText(r), { tone: 'bad' });
          close(); UI.toast(isNew ? 'Link created: ' + (r.code || d.code) : 'Saved', isNew ? { action: { label: 'Copy link', fn: () => AX.u.copy(url(r.code || d.code)).then(() => UI.toast('Link copied')) } } : {}); repaint();
        });
      } });
    } });
}
function orders(l) {
  const m = can();
  UI.drawer({ title: 'Orders via ' + l.code, sub: l.name, body: UI.skeleton(4),
    async onOpen(el, close, api) {
      let L = [];
      // R8: an order from the promoter's own number (the contact saved for this link) = possible self-referral
      const own = (l.contact || '').replace(/\D/g, ''), self = o => own.length >= 10 && own.slice(-10) === String(o.mobile || '').replace(/\D/g, '').slice(-10);
      const draw = () => {
        const counted = L.filter(o => o.status === 'paid' && o.valid !== false).length;
        api.set(h`<div class="row wrap gap6" style="margin-bottom:14px">${UI.pill(fmt.plural(L.length, 'order'), '')}${UI.pill(counted + ' paid and counted', 'ok')}${UI.pill(fmt.inr(L.filter(o => o.status === 'paid' && o.valid !== false).reduce((s, o) => s + (Number(o.rate) || 0), 0)) + ' commission', 'gold')}</div>
          ${L.length ? h`<div class="card pad0 list">${join(L, o => h`<div class="li pr-or ${o.valid === false ? 'off' : ''}">${UI.avatar(o.name || 'Student', o.mobile, 'sm')}<div class="grow"><div class="row gap6 wrap"><b class="ell">${o.name || 'Student'}</b>${UI.pill(o.status === 'paid' ? 'Paid' : o.status === 'rejected' ? 'Rejected' : 'Pending', o.status === 'paid' ? 'ok' : o.status === 'rejected' ? 'bad' : '')}${o.valid === false ? UI.pill('Not counted', 'warn') : ''}${self(o) ? UI.pill('Promoter\'s own number', 'bad') : ''}</div>
              <div class="xs mut">${fmt.mobile(AX.sto ? AX.sto.m10(o.mobile) : o.mobile)} · ${fmt.date(o.at)}${o.code ? ' · ' + o.code : ''}</div>
              <div class="xs tx2">${o.item_title} · ${fmt.inr(o.amount)}${o.status === 'paid' && o.rate != null ? ' · commission ' + fmt.inr(o.rate) : ''}</div>${o.note ? h`<div class="xs mut">Note: ${o.note}</div>` : ''}</div>
            ${m ? h`<button class="btn xs ${o.valid === false ? 'soft' : 'ghost'}" data-act="valid" data-code="${o.code}">${o.valid === false ? h`${icon('check', 13)} Count again` : h`${icon('ban', 13)} Not counted`}</button>` : ''}</div>`)}</div>`
            : UI.empty({ icon: 'cart', title: 'No orders yet', text: 'No student has ordered through this link yet.' })}`);
      };
      const get = async () => { const r = await AX.api.call('cbt_admin_promos', 'orders', { code: l.code }); if (!el.isConnected) return; if (!r.ok) return api.set(h`<div class="callout bad">${icon('alert')}<div>${errText(r)}</div></div>`); L = r.orders || []; draw(); };
      AX.act(api.body, { async valid(b) {
        const o = L.find(x => x.code === b.dataset.code); if (!o) return;
        const valid = o.valid === false; let note = '';
        if (!valid) { const v = await UI.prompt({ title: 'Do not count this order?', label: 'Why? (optional)', placeholder: 'e.g. fake, refunded, duplicate', required: false, yes: 'Do not count', max: 500 }); if (v == null) return; note = v; }
        const r = await AX.api.call('cbt_admin_promos', 'set_valid', { order: o.code, valid, note });
        if (!r.ok) return UI.toast(errText(r), { tone: 'bad' });
        UI.toast(valid ? 'Counted again' : 'Not counted'); await get(); repaint();
      } });
      get();
    } });
}
function payout(l) {
  const m = can();
  UI.modal({ title: 'Pay ' + (l.name || l.code), size: '', body: '',
    onOpen(el, close, api) {
      const draw = () => {
        const x = P.links.find(z => z.id === l.id) || l, c = calc(x), H = P.payouts.filter(p => p.link_id === l.id).sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on)));
        api.set(h`<div class="pr-ps"><div><span>Commission earned</span><b>${fmt.inr(c.earned)}</b></div><div><span>Already paid</span><b>${fmt.inr(c.paid)}</b></div><div class="${c.owed > 0 ? 'warn' : ''}"><span>Owed now</span><b>${fmt.inr(c.owed)}</b></div></div>
          ${m ? h`<form id="pp" class="form-grid mt16" autocomplete="off">
            ${AX.f.input({ name: 'amount', label: 'Amount paid (₹)', type: 'number', value: c.owed || '', min: 1, inputmode: 'numeric' })}
            ${UI.dtField({ name: 'paid_on', label: 'Date', value: new Date().setHours(12, 0, 0, 0), time: false, clear: false })}
            ${AX.f.input({ name: 'note', label: 'Note (how you paid)', max: 300, placeholder: 'UPI, bank, reference', full: true })}
            <div class="full row end"><button type="button" class="btn pri" data-act="add" data-busy="Saving…">${icon('check', 16)} Save payout</button></div></form>` : ''}
          <div class="section-t">History</div>
          ${H.length ? h`<div class="card flat pad0 list">${join(H, p => h`<div class="li"><span class="av sm" style="--c:#10b981">${icon('rupee', 14)}</span><div class="grow"><b class="num">${fmt.inr(p.amount)}</b><div class="xs mut">${fmt.date(fromYmd(p.paid_on))}${p.note ? ' · ' + p.note : ''}</div></div>${m ? h`<button class="ibtn sm" data-act="del" data-id="${p.id}" aria-label="Remove payout" title="Remove">${icon('trash', 15)}</button>` : ''}</div>`)}</div>` : h`<p class="sm mut">No payouts recorded yet.</p>`}`);
        const f = el.querySelector('#pp'); if (f) UI.wire(f);
      };
      AX.act(el, {
        async add(btn) {
          const f = el.querySelector('#pp'); AX.f.clearErrors(f); const v = AX.f.read(f), amount = String(v.amount).trim();
          if (!/^[0-9]{1,8}$/.test(amount) || +amount < 1) return AX.f.error(f, 'amount', ERR.amount);
          await UI.busy(btn, async () => {
            const r = await AX.api.call('cbt_admin_promos', 'payout_add', { link_id: l.id, amount, paid_on: v.paid_on ? ymd(v.paid_on) : '', note: v.note.trim() });
            if (!r.ok) return FIELD[r.error] === 'amount' ? AX.f.error(f, 'amount', errText(r)) : UI.toast(errText(r), { tone: 'bad' });
            UI.toast('Payout saved'); await repaint(); draw();
          });
        },
        async del(b) {
          if (!(await UI.confirm({ title: 'Remove this payout record?', text: 'The amount owed goes up again.', yes: 'Remove', tone: 'danger' }))) return;
          const r = await AX.api.call('cbt_admin_promos', 'payout_delete', { id: b.dataset.id });
          if (!r.ok) return UI.toast(errText(r), { tone: 'bad' });
          UI.toast('Payout removed'); await repaint(); draw();
        }
      });
      draw();
    } });
}

AX.css('promos', `
.pr-tools{margin:16px 0 14px}
.pr-tools .search .inp{border-radius:var(--r-pill)}
.pr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr));gap:16px;align-items:start}
.pr-card{display:flex;flex-direction:column;gap:14px}
.pr-card.off{opacity:.78}
.pr-card.off .av{filter:grayscale(1)}
.pr-url{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 10px;border-radius:var(--r-md);background:var(--solid-2);border:1px solid var(--line);min-width:0}
.pr-url .pill{flex:none}
.pr-ks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;border-radius:var(--r-md);overflow:hidden;background:var(--line);border:1px solid var(--line)}
.pr-k{background:var(--solid);padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}
.pr-k span{font-size:11px;font-weight:700;color:var(--mut);letter-spacing:.02em}
.pr-k b{font-size:15px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr-k.ok b{color:var(--ok)}.pr-k.bad b{color:var(--bad)}
.pr-note{display:flex;gap:6px;align-items:flex-start;white-space:pre-wrap;overflow-wrap:anywhere}
.pr-f{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:12px;border-top:1px solid var(--line)}
.pr-owed{font-family:var(--font-display);font-size:22px;font-weight:600}
.pr-owed.warn{color:var(--warn)}
.pr-or.off{opacity:.65}
.pr-ps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.pr-ps>div{padding:12px;border-radius:var(--r-md);background:var(--solid-2);border:1px solid var(--line);display:flex;flex-direction:column;gap:4px;min-width:0}
.pr-ps span{font-size:11.5px;color:var(--mut);font-weight:700}
.pr-ps b{font-family:var(--font-display);font-size:20px;font-weight:600}
.pr-ps .warn b{color:var(--warn)}
.pr-card[data-act=open]{cursor:pointer;transition:border-color var(--fast),box-shadow var(--fast)}
.pr-card[data-act=open]:hover{border-color:var(--line-2);box-shadow:var(--shadow-pop)}
.pr-card[data-act=open]:focus-visible,.pr-tbl tr.click:focus-visible{outline:2px solid var(--pri);outline-offset:2px}
.pr-uoff{opacity:.7;text-decoration:line-through}
.pr-tools .seg button{display:inline-flex;align-items:center;gap:6px}
.pr-bw{max-height:none}
.pr-tbl th.r,.pr-tbl td.r{text-align:right}
.pr-tbl td{white-space:nowrap}
.pr-tbl td.pr-nm{white-space:normal;min-width:190px}
.pr-tbl tr.off td{opacity:.7}
.pr-tbl tr.off td.pr-nm{opacity:1}
.pr-tbl th.on{color:var(--tx)}
.pr-tbl tfoot td{background:var(--solid-2);border-top:1px solid var(--line);padding:11px 14px}
.pr-tbl td:first-child,.pr-tbl th:first-child{position:sticky;left:0;z-index:2;background:var(--solid)}
.pr-tbl thead th:first-child{background:var(--solid-2);z-index:3}
.pr-tbl tfoot td:first-child{background:var(--solid-2)}
.pr-tbl tbody tr:hover td{background:var(--solid-2)}
td.pr-ok{color:var(--ok);font-weight:700}td.pr-warn{color:var(--warn);font-weight:700}
.pr-uon{align-self:end;padding-bottom:4px}
.pr-mb{margin-bottom:12px}
.pr-dact .sp{flex:1}
.pr-ks5{grid-template-columns:repeat(5,minmax(0,1fr))}
.pr-k small{font-size:11px;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr-k.warn b{color:var(--warn)}
.pr-ld .pr-call{flex:none}
.pr-ri{max-width:200px;height:38px}
.pr-ri.bad{border-color:var(--bad)}
.pr-ty{width:64px;height:38px;flex:none;padding:0 8px}
.pr-rc{flex-wrap:nowrap;align-items:center}
.pr-rc .pr-ri{width:110px}
.pr-ex{white-space:nowrap}
.pr-all{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;border-radius:var(--r-md);background:var(--solid-2);border:1px solid var(--line)}
.pr-all .pr-ri{width:110px}
.pr-rep{border-radius:var(--r-lg);border:1px solid var(--line);overflow:hidden;background:var(--solid)}
.pr-rh{display:flex;flex-direction:column;gap:2px;padding:18px 18px 14px;background:linear-gradient(135deg,color-mix(in srgb,var(--pri) 14%,var(--solid)),var(--solid))}
.pr-rh b{font-family:var(--font-display);font-size:20px}
.pr-rh span{font-weight:700}
.pr-rh small{color:var(--mut);font-size:12px}
.pr-rk,.pr-rm{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border-top:1px solid var(--line)}
.pr-rk>div,.pr-rm>div{background:var(--solid);padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.pr-rk span,.pr-rm span{font-size:11.5px;color:var(--mut);font-weight:700}
.pr-rk b,.pr-rm b{font-family:var(--font-display);font-size:20px;font-weight:600}
.pr-rk .ok b{color:var(--ok)}
.pr-rm .due b{color:var(--warn)}
.pr-rs{border-top:1px solid var(--line);padding:6px 14px}
.pr-rs>div{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed var(--line);font-size:14px}
.pr-rs>div:last-child{border-bottom:0}
@media (max-width:760px){.pr-ks5{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.pr-tbl td.pr-nm{min-width:150px}.pr-f .grow{flex-basis:100%}.pr-f .btn{flex:1}.pr-tools .seg{width:100%}.pr-tools .seg button{flex:1;justify-content:center}.pr-rk b,.pr-rm b{font-size:16px}.pr-rk>div,.pr-rm>div{padding:10px}}
`);
})();
