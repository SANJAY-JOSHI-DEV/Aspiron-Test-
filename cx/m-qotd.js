/* =====================================================================
   Question of the Day: the stories on the student Home. Pick Question bank questions for a day; students see one circle per subject.
   Server: cbt_admin_qotd (supabase_v88_qotd.sql) · questions come from cbt_admin_qbank (the Question bank page writes new ones).
   v93 (cbt_admin_qotd_add): Add questions first asks how — write a question, take questions from a test of a series, or the
   Question bank. A written or test question is saved in the Question bank too. A test whose result is not out is refused.
   Only text questions can be picked (no picture); a question of a live test waits for its result time.
   ===================================================================== */
(function () {
'use strict';
const { h, raw, icon, join, ui: UI, fmt } = AX;
const can = () => AX.can('content', 'manage');
const call = (a, d) => AX.api.call('cbt_admin_qotd', a, d || {});
const bank = (a, d) => AX.api.call('cbt_admin_qbank', a, d || {});
const load = force => AX.cache.get('qotd', () => call('list', {}), 20000, force);
const missing = r => r && (r.error === 'missing' || (r.error === 'server' && (r.status === 404 || r.status === 400)));
// subject and chapter names come from pyq-syllabus.js (the same file the Question bank page loads)
let sylP = null;
const syl = () => sylP || (sylP = window.PYQ_SYL ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'pyq-syllabus.js?v=3'; s.onload = res; s.onerror = () => { sylP = null; rej(new Error('syllabus')); }; document.head.appendChild(s); }));
const SUBS = () => { try { return window.qbSubjects ? window.qbSubjects() : window.PYQ_SYL.NEET.subjects; } catch (e) { return []; } };
const subName = s => { const x = SUBS().find(y => y.id === s); return x ? x.name : (s ? String(s).replace(/\b\w/g, c => c.toUpperCase()) : 'General'); };
const chapName = (s, c) => { if (!c) return ''; const x = SUBS().find(y => y.id === s), ch = x && x.chapters.find(y => y.id === c); return ch ? ch.name : c; };
const dayName = (d, today) => { const t = new Date(d + 'T00:00:00'), diff = Math.round((t - new Date(today + 'T00:00:00')) / 864e5), nm = t.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return diff === 0 ? 'Today · ' + nm : diff === 1 ? 'Tomorrow · ' + nm : diff === -1 ? 'Yesterday · ' + nm : nm; };
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
const setupBox = () => h`<div class="card">${UI.empty({ tone: 'lock', icon: 'db', title: 'One-time setup needed', text: 'Run supabase_v88_qotd.sql once in Supabase → SQL Editor, then supabase_v35_admin_team.sql again, and refresh this page.' })}</div>`;
const chapOpts = s => { const x = SUBS().find(y => y.id === s); return x ? h`<option value="">All chapters</option>${join([11, 12], cl => { const L = x.chapters.filter(c => c.cls === cl && !c.old); return L.length ? h`<optgroup label="Class ${cl}">${join(L, c => h`<option value="${c.id}">${c.name}</option>`)}</optgroup>` : ''; })}` : h`<option value="">All chapters</option>`; };
let CUR = null;
const changed = msg => { AX.cache.drop('qotd'); if (msg) UI.toast(msg); if (CUR && CUR.ctx.alive()) CUR.ctx.reload(); };

