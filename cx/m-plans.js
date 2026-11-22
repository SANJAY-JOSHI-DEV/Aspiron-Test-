/* =====================================================================
   Plans: Basic / Pro / Ultra — names and prices, the compare list students see on Upgrade, add-ons (with a picture),
   donation amounts, plan coupons and the students who tapped Notify me. Payments are not open yet in the app.
   Server: cbt_admin_plans (supabase_v90_plans.sql). Store = View reads, Store = Full access changes.
   Access & limits: cbt_admin_plan_access (supabase_v91_plan_access.sql) — the lock switch, the limit of each feature per
   plan, and giving a plan to a student (until payments open, the only way to Pro / Ultra).
   ===================================================================== */
(function () {
'use strict';
const { h, raw, icon, join, ui: UI, fmt } = AX;
const can = () => AX.can('store', 'manage');
const TABS = [{ id: 'plans', title: 'Plans', icon: 'layers' }, { id: 'compare', title: 'Compare list', icon: 'list' }, { id: 'addons', title: 'Add-ons', icon: 'gift' },
  { id: 'extras', title: 'Donation & coupons', icon: 'tag' }, { id: 'notify', title: 'Notify me', icon: 'bell' }, { id: 'access', title: 'Access & limits', icon: 'lock' }];
const ERR = { title: 'Enter a name.', number: 'Prices and days must be whole numbers.', label: 'Enter the feature name.', value: 'Fill every plan (yes, no, demo or a short text).',
  img: 'The picture must be a JPG, PNG or WebP under 300 KB.', kind: 'Choose a type.', amounts: 'Up to 8 amounts, each 1 to 100000.', code: 'Code: 3–24 letters, numbers, - or _.',
  plans: 'Choose at least one plan.', limit: 'You have reached the limit.', missing: 'Run supabase_v90_plans.sql in Supabase first, then supabase_v35_admin_team.sql again.' };
const errText = r => ERR[r && r.error] || AX.errText(r);
const P = { d: null };
const rs = n => n == null || n === '' ? '—' : '₹' + fmt.num(+n);
const VAL = v => { const l = String(v || '').toLowerCase(); return l === 'yes' ? raw('<span style="color:var(--ok);font-weight:700">✓</span>') : l === 'no' ? raw('<span class="mut">✕</span>') : l === 'demo' ? UI.pill('Demo', '') : h`<b class="sm">${v}</b>`; };
const PLN = { basic: 'Basic', pro: 'Pro', ultra: 'Ultra' };

// ---------- Access & limits (v91) ----------
const LIM = n => +n === -1 ? h`<b style="color:var(--ok)">Unlimited</b>` : +n === 0 ? raw('<span class="mut">✕</span>') : h`<b>${n}</b>`;
const PER = { day: 'a day', month: 'a month (India time)', total: 'in total' };
const AERR = { bad_input: 'Limits: -1 = unlimited, 0 = not in the plan, or a number up to 100000. Days: 1 to 3650.', no_student: 'No student with this mobile number.', not_found: 'Not found.' };
async function access(ctx, m) {
  const r = await AX.api.call('cbt_admin_plan_access', 'get', {});
  if (!ctx.alive()) return;
  if (!r || !r.ok) {
    const miss = r && (r.error === 'missing' || r.error === 'server');
    AX.set(ctx.el, h`<div class="card">${UI.empty({ tone: 'lock', icon: 'db', title: miss ? 'One-time setup needed' : 'Could not load', text: miss ? 'Run supabase_v91_plan_access.sql in Supabase first, then supabase_v35_admin_team.sql again.' : AX.errText(r), action: h`<button class="btn" data-act="retry">Check again</button>` })}</div>`);
    AX.act(ctx.el, { retry: () => ctx.reload() }); return;
  }
  const save = async (act, data, msg) => { const x = await AX.api.call('cbt_admin_plan_access', act, data); if (!x || !x.ok) { UI.toast(AERR[x && x.error] || AX.errText(x), { tone: 'bad' }); return false; } UI.toast(msg || 'Saved'); ctx.reload(); return true; };
  const c = r.counts || {};
  AX.set(ctx.el, h`<div class="card"><div class="row wrap gap12"><div class="grow"><div class="row gap8"><b style="font-size:17px">Plan locks</b>${r.enforce ? UI.pill('On', 'ok') : UI.pill('Off', 'bad')}</div>
      <div class="sm mut mt4">${r.enforce ? 'On: students get only what their plan allows below. The server checks it, in the app and the old app.' : 'Off: every student can use everything, as before. The app only shows which plan a feature belongs to. Uses are still counted.'}</div></div>
      ${m ? h`<button class="btn ${r.enforce ? 'danger' : 'pri'}" data-act="sw">${icon('lock', 15)} ${r.enforce ? 'Turn locks off' : 'Turn locks on'}</button>` : ''}</div>
      <div class="row wrap gap8 mt12">${join([['free', 'Free'], ['basic', 'Basic'], ['pro', 'Pro'], ['ultra', 'Ultra']], ([k, l]) => h`<span class="chip">${l}: <b>${fmt.num(c[k] || 0)}</b></span>`)}</div></div>
    <div class="callout info mt16 mb12">${icon('info')}<div class="sm">For each plan: <b>-1</b> = unlimited, <b>0</b> = not in the plan, a number = that many ${'uses'} per period (a demo on Free, “4 a month” on Pro …).</div></div>
    <div class="card pad0" style="overflow:auto"><table class="tbl"><thead><tr><th>Feature</th><th>Counted</th><th>Free</th><th>Basic</th><th>Pro</th><th>Ultra</th><th></th></tr></thead><tbody>
      ${join(r.feats, f => h`<tr><td><b>${f.title}</b></td><td class="xs mut">${f.unit}, ${PER[f.period] || f.period}</td><td>${LIM(f.free)}</td><td>${LIM(f.basic)}</td><td>${LIM(f.pro)}</td><td>${LIM(f.ultra)}</td>
        <td>${m ? h`<button class="ibtn sm" data-act="feat" data-k="${f.key}" aria-label="Edit">${icon('edit', 15)}</button>` : ''}</td></tr>`)}</tbody></table></div>
    <div class="card mt16"><div class="row"><b class="grow">Plans given by the admin</b>${m ? h`<button class="btn sm" data-act="grant">${icon('plus', 14)} Give a plan</button>` : ''}</div>
      <div class="sm mut mt4">Until payments open, this is how a student gets Pro or Ultra (a trial, a topper, a teacher …). When it ends, the student goes back to Basic or Free.</div>
      ${r.grants.length ? h`<div class="col gap8 mt12">${join(r.grants, g => h`<div class="row wrap gap8" style="padding:8px 0;border-top:1px solid var(--line)"><b>${g.student || 'Student'}</b><span class="xs mut">${fmt.mobile(g.mobile)}</span>${UI.pill(PLN[g.plan] || g.plan, g.live ? 'gold' : '')}
          <span class="sm mut grow">${g.live ? 'till ' : 'ended '}${new Date(g.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${g.note ? ' · ' + g.note : ''}</span>
          ${m ? h`<button class="btn xs danger" data-act="revoke" data-m="${g.mobile}">${icon('trash', 13)} Remove</button>` : ''}</div>`)}</div>` : h`<div class="sm mut mt12">No plans given yet.</div>`}</div>`);
  AX.act(ctx.el, {
    retry: () => ctx.reload(),
    async sw() { const on = !r.enforce;
      if (await UI.confirm({ title: on ? 'Turn the plan locks on?' : 'Turn the plan locks off?', text: on ? 'Students on Free and Basic will lose what their plan does not have (Question bank, PYQ, the test generator …) right away. Students given a plan keep it.' : 'Every student can use everything again.', yes: on ? 'Turn on' : 'Turn off', tone: on ? 'danger' : '' })) save('enforce', { on }, on ? 'Locks are on' : 'Locks are off'); },
    feat(el) { const f = r.feats.find(x => x.key === el.dataset.k); if (!f) return;
      UI.modal({ title: f.title, size: 'narrow', body: h`<form id="pff" class="col gap16"><div class="sm mut">-1 = unlimited · 0 = not in the plan · a number = ${f.unit} ${PER[f.period] || ''}</div>
          <div class="grid g2">${join([['free', 'Free'], ['basic', 'Basic'], ['pro', 'Pro'], ['ultra', 'Ultra']], ([k, l]) => AX.f.input({ name: k, label: l, value: f[k], type: 'number' }))}</div></form>`,
        foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="ok">${icon('check', 16)} Save</button>`,
        onOpen(mo, close) { AX.act(mo, { async ok(b) { const d = AX.f.read(mo.querySelector('#pff')); await UI.busy(b, async () => { if (await save('feature_save', { key: f.key, free: String(d.free), basic: String(d.basic), pro: String(d.pro), ultra: String(d.ultra) })) close(true); }); } }); } }); },
    grant() {
      UI.modal({ title: 'Give a plan', size: 'narrow', body: h`<form id="pgf" class="col gap16">${AX.f.input({ name: 'mobile', label: 'Student mobile number', max: 15 })}
          <div class="row gap12">${AX.f.select({ name: 'plan', label: 'Plan', value: 'pro', options: [{ value: 'pro', label: 'Pro' }, { value: 'ultra', label: 'Ultra' }, { value: 'basic', label: 'Basic' }] })}${AX.f.input({ name: 'days', label: 'Days', value: 30, type: 'number' })}</div>
          ${AX.f.input({ name: 'note', label: 'Note (optional, e.g. trial)', max: 120 })}</form>`,
        foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="ok">${icon('check', 16)} Give</button>`,
        onOpen(mo, close) { AX.act(mo, { async ok(b) { const d = AX.f.read(mo.querySelector('#pgf')); await UI.busy(b, async () => { if (await save('grant', { mobile: String(d.mobile || '').trim(), plan: d.plan, days: String(d.days || ''), note: d.note || '' }, 'Plan given')) close(true); }); } }); } }); },
    async revoke(el) { if (await UI.confirm({ title: 'Remove this plan?', text: 'The student goes back to Basic or Free.', yes: 'Remove', tone: 'danger' })) save('revoke', { mobile: el.dataset.m }, 'Removed'); }
  });
}

AX.mod({
  id: 'plans', title: 'Plans', short: 'Plans', icon: 'layers', group: 'Sales & billing', order: 22, perm: 'store',
  sub: 'Basic / Pro / Ultra: prices, the compare list, add-ons, donation, coupons, access and limits.',
  async render(ctx) {
    const tab = TABS.some(t => t.id === ctx.parts[0]) ? ctx.parts[0] : 'plans', m = can();
    ctx.head({ title: 'Plans', sub: 'What students see when they tap Upgrade: Basic, Pro and Ultra, the compare list, add-ons, donation and coupons. Payments are not open yet: students can tap Notify me.', tabs: TABS, tab });
    AX.set(ctx.el, UI.skeleton(4));
    if (tab === 'access') return access(ctx, m);
    const r = await AX.api.call('cbt_admin_plans', 'get', {});
    if (!ctx.alive()) return;
    if (!r || !r.ok) {
      AX.set(ctx.el, h`<div class="card">${UI.empty({ tone: 'lock', icon: 'db', title: r && (r.error === 'missing' || r.error === 'server') ? 'One-time setup needed' : 'Could not load', text: r && (r.error === 'missing' || r.error === 'server') ? ERR.missing : AX.errText(r), action: h`<button class="btn" data-act="retry">Check again</button>` })}</div>`);
      AX.act(ctx.el, { retry: () => ctx.reload() }); return;
    }
    P.d = r;
    const save = async (act, data, msg) => { const x = await AX.api.call('cbt_admin_plans', act, data); if (!x || !x.ok) { UI.toast(errText(x), { tone: 'bad' }); return false; } UI.toast(msg || 'Saved'); ctx.reload(); return true; };
    const body = {
      plans: () => h`<div class="callout info mb16">${icon('info')}<div class="sm"><b>Basic</b> is what a student has after buying any test series. <b>Pro</b> and <b>Ultra</b> are upgrades on the student's account. Leave the price empty to show “Price coming soon”.</div></div>
        <div class="grid g3">${join(r.plans, p => h`<div class="card"><div class="row"><b class="grow" style="font-size:17px">${p.title}</b>${p.active ? UI.pill('Shown', 'ok') : UI.pill('Hidden', 'bad')}</div>
          <div class="sm mut mt4">${p.tagline || '—'}</div><div class="row gap8 mt12" style="align-items:baseline"><b style="font-size:22px">${p.price == null ? 'Price soon' : rs(p.price)}</b>${p.mrp ? h`<s class="mut">${rs(p.mrp)}</s>` : ''}</div>
          <div class="xs mut mt4">${p.days} days on the account · key ${p.key}</div>${m ? h`<button class="btn sm mt12" data-act="plan" data-k="${p.key}">${icon('edit', 14)} Edit</button>` : ''}</div>`)}</div>`,
      compare: () => h`<div class="callout info mb16">${icon('info')}<div class="sm">One row per feature. For each plan write <b>yes</b>, <b>no</b>, <b>demo</b> (a little for free) or a short text like <b>4 a month</b>. Rows with the same section are grouped.</div></div>
        ${m ? h`<div class="row mb12"><button class="btn" data-act="row">${icon('plus', 15)} Add a row</button></div>` : ''}
        <div class="card pad0" style="overflow:auto"><table class="tbl"><thead><tr><th>Section</th><th>Feature</th><th>Free</th><th>Basic</th><th>Pro</th><th>Ultra</th><th></th></tr></thead><tbody>
        ${join(r.rows, x => h`<tr><td class="xs mut">${x.section || '—'}</td><td><b>${x.label}</b>${x.info ? h`<div class="xs mut">${x.info}</div>` : ''}</td><td>${VAL(x.v_free)}</td><td>${VAL(x.v_basic)}</td><td>${VAL(x.v_pro)}</td><td>${VAL(x.v_ultra)}</td>
          <td>${m ? h`<div class="row gap6 end"><button class="ibtn sm" data-act="row" data-id="${x.id}" aria-label="Edit">${icon('edit', 15)}</button><button class="ibtn sm" data-act="rowDel" data-id="${x.id}" aria-label="Delete">${icon('trash', 15)}</button></div>` : ''}</td></tr>`)}</tbody></table></div>`,
      addons: () => h`<div class="callout info mb16">${icon('info')}<div class="sm">Shown under “Add more” on the order summary (handwritten notes, a test pass …). Students can add them to a plan.</div></div>
        ${m ? h`<div class="row mb12"><button class="btn" data-act="addon">${icon('plus', 15)} Add an add-on</button></div>` : ''}
        ${r.addons.length ? h`<div class="col gap12">${join(r.addons, a => h`<div class="card row top">${a.img ? h`<img src="${a.img}" alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover">` : h`<span class="av">${icon('gift', 18)}</span>`}
          <div class="grow"><div class="row wrap gap6"><b>${a.title}</b>${UI.pill(a.kind === 'notes' ? 'Notes' : a.kind === 'pass' ? 'Test pass' : 'Other', 'gold')}${a.active ? '' : UI.pill('Hidden', 'bad')}</div>
            ${a.body ? h`<div class="sm mut mt4">${a.body}</div>` : ''}<div class="mt8"><b>${rs(a.price)}</b> ${a.mrp ? h`<s class="mut sm">${rs(a.mrp)}</s>` : ''}</div></div>
          ${m ? h`<div class="col gap6"><button class="btn xs" data-act="addon" data-id="${a.id}">${icon('edit', 13)} Edit</button><button class="btn xs danger" data-act="addonDel" data-id="${a.id}">${icon('trash', 13)} Delete</button></div>` : ''}</div>`)}</div>`
          : h`<div class="card">${UI.empty({ icon: 'gift', title: 'No add-ons yet', text: 'Add handwritten notes, a test pass or anything else students can add to a plan.' })}</div>`}`,
      extras: () => h`<div class="card"><b>Donation amounts</b><div class="sm mut mt4">Students can add one of these to an order (“Support Aspiron”). Up to 8 amounts.</div>
          <div class="row wrap gap8 mt12">${join(r.donations, n => h`<span class="chip">₹${n}</span>`)}</div>${m ? h`<button class="btn sm mt12" data-act="don">${icon('edit', 14)} Change amounts</button>` : ''}</div>
        <div class="card mt16"><div class="row"><b class="grow">Plan coupons</b>${m ? h`<button class="btn sm" data-act="coupon">${icon('plus', 14)} New coupon</button>` : ''}</div>
          <div class="sm mut mt4">Only for plans (the store's coupons stay on the store). A coupon takes money off the plan price.</div>
          ${r.coupons.length ? h`<div class="col gap8 mt12">${join(r.coupons, c => h`<div class="row wrap gap8" style="padding:8px 0;border-top:1px solid var(--line)"><b class="mono">${c.code}</b>${UI.pill(c.kind === 'pct' ? c.value + '% off' : '₹' + c.value + ' off', 'ok')}<span class="sm mut grow">${(c.plans || []).map(k => PLN[k] || k).join(', ')}${c.ends_at ? ' · until ' + fmt.dt(c.ends_at) : ''}</span>${c.active ? '' : UI.pill('Off', 'bad')}
            ${m ? h`<button class="btn xs" data-act="coupon" data-code="${c.code}">${icon('edit', 13)}</button><button class="btn xs danger" data-act="cpDel" data-code="${c.code}">${icon('trash', 13)}</button>` : ''}</div>`)}</div>` : h`<div class="sm mut mt12">No plan coupons yet.</div>`}</div>`,
      notify: () => h`<div class="callout info mb16">${icon('info')}<div class="sm">Payments are not open yet. These students tapped <b>Notify me</b> on the order summary (their latest choice per plan). Nothing was charged.</div></div>
        ${r.notify.length ? h`<div class="card pad0" style="overflow:auto"><table class="tbl"><thead><tr><th>Student</th><th>Plan</th><th>Add-ons</th><th>Donation</th><th>Coupon</th><th>Total</th><th>When</th></tr></thead><tbody>
          ${join(r.notify, n => h`<tr><td><b>${n.name || 'Student'}</b><div class="xs mut">${fmt.mobile(n.mobile)}</div></td><td>${PLN[n.plan] || n.plan}</td><td>${(n.addons || []).length || '—'}</td><td>${n.donation ? '₹' + n.donation : '—'}</td><td>${n.coupon || '—'}</td><td><b>${rs(n.total)}</b></td><td class="xs mut">${fmt.dt(n.at)}</td></tr>`)}</tbody></table></div>`
          : h`<div class="card">${UI.empty({ icon: 'bell', title: 'Nobody yet', text: 'Students who tap Notify me on the order summary show here.' })}</div>`}`
    };
    AX.set(ctx.el, body[tab]());
    AX.act(ctx.el, {
      plan(el) { const p = r.plans.find(x => x.key === el.dataset.k); if (!p) return;
        UI.modal({ title: 'Edit ' + p.title, size: 'narrow', body: h`<form id="plf" class="col gap16">${AX.f.input({ name: 'title', label: 'Name', value: p.title, max: 40 })}${AX.f.input({ name: 'tagline', label: 'One line about it', value: p.tagline, max: 120 })}
            <div class="row gap12">${AX.f.input({ name: 'price', label: 'Price ₹ (empty = coming soon)', value: p.price == null ? '' : p.price, type: 'number' })}${AX.f.input({ name: 'mrp', label: 'MRP ₹ (crossed out)', value: p.mrp == null ? '' : p.mrp, type: 'number' })}</div>
            ${AX.f.input({ name: 'days', label: 'Days on the account', value: p.days, type: 'number' })}${AX.f.switch({ name: 'active', value: p.active, label: 'Show to students' })}</form>`,
          foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="ok">${icon('check', 16)} Save</button>`,
          onOpen(mo, close) { AX.act(mo, { async ok(b) { const d = AX.f.read(mo.querySelector('#plf')); await UI.busy(b, async () => { if (await save('plan_save', { key: p.key, title: d.title, tagline: d.tagline, price: String(d.price || '').trim(), mrp: String(d.mrp || '').trim(), days: String(d.days || '365'), active: !!d.active })) close(true); }); } }); } }); },
      row(el) { const x = r.rows.find(y => y.id === el.dataset.id) || { section: '', label: '', info: '', v_free: 'no', v_basic: 'yes', v_pro: 'yes', v_ultra: 'yes', sort: (r.rows.length + 1) };
        UI.modal({ title: x.id ? 'Edit row' : 'New row', size: 'narrow', body: h`<form id="rwf" class="col gap16">${AX.f.input({ name: 'section', label: 'Section (e.g. Pro)', value: x.section, max: 40 })}${AX.f.input({ name: 'label', label: 'Feature', value: x.label, max: 80 })}
            ${AX.f.input({ name: 'info', label: 'Short info (shown on tap, optional)', value: x.info, max: 300 })}
            <div class="grid g2">${join([['free', 'Free'], ['basic', 'Basic'], ['pro', 'Pro'], ['ultra', 'Ultra']], ([k, l]) => AX.f.input({ name: k, label: l + ' (yes / no / demo / text)', value: x['v_' + k], max: 20 }))}</div>
            ${AX.f.input({ name: 'sort', label: 'Order', value: x.sort, type: 'number' })}</form>`,
          foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="ok">${icon('check', 16)} Save</button>`,
          onOpen(mo, close) { AX.act(mo, { async ok(b) { const d = AX.f.read(mo.querySelector('#rwf')); await UI.busy(b, async () => { if (await save('row_save', Object.assign({ id: x.id || '' }, d, { sort: String(d.sort || 0) }))) close(true); }); } }); } }); },
      async rowDel(el) { if (await UI.confirm({ title: 'Delete this row?', yes: 'Delete', tone: 'danger' })) save('row_delete', { id: el.dataset.id }, 'Deleted'); },
      addon(el) { const a = r.addons.find(y => y.id === el.dataset.id) || { kind: 'notes', title: '', body: '', price: '', mrp: '', img: '', active: true, sort: r.addons.length + 1 }; let img = a.img || '';
        const pic = () => img ? h`<img src="${img}" alt="" style="width:84px;height:84px;border-radius:14px;object-fit:cover">` : h`<span class="xs mut">No picture</span>`;
        UI.modal({ title: a.id ? 'Edit add-on' : 'New add-on', size: 'narrow', body: h`<form id="adf" class="col gap16">${AX.f.select({ name: 'kind', label: 'Type', value: a.kind, options: [{ value: 'notes', label: 'Handwritten notes' }, { value: 'pass', label: 'Test pass' }, { value: 'other', label: 'Other' }] })}
            ${AX.f.input({ name: 'title', label: 'Name', value: a.title, max: 80 })}${AX.f.input({ name: 'body', label: 'What is in it', value: a.body, max: 400 })}
            <div class="row gap12">${AX.f.input({ name: 'price', label: 'Price ₹', value: a.price, type: 'number' })}${AX.f.input({ name: 'mrp', label: 'MRP ₹ (optional)', value: a.mrp == null ? '' : a.mrp, type: 'number' })}</div>
            <div class="fld"><label>Picture</label><div class="row gap12"><div id="adp">${pic()}</div><button type="button" class="btn sm" data-act="pick">${icon('image', 14)} Choose</button><button type="button" class="btn sm ghost" data-act="rm">Remove</button></div></div>
            ${AX.f.input({ name: 'sort', label: 'Order', value: a.sort, type: 'number' })}${AX.f.switch({ name: 'active', value: a.active, label: 'Show to students' })}</form>`,
          foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="ok">${icon('check', 16)} Save</button>`,
          onOpen(mo, close) { AX.act(mo, {
            async pick() { const f = await AX.u.pickFile('image/png,image/jpeg,image/webp'); if (!f) return; let out = null;
              for (const [mx, q] of [[900, .82], [700, .75], [520, .7]]) { try { out = await AX.u.compressImage(f, { max: mx, quality: q }); } catch (e) { out = null; } if (out && out.length <= 300000) break; }
              if (!out || out.length > 300000) { UI.toast(ERR.img, { tone: 'bad' }); return; } img = out; AX.set(mo.querySelector('#adp'), pic()); },
            rm() { img = ''; AX.set(mo.querySelector('#adp'), pic()); },
            async ok(b) { const d = AX.f.read(mo.querySelector('#adf')); await UI.busy(b, async () => { if (await save('addon_save', { id: a.id || '', kind: d.kind, title: d.title, body: d.body, price: String(d.price || '').trim(), mrp: String(d.mrp || '').trim(), img, active: !!d.active, sort: String(d.sort || 0) })) close(true); }); } }); } }); },
      async addonDel(el) { if (await UI.confirm({ title: 'Delete this add-on?', yes: 'Delete', tone: 'danger' })) save('addon_delete', { id: el.dataset.id }, 'Deleted'); },
      async don() { const v = await UI.prompt({ title: 'Donation amounts', label: 'Amounts in ₹, separated by commas (up to 8)', value: r.donations.join(', '), yes: 'Save' }); if (v === null) return;
        const L = String(v).split(/[,\s]+/).filter(Boolean).map(Number); if (L.some(n => !Number.isInteger(n))) { UI.toast(ERR.amounts, { tone: 'bad' }); return; } save('donations', { amounts: L }); },
      coupon(el) { const c = r.coupons.find(y => y.code === el.dataset.code) || { code: '', kind: 'pct', value: '', plans: ['pro', 'ultra'], ends_at: null, active: true };
        UI.modal({ title: c.code ? 'Edit ' + c.code : 'New plan coupon', size: 'narrow', body: h`<form id="cpf" class="col gap16">${AX.f.input({ name: 'code', label: 'Code', value: c.code, max: 24, placeholder: 'e.g. PRO50' })}
            <div class="row gap12">${AX.f.select({ name: 'kind', label: 'Type', value: c.kind, options: [{ value: 'pct', label: '% off' }, { value: 'flat', label: '₹ off' }] })}${AX.f.input({ name: 'value', label: 'Value', value: c.value, type: 'number' })}</div>
            <div class="fld"><label>For plans</label><div class="row wrap gap12">${join(['basic', 'pro', 'ultra'], k => AX.f.check({ name: 'p_' + k, value: (c.plans || []).includes(k), label: PLN[k] }))}</div></div>
            ${AX.f.input({ name: 'ends', label: 'Valid until (optional)', type: 'date', value: c.ends_at ? new Date(c.ends_at).toISOString().slice(0, 10) : '' })}${AX.f.switch({ name: 'active', value: c.active, label: 'On' })}</form>`,
          foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="ok">${icon('check', 16)} Save</button>`,
          onOpen(mo, close) { AX.act(mo, { async ok(b) { const d = AX.f.read(mo.querySelector('#cpf')); const ends = d.ends ? String(new Date(d.ends + 'T23:59:59').getTime()) : '';
            await UI.busy(b, async () => { if (await save('coupon_save', { code: String(d.code || '').trim().toUpperCase(), kind: d.kind, value: String(d.value || '').trim(), plans: ['basic', 'pro', 'ultra'].filter(k => d['p_' + k]), ends_at: ends, active: !!d.active })) close(true); }); } }); } }); },
      async cpDel(el) { if (await UI.confirm({ title: 'Delete ' + el.dataset.code + '?', yes: 'Delete', tone: 'danger' })) save('coupon_delete', { code: el.dataset.code }, 'Deleted'); }
    });
  }
});
})();
