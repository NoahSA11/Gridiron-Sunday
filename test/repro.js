const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.tutorial', '1'); localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low', replays: true, qLen: 2 })); });
  await p.goto('http://127.0.0.1:8767/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  const out = await p.evaluate(() => {
    const found = []; const G = GS.Game, h = 1 / 30;
    let prev = '';
    for (let game = 0; game < 3 && found.length < 3; game++) {
      G.start('NE', 'DET', game % 2 ? 'NE' : 'DET');
      for (let i = 0; i < 30 * 60 * 25 && G.state !== 'final'; i++) {
        if (G.state === 'call') { const c = G.callCtx; G.pickPlay(c.us === 'off' ? GS.AI.callOffense(Object.assign({ kicker: c.sit.off.starters.K[0] }, c.sit)) : GS.AI.callDefense(c.sit, null, G.DIFF.pro)); }
        if (G.state === 'pat') G.patChoice('kick');
        if (G.state === 'break') G.resumeFromBreak();
        if (G.state === 'kickmeter') GS.Input.press('action');
        const before = G.state; G.update(h);
        if (G.state === 'replay') { let f; try { f = G.replayFrame(); } catch (e) { f = null; } if (!f) found.push({ before, recLen: GS.Sim.rec.length, phase: GS.Sim.phase, kind: GS.Sim.cfg.kind, t: G.replay.t, end: G.replay.end, q: G.G.quarter, clock: G.G.clock, next: G.G.next, prev }); }
        prev = before + '>' + G.state;
      }
    }
    return found;
  });
  console.log(JSON.stringify(out, null, 1)); await b.close();
})();
