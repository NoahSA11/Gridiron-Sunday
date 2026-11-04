// Season, kick meter, replay, halftime and final-screen flow.
const { chromium } = require('playwright'); const path = require('path');
const OUT = process.env.OUT || '/tmp';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1100, height: 620 } })).newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { if (!sessionStorage.getItem('init')) { localStorage.clear(); sessionStorage.setItem('init', 1); } localStorage.setItem('gs.tutorial2', '1'); localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low', replays: true })); });
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  const T = s => p.evaluate(x => GS.Game.debug.tick(x), s);
  const r = {};
  // --- kick meter: user field goal from the 25 (42 yards)
  await p.evaluate(() => { GS.Rules.preSnapPenalty = () => null; GS.Game.start('DAL', 'PHI', 'DAL'); const G = GS.Game.G; G.poss = 'home'; G.next = 'scrim'; G.ballOn = 75; G.down = 4; G.togo = 6; GS.Game.resumeFromBreak(); });
  await T(0.1);
  await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.offById('fg'))); await T(0.1);
  r.meterShown = await p.evaluate(() => GS.Game.state + ' ' + !document.querySelector('#meter').hidden);
  await T(0.42); await p.keyboard.press('Space'); await T(0.05); // power near the top of the swing
  await p.waitForTimeout(400); await p.screenshot({ path: OUT + '/30_meter.png' });
  r.power = await p.evaluate(() => GS.Game.meter.power.toFixed(2));
  // accuracy: wait for the needle to come back near center
  for (let i = 0; i < 60; i++) { const a = await p.evaluate(() => GS.Game.meter.acc); if (Math.abs(a) < 0.12) break; await T(1 / 30); }
  await p.keyboard.press('Space'); await T(0.1);
  r.acc = await p.evaluate(() => GS.Game.meter.acc.toFixed(2));
  for (let i = 0; i < 20; i++) { const s = await T(0.25); if (s !== 'live' && s !== 'presnap') break; }
  r.fg = await p.evaluate(() => ({ ticker: document.querySelector('#ticker').textContent, score: GS.Game.G.score }));
  await p.screenshot({ path: OUT + '/31_fg.png' });
  // --- replay after a touchdown: give the user the ball at the 3 and run a sneak
  for (let i = 0; i < 30; i++) { const s = await T(0.4); if (s === 'call' || s === 'pat') break; }
  await p.evaluate(() => { const G = GS.Game.G; G.poss = 'home'; G.next = 'scrim'; G.ballOn = 99; G.down = 1; G.togo = 1; GS.UI.hideScreens(); GS.Game.resumeFromBreak(); });
  await T(0.1); await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.offById('sneak'))); await T(0.1);
  await p.keyboard.press('Space');
  let sawReplay = false, sawPat = false;
  for (let i = 0; i < 40; i++) { const s = await T(0.25); if (s === 'replay' && !sawReplay) { sawReplay = true; await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/32_replay.png' }); } if (s === 'pat') { sawPat = true; break; } }
  r.sneak = await p.evaluate(() => document.querySelector('#ticker').textContent + ' | ' + GS.Game.G.score.home);
  r.replay = sawReplay; r.patScreen = sawPat;
  if (sawPat) { await p.screenshot({ path: OUT + '/33_pat.png' }); await p.click('#pTwo'); await T(0.1); r.twoCall = await p.evaluate(() => GS.Game.state + ' ' + GS.Game.G.patTwo); }
  // --- halftime + final via autoplay
  await p.evaluate(() => { GS.UI.hideScreens(); GS.Game.debug.autoplay(true); GS.Game.settings.replays = false; });
  let half = false;
  for (let i = 0; i < 200; i++) {
    const s = await p.evaluate(() => { for (let k = 0; k < 40; k++) { const st = GS.Game.state; if (st === 'break' || st === 'final') return st; GS.Game.debug.run(1); } return GS.Game.state; });
    if (s === 'break') { if (!half) { half = true; await p.screenshot({ path: OUT + '/34_half.png' }); } await p.evaluate(() => GS.Game.resumeFromBreak()); }
    if (s === 'final') break;
  }
  r.half = half; r.final = await p.evaluate(() => ({ state: GS.Game.state, score: GS.Game.G.score, q: GS.Game.G.quarter, ot: !!GS.Game.G.ot }));
  await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/35_final.png' });
  // --- season: create, play week 1 by autoplay, check standings advance
  await p.evaluate(() => GS.Game.quit());
  await p.click('#mSeason'); await p.waitForTimeout(200);
  await p.click('.tile[data-a=DET]'); await p.click('#tGo'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/36_season.png' });
  r.seasonWeek0 = await p.evaluate(() => GS.Season.S.week);
  await p.click('#sPlay'); await T(0.1);
  await p.evaluate(() => { GS.Game.debug.autoplay(true); GS.Game.settings.replays = false; });
  for (let i = 0; i < 200; i++) { const s = await p.evaluate(() => { GS.Game.debug.run(40); return GS.Game.state; }); if (s === 'final') break; }
  r.seasonAfter = await p.evaluate(() => ({ week: GS.Season.S.week, me: GS.Season.S.table.DET, games: Object.values(GS.Season.S.table).reduce((a, t) => a + t.w + t.l + t.t, 0) }));
  await p.click('#fSeason'); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/37_season_after.png' });
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1)); await b.close();
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
(async () => {
})();
