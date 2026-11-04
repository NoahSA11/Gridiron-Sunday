// Playwright smoke + logic tests for Gridiron Sunday.
// usage: node test/run.js [stage]
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const URL = 'http://127.0.0.1:8765/index.html';
const THREE = path.join(__dirname, 'three.min.js');

async function page(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 720 } }, opts.ctx || {}));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: THREE, contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  if (opts.failFeed) await p.route('**/rosters.json*', r => r.fulfill({ status: 503, body: 'down' }));
  if (opts.clear !== false) await p.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await p.goto(URL);
  await p.waitForFunction(() => window.GS && GS.Game && document.querySelector('#mQuick'), null, { timeout: 20000 });
  return { p, ctx, errors };
}

(async () => {
  const stage = process.argv[2] || 'all';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const results = {};
  try {
    if (stage === 'all' || stage === 'data') {
      const { p, errors } = await page(browser);
      await p.waitForTimeout(1500);
      results.dataLive = await p.evaluate(() => GS.Data.info());
      results.ratings = await p.evaluate(() => { const t = GS.Data.byAbbr.KC; const S = t.starters; return { ovr: t.ovr, off: t.off, def: t.def, qb: S.QB[0] && [S.QB[0].name, S.QB[0].r], wr: S.WR.map(p => p.name + ' ' + p.r.ovr + ' spd' + p.r.spd), ol: S.OL.map(p => p.dpos + ' ' + p.name), k: S.K[0] && S.K[0].name, teamOvr: GS.Data.teams.map(t => t.abbr + ':' + t.ovr).join(' ') }; });
      await p.screenshot({ path: OUT + '/01_title.png' });
      results.errorsData = errors.slice();
      // failure fallback
      const f = await page(browser, { failFeed: true });
      await f.p.waitForTimeout(1500);
      results.dataFail = await f.p.evaluate(() => GS.Data.info());
      results.failBanner = await f.p.evaluate(() => document.querySelector('[data-roster-status]').textContent);
      results.errorsFail = f.errors.filter(e => !e.includes('503'));
    }
    if (stage === 'all' || stage === 'sim') {
      const { p, errors } = await page(browser);
      await p.click('#mQuick'); await p.waitForTimeout(300);
      await p.screenshot({ path: OUT + '/02_teams.png' });
      await p.evaluate(() => { GS.Game.debug.autoplay(true); localStorage.setItem('gs.tutorial4', '1'); });
      await p.click('#tGo'); await p.waitForTimeout(1200);
      await p.screenshot({ path: OUT + '/03_kickoff.png' });
      // log every play
      await p.evaluate(() => { window.__log = []; const t = GS.UI.ticker; GS.UI.ticker = s => { const G = GS.Game.G; window.__log.push(`Q${G.quarter} ${Math.ceil(G.clock)}s ${G.away.abbr}${G.score.away}-${G.home.abbr}${G.score.home} | ${s}`); t(s); }; GS.Game.settings.replays = false; });
      for (let i = 0; i < 40; i++) {
        const st = await p.evaluate(() => { GS.Game.debug.run(30); const G = GS.Game.G; return { state: GS.Game.state, q: G.quarter, clock: G.clock, over: G.over }; });
        if (i === 2) await p.screenshot({ path: OUT + '/04_midplay.png' });
        if (st.over || st.state === 'final') break;
      }
      results.sim = await p.evaluate(() => { const G = GS.Game.G; return { state: GS.Game.state, score: G.score, q: G.quarter, clock: G.clock, stats: G.stats, plays: window.__log.length, over: G.over }; });
      results.log = await p.evaluate(() => window.__log);
      await p.waitForTimeout(500);
      await p.screenshot({ path: OUT + '/05_final.png' });
      results.errorsSim = errors.slice();
    }
    const T = (p, sec) => p.evaluate(s => GS.Game.debug.tick(s), sec);
    const st = p => p.evaluate(() => GS.Game.state + '/' + GS.Sim.phase);
    if (stage === 'all' || stage === 'keys') {
      const { p, errors } = await page(browser, { ctx: { viewport: { width: 1100, height: 620 } } });
      await p.evaluate(() => { localStorage.setItem('gs.tutorial4', '1'); GS.Game.settings.replays = false; GS.Game.setSetting('quality', 'low'); GS.Rules.preSnapPenalty = () => null; });
      await p.evaluate(() => GS.Game.start('KC', 'BUF', 'BUF')); // user = BUF (away) receives
      const r = { steps: [] };
      for (let i = 0; i < 30; i++) { const s = await T(p, 0.5); if (s === 'call') break; if (s === 'post') await p.keyboard.press('Space'); }
      r.steps.push('after kickoff: ' + await p.evaluate(() => GS.Game.state + ' ' + GS.Game.downText(GS.Game.G) + ' at own ' + GS.Game.G.ballOn));
      await p.screenshot({ path: OUT + '/06_playcall.png' });
      await (await p.$$('.pcard'))[0].click(); await T(p, 0.3);
      r.steps.push('presnap: ' + await st(p) + ' user=' + await p.evaluate(() => GS.Sim.user && GS.Sim.user.role));
      await p.screenshot({ path: OUT + '/07_presnap.png' });
      await p.keyboard.press('KeyH'); await T(p, 0.05); await p.keyboard.press('Digit1'); await p.keyboard.press('Digit2'); await T(p, 0.1);
      r.hot = await p.evaluate(() => JSON.stringify(GS.Game.cfg.hot));
      await p.keyboard.press('Space'); await T(p, 0.1);
      r.steps.push('snapped: ' + await st(p));
      await p.keyboard.down('KeyS'); await T(p, 0.6); await p.keyboard.up('KeyS');
      r.qb = await p.evaluate(() => { const q = GS.Sim.off.find(p => p.role === 'QB'); return { z: +q.z.toFixed(1), los: GS.Sim.los, user: GS.Sim.user.role, hl: GS.Sim.highlight && GS.Sim.highlight.role }; });
      await T(p, 0.6);
      await p.screenshot({ path: OUT + '/08_dropback.png' });
      await p.keyboard.press('Digit2'); await T(p, 0.05);
      r.thrown = await p.evaluate(() => ({ thrown: GS.Sim.thrown, target: GS.Sim.ball.intended && GS.Sim.ball.intended.role }));
      await T(p, 0.35);
      await p.screenshot({ path: OUT + '/09_ballair.png' });
      for (let i = 0; i < 12; i++) { const s = await T(p, 0.25); if (s !== 'live') break; }
      r.result = await p.evaluate(() => ({ state: GS.Game.state, text: document.querySelector('#ticker').textContent, down: GS.Game.downText(GS.Game.G) }));
      await T(p, 0.3); await p.screenshot({ path: OUT + '/10_post.png' });
      // run play: user takes the handoff, sprints, jukes
      for (let i = 0; i < 20; i++) { const s = await T(p, 0.5); if (s === 'call') break; if (s === 'post' || s === 'replay') await p.keyboard.press('Space'); }
      r.steps.push('second call: ' + await st(p));
      await p.evaluate(() => { const G = GS.Game.G; if (GS.Game.callCtx.us !== 'off') { G.poss = G.user; G.ballOn = 40; G.down = 1; G.togo = 10; G.next = 'scrim'; GS.UI.hideScreens(); GS.Game.resumeFromBreak(); } });
      await p.evaluate(() => GS.Game.pickPlay(GS.Playbook.offById('toss'))); await T(p, 0.2);
      await p.keyboard.press('Space'); await T(p, 0.9);
      r.carrier = await p.evaluate(() => ({ carrier: GS.Sim.carrier && GS.Sim.carrier.role, user: GS.Sim.user && GS.Sim.user.role }));
      await p.keyboard.down('ShiftLeft'); await p.keyboard.down('KeyW'); await T(p, 0.3);
      await p.keyboard.press('KeyE'); await T(p, 0.05);
      r.juke = await p.evaluate(() => GS.Sim.user && GS.Sim.user.juke > 0);
      await T(p, 0.4); await p.screenshot({ path: OUT + '/11_run.png' });
      for (let i = 0; i < 16; i++) { const s = await T(p, 0.25); if (s !== 'live') break; }
      await p.keyboard.up('KeyW'); await p.keyboard.up('ShiftLeft');
      r.runResult = await p.evaluate(() => document.querySelector('#ticker').textContent);
      // camera + pause
      await p.keyboard.press('KeyC'); await T(p, 0.1); r.cam = await p.evaluate(() => GS.Game.settings.camera);
      await p.keyboard.press('Escape'); await T(p, 0.1); r.paused = await p.evaluate(() => GS.Game.paused && !document.querySelector('#pause').hidden);
      await p.screenshot({ path: OUT + '/11b_pause.png' });
      await p.keyboard.press('Escape'); await T(p, 0.1);
      // defense: give the ball to the CPU and call a defensive play
      await p.evaluate(() => { const G = GS.Game.G; G.poss = 'home'; G.ballOn = 30; G.down = 1; G.togo = 10; G.next = 'scrim'; G.clockRunning = false; GS.UI.hideScreens(); GS.Game.resumeFromBreak(); });
      await T(p, 0.1);
      r.defCall = await p.evaluate(() => GS.Game.state + ' us=' + (GS.Game.callCtx && GS.Game.callCtx.us));
      await p.screenshot({ path: OUT + '/12_defcall.png' });
      if (r.defCall.includes('def')) {
        await (await p.$$('.pcard'))[1].click(); await T(p, 0.2);
        await p.keyboard.press('Space'); await T(p, 0.1); // switch defender pre-snap
        r.defUser = await p.evaluate(() => GS.Sim.user && GS.Sim.user.role);
        await p.keyboard.down('KeyW'); await T(p, 0.4); await p.keyboard.up('KeyW');
        await T(p, 2.6); // CPU snaps
        r.defLive = await st(p);
        await p.screenshot({ path: OUT + '/13_deflive.png' });
        await p.keyboard.press('Space'); await T(p, 0.05);
        r.defSwitched = await p.evaluate(() => GS.Sim.user && GS.Sim.user.role);
        await p.keyboard.press('KeyF'); await T(p, 0.05);
        r.dive = await p.evaluate(() => GS.Sim.user && (GS.Sim.user.dive > 0 || GS.Sim.user.down > 0));
      }
      r.errors = errors.slice();
      results.keys = r;
    }
    if (stage === 'all' || stage === 'touch') {
      const { p, errors } = await page(browser, { ctx: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } });
      await p.screenshot({ path: OUT + '/14_phone_title.png' });
      await p.evaluate(() => { GS.Game.settings.replays = false; GS.Game.setSetting('quality', 'low'); GS.Rules.preSnapPenalty = () => null; });
      await p.tap('#mQuick'); await p.waitForTimeout(300);
      await p.screenshot({ path: OUT + '/15_phone_teams.png' });
      await p.tap('#tGo'); await p.waitForTimeout(300);
      const r = {};
      r.tutorialVisible = await p.evaluate(() => !document.querySelector('#tutorial').hidden);
      await p.screenshot({ path: OUT + '/16_phone_tutorial.png' });
      if (r.tutorialVisible) await p.tap('#tutOk');
      for (let i = 0; i < 40; i++) { const s = await T(p, 0.5); if (s === 'call') break; if (s === 'post') await p.evaluate(() => GS.Input.press('action')); }
      r.callSide = await p.evaluate(() => GS.Game.callCtx.us);
      await p.screenshot({ path: OUT + '/17_phone_call.png' });
      // make sure we test offense: force possession to the user if needed
      await p.evaluate(() => { const G = GS.Game.G; if (GS.Game.callCtx.us !== 'off') { G.poss = G.user; G.ballOn = 30; G.down = 1; G.togo = 10; GS.UI.hideScreens(); GS.Game.resumeFromBreak(); } });
      await T(p, 0.1);
      r.callSide2 = await p.evaluate(() => GS.Game.callCtx.us + ' ' + GS.Game.state);
      await (await p.$$('.pcard'))[2].tap(); await T(p, 0.3);
      r.touchVisible = await p.evaluate(() => !document.querySelector('#touch').hidden);
      r.snapLabel = await p.evaluate(() => document.querySelector('#touch [data-act=action] b').textContent);
      await p.screenshot({ path: OUT + '/18_phone_presnap.png' });
      const cdp = await p.context().newCDPSession(p);
      const box = await p.$eval('#touch [data-act=action]', b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      // finger 1 holds the stick down-left (drop back), finger 2 taps SNAP
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 260, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y: 320, id: 1 }] });
      r.stick = await p.evaluate(() => GS.Input.move());
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 320, id: 1 }, { x: box.x, y: box.y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: 160, y: 320, id: 1 }] });
      await T(p, 0.1);
      r.afterSnap = await p.evaluate(() => ({ state: GS.Game.state, phase: GS.Sim.phase, stick: GS.Input.move() }));
      await T(p, 0.9);
      r.qbZ = await p.evaluate(() => { const q = GS.Sim.off.find(p => p.role === 'QB'); return +(q.z - GS.Sim.los).toFixed(1); });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await T(p, 0.05);
      r.stickReleased = await p.evaluate(() => GS.Input.move());
      // receiver badges are tappable
      r.badges = await p.evaluate(() => document.querySelectorAll('#badges .badge').length);
      r.throwLabel = await p.evaluate(() => document.querySelector('#touch [data-act=action] b').textContent);
      await p.screenshot({ path: OUT + '/19_phone_pass.png' });
      const bb = await p.$('#badges .badge');
      if (bb) { const b2 = await bb.boundingBox(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b2.x + b2.width / 2, y: b2.y + b2.height / 2, id: 3 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
      await T(p, 0.05);
      r.thrownByTap = await p.evaluate(() => GS.Sim.thrown);
      await T(p, 0.5); await p.screenshot({ path: OUT + '/20_phone_air.png' });
      for (let i = 0; i < 12; i++) { const s = await T(p, 0.25); if (s !== 'live') break; }
      r.result = await p.evaluate(() => document.querySelector('#ticker').textContent);
      await T(p, 0.2); await p.screenshot({ path: OUT + '/21_phone_post.png' });
      r.errors = errors.slice();
      results.touch = r;
    }
  } catch (e) { results.fatal = String(e.stack || e); }
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})();
