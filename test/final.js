// Settings fit, end zone text, field view, defender tap, steady camera, challenges.
const { chromium } = require('playwright'); const path = require('path');
const OUT = process.env.OUT || '/tmp';
async function open(b, opts) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => { localStorage.setItem('gs.tutorial4', '1'); localStorage.setItem('gs.settings', JSON.stringify({ quality: 'low', replays: false })); });
  await p.goto('http://127.0.0.1:8767/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  return { p, ctx, errors };
}
const T = (p, s) => p.evaluate(x => GS.Game.debug.tick(x), s);
const fits = p => p.evaluate(() => { const bad = [...document.querySelectorAll('#screen button, #screen .seg, #screen label, #screen p')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map(e => e.textContent.trim().slice(0, 20)); return { pageWider: document.querySelector('#screen').scrollWidth > innerWidth + 1, offscreen: bad }; });
async function situation(p, side, playId, ballOn) {
  await p.evaluate(([side, id, ballOn]) => { GS.Rules.preSnapPenalty = () => null; if (!GS.Game.G) GS.Game.start('KC', 'BUF', 'BUF'); const G = GS.Game.G; G.poss = side === 'off' ? 'away' : 'home'; G.next = 'scrim'; G.ballOn = ballOn; G.down = 1; G.togo = 10; G.over = false; G.quarter = 1; G.clock = 150; if (id) GS.AI.callOffense = () => GS.Playbook.offById(id); GS.UI.hideScreens(); GS.Game.resumeFromBreak(); }, [side, playId, ballOn || 30]);
  await T(p, 0.1);
}
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const R = {};
  // 1) settings on phones
  for (const [name, vp] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const { p, ctx } = await open(b, { viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await p.tap('#mSettings'); await p.waitForTimeout(300); R['settings_' + name] = await fits(p);
    await p.screenshot({ path: OUT + `/70_settings_${name}.png`, fullPage: false }); await ctx.close();
  }
  // 2) end zones, field view, defender tap, camera, challenges on a phone in landscape
  const { p, ctx, errors } = await open(b, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await situation(p, 'off', null, 88); await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.offById('izone'))); await T(p, 0.2); await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + '/71_far_endzone.png' });
  await p.evaluate(() => GS.Input.press('view')); await T(p, 0.05); await p.waitForTimeout(1500);
  R.fieldView = await p.evaluate(() => ({ survey: GS.Game.survey, camY: +GS.Render.camState.pos.y.toFixed(1), btn: document.querySelector('#touch [data-act=view] b').textContent }));
  await p.screenshot({ path: OUT + '/72_field_view.png' });
  await p.evaluate(() => GS.Input.press('view')); await T(p, 0.05);
  // defender tap
  await situation(p, 'def', 'slants', 40); await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.defById('c3'))); await T(p, 0.1); await p.waitForTimeout(900);
  const fs = await p.evaluate(() => { const d = GS.Sim.def.find(x => x.role === 'SS'); const q = GS.Render.project(d.x, 1.2, d.z); return { x: q.x, y: q.y, vis: q.vis, before: GS.Sim.user.role }; });
  await p.touchscreen.tap(fs.x, fs.y); await p.waitForTimeout(100);
  R.defTap = { before: fs.before, after: await p.evaluate(() => GS.Sim.user.role), stillPresnap: await p.evaluate(() => GS.Game.state) };
  await p.screenshot({ path: OUT + '/73_def_pick.png' });
  // camera axis through a whole defensive play (snap, throw, catch, run)
  const axis = [];
  for (let i = 0; i < 14; i++) { await T(p, 0.25); await p.waitForTimeout(260); axis.push(await p.evaluate(() => [GS.Game.state, GS.Sim.ball.state, Math.sign(GS.Sim.camBasis.fz)].join(':'))); if (axis[axis.length - 1].startsWith('post')) break; }
  R.defCameraAxis = axis;
  // challenge: force an overturn, then a stands
  R.canChallenge = await p.evaluate(() => GS.Game.canChallenge());
  const pre = await p.evaluate(() => ({ down: GS.Game.G.down, ballOn: GS.Game.G.ballOn, to: GS.Game.G.timeouts.away, ch: GS.Game.G.challenges.away, last: document.querySelector('#ticker').textContent }));
  R.challengeBtn = await p.evaluate(() => { const b = document.querySelector('#touch [data-act=challenge]'); return b.hidden ? 'hidden' : b.textContent; });
  if (R.canChallenge) {
    await p.evaluate(() => { GS.Game.challenge(); }); R.reviewState = await p.evaluate(() => GS.Game.state);
    await p.evaluate(() => { const r = Math.random; Math.random = () => 0; GS.Game.debug.tick(3.6); Math.random = r; });
    R.challenge1 = { pre, post: await p.evaluate(() => ({ down: GS.Game.G.down, ballOn: GS.Game.G.ballOn, to: GS.Game.G.timeouts.away, ch: GS.Game.G.challenges.away, ticker: document.querySelector('#ticker').textContent })) };
  }
  // second challenge on another play, forced to stand
  await situation(p, 'def', 'izone', 40); await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.defById('c3'))); await T(p, 2.6);
  for (let i = 0; i < 30; i++) { if (await T(p, 0.2) === 'post') break; }
  R.challenge2 = await p.evaluate(() => { const ok = GS.Game.canChallenge(); if (!ok) return 'not challengeable'; const to = GS.Game.G.timeouts.away; GS.Game.challenge(); const r = Math.random; Math.random = () => 0.99; GS.Game.debug.tick(3.6); Math.random = r; return { timeoutsBefore: to, timeoutsAfter: GS.Game.G.timeouts.away, challengesLeft: GS.Game.G.challenges.away, ticker: document.querySelector('#ticker').textContent }; });
  R.errors = errors; await ctx.close();
  console.log(JSON.stringify(R, null, 1)); await b.close();
})();
