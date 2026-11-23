// PYQ Analyzer (v3.js + supabase_v93_pyq_analyzer.sql): the student's walk-through from the brief, in Chromium, with
// every Supabase call answered by the throw-away test database (tests/db/build.sh). Phone and computer sizes.
// Checks: open analyzer, switch subjects, search a chapter, chapter analysis, tap a year, open a topic, filters, answer
// a question (server-saved), solution, bookmark, smart practice, performance, wrong answers revision, plan lock with a
// free chapter, and that a script in question text never runs. Run by hand like v3_xss.js (not in CI, to save minutes):
//   PGDATABASE=e2e node tests/e2e/pyq.js   (SHOTS=dir to save screenshots)
const { chromium } = require('playwright');
const { Client } = require('pg');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PORT = 8771, BASE = `http://127.0.0.1:${PORT}/`;
const SUPA = /SUPABASE_URL:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'))[1];
const TYPES = { '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const SHOTS = process.env.SHOTS || '';
const db = new Client();
const q = async (sql, args) => (await db.query(sql, args)).rows;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
const calls = [];
async function rpcRoute(route) {
  const req = route.request(), fn = req.url().split('/rpc/')[1].split('?')[0];
  if (!/^[a-z0-9_]+$/.test(fn)) return route.fulfill({ status: 400, body: '{}' });
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  const keys = Object.keys(body).filter(k => /^p_[a-z0-9_]+$/.test(k));
  const vals = keys.map(k => body[k] === null || body[k] === undefined ? null : Array.isArray(body[k]) && k === 'p_ids' ? '{' + body[k].join(',') + '}' : typeof body[k] === 'object' ? JSON.stringify(body[k]) : String(body[k]));
  calls.push(fn);
  try {
    const r = await q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, vals);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r[0].r) });
  } catch (e) {
    if (!/does not exist/.test(e.message)) console.log('SQL ERROR in', fn, ':', e.message);
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: e.message }) });
  }
}
// a small but realistic bank: three subjects, several years, topics, a repeat and one question carrying a script
async function seed() {
  await q(`delete from public.cbt_pyq where paper like 'NEET 20%' or paper like 'AIPMT%'`);
  await q(`delete from cbt_private.pyq_free`);
  const rows = [];
  const add = (s, c, t, y, n, text, a, extra) => rows.push(Object.assign({ s, c, t, y, n, text, a }, extra || {}));
  const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  years.forEach((y, i) => {
    add('phy', 'nuclei', 'Radioactivity', y, 10 + i, `A radioactive sample has half-life ${i + 2} days. Find the fraction left after ${2 * (i + 2)} days (2^-2).`, 1, { qtype: 'numerical', formula: 'N = N_0 (1/2)^{t/T}' });
    if (i % 3 === 0) add('phy', 'nuclei', 'Fission & fusion', y, 30 + i, `Energy released in fission of U-235 is about? (${y})`, 2);
    add('bio', 'cell', 'Cell organelles', y, 100 + i, `Which organelle is called the powerhouse of the cell? Set ${y}`, 0);
    if (i % 2) add('chem', 'equilibrium', 'Equilibrium constant', y, 60 + i, `For the reaction N_2 + 3H_2 -> 2NH_3 the K_p expression is (${y})`, 3);
  });
  add('bio', 'cell', 'Cell organelles', 2025, 140, 'Repeated: mitochondria are found in?', 2);
  add('bio', 'cell', 'Cell organelles', 2019, 141, 'Repeated: mitochondria are found in?', 2);
  add('bio', 'cell', 'Cell organelles', 2023, 142, 'XSS <img src=x onerror="window.__x=(window.__x||0)+1"> which organelle?', 1);
  for (const r of rows) {
    await q(`insert into public.cbt_pyq (exam, subject, chapter, topic, year, paper, qno, q, options, answer, explanation, rkey, qtype, formula)
             values ('NEET', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [r.s, r.c, r.t, r.y, 'NEET ' + r.y, r.n, r.text, JSON.stringify(['Option one', 'Option two', 'Option three', 'Option four <b>bold</b>']), r.a,
       'Step 1: read the question.\nStep 2: apply the idea.', r.text.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 90), r.qtype || '', r.formula || '']);
  }
  return rows.length;
}
// the v3 app lives in a shadow root
const S = (p, fn, arg) => p.evaluate(([f, a]) => { const r = [...document.querySelectorAll('*')].find(e => e.shadowRoot && e.id === 'v3host'); return new Function('root', 'a', f)(r.shadowRoot, a); }, [fn, arg]);
const txt = p => S(p, 'return root.querySelector("#scrB")?root.querySelector("#scrB").innerText:""');
const click = (p, sel) => S(p, `const e=root.querySelector(a);if(!e)return false;e.click();return true`, sel);
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: false }); } };

(async () => {
  await db.connect();
  await q(`select set_config('request.headers', '{"x-real-ip":"4.4.4.7"}', false)`);
  const n = await seed();
  await q(`update cbt_private.students set fail_count=0, locked_until=0, devices='{}' where mobile = '9000000002'`);
  await q(`delete from cbt_private.pyq_progress where student_id = (select id from cbt_private.students where mobile = '9000000002')`);
  await q(`delete from cbt_private.rate_hits`);
  await q(`update cbt_private.plan_settings set enforce = false`);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const br = await chromium.launch();
  for (const [tag, vw] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const c = await br.newContext({ viewport: vw });
    await c.addInitScript(() => { try { localStorage.setItem('cbt_v3', 'true'); ['9000000002', '9000000094'].forEach(m => localStorage.setItem('cbt_v3_onb_' + m, '1')); } catch (e) {} });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.route(u => !u.href.startsWith(BASE) && !u.href.startsWith(SUPA), r => r.abort());
    await p.route(SUPA + '/rest/v1/rpc/**', rpcRoute);
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#lp');
    await p.evaluate(() => { lpLogin(); login('code'); }); await p.waitForSelector('#ph');
    await p.fill('#ph', '9000000002'); await p.fill('#cd', 'BBBB2222'); await p.click('#lbtn'); await wait(3500);
    // 1. open the analyzer: how much data, then the three exams
    await p.evaluate(() => { location.hash = '#/pyq'; }); await wait(1800);
    let t = await txt(p);
    ok(/PYQ ANALYZER/.test(t) && /years of real papers/.test(t) && t.includes(String(n)), tag + ' 1 home: years of data and the real question count (' + n + ')');
    ok(/Choose your exam/.test(t) && /NEET \(UG\)/.test(t) && /JEE Main/.test(t) && /JEE Advanced/.test(t) && /Coming soon/.test(t), tag + ' 1b home: NEET, JEE Main, JEE Advanced');
    ok(/Data coverage/.test(t), tag + ' 1c years without papers are shown as a data gap, not as zero');
    await shot(p, tag + '-0-home');
    await click(p, '[data-a="pqEx"][data-v="NEET"]'); await wait(1200); t = await txt(p);
    ok(/Subjects/.test(t) && /Biology/.test(t) && /Chemistry/.test(t) && /Physics/.test(t) && /Your practice/.test(t) && /Smart practice/.test(t) && /Wrong answers/.test(t), tag + ' 1d NEET page: three subjects, then your practice');
    await shot(p, tag + '-1-neet');
    // 2. a subject: Class 11 / 12; Biology is grouped by unit, a unit opens its chapters in place
    await click(p, '[data-a="pqSub"][data-v="bio"]'); await wait(800); t = await txt(p);
    ok(/Class 11/.test(t) && /Class 12/.test(t) && /Unit 1/i.test(t) && /Diversity in the Living World/.test(t) && /The Living World/.test(t), tag + ' 2 Biology: Class 11 units, Unit 1 open with its chapters');
    ok(/Cell: Structure and Function/.test(t) && (await S(p, 'return root.querySelectorAll(".pq4-u.open").length')) === 1, tag + ' 2b other units stay closed');
    await click(p, '[data-a="pqUnit"][data-k="bio-3"]'); await wait(300); t = await txt(p);
    ok(/Cell: The Unit of Life/.test(t), tag + ' 2c tapping Unit 3 shows its chapters');
    await shot(p, tag + '-2-bio');
    await click(p, '[data-a="pqCls"][data-v="12"]'); await wait(300); t = await txt(p);
    ok(/Unit 6/i.test(t) && /Reproduction/.test(t) && !/Unit 1\b/i.test(t), tag + ' 2d Class 12 shows Units 6–10');
    await p.evaluate(() => history.back()); await wait(500);
    await click(p, '[data-a="pqSub"][data-v="phy"]'); await wait(600); t = await txt(p);
    await click(p, '[data-a="pqCls"][data-v="12"]'); await wait(300); t = await txt(p);
    ok(/Nuclei/.test(t) && /Most asked in Class 12/.test(t), tag + ' 2e Physics Class 12 lists Nuclei and the most asked chapters');
    await p.evaluate(() => history.back()); await wait(500);
    // 3. search a chapter (any subject) on the NEET page
    await S(p, `const i=root.querySelector('#pq4q');i.value='nucl';i.dispatchEvent(new Event('input'));return 1`); await wait(300);
    t = await S(p, 'return root.querySelector("#pq4L").innerText');
    ok(/Nuclei/.test(t) && /Physics ·/.test(t) && /chapters? found/.test(t), tag + ' 3 chapter search finds Nuclei from another subject');
    // 4. chapter analysis
    await click(p, '#pq4L [data-a="pqCh"]'); await wait(1800); t = await txt(p);
    ok(/CHAPTER ANALYSIS/.test(t) && /Year-wise questions/.test(t) && /Topic weightage/.test(t) && /Radioactivity/.test(t), tag + ' 4 chapter analysis: summary, year chart, topics');
    ok(/Per paper/.test(t) && /Repeated/.test(t) && /Key insights/.test(t), tag + ' 4b summary numbers and insights');
    ok(/Numerical/.test(t), tag + ' 4c numerical vs theory split');
    await shot(p, tag + '-2-chapter');
    // 5. tap a year
    await click(p, '[data-a="pqSpan"][data-v="all"]'); await wait(300); await click(p, '[data-a="pqYr"][data-v="2016"]'); await wait(400); t = await txt(p);
    ok(/2016: 2 questions/.test(t) && /Filters:/.test(t), tag + ' 5 tapping 2016 shows its count and filters the list');
    await click(p, '[data-a="pqSpan"][data-v="5"]'); await wait(300);
    const bars = await S(p, 'return root.querySelectorAll(".pq4-y button").length');
    ok(bars === 5, tag + ' 5b the 5-year filter shows 5 bars (' + bars + ')');
    await click(p, '[data-a="pqFx"][data-k="all"]'); await wait(300);
    // 6. open a topic
    await click(p, '[data-a="pqTp"][data-v="Fission & fusion"]'); await wait(400);
    t = await S(p, 'return root.querySelector("#pq4qs").innerText');
    ok(/4 of 14/.test(t), tag + ' 6 a topic shows only its questions (4 of 14)');
    // 7. filters (status + clear all)
    await S(p, `const s=root.querySelector('.pq4-fl select[data-k="st"]');s.value='new';s.dispatchEvent(new Event('change'));return 1`); await wait(300);
    t = await S(p, 'return root.querySelector("#pq4qs").innerText');
    ok(/Not tried/.test(t) && /Clear all/.test(t), tag + ' 7 active filters are listed with Clear all');
    await click(p, '[data-a="pqFx"][data-k="all"]'); await wait(300);
    // 8. attempt a question (wrong on purpose) → server saves it
    await click(p, '.pq4-hero [data-a="pqPlayAt"]'); await wait(700);
    t = await txt(p); ok(/Question 1 of 14/.test(t), tag + ' 8 practice opens at question 1 of 14');
    const qa = await p.evaluate(() => PQ.ch.nuclei[0].a);
    await click(p, `[data-a="ppPick"][data-j="${(qa + 1) % 4}"]`); await wait(200);
    await click(p, '[data-a="ppCheck"]'); await wait(900); t = await txt(p);
    ok(/Not quite/.test(t) && /Correct answer/.test(t), tag + ' 8b a wrong answer is marked and the correct one shown');
    // 9. solution
    ok(/Step-by-step solution/.test(t) && /Step 2/.test(t) && /Formula/.test(t), tag + ' 9 solution with steps and formula');
    const sup = await S(p, 'return root.querySelectorAll(".pq4-pc sup").length');
    ok(sup > 0, tag + ' 9b powers are shown as superscript');
    await shot(p, tag + '-3-solution');
    // 10. bookmark
    await click(p, '[data-a="ppBm"]'); await wait(900);
    const saved = (await q(`select count(*)::int n from cbt_private.pyq_progress g join cbt_private.students s on s.id = g.student_id where s.mobile = '9000000002' and g.bm`))[0].n;
    const wrong = (await q(`select count(*)::int n from cbt_private.pyq_progress g join cbt_private.students s on s.id = g.student_id where s.mobile = '9000000002' and g.ok = false`))[0].n;
    ok(saved === 1 && wrong === 1, tag + ' 10 bookmark and wrong answer are saved on the server (' + saved + ', ' + wrong + ')');
    // next, previous, navigator
    await click(p, '[data-a="ppGo"][data-d="1"]'); await wait(300); t = await txt(p);
    ok(/Question 2 of 14/.test(t), tag + ' 10b next question');
    await click(p, '[data-a="ppNav"]'); await wait(400);
    const nav = await S(p, 'return root.querySelectorAll(".pq4-nav button").length');
    ok(nav === 14, tag + ' 10c question number navigation (' + nav + ')');
    await S(p, 'root.querySelector("[data-a=close]")&&root.querySelector("[data-a=close]").click();return 1');
    await p.evaluate(() => { try { history.back(); } catch (e) {} }); await wait(400);
    await p.evaluate(() => { try { history.back(); } catch (e) {} }); await wait(400);
    await p.evaluate(() => { try { history.back(); } catch (e) {} }); await wait(600);
    // 11. smart practice
    await p.evaluate(() => { location.hash = '#/pyq/practice'; }); await wait(1200); t = await txt(p);
    ok(/What do you want to practise/.test(t) && /Start practice/.test(t), tag + ' 11 smart practice opens');
    await click(p, '[data-a="pgMode"][data-v="yr"]'); await wait(300);
    await S(p, `const s=root.querySelector('.pq4-g select[data-k="y"]');s.value='2019';s.dispatchEvent(new Event('change'));return 1`); await wait(300);
    await click(p, '[data-a="pgGo"]'); await wait(1300); t = await txt(p);
    ok(/Question 1 of \d+/.test(t) && /NEET 2019/.test(t), tag + ' 11b year-wise set starts with real 2019 questions');
    await shot(p, tag + '-4-practice');
    // 12. performance
    await p.evaluate(() => { location.hash = '#/pyq/me'; }); await wait(1500); t = await txt(p);
    ok(/YOUR PYQ PROGRESS/.test(t) && /Physics/.test(t) && /Wrong answers/.test(t), tag + ' 12 performance shows progress, subjects and revision');
    await shot(p, tag + '-5-me');
    // 13. open wrong answers for revision
    await click(p, '[data-a="pqRev"][data-k="wrong"]'); await wait(1300); t = await txt(p);
    ok(/Question 1 of 1/.test(t), tag + ' 13 wrong answers open for practice again');
    // no script from question text ran
    ok(!(await p.evaluate(() => window.__x || 0)), tag + ' no script from question text ran');
    ok(!errs.length, tag + ' no page errors ' + errs.join(' | '));
    await c.close();
    await q(`delete from cbt_private.pyq_progress where student_id = (select id from cbt_private.students where mobile = '9000000002')`);
    await q(`delete from cbt_private.rate_hits`);
  }
  // plan lock: Free plan + locks on; Nuclei is a free chapter, Cell is locked (analysis open, questions locked)
  {
    await q(`update cbt_private.plan_settings set enforce = true`);
    await q(`insert into cbt_private.pyq_free (exam, chapter) values ('NEET', 'nuclei') on conflict do nothing`);
    await q(`insert into cbt_private.students(id,name,mobile,status,salt,code_hash) values
      ('bbbbbbbb-0000-0000-0000-000000000094','Free Student','9000000094','approved','s94',cbt_private.hash_code('s94','FFFF9494')) on conflict do nothing`);
    await q(`update cbt_private.students set fail_count=0, locked_until=0, devices='{}' where mobile = '9000000094'`);
    const c = await br.newContext({ viewport: { width: 390, height: 844 } });
    await c.addInitScript(() => { try { localStorage.setItem('cbt_v3', 'true'); ['9000000002', '9000000094'].forEach(m => localStorage.setItem('cbt_v3_onb_' + m, '1')); } catch (e) {} });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.route(u => !u.href.startsWith(BASE) && !u.href.startsWith(SUPA), r => r.abort());
    await p.route(SUPA + '/rest/v1/rpc/**', rpcRoute);
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#lp');
    await p.evaluate(() => { lpLogin(); login('code'); }); await p.waitForSelector('#ph');
    await p.fill('#ph', '9000000094'); await p.fill('#cd', 'FFFF9494'); await p.click('#lbtn'); await wait(3500);
    await p.evaluate(() => { location.hash = '#/pyq/NEET'; }); await wait(1800);
    let t = await txt(p);
    ok(/1 chapter is free to practise/.test(t), 'lock: the plan card says how many chapters are free');
    await shot(p, 'lock-1-home');
    calls.length = 0;
    await p.evaluate(() => { location.hash = '#/pyq/NEET/cell'; }); await wait(1800); t = await txt(p);
    ok(/Year-wise questions/.test(t) && /Questions of this chapter are locked/.test(t), 'lock: a locked chapter still shows its analysis, with an unlock card');
    ok(!calls.includes('cbt_pyq_chapter'), 'lock: a locked chapter does not spend a use');
    await shot(p, 'lock-2-chapter');
    await p.evaluate(() => { location.hash = '#/pyq/NEET/nuclei'; }); await wait(1800); t = await txt(p);
    ok(/Practice chapter PYQs/.test(t) && !/locked/.test(t), 'lock: the free chapter opens for practice');
    ok(!errs.length, 'lock: no page errors ' + errs.join(' | '));
    await c.close();
    await q(`update cbt_private.plan_settings set enforce = false`);
    await q(`delete from cbt_private.pyq_free`);
  }
  await br.close(); server.close(); await db.end();
  console.log(fails ? fails + ' FAILED' : 'ALL PYQ CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
