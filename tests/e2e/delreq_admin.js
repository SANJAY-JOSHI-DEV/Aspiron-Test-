// Admin: Deletion requests (cx/m-delreq.js, supabase_v102_delete_requests.sql). The owner sees a student's request,
// rejects one and deletes another; the page has no errors. Run by hand (not in CI):
//   PGDATABASE=e2e node tests/e2e/delreq_admin.js   (SHOTS=dir for screenshots)
const { chromium } = require('playwright');
const { Client } = require('pg');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), PORT = 8776, BASE = `http://127.0.0.1:${PORT}/`;
const SUPA = /SUPABASE_URL:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'))[1];
const TYPES = { '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const SHOTS = process.env.SHOTS || '';
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
  await q(`select set_config('request.headers', '{"x-real-ip":"9.9.9.7","user-agent":"e2e"}', false)`);
  await q(`delete from cbt_private.admin_totp; delete from cbt_private.admin_fails; delete from cbt_private.admin_sessions; delete from cbt_private.admin_users`);
  await q(`update cbt_private.settings set value = encode(sha256(convert_to('aspiron-admin:e2eKey2026', 'UTF8')), 'hex') where key = 'admin_gate'`);
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const br = await chromium.launch();
  try {
    for (const vw of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
      const tag = vw.width + 'px';
      await q(`delete from cbt_private.delete_requests`);
      await q(`insert into cbt_private.students (id, name, mobile, status, salt, code_hash) values
        ('bbbbbbbb-0000-0000-0102-0000000000a1', 'Leaver <b>One</b>', '9840000001', 'approved', 's1', cbt_private.hash_code('s1','AAAA1111')),
        ('bbbbbbbb-0000-0000-0102-0000000000a2', 'Stayer Two', '9840000002', 'approved', 's2', cbt_private.hash_code('s2','BBBB2222')) on conflict do nothing`);
      await q(`insert into cbt_private.delete_requests (student_id, mobile, name, reason, created_at) values
        ('bbbbbbbb-0000-0000-0102-0000000000a1', '9840000001', 'Leaver <b>One</b>', 'privacy <script>window.__x=1</script>', now() - interval '30 hours'),
        ('bbbbbbbb-0000-0000-0102-0000000000a2', '9840000002', 'Stayer Two', '', now() - interval '2 hours')`);
      const ctx = await br.newContext({ viewport: vw }); await ctx.addInitScript(() => { try { localStorage.setItem('adm_k', 'e2eKey2026'); } catch (e) {} });
      const page = await ctx.newPage(); const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.route(u => !u.href.startsWith(BASE) && !u.href.startsWith(SUPA), r => r.abort());
      await page.route(SUPA + '/rest/v1/rpc/**', rpcRoute);
      await page.goto(BASE + 'cp-dt764twzf54s5m.html'); await page.waitForSelector('#lg-p');
      await page.fill('#lg-p', 'OwnerPass2026x'); await page.click('#lg-go'); await page.waitForSelector('#ax-page');
      await page.goto(BASE + 'cp-dt764twzf54s5m.html#/delreq'); await page.waitForTimeout(1500);
      let t = await page.innerText('#ax-page');
      ok(/Deletion requests/.test(t) && /Overdue/.test(t) && /Stayer Two/.test(t) && /Accept and delete/.test(t), tag + ' 1 the page lists the waiting requests, the old one is Overdue');
      ok(await page.evaluate(() => window.__x === undefined) && /<b>One<\/b>/.test(t), tag + ' 2 a name or reason typed by a student is shown as text, never run');
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'admin-delreq-' + tag + '.png') }); }
      if (vw.width === 1280) {
        await page.click('[data-act=rej][data-id]'); await page.waitForSelector('.modal [data-ok], .modal .btn.pri, .modal .btn.danger'); 
        await page.click('.modal .btn.pri, .modal [data-ok]'); await page.waitForTimeout(1200);
        const st = (await q(`select status from cbt_private.delete_requests where mobile='9840000001' or mobile='9840000002' order by mobile`)).map(r => r.status);
        ok(st.includes('rejected') && st.includes('pending'), tag + ' 3 Reject closes one request and keeps the student');
        await page.click('[data-act=del][data-id]'); await page.waitForSelector('.modal .btn.danger'); await page.click('.modal .btn.danger'); await page.waitForTimeout(1200);
        ok((await q(`select 1 from cbt_private.students where mobile in ('9840000001','9840000002')`)).length === 1 && (await q(`select status from cbt_private.delete_requests where status='done'`)).length === 1, tag + ' 4 Accept removes the student and marks the request done');
      }
      ok(errs.length === 0, tag + ' no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await ctx.close();
    }
  } finally { await br.close(); }
  await db.end(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