AX.mod({
  id: 'qotd', title: 'Question of the Day', short: 'QOTD', icon: 'target', group: 'Tests & questions', order: 45, perm: 'content',
  sub: 'Stories on the student Home: write questions, or pick them from a test series or the Question bank, for a day.',
  async render(ctx) {
    CUR = { ctx };
    AX.set(ctx.el, UI.skeleton(4));
    try { await syl(); } catch (e) { /* names fall back to the stored ids */ }
    const r = await load(true);
    if (!ctx.alive()) return;
    ctx.head({ title: 'Question of the Day', sub: 'Students see one story circle per subject on Home. Pick 3 to 5 questions per subject for each day.',
      actions: can() ? h`<button class="btn pri" data-act="add" data-day="${(r && r.today) || ''}">${icon('plus', 16)} Add questions</button>` : '' });
    if (missing(r)) return AX.set(ctx.el, setupBox());
    if (!r || !r.ok) { AX.set(ctx.el, UI.errorBox(r || {})); AX.act(ctx.el, { retry: () => ctx.reload() }); return; }
    const items = r.items || [], today = r.today, days = [...new Set(items.map(x => x.day))].sort().reverse();
    const up = days.filter(d => d >= today).reverse(), past = days.filter(d => d < today);
    const todayN = items.filter(x => x.day === today).length;
    const card = d => { const L = items.filter(x => x.day === d), subs = [...new Set(L.map(x => x.s))];
      return h`<section class="card pad0 qd-day ${d === today ? 'now' : ''}"><div class="qd-dh"><div class="grow"><b>${dayName(d, today)}</b><div class="xs mut">${fmt.plural(L.length, 'question')} · ${subs.map(subName).join(', ')}</div></div>${can() ? h`<button class="btn xs soft" data-act="add" data-day="${d}">${icon('plus', 13)} Add</button>` : ''}</div>
        <div class="list">${join(L, x => h`<div class="li qd-row"><span class="pill info">${subName(x.s)}</span>
          <div class="grow"><div class="t qd-q">${x.q}</div><div class="s">${[chapName(x.s, x.c), 'Right answer ' + 'ABCD'[x.a], x.n ? fmt.plural(x.n, 'answer') + ' · ' + Math.round(x.r * 100 / x.n) + '% right' : 'No answers yet'].filter(Boolean).join(' · ')}</div>
            <div class="row wrap gap6">${x.held ? UI.pill('Hidden: live test, waits for its result', 'warn') : ''}${x.pic ? UI.pill('Has a picture: students do not see it', 'bad') : ''}${x.on ? '' : UI.pill('Switched off in the bank', 'bad')}</div></div>
          ${can() ? h`<button class="ibtn sm" data-act="move" data-id="${x.id}" data-day="${x.day}" aria-label="Move to another day" title="Move to another day">${icon('calendar', 16)}</button><button class="ibtn sm" data-act="remove" data-id="${x.id}" aria-label="Take off" title="Take off">${icon('trash', 16)}</button>` : ''}</div>`)}</div></section>`; };
    AX.set(ctx.el, h`<div class="callout ${todayN ? 'ok' : 'info'}">${icon(todayN ? 'check' : 'info')}<div class="sm">${todayN ? h`<b>Today has ${fmt.plural(todayN, 'question')}.</b> Students see them as story circles on Home.` : h`<b>Nothing is set for today.</b> Students see no stories. ${can() ? 'Tap “Add questions”.' : ''}`}
        The day changes at midnight, India time. A student can answer a question once; the right answer and explanation show after they answer.</div></div>
      ${!days.length ? h`<div class="card mt16">${UI.empty({ icon: 'target', title: 'No questions on any day yet', text: 'Write a question, or pick from a test series or the Question bank.', action: can() ? h`<button class="btn pri" data-act="add" data-day="${today}">${icon('plus', 16)} Add questions</button>` : '' })}</div>` : ''}
      ${up.length ? h`<div class="mt16">${join(up, card)}</div>` : ''}
      ${past.length ? h`<h3 class="mt24 qd-h">Earlier</h3><div>${join(past, card)}</div>` : ''}`);
    AX.act(ctx.el, { retry: () => ctx.reload() });
    const ph = document.getElementById('ax-ph');
    const A = {
      add: el => addModal(el.dataset.day || today, today),
      move: el => moveModal(el.dataset.id, el.dataset.day, today),
      async remove(el) { if (!(await UI.confirm({ title: 'Take this question off the day?', text: 'Students’ answers to it are removed too. The question stays in the Question bank.', yes: 'Take off', tone: 'danger' }))) return;
        const x = await call('remove', { id: el.dataset.id }); if (!x.ok) return UI.err(x); changed('Taken off'); }
    };
    AX.act(ctx.el, A); if (ph) AX.act(ph, A);
  }
});

