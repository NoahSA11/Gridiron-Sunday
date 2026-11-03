const { chromium } = require('playwright'); const path = require('path');
const OUT = process.env.OUT || '/tmp';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1100, height: 620 } })).newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.tutorial', '1'); localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low', replays: true })); });
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  const T = s => p.evaluate(x => GS.Game.debug.tick(x), s);
  await p.evaluate(() => { GS.Rules.preSnapPenalty = () => null; GS.Game.start('SF', 'SEA', 'SF'); const G = GS.Game.G; G.poss = 'home'; G.next = 'scrim'; G.ballOn = 40; GS.Game.resumeFromBreak(); });
  await T(0.1); await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.offById('izone'))); await T(0.1); await p.keyboard.press('Space');
  let st; for (let i = 0; i < 30; i++) { st = await T(0.2); if (st === 'post') break; }
  await p.keyboard.press('KeyX'); st = await T(0.05);
  const r = { afterX: st, frames: await p.evaluate(() => GS.Sim.rec.length) };
  await T(1.0); await p.waitForTimeout(500); await p.screenshot({ path: OUT + '/38_replay.png' });
  r.tag = await p.evaluate(() => !document.querySelector('#replayTag').hidden);
  for (let i = 0; i < 40; i++) { st = await T(0.25); if (st !== 'replay') break; }
  r.afterReplay = st; r.errors = errors;
  console.log(JSON.stringify(r)); await b.close();
})();
