// First-time setup (v3.js) and the store welcome (store.js), in Chromium, with every Supabase call answered by the
// throw-away test database (tests/db/build.sh). Phone size.
// Checks: after sign-in the setup opens and cannot be skipped; class and exam tiles move on by themselves; the choice is
// saved in the profile; the setup does not come back; the Tests page shows only the series of the student's exam /
// class (with "See all"), and Change switches it. Store: five steps (name, class, exam, mobile, city), wrong input is
// refused, Back keeps what was typed, and the details are saved. Run by hand like pyq.js (not in CI, to save minutes):
//   PGDATABASE=e2e node tests/e2e/onboarding.js   (SHOTS=dir to save screenshots)
const { chromium } = require('playwright');
const { Client } = require('pg');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PORT = 8772, BASE = `http://127.0.0.1:${PORT}/`;
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
async function rpcRoute(route) {
  const req = route.request(), fn = req.url().split('/rpc/')[1].split('?')[0];
  if (!/^[a-z0-9_]+$/.test(fn)) return route.fulfill({ status: 400, body: '{}' });
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
  const keys = Object.keys(body).filter(k => /^p_[a-z0-9_]+$/.test(k));
  const vals = keys.map(k => body[k] === null || body[k] === undefined ? null : typeof body[k] === 'object' ? JSON.stringify(body[k]) : String(body[k]));
  try {
    const r = await q(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, vals);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r[0].r) });
  } catch (e) {
    if (!/does not exist/.test(e.message)) console.log('SQL ERROR in', fn, ':', e.message);
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: e.message }) });
  }
}
// the v3 app lives in a shadow root
const S = (p, fn, arg) => p.evaluate(([f, a]) => { const r = [...document.querySelectorAll('*')].find(e => e.shadowRoot && e.id === 'v3host'); return new Function('root', 'a', f)(r.shadowRoot, a); }, [fn, arg]);
const click = (p, sel) => S(p, `const e=root.querySelector(a);if(!e)return false;e.click();return true`, sel);
const ob = p => S(p, 'const e=root.querySelector(".ob3");return e?e.innerText:null');
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
const MOB = '9000000001', CODE = 'AAAA1111';
const CB = 'cccccccc-0000-0000-0000-0000000000c1', JE = 'cccccccc-0000-0000-0000-0000000000c2';

