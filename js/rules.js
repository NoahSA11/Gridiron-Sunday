/* =========================================================================
   GS.Rules — the game of football around each play:
   possession, down & distance, game clock (runoff, stoppages, timeouts,
   two-minute warning), scoring, PATs & two-point tries, kickoffs, punts,
   field goals, penalties, halftime, overtime, box-score stats.
   All spots are in the offense frame: yards from the offense's own goal.
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const rnd = Math.random;
  const other = s => (s === 'home' ? 'away' : 'home');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function teamStats() { return { first: 0, plays: 0, yds: 0, pass: 0, rush: 0, to: 0, pen: 0, penYds: 0, top: 0, third: 0, thirdConv: 0, sacks: 0, comp: 0, att: 0 }; }

  function newGame(home, away, opts) {
    const G = {
      home, away, user: opts.user || null, diff: opts.diff, qLen: opts.qLen * 60, season: opts.season || null,
      score: { home: 0, away: 0 }, qScores: { home: [0, 0, 0, 0, 0], away: [0, 0, 0, 0, 0] },
      quarter: 1, clock: opts.qLen * 60, timeouts: { home: 3, away: 3 },
      poss: 'away', ballOn: 35, spotX: 0, down: 1, togo: 10, next: 'kickoff', kicking: 'home',
      clockRunning: false, twoMinDone: { 2: false, 4: false }, firstReceiver: 'away',
      ot: null, over: false, winner: null, log: [], stats: { home: teamStats(), away: teamStats() }, players: {},
      drive: null, patTwo: false, lastPlay: null, halftimeShown: false, pendingQuarterEnd: false,
    };
    // coin toss: road team receives
    G.poss = 'home'; G.kicking = 'home'; G.firstReceiver = 'away';
    return G;
  }

  const teamOf = (G, side) => G[side];
  function situation(G) {
    const off = G.next === 'kickoff' ? G.kicking : G.poss;
    return { kind: G.next, offSide: off, defSide: other(off), off: G[off], def: G[other(off)], down: G.down, togo: G.togo, ballOn: G.ballOn, spotX: G.spotX, quarter: G.quarter, clock: G.clock,
      goal: G.ballOn + G.togo >= 100, scoreDiff: G.score[off] - G.score[other(off)], timeouts: G.timeouts, defTimeouts: G.timeouts[other(off)] };
  }

  function addPlayerStats(G, list) {
    for (const s of list) {
      const key = s.team + '|' + s.name;
      const p = G.players[key] || (G.players[key] = { team: s.team, name: s.name, num: s.num, pos: s.pos });
      p[s.key] = (p[s.key] || 0) + s.v;
    }
  }

  function fmtSpot(G, ballOn, offSide) {
    if (ballOn === 50) return 'the 50';
    const own = ballOn < 50; const t = own ? G[offSide] : G[other(offSide)];
    return t.abbr + ' ' + Math.round(own ? ballOn : 100 - ballOn);
  }
  function shortName(n) { const p = (n || '').split(' '); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : n; }

  // ------------------------------------------------ clock
  function runoff(G, secs) {
    if (!G.clockRunning || G.next !== 'scrim' || G.patTwo) return 0;
    const before = G.clock; G.clock = Math.max(0, G.clock - secs); twoMinute(G, before); return before - G.clock;
  }
  function twoMinute(G, before) {
    if (G.qLen < 240) return false;
    if ((G.quarter === 2 || G.quarter === 4) && !G.twoMinDone[G.quarter] && before > 120 && G.clock <= 120) { G.clock = 120; G.twoMinDone[G.quarter] = true; G.clockRunning = false; G.twoMinFlag = true; return true; }
    return false;
  }
  function tickLive(G, dt, untimed) { if (untimed || G.over) return; const before = G.clock; G.clock = Math.max(0, G.clock - dt); twoMinute(G, before); G.stats[G.poss].top += dt; }
  function callTimeout(G, side) { if (G.timeouts[side] <= 0) return false; G.timeouts[side]--; G.clockRunning = false; return true; }

  // ------------------------------------------------ pre-snap penalties
  function preSnapPenalty(G) {
    if (G.next !== 'scrim' || G.patTwo) return null;
    const r = rnd();
    if (r < 0.014) { return { type: 'False Start', on: 'off', yds: 5 }; }
    if (r < 0.026) { return { type: 'Offside', on: 'def', yds: 5 }; }
    return null;
  }
  function applyPenalty(G, pen) {
    const offSide = G.poss, side = pen.on === 'off' ? offSide : other(offSide);
    G.stats[side].pen++; G.stats[side].penYds += pen.yds;
    if (pen.on === 'off') { const y = Math.min(pen.yds, Math.floor(G.ballOn / 2)); G.ballOn -= y; G.togo += y; }
    else { const y = Math.min(pen.yds, Math.floor((100 - G.ballOn) / 2)); G.ballOn += y; G.togo -= y; if (G.togo <= 0 || pen.auto) { G.down = 1; G.togo = Math.min(10, 100 - G.ballOn); } }
    G.clockRunning = false;
    return `${pen.type}, ${pen.on === 'off' ? G[offSide].name : G[other(offSide)].name}. ${pen.yds} yards`;
  }

  // ------------------------------------------------ result handling
  // returns {text, banner, sub, score:{side,pts,type}, turnover, firstDown, bigPlay, clockStops}
  function apply(G, res, ctx) {
    // ctx: {kind, offSide, offPlay, defPlay, los}
    addPlayerStats(G, res.stats);
    const offSide = ctx.offSide, defSide = other(offSide), off = G[offSide], def = G[defSide];
    const out = { text: '', banner: null, sub: '', score: null, turnover: false, firstDown: false, big: false, clockStops: false };
    const st = G.stats[offSide];
    const evs = res.events;
    const find = t => evs.find(e => e.type === t);
    const playerName = e => e && e.p && e.p.info ? shortName(e.p.info.name) : 'Ball carrier';
    G.lastPlay = res;
    // ---------- kickoff
    if (ctx.kind === 'kickoff') {
      out.clockStops = true; // kickoff sets possession; clock starts on the next snap
      if (res.reason === 'td-def') { scoreTD(G, defSide, out, 'Kick return touchdown!'); return finishDrive(G, out); }
      G.poss = defSide; startDrive(G);
      if (res.poss === 'off') { G.poss = offSide; G.ballOn = clamp(res.endZ, 1, 99); out.turnover = true; out.banner = 'ONSIDE / FUMBLE'; out.text = off.name + ' recover the kick'; setFirst(G); return out; }
      if (res.reason === 'touchback') { G.ballOn = 35; out.text = 'Touchback. ' + def.name + ' start at their 35'; }
      else if (res.reason === 'kick-oob') { G.ballOn = 40; out.text = 'Kickoff out of bounds. Ball at the 40'; }
      else { G.ballOn = clamp(100 - res.endZ, 1, 99); const ret = Math.round(res.endZ < 100 ? (res.kick.land ? res.kick.land.z : 100) - res.endZ : 0); out.text = `Kick returned ${Math.max(0, ret)} yards to ${fmtSpot(G, G.ballOn, defSide)}`; if (ret > 35) { out.big = true; out.banner = 'BIG RETURN'; } }
      G.spotX = clamp(res.endX || 0, -3.08, 3.08);
      setFirst(G); otPossession(G);
      return out;
    }
    // ---------- punt
    if (ctx.kind === 'punt') {
      out.clockStops = true; st.plays++;
      const land = res.kick && res.kick.land ? Math.round(res.kick.land.z - ctx.los) : 0;
      if (res.reason === 'td-def') { scoreTD(G, defSide, out, 'Punt return touchdown!'); return finishDrive(G, out); }
      if (res.poss === 'off' && res.reason !== 'touchback') { G.ballOn = clamp(res.endZ, 1, 99); out.text = 'Muffed punt! ' + off.name + ' recover'; out.turnover = true; setFirst(G); return out; }
      G.poss = defSide; out.turnover = false; endDrive(G, 'Punt');
      if (res.reason === 'touchback') { G.ballOn = 20; out.text = `Punt ${land} yards into the end zone. Touchback`; }
      else { G.ballOn = clamp(100 - res.endZ, 1, 99); out.text = res.reason === 'fair-catch' ? `Punt ${land} yards, fair catch at ${fmtSpot(G, G.ballOn, defSide)}` : `Punt ${land} yards, returned to ${fmtSpot(G, G.ballOn, defSide)}`; }
      G.spotX = 0; setFirst(G); startDrive(G); otPossession(G);
      return out;
    }
    // ---------- field goal / extra point
    if (ctx.kind === 'fg' || ctx.kind === 'xp') {
      out.clockStops = true; const dist = Math.round(100 - ctx.los + 17);
      const kicker = G[offSide].starters.K[0]; const kname = kicker ? shortName(kicker.name) : 'Kicker';
      if (ctx.kind === 'xp') {
        if (res.reason === 'fg-good') { addScore(G, offSide, 1); out.text = kname + ' extra point is good'; out.score = { side: offSide, pts: 1, type: 'XP' }; }
        else { out.text = kname + ' extra point is no good'; out.banner = 'NO GOOD'; }
        G.next = 'kickoff'; G.kicking = offSide; G.ballOn = 35; checkOTEnd(G); return out;
      }
      st.plays++;
      if (res.reason === 'fg-good') {
        addScore(G, offSide, 3); out.text = `${kname} ${dist}-yard field goal is GOOD`; out.banner = 'IT’S GOOD!'; out.sub = dist + ' YARDS'; out.score = { side: offSide, pts: 3, type: 'FG' };
        addPlayerStats(G, [{ team: off.abbr, name: kicker ? kicker.name : 'K', num: kicker ? kicker.num : 0, pos: 'K', key: 'fgm', v: 1 }, { team: off.abbr, name: kicker ? kicker.name : 'K', num: 0, pos: 'K', key: 'fga', v: 1 }]);
        endDrive(G, 'FG'); G.next = 'kickoff'; G.kicking = offSide; G.ballOn = 35; checkOTEnd(G);
      } else {
        out.text = `${kname} ${dist}-yard attempt is NO GOOD`; out.banner = 'NO GOOD'; out.sub = (res.events.find(e => e.type === 'fgMiss') || {}).why || '';
        addPlayerStats(G, [{ team: off.abbr, name: kicker ? kicker.name : 'K', num: 0, pos: 'K', key: 'fga', v: 1 }]);
        endDrive(G, 'Missed FG'); G.poss = defSide; G.ballOn = Math.max(20, 100 - (ctx.los - 7)); G.spotX = 0; setFirst(G); startDrive(G); otPossession(G);
      }
      return out;
    }
    // ---------- scrimmage play
    st.plays++;
    const los = ctx.los, play = ctx.offPlay;
    const firstLine = los + G.togo;
    const wasThird = G.down === 3;
    let gain = Math.round((Math.min(res.endZ, 100) - los));
    const cat = find('catch'), sack = find('sack'), intE = find('int'), fum = find('fumble'), thr = find('throw');
    const qbName = (() => { const q = G[offSide].starters.QB[0]; return q ? shortName(q.name) : 'QB'; })();
    // text
    if (res.reason === 'kneel') out.text = qbName + ' takes a knee';
    else if (res.reason === 'spike') out.text = qbName + ' spikes the ball to stop the clock';
    else if (sack) out.text = `${qbName} sacked by ${playerName({ p: sack.d })} for ${gain} yards`;
    else if (intE) out.text = `${qbName} pass INTERCEPTED by ${playerName(intE)}`;
    else if (res.reason === 'incomplete') { const ev = find('breakup'); out.text = `${qbName} pass incomplete${thr && thr.target && thr.target.info ? ' intended for ' + shortName(thr.target.info.name) : ''}${ev ? ', broken up by ' + playerName(ev) : ''}`; }
    else if (cat) out.text = `${qbName} pass complete to ${playerName(cat)} for ${gain} yard${Math.abs(gain) === 1 ? '' : 's'}`;
    else { const c = res.events.find(e => e.type === 'hit'); const carrier = c && c.p && c.p.info ? shortName(c.p.info.name) : (play.carrier === 'QB' ? qbName : 'Runner'); out.text = `${res.reason === 'td' ? 'Touchdown run by ' + carrier : carrier + ' runs for ' + gain + ' yard' + (Math.abs(gain) === 1 ? '' : 's')}`; }
    if (fum && !intE) out.text += res.poss === 'def' ? ' — FUMBLE, recovered by ' + def.name : ' — fumble, recovered by ' + off.name;
    if (res.oob) out.text += ', out of bounds';

    // two-point try
    if (G.patTwo) {
      G.patTwo = false;
      if (res.reason === 'td') { addScore(G, offSide, 2); out.banner = 'TWO-POINT GOOD'; out.score = { side: offSide, pts: 2, type: '2PT' }; out.text = 'Two-point conversion is good'; }
      else { out.text = 'Two-point try fails'; out.banner = 'NO GOOD'; }
      G.next = 'kickoff'; G.kicking = offSide; G.ballOn = 35; checkOTEnd(G); out.clockStops = true; return out;
    }

    // offensive holding on runs/completions that gained yards
    let holding = null;
    if (res.reason !== 'td' && res.poss === 'off' && gain > 4 && rnd() < 0.035) holding = { type: 'Holding', on: 'off', yds: 10 };
    const dpi = (res.flags || []).find(f => f.type === 'DPI');
    if (holding) {
      const y = Math.min(10, Math.floor(los / 2)); G.ballOn = los - y; G.togo += y; G.stats[offSide].pen++; G.stats[offSide].penYds += y;
      out.text = 'FLAG: Holding, ' + off.name + '. 10 yards, replay the down'; out.banner = 'FLAG'; out.sub = 'HOLDING • OFFENSE'; out.clockStops = true; out.flag = true; G.clockRunning = false;
      return out;
    }
    if (dpi && res.reason === 'incomplete') {
      const spot = clamp(Math.round(dpi.spot), los + 1, 99); G.ballOn = Math.min(spot, 99); G.down = 1; G.togo = Math.min(10, 100 - G.ballOn);
      G.stats[defSide].pen++; G.stats[defSide].penYds += spot - los;
      out.text = 'FLAG: Pass interference, ' + def.name + '. Automatic first down at ' + fmtSpot(G, G.ballOn, offSide); out.banner = 'FLAG'; out.sub = 'PASS INTERFERENCE • DEFENSE'; out.clockStops = true; out.flag = true; G.clockRunning = false;
      st.first++;
      return out;
    }

    // team yardage
    if (res.poss === 'off' || intE || (fum && res.poss === 'def')) {
      const yds = intE ? 0 : gain;
      if (!intE && res.reason !== 'incomplete') { st.yds += yds; if (cat) st.pass += yds; else if (!sack) st.rush += yds; }
    }
    if (thr) { st.att++; if (cat) st.comp++; }
    if (sack) { st.sacks++; st.pass += gain; st.yds += 0; }
    if (wasThird) st.third++;

    if (res.reason === 'td') { scoreTD(G, offSide, out, gain >= 1 ? `${gain}-yard touchdown` : 'Touchdown'); if (wasThird) st.thirdConv++; out.big = true; return finishDrive(G, out); }
    if (res.reason === 'td-def') { G.stats[offSide].to++; scoreTD(G, defSide, out, intE ? 'Pick six!' : 'Defensive touchdown!'); out.turnover = true; return finishDrive(G, out); }

    // turnover by INT / fumble
    if (res.poss === 'def') {
      G.stats[offSide].to++; out.turnover = true; out.clockStops = true;
      const z = res.endZ;
      endDrive(G, intE ? 'INT' : 'Fumble');
      G.poss = defSide;
      if (z >= 100) { G.ballOn = 20; out.text += '. Touchback'; }
      else G.ballOn = clamp(100 - z, 1, 99);
      G.spotX = clamp(res.endX || 0, -3.08, 3.08); setFirst(G); startDrive(G); otPossession(G);
      out.banner = out.banner || (intE ? 'INTERCEPTION' : 'TURNOVER'); out.big = true;
      return out;
    }
    // safety
    if (res.endZ <= 0 && res.poss === 'off' && res.reason !== 'incomplete') {
      addScore(G, defSide, 2); out.banner = 'SAFETY'; out.score = { side: defSide, pts: 2, type: 'SAF' }; out.text += '. SAFETY'; out.clockStops = true;
      endDrive(G, 'Safety'); G.next = 'kickoff'; G.kicking = offSide; G.ballOn = 20; checkOTEnd(G); return out;
    }
    // normal progress
    const newSpot = res.reason === 'incomplete' || res.reason === 'spike' ? los : clamp(res.endZ, 0.5, 99.5);
    G.ballOn = Math.round(newSpot * 2) / 2; G.spotX = clamp(res.endX || 0, -3.08, 3.08);
    if (res.reason === 'incomplete' || res.reason === 'spike') G.spotX = clamp(ctx.spotX, -3.08, 3.08);
    if (G.ballOn >= firstLine) {
      G.down = 1; G.togo = Math.min(10, 100 - Math.round(G.ballOn)); st.first++; out.firstDown = true; if (wasThird) st.thirdConv++;
      if (gain >= 20) { out.big = true; out.banner = 'BIG PLAY'; out.sub = gain + ' YARDS'; } else if (!out.banner) out.banner = 'FIRST DOWN';
    } else {
      G.down++; G.togo = Math.max(1, Math.round(firstLine - G.ballOn));
      if (G.down > 4) {
        out.text += '. Turnover on downs'; out.banner = 'TURNOVER ON DOWNS'; out.turnover = true; out.clockStops = true;
        endDrive(G, 'Downs'); G.poss = defSide; G.ballOn = clamp(100 - G.ballOn, 1, 99); setFirst(G); startDrive(G); otPossession(G);
        return out;
      }
    }
    if (sack) out.banner = 'SACK';
    if (gain >= 20 && !out.banner) { out.big = true; out.banner = 'BIG PLAY'; }
    out.clockStops = res.reason === 'incomplete' || res.reason === 'spike' || res.oob;
    G.clockRunning = !out.clockStops;
    return out;
  }

  function setFirst(G) { G.down = 1; G.togo = Math.min(10, 100 - Math.round(G.ballOn)); G.next = 'scrim'; G.clockRunning = false; }
  function addScore(G, side, pts) { G.score[side] += pts; G.qScores[side][Math.min(G.quarter, 5) - 1] += pts; }
  function scoreTD(G, side, out, text) {
    addScore(G, side, 6); out.score = { side, pts: 6, type: 'TD' }; out.banner = 'TOUCHDOWN'; out.sub = G[side].name.toUpperCase(); out.text = text; out.clockStops = true;
    G.poss = side; G.next = 'pat'; G.ballOn = 85; G.spotX = 0; G.clockRunning = false;
    // OT: a touchdown on the opening possession no longer ends it (both teams possess),
    // but a score by the second team / sudden death does — PAT is skipped when decisive
    checkOTEnd(G);
  }
  function finishDrive(G, out) { endDrive(G, out.score ? out.score.type : ''); return out; }
  function startDrive(G) { G.drive = { side: G.poss, start: G.ballOn, plays: 0, clock: G.clock, q: G.quarter }; }
  function endDrive() { }

  // overtime (modern rule): both teams get a possession, then sudden death.
  // The game ends as soon as one team leads and the trailing team has
  // completed at least one possession.
  function otPossession(G) { if (!G.ot) return; const prev = other(G.poss); if (G.ot.started) G.ot.done[prev]++; G.ot.started = true; checkOTEnd(G); }
  function checkOTEnd(G) {
    if (!G.ot || G.over) return false;
    const d = G.score.home - G.score.away; if (!d) return false;
    const trailing = d > 0 ? 'away' : 'home';
    if (G.ot.done[trailing] >= 1) { G.over = true; G.next = 'final'; return true; }
    return false;
  }

  // called when the ball is dead and the clock is at 0
  function endOfQuarter(G) {
    if (G.clock > 0 || G.next === 'pat' || G.over) return null;
    const q = G.quarter;
    if (q === 2) {
      G.quarter = 3; G.clock = G.qLen; G.timeouts = { home: 3, away: 3 }; G.next = 'kickoff'; G.kicking = G.firstReceiver; G.ballOn = 35; G.clockRunning = false;
      return 'half';
    }
    if (q === 4 || q === 5) {
      if (G.score.home !== G.score.away || q === 5) { G.over = true; G.next = 'final'; return 'final'; }
      // overtime: 10-minute period (scaled to the chosen quarter length), coin toss to home
      G.quarter = 5; G.clock = Math.max(120, Math.round(G.qLen * 0.75)); G.timeouts = { home: 2, away: 2 }; G.next = 'kickoff'; G.kicking = 'away'; G.ballOn = 35; G.clockRunning = false;
      G.ot = { done: { home: 0, away: 0 }, started: false };
      return 'ot';
    }
    G.quarter++; G.clock = G.qLen; G.clockRunning = false;
    return 'quarter';
  }

  function winner(G) { return G.score.home > G.score.away ? 'home' : G.score.away > G.score.home ? 'away' : null; }

  GS.Rules = { newGame, situation, runoff, tickLive, callTimeout, preSnapPenalty, applyPenalty, apply, endOfQuarter, winner, fmtSpot, shortName, other };
})(window.GS);
