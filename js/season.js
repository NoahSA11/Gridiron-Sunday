/* =========================================================================
   GS.Season — a short season: 6 weeks, every team plays every week,
   league standings by division, and a 4-team playoff (semis + title game).
   CPU-vs-CPU games are simulated from team offense/defense ratings.
   Saved to localStorage so a season survives reloads.
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const KEY = 'gs.season.v1', WEEKS = 6;
  let S = null;
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function create(userAbbr) {
    const T = GS.Data.teams, me = GS.Data.byAbbr[userAbbr];
    const div = T.filter(t => t.conf === me.conf && t.div === me.div && t !== me).map(t => t.abbr);
    const others = shuffle(T.filter(t => t !== me && !div.includes(t.abbr)).map(t => t.abbr)).slice(0, WEEKS - div.length);
    const opps = shuffle(div.concat(others));
    const weeks = [];
    for (let w = 0; w < WEEKS; w++) {
      const opp = opps[w]; const pool = shuffle(T.map(t => t.abbr).filter(a => a !== userAbbr && a !== opp));
      const games = [w % 2 ? { home: userAbbr, away: opp } : { home: opp, away: userAbbr }];
      for (let i = 0; i < pool.length; i += 2) games.push(Math.random() < 0.5 ? { home: pool[i], away: pool[i + 1] } : { home: pool[i + 1], away: pool[i] });
      weeks.push(games);
    }
    const table = {}; T.forEach(t => table[t.abbr] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
    S = { user: userAbbr, week: 0, weeks, table, results: [], playoff: null, champion: null, created: Date.now() };
    save(); return S;
  }
  function load() { try { S = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { S = null; } return S; }
  function save() { if (S) lsSet(KEY, JSON.stringify(S)); }
  function clear() { S = null; try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  function simScore(home, away) {
    const H = GS.Data.byAbbr[home], A = GS.Data.byAbbr[away];
    const drive = (off, def, hfa) => { let pts = 0; for (let i = 0; i < 11; i++) { const edge = (off.off - def.def) * 0.012 + hfa; const r = Math.random(); if (r < 0.2 + edge) pts += 7; else if (r < 0.36 + edge) pts += 3; } return pts; };
    let h = drive(H, A, 0.015), a = drive(A, H, 0);
    if (h === a && Math.random() < 0.85) { if (Math.random() < 0.5) h += 3; else a += 3; }
    return { h, a };
  }
  function record(home, away, hs, as) {
    const th = S.table[home], ta = S.table[away];
    th.pf += hs; th.pa += as; ta.pf += as; ta.pa += hs;
    if (hs > as) { th.w++; ta.l++; } else if (as > hs) { ta.w++; th.l++; } else { th.t++; ta.t++; }
  }
  function userGame() {
    if (!S) return null;
    if (S.playoff) { const g = S.playoff.games.find(g => (g.home === S.user || g.away === S.user) && g.hs == null); return g ? Object.assign({ playoff: S.playoff.round }, g) : null; }
    if (S.week >= WEEKS) return null;
    return S.weeks[S.week][0];
  }
  function pct(r) { const g = r.w + r.l + r.t; return g ? (r.w + r.t * 0.5) / g : 0; }
  function ranked() { return Object.keys(S.table).sort((a, b) => pct(S.table[b]) - pct(S.table[a]) || (S.table[b].pf - S.table[b].pa) - (S.table[a].pf - S.table[a].pa)); }

  function finishUserGame(hs, as) {
    const g = userGame(); if (!g) return;
    if (S.playoff) {
      const pg = S.playoff.games.find(x => x.home === g.home && x.away === g.away);
      if (hs === as) hs += 3; // playoff games can't tie
      pg.hs = hs; pg.as = as; advancePlayoff(); save(); return;
    }
    record(g.home, g.away, hs, as);
    S.results.push({ week: S.week, home: g.home, away: g.away, hs, as });
    for (const x of S.weeks[S.week].slice(1)) { const r = simScore(x.home, x.away); record(x.home, x.away, r.h, r.a); x.hs = r.h; x.as = r.a; }
    S.weeks[S.week][0].hs = hs; S.weeks[S.week][0].as = as;
    S.week++;
    if (S.week >= WEEKS) startPlayoff();
    save();
  }
  function startPlayoff() {
    const r = ranked().slice(0, 4);
    S.playoff = { round: 'Semifinal', seeds: r, games: [{ home: r[0], away: r[3] }, { home: r[1], away: r[2] }] };
    if (!r.includes(S.user)) simPlayoffRest();
  }
  function advancePlayoff() {
    const P = S.playoff;
    // sim any CPU games of the round
    for (const g of P.games) if (g.hs == null && g.home !== S.user && g.away !== S.user) { const r = simScore(g.home, g.away); g.hs = r.h; g.as = r.a === r.h ? r.a + 3 : r.a; }
    if (P.games.some(g => g.hs == null)) return;
    const winners = P.games.map(g => g.hs > g.as ? g.home : g.away);
    if (P.round === 'Semifinal') { P.semis = P.games; P.round = 'Title Game'; P.games = [{ home: winners[0], away: winners[1] }]; if (!winners.includes(S.user)) simPlayoffRest(); }
    else { S.champion = winners[0]; P.final = P.games[0]; P.round = 'Done'; }
  }
  function simPlayoffRest() { let guard = 0; while (S.playoff.round !== 'Done' && guard++ < 4) { for (const g of S.playoff.games) if (g.hs == null) { const r = simScore(g.home, g.away); g.hs = r.h; g.as = r.a === r.h ? r.a + 3 : r.a; } advancePlayoff(); } save(); }

  GS.Season = { create, load, save, clear, userGame, finishUserGame, ranked, pct, WEEKS, get S() { return S; } };
})(window.GS);