function moveModal(id, day, today) {
  UI.modal({ title: 'Move to another day', size: 'narrow',
    body: h`<div class="fld"><label for="qm-d">Day</label><input class="inp" id="qm-d" type="date" value="${day}" min="${addDays(today, -1)}" max="${addDays(today, 365)}"></div>`,
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="go">${icon('check', 16)} Move</button>`,
    onOpen(m, close) { AX.act(m, { async go(b) { const d = m.querySelector('#qm-d').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return UI.toast('Pick a day', { tone: 'warn' });
      await UI.busy(b, async () => { const x = await call('move', { id, date: d }); if (!x.ok) return UI.toast(x.error === 'exists' ? 'This question is already on that day' : x.error === 'full' ? 'That day already has 40 questions' : 'Could not move it', { tone: 'warn' }); close(true); changed('Moved'); }); } }); } });
}

// pick questions from the Question bank (search + subject), then put them on a day
function bankModal(day, today) {
  const sel = new Set(); let f = { s: '', c: '', q: '' }, page = 0, rows = [], total = 0, busy = false;
  const body = () => h`<div class="fld"><label for="qa-d">Show on</label><div class="row gap8 wrap"><input class="inp" id="qa-d" type="date" value="${day}" min="${addDays(today, -1)}" max="${addDays(today, 365)}" style="width:auto">
      <button class="btn xs ghost" data-act="dayTo" data-d="${today}">Today</button><button class="btn xs ghost" data-act="dayTo" data-d="${addDays(today, 1)}">Tomorrow</button></div></div>
    <div class="row gap8 wrap mt12"><div class="inp-wrap search grow">${icon('search', 16)}<input class="inp sm" id="qa-q" type="search" placeholder="Search the Question bank…" value="${f.q}" autocomplete="off"></div>
      <select class="inp sm" id="qa-s" aria-label="Subject" style="width:auto"><option value="">All subjects</option>${join(SUBS(), x => h`<option value="${x.id}" ${x.id === f.s ? raw('selected') : ''}>${x.name}</option>`)}</select>
      <select class="inp sm" id="qa-c" aria-label="Chapter" style="width:auto;max-width:100%" disabled><option value="">All chapters</option></select></div>
    <div id="qa-l" class="mt12"></div>`;
  const button = m => { const n = m.querySelector('#qa-go'); if (n) { n.disabled = !sel.size; n.querySelector('span').textContent = sel.size ? 'Add ' + fmt.plural(sel.size, 'question') : 'Add'; } };   // a tick changes only the button (the list keeps its scroll)
  const list = m => {
    const L = m.querySelector('#qa-l');
    AX.set(L, rows.length ? h`<div class="card pad0 list qa-list">${join(rows, x => h`<label class="li qa-r ${x.img ? 'off' : ''}"><input type="checkbox" data-id="${x.id}" ${sel.has(x.id) ? raw('checked') : ''} ${x.img ? raw('disabled') : ''}>
        <span class="pill info">${subName(x.s)}</span><span class="grow"><span class="t qd-q">${x.q}</span><span class="s">${[chapName(x.s, x.c), x.img ? 'Has a picture: cannot be used' : '', x.src && /^test:/.test(x.src) ? 'From a test' : ''].filter(Boolean).join(' · ')}</span></span></label>`)}</div>
      ${rows.length < total ? h`<div class="row center mt12"><button class="btn sm" data-act="more">Show more · ${total - rows.length} left</button></div>` : ''}`
      : h`<div class="card">${UI.empty({ icon: 'db', title: busy ? 'Loading…' : 'No questions found', text: busy ? '' : 'The Question bank has nothing for this search. Write or import questions on the Question bank page.', action: busy ? '' : h`<a class="btn" href="#/qbank" data-close>${icon('db', 15)} Open the Question bank</a>` })}</div>`);
    button(m);
  };
  const fetchRows = async (m, more) => {
    busy = true; if (!more) { rows = []; page = 0; list(m); }
    const r = await bank('list', { f: Object.assign(f.s ? { s: [f.s] } : {}, f.c ? { c: [f.c] } : {}), q: f.q, on: true, page }); busy = false;
    if (!r.ok) { AX.set(m.querySelector('#qa-l'), UI.errorBox(r)); return; }
    total = r.total || 0; rows = rows.concat(r.items || []); list(m);
  };
  UI.modal({ title: 'Add questions to a day', sub: 'Pick from the Question bank. Only text questions work as stories.', size: 'lg', body: body(),
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="qa-go" data-act="go" disabled>${icon('check', 16)}<span>Add</span></button>`,
    onOpen(m, close) {
      fetchRows(m);
      const go = AX.u.debounce(() => { f.q = m.querySelector('#qa-q').value.trim(); fetchRows(m); }, 300);
      m.querySelector('#qa-q').addEventListener('input', go);
      m.querySelector('#qa-s').addEventListener('change', e => { f.s = e.target.value; f.c = ''; const cs = m.querySelector('#qa-c'); AX.set(cs, chapOpts(f.s)); cs.disabled = !f.s; fetchRows(m); });
      m.querySelector('#qa-c').addEventListener('change', e => { f.c = e.target.value; fetchRows(m); });
      m.addEventListener('change', e => { const c = e.target.closest('input[data-id]'); if (!c) return; c.checked ? sel.add(c.dataset.id) : sel.delete(c.dataset.id); button(m); });
      AX.act(m, {
        dayTo: b => { m.querySelector('#qa-d').value = b.dataset.d; },
        more: async () => { page++; await fetchRows(m, true); },
        async go(b) { const d = m.querySelector('#qa-d').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return UI.toast('Pick a day', { tone: 'warn' });
          await UI.busy(b, async () => { const x = await call('add', { date: d, ids: [...sel] });
            if (!x.ok) { if (x.added) changed(); return UI.toast(x.error === 'full' ? 'That day is full (40 questions)' + (x.added ? ' · ' + x.added + ' added' : '') : x.error === 'date' ? 'Pick today or a later day' : 'Could not add', { tone: 'warn', ms: 5000 }); }
            const bits = [x.skipped ? x.skipped + ' skipped (already there or switched off)' : '', x.pic ? x.pic + ' with a picture' : '', x.held ? x.held + ' held back (live test)' : ''].filter(Boolean);
            close(true); changed('Added ' + x.added + (bits.length ? ' · ' + bits.join(' · ') : '')); });
        }
      });
    } });
}

