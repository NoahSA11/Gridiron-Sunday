const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.tutorial', '1'); localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low' })); });
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  await p.evaluate(() => GS.Game.start('KC', 'BUF', 'BUF'));
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    let n = 0; const t0 = performance.now(); await new Promise(res => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { fps: n / 3, q: GS.Render.quality, info: GS.Render.info() };
  });
  console.log(JSON.stringify(r));
  await b.close();
})();
