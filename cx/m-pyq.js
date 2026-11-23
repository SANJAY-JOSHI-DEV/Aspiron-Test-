/* =====================================================================
   PYQ bank: past NEET papers, chapter / topic tagged. Students see chapter-, topic- and year-wise analysis
   and which questions repeat (PYQ Analysis in the app).
   Server: cbt_admin_pyq (supabase_v11_pyq.sql, v93: edit / verify / reports / free chapters / duplicates / history).
   Tagging: pyq-syllabus.js (loaded when this page opens).
   ===================================================================== */
(function () {
'use strict';
const { h, raw, icon, join, ui: UI, fmt } = AX;
const EXAM = 'NEET';
const can = () => AX.can('content', 'manage');
const P = { papers: [], total: 0, rows: null, paper: '', year: 0, only: false, ready: [] };
let sylP = null;
const syl = () => sylP || (sylP = window.PYQ_SYL ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'pyq-syllabus.js?v=5'; s.onload = res; s.onerror = () => { sylP = null; rej(new Error('pyq-syllabus.js')); }; document.head.appendChild(s); }));
const S = () => window.PYQ_SYL[EXAM];
const subj = id => S().subjects.find(s => s.id === id) || S().subjects[0];
const chap = (sid, cid) => (subj(sid).chapters || []).find(c => c.id === cid);
const SUBJ_SHORT = { phy: 'Phy', chem: 'Chem', bio: 'Bio' };
const chOpts = (sid, cid, blank) => h`${blank ? h`<option value="">— chapter —</option>` : ''}${join([11, 12], cl => h`<optgroup label="Class ${cl}">${join(subj(sid).chapters.filter(c => c.cls === cl), c => h`<option value="${c.id}" ${c.id === cid ? raw('selected') : ''}>${c.name}${c.old ? ' (old)' : ''}</option>`)}</optgroup>`)}`;
const tpOpts = (sid, cid, tp) => { const c = chap(sid, cid); return h`<option value="">— topic —</option>${c ? join(c.topics, t => h`<option ${t.name === tp ? raw('selected') : ''}>${t.name}</option>`) : ''}`; };
const sbOpts = sid => join(S().subjects, s => h`<option value="${s.id}" ${s.id === sid ? raw('selected') : ''}>${s.name}</option>`);
const call = (a, d) => AX.api.call('cbt_admin_pyq', a, Object.assign({ exam: EXAM }, d || {}));

AX.mod({
  id: 'pyq', title: 'PYQ bank', icon: 'book', group: 'Tests & questions', order: 60, perm: 'content',
  sub: 'Past papers, tagged by chapter and topic.',
  async render(ctx) {
    const paper = ctx.parts[0] === 'paper' ? ctx.parts[1] : null;
    ctx.head({ title: 'PYQ bank', sub: 'Add past NEET papers. Students see chapter-wise, topic-wise and year-wise analysis in PYQ Analysis, and which questions repeat.', crumb: paper || undefined });
    AX.set(ctx.el, UI.skeleton(5));
    try { await syl(); } catch (e) { AX.set(ctx.el, UI.errorBox({ error: 'server', detail: 'Could not load pyq-syllabus.js' })); return; }
    const r = await call('papers');
    if (!ctx.alive()) return;
    if (!r.ok) { AX.set(ctx.el, r.error === 'missing' ? h`<div class="card">${UI.empty({ tone: 'lock', icon: 'db', title: 'One-time setup needed', text: 'Run supabase_v11_pyq.sql once in Supabase → SQL Editor, then refresh.' })}</div>` : UI.errorBox(r)); AX.act(ctx.el, { retry: () => ctx.reload() }); return; }
    P.papers = r.items || []; P.total = r.total || 0; P.verified = r.verified; P.reports = r.open_reports;
    if (paper) return browse(ctx, paper);
    if (ctx.parts[0] === 'reports') return reports(ctx);
    if (ctx.parts[0] === 'free') return freeCh(ctx);
    if (ctx.parts[0] === 'dups') return dups(ctx);
    return overview(ctx);
  }
});
AX.creates.push({ label: 'PYQ paper', icon: 'book', perm: ['content', 'manage'], run() { AX.go('pyq'); } });