// ---------- v93: Add questions → choose how ----------
const add = (a, d) => AX.api.call('cbt_admin_qotd_add', a, d || {});
const dayField = (id, day, today) => h`<div class="fld"><label for="${id}">Show on</label><div class="row gap8 wrap"><input class="inp" id="${id}" type="date" value="${day}" min="${addDays(today, -1)}" max="${addDays(today, 365)}" style="width:auto">
  <button type="button" class="btn xs ghost" data-act="dayTo" data-d="${today}">Today</button><button type="button" class="btn xs ghost" data-act="dayTo" data-d="${addDays(today, 1)}">Tomorrow</button></div></div>`;
const subOpts = v => join(SUBS(), x => h`<option value="${x.id}" ${x.id === v ? raw('selected') : ''}>${x.name}</option>`);
const guessSub = t => { const s = String(t || '').toLowerCase(); return /phy/.test(s) ? 'phy' : /chem/.test(s) ? 'chem' : /bio|bot|zoo/.test(s) ? 'bio' : /math/.test(s) ? 'math' : ''; };
const ERR93 = { q: 'Write the question (at least 5 letters).', options: 'Fill all 4 options.', answer: 'Choose the right answer.', subject: 'Choose a subject.', date: 'Pick today or a later day.', full: 'That day already has 40 questions.', held: 'This test’s result is not out yet: its questions would show the answers early.', ids: 'Tick at least one question.', test: 'Choose a test.' };
const err93 = x => ERR93[x && x.error] || (missing(x) ? 'Run supabase_v93_qotd_sources.sql in Supabase first, then supabase_v35_admin_team.sql again.' : AX.errText(x));

