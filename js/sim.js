/* =========================================================================
   GS.Sim — one live play: player physics, blocking, ball flight, catches,
   tackles, fumbles, kicks.  Play frame: z = yards from the offense's own
   goal line (opponent goal at 100), x = lateral (+ = offense's right).
   AI decisions live in GS.AI; the game rules consume sim.result.
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const SIDELINE = 26.65, HASH = 3.08, G = 10.7, RAD = 0.42;
  const rnd = Math.random, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  const OFF_ROLES = ['QB', 'RB', 'X', 'Z', 'S', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
  const DEF_ROLES = ['LE', 'DT', 'NT', 'RE', 'WL', 'ML', 'LC', 'RC', 'NB', 'FS', 'SS'];
  const ELIGIBLE = ['X', 'Z', 'S', 'TE', 'RB'];

  let NEXT_ID = 1;
  function mkPlayer(info, side, role, team, x, z) {
    const r = info ? info.r : {};
    const spd = r.spd || 60, acc = r.acc || 60;
    return {
      id: NEXT_ID++, info, side, role, team, x, z, vx: 0, vz: 0, heading: side === 'off' ? 0 : Math.PI,
      maxSpeed: 6.3 + (spd - 40) / 59 * 3.3, accel: 7.5 + (acc - 40) / 59 * 8,
      heavy: info && info.wt > 285, r,
      engaged: null, shedT: 0, stun: 0, down: 0, tackleCD: 0, cooldownWith: null, cooldownT: 0,
      juke: 0, jukeDir: 0, spin: 0, dive: 0, moveCD: 0, user: false, assist: false, idleT: 0,
      anim: 'stance', animT: 0, phase: rnd() * 6, speed: 0, celebrate: 0, throwT: 0, reach: 0, kneel: 0, kickT: 0,
      route: null, routeIdx: 0, settle: false, assign: null, desired: { x: 0, z: 0 }, lagX: 0, lagZ: 0,
    };
  }

  const sim = {
    phase: 'idle', t: 0, los: 25, spotX: 0, off: [], def: [], all: [], ball: null, cfg: null,
    carrier: null, carrierDir: 1, result: null, events: [], user: null, highlight: null,
    passAllowed: true, thrown: false, handedOff: false, playKnown: false, rec: [], recT: 0, log: [],
    camBasis: { fx: 0, fz: 1, rx: 1, rz: 0 }, kick: null, possChangeZ: null, flags: [], stats: [],
    maxDepthGain: 0, airYards: 0, sackable: true,
  };

  function emit(type, data) { const e = Object.assign({ type, t: sim.t }, data || {}); sim.events.push(e); sim.log.push(e); }
  function stat(p, key, v) { if (p && p.info) sim.stats.push({ team: p.team.abbr, name: p.info.name, num: p.info.num, pos: p.info.dpos, key, v: v === undefined ? 1 : v }); }

  // ---------------------------------------------------------------- setup
  function setup(cfg) {
    // cfg: {off, def, offPlay, defPlay, los, spotX, userSide, kind, diff, hot, kickPower, kickAcc, togo}
    NEXT_ID = 1;
    Object.assign(sim, { phase: 'presnap', t: 0, cfg, los: cfg.los, spotX: clamp(cfg.spotX || 0, -HASH, HASH), off: [], def: [], all: [], carrier: null, carrierDir: 1, result: null, events: [], log: [],
      user: null, highlight: null, passAllowed: true, thrown: false, handedOff: false, playKnown: false, rec: [], recT: 0, kick: null, possChangeZ: null, flags: [], stats: [], airYards: 0, sackable: true, deadT: 0, pitch: null,
      passer: null, receiver: null, celebrant: null, oob: false, reason: null, qbT: 0, hlT: 0, lockedHighlight: false, fumbleSide: null, readJitter: 0 });
    const kind = cfg.kind;
    if (kind === 'kickoff') setupKickoff(cfg); else if (kind === 'punt') setupPunt(cfg); else if (kind === 'fg' || kind === 'xp') setupFG(cfg); else setupScrimmage(cfg);
    sim.all = sim.off.concat(sim.def);
    sim.ball = { state: 'held', holder: sim.off.find(p => p.role === 'C') || sim.off[0], x: sim.spotX, y: 0.25, z: sim.los, vx: 0, vy: 0, vz: 0, spin: 0, target: null, resolved: false, intended: null, flightT: 0, flightDur: 0 };
    if (kind === 'kickoff') { sim.ball.state = 'tee'; sim.ball.holder = null; sim.ball.x = sim.spotX; sim.ball.z = sim.los; sim.ball.y = 0.2; }
    // user player
    if (cfg.userSide === 'off') {
      const q = sim.off.find(p => p.role === (kind === 'punt' ? 'P' : kind === 'fg' || kind === 'xp' ? 'K' : 'QB'));
      if (kind !== 'kickoff') setUser(q);
    } else if (cfg.userSide === 'def') {
      if (kind === 'kickoff' || kind === 'punt') setUser(sim.def.find(p => p.role === 'KR'));
      else setUser(sim.def.find(p => p.role === (cfg.userRole || 'ML')) || sim.def[5]);
    }
    for (const p of sim.all) p.heading = p.side === 'off' ? 0 : Math.PI;
    if (kind === 'kickoff') for (const p of sim.def) p.heading = Math.PI;
    sim.highlight = null;
  }
  function setUser(p) { if (sim.user) sim.user.user = false; sim.user = p || null; if (p) { p.user = true; p.idleT = 0; } }

  function startersFor(team, role, form) {
    const S = team.starters;
    switch (role) {
      case 'QB': return S.QB[0]; case 'RB': return S.RB[0];
      case 'X': return S.WR[0]; case 'Z': return S.WR[1];
      case 'S': return (form === 'iform' || form === 'heavy') ? (S.RB[1] || S.TE[0]) : S.WR[2];
      case 'TE': return S.TE[0];
      case 'LT': return S.OL[0]; case 'LG': return S.OL[1]; case 'C': return S.OL[2]; case 'RG': return S.OL[3]; case 'RT': return S.OL[4];
      case 'LE': return S.DL[0]; case 'DT': return S.DL[1]; case 'NT': return S.DL[2]; case 'RE': return S.DL[3];
      case 'WL': return S.LB[0]; case 'ML': return S.LB[1];
      case 'LC': return S.CB[0]; case 'RC': return S.CB[1]; case 'NB': return S.CB[2];
      case 'FS': return S.S[0]; case 'SS': return S.S[1];
      case 'K': return S.K[0]; case 'P': return S.P[0]; case 'KR': return S.WR[3] || S.RB[1] || S.CB[2];
    }
    return S.LB[2];
  }
  const wide = x => clamp(x, -SIDELINE + 1.8, SIDELINE - 1.8);

  function setupScrimmage(cfg) {
    const PB = GS.Playbook, play = cfg.offPlay, form = PB.F[play.form || 'gun'];
    const sx = sim.spotX;
    for (const role of OFF_ROLES) {
      const al = form[role]; const p = mkPlayer(startersFor(cfg.off, role, play.form), 'off', role, cfg.off, wide(sx + al[0]), sim.los + al[1]);
      p.home = { x: p.x, z: p.z };
      if (ELIGIBLE.includes(role)) {
        const rname = (cfg.hot && cfg.hot[role]) || (play.routes && play.routes[role]);
        if (play.type === 'run' || play.type === 'kneel' || play.type === 'spike') p.route = null;
        else if (rname === 'block') { p.route = null; p.passBlock = true; }
        else if (rname) { p.routeName = rname; p.route = PB.routePoints(rname, [p.x - sx, al[1]]).map(([x, z]) => ({ x: wide(x + sx), z: sim.los + z })); p.settle = !!PB.R[rname].settle; }
      }
      sim.off.push(p);
    }
    const dplay = cfg.defPlay;
    for (const role of DEF_ROLES) {
      const al = (dplay.align && dplay.align[role]) || PB.DALIGN[role];
      let ax = al[0];
      // align corners/nickel over their receivers
      const shadow = { LC: 'X', RC: 'Z', NB: 'S' }[role];
      if (shadow) { const rr = sim.off.find(o => o.role === shadow); ax = rr.x - sx + (role === 'NB' ? -0.8 * Math.sign(rr.x - sx || 1) : 0); }
      if (role === 'SS' && !dplay.align) { const te = sim.off.find(o => o.role === 'TE'); ax = clamp(te.x - sx + 2 * Math.sign(te.x - sx || 1), -12, 12); }
      const depth = shadow ? (dplay.a[role].startsWith('m:') ? 1.6 : al[1]) : al[1];
      const p = mkPlayer(startersFor(cfg.def, role), 'def', role, cfg.def, wide(sx + ax), sim.los + depth);
      p.assign = dplay.a[role]; p.home = { x: p.x, z: p.z };
      if (p.assign.startsWith('m:')) p.manTarget = sim.off.find(o => o.role === p.assign.slice(2));
      if (p.assign.startsWith('z:')) { const z = PB.Z[p.assign.slice(2)]; p.zone = { x: wide(sx + z[0] * (Math.abs(sx + z[0]) > 22 ? 0.9 : 1)), z: sim.los + z[1], deep: z[1] > 14 }; }
      sim.def.push(p);
    }
  }

  function setupPunt(cfg) {
    const sx = sim.spotX;
    const L = [['LT', -2.6, -0.8], ['LG', -1.3, -0.7], ['C', 0, -0.6], ['RG', 1.3, -0.7], ['RT', 2.6, -0.8], ['TE', -3.9, -1], ['S', 3.9, -1], ['RB', 0.5, -7], ['X', -21, -0.8], ['Z', 21, -0.8], ['P', 0, -14]];
    for (const [role, dx, dz] of L) { const info = role === 'P' ? cfg.off.starters.P[0] : startersFor(cfg.off, role, 'gun'); const p = mkPlayer(info, 'off', role, cfg.off, wide(sx + dx), sim.los + dz); p.home = { x: p.x, z: p.z }; p.cover = role !== 'P'; sim.off.push(p); }
    const D = [['LE', -2, 1], ['DT', -0.7, 1], ['NT', 0.7, 1], ['RE', 2, 1], ['WL', -5, 1.2], ['ML', 5, 1.2], ['LC', -20, 2], ['RC', 20, 2], ['NB', -8, 22], ['FS', 8, 22], ['KR', 0, 44]];
    for (const [role, dx, dz] of D) { const p = mkPlayer(startersFor(cfg.def, role), 'def', role, cfg.def, wide(sx + dx), Math.min(sim.los + dz, 108)); p.home = { x: p.x, z: p.z }; p.returnTeam = true; sim.def.push(p); }
    sim.kick = { type: 'punt', power: cfg.kickPower == null ? 0.75 : cfg.kickPower, acc: cfg.kickAcc == null ? 0 : cfg.kickAcc, kicked: false };
  }

  function setupFG(cfg) {
    const sx = sim.spotX;
    const L = [['LT', -2.6, -0.8], ['LG', -1.3, -0.7], ['C', 0, -0.6], ['RG', 1.3, -0.7], ['RT', 2.6, -0.8], ['TE', -3.9, -1], ['S', 3.9, -1], ['X', -5, -1.4], ['Z', 5, -1.4], ['QB', 0, -7], ['K', -1.6, -9.6]];
    for (const [role, dx, dz] of L) { const info = role === 'K' ? cfg.off.starters.K[0] : role === 'QB' ? (cfg.off.starters.P[0] || cfg.off.starters.QB[1]) : startersFor(cfg.off, role, 'gun'); const p = mkPlayer(info, 'off', role, cfg.off, sx + dx, sim.los + dz); p.home = { x: p.x, z: p.z }; p.passBlock = true; sim.off.push(p); }
    const D = [['LE', -3, 0.9], ['DT', -1, 0.9], ['NT', 1, 0.9], ['RE', 3, 0.9], ['WL', -5, 1], ['ML', 5, 1], ['LC', -7, 1.2], ['RC', 7, 1.2], ['NB', -2, 3], ['FS', 2, 3], ['SS', 0, 12]];
    for (const [role, dx, dz] of D) { const p = mkPlayer(startersFor(cfg.def, role), 'def', role, cfg.def, sx + dx, sim.los + dz); p.home = { x: p.x, z: p.z }; p.assign = 'rush'; sim.def.push(p); }
    sim.kick = { type: cfg.kind, power: cfg.kickPower == null ? 0.8 : cfg.kickPower, acc: cfg.kickAcc == null ? 0 : cfg.kickAcc, kicked: false };
  }

  function setupKickoff(cfg) {
    // kicking team = "off" (moves +z), receiving team = "def"
    const xs = [-22, -17, -12, -7, -3, 3, 7, 12, 17, 22];
    const roles = ['X', 'Z', 'S', 'TE', 'RB', 'LT', 'LG', 'C', 'RG', 'RT'];
    roles.forEach((role, i) => { const p = mkPlayer(startersFor(cfg.off, role, 'gun'), 'off', role, cfg.off, xs[i], sim.los - 1); p.cover = true; p.home = { x: p.x, z: p.z }; sim.off.push(p); });
    const k = mkPlayer(cfg.off.starters.K[0], 'off', 'K', cfg.off, -1.5, sim.los - 7); k.home = { x: k.x, z: k.z }; sim.off.push(k);
    const D = [['LE', -12, 12], ['DT', -4, 12], ['NT', 4, 12], ['RE', 12, 12], ['WL', -15, 22], ['ML', -5, 24], ['LC', 5, 24], ['RC', 15, 22], ['NB', -6, 40], ['FS', 6, 40], ['KR', 0, 62]];
    for (const [role, dx, dz] of D) { const p = mkPlayer(startersFor(cfg.def, role), 'def', role, cfg.def, dx, sim.los + dz); p.home = { x: p.x, z: p.z }; p.returnTeam = true; sim.def.push(p); }
    sim.kick = { type: 'kickoff', power: 0.85 + rnd() * 0.15, acc: (rnd() - 0.5) * 0.3, kicked: false };
  }

  // ---------------------------------------------------------------- snap
  function snap() {
    if (sim.phase !== 'presnap') return;
    sim.phase = 'live'; sim.t = 0; emit('snap');
    for (const p of sim.all) { p.anim = 'run'; }
    const k = sim.cfg.kind, play = sim.cfg.offPlay;
    if (k === 'kickoff') { const kk = sim.off.find(p => p.role === 'K'); kk.kickRun = true; return; }
    const qbRole = k === 'punt' ? 'P' : (k === 'fg' || k === 'xp') ? 'QB' : 'QB';
    const qb = sim.off.find(p => p.role === qbRole);
    const b = sim.ball; b.state = 'snap'; b.holder = null; b.from = { x: b.x, y: 0.4, z: b.z };
    b.to = qb; b.flightT = 0; b.flightDur = Math.max(0.12, Math.abs(qb.z - sim.los) * 0.045);
    if (play && play.type === 'kneel') qb.kneelPlay = true;
    if (play && play.type === 'spike') qb.spikePlay = true;
  }

  // ---------------------------------------------------------------- helpers
  function basisMove(m) { // screen stick -> play-frame vector
    const B = sim.camBasis; return { x: B.rx * m.x + B.fx * m.y, z: B.rz * m.x + B.fz * m.y };
  }
  function giveBall(p, how) {
    const b = sim.ball; b.state = 'held'; b.holder = p; b.resolved = true;
    sim.carrier = p; p.anim = 'run';
    if (p.side === 'def' && sim.carrierDir === 1) { sim.carrierDir = -1; sim.possChangeZ = p.z; emit('turnover', { how }); }
    else if (p.side === 'off' && sim.carrierDir === -1) { sim.carrierDir = 1; sim.possChangeZ = p.z; emit('turnover', { how: 'recovered' }); }
    // user takes over a carrier on their side
    const us = sim.cfg.userSide;
    // defense: if the user is far from the new ball carrier, switch to the closest defender
    const DL = ['LE', 'DT', 'NT', 'RE'], pick = (d, ref) => dist(d, ref) + (DL.includes(d.role) ? 3.5 : 0); // linemen are usually tied up
    if (us === 'def' && p.side === 'off' && sim.user && dist(sim.user, p) > 9) { const best = sim.def.filter(d => !d.down && !d.engaged).sort((a, c) => pick(a, p) - pick(c, p))[0]; if (best) { setUser(best); emit('switch'); } }
    if (us && ((us === 'off' && p.side === 'off') || (us === 'def' && p.side === 'def'))) setUser(p);
    else if (us && sim.user && sim.user.side === p.side) { /* keep */ }
    else if (us && how !== 'snap') { // user's side lost the ball — switch to the closest defender
      const mine = (us === 'off' ? sim.off : sim.def).filter(q => !q.down).sort((a, c) => dist(a, p) - dist(c, p))[0];
      if (mine) setUser(mine);
    }
  }

  function throwBall(qb, target, opts) {
    if (!sim.passAllowed || sim.thrown || sim.ball.holder !== qb) return false;
    opts = opts || {};
    const b = sim.ball, lob = opts.lob || 0;
    // touch pass floats over the coverage; bullet is a rope that gets there now
    const speed = lob ? 15.5 + (qb.r.thp - 60) * 0.05 : opts.bullet ? 24 + (qb.r.thp - 60) * 0.14 : 19.5 + (qb.r.thp - 60) * 0.1;
    // lead the receiver: predict where he'll be when the ball arrives
    let px = target.x, pz = target.z, T = 0;
    for (let i = 0; i < 4; i++) { T = Math.hypot(px - qb.x, pz - qb.z) / speed; const lv = predictVel(target); px = target.x + lv.x * T; pz = target.z + lv.z * T; }
    if (opts.lead) { px += opts.lead.x * 2.6; pz += opts.lead.z * 2.6; }
    px = clamp(px, -SIDELINE - 1, SIDELINE + 1);
    const dd = Math.hypot(px - qb.x, pz - qb.z);
    // accuracy: rating, pressure, distance, throwing on the run, difficulty
    const pressure = sim.def.some(d => !d.engaged && !d.down && dist(d, qb) < 2.4) ? 1.7 : 1;
    const moving = Math.hypot(qb.vx, qb.vz) > 3 ? 1.35 : 1;
    const diff = sim.cfg.diff; const accMul = qb.side === 'off' && sim.cfg.userSide === 'off' ? diff.userQBAcc : diff.cpuQBAcc;
    const err = (1.25 - qb.r.tha / 100) * (0.35 + dd * 0.035) * pressure * moving / accMul;
    const ang = rnd() * Math.PI * 2, mag = Math.abs(gauss()) * err;
    px += Math.cos(ang) * mag; pz += Math.sin(ang) * mag;
    T = Math.hypot(px - qb.x, pz - qb.z) / speed;
    const y0 = 2.0, y1 = 1.35;
    b.state = 'air'; b.holder = null; b.x = qb.x; b.y = y0; b.z = qb.z;
    b.vx = (px - qb.x) / T; b.vz = (pz - qb.z) / T; b.vy = (y1 - y0) / T + 0.5 * G * T;
    b.target = { x: px, z: pz }; b.intended = target; b.resolved = false; b.flightT = 0; b.flightDur = T;
    sim.thrown = true; sim.passAllowed = false; sim.carrier = null; sim.airYards = pz - sim.los;
    // defense: hand the user the defender closest to where the ball is coming down
    if (sim.cfg.userSide === 'def' && sim.user) {
      const spot = { x: px, z: pz }, best = sim.def.filter(d => !d.down && !d.engaged).sort((a, c) => dist(a, spot) - dist(c, spot))[0];
      if (best && best !== sim.user && dist(sim.user, spot) > dist(best, spot) + 3) { setUser(best); emit('switch'); }
    }
    qb.anim = 'throw'; qb.throwT = 0;
    stat(qb, 'passAtt'); emit('throw', { target, depth: pz - sim.los });
    return true;
  }
  function gauss() { return (rnd() + rnd() + rnd() - 1.5) * 1.15; }
  function predictVel(p) {
    // receivers on routes keep running; settle routes stop
    if (p.route && p.routeIdx >= p.route.length && p.settle) return { x: 0, z: 0 };
    return { x: p.vx, z: p.vz };
  }

  function pitchTo(qb, rb) {
    const b = sim.ball; b.state = 'pitch'; b.holder = null; b.from = { x: qb.x, y: 1.3, z: qb.z }; b.to = rb; b.flightT = 0; b.flightDur = 0.45; sim.passAllowed = false; sim.handedOff = true; sim.carrier = null;
  }
  function handoff(qb, rb) { sim.handedOff = true; sim.passAllowed = false; giveBall(rb, 'handoff'); emit('handoff'); }

  // ---------------------------------------------------------------- step
  function step(dt) {
    if (sim.phase === 'presnap') { presnapStep(dt); return; }
    if (sim.phase !== 'live' && sim.phase !== 'dead') return;
    sim.t += dt;
    if (sim.phase === 'dead') { sim.deadT += dt; for (const p of sim.all) moveDead(p, dt); updateBall(dt); record(dt); return; }
    GS.AI.team(sim, dt);
    for (const p of sim.all) think(p, dt);
    for (const p of sim.all) integrate(p, dt);
    blocking(dt);
    separate();
    updateBall(dt);
    if (sim.phase === 'live') contacts(dt);
    if (sim.phase === 'live') checkBounds();
    if (sim.phase === 'live' && sim.t > 25) endPlay('timeout-safety');
    record(dt);
  }

  function presnapStep(dt) {
    const u = sim.user;
    for (const p of sim.all) { p.anim = 'stance'; p.vx = p.vz = 0; p.speed = 0; }
    if (u && sim.cfg.userSide === 'def' && sim.cfg.kind === 'scrim') {
      const m = basisMove(GS.Input.move());
      u.x = clamp(u.x + m.x * 4 * dt, -SIDELINE + 1, SIDELINE - 1); u.z = Math.max(sim.los + 0.9, u.z + m.z * 4 * dt);
      if (Math.hypot(m.x, m.z) > 0.1) { u.anim = 'run'; u.speed = 4; u.phase += dt * 8; }
    }
    record(dt);
  }

  function think(p, dt) {
    p.stun = Math.max(0, p.stun - dt); p.tackleCD = Math.max(0, p.tackleCD - dt); p.moveCD = Math.max(0, p.moveCD - dt);
    if (p.playBall && sim.t - p.playBall.t > 0.75) { p.playBall = null; p.reach = 0; }
    p.juke = Math.max(0, p.juke - dt); p.spin = Math.max(0, p.spin - dt); p.cooldownT = Math.max(0, p.cooldownT - dt);
    if (p.down > 0) { p.down -= dt; p.desired.x = p.desired.z = 0; if (p.down <= 0) { p.down = 0; p.anim = 'run'; } return; }
    if (p.dive > 0) { p.dive -= dt; if (p.dive <= 0) { p.down = 0.9; p.anim = 'fall'; } return; }
    if (p.stun > 0) { p.desired.x = p.vx * 0.3; p.desired.z = p.vz * 0.3; return; }
    let usedUser = false;
    if (p.user) usedUser = userThink(p, dt);
    if (!usedUser) GS.AI.think(sim, p, dt);
  }

  function userThink(p, dt) {
    const I = GS.Input, raw = I.move(), m = basisMove(raw), mag = Math.hypot(raw.x, raw.y);
    p.burst = false;
    const foe = sim.carrier && sim.ball.holder === sim.carrier && sim.carrier.side !== p.side ? sim.carrier : null;
    if (foe && I.tackleHeld() && !p.dive) {
      const d = dist(p, foe), T = d < 6 ? 0.12 : Math.min(d / (p.maxSpeed || 7), 0.8); // lead from afar, go straight at him up close
      const tx = foe.x + foe.vx * T, tz = foe.z + foe.vz * T, n = norm(tx - p.x, tz - p.z);
      p.desired.x = n.x * p.maxSpeed; p.desired.z = n.z * p.maxSpeed; p.burst = d < 4; p.idleT = 0; p.assist = false;
      const closing = -((foe.x - p.x) * (foe.vx - p.vx) + (foe.z - p.z) * (foe.vz - p.vz)) / (d || 1);
      if (d < 2.2 || (d < 3.4 && closing > 3)) actions.dive(p);
      return true;
    }
    const isCarrier = sim.carrier === p, isQB = sim.ball.holder === p && sim.passAllowed && !sim.thrown;
    if (mag > 0.08) p.idleT = 0; else p.idleT += dt;
    // QB: auto drop-back until the stick is touched
    if (isQB && p.idleT > 0 && !p.touchedStick) { if (mag > 0.08) p.touchedStick = true; else return false; }
    if (mag > 0.08) p.touchedStick = true;
    // idle assist: AI drives the player after a moment of no input
    // (defense only: on offense the user is always in control of the QB and ball carrier)
    if (mag < 0.08 && p.idleT > 0.7 && sim.cfg.assist && p.side === 'def' && !isCarrier) { p.assist = true; return false; }
    p.assist = false;
    const sprint = I.sprint();
    const sp = p.maxSpeed * (sprint ? 1 : 0.8) * Math.min(1, mag * 1.15);
    const n = Math.hypot(m.x, m.z) || 1;
    p.desired.x = m.x / n * sp; p.desired.z = m.z / n * sp;
    if (mag < 0.08) { p.desired.x = 0; p.desired.z = 0; }
    return true;
  }

  // user actions are processed by the game controller and call these:
  const actions = {
    juke(p) {
      if (!p || p.moveCD > 0 || p.down || p.dive) return;
      const m = basisMove(GS.Input.move());
      // juke direction: stick side relative to run direction, else alternate
      const fwd = { x: Math.sin(p.heading), z: Math.cos(p.heading) };
      let side = (m.x * fwd.z - m.z * fwd.x); side = Math.abs(side) > 0.2 ? Math.sign(side) : (p.jukeDir = -(p.jukeDir || 1));
      const lat = { x: -fwd.z * side, z: fwd.x * side };
      p.vx = p.vx * 0.55 + lat.x * 4.6; p.vz = p.vz * 0.55 + lat.z * 4.6;
      p.juke = 0.4; p.jukeSide = side; p.moveCD = 0.8; p.anim = 'juke'; p.animT = 0; emit('move', { kind: 'juke', p });
    },
    spin(p) { if (!p || p.moveCD > 0 || p.down || p.dive) return; p.spin = 0.5; p.moveCD = 1.0; p.vx *= 0.8; p.vz *= 0.8; p.anim = 'spin'; p.animT = 0; emit('move', { kind: 'spin', p }); },
    dive(p) {
      if (!p || p.dive || p.down || p.engaged) return;
      const isCarrier = sim.carrier === p;
      const dir = isCarrier ? { x: Math.sin(p.heading), z: Math.cos(p.heading) } : (sim.carrier ? norm(sim.carrier.x - p.x, sim.carrier.z - p.z) : { x: Math.sin(p.heading), z: Math.cos(p.heading) });
      p.vx = dir.x * (Math.hypot(p.vx, p.vz) + 3); p.vz = dir.z * (Math.hypot(p.vx, p.vz) + 3);
      p.dive = 0.42; p.anim = 'dive'; p.animT = 0; p.diveTackle = !isCarrier; p.carrierDive = isCarrier;
    },
    playBall(p, type) { // user defender goes up for the ball: 'swat' (break it up) or 'pick' (intercept)
      if (!p || p.down || p.dive) return;
      p.playBall = { type, t: sim.t }; p.reach = 1; p.moveCD = 0.3;
      const b = sim.ball; if (b.target) { const n = norm(b.target.x - p.x, b.target.z - p.z); p.vx += n.x * 1.5; p.vz += n.z * 1.5; }
      emit('move', { kind: type, p });
    },
    throwTo(qb, target, lead, bullet) { return throwBall(qb, target, { lead, bullet: !!bullet, lob: !bullet && target.z - sim.los > 8 ? 1 : 0 }); },
    switchPlayer() {
      const us = sim.cfg.userSide; if (!us) return;
      const pool = (us === 'off' ? sim.off : sim.def).filter(p => !p.down && p !== sim.user);
      const ref = sim.carrier || sim.ball;
      pool.sort((a, b) => dist(a, ref) - dist(b, ref));
      if (pool[0]) { setUser(pool[0]); emit('switch'); }
    },
  };
  function norm(x, z) { const n = Math.hypot(x, z) || 1; return { x: x / n, z: z / n }; }

  function integrate(p, dt) {
    if (p.engaged) { p.speed = Math.hypot(p.vx, p.vz); return; }
    if (p.dive > 0) { p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.96; p.vz *= 0.96; p.animT += dt; return; }
    if (p.down > 0) { p.vx *= 0.85; p.vz *= 0.85; p.x += p.vx * dt; p.z += p.vz * dt; p.animT += dt; return; }
    let dx = p.desired.x - p.vx, dz = p.desired.z - p.vz;
    const sp = Math.hypot(p.vx, p.vz), dsp = Math.hypot(p.desired.x, p.desired.z);
    let acc = p.accel * (sim.cfg.diff && p.side !== sim.cfg.userSide ? sim.cfg.diff.cpuSpeed : 1);
    // weight: hard cuts at speed bleed momentum
    if (sp > 3.5 && dsp > 0.5) { const cos = (p.vx * p.desired.x + p.vz * p.desired.z) / (sp * dsp); if (cos < 0.5) acc *= p.heavy ? 0.42 : 0.6; }
    if (p.spin > 0) acc *= 0.7;
    const dm = Math.hypot(dx, dz), lim = acc * dt;
    if (dm > lim) { dx *= lim / dm; dz *= lim / dm; }
    if (p.juke > 0.25) { dx *= 0.3; dz *= 0.3; }
    p.vx += dx; p.vz += dz;
    const carrying = sim.ball.holder === p && sim.carrier === p;
    // a pursuer in range gets a short closing burst (the lunge for the tackle)
    const cap = p.maxSpeed * (p.side !== sim.cfg.userSide && sim.cfg.diff ? sim.cfg.diff.cpuSpeed : 1) * (carrying ? 0.95 : p.burst ? 1.12 : 1.02);
    const ns = Math.hypot(p.vx, p.vz); if (ns > cap) { p.vx *= cap / ns; p.vz *= cap / ns; }
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.speed = Math.hypot(p.vx, p.vz);
    if (p.speed > 0.4) { const want = Math.atan2(p.vx, p.vz); let d = want - p.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.heading += d * Math.min(1, dt * 10); }
    else if (p.face) { let d = Math.atan2(p.face.x - p.x, p.face.z - p.z) - p.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.heading += d * Math.min(1, dt * 6); }
    p.phase += p.speed * dt * 1.55;
    p.animT += dt;
    if (p.anim === 'throw') { p.throwT += dt; if (p.throwT > 0.5) p.anim = 'run'; }
    else if ((p.anim === 'juke' && p.juke <= 0) || (p.anim === 'spin' && p.spin <= 0)) p.anim = 'run';
    else if (p.anim === 'block' && !p.engaged) p.anim = 'run';
    else if (p.anim === 'stance') p.anim = 'run';
  }

  function moveDead(p, dt) {
    if (p.down > 0) { p.down = Math.max(0.01, p.down - dt * 0.2); p.vx *= 0.85; p.vz *= 0.85; }
    else if (p.celebrate > 0) { p.celebrate += dt; p.vx *= 0.9; p.vz *= 0.9; }
    else if (p.dive > 0) { p.dive -= dt; p.vx *= 0.9; p.vz *= 0.9; if (p.dive <= 0) { p.down = 1; p.anim = 'fall'; } }
    else {
      // jog it out / converge toward the pile or the scorer
      const c = sim.celebrant;
      if (c && c !== p && c.side === p.side && dist(p, c) > 2) { const n = norm(c.x - p.x, c.z - p.z); p.vx += (n.x * 4 - p.vx) * dt * 2; p.vz += (n.z * 4 - p.vz) * dt * 2; }
      else { p.vx *= 1 - dt * 2.2; p.vz *= 1 - dt * 2.2; }
      p.anim = p.engaged ? 'run' : p.anim === 'fall' ? 'fall' : 'run'; p.engaged = null;
    }
    p.x += p.vx * dt; p.z += p.vz * dt; p.speed = Math.hypot(p.vx, p.vz); p.phase += p.speed * dt * 1.55; p.animT += dt;
    if (p.speed > 0.5) p.heading = Math.atan2(p.vx, p.vz);
  }

  // ---------------------------------------------------------------- blocking
  function blocking(dt) {
    const blockers = sim.all.filter(p => p.blockTarget && !p.down && !p.stun && p !== sim.carrier && sim.ball.holder !== p);
    for (const b of blockers) {
      const d = b.blockTarget;
      if (b.engaged) continue;
      if (!d || d.down || d.engaged || d.dive > 0 || d === sim.carrier || (b.cooldownWith === d && b.cooldownT > 0)) continue;
      if (dist(b, d) < 1.05) {
        b.engaged = d; d.engaged = b; b.anim = 'block'; d.anim = 'block';
        const pr = (d.r.prs || 50) * 0.6 + (d.r.str || 50) * 0.4, bk = (b.r.blk || 45) * 0.6 + (b.r.str || 50) * 0.4;
        const runPlay = sim.handedOff || (sim.cfg.offPlay && sim.cfg.offPlay.type === 'run');
        d.shedT = clamp((runPlay ? 2.6 : 1.75) + (bk - pr) * 0.04 + gauss() * 0.6, 0.35, 5);
        if (!['LT', 'LG', 'C', 'RG', 'RT'].includes(b.role) || sim.carrier && sim.carrier.z > sim.los + 3) d.shedT *= 0.45;
        if (sim.t > 3) d.shedT *= 0.6;
        emit('engage', { b, d });
      }
    }
    for (const b of sim.all) {
      const d = b.engaged; if (!d || b.side === 'def') continue;
      // the pair drifts toward the stronger player's goal
      const pr = ((d.r.prs || 50) + (d.r.str || 50)) / 2, bk = ((b.r.blk || 45) + (b.r.str || 50)) / 2;
      const dd = d.desired, bdx = d.x - b.x, bdz = d.z - b.z, n = norm(bdx, bdz);
      const push = (bk - pr) / 40; // + = blocker winning
      const vx = dd.x * 0.22 + n.x * push * 1.6, vz = dd.z * 0.22 + n.z * push * 1.6;
      d.x += vx * dt; d.z += vz * dt; b.x += vx * dt; b.z += vz * dt;
      d.vx = vx; d.vz = vz; b.vx = vx; b.vz = vz;
      // keep them squared up
      const cx = (b.x + d.x) / 2, cz = (b.z + d.z) / 2; b.x = cx - n.x * 0.42; b.z = cz - n.z * 0.42; d.x = cx + n.x * 0.42; d.z = cz + n.z * 0.42;
      b.heading = Math.atan2(n.x, n.z); d.heading = Math.atan2(-n.x, -n.z);
      // shedding — faster when the ball carrier is close (run fits)
      let rate = 1;
      if (sim.carrier && sim.carrier.side !== d.side && dist(d, sim.carrier) < 2.6) rate = 2.4;
      if (d.user && GS.Input.tackleHeld()) rate *= 3; // the user fights off the block
      d.shedT -= dt * rate;
      if (d.shedT <= 0) {
        b.engaged = null; d.engaged = null; b.stun = 0.35; b.cooldownWith = d; b.cooldownT = 1.1; d.anim = 'run'; b.anim = 'run';
        const tgt = sim.carrier || sim.ball; const m = norm(tgt.x - d.x, tgt.z - d.z); d.vx = m.x * 3; d.vz = m.z * 3;
      }
    }
  }

  function separate() {
    const A = sim.all;
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      const a = A[i], b = A[j]; if (a.engaged === b) continue; if ((a.down && b.down)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, min = RAD * 2;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (min - d) * 0.5, nx = dx / d, nz = dz / d;
        const wa = a.down ? 0 : 1, wb = b.down ? 0 : 1, s = wa + wb || 1;
        a.x -= nx * push * 2 * wa / s; a.z -= nz * push * 2 * wa / s; b.x += nx * push * 2 * wb / s; b.z += nz * push * 2 * wb / s;
      }
    }
  }

  // ---------------------------------------------------------------- ball
  function updateBall(dt) {
    const b = sim.ball;
    if (b.state === 'held' && b.holder) {
      const h = b.holder, hd = h.heading, side = h.anim === 'throw' ? -0.25 : 0.3;
      b.x = h.x + Math.sin(hd) * 0.25 + Math.cos(hd) * side * -1; b.z = h.z + Math.cos(hd) * 0.25 + Math.sin(hd) * side; b.y = h.down ? 0.3 : (h.dive ? 0.6 : 1.25);
      return;
    }
    if (b.state === 'snap' || b.state === 'pitch') {
      b.flightT += dt; const k = Math.min(1, b.flightT / b.flightDur), to = b.to;
      b.x = b.from.x + (to.x - b.from.x) * k; b.z = b.from.z + (to.z - b.from.z) * k; b.y = b.from.y + (1.3 - b.from.y) * k + Math.sin(k * Math.PI) * 0.3;
      if (k >= 1) {
        if (b.state === 'snap') { b.state = 'held'; b.holder = to; if (to.role === 'QB' && sim.cfg.kind === 'scrim') { sim.carrier = to; } emit('snapped'); }
        else { if (rnd() < 0.005) { fumble(to, 'pitch'); } else { giveBall(to, 'pitch'); } }
      }
      return;
    }
    if (b.state === 'air' || b.state === 'kick') {
      b.flightT += dt; b.x += b.vx * dt; b.z += b.vz * dt; b.vy -= G * dt; b.y += b.vy * dt; b.spin += dt * 20;
      if (b.state === 'kick') { kickFlight(dt); return; }
      if (!b.resolved && sim.phase === 'live') resolveCatch();
      if (b.y <= 0.15) {
        b.y = 0.15;
        if (!b.resolved && sim.phase === 'live') { b.resolved = true; incomplete('ground'); }
        b.vx *= 0.4; b.vz *= 0.4; b.vy = Math.abs(b.vy) * 0.3; if (Math.abs(b.vy) < 0.5) { b.state = 'dead'; }
      }
      return;
    }
    if (b.state === 'loose') {
      b.x += b.vx * dt; b.z += b.vz * dt; b.vy -= G * dt; b.y += b.vy * dt; b.spin += dt * 12;
      if (b.y < 0.15) { b.y = 0.15; b.vy = Math.abs(b.vy) * 0.45; b.vx *= 0.7; b.vz *= 0.7; b.vx += (rnd() - 0.5) * 2; b.vz += (rnd() - 0.5) * 2; }
      if (Math.abs(b.x) > SIDELINE) { endPlay('fumble-oob'); return; }
      b.looseT += dt;
      if (sim.fumbleSide === 'none') { // a bouncing kick: kicking team downs it, or it rolls dead
        const kr = sim.def.find(p => p.role === 'KR');
        if (kr && Math.hypot(kr.x - b.x, kr.z - b.z) < 0.9 && b.looseT > -0.6) { giveBall(kr, 'kick'); sim.fumbleSide = null; b.state = 'held'; return; }
        if (b.z >= 100) { endPlay('touchback'); return; }
        if (b.looseT > 0.3 || sim.off.some(p => !p.down && Math.hypot(p.x - b.x, p.z - b.z) < 1)) { b.vx = b.vz = 0; endPlay('downed'); }
        return;
      }
      if (b.looseT > 0.35) {
        const near = sim.all.filter(p => !p.down && Math.hypot(p.x - b.x, p.z - b.z) < 0.9);
        if (near.length) {
          const p = near[Math.floor(rnd() * near.length)];
          p.down = 0.6; p.anim = 'fall'; giveBall(p, 'fumble'); stat(p, 'fumRec'); emit('recover', { p });
          if (p.side !== sim.fumbleSide) emit('banner', { text: 'TURNOVER', sub: 'Fumble recovered' });
          sim.carrier = p; tackled(p, null, 'recovery');
        }
      }
      if (b.looseT > 4) endPlay('fumble-dead');
      return;
    }
    if (b.state === 'tee') { b.y = 0.25; return; }
    if (b.state === 'dead') { b.y = Math.max(0.15, b.y); }
  }

  function resolveCatch() {
    const b = sim.ball;
    if (b.y > 2.9 || b.vy > 0 && b.flightT < b.flightDur * 0.7) return;
    const reach = (p) => Math.hypot(p.x - b.x, p.z - b.z);
    const playing = p => p.user && p.playBall && sim.t - p.playBall.t < 0.75;
    const cand = sim.all.filter(p => !p.down && !p.engaged && p.role !== 'QB' && reach(p) < (playing(p) ? 2.4 : 1.55));
    if (!cand.length) return;
    const rec = cand.filter(p => p.side === 'off' && ELIGIBLE.includes(p.role)).sort((a, c) => reach(a) - reach(c))[0];
    const dfd = cand.find(p => p.side === 'def' && playing(p)) || cand.filter(p => p.side === 'def').sort((a, c) => reach(a) - reach(c))[0];
    if (!rec && !dfd) return;
    b.resolved = true;
    const diff = sim.cfg.diff, us = sim.cfg.userSide;
    const recBonus = us === 'off' ? diff.userCatch : us === 'def' ? diff.cpuCatch : 0;
    const dfBonus = us === 'def' ? diff.userCatch : us === 'off' ? diff.cpuCatch : 0;
    const rd = rec ? reach(rec) : 99, dd = dfd ? reach(dfd) : 99;
    // the user timed a SWAT or PICK as the ball arrived
    if (dfd && playing(dfd)) {
      const type = dfd.playBall.type, edge = rec ? Math.max(-0.2, Math.min(0.3, (rd - dd) * 0.15)) : 0.3;
      if (type === 'pick') {
        if (rnd() < clamp(0.34 + ((dfd.r.cth || 55) - 55) / 140 + edge + dfBonus * 0.5, 0.12, 0.75)) return intercept(dfd);
        if (rnd() < 0.5) { emit('breakup', { p: dfd }); stat(dfd, 'pbu'); emit('banner', { text: 'BROKEN UP', sub: dfd.info ? dfd.info.name.toUpperCase() : '' }); return incomplete('defended', dfd); }
      } else {
        if (rnd() < clamp(0.55 + ((dfd.r.cov || 60) - 60) / 120 + edge + dfBonus, 0.35, 0.92)) { emit('breakup', { p: dfd }); stat(dfd, 'pbu'); emit('banner', { text: 'SWATTED!', sub: dfd.info ? dfd.info.name.toUpperCase() : '' }); emit('slowmo', { dur: 0.5, scale: 0.35 }); return incomplete('defended', dfd); }
        if (rnd() < 0.05) return intercept(dfd);
      }
      if (rec && rd < 1.6) { rec.reach = 0.35; return complete(rec, true); }
      return incomplete('defended', dfd);
    }
    const tryInt = (p, base) => { const c = clamp(base + ((p.r.cth || 50) - 50) / 220 + dfBonus * 0.5, 0.02, 0.6); return rnd() < c; };
    if (dfd && dd < rd - 0.25) {
      if (tryInt(dfd, rec ? 0.05 : 0.17)) return intercept(dfd);
      if (rnd() < 0.7 || !rec) { emit('breakup', { p: dfd }); stat(dfd, 'pbu'); return incomplete('defended', dfd); }
    }
    if (rec) {
      let c = 0.85 + ((rec.r.cth || 60) - 60) / 95 + recBonus;
      if (rd > 0.85) c -= (rd - 0.85) * 0.42;
      if (dfd && dd < 1.4) c -= 0.3 * ((dfd.r.cov || 60) / 85) * (1.4 - dd) / 1.4 + 0.05;
      if (b.vy < -12) c -= 0.1;
      c -= Math.max(0, sim.airYards - 15) * 0.007; // long throws are harder to haul in
      c = clamp(c, 0.06, 0.97);
      rec.reach = 0.35;
      if (rnd() < c) return complete(rec, !!(dfd && dd < 1.6));
      if (dfd && dd < 1.4 && rnd() < 0.035) return intercept(dfd);
      // pass interference: defender all over him on a downfield throw
      if (dfd && dd < 0.8 && sim.airYards > 4 && rnd() < 0.2) sim.flags.push({ type: 'DPI', on: 'def', spot: b.z });
      emit('drop', { p: rec }); return incomplete(dfd && dd < 1.4 ? 'defended' : 'drop', dfd);
    }
    if (dfd) { if (tryInt(dfd, 0.12)) return intercept(dfd); emit('breakup', { p: dfd }); return incomplete('defended', dfd); }
  }

  function complete(rec, contested) {
    const qb = sim.off.find(p => p.role === 'QB');
    stat(qb, 'passComp'); stat(rec, 'rec');
    sim.passer = qb; sim.receiver = rec;
    giveBall(rec, 'catch'); rec.anim = 'run';
    // securing the catch costs a step
    rec.vx *= 0.55; rec.vz *= 0.55; rec.stun = contested ? 0.25 : 0.12;
    emit('catch', { p: rec, contested, depth: rec.z - sim.los });
    if (contested || rec.z - sim.los > 18) emit('slowmo', { dur: 0.7, scale: 0.3 });
    if (rec.z >= 100) score('td');
  }
  function intercept(d) {
    const qb = sim.off.find(p => p.role === 'QB'); stat(qb, 'int'); stat(d, 'defInt');
    sim.ball.intercepted = true;
    giveBall(d, 'int'); emit('int', { p: d }); emit('slowmo', { dur: 0.8, scale: 0.28 });
    emit('banner', { text: 'INTERCEPTED', sub: d.info ? d.info.name.toUpperCase() : '' });
  }
  function incomplete(why, dfd) {
    emit('incomplete', { why });
    sim.deadReason = 'incomplete';
    endPlay('incomplete');
  }

  // ---------------------------------------------------------------- contacts / tackles
  function contacts(dt) {
    const c = sim.carrier; if (!c || sim.ball.holder !== c) return;
    if (c.down > 0) return;
    // QB kneel / spike
    if (c.kneelPlay && sim.t > 0.6) { c.anim = 'kneel'; c.down = 2; endPlay('kneel'); return; }
    if (c.spikePlay && sim.t > 0.55) { sim.ball.state = 'loose'; c.anim = 'throw'; sim.ball.vy = -6; sim.ball.vx = 0; sim.ball.vz = 0.5; sim.ball.state = 'air'; sim.ball.resolved = true; sim.thrown = true; endPlay('spike'); return; }
    // carrier dive ends the play at landing
    if (c.carrierDive && c.dive <= 0.02) { tackled(c, null, 'dive'); return; }
    const diff = sim.cfg.diff, us = sim.cfg.userSide;
    const defenders = c.side === 'off' ? sim.def : sim.off;
    let tacklers = 0;
    for (const d of defenders) {
      if (d.down || d.engaged || d.tackleCD > 0 || (d.stun > 0 && !d.diveTackle)) continue;
      const r = dist(d, c), reach = d.dive > 0 && d.diveTackle ? (d.user ? 1.9 : 1.6) : 0.95;
      if (r > reach) continue;
      tacklers++;
      const tak = (d.r.tak || 50), brk = (c.r.car || 50) * 0.55 + (c.r.str || 50) * 0.25 + (c.r.agi || 50) * 0.2;
      let p = 0.76 + (tak - brk) / 95;
      const relV = Math.hypot(d.vx - c.vx, d.vz - c.vz);
      p += clamp((relV - 4) * 0.03, -0.1, 0.12);
      if (d.dive > 0 && d.diveTackle) p += 0.12;
      // moves only fool a tackler who is in front of the runner
      const cs = Math.hypot(c.vx, c.vz) || 1, front = ((d.x - c.x) * c.vx + (d.z - c.z) * c.vz) / cs > -0.2;
      if (front && c.juke > 0.05) p -= 0.32 * ((c.r.agi || 60) / 85);
      if (front && c.spin > 0.05) p -= 0.28 * ((c.r.agi || 60) / 85);
      const evaded = front && (c.juke > 0.05 || c.spin > 0.05);
      if (c.dive > 0) p += 0.2;
      if (us === 'off' && c.side === 'off') p += diff.cpuTackle; // CPU defense tackling the user
      if (us === 'def' && d.side === 'def') p += diff.userTackle;
      if (us === 'def' && c.side === 'def') p += diff.cpuTackle; // user returning a kick/INT
      if (us === 'off' && d.side === 'off') p += diff.userTackle;
      if (tacklers > 1) p += 0.15;
      if (c.role === 'QB' && c.z < sim.los && !sim.thrown) p += 0.1; // sacks
      p = clamp(p, 0.12, 0.97);
      if (rnd() < p) { tackled(c, d, 'tackle', relV); return; }
      d.tackleCD = 1.0; c.vx *= 0.82; c.vz *= 0.82;
      if (evaded) { d.down = 0.7; d.anim = 'fall'; d.stun = 0.7; } else { d.stun = 0.4; }
      emit('broken', { p: c, d }); stat(c, 'brk');
    }
  }

  function tackled(c, d, how, relV) {
    if (sim.phase !== 'live') return;
    relV = relV || 0;
    c.down = 2.5; c.anim = 'fall'; c.animT = 0; c.fallDir = d ? Math.atan2(c.x - d.x, c.z - d.z) : c.heading;
    if (d) { d.down = 2.3; d.anim = 'tackle'; d.animT = 0; d.vx = c.vx * 0.5; d.vz = c.vz * 0.5; stat(d, 'tkl'); }
    // forward progress: falls forward a little
    if (how !== 'recovery') { c.z += 0.35 * sim.carrierDir; }
    const isSack = c.role === 'QB' && !sim.thrown && !sim.handedOff && c.z < sim.los && sim.cfg.kind === 'scrim' && c.side === 'off';
    if (isSack && d) { stat(d, 'sack'); emit('sack', { p: c, d }); emit('banner', { text: 'SACK', sub: d.info ? d.info.name.toUpperCase() : '' }); }
    const big = relV > 7.2;
    emit('hit', { p: c, d, power: clamp(relV / 9, 0.3, 1.4), big, x: c.x, z: c.z });
    if (big) emit('slowmo', { dur: 0.55, scale: 0.3 });
    // fumbles on big hits
    if (d && how === 'tackle' && sim.cfg.kind === 'scrim' || (d && sim.cfg.kind !== 'scrim' && sim.carrierDir === -1)) {
      const fp = 0.003 + Math.max(0, relV - 7) * 0.006 - ((c.r.car || 60) - 60) / 4000;
      if (rnd() < fp && !(isSack && rnd() < 0.5)) { fumble(c, 'hit'); return; }
    }
    endPlay(isSack ? 'sack' : 'tackle');
  }

  function fumble(c, why) {
    const b = sim.ball; b.state = 'loose'; b.holder = null; b.looseT = 0; b.x = c.x; b.z = c.z; b.y = 1;
    b.vx = (rnd() - 0.5) * 6; b.vz = (rnd() - 0.5) * 6; b.vy = 3;
    sim.fumbleSide = c.side; sim.carrier = null; stat(c, 'fum');
    emit('fumble', { p: c }); emit('banner', { text: 'FUMBLE!', sub: '' }); emit('slowmo', { dur: 0.6, scale: 0.35 });
  }

  function checkBounds() {
    const c = sim.carrier;
    if (c && sim.ball.holder === c && !c.down) {
      if (Math.abs(c.x) > SIDELINE) { c.x = clamp(c.x, -SIDELINE - 0.5, SIDELINE + 0.5); sim.oob = true; emit('oob'); endPlay('oob'); return; }
      if (sim.carrierDir === 1 && c.z >= 100 && c.side === 'off') return score('td');
      if (sim.carrierDir === -1 && c.z <= 0 && c.side === 'def') return score('td-def');
      if (c.z > 110.5 || c.z < -10.5) { endPlay('oob'); return; }
    }
    // a thrown ball sailing out of bounds
    const b = sim.ball;
    if (b.state === 'air' && !b.resolved && (Math.abs(b.x) > SIDELINE + 1.5 || b.z > 111)) { b.resolved = true; incomplete('oob'); }
  }

  function score(kind) {
    const c = sim.carrier;
    sim.celebrant = c; if (c) { c.celebrate = 0.01; c.anim = 'celebrate'; }
    emit('td', { p: c, kind });
    emit('slowmo', { dur: 0.9, scale: 0.35 });
    endPlay(kind);
  }

  // ---------------------------------------------------------------- kicks
  function kickStep(dt) {
    const k = sim.kick; if (!k || k.kicked || sim.phase !== 'live') return;
    const b = sim.ball;
    if (k.type === 'kickoff') {
      const kk = sim.off.find(p => p.role === 'K');
      if (Math.hypot(kk.x - b.x, kk.z - b.z) < 0.8 || sim.t > 1.6) launchKick(kk);
      return;
    }
    const kickerRole = k.type === 'punt' ? 'P' : 'K';
    const kicker = sim.off.find(p => p.role === kickerRole);
    if (k.type === 'punt' && b.state === 'held' && b.holder === kicker && sim.t > 1.25) launchKick(kicker);
    if ((k.type === 'fg' || k.type === 'xp') && b.state === 'held' && sim.t > 1.15) launchKick(kicker);
  }

  function launchKick(kicker) {
    const k = sim.kick, b = sim.ball; k.kicked = true; kicker.anim = 'kick'; kicker.animT = 0; kicker.kickT = 0.01;
    emit('kick', { type: k.type });
    b.state = 'kick'; b.holder = null; b.resolved = false; b.flightT = 0;
    const kp = (kicker.r.kpw || 70), ka = (kicker.r.kac || 70);
    if (k.type === 'fg' || k.type === 'xp') {
      b.x = sim.spotX; b.z = sim.los - 7; b.y = 0.3;
      const range = (48 + (kp - 60) * 0.42) * (0.62 + 0.48 * k.power); // yards the kick can carry
      const lateral = k.acc * 0.16 + gauss() * (1.1 - ka / 100) * 0.035; // radians
      const hs = 24; const T = range / hs;
      b.vx = Math.sin(lateral) * hs; b.vz = Math.cos(lateral) * hs; b.vy = 0.5 * G * T; // lands after "range" yards
      k.range = range; k.distance = 110 - b.z;
    } else if (k.type === 'punt') {
      const range = (50 + (kp - 60) * 0.34) * (0.62 + 0.45 * k.power);
      const lateral = k.acc * 0.35 + gauss() * 0.08; const hang = 3.2 + k.power * 1.4;
      const hs = range / hang; b.vx = Math.sin(lateral) * hs; b.vz = Math.cos(lateral) * hs; b.vy = 0.5 * G * hang; b.y = 1.2;
      k.land = { x: b.x + b.vx * hang, z: b.z + b.vz * hang }; stat(kicker, 'punt'); stat(kicker, 'puntYds', Math.round(k.land.z - sim.los));
    } else { // kickoff
      const range = (58 + (kp - 60) * 0.32) * (0.7 + 0.35 * k.power); const hang = 3.6 + k.power * 0.7;
      const hs = range / hang; const lateral = k.acc * 0.25; b.vx = Math.sin(lateral) * hs; b.vz = Math.cos(lateral) * hs; b.vy = 0.5 * G * hang; b.y = 0.3;
      k.land = { x: b.x + b.vx * hang, z: b.z + b.vz * hang };
    }
    k.hang = (2 * b.vy) / G;
  }

  function kickFlight() {
    const k = sim.kick, b = sim.ball;
    if (k.type === 'fg' || k.type === 'xp') {
      if (!b.resolved && b.z >= 110) {
        b.resolved = true;
        const good = Math.abs(b.x) <= 3.08 && b.y >= 3.33;
        k.good = good; emit(good ? 'fgGood' : 'fgMiss', { type: k.type, why: b.y < 3.33 ? 'short' : (b.x < 0 ? 'wide left' : 'wide right') });
        sim.phase === 'live' && setTimeout(() => {}, 0);
        endPlay(good ? 'fg-good' : 'fg-miss');
      }
      if (!b.resolved && b.y <= 0.2 && b.flightT > 0.3) { b.resolved = true; k.good = false; emit('fgMiss', { type: k.type, why: 'short' }); endPlay('fg-miss'); }
      if (b.y <= 0.15) { b.y = 0.15; b.vx *= 0.3; b.vz *= 0.3; b.vy = Math.abs(b.vy) * 0.3; if (Math.abs(b.vy) < 0.6) b.state = 'dead'; }
      return;
    }
    // punts & kickoffs: returner fields it
    const kr = sim.def.find(p => p.role === 'KR');
    if (!b.resolved && b.vy < 0 && b.y < 2.2 && kr && Math.hypot(kr.x - b.x, kr.z - b.z) < 1.4) {
      b.resolved = true;
      const inEZ = b.z >= 100;
      const gunner = sim.off.some(p => !p.down && dist(p, kr) < 5.5);
      if (inEZ && (k.type === 'kickoff' ? rnd() < 0.7 : true)) { sim.carrier = kr; giveBall(kr, 'kick'); kr.down = 1.5; kr.anim = 'kneel'; endPlay('touchback'); return; }
      giveBall(kr, 'kick'); emit('catch', { p: kr, kick: true });
      if (k.type === 'punt' && gunner && !inEZ) { kr.anim = 'run'; endPlay('fair-catch'); emit('banner', { text: 'FAIR CATCH', sub: '' }); return; }
      return;
    }
    if (b.y <= 0.15) {
      b.y = 0.15; b.vy = Math.abs(b.vy) * 0.35; b.vx *= 0.55; b.vz *= 0.55;
      if (!b.resolved) {
        b.resolved = true;
        if (b.z >= 100 || Math.abs(b.x) > SIDELINE) { endPlay(b.z >= 100 ? 'touchback' : 'kick-oob'); return; }
        // bounces then is downed by the kicking team
        b.state = 'loose'; b.looseT = -1.2; sim.fumbleSide = 'none';
      }
    }
  }

  // ---------------------------------------------------------------- end of play
  function endPlay(reason) {
    if (sim.phase !== 'live') return;
    sim.phase = 'dead'; sim.deadT = 0; sim.reason = reason;
    const c = sim.carrier;
    let endZ = sim.los, endX = sim.spotX;
    const b = sim.ball;
    if (['tackle', 'sack', 'oob', 'dive', 'td', 'td-def', 'kneel', 'recovery', 'fair-catch', 'timeout-safety', 'touchback'].includes(reason) && c) { endZ = c.z; endX = c.x; }
    if (reason === 'fumble-oob' || reason === 'fumble-dead') { endZ = b.z; endX = b.x; }
    if (reason === 'kick-oob' || reason === 'downed' || (reason === 'touchback' && !c)) { endZ = b.z; endX = b.x; }
    if (reason === 'incomplete' || reason === 'spike') { endZ = sim.los; endX = sim.spotX; }
    const poss = (reason === 'downed' || reason === 'kick-oob' || (reason === 'touchback' && sim.kick)) ? 'def' : c ? c.side : (reason === 'fumble-oob' || reason === 'fumble-dead' ? (sim.fumbleSide === 'def' ? 'def' : 'off') : 'off');
    let kind = reason;
    // the ball carrier's rushing stats
    if (sim.cfg.kind === 'scrim' && c && sim.passer == null && !sim.ball.intercepted && c.side === 'off' && sim.carrierDir === 1 && reason !== 'kneel') {
      const isSack = reason === 'sack';
      if (!isSack) { stat(c, 'rushAtt'); stat(c, 'rushYds', Math.round(Math.min(endZ, 100) - sim.los)); if (reason === 'td') stat(c, 'rushTD'); }
      else stat(c, 'sackTaken');
    }
    if (sim.passer && sim.receiver && sim.receiver.side === 'off') {
      const y = Math.round(Math.min(endZ, 100) - sim.los);
      if (sim.carrierDir === 1 || !sim.ball.intercepted) { stat(sim.passer, 'passYds', y); stat(sim.receiver, 'recYds', y); if (reason === 'td' && c === sim.receiver) { stat(sim.passer, 'passTD'); stat(sim.receiver, 'recTD'); } }
    }
    if (reason === 'td-def' && c) stat(c, 'defTD');
    if (sim.kick && sim.kick.type !== 'fg' && sim.kick.type !== 'xp' && c && c.role === 'KR') stat(c, 'retYds', Math.round((sim.kick.land ? sim.kick.land.z : endZ) - endZ));
    sim.result = {
      reason: kind, endZ, endX, poss, gain: endZ - sim.los, oob: !!sim.oob || reason === 'oob' || reason === 'kick-oob',
      intercepted: !!sim.ball.intercepted, possChangeZ: sim.possChangeZ, kick: sim.kick, flags: sim.flags.slice(), stats: sim.stats.slice(),
      thrown: sim.thrown, run: sim.handedOff || (c && c.role === 'QB' && !sim.thrown), duration: sim.t, airYards: sim.airYards, events: sim.log.slice(),
    };
    emit('whistle', { reason });
  }

  // ---------------------------------------------------------------- replay
  function record(dt) {
    sim.recT += dt; if (sim.recT < 1 / 30) return; sim.recT = 0;
    if (sim.rec.length > 30 * 30) return;
    sim.rec.push({ t: sim.t, ph: sim.phase, b: [sim.ball.x, sim.ball.y, sim.ball.z, sim.ball.spin, sim.ball.state === 'air' || sim.ball.state === 'kick' ? 1 : 0], p: sim.all.map(p => [p.x, p.z, p.heading, p.speed, p.phase, p.anim, p.animT, p.down > 0 ? 1 : 0, p.celebrate, p.fallDir || 0, p.throwT, p.reach]) });
  }

  sim.setup = setup; sim.snap = snap; sim.step = function (dt) { step(dt); if (sim.phase === 'live') kickStep(dt); };
  sim.actions = actions; sim.throwBall = throwBall; sim.handoff = handoff; sim.pitchTo = pitchTo; sim.giveBall = giveBall; sim.setUser = setUser;
  sim.tackled = tackled; sim.endPlay = endPlay; sim.emit = emit; sim.dist = dist; sim.norm = norm; sim.ELIGIBLE = ELIGIBLE; sim.SIDELINE = SIDELINE; sim.stat = stat;
  sim.drainEvents = function () { const e = sim.events; sim.events = []; return e; };
  GS.Sim = sim;
})(window.GS);
