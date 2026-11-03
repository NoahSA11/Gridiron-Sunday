/* =========================================================================
   GS.Data — teams, roster loading, caching and rating derivation
   -------------------------------------------------------------------------
   ROSTER SOURCE
     nflverse roster feed (open data, refreshed daily upstream):
     github.com/nflverse/nflverse-data/releases/download/rosters/roster_<yr>.csv
     The nflverse CSV can't be fetched cross-origin from a browser, so it is
     converted by tools/build_rosters.py into ./rosters.json, which is served
     next to this page and rebuilt daily (GitHub Actions: .github/workflows/deploy.yml).
     Load order:  ./rosters.json (live feed)  ->  localStorage cache  ->
                  bundled js/rosters-snapshot.js (always present).
     Players can also load an nflverse roster CSV by hand (Settings).

   RATING FORMULA (all ratings 40-99)
     Q  (quality core) = 58
                       + pedigree   : draft pick p>0 -> max(0, 13 - 0.05*p) ; undrafted 0
                       + experience : min(yearsExp, 6) * 1.5
                       - decline    : max(0, age - peakAge(pos)) * 1.7
                       + jitter     : stable hash of the name, -3..+3
     Each attribute    = Q + positionTemplate[attr] + bodyAdjust[attr]
       bodyAdjust: speed/accel/agility  -0.12 per lb over the position's
                   average weight; strength +0.2 per lb over; catching
                   +0.8 per inch over the position's average height (WR/TE).
     OVR               = weighted mean of the attributes that matter for
                         the position (weights in POS_OVR below).
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';

  // abbr, city, name, primary, secondary, conference, division
  const TEAM_TABLE = [
    ['ARI', 'Arizona', 'Cardinals', '#97233F', '#FFB612', 'NFC', 'West'],
    ['ATL', 'Atlanta', 'Falcons', '#A71930', '#101820', 'NFC', 'South'],
    ['BAL', 'Baltimore', 'Ravens', '#241773', '#9E7C0C', 'AFC', 'North'],
    ['BUF', 'Buffalo', 'Bills', '#00338D', '#C60C30', 'AFC', 'East'],
    ['CAR', 'Carolina', 'Panthers', '#0085CA', '#101820', 'NFC', 'South'],
    ['CHI', 'Chicago', 'Bears', '#0B162A', '#C83803', 'NFC', 'North'],
    ['CIN', 'Cincinnati', 'Bengals', '#FB4F14', '#101820', 'AFC', 'North'],
    ['CLE', 'Cleveland', 'Browns', '#311D00', '#FF3C00', 'AFC', 'North'],
    ['DAL', 'Dallas', 'Cowboys', '#003594', '#869397', 'NFC', 'East'],
    ['DEN', 'Denver', 'Broncos', '#FB4F14', '#002244', 'AFC', 'West'],
    ['DET', 'Detroit', 'Lions', '#0076B6', '#B0B7BC', 'NFC', 'North'],
    ['GB', 'Green Bay', 'Packers', '#203731', '#FFB612', 'NFC', 'North'],
    ['HOU', 'Houston', 'Texans', '#03202F', '#A71930', 'AFC', 'South'],
    ['IND', 'Indianapolis', 'Colts', '#002C5F', '#A2AAAD', 'AFC', 'South'],
    ['JAX', 'Jacksonville', 'Jaguars', '#006778', '#D7A22A', 'AFC', 'South'],
    ['KC', 'Kansas City', 'Chiefs', '#E31837', '#FFB81C', 'AFC', 'West'],
    ['LA', 'Los Angeles', 'Rams', '#003594', '#FFA300', 'NFC', 'West'],
    ['LAC', 'Los Angeles', 'Chargers', '#0080C6', '#FFC20E', 'AFC', 'West'],
    ['LV', 'Las Vegas', 'Raiders', '#1B1B1B', '#A5ACAF', 'AFC', 'West'],
    ['MIA', 'Miami', 'Dolphins', '#008E97', '#FC4C02', 'AFC', 'East'],
    ['MIN', 'Minnesota', 'Vikings', '#4F2683', '#FFC62F', 'NFC', 'North'],
    ['NE', 'New England', 'Patriots', '#002244', '#C60C30', 'AFC', 'East'],
    ['NO', 'New Orleans', 'Saints', '#D3BC8D', '#101820', 'NFC', 'South'],
    ['NYG', 'New York', 'Giants', '#0B2265', '#A71930', 'NFC', 'East'],
    ['NYJ', 'New York', 'Jets', '#125740', '#FFFFFF', 'AFC', 'East'],
    ['PHI', 'Philadelphia', 'Eagles', '#004C54', '#A5ACAF', 'NFC', 'East'],
    ['PIT', 'Pittsburgh', 'Steelers', '#FFB612', '#101820', 'AFC', 'North'],
    ['SEA', 'Seattle', 'Seahawks', '#002244', '#69BE28', 'NFC', 'West'],
    ['SF', 'San Francisco', '49ers', '#AA0000', '#B3995D', 'NFC', 'West'],
    ['TB', 'Tampa Bay', 'Buccaneers', '#D50A0A', '#34302B', 'NFC', 'South'],
    ['TEN', 'Tennessee', 'Titans', '#0C2340', '#4B92DB', 'AFC', 'South'],
    ['WAS', 'Washington', 'Commanders', '#5A1414', '#FFB612', 'NFC', 'East'],
  ];

  const CACHE_KEY = 'gs.rosters.v1';
  const FEED_URL = 'rosters.json';
  const MAX_AGE_MS = 24 * 3600 * 1000;

  // ---------------- rating model ----------------
  // position template offsets from Q
  const T = {
    QB: { spd: -14, acc: -8, agi: -6, str: -12, awr: 4, thp: 6, tha: 4, cth: -30, car: -10, blk: -40, tak: -45, cov: -45, prs: -45 },
    RB: { spd: 8, acc: 9, agi: 9, str: -4, awr: -2, thp: -40, tha: -40, cth: -6, car: 8, blk: -16, tak: -40, cov: -40, prs: -40 },
    WR: { spd: 11, acc: 8, agi: 8, str: -14, awr: -2, thp: -40, tha: -40, cth: 8, car: -6, blk: -25, tak: -40, cov: -30, prs: -45 },
    TE: { spd: -2, acc: -1, agi: -4, str: 4, awr: -1, thp: -40, tha: -40, cth: 2, car: 0, blk: 3, tak: -35, cov: -35, prs: -35 },
    OL: { spd: -26, acc: -14, agi: -18, str: 12, awr: 0, thp: -50, tha: -50, cth: -40, car: -30, blk: 10, tak: -30, cov: -50, prs: -30 },
    DL: { spd: -16, acc: -6, agi: -12, str: 12, awr: -2, thp: -50, tha: -50, cth: -40, car: -30, blk: -10, tak: 4, cov: -40, prs: 8 },
    LB: { spd: -3, acc: 1, agi: -2, str: 2, awr: 1, thp: -50, tha: -50, cth: -20, car: -20, blk: -20, tak: 8, cov: -4, prs: 0 },
    DB: { spd: 9, acc: 8, agi: 9, str: -14, awr: 0, thp: -50, tha: -50, cth: -8, car: -20, blk: -30, tak: -2, cov: 8, prs: -20 },
    K: { spd: -25, acc: -20, agi: -20, str: -25, awr: 0, thp: -50, tha: -50, cth: -40, car: -40, blk: -50, tak: -40, cov: -50, prs: -50 },
  };
  const AVG = { QB: [75, 222], RB: [70.5, 212], WR: [72.5, 200], TE: [76.5, 250], OL: [77, 312], DL: [75.5, 290], LB: [74, 240], DB: [71.5, 198], K: [73, 205] };
  const PEAK = { QB: 34, RB: 27, WR: 29, TE: 30, OL: 31, DL: 30, LB: 29, DB: 29, K: 37 };
  const POS_OVR = {
    QB: { tha: 4, thp: 2.5, awr: 2.5, spd: 0.6, agi: 0.4 },
    RB: { spd: 3, acc: 2, agi: 2, car: 2.5, cth: 0.8, str: 0.7 },
    WR: { spd: 3, cth: 3, agi: 1.5, acc: 1.5, awr: 0.8 },
    TE: { cth: 2.5, blk: 2, str: 1, spd: 1.4, awr: 0.8 },
    OL: { blk: 4, str: 3, awr: 1.2, acc: 0.6 },
    DL: { prs: 3.5, str: 3, tak: 1.5, acc: 1 },
    LB: { tak: 3, awr: 1.5, spd: 1.5, cov: 1.2, prs: 1, str: 0.8 },
    DB: { cov: 3.5, spd: 3, agi: 1.5, tak: 1, cth: 0.8, awr: 1 },
    K: { kpw: 3, kac: 3 },
  };
  function group(pos, dpos) {
    const d = dpos || pos;
    if (d === 'QB') return 'QB';
    if (d === 'RB' || d === 'FB' || pos === 'RB') return 'RB';
    if (d === 'WR') return 'WR';
    if (d === 'TE') return 'TE';
    if (['T', 'G', 'C', 'OT', 'OG', 'OL'].includes(d) || pos === 'OL') return 'OL';
    if (['DE', 'DT', 'NT', 'DL'].includes(d) || pos === 'DL') return 'DL';
    if (['OLB', 'ILB', 'MLB', 'LB'].includes(d) || pos === 'LB') return 'LB';
    if (['CB', 'FS', 'SS', 'S', 'DB'].includes(d) || pos === 'DB') return 'DB';
    if (d === 'K' || d === 'P' || d === 'LS') return 'K';
    return 'LB';
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function rate(row) {
    const [name, pos, dpos, num, age, ht, wt, exp, pick] = row;
    const g = group(pos, dpos);
    const h = hash(name);
    const jitter = ((h % 7) - 3);
    const ped = pick > 0 ? Math.max(0, 13 - 0.05 * pick) : 0;
    const Q = 58 + ped + Math.min(exp, 6) * 1.5 - Math.max(0, age - PEAK[g]) * 1.7 + jitter;
    const t = T[g], avg = AVG[g];
    const dw = wt - avg[1], dh = ht - avg[0];
    const r = {};
    for (const k in t) r[k] = Q + t[k];
    r.spd -= dw * 0.12; r.acc -= dw * 0.1; r.agi -= dw * 0.12; r.str += dw * 0.2;
    if (g === 'WR' || g === 'TE') r.cth += dh * 0.8;
    // second hash for per-attribute variety (stable)
    let h2 = h;
    for (const k in r) { h2 = Math.imul(h2 ^ (h2 >>> 13), 1274126177) >>> 0; r[k] = Math.round(clamp(r[k] + ((h2 % 7) - 3), 40, 99)); }
    r.kpw = Math.round(clamp(g === 'K' ? Q + 14 + (h % 9) - 4 : 40, 40, 99));
    r.kac = Math.round(clamp(g === 'K' ? Q + 12 + ((h >> 4) % 9) - 4 : 40, 40, 99));
    const w = POS_OVR[g]; let s = 0, tw = 0;
    for (const k in w) { s += r[k] * w[k]; tw += w[k]; }
    r.ovr = Math.round(clamp(s / tw, 40, 99));
    const parts = name.split(' ');
    const last = parts.length > 1 ? parts.slice(1).join(' ') : name;
    return { name, last, pos, dpos: dpos || pos, group: g, num, age, ht, wt, exp, pick, r };
  }

  // ---------------- teams ----------------
  const teams = TEAM_TABLE.map(([abbr, city, name, c1, c2, conf, div]) => ({ abbr, city, name, c1, c2, conf, div, roster: [], starters: null, ovr: 60 }));
  const byAbbr = {}; teams.forEach(t => byAbbr[t.abbr] = t);

  function pickStarters(t) {
    const R = t.roster.slice().sort((a, b) => b.r.ovr - a.r.ovr);
    const used = new Set();
    const take = (pred, n) => { const out = []; for (const p of R) { if (out.length >= n) break; if (!used.has(p) && pred(p)) { used.add(p); out.push(p); } } return out; };
    const fill = (arr, n, pred) => { while (arr.length < n) { const x = take(pred, 1)[0] || take(() => true, 1)[0]; if (!x) break; arr.push(x); } return arr; };
    const S = {};
    S.QB = fill(take(p => p.dpos === 'QB', 2), 2, p => p.group === 'QB');
    S.RB = fill(take(p => p.dpos === 'RB', 2), 2, p => p.group === 'RB');
    S.WR = fill(take(p => p.dpos === 'WR', 4), 4, p => p.group === 'WR' || p.group === 'TE');
    S.TE = fill(take(p => p.dpos === 'TE', 1), 1, p => p.group === 'TE');
    const T_ = take(p => p.dpos === 'T', 2), G_ = take(p => p.dpos === 'G', 2), C_ = take(p => p.dpos === 'C', 1);
    S.OL = fill([T_[0], G_[0], C_[0], G_[1], T_[1]].filter(Boolean), 5, p => p.group === 'OL');
    S.DL = fill(take(p => p.dpos === 'DE' || p.dpos === 'DT' || p.dpos === 'NT', 4), 4, p => p.group === 'DL' || p.dpos === 'OLB');
    S.LB = fill(take(p => p.group === 'LB', 3), 3, p => p.group === 'LB' || p.group === 'DL');
    S.CB = fill(take(p => p.dpos === 'CB', 3), 3, p => p.group === 'DB');
    S.S = fill(take(p => p.dpos === 'FS' || p.dpos === 'SS', 2), 2, p => p.group === 'DB');
    S.K = fill(take(p => p.dpos === 'K', 1), 1, p => p.group === 'K');
    S.P = fill(take(p => p.dpos === 'P', 1), 1, p => p.group === 'K');
    t.starters = S;
    const core = [S.QB[0], S.QB[0], S.RB[0], ...S.WR.slice(0, 3), S.TE[0], ...S.OL, ...S.DL, ...S.LB, ...S.CB.slice(0, 2), ...S.S].filter(Boolean);
    t.ovr = Math.round(core.reduce((a, p) => a + p.r.ovr, 0) / Math.max(1, core.length));
    t.off = Math.round([S.QB[0], S.QB[0], S.RB[0], ...S.WR.slice(0, 3), S.TE[0], ...S.OL].filter(Boolean).reduce((a, p) => a + p.r.ovr, 0) / 12);
    t.def = Math.round([...S.DL, ...S.LB, ...S.CB.slice(0, 2), ...S.S].filter(Boolean).reduce((a, p) => a + p.r.ovr, 0) / 11);
  }

  // placeholder generator in case a feed is missing a team
  function synthRoster(abbr) {
    const spec = [['QB', 'QB', 2], ['RB', 'RB', 2], ['WR', 'WR', 5], ['TE', 'TE', 2], ['OL', 'T', 3], ['OL', 'G', 3], ['OL', 'C', 1], ['DL', 'DE', 3], ['DL', 'DT', 3], ['LB', 'OLB', 3], ['LB', 'ILB', 2], ['DB', 'CB', 4], ['DB', 'FS', 1], ['DB', 'SS', 1], ['K', 'K', 1], ['P', 'P', 1]];
    const rows = []; let n = 1;
    for (const [pos, dpos, c] of spec) for (let i = 0; i < c; i++) rows.push([abbr + ' ' + dpos + (i + 1), pos, dpos, n++, 26, 74, 240, 3, 120]);
    return rows;
  }

  function apply(data) {
    for (const t of teams) {
      const rows = (data.teams && data.teams[t.abbr]) || synthRoster(t.abbr);
      t.roster = rows.map(rate);
      pickStarters(t);
    }
  }

  // ---------------- loading / caching ----------------
  const state = { data: null, kind: 'snapshot', fetchedAt: 0, error: null, listeners: [] };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function valid(d) { return d && d.teams && Object.keys(d.teams).length >= 30 && d.updated; }

  function use(data, kind, fetchedAt) {
    state.data = data; state.kind = kind; state.fetchedAt = fetchedAt == null ? Date.now() : fetchedAt;
    apply(data);
    state.listeners.forEach(f => f(info()));
  }

  function info() {
    const d = state.data || {};
    return { kind: state.kind, updated: d.updated, season: d.season, week: d.week, fetchedAt: state.fetchedAt, source: d.source, error: state.error,
      players: d.teams ? Object.values(d.teams).reduce((a, v) => a + v.length, 0) : 0 };
  }

  async function fetchFeed() {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const to = setTimeout(() => ctl && ctl.abort(), 8000);
    try {
      const res = await fetch(FEED_URL, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      if (!valid(d)) throw new Error('feed incomplete');
      return d;
    } finally { clearTimeout(to); }
  }

  async function refresh(force) {
    state.error = null;
    try {
      const d = await fetchFeed();
      const now = Date.now();
      lsSet(CACHE_KEY, JSON.stringify({ fetchedAt: now, data: d }));
      use(d, 'live', now);
      return true;
    } catch (e) {
      state.error = (e && e.message) || 'unreachable';
      if (state.kind === 'cache-stale') state.kind = 'cache';
      state.listeners.forEach(f => f(info()));
      return false;
    }
  }

  function init() {
    // 1) cache, 2) bundled snapshot — synchronous so the game always starts
    let cached = null;
    try { cached = JSON.parse(lsGet(CACHE_KEY) || 'null'); } catch (e) { cached = null; }
    const snap = window.ROSTER_SNAPSHOT;
    if (cached && valid(cached.data) && (!snap || cached.data.updated >= snap.updated)) {
      use(cached.data, 'cache', cached.fetchedAt);
    } else if (snap && valid(snap)) {
      use(snap, 'snapshot', 0);
    } else {
      use({ teams: {}, updated: '1970-01-01T00:00:00Z', source: 'generated placeholders' }, 'placeholder', 0);
    }
    // 3) refresh when older than 24h
    if (!state.fetchedAt || Date.now() - state.fetchedAt > MAX_AGE_MS) refresh(false);
  }

  // nflverse CSV loaded by hand
  function parseCSV(text) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function loadCSV(text) {
    const rows = parseCSV(text); const H = rows.shift(); const ix = k => H.indexOf(k);
    const need = ['team', 'full_name', 'position', 'status'];
    if (need.some(k => ix(k) < 0)) throw new Error('Not an nflverse roster CSV');
    const now = new Date(); const teamsOut = {}; let season = 0, week = 0;
    for (const r of rows) {
      if (r.length < H.length || r[ix('status')] !== 'ACT') continue;
      const b = r[ix('birth_date')] || ''; let age = 26;
      if (/^\d{4}-\d\d-\d\d/.test(b)) { const [y, m, d] = b.split('-').map(Number); age = now.getFullYear() - y - ((now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) ? 1 : 0); }
      const n = k => parseInt(r[ix(k)], 10) || 0;
      season = n('season') || season; week = Math.max(week, n('week'));
      (teamsOut[r[ix('team')]] = teamsOut[r[ix('team')]] || []).push([r[ix('full_name')], r[ix('position')], r[ix('depth_chart_position')] || r[ix('position')], n('jersey_number'), age, n('height') || 73, n('weight') || 230, n('years_exp'), n('draft_number')]);
    }
    const d = { source: 'nflverse roster CSV (loaded from file)', season, week, updated: new Date().toISOString(), teams: teamsOut };
    if (!valid(d)) throw new Error('File has fewer than 30 teams');
    lsSet(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data: d }));
    use(d, 'file', Date.now());
  }

  GS.Data = {
    teams, byAbbr, init, refresh, info, loadCSV, rate,
    onChange(f) { state.listeners.push(f); },
    hexToInt: h => parseInt(h.replace('#', ''), 16),
    // pick the CPU opponent's alternate jersey if colors are too close
    colorDist(a, b) { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); const dr = (x >> 16) - (y >> 16), dg = ((x >> 8) & 255) - ((y >> 8) & 255), db = (x & 255) - (y & 255); return Math.sqrt(dr * dr + dg * dg + db * db); },
  };
})(window.GS);
