/* =========================================================================
   GS.Game — the controller: game flow state machine and main loop.
   menu -> call -> presnap -> (kickmeter) -> live -> post -> (replay) -> ...
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const DIFF = {
    rookie: { label: 'Rookie', userTackle: 0.12, cpuTackle: -0.14, userCatch: 0.12, cpuCatch: -0.1, cpuReact: 1.35, cpuSpeed: 0.95, cpuQBAcc: 0.8, userQBAcc: 1.25, readPlay: 0, cpuMoves: 0.6 },
    pro: { label: 'Pro', userTackle: 0.03, cpuTackle: -0.03, userCatch: 0.04, cpuCatch: 0, cpuReact: 1.0, cpuSpeed: 1.0, cpuQBAcc: 1.0, userQBAcc: 1.05, readPlay: 0.15, cpuMoves: 1 },
    allpro: { label: 'All-Pro', userTackle: -0.05, cpuTackle: 0.06, userCatch: -0.04, cpuCatch: 0.06, cpuReact: 0.78, cpuSpeed: 1.03, cpuQBAcc: 1.15, userQBAcc: 0.95, readPlay: 0.35, cpuMoves: 1.4 },
  };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
  const defaults = { diff: 'pro', qLen: 3, quality: GS.Input.mode === 'touch' ? 'low' : 'medium', sound: true, assist: true, replays: true, camera: 'auto', controls: 'auto' };
  let settings = Object.assign({}, defaults); try { Object.assign(settings, JSON.parse(lsGet('gs.settings') || '{}')); } catch (e) { /* ignore */ }

  const Game = {
    state: 'menu', G: null, cfg: null, settings, DIFF,
    timeScale: 1, slowT: 0, postT: 0, presnapT: 0, replay: null, lastOut: null, menuT: 0, paused: false, headless: false,
    seasonGame: null, cadence: 0, autoUser: false,
  };
  const sim = () => GS.Sim;
  const other = s => (s === 'home' ? 'away' : 'home');
  function saveSettings() { lsSet('gs.settings', JSON.stringify(settings)); }
  GS.Input.setPreference(settings.controls);

  // ------------------------------------------------ start / flow
  Game.start = function (homeAbbr, awayAbbr, userAbbr, opts) {
    opts = opts || {};
    const home = GS.Data.byAbbr[homeAbbr], away = GS.Data.byAbbr[awayAbbr];
    const user = userAbbr === homeAbbr ? 'home' : userAbbr === awayAbbr ? 'away' : null;
    Game.G = GS.Rules.newGame(home, away, { user, diff: DIFF[settings.diff], qLen: opts.qLen || settings.qLen });
    Game.seasonGame = opts.season || null;
    if (!Game.headless) { GS.Render.setupTeams(home, away); GS.Render.drawBoard(Game.G); }
    GS.UI.hideScreens(); GS.UI.showHUD(true);
    GS.Audio.cheer(0.5);
    GS.UI.banner('KICKOFF', `${away.name} at ${home.name}`, 'cobalt');
    nextPlay();
  };

  function userSideFor(offSide) { const G = Game.G; if (!G.user) return null; return G.user === offSide ? 'off' : 'def'; }

  function nextPlay() {
    const G = Game.G;
    if (G.over) return finish();
    const sit = GS.Rules.situation(G);
    if (G.next === 'kickoff') {
      const cfg = baseCfg(sit, 'kickoff'); cfg.los = G.ballOn || 35; cfg.spotX = 0;
      return beginPlay(cfg);
    }
    if (G.next === 'pat') {
      const us = userSideFor(G.poss);
      if (us === 'off' && !Game.autoUser) { Game.state = 'pat'; GS.UI.showScreen('pat'); return; }
      const diff = G.score[G.poss] - G.score[other(G.poss)];
      return Game.patChoice([-2, -5, -10, 1, -1, 5].includes(diff) && G.quarter >= 4 ? 'two' : 'kick');
    }
    // scrimmage: clock runoff between plays
    const offSide = G.poss, late = (G.quarter === 2 || G.quarter >= 4) && G.clock <= 120;
    const trailing = G.score[offSide] <= G.score[other(offSide)];
    // CPU timeouts to save time late
    if (G.clockRunning && late) {
      for (const side of [offSide, other(offSide)]) {
        const behind = G.score[side] < G.score[other(side)] || (G.quarter === 2 && side === offSide);
        if (side !== G.user && behind && G.timeouts[side] > 0 && G.clock > 8) { GS.Rules.callTimeout(G, side); GS.UI.banner('TIMEOUT', G[side].name.toUpperCase(), 'ink'); GS.Audio.whistle(); break; }
      }
    }
    let secs = late && trailing ? 7 : 24;
    if (late && !trailing && G.quarter >= 4) secs = 38; // milk it
    if (G.clockRunning && late && trailing) secs = Math.min(secs, Math.max(0, G.clock - 2));
    Game.lastRunoff = GS.Rules.runoff(G, secs);
    if (G.twoMinFlag) { G.twoMinFlag = false; GS.UI.banner('TWO-MINUTE WARNING', '', 'ink'); }
    GS.UI.hud(G);
    if (G.clock <= 0 && Game.lastRunoff > 0) { GS.Audio.whistle(true); return quarterBreak(); }
    openCall(false);
  }

  function openCall(audible) {
    const G = Game.G, sit = GS.Rules.situation(G);
    const us = userSideFor(sit.offSide);
    Game.callCtx = { sit, audible, us };
    if (!us || Game.autoUser) {
      const off = GS.AI.callOffense(Object.assign({ kicker: sit.off.starters.K[0] }, sit));
      const def = GS.AI.callDefense(sit, off, DIFF[settings.diff]);
      return launch(off, def);
    }
    Game.state = 'call';
    GS.UI.showScreen('playcall', { side: us, sit, audible, suggestion: us === 'off' ? GS.AI.callOffense(Object.assign({ kicker: sit.off.starters.K[0] }, sit)) : null, timeouts: G.timeouts[G.user], clockRunning: G.clockRunning && Game.lastRunoff > 0 });
  }

  Game.pickPlay = function (play) {
    const { sit, us, audible } = Game.callCtx;
    GS.Audio.select(); GS.UI.hideScreens();
    if (audible && Game.cfg && Game.state === 'call') {
      if (us === 'off') { Game.cfg.offPlay = play; Game.cfg.hot = {}; } else { Game.cfg.defPlay = play; }
      const kind = play.type === 'punt' ? 'punt' : play.type === 'fg' ? 'fg' : null;
      if (kind || Game.cfg.kind !== 'scrim') return launch(us === 'off' ? play : GS.AI.callOffense(sit), us === 'def' ? play : Game.cfg.defPlay);
      return beginPlay(Game.cfg, true);
    }
    if (us === 'off') launch(play, GS.AI.callDefense(sit, play, DIFF[settings.diff]));
    else launch(GS.AI.callOffense(Object.assign({ kicker: sit.off.starters.K[0] }, sit)), play);
  };

  Game.userTimeout = function () {
    const G = Game.G; if (!G || !G.user) return false;
    if (!GS.Rules.callTimeout(G, G.user)) { GS.UI.toast('No timeouts left'); return false; }
    if (Game.lastRunoff) { G.clock += Game.lastRunoff; Game.lastRunoff = 0; }
    GS.Audio.whistle(); GS.UI.banner('TIMEOUT', G[G.user].name.toUpperCase(), 'ink'); GS.UI.hud(G);
    return true;
  };

  function baseCfg(sit, kind) {
    return { off: sit.off, def: sit.def, offSide: sit.offSide, los: Game.G.ballOn, spotX: Game.G.spotX, userSide: Game.autoUser ? null : userSideFor(sit.offSide), kind, diff: DIFF[settings.diff], assist: settings.assist, togo: Game.G.togo, hot: {} };
  }

  function launch(offPlay, defPlay) {
    const G = Game.G, sit = GS.Rules.situation(G);
    let kind = 'scrim';
    if (offPlay.type === 'punt') kind = 'punt'; else if (offPlay.type === 'fg') kind = 'fg';
    const cfg = baseCfg(sit, kind); cfg.offPlay = offPlay; cfg.defPlay = defPlay;
    if (kind !== 'scrim') { cfg.spotX = 0; }
    beginPlay(cfg);
  }

  Game.patChoice = function (choice) {
    const G = Game.G; GS.UI.hideScreens();
    if (choice === 'two') {
      G.patTwo = true; G.ballOn = 98; G.down = 1; G.togo = 2; G.next = 'scrim'; G.spotX = 0;
      GS.UI.banner('TWO-POINT TRY', '', 'cobalt');
      return openCall(false);
    }
    const sit = GS.Rules.situation(G); const cfg = baseCfg(sit, 'xp'); cfg.los = 85; cfg.spotX = 0; cfg.offPlay = GS.Playbook.offById('fg'); cfg.defPlay = GS.Playbook.D[0];
    beginPlay(cfg);
  };

  function beginPlay(cfg, keepCam) {
    Game.cfg = cfg;
    if (cfg.kind === 'kickoff' && cfg.userSide === 'off') cfg.userRole = null;
    sim().setup(cfg);
    if (cfg.kind === 'kickoff' && cfg.userSide === 'off') sim().setUser(sim().off.find(p => p.role === 'S'));
    if (!Game.headless) { GS.Render.bindPlayers(sim().all); if (!keepCam) GS.Render.snapCamera(renderCtx()); buildPlayArt(); }
    Game.state = 'presnap'; Game.presnapT = 0; Game.cadence = 0;
    GS.UI.hud(Game.G);
    const userKicks = cfg.userSide === 'off' && ['punt', 'fg', 'xp'].includes(cfg.kind);
    if (userKicks) { Game.state = 'kickmeter'; Game.meter = { stage: 0, t: 0, power: 0, acc: 0 }; GS.UI.kickMeter(Game.meter, cfg.kind); }
    else if (['punt', 'fg', 'xp'].includes(cfg.kind)) {
      const k = cfg.kind === 'punt' ? cfg.off.starters.P[0] : cfg.off.starters.K[0]; const acc = k ? k.r.kac : 70;
      sim().kick.power = Math.min(1, 0.72 + Math.random() * 0.3); sim().kick.acc = (Math.random() - 0.5) * (1.25 - acc / 100) * 0.9;
      if (cfg.kind !== 'punt' && cfg.userSide === 'def') sim().kick.acc *= DIFF[settings.diff].cpuQBAcc > 1 ? 0.8 : 1.2;
    }
    GS.UI.controls();
    if (!Game.headless && cfg.userSide && !Game.tutorialShown && !lsGet('gs.tutorial2')) { Game.tutorialShown = true; Game.paused = true; GS.UI.tutorial(); }
  }

  Game.doSnap = function () {
    const G = Game.G, cfg = Game.cfg;
    if (sim().phase !== 'presnap') return;
    if (cfg.kind === 'scrim') {
      const pen = GS.Rules.preSnapPenalty(G);
      if (pen) {
        const txt = GS.Rules.applyPenalty(G, pen);
        GS.Audio.whistle(); GS.Audio.flag(); GS.UI.banner('FLAG', pen.type.toUpperCase() + ' • ' + (pen.on === 'off' ? 'OFFENSE' : 'DEFENSE'), 'flag'); GS.UI.ticker(txt + '. Replay ' + downText(G));
        GS.UI.hud(G); Game.lastRunoff = 0;
        Game.state = 'wait'; if (Game.headless) openCall(false); else setTimeout(() => openCall(false), 1800);
        return;
      }
    }
    sim().snap(); Game.state = 'live'; GS.UI.hideHot(); GS.UI.controls();
    GS.Audio.hike(true);
  };

  function downText(G) { const d = ['1st', '2nd', '3rd', '4th'][G.down - 1] || '4th'; const goal = G.ballOn + G.togo >= 100; return `${d} & ${goal ? 'Goal' : G.togo}`; }
  Game.downText = downText;

  // ------------------------------------------------ main update
  Game.update = function (realDt) {
    const I = GS.Input; I.update();
    if (I.consume('pause')) { if (Game.state !== 'menu') Game.togglePause(); }
    if (Game.paused || !Game.G || Game.state === 'menu') { I.clear(); return; }
    if (I.consume('camera')) Game.cycleCamera();
    const s = Game.state, S = sim();
    if (s !== 'live') { I.setPassMode(false); I.consumeThrow(); }
    if (s === 'presnap') {
      Game.presnapT += realDt; S.step(realDt);
      const us = Game.cfg.userSide;
      // QB cadence
      if (Game.cfg.kind === 'scrim' && Game.presnapT > 0.6 + Game.cadence * 0.65 && Game.cadence < 3) { Game.cadence++; GS.Audio.hike(Game.cadence === 3); }
      if (us === 'off' && Game.cfg.kind !== 'kickoff') {
        if (I.consume('action')) Game.doSnap();
        else if (I.consume('hot')) GS.UI.openHot('off');
        else for (let i = 1; i <= 5; i++) if (I.consume('t' + i)) { const r = Game.receivers()[i - 1]; if (r) GS.UI.openHot('off', r.role); break; }
        else if (I.consume('call')) { Game.state = 'call'; openCallAudible(); }
      } else {
        if (us === 'def' && Game.cfg.kind === 'scrim') {
          if (I.consume('hot')) GS.UI.openHot('def');
          if (I.consume('action') || I.consume('cycle')) cycleDefender();
        }
        const wait = Game.cfg.kind === 'kickoff' ? 1.3 : ['punt', 'fg', 'xp'].includes(Game.cfg.kind) ? 1.1 : 2.4;
        if (Game.presnapT > wait && !GS.UI.hotOpen()) Game.doSnap();
      }
      I.clear();
    } else if (s === 'kickmeter') {
      const m = Game.meter; m.t += realDt;
      if (m.stage === 0) { m.power = 0.5 - 0.5 * Math.cos(m.t * 3.4); if (I.consume('action') || I.consume('dive')) { m.stage = 1; m.t = 0; GS.Audio.ui(); } }
      else if (m.stage === 1) { m.acc = Math.sin(m.t * 5.2); if (I.consume('action') || I.consume('dive')) { m.stage = 2; GS.Audio.ui(); sim().kick.power = m.power; sim().kick.acc = m.acc * 0.9; const go = () => { GS.UI.kickMeter(null); Game.state = 'presnap'; Game.doSnap(); }; if (Game.headless) go(); else setTimeout(go, 350); } }
      GS.UI.kickMeter(m, Game.cfg.kind); I.clear();
    } else if (s === 'live') {
      liveInput();
      Game.slowT -= realDt; if (Game.slowT <= 0) Game.timeScale += (1 - Game.timeScale) * Math.min(1, realDt * 6);
      const dt = realDt * Game.timeScale, h = 1 / 60;
      Game.acc = (Game.acc || 0) + dt;
      while (Game.acc >= h) {
        Game.acc -= h; S.step(h);
        const untimed = Game.cfg.kind === 'xp' || Game.G.patTwo;
        GS.Rules.tickLive(Game.G, h, untimed);
        handleEvents(S.drainEvents());
        if (S.phase === 'dead') { whistle(); break; }
      }
    } else if (s === 'post') {
      Game.postT += realDt; S.step(realDt); handleEvents(S.drainEvents());
      const wait = Game.lastOut && Game.lastOut.score && Game.lastOut.score.type === 'TD' ? 3.6 : Game.lastOut && Game.lastOut.big ? 2.8 : 2.0;
      if (Game.postT > wait || (Game.postT > 0.8 && I.consume('action'))) {
        if (settings.replays && Game.replayWorthy && !Game.headless) startReplay(); else afterPlay();
      }
      if (I.consume('replay') && !Game.headless) startReplay();
      I.clear();
    } else if (s === 'replay') {
      const R = Game.replay; if (!R || !sim().rec.length) { endReplay(); afterPlay(); I.clear(); return; }
      R.t += realDt * R.speed;
      if (R.t >= R.end || I.consume('action') || I.consume('replay')) { endReplay(); afterPlay(); }
      I.clear();
    } else I.clear();
  };

  function openCallAudible() { const G = Game.G, sit = GS.Rules.situation(G); const us = userSideFor(sit.offSide); Game.callCtx = { sit, audible: true, us }; GS.UI.showScreen('playcall', { side: us, sit, audible: true, timeouts: G.timeouts[G.user], clockRunning: false }); }

  function cycleDefender() {
    const S = sim(); const order = ['ML', 'WL', 'SS', 'FS', 'NB', 'LC', 'RC', 'LE', 'RE', 'DT', 'NT'];
    const cur = S.user ? order.indexOf(S.user.role) : -1; const role = order[(cur + 1) % order.length];
    S.setUser(S.def.find(p => p.role === role)); Game.cfg.userRole = role; GS.Audio.ui(); buildPlayArt();
  }

  function liveInput() {
    const I = GS.Input, S = sim(), u = S.user;
    // gamepad face buttons pick receivers while the user's QB holds the ball
    I.setPassMode(!!(u && S.ball.holder === u && S.passAllowed && !S.thrown && u.role === 'QB' && Game.cfg.kind === 'scrim'));
    if (!u || !Game.cfg.userSide) { I.clear(); return; }
    const ball = S.ball;
    const isQB = ball.holder === u && S.passAllowed && !S.thrown && u.role === 'QB';
    const isCarrier = S.carrier === u && ball.holder === u;
    if (isQB && Game.cfg.kind === 'scrim') {
      const recv = Game.receivers();
      const lead = () => { const m = S.camBasis, mv = I.move(); return { x: m.rx * mv.x + m.fx * mv.y, z: m.rz * mv.x + m.fz * mv.y }; };
      // receiver icons: tap = touch pass, hold = bullet
      const q = I.consumeThrow();
      if (q) { const r = recv[q.i - 1]; if (r && S.actions.throwTo(u, r, lead(), q.bullet)) { GS.Input.vibrate(q.bullet ? 25 : 15); GS.UI.flash(q.bullet ? 'BULLET' : 'TOUCH PASS'); } }
      if (I.consume('action') && S.highlight) { S.actions.throwTo(u, S.highlight, lead(), false); GS.Input.vibrate(15); }
      if (I.consume('cycle')) { const list = recv.filter(Boolean); const i = list.indexOf(S.highlight); S.highlight = list[(i + 1) % list.length]; S.lockedHighlight = true; }
    }
    if (isCarrier) {
      if (I.consume('juke')) S.actions.juke(u);
      if (I.consume('spin')) S.actions.spin(u);
      if (I.consume('dive')) S.actions.dive(u);
    } else if (u.side === 'def' || (S.carrier && S.carrier.side !== u.side)) {
      if (I.consume('action') || I.consume('cycle')) S.actions.switchPlayer();
      if (I.consume('dive')) S.actions.dive(u);
    } else if (!isQB) {
      // offense without the ball: take control of the intended receiver
      if (I.consume('action') && ball.intended) S.setUser(ball.intended);
    }
    I.clear();
  }

  // receiver icon colors, shared by the on-field routes and the HUD icons (1..5 = X Z S TE RB)
  Game.ICON_COLORS = ['#2BB24C', '#E4372C', '#2F6FE8', '#FFC83D', '#B7BEC8'];
  function buildPlayArt() {
    const S = sim(), cfg = Game.cfg; if (!GS.Render.ready) return;
    if (!cfg || !cfg.userSide || cfg.kind !== 'scrim') { GS.Render.setPlayArt(null); return; }
    const segs = [];
    if (cfg.userSide === 'off') {
      const play = cfg.offPlay;
      if (play.type === 'run') { const car = S.off.find(p => p.role === play.carrier); segs.push({ pts: [[car.x, car.z]].concat(play.path.map(q => [S.spotX + q[0], S.los + q[1]])), color: '#FFC83D', arrow: true, w: 0.5 }); }
      ['X', 'Z', 'S', 'TE', 'RB'].forEach((role, i) => {
        const p = S.off.find(q => q.role === role); if (!p || (play.type === 'run' && role === play.carrier)) return;
        if (p.route && p.route.length) {
          const pts = [[p.x, p.z]].concat(p.route.map(w => [w.x, w.z]));
          if (!p.settle && pts.length > 1) { const a = pts[pts.length - 1], b = pts[pts.length - 2], L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; pts.push([Math.max(-25, Math.min(25, a[0] + (a[0] - b[0]) / L * 4)), a[1] + (a[1] - b[1]) / L * 4]); }
          segs.push({ pts, color: Game.ICON_COLORS[i], arrow: true, w: 0.46 });
        } else if (play.type === 'run') segs.push({ pts: [[p.x, p.z], [p.x, p.z + 1.6]], color: '#DDE3EA', cap: true, w: 0.26 });
      });
      if (play.type === 'run') for (const p of S.off) if (['LT', 'LG', 'C', 'RG', 'RT'].includes(p.role)) segs.push({ pts: [[p.x, p.z], [p.x + (play.side || 0) * 0.7, p.z + 1.5]], color: '#DDE3EA', cap: true, w: 0.24 });
    } else if (S.user) {
      const u = S.user;
      if (u.zone) segs.push({ ring: { x: u.zone.x, z: u.zone.z, r: u.zone.deep ? 5.5 : 3.6 }, color: u.zone.deep ? '#2F6FE8' : '#FFC83D', w: 0.3 }, { pts: [[u.x, u.z], [u.zone.x, u.zone.z]], color: u.zone.deep ? '#2F6FE8' : '#FFC83D', arrow: true });
      else if (u.manTarget) segs.push({ pts: [[u.x, u.z], [u.manTarget.x, u.manTarget.z + 0.8]], color: '#F4F6F0', arrow: true });
      else { const q = S.off.find(p => p.role === 'QB'); segs.push({ pts: [[u.x, u.z], [q.x, q.z + 1.5]], color: '#E4372C', arrow: true }); }
    }
    GS.Render.setPlayArt(segs);
  }

  Game.receivers = function () {
    const S = sim(); const order = ['X', 'Z', 'S', 'TE', 'RB'];
    return order.map(r => S.off.find(p => p.role === r && p.route && !p.passBlock) || null);
  };

  function handleEvents(evs) {
    for (const e of evs) {
      switch (e.type) {
        case 'snap': GS.Audio.snap(); break;
        case 'throw': GS.Audio.throw(); GS.Audio.setExcite(0.45); break;
        case 'catch': GS.Audio.catch(); GS.Audio.cheer(e.contested ? 0.5 : 0.25); if (e.contested && !e.kick) GS.UI.flash('CONTESTED CATCH'); break;
        case 'hit':
          GS.Audio.hit(e.power); if (!Game.headless) GS.Render.burst(e.x, e.z, e.power);
          if (e.big) { GS.UI.flash('BIG HIT'); GS.Input.vibrate([30, 20, 50]); GS.Audio.cheer(0.5); }
          else GS.Input.vibrate(18);
          break;
        case 'broken': GS.Audio.cheer(0.3); GS.UI.flash('BROKEN TACKLE'); break;
        case 'move': GS.Audio.ui(); break;
        case 'engage': break;
        case 'int': case 'fumble': GS.Audio.cheer(0.8); break;
        case 'sack': GS.Audio.cheer(0.6); break;
        case 'breakup': GS.Audio.hit(0.25); GS.Audio.cheer(0.3); break;
        case 'td': GS.Audio.horn(); GS.Audio.cheer(1.2); setTimeout(() => GS.Audio.organ(), 500); { const t = e.p ? e.p.team : null; if (t && !Game.headless) GS.Render.celebrate(t); } break;
        case 'slowmo': if (!Game.headless) { Game.timeScale = e.scale; Game.slowT = e.dur; } break;
        case 'banner': GS.UI.banner(e.text, e.sub, 'gold'); break;
        case 'kick': GS.Audio.kick(); GS.Audio.setExcite(0.5); break;
        case 'fgGood': GS.Audio.cheer(1); GS.Audio.horn(); break;
        case 'fgMiss': GS.Audio.groan(); break;
        case 'incomplete': GS.Audio.groan(); break;
        case 'whistle': break;
      }
    }
  }

  function whistle() {
    const S = sim(), G = Game.G, cfg = Game.cfg;
    GS.Audio.whistle();
    const ctx = { kind: cfg.kind, offSide: cfg.offSide, offPlay: cfg.offPlay, defPlay: cfg.defPlay, los: cfg.los, spotX: cfg.spotX };
    const out = GS.Rules.apply(G, S.result, ctx);
    Game.lastOut = out; Game.state = 'post'; Game.postT = 0; Game.timeScale = 1;
    const res = S.result;
    Game.replayWorthy = !!(out.score && (out.score.type === 'TD')) || out.turnover && res.intercepted || (res.gain >= 25 && cfg.kind === 'scrim');
    if (out.banner) {
      const style = out.banner === 'TOUCHDOWN' ? 'td' : out.flag ? 'flag' : out.turnover ? 'flag' : out.banner === 'FIRST DOWN' ? 'gold' : out.banner === 'NO GOOD' ? 'ink' : 'cobalt';
      if (!(out.banner === 'SACK' || out.banner === 'INTERCEPTION' && res.events.some(e => e.type === 'int'))) GS.UI.banner(out.banner, out.sub, style);
    }
    if (out.score && out.score.type === 'TD') GS.Input.vibrate([40, 30, 40, 30, 80]);
    if (out.flag) { GS.Audio.flag(); }
    // crowd: home crowd reacts to the home team
    if (out.score) { if (out.score.side === 'home') GS.Audio.cheer(1); else GS.Audio.groan(); }
    GS.UI.ticker(out.text);
    GS.UI.hud(G); if (!Game.headless) GS.Render.drawBoard(G);
    GS.UI.controls();
    if (G.down === 3 && !out.score && G.next === 'scrim' && G.poss !== 'home' && Math.random() < 0.6) setTimeout(() => GS.Audio.chant(), 1200);
    if (G.down === 3 && G.next === 'scrim' && G.poss === 'home' && Math.random() < 0.3) setTimeout(() => GS.Audio.organ(), 1400);
  }

  function startReplay() {
    const S = sim(); if (!S.rec.length) return afterPlay();
    const len = S.rec.length / 30; const startT = Math.max(0, len - 5.5);
    Game.replay = { t: startT, end: len - 0.2, speed: 0.5, carrierIdx: S.all.indexOf(S.carrier) };
    GS.Render.camState.replayCam++;
    Game.state = 'replay'; Game.replayWorthy = false; GS.UI.replayTag(true);
  }
  function endReplay() { GS.UI.replayTag(false); Game.replay = null; Game.state = 'wait'; }
  // returns null (never throws) when there is nothing to replay
  Game.replayFrame = function () {
    const R = Game.replay, rec = sim().rec; if (!R || !rec.length) return null;
    const i = Math.max(0, Math.min(rec.length - 1, Math.floor((R.t || 0) * 30)));
    const f = rec[i]; if (!f) return null; f.carrierIdx = R.carrierIdx; return f;
  };

  function afterPlay() {
    const G = Game.G;
    if (G.over) return finish();
    if (G.clock <= 0 && G.next !== 'pat') return quarterBreak();
    nextPlay();
  }

  function quarterBreak() {
    const G = Game.G; const r = GS.Rules.endOfQuarter(G);
    GS.UI.hud(G); if (!Game.headless) GS.Render.drawBoard(G);
    if (r === 'final' || G.over) return finish();
    GS.Audio.horn();
    if (r === 'half') { Game.state = 'break'; GS.UI.showScreen('break', { title: 'HALFTIME', G }); return; }
    if (r === 'ot') { Game.state = 'break'; GS.UI.showScreen('break', { title: 'OVERTIME', G, sub: 'Both teams get a possession. Then next score wins.' }); return; }
    GS.UI.banner('END OF Q' + (G.quarter - 1), `${G.away.abbr} ${G.score.away} • ${G.home.abbr} ${G.score.home}`, 'ink');
    nextPlay();
  }
  Game.resumeFromBreak = function () { GS.UI.hideScreens(); nextPlay(); };

  function finish() {
    const G = Game.G; G.over = true; Game.state = 'final';
    GS.Audio.horn(); GS.Audio.cheer(1);
    if (Game.seasonGame) GS.Season.finishUserGame(G.score.home, G.score.away);
    GS.UI.showScreen('final', { G, season: !!Game.seasonGame });
  }

  Game.togglePause = function () {
    if (Game.state === 'menu' || Game.state === 'final') return;
    Game.paused = !Game.paused; GS.UI.showPause(Game.paused);
  };
  Game.quit = function () { Game.resetAttract(); Game.replay = null; GS.UI.replayTag(false); Game.paused = false; Game.state = 'menu'; Game.G = null; GS.UI.showPause(false); GS.UI.showHUD(false); GS.UI.kickMeter(null); GS.UI.showScreen('title'); };
  Game.cycleCamera = function () { const modes = ['auto', 'follow', 'all22']; settings.camera = modes[(modes.indexOf(settings.camera) + 1) % modes.length]; saveSettings(); GS.UI.toast('Camera: ' + { auto: 'Broadcast', follow: 'Follow cam', all22: 'All-22' }[settings.camera]); };
  Game.setSetting = function (k, v) { settings[k] = v; saveSettings(); if (k === 'quality' && GS.Render.ready) GS.Render.setQuality(v); if (k === 'sound') GS.Audio.setEnabled(v); if (k === 'controls') GS.Input.setPreference(v); };
  Game.applyHot = function (role, route) { const cfg = Game.cfg; if (!cfg) return; cfg.hot[role] = route; beginPlay(cfg, true); Game.presnapT = 0; GS.Audio.select(); };
  Game.applyDefAudible = function (id) { const cfg = Game.cfg; if (!cfg) return; cfg.defPlay = GS.Playbook.defById(id); beginPlay(cfg, true); GS.Audio.select(); };

  // ------------------------------------------------ render context & loop
  function renderCtx() {
    const S = sim(), G = Game.G, R = Game.replay;
    const frame = Game.state === 'replay' ? Game.replayFrame() : null;
    return { sim: S, mode: settings.camera, userSide: Game.cfg ? Game.cfg.userSide : null, replay: !!frame, replayFrame: frame, replayT: R ? R.t : 0,
      firstDownZ: G && G.next === 'scrim' && Game.cfg && Game.cfg.kind === 'scrim' ? Game.cfg.los + (Game.cfg.togo || G.togo) : null, excite: Game.excite || 0.2,
      artOpacity: Game.state === 'presnap' || Game.state === 'call' && Game.callCtx && Game.callCtx.audible ? 0.95 : Game.state === 'live' && S.phase === 'live' ? Math.max(0, 0.95 - S.t * 0.6) : 0 };
  }

  let last = 0, fpsAcc = 0, fpsN = 0, lowFps = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    try {
      if (Game.state === 'menu' || !Game.G) { menuFrame(dt); return; }
      Game.update(dt);
      if (!Game.cfg) return;
      Game.excite = Math.min(1, (Game.excite || 0.2) * 0.98 + (Game.state === 'live' && sim().carrier && sim().carrier.speed > 7 ? 0.04 : 0) + (Game.state === 'post' && Game.lastOut && Game.lastOut.score ? 0.05 : 0));
      GS.Render.frame(renderCtx(), Game.paused ? 0 : dt * (Game.state === 'live' ? Game.timeScale : Game.state === 'replay' ? 0.5 : 1));
      GS.UI.frame(Game);
      // adaptive quality: drop a level if the frame rate stays low
      fpsAcc += dt; fpsN++;
      if (fpsAcc > 3) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (fps < 32 && settings.quality !== 'low') { if (++lowFps >= 2) { lowFps = 0; const q = settings.quality === 'high' ? 'medium' : 'low'; Game.setSetting('quality', q); GS.UI.toast('Quality lowered to ' + q + ' for smoother play'); } } else lowFps = 0; }
    } catch (err) { console.error(err); if (Game.lastErr !== err.message) { Game.lastErr = err.message; GS.UI.toast('Something went wrong: ' + err.message); } }
  }
  // attract mode: slow stadium flyover behind the menus
  let menuSim = false;
  function menuFrame(dt) {
    if (!GS.Render.ready) return;
    Game.menuT += dt;
    if (!menuSim) {
      menuSim = true; const T = GS.Data.teams, a = T[Math.floor(Math.random() * 32)], b = T[(T.indexOf(a) + 7) % 32];
      GS.Render.setupTeams(a, b); GS.Render.drawBoard(null);
      Game.attractT = 0; sim().setup({ off: a, def: b, offPlay: GS.Playbook.OFF[0], defPlay: GS.Playbook.D[1], los: 35, spotX: 0, userSide: null, kind: 'scrim', diff: DIFF.pro, assist: true, togo: 10, hot: {} });
      GS.Render.bindPlayers(sim().all);
    }
    // run real CPU plays behind the menu
    const S = sim();
    Game.attractT = (Game.attractT || 0) + dt;
    if (S.phase === 'presnap' && Game.attractT > 1.5) S.snap();
    else if (S.phase === 'live' || S.phase === 'dead') { S.step(Math.min(dt, 1 / 30)); S.drainEvents(); }
    if (S.phase === 'dead' && S.deadT > 2.2 || Game.attractT > 14) {
      Game.attractT = 0; const PB = GS.Playbook;
      S.setup({ off: S.cfg.off, def: S.cfg.def, offPlay: PB.OFF[Math.floor(Math.random() * PB.OFF.length)], defPlay: PB.D[Math.floor(Math.random() * PB.D.length)], los: 25 + Math.random() * 40, spotX: (Math.random() - 0.5) * 6, userSide: null, kind: 'scrim', diff: DIFF.pro, assist: true, togo: 10, hot: {} });
      GS.Render.bindPlayers(S.all);
    }
    const t = Game.menuT * 0.1, fx = S.ball.x, fz = S.ball.z;
    GS.Render.camState.pos.set(-fx + Math.cos(t) * 26, 11, fz - 6 + Math.sin(t) * 22); GS.Render.camState.look.set(-fx, 0, fz + 4);
    GS.Render.frame({ sim: S, mode: 'menu', userSide: null, replay: false, excite: 0.3, firstDownZ: S.los + 10, menu: true, freeCam: true }, dt);
  }
  Game.resetAttract = function () { menuSim = false; };

  Game.boot = function () {
    GS.Data.init();
    GS.UI.init();
    GS.Audio.setEnabled(settings.sound);
    try { GS.Render.init(document.getElementById('stage'), settings.quality); } catch (e) { console.error(e); GS.UI.toast('3D graphics are unavailable on this device'); }
    GS.UI.showScreen('title');
    requestAnimationFrame(t => { last = t; loop(t); });
  };

  // ------------------------------------------------ test hooks
  Game.debug = {
    // simulate with both teams CPU-controlled, no rendering, fixed steps
    autoplay(on) { Game.autoUser = on; },
    tick(seconds) { const h = 1 / 30; for (let i = 0; i < Math.round(seconds / h); i++) Game.update(h); return Game.state; },
    run(seconds) { const h = 1 / 30; const n = Math.round(seconds / h); for (let i = 0; i < n; i++) { if (Game.state === 'final') break; if (Game.state === 'break') Game.resumeFromBreak(); if (Game.state === 'pat') Game.patChoice('kick'); if (Game.state === 'call') { const c = Game.callCtx; Game.pickPlay(c.us === 'off' ? GS.AI.callOffense(Object.assign({ kicker: c.sit.off.starters.K[0] }, c.sit)) : GS.AI.callDefense(c.sit, null, DIFF.pro)); } Game.update(h); if (Game.state === 'kickmeter') { GS.Input.press('action'); } } return Game.G; },
  };
  GS.Game = Game;
})(window.GS);