function addModal(day, today) {
  UI.modal({ title: 'Add questions to a day', sub: 'How do you want to add them?', size: 'narrow',
    body: h`<div class="col gap12">
      <button class="qa-way" data-act="way" data-w="write"><span class="av">${icon('edit', 20)}</span><span class="grow"><b>Write a question</b><span class="xs mut">Type the question, 4 options, the right answer and the explanation.</span></span>${icon('chevR', 16)}</button>
      <button class="qa-way" data-act="way" data-w="test"><span class="av">${icon('layers', 20)}</span><span class="grow"><b>From a test series</b><span class="xs mut">Pick a series, then a test, then tick its questions.</span></span>${icon('chevR', 16)}</button>
      <button class="qa-way" data-act="way" data-w="bank"><span class="av">${icon('db', 20)}</span><span class="grow"><b>From the Question bank</b><span class="xs mut">Search the bank by subject and chapter.</span></span>${icon('chevR', 16)}</button></div>`,
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button>`,
    onOpen(m, close) { AX.act(m, { way(b) { const w = b.dataset.w; close(true); setTimeout(() => (w === 'write' ? writeModal : w === 'test' ? testModal : bankModal)(day, today), 60); } }); } });
}

function writeModal(day, today) {
  UI.modal({ title: 'Write a question', sub: 'It is saved in the Question bank too, so students can practise it later.', size: 'lg',
    body: h`<form id="qw" class="col gap16" onsubmit="return false">${dayField('qw-d', day, today)}
      <div class="row gap12 wrap"><div class="fld"><label for="qw-s">Subject</label><select class="inp" id="qw-s" name="subject"><option value="">Choose…</option>${subOpts('')}</select></div>
        <div class="fld grow"><label for="qw-c">Chapter (optional)</label><select class="inp" id="qw-c" name="chapter" disabled><option value="">Choose a subject first</option></select></div></div>
      ${AX.f.textarea({ name: 'q', label: 'Question', rows: 3, max: 2000 })}
      <div class="fld"><label>Options · tick the right one</label><div class="col gap8">${join([0, 1, 2, 3], i => h`<div class="row gap8 qw-o"><input type="radio" name="answer" value="${i}" id="qw-a${i}" aria-label="${'ABCD'[i]} is right"><label class="qw-k" for="qw-a${i}">${'ABCD'[i]}</label><input class="inp grow" name="o${i}" maxlength="300" autocomplete="off" aria-label="Option ${'ABCD'[i]}"></div>`)}</div></div>
      ${AX.f.textarea({ name: 'explanation', label: 'Explanation (shown after the student answers)', rows: 3, max: 3000 })}</form>`,
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" data-act="go">${icon('check', 16)} Save and add</button>`,
    onOpen(m, close) {
      m.querySelector('#qw-s').addEventListener('change', e => { const cs = m.querySelector('#qw-c'); AX.set(cs, e.target.value ? chapOpts(e.target.value) : h`<option value="">Choose a subject first</option>`); cs.disabled = !e.target.value; });
      AX.act(m, {
        dayTo: b => { m.querySelector('#qw-d').value = b.dataset.d; },
        async go(b) { const f = m.querySelector('#qw'), v = n => (f.querySelector('[name="' + n + '"]') || {}).value || '', a = f.querySelector('[name=answer]:checked');
          const d = { date: m.querySelector('#qw-d').value, subject: v('subject'), chapter: v('chapter'), q: v('q').trim(), options: [0, 1, 2, 3].map(i => v('o' + i).trim()), answer: a ? a.value : '', explanation: v('explanation').trim() };
          if (!d.subject) return UI.toast(ERR93.subject, { tone: 'warn' }); if (d.q.length < 5) return UI.toast(ERR93.q, { tone: 'warn' }); if (d.options.some(o => !o)) return UI.toast(ERR93.options, { tone: 'warn' }); if (!a) return UI.toast(ERR93.answer, { tone: 'warn' });
          await UI.busy(b, async () => { const x = await add('write', d); if (!x.ok) return UI.toast(err93(x), { tone: 'warn', ms: 5000 }); close(true); changed('Question added'); }); }
      }); } });
}