(async () => {
  await db.connect();
  await q(`select set_config('request.headers', '{"x-real-ip":"4.4.4.8"}', false)`);
  await q(`update cbt_private.students set fail_count=0, locked_until=0, devices='{}', keep='{}'::jsonb where mobile = $1`, [MOB]);
  await q(`delete from cbt_private.rate_hits`);
  // two more store series: one tagged CBSE · Class 12, one tagged JEE
  await q(`insert into public.cbt_store_items(id,title,price,active,buy_on) values ($1,'CBSE Boards Pack',299,true,true),($2,'JEE Main Pack',399,true,true) on conflict (id) do nothing`, [CB, JE]);
  await q(`insert into cbt_private.store_item_tags(item_id,exams,classes) values ($1,'["CBSE"]','["Class 12"]'),($2,'["JEE"]','[]') on conflict (item_id) do update set exams=excluded.exams, classes=excluded.classes`, [CB, JE]);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const br = await chromium.launch();
  try {
    /* ---------- the student app ---------- */
    const c = await br.newContext({ viewport: { width: 390, height: 844 } });
    await c.addInitScript(() => { try { localStorage.setItem('cbt_v3', 'true'); } catch (e) {} });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.route(u => !u.href.startsWith(BASE) && !u.href.startsWith(SUPA), r => r.abort());
    await p.route(SUPA + '/rest/v1/rpc/**', rpcRoute);
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#lp');
    await p.evaluate(() => { lpLogin(); login('code'); }); await p.waitForSelector('#ph');
    await p.fill('#ph', MOB); await p.fill('#cd', CODE); await p.click('#lbtn'); await wait(4500);
    let t = await ob(p);
    ok(t && /WELCOME TO ASPIRON/.test(t) && /Let’s start/.test(t), 'app 1 the setup opens after sign-in');
    ok(t && !/Skip/.test(t) && (await S(p, 'return !root.querySelector(".ob3 [data-ob=skip]")')), 'app 1b there is no Skip');
    await shot(p, 'app-0-welcome');
    await click(p, '.ob3 [data-ob=next]'); await wait(700); t = await ob(p);
    ok(/How the app works/.test(t) && /Test series/.test(t) && /All-India rank/.test(t) && /PYQ/.test(t), 'app 2 the guide: how the app works');
    await shot(p, 'app-1-guide');
    await click(p, '.ob3 [data-ob=next]'); await wait(700); t = await ob(p);
    ok(/What are you preparing for/.test(t) && ['NEET', 'IIT-JEE', 'CBSE', 'CUET'].every(x => t.includes(x)), 'app 3 goal step first: NEET, IIT-JEE, CBSE, CUET');
    ok(await S(p, 'return root.querySelector(".ob3 [data-ob=next]").disabled'), 'app 3b Continue waits for an exam');
    await click(p, '.ob3 [data-ob=next]'); await wait(400);
    ok(/What are you preparing for/.test(await ob(p)), 'app 3c it cannot move on without an exam');
    await shot(p, 'app-2-exam');
    await click(p, '.ob3 [data-ob=exam][data-v="CBSE"]'); await wait(1200); t = await ob(p);
    ok(/Which class are you in/.test(t) && ['Class 9', 'Class 10', 'Class 11', 'Class 12'].every(x => t.includes(x)) && !/Dropper/.test(t), 'app 4 the class step shows only the classes of CBSE');
    await shot(p, 'app-3-class');
    await click(p, '.ob3 [data-ob=cls][data-v="Class 12"]'); await wait(1200); t = await ob(p);
    ok(/ALL SET/.test(t) && /CBSE Boards · Class 12/.test(t) && /Close/.test(t), 'app 5 the last step: all set, Close shows only now');
    const pf = await p.evaluate(m => JSON.parse(localStorage.getItem('cbt_pf_' + m) || '{}'), MOB);
    ok(pf.cls === 'Class 12' && pf.exam === 'CBSE', 'app 5b saved in the profile (' + JSON.stringify({ cls: pf.cls, exam: pf.exam }) + ')');
    await shot(p, 'app-4-done');
    await click(p, '.ob3 [data-ob=next]'); await wait(900);
    ok((await ob(p)) === null, 'app 6 Go to my dashboard closes it');
    await wait(2500);
    const kept = (await q(`select keep->'pf' pf from cbt_private.students where mobile = $1`, [MOB]))[0].pf;
    ok(kept && kept.cls === 'Class 12' && kept.exam === 'CBSE', 'app 6b kept on the account too, so a new phone does not ask again');
    await p.reload(); await wait(4500);
    ok((await ob(p)) === null, 'app 7 it does not come back after the choice');
    // the Tests page: the series of this exam and class only
    await p.evaluate(() => { location.hash = '#/x/test'; }); await wait(3500);
    const tt = () => S(p, 'const b=root.querySelector("#tBody");return b?b.innerText:""');
    t = await tt();
    // the three offer cards on top always show; the store list below is only this student's exam and class
    const lst = t.split(/\d+ series/)[1] || '';
    ok(/CBSE Boards Pack/.test(lst) && !/JEE Main Pack/.test(lst), 'app 8 Tests page list: the CBSE series shows, the JEE one does not');
    await shot(p, 'app-5-tests');
    // v121: the Filter sheet holds the goal card and "Show every test series"; Change opens the one goal picker
    await click(p, '[data-a=tFilter]'); await wait(700);
    await click(p, '[data-ca]'); await wait(900);
    await click(p, '.fb[data-a=tFilter]').catch(() => {});
    ok(await S(p, 'return !!root.querySelector("[data-a=catEdit]")'), 'app 9 the Filter sheet has the exam goal card with Change');
    await shot(p, 'filter-0');
    await click(p, '[data-a=catEdit]'); await wait(900);
    ok(await S(p, 'return !!root.querySelector("[data-a=goalPick]")') && /Select your goal/.test(await S(p, 'return root.querySelector("#sheet").innerText')), 'app 10 Change opens Select your goal');
    await shot(p, 'goal-1');
    await click(p, '[data-a=goalPick][data-v="JEE"]'); await wait(500); await shot(p, 'goal-2');
    ok(/Select your class/.test(await S(p, 'return root.querySelector("#sheet").innerText')) && await S(p, 'return !root.querySelector("[data-a=goalCls][data-v=\\"Class 9\\"]")'), 'app 10a step 2 lists the classes of JEE only');
    await click(p, '[data-a=goalCls][data-v="Class 12"]'); await wait(1500); t = await tt();
    ok(/IIT-JEE · Class 12/.test(t) || JSON.parse(await p.evaluate(m => localStorage.getItem('cbt_pf_' + m), MOB)).exam === 'JEE', 'app 10b switched to JEE');
    ok(JSON.parse(await p.evaluate(m => localStorage.getItem('cbt_pf_' + m), MOB)).exam === 'JEE', 'app 10c the change is saved in the profile');
    ok(!errs.length, 'app no page errors ' + errs.join(' | '));
    await c.close();

    /* ---------- the store welcome ---------- */
    const c2 = await br.newContext({ viewport: { width: 390, height: 844 } });
    const s = await c2.newPage(); const e2 = [];
    s.on('pageerror', e => e2.push(e.message));
    await s.route(u => !u.href.startsWith(BASE) && !u.href.startsWith(SUPA), r => r.abort());
    await s.route(SUPA + '/rest/v1/rpc/**', rpcRoute);
    await s.goto(BASE + 'store.html'); await wait(1500);
    ok(await s.isVisible('#gate') && /Step 1 of 5/.test(await s.textContent('#gcnt')), 'store 1 the welcome opens at step 1 of 5');
    ok(!/google|email/i.test((await s.textContent('#gstage')) + (await s.getAttribute('#gn', 'placeholder'))), 'store 1b no Google or email sign-in');
    await s.click('#ggo'); ok(/name/.test(await s.textContent('#ger')), 'store 2 an empty name is refused');
    await s.fill('#gn', 'Riya Verma'); await s.keyboard.press('Enter'); await wait(700);
    // the order: name, class, exam, mobile, city
    await s.click('#ggo'); ok(/class/.test(await s.textContent('#ger')) && /Step 2 of 5/.test(await s.textContent('#gcnt')), 'store 3 step 2 is the class, and a class is needed');
    await s.click('#gback'); await wait(700);
    ok((await s.inputValue('#gn')) === 'Riya Verma', 'store 3b Back keeps the name');
    await s.click('#ggo'); await wait(700);
    await s.click('[data-gpick=cls][data-v="Class 11"]'); await wait(1100);
    ok(/Step 3 of 5/.test(await s.textContent('#gcnt')) && /preparing for/.test(await s.textContent('#gstage')), 'store 4 a class tile moves on to the exam');
    await s.click('[data-gpick=exam][data-v="neet"]'); await wait(1100);
    ok(/Step 4 of 5/.test(await s.textContent('#gcnt')) && await s.isVisible('#gm'), 'store 4b an exam tile moves on to the mobile number');
    await s.fill('#gm', '12345'); await s.click('#ggo'); ok(/mobile/.test(await s.textContent('#ger')), 'store 5 a wrong number is refused');
    await s.fill('#gm', '9876543210'); await s.click('#ggo'); await wait(700);
    ok(/Step 5 of 5/.test(await s.textContent('#gcnt')), 'store 5a then the city');
    await s.click('#ggo'); ok(/city/.test(await s.textContent('#ger')), 'store 5b a city is needed');
    await s.fill('#gcity', 'Kota'); await s.click('#ggo'); await wait(2200);
    const me = await s.evaluate(() => JSON.parse(localStorage.getItem('store_me') || 'null'));
    ok(me && me.name === 'Riya Verma' && me.mobile === '9876543210' && me.cls === 'Class 11' && me.course === 'neet' && me.city === 'Kota', 'store 6 saved: name, mobile, class, exam and city');
    ok(!(await s.isVisible('#gate')) && /NEET · Class 11 · Kota/.test(await s.textContent('#mesub')), 'store 6b the store opens with the details in the menu');
    ok(!e2.length, 'store no page errors ' + e2.join(' | '));
    await c2.close();
  } finally {
    await q(`delete from public.cbt_store_items where id in ($1, $2)`, [CB, JE]);
    await br.close(); server.close(); await db.end();
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
