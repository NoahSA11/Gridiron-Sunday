// Defense on a portrait phone: hold-to-tackle, swat & pick, layout.
const { chromium } = require('playwright'); const path = require('path');
const OUT = process.env.OUT || '/tmp';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low', replays: false })); });
  await p.goto('http://127.0.0.1:8767/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  const T = s => p.evaluate(x => GS.Game.debug.tick(x), s);
  const cdp = await ctx.newCDPSession(p);
  const R = { tackle: [], swat: [], pick: [] };
  await p.evaluate(() => { GS.Rules.preSnapPenalty = () => null; GS.Game.start('KC', 'BUF', 'BUF'); });
  await p.waitForTimeout(400);
  R.tutorialShown = await p.evaluate(() => !document.querySelector('#tutorial').hidden);
  await p.screenshot({ path: OUT + '/60_portrait_tutorial.png' });
  R.tutBtnVisible = await p.evaluate(() => { const r = document.querySelector('#tutOk').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
  await p.evaluate(() => document.querySelector('#tutOk').click());
  const defSnap = async (playId) => {
    await p.evaluate(id => { GS.AI.callOffense = () => GS.Playbook.offById(id); const G = GS.Game.G; G.poss = 'home'; G.next = 'scrim'; G.ballOn = 30; G.down = 1; G.togo = 10; G.over = false; GS.UI.hideScreens(); GS.Game.resumeFromBreak(); }, playId);
    await T(0.1); await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.defById('c3'))); await T(2.5);
  };
  const btn = sel => p.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: e.textContent, hidden: e.hidden }; });
  // ---- hold TACKLE vs a run
  for (let i = 0; i < 4; i++) {
    await defSnap('izone'); await T(0.5); await p.waitForTimeout(500);
    const hint = await p.evaluate(() => document.querySelector('#hint').textContent);
    if (i === 0) await p.screenshot({ path: OUT + '/61_portrait_runD.png' });
    const t = await btn('#touch [data-act=dive]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t.x, y: t.y, id: 9 }] });
    let st; for (let k = 0; k < 24; k++) { st = await T(0.15); if (st !== 'live') break; }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    R.tackle.push(await p.evaluate(h => { const S = GS.Sim, hit = S.log.filter(e => e.type === 'hit').pop(); return { hint: h, label: 'TACKLE', byUser: !!(hit && hit.d && hit.d.user), userDove: S.user.dive > 0 || S.user.down > 0, gain: S.result ? Math.round(S.result.gain) : null }; }, hint));
  }
  // ---- swat / pick vs passes: put the user's defender on the landing spot and press as it arrives
  for (const kind of ['swat', 'pick']) for (let i = 0; i < 8; i++) {
    await defSnap('slants');
    let inAir = false; for (let k = 0; k < 60; k++) { await T(0.05); if (await p.evaluate(() => GS.Sim.ball.state === 'air')) { inAir = true; break; } if (await p.evaluate(() => GS.Sim.phase !== 'live')) break; }
    if (!inAir) { R[kind].push('no throw'); continue; }
    const info = await p.evaluate(() => { const S = GS.Sim, b = S.ball, u = S.user; return { user: u.role, distToSpot: +Math.hypot(u.x - b.target.x, u.z - b.target.z).toFixed(1), hint: document.querySelector('#hint').textContent }; });
    if (kind === 'swat' && i === 0) { await p.waitForTimeout(500); await p.screenshot({ path: OUT + '/62_portrait_ballair.png' }); info.btns = [(await btn('#touch [data-act=action]')).label, (await btn('#touch [data-act=dive]')).label]; }
    await p.evaluate(() => { const S = GS.Sim, b = S.ball, u = S.user; const n = Math.hypot(b.target.x - u.x, b.target.z - u.z) || 1; u.x = b.target.x - (b.target.x - u.x) / n * 0.6; u.z = b.target.z - (b.target.z - u.z) / n * 0.6; });
    for (let k = 0; k < 40; k++) { const left = await p.evaluate(() => GS.Sim.ball.flightDur - GS.Sim.ball.flightT); if (left < 0.3) break; await T(0.03); }
    const sel = kind === 'swat' ? '#touch [data-act=action]' : '#touch [data-act=dive]'; const bb = await btn(sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x, y: bb.y, id: 11 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    for (let k = 0; k < 20; k++) { if (await T(0.1) !== 'live') break; }
    info.result = await p.evaluate(() => { const S = GS.Sim; return S.log.some(e => e.type === 'int') ? 'INT' : S.log.some(e => e.type === 'breakup') ? 'breakup' : S.log.some(e => e.type === 'catch') ? 'caught' : S.reason; });
    R[kind].push(info);
  }
  R.errors = errors;
  console.log(JSON.stringify(R, null, 1)); await b.close();
})();