async function overview(ctx) {
  const have = new Set(P.papers.map(p => p.paper));
  const left = S().papers.filter(p => !have.has(p)).length;
  const cat = await AX.data.catalog();
  let idx = []; try { const x = await fetch('pyq-data/index.json', { cache: 'no-cache' }); if (x.ok) idx = (await x.json()).filter(i => (i.exam || 'NEET') === EXAM); } catch (e) {}
  if (!ctx.alive()) return;
  P.ready = idx.filter(i => !have.has(i.paper));
  const tests = (cat.ok && cat.tests) || [];
  AX.set(ctx.el, h`<div class="kpis">${UI.kpi({ label: 'Questions in the bank', value: fmt.num(P.total), icon: 'db', hero: true })}${UI.kpi({ label: 'Papers added', value: P.papers.length, icon: 'book', tone: 'info' })}${UI.kpi({ label: 'Papers left', value: left, icon: 'clock', tone: 'gold', foot: 'from the NEET list' })}${P.verified != null ? UI.kpi({ label: 'Verified answers', value: fmt.num(P.verified), icon: 'check', tone: 'ok', foot: 'of ' + fmt.num(P.total) }) : ''}</div>
    ${P.verified != null ? h`<div class="row wrap gap6 mt16"><a class="btn" href="#/pyq/reports">${icon('alert', 15)} Student reports${P.reports ? h` <b class="pill bad">${P.reports}</b>` : ''}</a><a class="btn" href="#/pyq/free">${icon('lock', 15)} Free chapters</a><a class="btn" href="#/pyq/dups">${icon('copy', 15)} Duplicates & repeats</a>${can() ? h`<button class="btn" data-act="csv">${icon('upload', 15)} Import CSV</button><button class="btn" data-act="addq">${icon('plus', 15)} Add one question</button>` : ''}</div>`
      : h`<div class="card mt16 sm">Run <b>supabase_v93_pyq_analyzer.sql</b> once (then supabase_v35_admin_team.sql) to turn on editing, verification, student reports, free chapters and CSV import.</div>`}
    ${idx.length ? h`<div class="card mt16"><div class="card-h">${icon('download')}<h3>Ready-made papers</h3><span class="grow"></span>${can() && P.ready.length > 1 ? h`<button class="btn sm pri" data-act="all">Add all ${P.ready.length}</button>` : ''}</div>
      <div class="list">${join(idx, i => h`<div class="li" style="padding:10px 0"><span class="av sm" style="--c:#c9a45c">${icon('book', 14)}</span><div class="grow"><div class="t">${i.paper}</div><div class="s">${i.n} questions · answers checked · own explanations</div></div>${have.has(i.paper) ? UI.pill('In bank', 'ok') : can() ? h`<button class="btn sm" data-act="imp" data-f="${i.file}">${icon('plus', 14)} Add</button>` : ''}</div>`)}</div></div>` : ''}
    ${can() ? h`<div class="card mt16" id="pq-add"><div class="card-h">${icon('plus')}<h3>Add questions</h3></div>
      <ol class="sm mut" style="margin:4px 0 0;padding-left:18px;line-height:1.8"><li>Choose the paper (exam + year).</li><li>Choose how you have the questions — paste them, or upload a PDF, Word, text file, photo or Excel/CSV.</li><li>Check the chapter of each question (filled in automatically) and save.</li></ol>
      <div class="form-grid mt12"><div class="fld"><label>1. Paper</label><select class="inp" id="pq-p"><option value="">Choose the paper…</option>${join(S().papers.slice().reverse(), p => h`<option value="${p}">${p}${have.has(p) ? ' ✓ (add more)' : ''}</option>`)}<option value="__c">Other paper…</option></select></div></div>
      <div class="fld mt12"><label>2. How do you have the questions?</label>
        <div class="pq-ways">${join([['paste', 'fileText', 'Paste text', 'Copy from anywhere'], ['pdf', 'file', 'PDF', 'Question paper PDF'], ['docx', 'fileText', 'Word', '.docx file'], ['txt', 'file', 'Text file', '.txt file'], ['image', 'image', 'Photo', 'Read by OCR'], ['csv', 'upload', 'Excel / CSV', 'One row per question'], ['test', 'layers', 'From a test', 'A test you made']], ([k, ic, t, d]) => h`<button type="button" class="pq-way" data-act="way" data-k="${k}">${icon(ic, 20)}<b>${t}</b><small>${d}</small></button>`)}</div></div>
      <div id="pq-tsel" class="row wrap gap6 mt12 hide"><select class="inp" id="pq-t" style="max-width:420px"><option value="">Select a test…</option>${join(tests, t => h`<option value="${t.id}">${t.title} (${t.questions || '?'} Q)</option>`)}</select><button class="btn pri" data-act="load">${icon('wand', 16)} Load questions</button></div>
      <p class="xs faint mt8">Tip: if the PDF has the answer key at the end, it is read too. Diagrams are not stored — such questions are marked "has a diagram" for students.</p>
      <div id="pq-prev"></div></div>` : ''}
    <div class="section-t">Papers in the bank · ${P.papers.length}</div>
    <div class="card pad0 list">${P.papers.length ? join(P.papers, p => h`<div class="li"><span class="av sm" style="--c:${AX.u.hue(p.paper)}">${String(p.year).slice(2)}</span><div class="grow"><div class="t">${p.paper}</div><div class="s">${p.year} · ${fmt.plural(p.n, 'question')} · ${(p.subjects || []).map(s => SUBJ_SHORT[s] || s).join(', ')}${p.verified != null ? h` · ${p.verified === p.n ? '✓ all verified' : p.verified + ' verified'}` : ''}</div></div>
        ${can() && p.verified != null && p.verified < p.n ? h`<button class="btn sm" data-act="verp" data-p="${p.paper}">${icon('check', 14)} Verify all</button>` : ''}
        <a class="btn sm" href="#/pyq/paper/${encodeURIComponent(p.paper)}">${icon('tag', 14)} Check tags</a>${can() ? h`<button class="ibtn sm" data-act="delp" data-p="${p.paper}" aria-label="Delete paper">${icon('trash', 15)}</button>` : ''}</div>`)
      : UI.empty({ icon: 'book', title: 'No papers yet', text: 'Add a ready-made paper or one of your tests above.' })}</div>`);
  AX.act(ctx.el, {
    retry: () => ctx.reload(),
    async imp(el) { await UI.busy(el, async () => { if (await importFile(el.dataset.f, el)) ctx.reload(); }); },
    async all(el) { el.disabled = true; for (let i = 0; i < P.ready.length; i++) { el.textContent = 'Adding ' + P.ready[i].paper + ' (' + (i + 1) + '/' + P.ready.length + ')…'; if (!(await importFile(P.ready[i].file, null, true))) { el.disabled = false; el.textContent = 'Try again'; return ctx.reload(); } } UI.toast(P.ready.length + ' papers added'); ctx.reload(); },
    async verp(el) { const p = el.dataset.p; if (!(await UI.confirm({ title: 'Mark every answer of "' + p + '" as verified?', text: 'Only do this after the answer key of this paper has been checked against the official key. Questions without an answer stay unverified.', yes: 'Yes, verified' }))) return; const x = await call('verify', { paper: p, on: true }); if (!x.ok) return UI.err(x); UI.toast(x.n + ' questions verified'); ctx.reload(); },
    csv: () => csvImport(ctx),
    addq: () => editQ(ctx, null),
    async delp(el) { const p = el.dataset.p; if (!(await UI.confirm({ title: 'Delete "' + p + '"?', text: 'All its questions are removed from the PYQ bank.', yes: 'Delete paper', tone: 'danger' }))) return; const x = await call('delete_paper', { paper: p }); if (!x.ok) return UI.err(x); UI.toast('Deleted'); ctx.reload(); },
    async way(el) {
      const k = el.dataset.k;
      if (k === 'csv') return csvImport(ctx);
      const pp = await pickPaper(ctx, have); if (!pp) return;
      if (k === 'test') { ctx.el.querySelector('#pq-tsel').classList.remove('hide'); ctx.el.querySelector('#pq-t').focus(); return; }
      if (k === 'txt') { const f = await pickFile('.txt,.md,text/plain'); if (!f) return; if (f.size > 3 * 1024 * 1024) return UI.toast('The file is larger than 3 MB', { tone: 'warn' }); AX.imp.raw = await f.text(); }
      const r = await AX.importQuestions({ source: k === 'txt' ? 'paste' : k });
      if (!r || !r.questions || !r.questions.length) return;
      toRows(r.questions, pp); preview(ctx); ctx.el.querySelector('#pq-prev').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    async load(btn) {
      const id = ctx.el.querySelector('#pq-t').value;
      if (!id) return UI.toast('Select the test first', { tone: 'warn' });
      const pp = await pickPaper(ctx, have); if (!pp) return;
      await UI.busy(btn, async () => {
        const r = await AX.api.admin('test_get', { id });
        if (!r.ok || !r.test) return UI.toast('Could not load the test', { tone: 'bad' });
        toRows(r.test.data || [], pp); preview(ctx);
      });
    }
  });
}
/* the chosen paper: {paper, year}; asks for the name when "Other" is chosen, and before adding to a paper already in the bank */
async function pickPaper(ctx, have) {
  const sel = ctx.el.querySelector('#pq-p'); let paper = sel ? sel.value : '';
  if (paper === '__c') { paper = await UI.prompt({ title: 'Paper name', label: 'Exam and year, e.g. NEET 2026 or NEET 2024 Re-exam', placeholder: 'NEET 2026', max: 60 }); if (!paper) return null; }
  if (!paper) { UI.toast('Step 1: choose the paper first', { tone: 'warn' }); if (sel) sel.focus(); return null; }
  const year = +((paper.match(/((?:19|20)\d\d)/) || [])[1] || 0);
  if (!year) { UI.toast('The paper name must contain the year, e.g. NEET 2024', { tone: 'warn' }); return null; }
  if (have.has(paper) && !(await UI.confirm({ title: paper + ' is already in the bank', text: 'The new questions are added to it. Questions already there stay. Use this to add a missing part (for example only Biology).', yes: 'Add more' }))) return null;
  return { paper, year };
}
const pickFile = accept => new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); });
/* questions (from the importer or a test) → rows to check, with the chapter and topic filled in */
function toRows(Q, pp) {
  P.paper = pp.paper; P.year = pp.year; P.only = false;
  P.rows = Q.filter(q => q && (q.q || q.img)).map((q, i) => { const hint = window.pyqSubjOf(q.sec), t = window.pyqTag(EXAM, [q.q, ...(q.options || []), q.explanation].join(' '), hint) || {};
    return { qno: i + 1, q: q.q || '', options: (q.options || []).concat(['', '', '', '']).slice(0, 4), answer: q.answer == null ? null : q.answer, explanation: q.explanation || '', has_img: !!(q.img || (q.oimg || []).some(Boolean)), subject: t.subject || hint || 'bio', chapter: t.chapter || '', topic: t.topic || '', sure: (t.score || 0) >= 2 && (!hint || t.subject === hint) }; });
}
AX.css('pyq-ways', `.pq-ways{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px;margin-top:6px}
.pq-way{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:12px;border-radius:14px;border:1px solid var(--line);background:var(--solid-2);color:var(--tx);text-align:left;cursor:pointer}
.pq-way:hover{border-color:var(--pri-line);background:var(--pri-soft)}.pq-way .ax-ic{color:var(--pri)}.pq-way b{font-size:13.5px}.pq-way small{font-size:11.5px;color:var(--mut)}`);
async function importFile(f, btn, quiet) {
  if (!/^[a-z0-9-]+\.json$/.test(f)) return false;
  let d; try { d = await (await fetch('pyq-data/' + f, { cache: 'no-cache' })).json(); } catch (e) { d = null; }
  if (!d || !Array.isArray(d.items)) { UI.toast('Could not load ' + f, { tone: 'bad' }); return false; }
  if (P.papers.some(p => p.paper === d.paper)) { if (!quiet) UI.toast(d.paper + ' is already in the bank', { tone: 'warn' }); return true; }
  const items = d.items.map(x => Object.assign({}, x, { rkey: window.pyqKey(x.q) }));
  let n = 0;
  for (let i = 0; i < items.length; i += 100) {
    const r = await AX.api.call('cbt_admin_pyq', 'bulk', { exam: d.exam || EXAM, items: items.slice(i, i + 100) });
    if (!r.ok) { UI.toast('Could not save — ' + AX.errText(r), { tone: 'bad' }); return false; }
    n += r.added || 0;
  }
  P.papers.push({ paper: d.paper });
  if (!quiet) UI.toast(n + ' questions added from ' + d.paper);
  return true;
}
function preview(ctx) {
  const box = ctx.el.querySelector('#pq-prev'); if (!box || !P.rows) return;
  const R = P.rows, unsure = R.filter(r => !r.sure || !r.chapter).length;
  AX.set(box, h`<div class="divider"></div><div class="row wrap"><div class="grow"><b>${P.paper}</b> · ${R.length} questions</div>${UI.pill((R.length - unsure) + ' auto-tagged · ' + unsure + ' to check', unsure ? 'warn' : 'ok')}<button class="btn sm" data-act="only">${P.only ? 'Show all' : 'Show only to check'}</button></div>
    <div class="col gap6 mt12" style="max-height:60vh;overflow:auto;padding-right:4px">${join(R.map((r, i) => [r, i]).filter(([r]) => !(P.only && r.sure && r.chapter)), ([r, i]) => h`<div class="well" style="${r.sure && r.chapter ? '' : 'border-color:color-mix(in srgb,var(--warn) 50%,transparent);background:var(--warn-soft)'}"><div class="row top"><b class="pill">${r.qno}</b><div class="grow sm">${r.q.slice(0, 220)}${r.q.length > 220 ? '…' : ''}${r.has_img ? ' 🖼' : ''}</div></div>
      <div class="grid g3 mt8"><select class="inp sm" data-i="${i}" data-k="subject">${sbOpts(r.subject)}</select><select class="inp sm" data-i="${i}" data-k="chapter">${chOpts(r.subject, r.chapter, true)}</select><select class="inp sm" data-i="${i}" data-k="topic">${tpOpts(r.subject, r.chapter, r.topic)}</select></div></div>`)}</div>
    <div class="row end mt12"><button class="btn ghost" data-act="cancel">Cancel</button><button class="btn pri" data-act="save">${icon('check', 16)} Save ${R.length} questions to the PYQ bank</button></div>`);
  if (!box.__w) {
    box.__w = 1;
    box.addEventListener('change', e => {
      const s = e.target.closest('select[data-i]'); if (!s) return; const r = P.rows[+s.dataset.i], k = s.dataset.k;
      r[k] = s.value; r.sure = true;
      if (k === 'subject') { r.chapter = ''; r.topic = ''; }
      if (k === 'chapter') { const c = chap(r.subject, r.chapter); r.topic = c && c.topics[0] ? c.topics[0].name : ''; }
      preview(ctx);
    });
    AX.act(box, {
      only() { P.only = !P.only; preview(ctx); },
      cancel() { P.rows = null; AX.set(box, ''); },
      async save(btn) {
        const miss = P.rows.filter(r => !r.chapter).length;
        if (miss && !(await UI.confirm({ title: miss + (miss > 1 ? ' questions have' : ' question has') + ' no chapter', text: 'They will be skipped. Continue?', yes: 'Continue' }))) return;
        const items = P.rows.filter(r => r.chapter).map(r => ({ subject: r.subject, chapter: r.chapter, topic: r.topic, year: P.year, paper: P.paper, qno: r.qno, q: r.q, options: r.options, answer: r.answer, explanation: r.explanation, has_img: r.has_img, rkey: window.pyqKey(r.q) }));
        let n = 0; btn.disabled = true;
        for (let i = 0; i < items.length; i += 100) {
          btn.textContent = 'Saving… ' + Math.min(i + 100, items.length) + '/' + items.length;
          const r = await call('bulk', { items: items.slice(i, i + 100) });
          if (!r.ok) { btn.disabled = false; btn.textContent = 'Try again'; return UI.toast('Could not save — ' + AX.errText(r), { tone: 'bad' }); }
          n += r.added || 0;
        }
        UI.toast(n + ' questions added from ' + P.paper); P.rows = null; ctx.reload();
      }
    });
  }
}
async function browse(ctx, paper) {
  const r = await call('list', { paper });
  if (!ctx.alive()) return;
  if (!r.ok) { AX.set(ctx.el, UI.errorBox(r)); AX.act(ctx.el, { retry: () => ctx.reload() }); return; }
  const L = r.items || [];
  ctx.head({ title: paper, sub: 'Check the subject, chapter and topic of each question. Changes save as you pick.', crumb: paper, actions: h`<a class="btn" href="#/pyq">${icon('arrowL', 16)} All papers</a>` });
  const row = (x, i) => h`<div class="li" style="align-items:flex-start;flex-wrap:wrap"><b class="pill">${x.qno}</b><div class="grow" style="min-width:220px"><div class="sm">${String(x.q || '').slice(0, 200)}</div>
      ${can() ? h`<div class="grid g3 mt8"><select class="inp sm" data-i="${i}" data-k="subject">${sbOpts(x.subject)}</select><select class="inp sm" data-i="${i}" data-k="chapter">${chOpts(x.subject, x.chapter, false)}</select><select class="inp sm" data-i="${i}" data-k="topic">${tpOpts(x.subject, x.chapter, x.topic)}</select></div>`
        : h`<div class="xs mut mt4">${subj(x.subject).name} · ${(chap(x.subject, x.chapter) || {}).name || '—'} · ${x.topic || '—'}</div>`}</div>
      <div class="row gap6">${x.verified ? UI.pill('Verified', 'ok') : x.verified === false ? UI.pill('Not verified', 'warn') : ''}${x.verified != null ? h`<button class="ibtn sm" data-act="edq" data-i="${i}" aria-label="Edit question">${icon(can() ? 'edit' : 'eye', 15)}</button>` : ''}${can() ? h`<button class="ibtn sm" data-act="delq" data-i="${i}" aria-label="Delete question">${icon('trash', 15)}</button>` : ''}</div></div>`;
  AX.set(ctx.el, h`<div class="card pad0 list" id="pq-list">${L.length ? join(L, row) : UI.empty({ icon: 'book', title: 'No questions in this paper' })}</div>`);
  const list = ctx.el.querySelector('#pq-list');
  list.addEventListener('change', async e => {
    const s = e.target.closest('select[data-i]'); if (!s) return; const i = +s.dataset.i, x = L[i], k = s.dataset.k;
    x[k] = s.value;
    if (k === 'subject') { const c = subj(x.subject).chapters[0]; x.chapter = c ? c.id : ''; x.topic = c && c.topics[0] ? c.topics[0].name : ''; }
    if (k === 'chapter') { const c = chap(x.subject, x.chapter); x.topic = c && c.topics[0] ? c.topics[0].name : ''; }
    const y = await call('update', { id: x.id, subject: x.subject, chapter: x.chapter || '', topic: x.topic || '' });
    if (!y.ok) return UI.err(y);
    UI.toast('Saved');
    const tmp = document.createElement('div'); tmp.innerHTML = AX.html(row(x, i)); s.closest('.li').replaceWith(tmp.firstElementChild);
  });
  AX.act(ctx.el, {
    retry: () => ctx.reload(),
    edq(el) { editQ(ctx, L[+el.dataset.i].id); },
    async delq(el) { const x = L[+el.dataset.i]; if (!(await UI.confirm({ title: 'Delete question ' + x.qno + ' from the bank?', yes: 'Delete', tone: 'danger' }))) return; const y = await call('delete', { id: x.id }); if (!y.ok) return UI.err(y); UI.toast('Deleted'); ctx.reload(); }
  });
}
/* ---------- v93: one question — full edit form (or read-only view), history ---------- */
const DIFF = [['', '— not set —'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const QTYPE = [['', '— not set —'], ['conceptual', 'Conceptual (theory)'], ['numerical', 'Numerical'], ['statement', 'Statement based'], ['assertion', 'Assertion & reason'], ['match', 'Match the columns'], ['diagram', 'Diagram based']];
const SYLL = [['', 'Follow the chapter (default)'], ['current', 'In current NEET syllabus'], ['partial', 'Partly in syllabus'], ['removed', 'Not in current syllabus']];
const sel = (id, list, v) => h`<select class="inp" id="${id}">${join(list, ([k, t]) => h`<option value="${k}" ${k === (v || '') ? raw('selected') : ''}>${t}</option>`)}</select>`;
async function editQ(ctx, id) {
  let x = { subject: 'bio', chapter: '', topic: '', year: new Date().getFullYear(), paper: '', qno: '', q: '', options: ['', '', '', ''], answer: null, explanation: '', difficulty: '', qtype: '', concept: '', formula: '', ncert_ref: '', source_ref: '', session: '', paper_code: '', syllabus: '', verified: false };
  if (id) { const r = await call('get', { id }); if (!r.ok) return UI.err(r); x = Object.assign(x, r.item); }
  const ro = !can(), o = (x.options || []).concat(['', '', '', '']).slice(0, 4);
  const fld = (l, b, w) => h`<div class="fld" ${w ? raw('style="grid-column:1/-1"') : ''}><label>${l}</label>${b}</div>`;
  const body = h`<fieldset ${ro ? raw('disabled') : ''} style="border:0;padding:0;margin:0"><div class="form-grid">
    ${fld('Paper (exam + year)', h`<input class="inp" id="eq-paper" maxlength="60" value="${x.paper}" placeholder="NEET 2024">`)}${fld('Year', h`<input class="inp" id="eq-year" type="number" min="1980" max="2100" value="${x.year}">`)}
    ${fld('Session (optional)', h`<input class="inp" id="eq-session" maxlength="60" value="${x.session}" placeholder="Phase I, Re-exam…">`)}${fld('Paper code / set (optional)', h`<input class="inp" id="eq-pcode" maxlength="30" value="${x.paper_code}" placeholder="Q1, Code 45…">`)}
    ${fld('Question number', h`<input class="inp" id="eq-qno" type="number" min="1" value="${x.qno == null ? '' : x.qno}">`)}${fld('Subject', h`<select class="inp" id="eq-sub">${sbOpts(x.subject)}</select>`)}
    ${fld('Chapter', h`<select class="inp" id="eq-ch">${chOpts(x.subject, x.chapter, true)}</select>`)}${fld('Topic', h`<select class="inp" id="eq-tp">${tpOpts(x.subject, x.chapter, x.topic)}</select>`)}
    ${fld('Question', h`<textarea class="inp" id="eq-q" rows="4" maxlength="4000">${x.q}</textarea>`, 1)}
    ${join([0, 1, 2, 3], j => fld('Option ' + 'ABCD'[j], h`<input class="inp" id="eq-o${j}" maxlength="1000" value="${o[j] || ''}">`))}
    ${fld('Correct answer', sel('eq-a', [['', '— unknown —'], ['0', 'A'], ['1', 'B'], ['2', 'C'], ['3', 'D']], x.answer == null ? '' : String(x.answer)))}${fld('Difficulty', sel('eq-d', DIFF, x.difficulty))}
    ${fld('Solution (step by step)', h`<textarea class="inp" id="eq-e" rows="4" maxlength="4000">${x.explanation}</textarea>`, 1)}
    ${fld('Question type', sel('eq-ty', QTYPE, x.qtype))}${fld('Concept', h`<input class="inp" id="eq-cn" maxlength="120" value="${x.concept}" placeholder="e.g. Half-life">`)}
    ${fld('Formula (optional, use ^ for powers and _ for subscripts)', h`<input class="inp" id="eq-fm" maxlength="600" value="${x.formula}" placeholder="N = N_0 (1/2)^{t/T}">`, 1)}
    ${fld('NCERT reference', h`<input class="inp" id="eq-nr" maxlength="160" value="${x.ncert_ref}" placeholder="Class 12 Physics, Ch 13, p. 445">`)}${fld('Source reference', h`<input class="inp" id="eq-src" maxlength="200" value="${x.source_ref}" placeholder="Official NTA paper, code Q2">`)}
    ${fld('Current syllabus status', sel('eq-sy', SYLL, x.syllabus), 1)}
    <label class="row gap6" style="grid-column:1/-1;align-items:center"><input type="checkbox" id="eq-v" ${x.verified ? raw('checked') : ''}> <span><b>Answer verified</b> — checked against the official answer key. Students see a “Verified” tag.</span></label>
  </div></fieldset>`;
  UI.modal({
    title: id ? (ro ? 'Question' : 'Edit question') : 'Add a question', sub: id ? x.paper + (x.qno ? ' · Q' + x.qno : '') : 'Add a single past-paper question', size: 'wide', body,
    foot: h`${id ? h`<button class="btn ghost" data-hist>${icon('clock', 15)} History</button>` : ''}<span class="sp"></span><button class="btn ghost" data-close>${ro ? 'Close' : 'Cancel'}</button>${ro ? '' : h`<button class="btn pri" id="eq-save">${icon('check', 16)} Save</button>`}`,
    onOpen(el, close) {
      const $ = s => el.querySelector(s);
      $('#eq-sub').addEventListener('change', () => { AX.set($('#eq-ch'), chOpts($('#eq-sub').value, '', true)); AX.set($('#eq-tp'), tpOpts($('#eq-sub').value, '', '')); });
      $('#eq-ch').addEventListener('change', () => AX.set($('#eq-tp'), tpOpts($('#eq-sub').value, $('#eq-ch').value, '')));
      const hb = el.querySelector('[data-hist]'); if (hb) hb.onclick = () => history(id);
      const sv = $('#eq-save'); if (!sv) return;
      sv.onclick = async () => {
        const item = { paper: $('#eq-paper').value.trim(), year: +$('#eq-year').value, session: $('#eq-session').value.trim(), paper_code: $('#eq-pcode').value.trim(), qno: $('#eq-qno').value,
          subject: $('#eq-sub').value, chapter: $('#eq-ch').value, topic: $('#eq-tp').value, q: $('#eq-q').value.trim(), options: [0, 1, 2, 3].map(j => $('#eq-o' + j).value.trim()),
          answer: $('#eq-a').value, explanation: $('#eq-e').value.trim(), difficulty: $('#eq-d').value, qtype: $('#eq-ty').value, concept: $('#eq-cn').value.trim(), formula: $('#eq-fm').value.trim(),
          ncert_ref: $('#eq-nr').value.trim(), source_ref: $('#eq-src').value.trim(), syllabus: $('#eq-sy').value, verified: $('#eq-v').checked };
        const miss = !item.paper ? 'the paper' : !item.year ? 'the year' : !item.chapter ? 'the chapter' : !item.q ? 'the question' : item.options.some(v => !v) ? 'all four options' : '';
        if (miss) return UI.toast('Please fill ' + miss, { tone: 'warn' });
        if (item.verified && item.answer === '') return UI.toast('Choose the correct answer before marking it verified', { tone: 'warn' });
        item.rkey = window.pyqKey(item.q);
        await UI.busy(sv, async () => { const r = await call(id ? 'save' : 'add', { id, item }); if (!r.ok) return UI.err(r); UI.toast(id ? 'Saved' : 'Question added'); close(true); ctx.reload(); });
      };
    }
  });
}
async function history(id) {
  const r = await call('audit', { id }); if (!r.ok) return UI.err(r);
  const L = r.items || [], NM = { add: 'Added', edit: 'Edited', tags: 'Chapter / topic changed', verify: 'Marked verified', unverify: 'Marked not verified', delete: 'Deleted' };
  UI.modal({ title: 'History', sub: 'Who changed this question and when', size: 'narrow',
    body: L.length ? h`<div class="list">${join(L, a => h`<div class="li"><div class="grow"><div class="t">${NM[a.act] || a.act}</div><div class="s">${a.who} · ${new Date(a.at).toLocaleString('en-IN')}</div>
      ${a.before && a.act === 'edit' ? h`<details class="xs mut mt4"><summary>Before this change</summary><div class="mt4">${String(a.before.q || '').slice(0, 300)}<br>Answer: ${a.before.answer == null ? '—' : 'ABCD'[a.before.answer]} · ${a.before.chapter || ''} · ${a.before.topic || ''}</div></details>` : ''}</div></div>`)}</div>`
      : UI.empty({ icon: 'clock', title: 'No changes yet', text: 'Changes made after v93 are listed here.' }) });
}

/* ---------- v93: student reports ---------- */
const REASON = { answer: 'Wrong answer', question: 'Mistake in the question', options: 'Option wrong or missing', solution: 'Solution wrong or unclear', chapter: 'Wrong chapter / topic', other: 'Something else' };
async function reports(ctx) {
  const st = ['open', 'fixed', 'dismissed'].includes(ctx.q && ctx.q.s) ? ctx.q.s : 'open';
  ctx.head({ title: 'Student reports', sub: 'Errors students found in PYQ questions. Fix the question (Edit), then mark the report as fixed.', crumb: 'Reports', actions: h`<a class="btn" href="#/pyq">${icon('arrowL', 16)} PYQ bank</a>` });
  const r = await call('reports', { status: st });
  if (!ctx.alive()) return;
  if (!r.ok) { AX.set(ctx.el, UI.errorBox(r)); AX.act(ctx.el, { retry: () => ctx.reload() }); return; }
  const L = r.items || [];
  AX.set(ctx.el, h`<div class="seg" style="margin-bottom:12px">${join([['open', 'Open'], ['fixed', 'Fixed'], ['dismissed', 'Dismissed']], ([k, t]) => h`<button type="button" class="${st === k ? 'on' : ''}" data-act="tab" data-s="${k}">${t}</button>`)}</div>
    <div class="card pad0 list">${L.length ? join(L, (x, i) => h`<div class="li" style="align-items:flex-start;flex-wrap:wrap"><span class="av sm" style="--c:#d14848">${icon('alert', 14)}</span><div class="grow" style="min-width:220px">
      <div class="t">${REASON[x.reason] || x.reason} <span class="xs mut">· ${x.paper}${x.qno ? ' Q' + x.qno : ''} · ${(chap(x.subject, x.chapter) || {}).name || x.chapter}</span></div>
      ${x.note ? h`<div class="sm mt4">“${x.note}”</div>` : ''}<div class="xs mut mt4">${String(x.q || '').slice(0, 200)}</div><div class="xs faint mt4">${new Date(x.at).toLocaleString('en-IN')}</div></div>
      <div class="row gap6"><button class="btn sm" data-act="open" data-i="${i}">${icon('edit', 14)} Open question</button>${can() && st === 'open' ? h`<button class="btn sm" data-act="set" data-i="${i}" data-s="fixed">${icon('check', 14)} Fixed</button><button class="btn sm ghost" data-act="set" data-i="${i}" data-s="dismissed">Dismiss</button>` : can() ? h`<button class="btn sm ghost" data-act="set" data-i="${i}" data-s="open">Reopen</button>` : ''}</div></div>`)
      : UI.empty({ icon: 'checkCircle', title: st === 'open' ? 'No open reports' : 'Nothing here', text: st === 'open' ? 'When students report an error in a PYQ, it shows here.' : '' })}</div>`);
  AX.act(ctx.el, {
    retry: () => ctx.reload(),
    tab(el) { location.hash = '#/pyq/reports?s=' + el.dataset.s; },
    open(el) { editQ(ctx, L[+el.dataset.i].qid); },
    async set(el) { const x = L[+el.dataset.i]; const y = await call('report_set', { id: x.id, status: el.dataset.s }); if (!y.ok) return UI.err(y); UI.toast('Done'); ctx.reload(); }
  });
}

/* ---------- v93: chapters open to every plan ---------- */
async function freeCh(ctx) {
  ctx.head({ title: 'Free chapters', sub: 'Chapters whose questions every student can practise, also on Free and Basic. Ultra (and any plan with unlimited PYQ in Plans → Access & limits) opens every chapter. Chapter analysis is open to everyone.', crumb: 'Free chapters', actions: h`<a class="btn" href="#/pyq">${icon('arrowL', 16)} PYQ bank</a>` });
  const r = await call('free_get');
  if (!ctx.alive()) return;
  if (!r.ok) { AX.set(ctx.el, UI.errorBox(r)); AX.act(ctx.el, { retry: () => ctx.reload() }); return; }
  const on = new Set(r.items || []);
  AX.set(ctx.el, h`<div class="grid g3">${join(S().subjects, s => h`<div class="card"><div class="card-h"><h3>${s.name}</h3><span class="grow"></span><span class="xs mut" data-n="${s.id}"></span></div>
      ${join([11, 12], cl => h`<div class="xs mut mt8">Class ${cl}</div>${join(s.chapters.filter(c => c.cls === cl), c => h`<label class="row gap6 mt4" style="align-items:center"><input type="checkbox" value="${c.id}" data-s="${s.id}" ${on.has(c.id) ? raw('checked') : ''} ${can() ? '' : raw('disabled')}> <span class="sm">${c.name}${c.old ? ' (old)' : ''}</span></label>`)}`)}</div>`)}</div>
    ${can() ? h`<div class="row end mt16"><button class="btn pri" data-act="save">${icon('check', 16)} Save free chapters</button></div>` : ''}`);
  const count = () => S().subjects.forEach(s => { const n = ctx.el.querySelectorAll(`input[data-s="${s.id}"]:checked`).length; const e = ctx.el.querySelector(`[data-n="${s.id}"]`); if (e) e.textContent = n + ' free'; });
  count(); ctx.el.addEventListener('change', count);
  AX.act(ctx.el, {
    retry: () => ctx.reload(),
    async save(btn) { const ch = [...ctx.el.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value); await UI.busy(btn, async () => { const y = await call('free_set', { chapters: ch }); if (!y.ok) return UI.err(y); UI.toast(y.n + ' free chapters saved'); }); }
  });
}

/* ---------- v93: duplicates (import mistakes) and repeats (real) ---------- */
async function dups(ctx) {
  ctx.head({ title: 'Duplicates & repeats', sub: 'Exact duplicates are the same question twice in one paper (usually an import mistake). Repeats are the same question in different papers — students see them as “Asked 2×”.', crumb: 'Duplicates', actions: h`<a class="btn" href="#/pyq">${icon('arrowL', 16)} PYQ bank</a>` });
  const r = await call('dups');
  if (!ctx.alive()) return;
  if (!r.ok) { AX.set(ctx.el, UI.errorBox(r)); AX.act(ctx.el, { retry: () => ctx.reload() }); return; }
  const E = r.exact || [], Rp = r.repeated || [];
  AX.set(ctx.el, h`<div class="section-t">Exact duplicates · ${E.length}</div>
    <div class="card pad0 list">${E.length ? join(E, (x, i) => h`<div class="li" style="flex-wrap:wrap"><div class="grow" style="min-width:220px"><div class="t">${x.paper} · ${x.ids.length} copies</div><div class="xs mut mt4">${x.q}</div></div>
      <div class="row gap6">${join(x.ids, (id, j) => h`<button class="btn sm ghost" data-act="ed" data-id="${id}">${icon('edit', 13)} Copy ${j + 1}</button>`)}</div></div>`) : UI.empty({ icon: 'checkCircle', title: 'No exact duplicates' })}</div>
    <div class="section-t">Repeated questions · ${Rp.length}</div>
    <div class="card pad0 list">${Rp.length ? join(Rp, x => h`<div class="li"><span class="av sm" style="--c:#d08a12">${x.n}×</span><div class="grow"><div class="t">${x.papers.join(', ')}</div><div class="xs mut mt4">${x.q}</div></div></div>`) : UI.empty({ icon: 'copy', title: 'No repeats found yet' })}</div>`);
  AX.act(ctx.el, { retry: () => ctx.reload(), ed(el) { editQ(ctx, el.dataset.id); } });
}

/* ---------- v93: CSV import with checks (Excel: File → Save as → CSV UTF-8) ---------- */
const CSV_COLS = ['paper', 'year', 'qno', 'subject', 'chapter', 'topic', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'answer', 'explanation', 'difficulty', 'qtype', 'concept', 'formula', 'ncert_ref', 'source_ref', 'session', 'paper_code', 'syllabus'];
function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  t = String(t || '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(v => v.trim())) rows.push(row); row = []; } else f += c;
  }
  row.push(f); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
function csvCheck(rows) {
  const head = rows[0].map(x => x.trim().toLowerCase().replace(/\s+/g, '_')), ix = k => head.indexOf(k), out = [], bad = [];
  const miss = ['paper', 'year', 'subject', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'answer'].filter(k => ix(k) < 0);
  if (miss.length) return { head: 'Missing columns: ' + miss.join(', ') };
  const SUBN = { phy: 'phy', physics: 'phy', chem: 'chem', chemistry: 'chem', bio: 'bio', biology: 'bio', botany: 'bio', zoology: 'bio' };
  rows.slice(1).forEach((r, n) => {
    const g = k => ix(k) < 0 ? '' : String(r[ix(k)] || '').trim(), line = n + 2, err = [];
    const subject = SUBN[g('subject').toLowerCase()] || '', year = +g('year'), ans = g('answer').toUpperCase(), a = /^[ABCD]$/.test(ans) ? 'ABCD'.indexOf(ans) : /^[1-4]$/.test(ans) ? +ans - 1 : null;
    const opts = ['option_a', 'option_b', 'option_c', 'option_d'].map(g), qq = g('question');
    if (!g('paper')) err.push('no paper'); if (!(year >= 1980 && year <= 2100)) err.push('bad year'); if (!subject) err.push('subject must be Physics / Chemistry / Biology');
    if (!qq) err.push('no question'); if (opts.some(o => !o)) err.push('needs 4 options'); if (a === null) err.push('answer must be A–D or 1–4');
    let chapter = g('chapter'), topic = g('topic');
    if (subject) { const s = subj(subject), byId = s.chapters.find(c => c.id === chapter), byName = s.chapters.find(c => c.name.toLowerCase() === chapter.toLowerCase());
      const c = byId || byName || null; if (c) chapter = c.id; else { const t = window.pyqTag(EXAM, [qq].concat(opts).join(' '), subject); chapter = t ? t.chapter : ''; if (!topic && t) topic = t.topic; if (!chapter) err.push('chapter not found'); } }
    const lc = (v, L) => L.includes(v.toLowerCase()) ? v.toLowerCase() : '';
    if (err.length) bad.push({ line, err }); else out.push({ subject, chapter, topic, year, paper: g('paper'), qno: g('qno'), q: qq, options: opts, answer: a, explanation: g('explanation'), has_img: false, rkey: window.pyqKey(qq),
      difficulty: lc(g('difficulty'), ['easy', 'medium', 'hard']), qtype: lc(g('qtype'), ['conceptual', 'numerical', 'statement', 'assertion', 'match', 'diagram']), concept: g('concept'), formula: g('formula'),
      ncert_ref: g('ncert_ref'), source_ref: g('source_ref'), session: g('session'), paper_code: g('paper_code'), syllabus: lc(g('syllabus'), ['current', 'partial', 'removed']) });
  });
  return { ok: out, bad };
}
function csvImport(ctx) {
  let good = [];
  UI.modal({ title: 'Import questions from CSV', sub: 'Excel: File → Save as → “CSV UTF-8”. One question per row. Imported questions start as not verified.', size: 'wide',
    body: h`<div class="row wrap gap6"><input type="file" id="cv-f" accept=".csv,text/csv" class="inp" style="max-width:340px"><button class="btn ghost sm" id="cv-t">${icon('download', 14)} Download template</button></div>
      <p class="xs mut mt8">Columns: ${CSV_COLS.join(', ')}. Required: paper, year, subject, question, option_a–d, answer (A–D). Chapter can be the chapter name; if it is empty it is guessed from the text — check it after import.</p><div id="cv-out" class="mt12"></div>`,
    foot: h`<span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="cv-go" disabled>${icon('upload', 16)} Import</button>`,
    onOpen(el, close) {
      const out = el.querySelector('#cv-out'), go = el.querySelector('#cv-go');
      el.querySelector('#cv-t').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + CSV_COLS.join(',') + '\nNEET 2024,2024,1,Physics,Nuclei,Radioactivity,"Half-life question text","1/2","1/4","1/8","1/16",B,"Step 1 …",medium,numerical,Half-life,"N = N_0 (1/2)^{t/T}","Class 12 Physics Ch 13","NTA official paper",,,current\n'], { type: 'text/csv' })); a.download = 'pyq-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
      el.querySelector('#cv-f').addEventListener('change', async e => {
        const f = e.target.files[0]; good = []; go.disabled = true; if (!f) return;
        if (f.size > 5 * 1024 * 1024) { AX.set(out, h`<div class="pill bad">The file is larger than 5 MB. Split it into smaller files.</div>`); return; }
        const rows = parseCsv(await f.text());
        if (rows.length < 2) { AX.set(out, h`<div class="pill bad">No rows found.</div>`); return; }
        const c = csvCheck(rows);
        if (c.head) { AX.set(out, h`<div class="pill bad">${c.head}</div>`); return; }
        good = c.ok; go.disabled = !good.length;
        AX.set(out, h`<div class="row gap6">${UI.pill(good.length + ' rows ready', 'ok')}${c.bad.length ? UI.pill(c.bad.length + ' rows with problems (skipped)', 'warn') : ''}</div>
          ${c.bad.length ? h`<div class="well mt8" style="max-height:220px;overflow:auto">${join(c.bad.slice(0, 200), b => h`<div class="xs">Row ${b.line}: ${b.err.join(', ')}</div>`)}</div>` : ''}`);
      });
      go.onclick = async () => {
        if (!good.length) return; go.disabled = true; let n = 0;
        for (let i = 0; i < good.length; i += 100) {
          go.textContent = 'Importing… ' + Math.min(i + 100, good.length) + '/' + good.length;
          const r = await call('bulk', { items: good.slice(i, i + 100) });
          if (!r.ok) { go.disabled = false; go.textContent = 'Try again'; return UI.toast('Could not import — ' + AX.errText(r), { tone: 'bad' }); }
          n += r.added || 0;
        }
        UI.toast(n + ' questions imported (not verified yet)'); close(true); ctx.reload();
      };
    } });
}
})();
