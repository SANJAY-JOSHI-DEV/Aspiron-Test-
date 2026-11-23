// Admin → PYQ bank (cx/m-pyq.js + supabase_v93_pyq_analyzer.sql): verify a paper, edit a question, history, student reports,
// free chapters, duplicates and the CSV import with checks. Run by hand after tests/e2e/pyq.js (it uses that test's questions):
//   PGDATABASE=e2e node tests/e2e/pyq_admin.js
const { chromium } = require('playwright');
const { Client } = require('pg');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PORT = 8772, BASE = `http://127.0.0.1:${PORT}/`;
const SUPA = /SUPABASE_URL:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'))[1];
const TYPES = { '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const db = new Client();   // PGHOST / PGUSER / PGDATABASE … of the throw-away test database (tests/db/build.sh)
const q = async (sql, args) => (await db.query(sql, args)).rows;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  let body = fs.readFileSync(f);
  if (p === '/cp-dt764twzf54s5m.html') { // test only: drop the admin key gate
    const s = body.toString(), a = s.indexOf('<script>(function(){'), b = s.indexOf('</script>', a);
    body = Buffer.from(s.slice(0, a) + s.slice(b + 9));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});

const calls = [];
async function rpcRoute(route) {
  const req = route.request(), fn = req.url().split('/rpc/')[1].split('?')[0];
  if (!/^[a-z0-9_]+$/.test(fn)) return route.fulfill({ status: 400, body: '{}' });
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  const keys = Object.keys(body).filter(k => /^p_[a-z0-9_]+$/.test(k));
  const vals = keys.map(k => body[k] === null || body[k] === undefined ? null : typeof body[k] === 'object' ? JSON.stringify(body[k]) : String(body[k]));
  calls.push(fn);
  try {
    const r = await q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, vals);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r[0].r) });
  } catch (e) {
    if (!/does not exist/.test(e.message)) console.log('SQL ERROR in', fn, ':', e.message);
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: e.message }) });
  }
}

