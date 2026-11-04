/* =========================================================================
   GS.AI — every decision that isn't the user's:
     team(): QB progression / handoffs / pitch timing, blocking assignments,
             defensive play recognition, user "most open" highlight
     think(): per-player desired velocity (routes, protection, rush, man,
             zone, pursuit, ball-carrier vision, kick coverage & returns)
     callOffense() / callDefense(): CPU play-calling that reads the situation
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const rnd = Math.random, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const norm = (x, z) => { const n = Math.hypot(x, z) || 1; return { x: x / n, z: z / n }; };
  function seek(p, tx, tz, frac, arrive) {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    let sp = p.maxSpeed * (frac == null ? 1 : frac);
    if (arrive && d < arrive) sp *= d / arrive;
    if (d < 0.05) { p.desired.x = 0; p.desired.z = 0; return; }
    p.desired.x = dx / d * sp; p.desired.z = dz / d * sp;
  }

  let blockTimer = 0;
  function team(sim, dt) {
    const cfg = sim.cfg, diff = cfg.diff;
    blockTimer -= dt;
    if (blockTimer <= 0) { blockTimer = 0.15; assignBlocks(sim); }
    // defensive recognition of run vs pass (reaction scales with awareness + difficulty)
    if (!sim.playKnown && cfg.kind === 'scrim') {
      const react = (cfg.userSide === 'def' ? 0.55 : 0.55 * diff.cpuReact);
      if (sim.handedOff && sim.t > react) sim.playKnown = 'run';
      else if (sim.thrown) sim.playKnown = 'pass';
      else if (sim.carrier && sim.carrier.role === 'QB' && sim.carrier.z > sim.los + 0.5) sim.playKnown = 'run';
    }
    if (cfg.kind !== 'scrim') return;
    const qb = sim.off.find(p => p.role === 'QB');
    const play = cfg.offPlay;
    if (sim.ball.holder !== qb || sim.thrown) return;
    // user QB: compute the most-open highlight
    if (qb.user && !qb.assist) { if (!sim.hlT || sim.t - sim.hlT > 0.25) { sim.hlT = sim.t; const best = bestTarget(sim, qb); if (best && !sim.lockedHighlight) sim.highlight = best.p; } }
    // run plays: handoff / pitch timing (also when the user is QB)
    if (play.type === 'run' && !sim.handedOff) {
      const car = sim.off.find(p => p.role === play.carrier);
      if (car === qb) { sim.handedOff = true; sim.passAllowed = false; sim.carrier = qb; return; }
      if (play.toss) { if (sim.t > 0.35) sim.pitchTo(qb, car); return; }
      if (sim.t > (play.delay || 0.4) && dist(qb, car) < 2.0) { sim.handoff(qb, car); return; }
      if (sim.t > (play.delay || 0) + 1.1) { sim.handoff(qb, car); return; }
      return;
    }
    if (qb.user && !qb.assist) return;
    // CPU (or idle-assisted) quarterback progression
    if (play.type === 'kneel' || play.type === 'spike') return;
    const drop = play.drop || 5;
    const ready = play.boot ? 1.3 : ({ 3: 0.95, 5: 1.55, 7: 2.0 }[drop] || 1.5) + (play.type === 'pa' ? 0.35 : 0) + (sim.readJitter || (sim.readJitter = Math.random() * 0.5));
    if (play.type === 'screen') { const rb = sim.off.find(p => p.role === 'RB'); if (sim.t > 1.35) { if (!sim.throwBall(qb, rb, { lob: 1 })) sim.throwBall(qb, rb, {}); } if (sim.t < 2.2) return; }
    if (sim.t < ready) return;
    if (!sim.qbT || sim.t - sim.qbT > 0.2) {
      sim.qbT = sim.t;
      const best = bestTarget(sim, qb);
      const pressure = sim.def.some(d => !d.engaged && !d.down && dist(d, qb) < 2.0);
      const late = sim.t - ready;
      const need = 2.8 - late * 1.0 - (pressure ? 1.1 : 0);
      if (best && best.score > need) { sim.throwBall(qb, best.p, { lob: best.depth > 22 ? 1 : 0 }); return; }
      if (late > 3.4) { const fake = { x: Math.sign(qb.x || 1) * 30, z: qb.z + 12, vx: 0, vz: 0 }; sim.throwBall(qb, fake, {}); sim.ball.intended = null; return; }
      if (late > 2.6 || (pressure && late > 1.2)) {
        // throw it away or tuck and run
        if (best && best.score > -0.6) { sim.throwBall(qb, best.p, {}); return; }
        if (rnd() < 0.5 && qb.r.spd > 70) { qb.scramble = true; }
        else if (Math.abs(qb.x) > 6 || rnd() < 0.5) { // throwaway
          const fake = { x: Math.sign(qb.x || 1) * 30, z: qb.z + 12, vx: 0, vz: 0 }; sim.throwBall(qb, fake, {}); sim.ball.intended = null; return;
        }
      }
    }
  }

  function bestTarget(sim, qb) {
    let best = null;
    for (const r of sim.off) {
      if (!sim.ELIGIBLE.includes(r.role) || r.passBlock || r.down || !r.route) continue;
      const speed = 19; let px = r.x, pz = r.z, T = 0;
      for (let i = 0; i < 3; i++) { T = Math.hypot(px - qb.x, pz - qb.z) / speed; const st = r.settle && r.routeIdx >= r.route.length; px = r.x + (st ? 0 : r.vx) * T; pz = r.z + (st ? 0 : r.vz) * T; }
      let open = 99;
      for (const d of sim.def) { if (d.down || d.engaged) continue; const dd = Math.hypot(d.x - px, d.z - pz) - T * 0.35 * d.maxSpeed * 0.5; if (dd < open) open = dd; }
      const depth = pz - sim.los;
      // throwing lane: defenders between QB and target
      let lane = 0; const n = norm(px - qb.x, pz - qb.z), L = Math.hypot(px - qb.x, pz - qb.z);
      for (const d of sim.def) { if (d.down) continue; const rx = d.x - qb.x, rz = d.z - qb.z, al = rx * n.x + rz * n.z; if (al < 2 || al > L - 1.5) continue; const perp = Math.abs(rx * n.z - rz * n.x); if (perp < 1.1) lane += (1.1 - perp) * 1.5; }
      const togo = sim.cfg.togo || 10;
      let score = Math.min(open, 6) - lane + Math.min(depth, 25) * 0.03 + (depth >= togo ? 0.6 : 0) - (depth < 0 ? 1 : 0);
      if (Math.abs(px) > 26) score -= 3;
      r.openScore = open - lane; // shown on the user's receiver icons
      if (!best || score > best.score) best = { p: r, score, depth, open };
    }
    return best;
  }

  function assignBlocks(sim) {
    const cfg = sim.cfg, kind = cfg.kind;
    const ret = kind === 'punt' || kind === 'kickoff';
    if (ret) {
      // return team blocks the nearest coverage man once the ball is in the air
      const cov = sim.off.filter(p => !p.down);
      for (const p of sim.def) { if (p.role === 'KR' || sim.carrier === p) { p.blockTarget = null; continue; } if (!sim.kick.kicked) { p.blockTarget = null; continue; } let best = null, bd = 99; for (const c of cov) { const d = dist(p, c); if (d < bd) { bd = d; best = c; } } p.blockTarget = best; }
      // after the return team gains the ball, kicking team stops blocking
      for (const p of sim.off) p.blockTarget = null;
      if (kind === 'punt' && !sim.kick.kicked) for (const p of sim.off) if (!p.cover || p.role === 'RB') { p.blockTarget = nearestDef(sim, p, 3); }
      return;
    }
    const carrier = sim.carrier;
    const blockers = sim.off.filter(p => ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.role) || p.passBlock || ((sim.handedOff || sim.thrown && carrier) && p !== carrier && p.role !== 'QB'));
    if (carrier && carrier.side === 'def') { for (const p of sim.off) p.blockTarget = null; for (const p of sim.def) if (p !== carrier) p.blockTarget = nearestOpp(sim, p, sim.off, 12); return; }
    for (const p of sim.def) p.blockTarget = null;
    const taken = new Map();
    for (const b of blockers) {
      if (b.engaged) continue;
      let best = null, bs = 1e9;
      for (const d of sim.def) {
        if (d.down || (d.engaged && d.engaged !== b)) continue;
        const rushing = d.assign === 'rush' || d.assign === 'blitz' || d.assign === 'run' || sim.playKnown === 'run';
        if (!rushing && !(sim.handedOff || (carrier && carrier !== sim.off.find(q => q.role === 'QB')))) continue;
        let s = dist(b, d) + (taken.get(d) || 0) * 3.5;
        if (d.z < b.z - 1.5 && !carrier) s += 4; // already beaten
        if (carrier && carrier !== b) { const lead = dist(d, carrier); s += lead * 0.35; if (!['LT', 'LG', 'C', 'RG', 'RT'].includes(b.role) && (dist(b, d) > 4 || lead > 10)) continue; }
        if (s < bs) { bs = s; best = d; }
      }
      if (best && bs < 9) { b.blockTarget = best; taken.set(best, (taken.get(best) || 0) + 1); } else b.blockTarget = null;
    }
  }
  function nearestDef(sim, p, max) { let best = null, bd = max; for (const d of sim.def) { const dd = dist(p, d); if (!d.down && dd < bd) { bd = dd; best = d; } } return best; }
  function nearestOpp(sim, p, pool, max) { let best = null, bd = max; for (const d of pool) { const dd = dist(p, d); if (!d.down && dd < bd) { bd = dd; best = d; } } return best; }

  // ---------------------------------------------------------------- per player
  function think(sim, p, dt) {
    p.face = null; p.burst = false;
    const k = sim.cfg.kind;
    // a quarterback who can still throw stays a passer (pocket logic in offenseAI), not a runner
    const passer = p.role === 'QB' && sim.passAllowed && !sim.thrown && !p.scramble && p.z < sim.los + 0.3 && sim.cfg.kind === 'scrim';
    if (sim.carrier === p && sim.ball.holder === p && !passer) return carrierAI(sim, p, dt);
    if (sim.ball.state === 'loose' && dist(p, sim.ball) < 9) { seek(p, sim.ball.x, sim.ball.z, 1); return; }
    if (k === 'kickoff' || k === 'punt') return kickAI(sim, p, dt);
    if (k === 'fg' || k === 'xp') return fgAI(sim, p, dt);
    if (p.side === 'off') return offenseAI(sim, p, dt);
    return defenseAI(sim, p, dt);
  }

  function blockMove(sim, p) {
    const d = p.blockTarget;
    if (!d) return false;
    // get between the defender and the ball
    const ref = sim.carrier || sim.off.find(q => q.role === 'QB' || q.role === 'P') || sim.ball;
    const n = norm(ref.x - d.x, ref.z - d.z);
    const tx = d.x + n.x * 0.8, tz = d.z + n.z * 0.8;
    seek(p, tx, tz, 0.95, 1.2); p.face = d;
    return true;
  }

  function offenseAI(sim, p, dt) {
    const play = sim.cfg.offPlay, qb = sim.off.find(q => q.role === 'QB');
    // turnover: everybody becomes a tackler
    if (sim.carrier && sim.carrier.side === 'def') return pursue(sim, p, sim.carrier, 1);
    const ballAir = sim.ball.state === 'air' && !sim.ball.resolved;
    // QB
    if (p.role === 'QB') {
      if (sim.ball.holder !== p) { // after a throw / handoff
        if (play.type === 'pa' || play.type === 'run') { seek(p, p.x - Math.sign(p.x - sim.spotX || 1) * 2, p.z - 2, 0.5, 1); } else { p.desired.x *= 0.8; p.desired.z *= 0.8; }
        return;
      }
      if (sim.ball.state !== 'held') { p.desired.x = p.desired.z = 0; return; }
      if (p.kneelPlay || p.spikePlay) { p.desired.x = p.desired.z = 0; return; }
      if (play.type === 'run') { const car = sim.off.find(q => q.role === play.carrier); if (car !== p) { const m = play.path[0]; seek(p, sim.spotX + m[0] * 0.45, sim.los + Math.max(m[1], -4.5) * 0.7, 0.55, 1); p.face = car; return; } }
      if (p.scramble || (sim.carrier === p && p.z > sim.los + 0.3)) return carrierAI(sim, p, dt);
      const drop = play.drop || 5, under = play.form !== 'gun' && play.form !== 'trips' && play.form !== 'pistol';
      let tz = sim.los - (under ? { 3: 3.5, 5: 5.5, 7: 7.5 }[drop] : { 3: 6, 5: 7, 7: 8.5 }[drop]);
      let tx = sim.spotX;
      if (play.type === 'pa') { if (sim.t < 0.55) { seek(p, sim.spotX + 0.8, sim.los - 3, 0.6, 1); return; } if (play.boot) { tx = sim.spotX + 7; tz = sim.los - 5.5; } }
      // pocket presence: slide away from the nearest free rusher
      let ax = 0, az = 0;
      for (const d of sim.def) { if (d.engaged || d.down) continue; const dd = dist(d, p); if (dd < 3.2) { const n = norm(p.x - d.x, p.z - d.z); ax += n.x * (3.2 - dd); az += n.z * (3.2 - dd) * 0.5; } }
      if (sim.t > 0.6 && (ax || az)) { tx = p.x + ax * 2; tz = Math.min(p.z + az * 2 + 0.3, sim.los - 1); }
      seek(p, tx, tz, play.boot ? 0.95 : sim.t < 1 ? 0.8 : 0.55, 1.2); p.face = { x: p.x, z: p.z + 10 };
      return;
    }
    if (sim.carrier && sim.carrier !== p && sim.carrier.side === 'off' && sim.carrier !== qb) {
      // ball is out: block for the carrier
      if (blockMove(sim, p)) return;
      seek(p, sim.carrier.x + (p.x - sim.carrier.x) * 0.5, sim.carrier.z + 4, 0.8, 2); return;
    }
    // receiver tracking a thrown ball
    if (ballAir && sim.ball.intended === p) { const t = sim.ball.target; seek(p, t.x, t.z, 1, 0.6); p.reach = sim.ball.flightT > sim.ball.flightDur - 0.35 ? 1 : 0; return; }
    if (ballAir && sim.ELIGIBLE.includes(p.role)) { const t = sim.ball.target; if (dist(p, t) < 7) { seek(p, t.x, t.z, 0.9, 0.5); return; } }
    // linemen and blocking backs
    if (['LT', 'LG', 'C', 'RG', 'RT'].includes(p.role) || p.passBlock || (play.type === 'run' && p.role !== play.carrier)) {
      if (play.type === 'run' && p.role === play.lead && !p.blockTarget) { const path = play.path; seek(p, sim.spotX + path[1][0], sim.los + 2, 1); return; }
      if (play.type === 'screen' && ['LT', 'LG', 'C'].includes(p.role) && sim.t > 1.1) { const rb = sim.off.find(q => q.role === 'RB'); seek(p, rb.x + (p.role === 'C' ? 2 : -1), sim.los + 2, 0.8, 1); if (blockMove(sim, p)) return; return; }
      if (blockMove(sim, p)) return;
      const run = play.type === 'run';
      const set = run ? { x: p.home.x + (play.side || 0) * 1.2, z: sim.los + 1.5 } : { x: p.home.x * 1.08, z: sim.los - (['LT', 'RT'].includes(p.role) ? 2.6 : 1.6) };
      if (p.passBlock && !['LT', 'LG', 'C', 'RG', 'RT'].includes(p.role)) { set.x = qb.x + Math.sign(p.home.x - sim.spotX || 1) * 2; set.z = qb.z + 1.5; }
      seek(p, set.x, set.z, 0.6, 1.5); p.face = { x: p.x, z: p.z + 5 };
      return;
    }
    // run carrier before the handoff
    if (play.type === 'run' && p.role === play.carrier) {
      const path = play.path; const i = Math.min(p.routeIdx || 0, path.length - 1);
      const tx = sim.spotX + path[i][0], tz = sim.los + path[i][1];
      if (dist(p, { x: tx, z: tz }) < 1) p.routeIdx = (p.routeIdx || 0) + 1;
      seek(p, tx, tz, sim.t < (play.delay || 0) ? 0.1 : 0.85); return;
    }
    // route runners
    if (p.route) {
      if (play.type === 'pa' && p.role === 'RB' && sim.t < 0.8) { seek(p, sim.spotX + 0.8, sim.los - 3, 0.8); return; }
      const R = p.route;
      if (p.routeIdx < R.length) {
        const w = R[p.routeIdx]; seek(p, w.x, w.z, sim.t < 0.35 ? 0.55 : 0.97);
        if (dist(p, w) < 0.9) p.routeIdx++;
      } else if (p.settle) { seek(p, R[R.length - 1].x, R[R.length - 1].z, 0.4, 1); p.face = qb; }
      else { const a = R[R.length - 1], b = R.length > 1 ? R[R.length - 2] : p.home; const n = norm(a.x - b.x, a.z - b.z); let tx = p.x + n.x * 5, tz = p.z + n.z * 5; if (Math.abs(tx) > 25) tx = Math.sign(tx) * 25; seek(p, tx, tz, 0.95); }
      return;
    }
    p.desired.x *= 0.9; p.desired.z *= 0.9;
  }

  function defenseAI(sim, p, dt) {
    const diff = sim.cfg.diff, userIsDef = sim.cfg.userSide === 'def';
    const react = userIsDef ? 0.7 : diff.cpuReact;
    const qb = sim.off.find(q => q.role === 'QB');
    const car = sim.carrier;
    const b = sim.ball;
    // ball in the air: break on it after a reaction delay
    if (b.state === 'air' && !b.resolved && b.target) {
      const t = b.target, dd = dist(p, t);
      const delay = (0.32 + (90 - (p.r.awr || 60)) * 0.006) * react;
      // break on the ball, arriving goal-side of the catch point
      if (b.flightT > delay && dd < 13) { const gz = t.z + (dd > 3 ? 1.6 : 0.4); seek(p, t.x, gz, 1, 0.3); p.reach = b.flightT > b.flightDur - 0.35 ? 1 : 0; return; }
    }
    // pursue the carrier (once it is a run or a completion)
    const runKnown = sim.playKnown === 'run' || (car && car !== qb) || (car === qb && qb.z > sim.los + 0.5);
    if (car && car.side === 'off' && (runKnown || p.assign === 'rush' || p.assign === 'blitz' || p.assign === 'run')) {
      if (p.engaged) { seek(p, car.x, car.z, 0.5); return; }
      // man defenders stay with their man until the ball crosses the line
      if (p.manTarget && car === qb && !(sim.playKnown === 'run')) { manCover(sim, p, react); return; }
      if (p.zone && car === qb && sim.playKnown !== 'run') { zoneCover(sim, p, react); return; }
      return pursue(sim, p, car, react);
    }
    if (car && car.side === 'def') { // turnover: block for our carrier
      if (car !== p) { if (p.blockTarget) { const n = norm(car.x - p.blockTarget.x, car.z - p.blockTarget.z); seek(p, p.blockTarget.x + n.x, p.blockTarget.z + n.z, 1); } else seek(p, car.x + (p.x - car.x) * 0.4, car.z - 5, 0.8); }
      return;
    }
    if (p.assign === 'rush' || p.assign === 'blitz' || p.assign === 'run') {
      const tgt = car || qb;
      if (!tgt) return;
      // edge rushers contain: aim outside then turn the corner
      let ox = 0; if (p.role === 'LE') ox = -1.5; if (p.role === 'RE') ox = 1.5;
      const tx = tgt.x + (Math.abs(p.z - tgt.z) > 3 ? ox : 0), tz = tgt.z;
      seek(p, tx, tz, p.assign === 'blitz' ? 1 : 0.95);
      return;
    }
    if (p.manTarget) return manCover(sim, p, react);
    if (p.zone) return zoneCover(sim, p, react);
  }

  function manCover(sim, p, react) {
    const r = p.manTarget;
    if (!r || r.passBlock || r.down) { // man is blocking: help in the box / spy
      const qb = sim.off.find(q => q.role === 'QB'); seek(p, qb.x, Math.max(sim.los + 4, qb.z + 6), 0.6, 1); return;
    }
    const cov = (p.r.cov || 55);
    const lag = clamp(0.06 + (95 - cov) * 0.0075, 0.05, 0.5) * react;
    // lagged read of the receiver's velocity
    p.lagX += (r.vx - p.lagX) * Math.min(1, dt0 / lag); p.lagZ += (r.vz - p.lagZ) * Math.min(1, dt0 / lag);
    const depth = r.z - sim.los;
    const cushion = depth < 10 ? 1.0 : 1.6, inside = Math.sign(sim.spotX - r.x) * 0.5;
    const tx = r.x + p.lagX * 0.35 + inside, tz = r.z + p.lagZ * 0.35 + cushion;
    seek(p, tx, tz, 1, 0.7); p.face = r;
  }
  const dt0 = 1 / 60;

  function zoneCover(sim, p, react) {
    const z = p.zone; let tx = z.x, tz = z.z;
    // find the most threatening receiver in my area
    let threat = null, ts = -1e9;
    for (const r of sim.off) {
      if (!sim.ELIGIBLE.includes(r.role) || r.passBlock || !r.route) continue;
      const dx = r.x - z.x, dz = r.z - z.z, d = Math.hypot(dx * 0.8, dz);
      const rad = z.deep ? 11 : 7.5;
      if (d > rad) continue;
      const s = -d + (r.z - sim.los) * 0.15;
      if (s > ts) { ts = s; threat = r; }
    }
    if (threat && sim.t > 0.5 * react) {
      const w = z.deep ? 0.45 : 0.75;
      tx = z.x + (threat.x - z.x) * w; tz = z.z + (threat.z - z.z) * w;
      // deep defenders stay over the top, and carry vertical routes even before the throw
      if (z.deep) { tz = Math.max(tz, threat.z + 5); tx = z.x + (threat.x - z.x) * 0.75; } else tz = Math.max(tz, threat.z + 0.6);
      p.face = threat;
    } else p.face = sim.off.find(q => q.role === 'QB');
    seek(p, tx, tz, sim.t < 1.2 ? 0.95 : 0.85, 1.5);
  }

  function pursue(sim, p, car, react) {
    // angle of pursuit: aim at where the carrier will be
    // true intercept: solve |car + v t - p| = s t for the earliest t
    const rx = car.x - p.x, rz = car.z - p.z, sp = p.maxSpeed * 1.02;
    const A = car.vx * car.vx + car.vz * car.vz - sp * sp, B = 2 * (rx * car.vx + rz * car.vz), C = rx * rx + rz * rz;
    let T = 0;
    if (Math.abs(A) < 1e-6) T = B < 0 ? -C / B : 0; else { const disc = B * B - 4 * A * C; if (disc >= 0) { const r1 = (-B - Math.sqrt(disc)) / (2 * A), r2 = (-B + Math.sqrt(disc)) / (2 * A); T = Math.min(...[r1, r2].filter(v => v > 0), 4); if (!isFinite(T)) T = 0; } else T = 1.2; }
    T = clamp(T, 0, 3.5) * (react > 1 ? 0.8 : 1);
    let tx = car.x + car.vx * T, tz = car.z + car.vz * T;
    // shoestring dive when the runner is escaping just out of reach
    const d0 = Math.sqrt(C);
    if (d0 < 4) { p.burst = true; tx = car.x + car.vx * Math.min(T, 0.35); tz = car.z + car.vz * Math.min(T, 0.35); }
    if (!p.user && d0 > 1.0 && d0 < 2.5 && !p.dive && !p.down && sim.phase === 'live') {
      const closing = -(rx * (car.vx - p.vx) + rz * (car.vz - p.vz)) / (d0 || 1);
      if (closing < 1.2 && Math.random() < 0.09) sim.actions.dive(p);
    }
    // deep defenders keep leverage (stay goal-side)
    if (sim.carrierDir === 1 && tz < car.z && (p.role === 'FS' || p.role === 'SS')) tz = car.z + 0.5;
    seek(p, tx, tz, p.burst ? 1.12 : 1);
  }

  // ---------------------------------------------------------------- ball carrier
  function carrierAI(sim, p, dt) {
    const dir = p.side === 'off' ? 1 : -1;
    const play = sim.cfg.offPlay;
    // follow the designed run path until through the line
    if (p.side === 'off' && sim.cfg.kind === 'scrim' && play && play.type === 'run' && p.role === play.carrier && p.z < sim.los + 1.5) {
      const path = play.path; let i = Math.min(p.routeIdx || 0, path.length - 1);
      const tx = sim.spotX + path[i][0], tz = sim.los + path[i][1];
      if (dist(p, { x: tx, z: tz }) < 1.2 && i < path.length - 1) p.routeIdx = i + 1;
      // cut back if the hole is clogged
      const clog = sim.def.filter(d => !d.down && !d.engaged && Math.hypot(d.x - tx, d.z - tz) < 1.8).length;
      if (clog >= 2 && p.z > sim.los - 2) return openField(sim, p, dir, dt);
      seek(p, tx, tz, 1); return;
    }
    return openField(sim, p, dir, dt);
  }

  function openField(sim, p, dir, dt) {
    const opp = p.side === 'off' ? sim.def : sim.off;
    const base = 0; let best = null, bs = -1e9;
    const goalZ = dir === 1 ? 105 : -5;
    for (let a = -80; a <= 80; a += 16) {
      const r = (a * Math.PI) / 180; const ux = Math.sin(r) * dir, uz = Math.cos(r) * dir;
      let s = uz * dir * 1.0 - Math.abs(a) * 0.002;
      for (const d of opp) {
        if (d.down || d.engaged) continue;
        const rx = d.x - p.x, rz = d.z - p.z, al = rx * ux + rz * uz; if (al < -1.5) continue;
        const perp = Math.abs(rx * uz - rz * ux), dd = Math.hypot(rx, rz);
        s -= Math.exp(-(perp * perp) / 5) * 1.6 / (1 + Math.max(0, al) * 0.22) * (dd < 12 ? 1 : 0.4);
      }
      const fx = p.x + ux * 5; if (Math.abs(fx) > 24.5) s -= (Math.abs(fx) - 24.5) * 0.5;
      if (s > bs) { bs = s; best = { x: ux, z: uz }; }
    }
    if (!best) best = { x: 0, z: dir };
    // touchdown in sight: just go
    if (Math.abs(goalZ - p.z) < 6) best = norm(best.x * 0.3, dir);
    p.desired.x = best.x * p.maxSpeed; p.desired.z = best.z * p.maxSpeed;
    // CPU moves: juke/spin when a tackler closes in front
    if (!p.user || p.assist) {
      const diff = sim.cfg.diff; const skill = (p.r.agi || 60) / 100 * (p.side === sim.cfg.userSide ? 1 : diff.cpuMoves);
      for (const d of opp) {
        if (d.down || d.engaged) continue; const dd = dist(d, p); if (dd > 2.4 || dd < 1.2) continue;
        const ahead = ((d.x - p.x) * best.x + (d.z - p.z) * best.z) / dd > 0.5; if (!ahead || p.moveCD > 0) continue;
        if (rnd() < skill * dt * 1.6) { if (rnd() < 0.65) sim.actions.juke(p); else sim.actions.spin(p); }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- special teams
  function kickAI(sim, p, dt) {
    const k = sim.kick, b = sim.ball;
    if (p.side === 'off') { // kicking team
      if (p.role === 'K' && k.type === 'kickoff' && !k.kicked) { seek(p, b.x, b.z, 0.8); return; }
      if (k.type === 'kickoff' && !k.kicked) { // hold the line until the kick
        const kk = sim.off.find(q => q.role === 'K'); seek(p, p.home.x, Math.min(sim.los - 0.6, kk.z + 6), 0.5); return; }
      if (k.type === 'punt' && !k.kicked) {
        if (p.role === 'P') { seek(p, p.home.x, p.home.z, 0.3, 1); return; }
        if (p.role === 'X' || p.role === 'Z') { seek(p, p.x, p.z + 10, 1); return; }
        if (blockMove(sim, p)) return; seek(p, p.home.x, sim.los - 1.2, 0.4, 1); return;
      }
      if (p.role === 'P' || p.role === 'K') { seek(p, p.x, p.z + 3, 0.4, 2); return; }
      if (sim.carrier && sim.carrier.side === 'def') return pursue(sim, p, sim.carrier, 1);
      const land = k.land || { x: b.x, z: b.z };
      const lane = clamp(p.home.x * 0.45, -12, 12);
      seek(p, land.x + lane * clamp((land.z - p.z) / 25, 0, 1), land.z - 1, 1);
      return;
    }
    // receiving team
    if (p.role === 'KR') {
      if (!k.kicked) { if (k.type === 'punt') { seek(p, p.home.x, p.home.z, 0.3, 1); } return; }
      if (sim.carrier !== p) { const land = k.land || b; seek(p, land.x, land.z, 1, 0.8); p.face = b; return; }
    }
    if (sim.carrier && sim.carrier.side === 'def' && sim.carrier !== p) {
      if (p.blockTarget) { const c = sim.carrier, t = p.blockTarget, n = norm(c.x - t.x, c.z - t.z); seek(p, t.x + n.x * 0.8, t.z + n.z * 0.8, 1); return; }
      seek(p, sim.carrier.x + (p.home.x - sim.carrier.x) * 0.3, sim.carrier.z - 6, 0.9); return;
    }
    if (k.type === 'punt' && !k.kicked) { // rush lightly
      if (['LE', 'DT', 'NT', 'RE'].includes(p.role)) { const P = sim.off.find(q => q.role === 'P'); seek(p, P.x, P.z, 0.9); return; }
      if (p.role === 'LC' || p.role === 'RC') { const g = sim.off.find(q => q.role === (p.role === 'LC' ? 'X' : 'Z')); seek(p, g.x, g.z + 1, 1); return; }
      return;
    }
    if (k.kicked) { // drop back to form the wall
      const land = k.land || b; const wallZ = land.z - 14;
      if (p.blockTarget && dist(p, p.blockTarget) < 6) { blockMove2(p, p.blockTarget, land); return; }
      seek(p, clamp(p.home.x * 0.6, -15, 15), Math.max(wallZ, Math.min(p.z, land.z - 4)), 0.8, 2);
    }
  }
  function blockMove2(p, d, ref) { const n = norm(ref.x - d.x, ref.z - d.z); seek(p, d.x + n.x * 0.8, d.z + n.z * 0.8, 0.95, 1); p.face = d; }

  function fgAI(sim, p, dt) {
    if (p.side === 'off') {
      if (p.role === 'K') { if (sim.t > 0.75 && !sim.kick.kicked) seek(p, sim.spotX - 0.1, sim.los - 7.6, 0.45); else p.desired.x = p.desired.z = 0; return; }
      if (p.role === 'QB') { p.desired.x = p.desired.z = 0; p.anim = 'kneel'; return; }
      if (blockMove(sim, p)) return; seek(p, p.home.x, p.home.z - 0.4, 0.3, 1); return;
    }
    const tgt = { x: sim.spotX, z: sim.los - 7 };
    seek(p, tgt.x + (p.home.x - sim.spotX) * 0.3, tgt.z, 0.9);
  }

  // ---------------------------------------------------------------- play calling
  function callOffense(ctx) {
    // ctx: {down, togo, ballOn, quarter, clock, scoreDiff (for offense), qLen, kicker}
    const PB = GS.Playbook, { down, togo, ballOn, quarter, clock, scoreDiff } = ctx;
    const late = quarter >= 4 && clock < 150, half = quarter === 2 && clock < 40;
    if (down === 4) {
      const fgDist = 100 - ballOn + 17;
      const range = 52 + ((ctx.kicker ? ctx.kicker.r.kpw : 70) - 70) * 0.3;
      const mustGo = late && scoreDiff < 0 && (scoreDiff < -3 || fgDist > range);
      if (!mustGo) {
        if (fgDist <= range && !(late && scoreDiff < -3)) return PB.offById('fg');
        if (togo <= 1 && ballOn >= 45 && ballOn < 70 && rnd() < 0.35) return PB.offById('sneak');
        if (ballOn < 62 || togo > 3) return PB.offById('punt');
      }
    }
    if (half && ballOn > 55 && 100 - ballOn + 17 <= 52 && clock < 8) return PB.offById('fg');
    if (late && scoreDiff > 0 && clock < 110 && ctx.defTimeouts === 0) return PB.offById('kneel');
    const passes = PB.OFF.filter(p => p.type !== 'run'), runs = PB.OFF.filter(p => p.type === 'run');
    let passP = 0.55;
    if (togo >= 8) passP = 0.75; if (togo <= 2) passP = 0.3; if (down === 3 && togo > 4) passP = 0.88;
    if (late && scoreDiff < 0) passP = 0.9; if (late && scoreDiff > 0) passP = 0.2;
    if (ballOn > 95) passP = 0.4;
    if (rnd() < passP) {
      let pool = passes;
      if (togo >= 12) pool = passes.filter(p => ['verts', 'deeppost', 'comeback', 'curlflat', 'smash', 'wheel'].includes(p.id));
      else if (togo <= 5) pool = passes.filter(p => ['slants', 'stick', 'mesh', 'screen', 'curlflat'].includes(p.id));
      return pool[Math.floor(rnd() * pool.length)];
    }
    let pool = runs.filter(p => p.id !== 'sneak'); if (togo <= 1 && rnd() < 0.4) return PB.offById('sneak');
    return pool[Math.floor(rnd() * pool.length)];
  }

  function callDefense(ctx, userPlay, diff) {
    const PB = GS.Playbook, { down, togo, ballOn, quarter, clock, scoreDiff } = ctx; // scoreDiff for offense
    // reading the user's call (higher difficulties "read the play")
    if (userPlay && rnd() < diff.readPlay) {
      if (userPlay.type === 'run') return PB.defById(rnd() < 0.6 ? 'runstop' : 'c1');
      if (userPlay.drop === 7) return PB.defById(rnd() < 0.5 ? 'c4' : 'c3');
      if (userPlay.type === 'screen') return PB.defById('c2m');
      return PB.defById(['c2m', 'c1', 'robber'][Math.floor(rnd() * 3)]);
    }
    if (quarter >= 4 && clock < 120 && scoreDiff < 0 && togo > 6) return PB.defById(rnd() < 0.6 ? 'prevent' : 'c4');
    if (togo <= 2) return PB.defById(['runstop', 'c0', 'c1', 'nblitz'][Math.floor(rnd() * 4)]);
    if (ballOn > 90) return PB.defById(['runstop', 'c1', 'c0', 'c2m'][Math.floor(rnd() * 4)]);
    if (togo >= 9) return PB.defById(['c3', 'c4', 'c2', 'c6', 't2', 'fire', 'zblitz'][Math.floor(rnd() * 7)]);
    return PB.D[Math.floor(rnd() * PB.D.length)];
  }

  GS.AI = { team, think, callOffense, callDefense, bestTarget };
})(window.GS);
