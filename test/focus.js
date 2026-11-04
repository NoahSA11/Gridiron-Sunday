const { chromium } = require('playwright'); const path = require('path');
const OUT = process.env.OUT || '/tmp';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.tutorial2', '1'); localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low', assist: false, replays: false })); });
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  const T = s => p.evaluate(x => GS.Game.debug.tick(x), s);
  const r = {};
  await p.evaluate(() => { GS.Rules.preSnapPenalty = () => null; GS.Game.start('KC', 'BUF', 'BUF'); const G = GS.Game.G; G.poss = 'away'; G.next = 'scrim'; G.ballOn = 30; GS.Game.resumeFromBreak(); });
  await T(0.1);
  r.call = await p.evaluate(() => GS.Game.state + ' ' + GS.Game.callCtx.us);
  await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.offById('verts'))); await T(0.2);
  await p.waitForTimeout(600); // let a render frame update the touch labels
  r.snapLabel = await p.evaluate(() => document.querySelector('#touch [data-act=action] b').textContent);
  const cdp = await ctx.newCDPSession(p);
  const act = await p.$eval('#touch [data-act=action]', b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 250, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y: 310, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 310, id: 1 }, { x: act.x, y: act.y, id: 2 }] });
  r.stickWhileTwo = await p.evaluate(() => GS.Input.move());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y: 310, id: 1 }] });
  r.stickAfterLift2 = await p.evaluate(() => GS.Input.move());
  await T(0.9);
  r.qbDrop = await p.evaluate(() => { const q = GS.Sim.off.find(p => p.role === 'QB'); return +(q.z - GS.Sim.los).toFixed(1); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await T(0.4);
  await p.waitForTimeout(700);
  r.badges = await p.evaluate(() => document.querySelectorAll('#badges .badge').length);
  r.throwLabel = await p.evaluate(() => document.querySelector('#touch [data-act=action] b').textContent);
  await p.screenshot({ path: OUT + '/22_phone_badges.png' });
  const bb = await p.$('#badges .badge:not([hidden])');
  if (bb) { const q = await bb.boundingBox(); r.badgeRole = await bb.evaluate(e => e.textContent); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: q.x + q.width / 2, y: q.y + q.height / 2, id: 3 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  await T(0.05);
  r.thrownByTap = await p.evaluate(() => ({ thrown: GS.Sim.thrown, to: GS.Sim.ball.intended && GS.Sim.ball.intended.role }));
  await T(0.4); await p.waitForTimeout(500); await p.screenshot({ path: OUT + '/23_phone_air.png' });
  for (let i = 0; i < 16; i++) { const s = await T(0.25); if (s !== 'live') break; }
  r.passResult = await p.evaluate(() => document.querySelector('#ticker').textContent);
  // defense: switch + dive tackle via touch buttons
  await p.evaluate(() => { const G = GS.Game.G; G.poss = 'home'; G.next = 'scrim'; G.ballOn = 30; G.down = 1; G.togo = 10; G.over = false; GS.UI.hideScreens(); GS.Game.resumeFromBreak(); });
  await T(0.1);
  r.defCall = await p.evaluate(() => GS.Game.state + ' ' + GS.Game.callCtx.us);
  await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.defById('c3'))); await T(2.6);
  r.defPhase = await p.evaluate(() => GS.Game.state + ' user=' + GS.Sim.user.role);
  await p.waitForTimeout(600);
  const sw = await p.$eval('#touch [data-act=action]', b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.textContent, hidden: b.hidden }; });
  r.switchBtn = sw.label + (sw.hidden ? ' (hidden)' : '');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sw.x, y: sw.y, id: 4 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await T(0.05);
  r.afterSwitch = await p.evaluate(() => GS.Sim.user.role);
  await T(0.6); await p.waitForTimeout(500);
  const dv = await p.$eval('#touch [data-act=dive]', b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.textContent, hidden: b.hidden }; });
  r.diveBtn = dv.label + (dv.hidden ? ' (hidden)' : '');
  await p.screenshot({ path: OUT + '/24_phone_def.png' });
  if (!dv.hidden) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dv.x, y: dv.y, id: 5 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  await T(0.05);
  r.dived = await p.evaluate(() => GS.Sim.user.dive > 0 || GS.Sim.user.down > 0);
  r.errors = errors;
  console.log(JSON.stringify(r, null, 1)); await b.close();
})();
