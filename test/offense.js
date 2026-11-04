// Offense controls: play art, receiver icons, hot route from icon, no AI takeover, tap vs hold passes.
const { chromium } = require('playwright'); const path = require('path');
const OUT = process.env.OUT || '/tmp';
async function open(b, opts) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.tutorial2', '1'); localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low', replays: false })); });
  await p.goto('http://127.0.0.1:8767/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  return { p, ctx, errors };
}
const T = (p, s) => p.evaluate(x => GS.Game.debug.tick(x), s);
async function setupPass(p, playId) {
  await p.evaluate(id => { GS.Rules.preSnapPenalty = () => null; if (!GS.Game.G) GS.Game.start('KC', 'BUF', 'BUF'); const G = GS.Game.G; G.poss = 'away'; G.next = 'scrim'; G.ballOn = 30; G.down = 1; G.togo = 10; G.over = false; GS.UI.hideScreens(); GS.Game.resumeFromBreak(); }, playId);
  await T(p, 0.1); await p.evaluate(id => GS.Game.pickPlay(GS.Playbook.offById(id)), playId); await T(p, 0.2); await p.waitForTimeout(700);
}
const ballInfo = p => p.evaluate(() => { const b = GS.Sim.ball; return { thrown: GS.Sim.thrown, to: b.intended && b.intended.role, speed: +Math.hypot(b.vx, b.vz).toFixed(1) }; });
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = { laptop: {}, phone: {} };
  { const { p, ctx, errors } = await open(b, { viewport: { width: 1280, height: 720 } }); const r = R.laptop;
    await setupPass(p, 'verts');
    r.presnapIcons = await p.evaluate(() => [...document.querySelectorAll('#badges .badge:not([hidden])')].map(n => n.textContent));
    r.hint = await p.evaluate(() => document.querySelector('#hint').textContent);
    await p.screenshot({ path: OUT + '/50_laptop_presnap.png' });
    await p.keyboard.press('Digit2'); await T(p, 0.05); r.hotMenu = await p.evaluate(() => !document.querySelector('#hot').hidden && document.querySelector('#hot .hothead').textContent);
    await p.keyboard.press('Digit2'); await T(p, 0.2); r.hot = await p.evaluate(() => JSON.stringify(GS.Game.cfg.hot));
    await p.waitForTimeout(600); await p.screenshot({ path: OUT + '/51_laptop_hot.png' });
    await p.keyboard.press('Space'); await T(p, 1.6); // no input: QB must not throw by himself
    r.idleNoThrow = await p.evaluate(() => ({ thrown: GS.Sim.thrown, qbHasBall: GS.Sim.ball.holder && GS.Sim.ball.holder.role, dropped: +(GS.Sim.off.find(q => q.role === 'QB').z - GS.Sim.los).toFixed(1) }));
    await p.waitForTimeout(700); await p.screenshot({ path: OUT + '/52_laptop_dropback.png' });
    r.liveIcons = await p.evaluate(() => [...document.querySelectorAll('#badges .badge:not([hidden])')].map(n => n.textContent));
    r.liveHint = await p.evaluate(() => document.querySelector('#hint').textContent);
    await p.keyboard.press('Digit3'); await T(p, 0.05); r.tap = await ballInfo(p);
    for (let i = 0; i < 16; i++) { if (await T(p, 0.25) !== 'live') break; }
    await setupPass(p, 'slants'); await p.keyboard.press('Space'); await T(p, 0.9);
    await p.keyboard.down('Digit1'); await p.waitForTimeout(450); await T(p, 0.03); r.holdBeforeRelease = await ballInfo(p); await p.keyboard.up('Digit1');
    r.errors = errors; await ctx.close(); }
  { const { p, ctx, errors } = await open(b, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const r = R.phone;
    await setupPass(p, 'curlflat');
    r.hint = await p.evaluate(() => document.querySelector('#hint').textContent);
    await p.screenshot({ path: OUT + '/53_phone_presnap.png' });
    const cdp = await ctx.newCDPSession(p);
    const tapAt = async (x, y, holdMs) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] }); if (holdMs) { await p.waitForTimeout(holdMs); await T(p, 0.03); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const snap = await p.$eval('#touch [data-act=action]', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await tapAt(snap[0], snap[1]); await T(p, 1.1); await p.waitForTimeout(400);
    r.idleNoThrow = await p.evaluate(() => GS.Sim.thrown);
    await p.screenshot({ path: OUT + '/54_phone_dropback.png' });
    const ic = await p.$eval('#badges .badge:not([hidden]) i', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, e.parentElement.dataset.i]; });
    await tapAt(ic[0], ic[1]); await T(p, 0.05); r.tap = await ballInfo(p); r.tapIcon = ic[2]; r.stateAtTap = await p.evaluate(() => GS.Game.state);
    await T(p, 0.3); await p.waitForTimeout(500); await p.screenshot({ path: OUT + '/55_phone_throw.png' });
    for (let i = 0; i < 16; i++) { if (await T(p, 0.25) !== 'live') break; }
    await setupPass(p, 'curlflat'); await tapAt(snap[0], snap[1]); await T(p, 1.2); await p.waitForTimeout(600);
    const ic2 = await p.$eval('#badges .badge:not([hidden]) i', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await tapAt(ic2[0], ic2[1], 400); await T(p, 0.05); r.hold = await ballInfo(p);
    r.errors = errors; await ctx.close(); }
  console.log(JSON.stringify(R, null, 1)); await b.close();
})();
