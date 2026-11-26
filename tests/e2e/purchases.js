// My purchases + receipt, the full-screen profile with its three-dot menu, and the account deletion request (v3.js,
// supabase_v101_orders_delete.sql), in Chromium at phone size, every Supabase call answered by the throw-away test
// database (tests/db/build.sh). Run by hand like onboarding.js (not in CI, to save minutes):
//   PGDATABASE=e2e node tests/e2e/purchases.js   (SHOTS=dir to save screenshots)
// throw-away test database (tests/db/build.sh). Phone size.
// Checks: after sign-in the setup opens and cannot be skipped; class and exam tiles move on by themselves; the choice is
// saved in the profile; the setup does not come back; the Tests page shows only the series of the student's exam /
// class (with "See all"), and Change switches it. Store: five steps (name, class, exam, mobile, city), wrong input is
// refused, Back keeps what was typed, and the details are saved. Run by hand like pyq.js (not in CI, to save minutes):
//   PGDATABASE=e2e node tests/e2e/onboarding.js   (SHOTS=dir to save screenshots)
const { chromium } = require('playwright');
const { Client } = require('pg');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PORT = 8775, BASE = `http://127.0.0.1:${PORT}/`;
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

(async () => {
  await db.connect();
  await q(`select set_config('request.headers', '{"x-real-ip":"4.4.4.9"}', false)`);
  await q(`update cbt_private.students set fail_count=0, locked_until=0, devices='{}', keep=$2::jsonb where mobile = $1`, [MOB, JSON.stringify({ pf: { cls: 'Class 12', exam: 'NEET' } })]);
  await q(`delete from cbt_private.rate_hits`); await q(`delete from cbt_private.delete_requests`);
  await q(`delete from public.cbt_store_orders where code in ('PUR1','PUR2','PUR3','PUR4')`);
  await q(`insert into public.cbt_store_orders(code,item_title,amount,name,mobile,status,list_price,coupon_code,coupon_off,paid_at) values
    ('PUR1','NEET Biology Pro Test Series',399,'Free Student',$1,'paid',499,'SAVE100',100,now()),
    ('PUR2','Free Mock Pack',0,'Free Student',$1,'paid',0,null,0,now()),
    ('PUR3','Not paid yet',100,'Free Student',$1,'pending',100,null,0,null),
    ('PUR4','Someone else''s',100,'Paid Student','9000000002','paid',100,null,0,now())`, [MOB]);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const br = await chromium.launch();
  try {
    const c = await br.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    await c.addInitScript(() => { try { localStorage.setItem('cbt_v3', 'true'); } catch (e) {} });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.route(u => !u.href.startsWith(BASE) && !u.href.startsWith(SUPA), r => r.abort());
    await p.route(SUPA + '/rest/v1/rpc/**', rpcRoute);
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#lp');
    await p.evaluate(() => { lpLogin(); login('code'); }); await p.waitForSelector('#ph');
    await p.fill('#ph', MOB); await p.fill('#cd', CODE); await p.click('#lbtn'); await wait(5000);
    const scr = () => S(p, 'const b=root.querySelector("#scrB");return b?b.innerText:""');
    // the stylesheet number inside v3.js must move with the script number in index.html, or phones keep the OLD v3.css
    const vj = /const V3VER=(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'v3.js'), 'utf8'))[1], vi = /v3\.js\?v=(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];
    ok(vj === vi, 'cache 1 V3VER in v3.js (' + vj + ') matches v3.js?v= in index.html (' + vi + ')');
    // profile: opened from the picture menu, full screen with a three-dot button
    await click(p, '#dav'); await wait(400); await click(p, '#dmenu [data-k=profile]'); await wait(1200);
    ok(await S(p, 'return root.querySelector(".scr.bleed .pf3-hero")!==null&&!root.querySelector(".pf3 .pff")'), 'profile 1 the profile opens full screen (hero to the top), details are read-only');
    ok(await S(p, 'return !!root.querySelector("#scrR [data-a=pfMore]")'), 'profile 2 the three-dot button is in the top bar');
    await shot(p, 'profile');
    // scrolling: the hero fades, the photo and name move up into the top bar
    await S(p, 'root.querySelector("#scrB").scrollTop=300'); await wait(500);
    ok(await S(p, 'return root.querySelector(".scr").classList.contains("pfmini")&&/Free Student/.test(root.querySelector("#scrT").innerText)&&parseFloat(getComputedStyle(root.querySelector(".pf3-in")).opacity)<0.2'), 'profile 1b scrolled: the name and photo are in the top bar, the hero has faded');
    await shot(p, 'profile-scrolled');
    await S(p, 'root.querySelector("#scrB").scrollTop=0'); await wait(400);
    // Edit opens a sheet; Update details saves and the page shows it
    await click(p, '#scrB [data-a=pfEdit]'); await wait(700);
    ok(await S(p, 'return !!root.querySelector("#sheet .fo [name=city]")&&/Update details/.test(root.querySelector("#sheet").innerText)'), 'profile 1c Edit opens the sheet with outlined fields and Update details');
    await shot(p, 'profile-edit');
    await p.evaluate(() => { const r = [...document.querySelectorAll('*')].find(e => e.shadowRoot && e.id === 'v3host').shadowRoot; const i = r.querySelector('#sheet [name=city]'); i.value = 'Jaipur'; });
    await click(p, '#sheet [data-a=pfSave]'); await wait(900);
    ok(/Jaipur/.test(await scr()), 'profile 1d Update details saves and the page shows the new city');
    await click(p, '#scrR [data-a=pfMore]'); await wait(700);
    const sh = await S(p, 'return root.querySelector("#sheet").innerText');
    ok(/My purchases/.test(sh) && /Account deletion/.test(sh) && /Log out/.test(sh), 'profile 3 the three-dot menu: My purchases, Account deletion, Log out');
    await shot(p, 'profile-menu');
    await click(p, '#sheet [data-a=purchases]'); for (let i = 0; i < 20 && !/NEET Biology/.test(await scr()); i++) await wait(300);
    let t = await scr();
    ok(/NEET Biology Pro Test Series/.test(t) && /Free Mock Pack/.test(t), 'purchases 1 paid orders are listed (paid and free)');
    ok(!/Not paid yet/.test(t) && !/Someone else/.test(t), 'purchases 2 pending orders and other students\' orders are not shown');
    ok(/₹399/.test(t) && /Free/.test(t), 'purchases 3 the amount paid, or Free');
    await shot(p, 'purchases');
    await click(p, '#scrB [data-a=purOpen]'); await wait(700); await shot(p, 'receipt-a'); await wait(700); await shot(p, 'receipt-b'); await wait(700); await shot(p, 'receipt-c'); await wait(2200);
    t = await scr();
    ok(/Payment successful/.test(t) && /PUR1/.test(t) && /Coupon SAVE100/.test(t) && /₹499/.test(t) && /Total paid/.test(t), 'receipt 1 the receipt shows the order, price, coupon and total');
    await shot(p, 'receipt');
    ok(await S(p, 'return root.querySelector(".rcp").classList.contains("rdy")&&!!root.querySelector(".rcp-tip")'), 'receipt 1b printing is done and the swipe hint is shown');
    // swipe the paper down with a finger: it tears off and goes into Download
    const pb = await S(p, 'const r=root.querySelector(".rcp-paper").getBoundingClientRect();return [r.left+r.width/2,r.top+60]');
    await p.mouse.move(pb[0], pb[1]); await p.mouse.down(); await p.mouse.move(pb[0], pb[1] + 40, { steps: 5 }); await p.mouse.move(pb[0], pb[1] + 130, { steps: 8 });
    await shot(p, 'receipt-drag'); await p.mouse.up(); await wait(350); await shot(p, 'receipt-fly'); await wait(1300);
    t = await scr();
    ok(/Your receipt is in Download/.test(t) && !/Payment successful/.test(t), 'receipt 1c the paper tore off into Download');
    await shot(p, 'receipt-gone');
    await click(p, '#scrB [data-a=rcAgain]'); await wait(600);
    ok(await S(p, 'return !!root.querySelector(".rcp-paper")&&!root.querySelector(".rcp").classList.contains("rdy")'), 'receipt 1d View receipt again prints it again');
    await wait(3300);
    const dl = p.waitForEvent('download');
    await click(p, '#scrB [data-a=rcDl]'); const d = await dl;
    const f = path.join(require('os').tmpdir(), 'rc-test.png'); await d.saveAs(f);
    ok(/^receipt-PUR1\.png$/.test(d.suggestedFilename()) && fs.statSync(f).size > 5000, 'receipt 2 Download receipt saves a picture (' + d.suggestedFilename() + ', ' + fs.statSync(f).size + ' bytes)');
    if (SHOTS) fs.copyFileSync(f, path.join(SHOTS, 'receipt-download.png'));
    // settings: Additional settings → Account deletion; the warning, then the request
    await p.evaluate(() => history.go(-2)); await wait(900);
    await click(p, '#scrR [data-a=pfMore]'); await wait(600); await click(p, '#sheet [data-a=delAcc]'); await wait(1500);
    t = await scr();
    ok(/Please read this carefully/.test(t) && /permanent/.test(t) && /Okay, continue/.test(t) && /No, cancel/.test(t), 'delete 1 the warning screen with Okay, continue / No, cancel');
    await shot(p, 'delete-warning');
    await click(p, '#scrB [data-a=delGo]'); await wait(700);
    ok(await S(p, 'return root.querySelector("#delB").disabled'), 'delete 2 Submit stays off until DELETE is typed');
    await shot(p, 'delete-confirm');
    await p.evaluate(() => { const r = [...document.querySelectorAll('*')].find(e => e.shadowRoot && e.id === 'v3host').shadowRoot; const i = r.querySelector('#delT'); i.value = 'delete'; i.dispatchEvent(new Event('input')); r.querySelector('[data-dw]').click(); });
    ok(!(await S(p, 'return root.querySelector("#delB").disabled')), 'delete 3 typing DELETE turns Submit on');
    await click(p, '#delB'); await wait(1500);
    t = await scr();
    ok(/Request submitted/.test(t) && /Withdraw request/.test(t) && /deleted within 24 hours/.test(t) && !/Time left/i.test(t), 'delete 4 the request is sent and shown (deleted within 24 hours, no timer)');
    const rq = await q(`select status, reason from cbt_private.delete_requests where mobile = $1`, [MOB]);
    ok(rq.length === 1 && rq[0].status === 'pending' && rq[0].reason === 'I have another account', 'delete 5 one pending request is stored with the reason');
    ok((await q(`select 1 from cbt_private.students where mobile = $1`, [MOB])).length === 1, 'delete 6 nothing is deleted by the app itself');
    await shot(p, 'delete-sent');
    await click(p, '#scrB [data-a=delCancel]'); await wait(1200);
    ok(/Please read this carefully/.test(await scr()) && (await q(`select status from cbt_private.delete_requests where mobile = $1`, [MOB]))[0].status === 'cancelled', 'delete 7 Withdraw request cancels it');
    ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  } finally { await br.close(); }
  await db.end(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