function testModal(day, today) {
  let S = null, T = null, sel = new Set();
  const button = m => { const n = m.querySelector('#qt-go'); if (n) { n.disabled = !sel.size || !T || T.held; n.querySelector('span').textContent = sel.size ? 'Add ' + fmt.plural(sel.size, 'question') : 'Add'; } };
  const qlist = m => { const L = m.querySelector('#qt-l');
    if (!T) return AX.set(L, h`<div class="card">${UI.empty({ icon: 'layers', title: 'Choose a test', text: 'Pick a test series and one of its tests above.' })}</div>`);
    if (T.loading) return AX.set(L, UI.skeleton(3));
    if (T.held) return AX.set(L, h`<div class="callout warn">${icon('lock')}<div class="sm">${ERR93.held} Pick it after its result time.</div></div>`);
    AX.set(L, T.items.length ? h`<div class="row gap8 mb8"><button type="button" class="btn xs ghost" data-act="all">Tick all usable</button><span class="xs mut">${fmt.plural(T.items.filter(x => x.use).length, 'usable question')} of ${T.items.length}</span></div>
      <div class="card pad0 list qa-list">${join(T.items, x => h`<label class="li qa-r ${x.use ? '' : 'off'}"><input type="checkbox" data-i="${x.i}" ${sel.has(x.i) ? raw('checked') : ''} ${x.use ? '' : raw('disabled')}>
        <span class="pill">Q${x.i + 1}</span><span class="grow"><span class="t qd-q">${x.q || '(no text)'}</span><span class="s">${[x.sec, x.use ? 'Answer ' + 'ABCD'[x.a] : 'Has a picture or not 4 options: cannot be used', x.there ? 'Already in the Question bank' : ''].filter(Boolean).join(' · ')}</span></span></label>`)}</div>`
      : h`<div class="card">${UI.empty({ icon: 'file', title: 'This test has no questions' })}</div>`);
    button(m); };
  UI.modal({ title: 'From a test series', sub: 'Ticked questions are copied into the Question bank once and put on the day. Text questions only.', size: 'lg',
    body: h`${dayField('qt-d', day, today)}<div class="grid g2 gap12 mt12"><div class="fld"><label for="qt-s">Test series</label><select class="inp" id="qt-s"><option value="">Loading series…</option></select></div>
      <div class="fld"><label for="qt-t">Test</label><select class="inp" id="qt-t" disabled><option value="">Choose a test</option></select></div></div>
      <div class="fld mt12"><label for="qt-sub">Subject of these questions (one story circle per subject)</label><select class="inp" id="qt-sub" style="max-width:320px"><option value="">Choose…</option>${subOpts('')}</select></div>
      <div id="qt-l" class="mt12"></div>`,
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="qt-go" data-act="go" disabled>${icon('check', 16)}<span>Add</span></button>`,
    async onOpen(m, close) {
      qlist(m);
      const r = await add('series', {});
      const ss = m.querySelector('#qt-s');
      if (!r.ok) { AX.set(m.querySelector('#qt-l'), h`<div class="callout warn">${icon('alert')}<div class="sm">${err93(r)}</div></div>`); AX.set(ss, h`<option value="">—</option>`); return; }
      S = r.series || [];
      AX.set(ss, h`<option value="">Choose a test series</option>${join(S, s => h`<option value="${s.id}">${s.title} (${s.tests.length})</option>`)}`);
      ss.addEventListener('change', () => { const s = S.find(x => x.id === ss.value), ts = m.querySelector('#qt-t'); T = null; sel.clear();
        AX.set(ts, h`<option value="">Choose a test</option>${join(s ? s.tests : [], t => h`<option value="${t.id}">${t.title} · ${t.n} Q${t.held ? ' · result not out' : ''}</option>`)}`); ts.disabled = !s; qlist(m); button(m); });
      m.querySelector('#qt-t').addEventListener('change', async e => { sel.clear(); if (!e.target.value) { T = null; return qlist(m); }
        T = { loading: true }; qlist(m); const id = e.target.value, x = await add('test', { test_id: id }); if (m.querySelector('#qt-t').value !== id) return;
        T = x.ok ? { id, held: !!x.held, items: x.items || [] } : null; if (!x.ok) UI.toast(err93(x), { tone: 'warn' });
        const sub = m.querySelector('#qt-sub'); if (T && !sub.value) { const g = guessSub(((T.items.find(q => q.sec) || {}).sec) || (m.querySelector('#qt-t').selectedOptions[0] || {}).textContent); if (g) sub.value = g; }
        qlist(m); });
      m.addEventListener('change', e => { const c = e.target.closest('input[data-i]'); if (!c) return; const i = +c.dataset.i; c.checked ? sel.add(i) : sel.delete(i); button(m); });
      AX.act(m, {
        dayTo: b => { m.querySelector('#qt-d').value = b.dataset.d; },
        all() { if (!T || !T.items) return; T.items.filter(x => x.use).slice(0, 40).forEach(x => sel.add(x.i)); qlist(m); },
        async go(b) { const sub = m.querySelector('#qt-sub').value; if (!sub) return UI.toast('Choose the subject of these questions (students see one circle per subject).', { tone: 'warn', ms: 4500 });
          await UI.busy(b, async () => { const x = await add('add_test', { date: m.querySelector('#qt-d').value, test_id: T.id, idx: [...sel], subject: sub });
            if (!x.ok) { if (x.added) changed(); return UI.toast(err93(x) + (x.added ? ' · ' + x.added + ' added' : ''), { tone: 'warn', ms: 5000 }); }
            const bits = [x.skipped ? x.skipped + ' already on that day' : '', x.bad ? x.bad + ' could not be used' : ''].filter(Boolean);
            close(true); changed('Added ' + x.added + (bits.length ? ' · ' + bits.join(' · ') : '')); }); }
      }); } });
}

AX.css('qotd', `
.qd-day{margin-top:14px}
.qd-day.now{border-color:var(--pri-line)}
.qd-dh{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--line);background:var(--solid-2)}
.qd-h{font-size:14px;font-weight:700;color:var(--mut)}
.qd-row{align-items:flex-start}
.qd-q{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;white-space:normal}
.qa-list{max-height:min(52vh,480px);overflow:auto}
.qa-r{display:flex;align-items:flex-start;gap:10px;cursor:pointer;border-top:1px solid var(--line);padding:10px 14px}
.qa-r:first-child{border-top:0}
.qa-r.off{opacity:.5;cursor:default}
.qa-r .t,.qa-r .s{display:block}
.qa-r input{margin-top:3px;flex:none}
.qa-way{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--solid)}
.qa-way:hover{border-color:var(--pri-line)}
.qa-way b,.qa-way .xs{display:block}
.qw-o{align-items:center}
.qw-k{width:22px;text-align:center;flex:none;font-weight:700;cursor:pointer}
.qw-o input[type=radio]{flex:none;width:18px;height:18px}
`);
})();