(async () => {
  await db.connect();
  await q(`select set_config('request.headers', '{"x-real-ip":"9.9.9.8","user-agent":"e2e"}', false)`);
  await q(`delete from cbt_private.admin_totp; delete from cbt_private.admin_fails; delete from cbt_private.admin_sessions`);
  await q(`update cbt_private.settings set value = encode(sha256(convert_to('aspiron-admin:e2eKey2026', 'UTF8')), 'hex') where key = 'admin_gate'`);
  const qid = (await q(`select id from public.cbt_pyq where paper = 'NEET 2016' and chapter = 'nuclei' order by qno limit 1`))[0].id;
  await q(`delete from cbt_private.pyq_reports`);
  await q(`insert into cbt_private.pyq_reports (qid, reason, note) values ($1, 'answer', '<img src=x onerror="window.__x=1"> wrong key')`, [qid]);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 860 } }); await ctx.addInitScript(() => { try { localStorage.setItem('adm_k', 'e2eKey2026'); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route(u => !u.href.startsWith(BASE) && !u.href.startsWith(SUPA), r => r.abort());
  await page.route(SUPA + '/rest/v1/rpc/**', rpcRoute);
  await page.goto(BASE + 'cp-dt764twzf54s5m.html'); await page.waitForSelector('#lg-p');
  await page.fill('#lg-p', 'OwnerPass2026x'); await page.click('#lg-go'); await page.waitForSelector('#ax-page');
  await page.goto(BASE + 'cp-dt764twzf54s5m.html#/pyq'); await page.waitForTimeout(1800);
  let t = await page.textContent('#ax-page');
  ok(/Verified answers/.test(t) && /Student reports/.test(t) && /Free chapters/.test(t) && /Import CSV/.test(t), 'overview: verified count and the new tools');
  // verify all answers of one paper
  await page.click('[data-act=verp][data-p="NEET 2016"]'); await page.waitForSelector('#cf-yes'); await page.click('#cf-yes'); await page.waitForTimeout(1200);
  const v = (await q(`select count(*) filter (where verified)::int v, count(*)::int n from public.cbt_pyq where paper = 'NEET 2016'`))[0];
  ok(v.v === v.n && v.n > 0, 'verify all: every NEET 2016 question with an answer is verified (' + v.v + '/' + v.n + ')');
  // edit one question → saved with who, and shown in the history
  await page.goto(BASE + 'cp-dt764twzf54s5m.html#/pyq/paper/NEET%202016'); await page.waitForTimeout(1500);
  await page.click('[data-act=edq]'); await page.waitForSelector('#eq-save');
  await page.selectOption('#eq-d', 'hard'); await page.fill('#eq-nr', 'Class 12 Physics, Ch 13'); await page.click('#eq-save'); await page.waitForTimeout(1200);
  const e = (await q(`select difficulty, ncert_ref from public.cbt_pyq where paper = 'NEET 2016' order by qno limit 1`))[0];
  ok(e.difficulty === 'hard' && e.ncert_ref === 'Class 12 Physics, Ch 13', 'edit: difficulty and NCERT reference saved');
  const au = (await q(`select count(*)::int n from cbt_private.pyq_audit where act = 'edit' and who = 'Owner'`))[0].n;
  ok(au >= 1, 'edit: the change is in the history with who made it');
  await page.click('[data-act=edq]'); await page.waitForSelector('[data-hist]'); await page.click('[data-hist]'); await page.waitForTimeout(900);
  ok(/Edited/.test(await page.textContent('body')), 'history: the edit is listed');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // student reports: shown as text, marked fixed
  await page.goto(BASE + 'cp-dt764twzf54s5m.html#/pyq/reports'); await page.waitForTimeout(1500);
  t = await page.textContent('#ax-page');
  ok(/Wrong answer/.test(t) && /onerror=/.test(t) && !(await page.evaluate(() => window.__x)), 'reports: listed, the note is plain text');
  await page.click('[data-act=set][data-s=fixed]'); await page.waitForTimeout(1200);
  ok((await q(`select status from cbt_private.pyq_reports limit 1`))[0].status === 'fixed', 'reports: marked fixed');
  // free chapters
  await page.goto(BASE + 'cp-dt764twzf54s5m.html#/pyq/free'); await page.waitForTimeout(1500);
  await page.check('input[value="nuclei"]'); await page.check('input[value="cell"]'); await page.click('[data-act=save]'); await page.waitForTimeout(1000);
  ok((await q(`select count(*)::int n from cbt_private.pyq_free`))[0].n === 2, 'free chapters: two chapters saved');
  await q(`delete from cbt_private.pyq_free`);
  // duplicates
  await page.goto(BASE + 'cp-dt764twzf54s5m.html#/pyq/dups'); await page.waitForTimeout(1500);
  ok(/Repeated questions · [1-9]/.test(await page.textContent('#ax-page')), 'duplicates: repeated questions listed');
  // CSV import: one good row, one bad row
  await page.goto(BASE + 'cp-dt764twzf54s5m.html#/pyq'); await page.waitForTimeout(1500);
  await page.click('[data-act=csv]'); await page.waitForSelector('#cv-f');
  const csv = 'paper,year,qno,subject,chapter,topic,question,option_a,option_b,option_c,option_d,answer,explanation\n' +
    'NEET 2015,2015,7,Physics,Nuclei,Radioactivity,"CSV import, with a comma",1,2,3,4,C,"Because, reasons"\n' +
    'NEET 2015,2015,8,Maths,,,"bad row",1,2,3,,E,\n';
  await page.setInputFiles('#cv-f', { name: 'q.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await page.waitForTimeout(600);
  t = await page.textContent('#cv-out');
  ok(/1 rows ready/.test(t) && /1 rows with problems/.test(t) && /Row 3/.test(t), 'csv: the good row is ready, the bad row is explained');
  await page.click('#cv-go'); await page.waitForTimeout(1500);
  const im = (await q(`select chapter, answer, verified, q from public.cbt_pyq where paper = 'NEET 2015'`));
  ok(im.length === 1 && im[0].chapter === 'nuclei' && im[0].answer === 2 && im[0].verified === false && /with a comma/.test(im[0].q), 'csv: imported with chapter by name, answer C, not verified');
  await q(`delete from public.cbt_pyq where paper = 'NEET 2015'`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await br.close(); server.close(); await db.end();
  console.log(fails ? fails + ' FAILED' : 'ALL PYQ ADMIN CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
