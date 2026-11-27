const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const dir = __dirname;
  const jobs = [1,2,3,4,5,6].map(n=>[String(n),1080,1920,`screenshot-${n}.png`]).concat([['fg',1024,500,'feature-graphic.png']]);
  for (const [s,w,h,out] of jobs) {
    const p = await b.newPage({ viewport:{width:w,height:h}, deviceScaleFactor:1 });
    p.on('pageerror', e=>console.log('ERR',s,e.message));
    await p.goto('file://'+path.join(dir,'source.html')+'?s='+s);
    await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(dir,out) });
    await p.close(); console.log('ok',out);
  }
  await b.close();
})();
