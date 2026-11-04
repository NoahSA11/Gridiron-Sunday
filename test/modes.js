// Computer vs. phone layout detection.
const { chromium } = require('playwright'); const path = require('path');
const OUT = process.env.OUT || '/tmp';
async function open(b, ctxOpts) {
  const ctx = await b.newContext(ctxOpts); const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.tutorial4', '1'); });
  await p.goto('http://127.0.0.1:8767/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  return { p, errors, ctx };
}
const state = p => p.evaluate(() => ({ mode: GS.Input.mode, touchCtl: getComputedStyle(document.querySelector('#touch')).display !== 'none' && !document.querySelector('#touch').hidden, hint: !document.querySelector('#hint').hidden && getComputedStyle(document.querySelector('#hint')).display !== 'none', rotate: !document.querySelector('#rotate').hidden, chip: document.querySelector('#modeChip').textContent, quality: GS.Game.settings.quality }));
async function intoGame(p) {
  await p.evaluate(() => { GS.Rules.preSnapPenalty = () => null; GS.Game.start('KC', 'BUF', 'BUF'); const G = GS.Game.G; G.poss = 'away'; G.next = 'scrim'; G.ballOn = 30; GS.Game.resumeFromBreak(); });
  await p.evaluate(() => { GS.Game.pickPlay(GS.Playbook.offById('verts')); GS.Game.debug.tick(0.2); });
  await p.waitForTimeout(800);
}
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = {};
  { const { p, errors, ctx } = await open(b, { viewport: { width: 1280, height: 720 } });
    await intoGame(p); R.laptop = await state(p); await p.screenshot({ path: OUT + '/40_laptop.png' }); R.laptopErr = errors; await ctx.close(); }
  { const { p, errors, ctx } = await open(b, { viewport: { width: 1366, height: 768 }, hasTouch: true });
    R.touchLaptopStart = await state(p);
    await p.keyboard.press('KeyW'); await p.waitForTimeout(100);
    await intoGame(p); R.touchLaptopAfterKey = await state(p);
    await p.touchscreen.tap(700, 400); await p.waitForTimeout(600); R.touchLaptopAfterTap = await state(p);
    await p.keyboard.press('KeyS'); await p.waitForTimeout(600); R.touchLaptopBack = await state(p); R.tlErr = errors; await ctx.close(); }
  { const { p, errors, ctx } = await open(b, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    await intoGame(p); R.phone = await state(p); await p.screenshot({ path: OUT + '/41_phone.png' });
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300); R.phonePortraitRotate = await p.evaluate(() => document.documentElement.classList.contains('portrait'));
    await p.setViewportSize({ width: 844, height: 390 });
    // manual override from the in-game chip
    await p.tap('#modeChip'); await p.waitForTimeout(600); R.phoneForcedDesktop = await state(p);
    await p.evaluate(() => GS.Game.setSetting('controls', 'auto')); R.phoneErr = errors; await ctx.close(); }
  { const { p, ctx } = await open(b, { viewport: { width: 1280, height: 720 } });
    await p.click('#mSettings'); await p.waitForTimeout(200); await p.screenshot({ path: OUT + '/42_settings.png' });
    await p.click('#setCtl [data-v=touch]'); await p.waitForTimeout(200); R.settingsTouch = (await state(p)).mode;
    await p.click('#setCtl [data-v=auto]'); await p.waitForTimeout(200); R.settingsAuto = (await state(p)).mode; await ctx.close(); }
  console.log(JSON.stringify(R, null, 1)); await b.close();
})();
