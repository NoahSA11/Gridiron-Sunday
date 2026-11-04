/* =========================================================================
   GS.UI — every DOM screen and overlay: title, team select, settings,
   season hub, play-call, PAT choice, breaks, box score, HUD scorebug,
   banners, ticker, receiver badges, touch controls, kick meter, tutorial.
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const fmtClock = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ord = d => ['1st', '2nd', '3rd', '4th'][d - 1] || '4th';
  let screenEl, hudEl, bannerT = 0, flashT = 0, toastT = 0;
  const picks = { user: 'BUF', opp: 'KC', userHome: true };
  try { Object.assign(picks, JSON.parse(lsGet('gs.picks') || '{}')); } catch (e) { /* ignore */ }

  function helmet(c1, c2, size) {
    size = size || 56;
    return `<svg class="helm" viewBox="0 0 64 56" width="${size}" height="${size * 56 / 64}" aria-hidden="true"><path d="M8 34C6 17 19 4 35 4c14 0 24 10 24 24 0 5-1 9-3 12H34l-4 8H14c-4-3-6-8-6-14z" fill="${c1}" stroke="#0E1B2C" stroke-width="2.5"/><path d="M33 4.2c-9 1-16 8-18 17" stroke="${c2}" stroke-width="5" fill="none"/><path d="M46 38h14M44 44h14M48 33v15" stroke="#9BA3AD" stroke-width="3" stroke-linecap="round"/><circle cx="25" cy="31" r="3.5" fill="#0E1B2C" opacity=".55"/></svg>`;
  }

  // ------------------------------------------------ init
  function init() {
    screenEl = $('#screen'); hudEl = $('#hud');
    GS.Input.bindTouch($('#touch'));
    const bd = $('#badges');
    bd.addEventListener('pointerdown', e => {
      const b = e.target.closest('.badge'); if (!b) return; e.preventDefault(); e.stopPropagation();
      const i = +b.dataset.i; GS.Input.vibrate(12);
      if (GS.Game.state === 'presnap') { const r = GS.Game.receivers()[i - 1]; if (r) openHot('off', r.role); return; }
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      GS.Input.targetStart(i);
    });
    const up = e => { const b = e.target.closest && e.target.closest('.badge'); if (b && GS.Game.state !== 'presnap') GS.Input.targetEnd(+b.dataset.i); };
    bd.addEventListener('pointerup', up); bd.addEventListener('pointercancel', up);
    $('#btnPause').addEventListener('click', () => { GS.Audio.init(); GS.Game.togglePause(); });
    $('#btnCam').addEventListener('click', () => GS.Game.cycleCamera());
    $('#modeChip').textContent = GS.Input.mode === 'touch' ? 'TOUCH' : 'KEYBOARD';
    $('#modeChip').addEventListener('click', () => { const next = GS.Input.mode === 'touch' ? 'desktop' : 'touch'; GS.Game.setSetting('controls', next); toast(next === 'touch' ? 'Touch controls on' : 'Keyboard, mouse and gamepad controls on'); });
    // desktop: a click on the field advances past the whistle / replay / kick meter
    // before the snap on defense: tap / click a defender to become him (runs before the joystick sees the tap)
    document.addEventListener('pointerdown', e => {
      const G = GS.Game, S = GS.Sim;
      if (!(G.state === 'presnap' && G.cfg && G.cfg.userSide === 'def' && G.cfg.kind === 'scrim')) return;
      if (e.target.closest && e.target.closest('button, .badge, #hot, #screen, #pause, #tutorial, #meter')) return;
      let best = null, bd = GS.Input.mode === 'touch' ? 56 : 44;
      for (const d of S.def) { for (const y of [0.6, 1.4, 2.2]) { const q = GS.Render.project(d.x, y, d.z); if (!q.vis) continue; const dd = Math.hypot(q.x - e.clientX, q.y - e.clientY); if (dd < bd) { bd = dd; best = d; } } }
      if (best && best !== S.user) { G.selectDefender(best); e.preventDefault(); e.stopPropagation(); }
    }, true);
    $('#stage').addEventListener('pointerdown', e => {
      const G = GS.Game;
      if (e.pointerType === 'touch') return; const st = G.state; if (st === 'post' || st === 'replay' || st === 'kickmeter') GS.Input.press('action'); });
    document.addEventListener('pointerdown', () => GS.Audio.init(), { once: false, passive: true });
    document.addEventListener('keydown', () => GS.Audio.init());
    GS.Data.onChange(dataBanner);
    dataBanner(GS.Data.info());
    $('#rotate').hidden = true;
    const rot = () => { const portrait = window.innerHeight > window.innerWidth * 1.1 && GS.Input.mode === 'touch'; document.documentElement.classList.toggle('portrait', portrait); if (portrait && !UI.rotTipped) { UI.rotTipped = true; const tip = () => { if (!$('#tutorial').hidden || !$('#screen').hidden) return setTimeout(tip, 2000); toast('Tip: turn your phone sideways for a wider view'); }; setTimeout(tip, 1500); } };
    window.addEventListener('resize', rot); rot();
    // switching between laptop and phone layouts on the fly
    GS.Input.onModeChange(m => { rot(); controls(); Object.keys(ctlState).forEach(k => delete ctlState[k]); const n = $('#modeChip'); if (n) n.textContent = m === 'touch' ? 'TOUCH' : 'KEYBOARD'; if (!screenEl.hidden && screenEl.classList.contains('s-settings')) show('settings'); });
    $('#rotateGo').addEventListener('click', () => { UI.rotateDismissed = true; $('#rotate').hidden = true; });
  }

  function dataBanner(info) {
    const kindText = { live: 'Live feed', cache: 'Cached feed', file: 'Your roster file', snapshot: 'Bundled snapshot', placeholder: 'Placeholder rosters' }[info.kind] || info.kind;
    const when = info.updated ? new Date(info.updated) : null;
    const whenTxt = when && !isNaN(when) ? when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'unknown';
    const t = `${kindText} • ${info.season || ''} Wk ${info.week || '?'} • updated ${whenTxt}`;
    const chip = $('#dataChip'); if (chip) { chip.textContent = 'ROSTERS: ' + kindText.toUpperCase(); chip.className = 'datachip ' + info.kind; chip.title = t; }
    document.querySelectorAll('[data-roster-status]').forEach(n => { n.innerHTML = `<span class="dot ${info.kind}"></span><b>${esc(kindText)}</b> · ${esc(info.season || '')} season, week ${esc(info.week || '?')} · ${info.players} players · updated ${esc(whenTxt)}${info.error ? ` <span class="err">· feed unreachable (${esc(info.error)}), using ${info.kind === 'snapshot' ? 'bundled snapshot' : 'cached copy'}</span>` : ''}`; });
  }

  // ------------------------------------------------ screens
  function show(name, data) {
    screenEl.hidden = false; screenEl.innerHTML = ''; screenEl.className = 'screen s-' + name;
    const f = SCREENS[name]; if (f) f(data || {});
    screenEl.scrollTop = 0;
  }
  function hideScreens() { screenEl.hidden = true; screenEl.innerHTML = ''; }

  const SCREENS = {
    title() {
      const s = el('div', 'title-wrap');
      s.innerHTML = `
        <div class="title-left">
          <div class="chyron gold"><span>LIVE · REAL ROSTERS · ALL 32 TEAMS</span></div>
          <h1 class="logo"><span>GRIDIRON</span><span class="l2">SUNDAY</span></h1>
          <p class="tagline">Call the play. Read the coverage. Run it in.</p>
          <p class="ctlnote only-desktop" style="color:#C9D3E0">Keyboard: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>SPACE</kbd> snap / throw · <kbd>1</kbd>–<kbd>5</kbd> pick receiver · gamepads work too</p>
          <p class="ctlnote only-touch" style="color:#C9D3E0">Touch controls: left thumb moves, right thumb runs the buttons.</p>
          <div class="menu">
            <button class="btn big gold" id="mQuick"><span>Quick Game</span></button>
            <button class="btn big" id="mSeason"><span>Season</span></button>
            <button class="btn big ghost" id="mSettings"><span>Settings</span></button>
          </div>
        </div>
        <div class="title-card">
          <div class="card-head">ROSTER DATA</div>
          <p class="rstatus" data-roster-status></p>
          <div class="row"><button class="btn small" id="mUpdate"><span>Update rosters</span></button><span class="muted" id="updMsg"></span></div>
          <p class="fine">Source: nflverse open roster feed, refreshed daily. The game keeps a copy on this device and checks again when it is more than 24 hours old.</p>
        </div>`;
      screenEl.appendChild(s);
      $('#mQuick').onclick = () => { GS.Audio.init(); GS.Audio.select(); show('teams', { mode: 'quick' }); };
      $('#mSeason').onclick = () => { GS.Audio.init(); GS.Audio.select(); GS.Season.load() ? show('season') : show('teams', { mode: 'season' }); };
      $('#mSettings').onclick = () => { GS.Audio.init(); GS.Audio.ui(); show('settings'); };
      $('#mUpdate').onclick = async () => { const m = $('#updMsg'); m.textContent = 'Checking…'; const ok = await GS.Data.refresh(true); m.textContent = ok ? 'Rosters updated' : 'Feed unreachable. Kept current data'; GS.Game.resetAttract(); };
      dataBanner(GS.Data.info());
    },

    teams(d) {
      const mode = d.mode || 'quick';
      const T = GS.Data.teams;
      const s = el('div', 'panel teams');
      s.innerHTML = `
        <div class="bar"><button class="back" id="tBack">‹ Back</button><h2>${mode === 'season' ? 'Pick your team' : 'Choose the matchup'}</h2><span class="muted small" data-roster-status></span></div>
        <div class="matchup">
          <div class="slot" id="slotUser"></div>
          ${mode === 'quick' ? '<div class="vs"><button class="chip" id="swapHA" title="Swap home and away"></button></div><div class="slot" id="slotOpp"></div>' : ''}
          <div class="go-col">
            <div class="seg" id="diffSeg">${['rookie', 'pro', 'allpro'].map(k => `<button data-v="${k}">${GS.Game.DIFF[k].label}</button>`).join('')}</div>
            <div class="seg" id="qSeg">${[2, 3, 5, 8].map(k => `<button data-v="${k}">${k} min</button>`).join('')}</div>
            <button class="btn gold big" id="tGo"><span>${mode === 'season' ? 'Start season' : 'Kick off'}</span></button>
          </div>
        </div>
        ${mode === 'quick' ? '<div class="pickwho"><button class="chip on" data-w="user">Picking: YOUR TEAM</button><button class="chip" data-w="opp">Picking: OPPONENT</button></div>' : ''}
        <div class="grid32" id="grid"></div>`;
      screenEl.appendChild(s);
      let who = 'user';
      const tile = t => `<button class="tile" data-a="${t.abbr}" style="--c1:${t.c1};--c2:${t.c2}"><span class="ab">${t.abbr}</span><span class="nm">${esc(t.name)}</span><span class="ov">${t.ovr}</span></button>`;
      const grid = $('#grid');
      const confs = ['AFC', 'NFC'];
      grid.innerHTML = confs.map(c => ['East', 'North', 'South', 'West'].map(dv => `<div class="div"><div class="dh">${c} ${dv}</div>${T.filter(t => t.conf === c && t.div === dv).map(tile).join('')}</div>`).join('')).join('');
      const slot = (id, abbr, label) => {
        const t = GS.Data.byAbbr[abbr]; const S = t.starters;
        const p = (x, pos) => x ? `<li><b>${pos}</b> #${x.num} ${esc(x.name)} <i>${x.r.ovr}</i></li>` : '';
        $(id).innerHTML = `<div class="slab" style="--c1:${t.c1};--c2:${t.c2}"><div class="lbl">${label}</div>${helmet(t.c1, t.c2, 64)}<div class="tn"><span>${esc(t.city)}</span><b>${esc(t.name)}</b></div><div class="ovrs"><span>OVR <b>${t.ovr}</b></span><span>OFF <b>${t.off}</b></span><span>DEF <b>${t.def}</b></span></div></div>
          <ul class="keyp">${p(S.QB[0], 'QB')}${p(S.RB[0], 'RB')}${p(S.WR[0], 'WR')}${p(S.DL[0], 'DL')}${p(S.CB[0], 'CB')}</ul>`;
      };
      const refresh = () => {
        slot('#slotUser', picks.user, mode === 'season' ? 'YOUR TEAM' : 'YOU · ' + (picks.userHome ? 'HOME' : 'AWAY'));
        if (mode === 'quick') { slot('#slotOpp', picks.opp, 'CPU · ' + (picks.userHome ? 'AWAY' : 'HOME')); $('#swapHA').textContent = picks.userHome ? '⇄ You are home' : '⇄ You are away'; }
        grid.querySelectorAll('.tile').forEach(b => { b.classList.toggle('sel-u', b.dataset.a === picks.user); b.classList.toggle('sel-o', mode === 'quick' && b.dataset.a === picks.opp); });
        document.querySelectorAll('#diffSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === GS.Game.settings.diff));
        document.querySelectorAll('#qSeg button').forEach(b => b.classList.toggle('on', +b.dataset.v === +GS.Game.settings.qLen));
        lsSet('gs.picks', JSON.stringify(picks));
      };
      grid.onclick = e => { const b = e.target.closest('.tile'); if (!b) return; GS.Audio.ui(); const a = b.dataset.a; if (who === 'user') { if (a === picks.opp) picks.opp = picks.user; picks.user = a; } else { if (a === picks.user) return; picks.opp = a; } refresh(); };
      document.querySelectorAll('.pickwho .chip').forEach(c => c.onclick = () => { who = c.dataset.w; document.querySelectorAll('.pickwho .chip').forEach(x => x.classList.toggle('on', x === c)); GS.Audio.ui(); });
      if ($('#swapHA')) $('#swapHA').onclick = () => { picks.userHome = !picks.userHome; GS.Audio.ui(); refresh(); };
      $('#diffSeg').onclick = e => { const b = e.target.closest('button'); if (b) { GS.Game.setSetting('diff', b.dataset.v); GS.Audio.ui(); refresh(); } };
      $('#qSeg').onclick = e => { const b = e.target.closest('button'); if (b) { GS.Game.setSetting('qLen', +b.dataset.v); GS.Audio.ui(); refresh(); } };
      $('#tBack').onclick = () => { GS.Audio.uiBack(); show('title'); };
      $('#tGo').onclick = () => {
        GS.Audio.init(); GS.Audio.select();
        if (mode === 'season') { GS.Season.create(picks.user); show('season'); return; }
        const home = picks.userHome ? picks.user : picks.opp, away = picks.userHome ? picks.opp : picks.user;
        GS.Game.start(home, away, picks.user);
      };
      refresh(); dataBanner(GS.Data.info());
    },

    settings() {
      const S = GS.Game.settings;
      const s = el('div', 'panel settings');
      const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      s.innerHTML = `
        <div class="bar"><button class="back" id="sBack">‹ Back</button><h2>Settings</h2></div>
        <div class="setgrid">
          <label>Difficulty</label>${seg('setDiff', [['rookie', 'Rookie'], ['pro', 'Pro'], ['allpro', 'All-Pro']], S.diff)}
          <label>Quarter length</label>${seg('setQ', [[2, '2 min'], [3, '3 min'], [5, '5 min'], [8, '8 min']], S.qLen)}
          <label>Graphics quality</label>${seg('setGfx', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], S.quality)}
          <label>Sound</label>${seg('setSnd', [[true, 'On'], [false, 'Off']], S.sound)}
          <label>Idle assist</label>${seg('setAst', [[true, 'On'], [false, 'Off']], S.assist)}
          <label>Auto replays</label>${seg('setRep', [[true, 'On'], [false, 'Off']], S.replays)}
          <label>Camera</label>${seg('setCam', [['auto', 'Broadcast'], ['follow', 'Follow'], ['all22', 'All-22']], S.camera)}
          <label>Controls</label><div>${seg('setCtl', [['auto', 'Auto'], ['desktop', 'Keyboard / mouse'], ['touch', 'Touch']], S.controls || 'auto')}<div class="muted small">Now using: ${GS.Input.mode === 'touch' ? 'touch layout' : 'keyboard, mouse and gamepad layout'}. Auto follows the input you use.</div></div>
        </div>
        <div class="card-head">ROSTERS</div>
        <p class="rstatus" data-roster-status></p>
        <div class="row"><button class="btn small" id="sUpd"><span>Update rosters</span></button>
          <label class="btn small ghost filebtn"><span>Load nflverse roster CSV</span><input type="file" id="csvIn" accept=".csv,text/csv"></label><span class="muted" id="sMsg"></span></div>
        <details class="formula"><summary>How player ratings are derived</summary>
          <p>Every rating starts from a quality core: <code>Q = 58 + draft pedigree + experience − age decline ± 3</code>. Pedigree is <code>13 − 0.05 × draft pick</code> (undrafted 0). Experience adds 1.5 per season up to 6. Decline is 1.7 per year past the position's peak age.</p>
          <p>Each attribute is <code>Q + position template + body adjustment</code>: speed, acceleration and agility drop 0.12 per pound over the position's average weight, strength rises 0.2 per pound, and receivers gain 0.8 catching per inch of height over average. OVR is a weighted blend of the attributes that matter for the position. Starters are the top OVR players at each depth-chart position.</p>
        </details>
        <div class="row"><button class="btn small ghost" id="sTut"><span>Show controls tutorial again</span></button><button class="btn small ghost" id="sReset"><span>Reset season</span></button></div>`;
      screenEl.appendChild(s);
      const bind = (id, key, conv) => $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; GS.Game.setSetting(key, conv(b.dataset.v)); document.querySelectorAll(id + ' button').forEach(x => x.classList.toggle('on', x === b)); GS.Audio.ui(); };
      bind('#setDiff', 'diff', v => v); bind('#setQ', 'qLen', v => +v); bind('#setGfx', 'quality', v => v); bind('#setSnd', 'sound', v => v === 'true');
      bind('#setAst', 'assist', v => v === 'true'); bind('#setRep', 'replays', v => v === 'true'); bind('#setCam', 'camera', v => v); bind('#setCtl', 'controls', v => v);
      $('#sBack').onclick = () => { GS.Audio.uiBack(); show('title'); };
      $('#sUpd').onclick = async () => { $('#sMsg').textContent = 'Checking…'; const ok = await GS.Data.refresh(true); $('#sMsg').textContent = ok ? 'Rosters updated' : 'Feed unreachable. Kept current data'; };
      $('#csvIn').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { GS.Data.loadCSV(String(r.result)); $('#sMsg').textContent = 'Loaded ' + f.name; GS.Game.resetAttract(); } catch (err) { $('#sMsg').textContent = err.message; } }; r.readAsText(f); };
      $('#sTut').onclick = () => { try { localStorage.removeItem('gs.tutorial4'); } catch (e) { /* ignore */ } GS.Game.tutorialShown = false; $('#sMsg').textContent = 'The tutorial will show on your next play'; };
      $('#sReset').onclick = () => { GS.Season.clear(); $('#sMsg').textContent = 'Season cleared'; };
      dataBanner(GS.Data.info());
    },

    season() {
      const S = GS.Season.load(); if (!S) return show('teams', { mode: 'season' });
      const me = GS.Data.byAbbr[S.user], g = GS.Season.userGame();
      const rec = S.table[S.user];
      const s = el('div', 'panel season');
      const next = g ? (() => { const opp = GS.Data.byAbbr[g.home === S.user ? g.away : g.home]; return `<div class="nextgame" style="--c1:${opp.c1};--c2:${opp.c2}"><div class="lbl">${g.playoff ? g.playoff.toUpperCase() : 'WEEK ' + (S.week + 1) + ' OF ' + GS.Season.WEEKS}</div>${helmet(opp.c1, opp.c2, 60)}<div class="tn"><span>${g.home === S.user ? 'vs' : '@'} ${esc(opp.city)}</span><b>${esc(opp.name)}</b></div><div class="ovrs"><span>OVR <b>${opp.ovr}</b></span></div><button class="btn gold big" id="sPlay"><span>Play game</span></button></div>`; })()
        : `<div class="nextgame done"><div class="lbl">SEASON COMPLETE</div><div class="champ">${S.champion ? 'Champions: <b>' + esc(GS.Data.byAbbr[S.champion].city + ' ' + GS.Data.byAbbr[S.champion].name) + '</b>' : ''}</div><button class="btn gold" id="sNew"><span>New season</span></button></div>`;
      const divs = [];
      for (const c of ['AFC', 'NFC']) for (const dv of ['East', 'North', 'South', 'West']) {
        const ts = GS.Data.teams.filter(t => t.conf === c && t.div === dv).sort((a, b) => GS.Season.pct(S.table[b.abbr]) - GS.Season.pct(S.table[a.abbr]) || (S.table[b.abbr].pf - S.table[b.abbr].pa) - (S.table[a.abbr].pf - S.table[a.abbr].pa));
        divs.push(`<table class="stand"><thead><tr><th>${c} ${dv}</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th></tr></thead><tbody>${ts.map(t => { const r = S.table[t.abbr]; return `<tr class="${t.abbr === S.user ? 'me' : ''}"><td><i style="background:${t.c1}"></i>${t.abbr}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${r.pf}</td><td>${r.pa}</td></tr>`; }).join('')}</tbody></table>`);
      }
      const res = S.results.map(r => { const w = (r.home === S.user ? r.hs > r.as : r.as > r.hs) ? 'W' : r.hs === r.as ? 'T' : 'L'; return `<li><b class="r${w}">${w}</b> Wk ${r.week + 1} ${r.home === S.user ? 'vs ' + r.away : '@ ' + r.home} ${r.home === S.user ? r.hs + '–' + r.as : r.as + '–' + r.hs}</li>`; }).join('');
      const P = S.playoff; const seeds = P ? `<div class="card-head">PLAYOFF SEEDS</div><ol class="seeds">${P.seeds.map(a => `<li class="${a === S.user ? 'me' : ''}">${esc(GS.Data.byAbbr[a].city + ' ' + GS.Data.byAbbr[a].name)}</li>`).join('')}</ol>` : `<p class="fine">Top 4 records after week ${GS.Season.WEEKS} make the playoff.</p>`;
      s.innerHTML = `<div class="bar"><button class="back" id="sBack">‹ Menu</button><h2>${esc(me.city + ' ' + me.name)} · ${rec.w}-${rec.l}${rec.t ? '-' + rec.t : ''}</h2></div>
        <div class="season-grid"><div class="col">${next}<div class="card-head">RESULTS</div><ul class="results">${res || '<li class="muted">No games played yet</li>'}</ul>${seeds}</div><div class="col standings">${divs.join('')}</div></div>`;
      screenEl.appendChild(s);
      $('#sBack').onclick = () => { GS.Audio.uiBack(); show('title'); };
      if ($('#sPlay')) $('#sPlay').onclick = () => { GS.Audio.init(); GS.Audio.select(); GS.Game.start(g.home, g.away, S.user, { season: true }); };
      if ($('#sNew')) $('#sNew').onclick = () => { GS.Season.clear(); show('teams', { mode: 'season' }); };
    },

    playcall(d) {
      const side = d.side, sit = d.sit, G = GS.Game.G;
      const PB = GS.Playbook;
      const s = el('div', 'callwrap');
      const spot = GS.Rules.fmtSpot(G, sit.ballOn, sit.offSide);
      const situation = G.patTwo ? 'TWO-POINT TRY' : `${ord(sit.down)} & ${sit.goal ? 'GOAL' : sit.togo} · ${spot}`;
      const forms = side === 'off' ? [['all', 'All'], ['gun', 'Shotgun'], ['single', 'Singleback'], ['iform', 'I-Form'], ['trips', 'Trips'], ['pistol', 'Pistol'], ['heavy', 'Goal Line'], ['special', 'Special Teams']] : [['all', 'All'], ['zone', 'Zone'], ['man', 'Man'], ['blitz', 'Pressure']];
      s.innerHTML = `
        <div class="callbar">
          <div class="cb-side ${side}">${side === 'off' ? 'OFFENSE' : 'DEFENSE'}${d.audible ? ' · AUDIBLE' : ''}</div>
          <div class="cb-sit">${situation}</div>
          <div class="cb-clock">${G.quarter > 4 ? 'OT' : 'Q' + G.quarter} ${fmtClock(G.clock)}</div>
          <div class="cb-act">${d.audible ? '<button class="btn small ghost" id="cBack"><span>Keep play</span></button>' : `<button class="btn small ${d.clockRunning ? 'gold' : 'ghost'}" id="cTO" ${G.timeouts[G.user] > 0 ? '' : 'disabled'}><span>Timeout (${G.timeouts[G.user]})</span></button>`}</div>
        </div>
        <div class="chips" id="cForms">${forms.map(([k, l], i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
        ${d.suggestion ? `<div class="coach">Coach suggests: <b>${esc(d.suggestion.name)}</b></div>` : ''}
        <div class="cards" id="cCards"></div>`;
      screenEl.appendChild(s);
      const cards = $('#cCards');
      const list = side === 'off' ? PB.OFF.concat(PB.SPECIAL.filter(p => !(G.patTwo && (p.type === 'punt' || p.type === 'fg')))) : PB.D;
      const render = f => {
        cards.innerHTML = '';
        for (const p of list) {
          let show = f === 'all';
          if (side === 'off') { if (f === 'special') show = !!PB.SPECIAL.includes(p); else if (f !== 'all') show = p.form === f; }
          else { const vals = Object.values(p.a); const blitz = vals.filter(v => v === 'blitz' || v === 'run').length; const man = vals.filter(v => v.startsWith('m:')).length; if (f === 'zone') show = man < 2 && !blitz; else if (f === 'man') show = man >= 3; else if (f === 'blitz') show = blitz >= 1; }
          if (!show) continue;
          const c = el('button', 'pcard' + (d.suggestion && d.suggestion.id === p.id ? ' sug' : ''));
          const cv = document.createElement('canvas'); cv.width = 170; cv.height = 104;
          const form = p.form ? PB.F[p.form].name : p.type === 'punt' || p.type === 'fg' ? 'Special' : '';
          c.appendChild(cv);
          c.appendChild(el('div', 'pc-t', `<b>${esc(p.name)}</b><span>${esc(side === 'off' ? form : p.tag)}${side === 'off' && p.tag ? ' · ' + esc(p.tag) : ''}</span>`));
          PB.diagram(cv, p, side === 'off' && !PB.SPECIAL.includes(p) ? 'off' : side === 'def' ? 'def' : 'special');
          c.onclick = () => GS.Game.pickPlay(p);
          cards.appendChild(c);
        }
      };
      $('#cForms').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; document.querySelectorAll('#cForms .chip').forEach(x => x.classList.toggle('on', x === b)); GS.Audio.ui(); render(b.dataset.f); };
      if ($('#cTO')) $('#cTO').onclick = () => { if (GS.Game.userTimeout()) { $('#cTO').disabled = true; $('#cTO').classList.remove('gold'); $('#cTO').querySelector('span').textContent = 'Timeout (' + G.timeouts[G.user] + ')'; } };
      if ($('#cBack')) $('#cBack').onclick = () => { hideScreens(); GS.Game.state = 'presnap'; };
      render('all');
      // 4th down: open on special teams
      if (side === 'off' && sit.down === 4 && !G.patTwo) { const b = document.querySelector('#cForms [data-f=special]'); if (b && sit.ballOn < 70) b.click(); }
    },

    pat() {
      const s = el('div', 'modal');
      s.innerHTML = `<div class="mcard"><div class="card-head">POINT AFTER</div><h2>Touchdown! Go for one or two?</h2><div class="row"><button class="btn gold big" id="pKick"><span>Kick extra point</span></button><button class="btn big" id="pTwo"><span>Go for two</span></button></div></div>`;
      screenEl.appendChild(s);
      $('#pKick').onclick = () => GS.Game.patChoice('kick'); $('#pTwo').onclick = () => GS.Game.patChoice('two');
    },

    break(d) {
      const s = el('div', 'modal');
      s.innerHTML = `<div class="mcard wide"><div class="card-head">${esc(d.title)}</div>${d.sub ? `<p>${esc(d.sub)}</p>` : ''}${boxScore(d.G)}<div class="row"><button class="btn gold big" id="bGo"><span>${d.title === 'HALFTIME' ? 'Start second half' : 'Start overtime'}</span></button></div></div>`;
      screenEl.appendChild(s); $('#bGo').onclick = () => { GS.Audio.select(); GS.Game.resumeFromBreak(); };
    },

    final(d) {
      const G = d.G, w = GS.Rules.winner(G);
      const s = el('div', 'modal');
      const wt = w ? G[w] : null;
      const userWon = w && G.user === w;
      s.innerHTML = `<div class="mcard wide"><div class="card-head">FINAL${G.quarter > 4 ? ' / OT' : ''}</div>
        <h2 class="finalh">${wt ? esc(wt.city + ' ' + wt.name) + ' win' : 'Tie game'} ${G.score[w || 'home']}–${G.score[w ? other(w) : 'away']}</h2>
        ${G.user ? `<p class="verdict ${userWon ? 'win' : 'loss'}">${userWon ? 'Victory.' : w ? 'Defeat.' : 'All square.'}</p>` : ''}
        ${boxScore(G)}
        <div class="row">${d.season ? '<button class="btn gold big" id="fSeason"><span>Back to season</span></button>' : '<button class="btn gold big" id="fAgain"><span>Rematch</span></button>'}<button class="btn big ghost" id="fMenu"><span>Main menu</span></button></div></div>`;
      screenEl.appendChild(s);
      if ($('#fAgain')) $('#fAgain').onclick = () => GS.Game.start(G.home.abbr, G.away.abbr, G.user ? G[G.user].abbr : null);
      if ($('#fSeason')) $('#fSeason').onclick = () => { GS.Game.quit(); show('season'); };
      $('#fMenu').onclick = () => GS.Game.quit();
    },
  };
  const other = s => (s === 'home' ? 'away' : 'home');

  function boxScore(G) {
    const q = side => G.qScores[side].slice(0, G.quarter > 4 ? 5 : 4).map(v => `<td>${v}</td>`).join('');
    const hdr = ['1', '2', '3', '4'].concat(G.quarter > 4 ? ['OT'] : []).map(x => `<th>${x}</th>`).join('');
    const st = G.stats, row = (l, a, h) => `<tr><td>${l}</td><td>${a}</td><td>${h}</td></tr>`;
    const top = (pred, val, fmt) => {
      const arr = Object.values(G.players).filter(pred).sort((a, b) => val(b) - val(a)).slice(0, 2);
      return arr.map(p => `<li><i style="background:${GS.Data.byAbbr[p.team] ? GS.Data.byAbbr[p.team].c1 : '#888'}"></i><b>${esc(GS.Rules.shortName(p.name))}</b> ${esc(p.team)} · ${fmt(p)}</li>`).join('') || '<li class="muted">—</li>';
    };
    const top3 = (st.home.third ? `${st.home.thirdConv}/${st.home.third}` : '0/0');
    return `<div class="box">
      <table class="lines"><thead><tr><th></th>${hdr}<th>T</th></tr></thead><tbody>
        <tr><td><i style="background:${G.away.c1}"></i>${G.away.abbr}</td>${q('away')}<td><b>${G.score.away}</b></td></tr>
        <tr><td><i style="background:${G.home.c1}"></i>${G.home.abbr}</td>${q('home')}<td><b>${G.score.home}</b></td></tr></tbody></table>
      <table class="tstats"><thead><tr><th>Team stats</th><th>${G.away.abbr}</th><th>${G.home.abbr}</th></tr></thead><tbody>
        ${row('First downs', st.away.first, st.home.first)}${row('Total yards', st.away.yds, st.home.yds)}${row('Passing', st.away.pass, st.home.pass)}${row('Rushing', st.away.rush, st.home.rush)}
        ${row('Comp / Att', st.away.comp + '/' + st.away.att, st.home.comp + '/' + st.home.att)}${row('3rd down', (st.away.thirdConv + '/' + st.away.third), top3)}${row('Turnovers', st.away.to, st.home.to)}${row('Sacks allowed', st.away.sacks, st.home.sacks)}
        ${row('Penalties', st.away.pen + '-' + st.away.penYds, st.home.pen + '-' + st.home.penYds)}${row('Possession', fmtClock(st.away.top), fmtClock(st.home.top))}</tbody></table>
      <div class="leaders">
        <div><div class="lh">Passing</div><ul>${top(p => p.passAtt, p => p.passYds || 0, p => `${p.passComp || 0}/${p.passAtt} ${p.passYds || 0} yds${p.passTD ? ', ' + p.passTD + ' TD' : ''}${p.int ? ', ' + p.int + ' INT' : ''}`)}</ul></div>
        <div><div class="lh">Rushing</div><ul>${top(p => p.rushAtt, p => p.rushYds || 0, p => `${p.rushAtt} car, ${p.rushYds || 0} yds${p.rushTD ? ', ' + p.rushTD + ' TD' : ''}`)}</ul></div>
        <div><div class="lh">Receiving</div><ul>${top(p => p.rec, p => p.recYds || 0, p => `${p.rec} rec, ${p.recYds || 0} yds${p.recTD ? ', ' + p.recTD + ' TD' : ''}`)}</ul></div>
        <div><div class="lh">Defense</div><ul>${top(p => p.tkl || p.sack || p.defInt, p => (p.tkl || 0) + (p.sack || 0) * 3 + (p.defInt || 0) * 5, p => `${p.tkl || 0} tkl${p.sack ? ', ' + p.sack + ' sack' : ''}${p.defInt ? ', ' + p.defInt + ' INT' : ''}`)}</ul></div>
      </div></div>`;
  }

  // ------------------------------------------------ HUD
  function showHUD(on) { hudEl.hidden = !on; }
  function hud(G) {
    if (!G) return;
    const b = $('#bug');
    const poss = G.next === 'kickoff' ? other(G.kicking) : G.poss;
    const team = (side) => { const t = G[side]; return `<div class="bt ${poss === side ? 'has' : ''}" style="--c1:${t.c1};--c2:${t.c2}"><span class="ab">${t.abbr}</span><span class="sc">${G.score[side]}</span><span class="to">${[0, 1, 2].map(i => `<i class="${i < G.timeouts[side] ? 'on' : ''}"></i>`).join('')}</span></div>`; };
    let dd = '';
    if (G.next === 'kickoff') dd = 'KICKOFF'; else if (G.next === 'pat') dd = 'PAT'; else if (G.patTwo) dd = '2-PT TRY'; else dd = `${ord(G.down)} & ${G.ballOn + G.togo >= 100 ? 'GOAL' : G.togo}`;
    b.innerHTML = `${team('away')}${team('home')}<div class="bq"><span>${G.quarter > 4 ? 'OT' : ord(G.quarter).toUpperCase()}</span><b>${fmtClock(G.clock)}</b></div><div class="bd ${G.down === 4 && G.next === 'scrim' ? 'fourth' : ''}">${dd}</div>`;
  }
  function banner(text, sub, style) {
    const n = $('#banner'); n.className = 'banner show ' + (style || 'gold');
    n.innerHTML = `<div class="b1"><span>${esc(text)}</span></div>${sub ? `<div class="b2"><span>${esc(sub)}</span></div>` : ''}`;
    clearTimeout(bannerT); bannerT = setTimeout(() => n.className = 'banner', text === 'TOUCHDOWN' ? 2800 : 1900);
  }
  function flash(text) { const n = $('#flash'); n.textContent = text; n.className = 'flash show'; clearTimeout(flashT); flashT = setTimeout(() => n.className = 'flash', 1000); }
  function ticker(text) { const n = $('#ticker'); n.innerHTML = `<span>${esc(text)}</span>`; n.classList.remove('show'); void n.offsetWidth; n.classList.add('show'); }
  function toast(text) { const n = $('#toast'); n.textContent = text; n.className = 'toast show'; clearTimeout(toastT); toastT = setTimeout(() => n.className = 'toast', 2200); }
  function replayTag(on, text) { const n = $('#replayTag'); n.hidden = !on; n.textContent = text || 'REPLAY'; }
  function showPause(on) {
    const p = $('#pause'); p.hidden = !on; if (!on) return;
    const G = GS.Game.G, S = GS.Game.settings;
    p.innerHTML = `<div class="mcard"><div class="card-head">PAUSED</div>
      <div class="pgrid">
        <button class="btn gold" id="pRes"><span>Resume</span></button>
        <button class="btn" id="pCam"><span>Camera: ${{ auto: 'Broadcast', follow: 'Follow', all22: 'All-22' }[S.camera]}</span></button>
        <button class="btn" id="pGfx"><span>Quality: ${S.quality}</span></button>
        <button class="btn" id="pSnd"><span>Sound: ${S.sound ? 'On' : 'Off'}</span></button>
        <button class="btn" id="pTut"><span>Controls</span></button>
        <button class="btn ghost" id="pQuit"><span>Quit game</span></button>
      </div>${G ? boxScore(G) : ''}</div>`;
    $('#pRes').onclick = () => GS.Game.togglePause();
    $('#pCam').onclick = () => { GS.Game.cycleCamera(); showPause(true); };
    $('#pGfx').onclick = () => { const q = { low: 'medium', medium: 'high', high: 'low' }[S.quality]; GS.Game.setSetting('quality', q); showPause(true); };
    $('#pSnd').onclick = () => { GS.Game.setSetting('sound', !S.sound); showPause(true); };
    $('#pTut').onclick = () => { p.hidden = true; tutorial(); };
    $('#pQuit').onclick = () => GS.Game.quit();
  }

  // ------------------------------------------------ touch controls / labels
  const ctlState = {};
  function controls() {
    const G = GS.Game, S = GS.Sim, cfg = G.cfg; if (!cfg) return;
    const us = cfg.userSide; const t = $('#touch');
    t.hidden = GS.Input.mode !== 'touch' || !us || GS.Game.state === 'menu';
  }
  function setBtn(act, label, show) {
    const b = document.querySelector(`#touch [data-act="${act}"]`); if (!b) return;
    const k = act + label + show; if (ctlState[act] === k) return; ctlState[act] = k;
    b.hidden = !show; const l = b.querySelector('b'); if (l) l.textContent = label;
  }
  function frame(Game) {
    const S = GS.Sim, cfg = Game.cfg; if (!cfg) return;
    const st = Game.state, u = S.user, us = cfg.userSide;
    const pre = st === 'presnap', live = st === 'live';
    const isQB = u && S.ball.holder === u && S.passAllowed && !S.thrown && u.role === 'QB' && cfg.kind === 'scrim';
    const isCarrier = u && S.carrier === u && S.ball.holder === u && !isQB; // a QB who can still throw is a passer
    const onDef = !!(u && u.side === 'def' && !isCarrier), ballAir = S.ball.state === 'air' && !S.ball.resolved;
    // contextual touch buttons
    controls();
    const touch = GS.Input.mode === 'touch';
    if (touch && us) {
      let action = '', show = true;
      if (pre) action = us === 'off' && cfg.kind !== 'kickoff' ? 'SNAP' : us === 'def' ? 'SWITCH' : '';
      else if (st === 'kickmeter') action = 'KICK';
      else if (live) action = isQB ? 'THROW ★' : isCarrier ? '' : ballAir && onDef ? 'SWAT' : onDef ? 'SWITCH' : '';
      else if (st === 'post' || st === 'replay') action = 'NEXT';
      if (!action) show = false;
      setBtn('action', action, show);
      setBtn('juke', 'JUKE', live && isCarrier); setBtn('spin', 'SPIN', live && isCarrier);
      setBtn('dive', isCarrier ? 'DIVE' : ballAir && onDef ? 'PICK' : 'TACKLE', live && !isQB && (isCarrier || onDef || (S.carrier && u && S.carrier.side !== u.side)));
      setBtn('sprint', 'SPRINT', live && !isQB);
      setBtn('hot', us === 'off' ? 'HOT ROUTE' : 'ADJUST', pre && cfg.kind === 'scrim');
      setBtn('call', 'AUDIBLE', pre && us === 'off' && cfg.kind === 'scrim');
      setBtn('cycle', '', false);
      setBtn('view', Game.survey ? 'BACK' : 'FIELD VIEW', pre && cfg.kind === 'scrim');
      const canCh = GS.Game.canChallenge(); setBtn('challenge', 'CHALLENGE (' + (Game.G && Game.G.challenges ? Game.G.challenges[Game.G.user] : 0) + ')', canCh);
    }
    // receiver icons: same color as the route drawn on the field
    const bdg = $('#badges');
    const passPlay = us === 'off' && cfg.kind === 'scrim' && cfg.offPlay && cfg.offPlay.type !== 'run' && cfg.offPlay.type !== 'kneel' && cfg.offPlay.type !== 'spike';
    const wantBadges = passPlay && ((pre && !hotOpen) || isQB);
    if (!bdg.dataset.built) { bdg.dataset.built = 1; bdg.innerHTML = [1, 2, 3, 4, 5].map(i => `<button class="badge" data-i="${i}" hidden style="--ic:${Game.ICON_COLORS[i - 1]}"><i></i><span></span><em></em></button>`).join(''); }
    if (wantBadges) {
      const recv = Game.receivers(); const nodes = bdg.children; const holding = GS.Input.holdingTarget();
      const pad = GS.Input.device === 'gamepad';
      for (let i = 0; i < 5; i++) {
        const r = recv[i], n = nodes[i]; const q = r ? GS.Render.project(r.x, 2.7, r.z) : null;
        if (!r || !q.vis) { n.hidden = true; continue; }
        const vw = window.innerWidth, vh = window.innerHeight, qx = Math.max(40, Math.min(vw - 40, q.x)), qy = Math.max(touch ? 150 : 110, Math.min(vh - 90, q.y));
        n.hidden = false; n.style.transform = `translate(${qx.toFixed(0)}px,${qy.toFixed(0)}px)`; n.classList.toggle('edge', qx !== q.x);
        const glyph = pad ? ['A', 'B', 'X', 'Y', 'RB'][i] : String(i + 1);
        let status = '', cls = '';
        if (pre) status = (GS.Playbook.ROUTE_NAMES[(cfg.hot && cfg.hot[r.role]) || r.routeName] || '').toUpperCase();
        else { const o = r.openScore == null ? 2 : r.openScore; if (o >= 2.5) { status = 'OPEN'; cls = 'open'; } else if (o >= 1) { status = 'TIGHT'; cls = 'tight'; } else { status = 'COVERED'; cls = 'cov'; } }
        const nm = r.info ? r.info.last.toUpperCase() : r.role, key = glyph + '|' + nm + '|' + status;
        if (n.dataset.k !== key) { n.dataset.k = key; n.children[0].textContent = glyph; n.children[1].textContent = nm; n.children[2].textContent = status; n.dataset.s = cls; }
        n.classList.toggle('hl', !pre && S.highlight === r);
        n.classList.toggle('hold', holding === i + 1);
        n.classList.toggle('pre', pre);
      }
      bdg.hidden = false;
    } else if (!bdg.hidden) bdg.hidden = true;
    // name tag over the user's player and the ball carrier
    const lab = $('#labels'); let lh = '';
    const tag = (p, cls) => { if (!p || !p.info) return; const q = GS.Render.project(p.x, 2.55, p.z); if (!q.vis) return; lh += `<div class="ptag ${cls}" style="transform:translate(${q.x.toFixed(0)}px,${q.y.toFixed(0)}px)">${cls === 'me' ? '▼ YOU · ' : ''}#${p.info.num} ${esc(p.info.last.toUpperCase())}</div>`; };
    if (pre && us === 'def' && cfg.kind === 'scrim') for (const d of S.def) if (d !== u && d.info) { const q = GS.Render.project(d.x, 2.45, d.z); if (q.vis) lh += `<div class="ptag dsel" style="transform:translate(${q.x.toFixed(0)}px,${q.y.toFixed(0)}px)">${d.info.num}</div>`; }
    if (st !== 'replay' && st !== 'review') { if (u && (!wantBadges || isQB)) tag(u, 'me'); if (S.carrier && S.carrier !== u && S.ball.holder === S.carrier && (live || st === 'post')) tag(S.carrier, 'car'); }
    lab.innerHTML = lh;
    // what-to-do-now coaching line (both layouts)
    const hint = $('#hint');
    if (us) {
      let h = '';
      const k = a => `<kbd>${GS.Input.label(a)}</kbd>`;
      const pad = GS.Input.device === 'gamepad';
      const nums = pad ? '<kbd>A</kbd><kbd>B</kbd><kbd>X</kbd><kbd>Y</kbd><kbd>RB</kbd>' : '<kbd>1</kbd>–<kbd>5</kbd>';
      if (touch) {
        if (pre && us === 'off' && cfg.kind === 'scrim') h = Game.survey ? 'Read the defense · <b>BACK</b> to return' : passPlay ? 'Tap <b>SNAP</b> · tap an icon to change a route' : 'Gold line = run path · tap <b>SNAP</b>';
        else if (pre && us === 'def') h = '<b>Tap a defender</b> to play as him · stick moves him';
        else if (live && isQB) h = '<b>Tap</b> icon = pass · <b>hold</b> = bullet · stick aims';
        else if (live && isCarrier) h = '<b>SPRINT</b> · <b>JUKE</b>/<b>SPIN</b> before contact';
        else if (live && onDef && ballAir) h = 'Run to the <b>white circle</b> · <b>SWAT</b> or <b>PICK</b> as it lands';
        else if (live && onDef && S.carrier && S.carrier.side === 'off' && !(S.carrier.role === 'QB' && S.passAllowed)) h = 'Hold <b>TACKLE</b> to chase the <b>red ring</b>';
        else if (live && onDef) h = 'Cover your man · <b>SWITCH</b> to closest';
        else if (st === 'post') h = GS.Game.canChallenge() ? 'Tap <b>NEXT</b> · <b>CHALLENGE</b> to review the play' : 'Tap <b>NEXT</b>';
        else if (st === 'review') h = 'The officials are reviewing the play…';
      } else {
        if (pre && us === 'off' && cfg.kind === 'scrim') h = (Game.survey ? `${k('view')} Back to the huddle view · ` : `${k('view')} Field view · `) + (passPlay ? `${k('action')} Snap · ${nums} or click an icon: change that receiver’s route · ${k('call')} Audible · <kbd>C</kbd> Camera` : `${k('action')} Snap · gold line is the run path, you get the ball after the handoff · ${k('call')} Audible`);
        else if (pre && us === 'def') h = `Click a defender to play as him · ${k('action')} Next player · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move · ${k('view')} Field view · ${k('hot')} Adjust coverage`;
        else if (live && isQB) h = `${nums} <b>tap</b> = touch pass, <b>hold</b> = bullet · hold <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> while throwing to lead · ${k('action')} throws to ★`;
        else if (live && isCarrier) h = `${k('sprint')} Sprint · ${k('juke')} Juke · ${k('spin')} Spin · ${k('dive')} Dive`;
        else if (live && onDef && ballAir) h = `Run to the white circle · ${k('action')} Swat it down · ${k('dive')} Go for the pick · press as the ball arrives`;
        else if (live && onDef) h = `Hold ${k('dive')} to chase and tackle the runner (red ring) · ${k('sprint')} Sprint · ${k('action')} Switch to closest`;
        else if (live) h = `${k('sprint')} Sprint · ${k('action')} Switch · ${k('dive')} Dive tackle`;
        else if (st === 'post') h = `${k('action')} or click: next play · <kbd>X</kbd> Replay` + (GS.Game.canChallenge() ? ` · ${k('challenge')} Challenge (${Game.G.challenges[Game.G.user]} left)` : '');
        else if (st === 'review') h = 'The officials are reviewing the play…';
        else if (st === 'replay') h = `${k('action')} Skip replay`;
      }
      if (hint.dataset.h !== h) { hint.innerHTML = h; hint.dataset.h = h; }
      hint.hidden = !h;
    } else hint.hidden = true;
  }

  // ------------------------------------------------ hot routes / def adjust
  let hotOpen = false;
  function openHot(side, role) {
    const n = $('#hot'); hotOpen = true; n.hidden = false;
    if (side === 'off' && role) { showRoutes(n, role); n.onclick = hotClick; return; }
    if (side === 'def') {
      n.innerHTML = `<div class="hothead">Adjust coverage</div><div class="hotrow">${['c2', 'c3', 'c1', 'c4', 'c0', 'fire'].map(id => `<button class="chip" data-d="${id}">${esc(GS.Playbook.defById(id).name)}</button>`).join('')}<button class="chip ghost" data-x>Close</button></div>`;
      n.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.d) GS.Game.applyDefAudible(b.dataset.d); hideHot(); };
      return;
    }
    const recv = GS.Game.receivers();
    n.innerHTML = `<div class="hothead">Hot route: pick a receiver</div><div class="hotrow">${recv.map((r, i) => { const p = r || GS.Sim.off.find(q => q.role === ['X', 'Z', 'S', 'TE', 'RB'][i]); return p ? `<button class="chip" data-r="${p.role}">${i + 1}. ${p.role} · ${esc(p.info ? p.info.last : '')}</button>` : ''; }).join('')}<button class="chip ghost" data-x>Close</button></div>`;
    n.onclick = hotClick;
  }
  function showRoutes(n, role) {
    const p = GS.Sim.off.find(q => q.role === role), nm = p && p.info ? p.info.last : role;
    n.innerHTML = `<div class="hothead">Hot route · ${esc(role)} ${esc(nm)}: pick a new route</div><div class="hotrow">${GS.Playbook.HOT_ROUTES.map((rt, i) => `<button class="chip" data-rt="${rt}" data-role="${role}">${i + 1}. ${GS.Playbook.ROUTE_NAMES[rt]}</button>`).join('')}<button class="chip ghost" data-x>Close</button></div>`;
  }
  function hotClick(e) {
    const n = $('#hot'), b = e.target.closest('button'); if (!b) return;
    if (b.dataset.x != null) return hideHot();
    if (b.dataset.r) { showRoutes(n, b.dataset.r); return; }
    if (b.dataset.rt) { GS.Game.applyHot(b.dataset.role, b.dataset.rt); toast(b.dataset.role + ' → ' + GS.Playbook.ROUTE_NAMES[b.dataset.rt]); hideHot(); }
  }
  function hideHot() { hotOpen = false; const n = $('#hot'); n.hidden = true; n.innerHTML = ''; }
  // number keys work inside the hot route menu
  window.addEventListener('keydown', e => {
    if (!hotOpen) return; const m = /^Digit([1-9])$/.exec(e.code); if (!m) { if (e.code === 'Escape') hideHot(); return; }
    const btns = [...document.querySelectorAll('#hot button:not([data-x])')]; const b = btns[+m[1] - 1]; if (b) { e.stopImmediatePropagation(); b.click(); }
  }, true);

  // ------------------------------------------------ kick meter
  function kickMeter(m, kind) {
    const n = $('#meter');
    if (!m) { n.hidden = true; return; }
    n.hidden = false;
    if (!n.dataset.built) {
      n.dataset.built = 1;
      n.innerHTML = `<div class="mhead" id="mHead"></div><div class="mbar"><div class="mfill" id="mFill"></div><div class="mgoal"></div></div><div class="abar"><div class="azone"></div><div class="aneedle" id="mNeedle"></div></div><div class="mtip" id="mTip"></div>`;
      n.addEventListener('pointerdown', e => { e.preventDefault(); GS.Input.press('action'); });
    }
    $('#mHead').textContent = kind === 'punt' ? 'PUNT' : kind === 'xp' ? 'EXTRA POINT' : 'FIELD GOAL · ' + Math.round(100 - GS.Game.cfg.los + 17) + ' YDS';
    $('#mFill').style.width = (m.power * 100).toFixed(1) + '%';
    $('#mNeedle').style.left = (50 + m.acc * 46).toFixed(1) + '%';
    n.classList.toggle('stage1', m.stage >= 1);
    const tch = GS.Input.mode === 'touch'; $('#mTip').textContent = m.stage === 0 ? (tch ? 'Tap to set power' : 'Press SPACE or click to set power') : m.stage === 1 ? (tch ? 'Tap in the gold zone for accuracy' : 'Press SPACE or click in the gold zone') : '';
  }

  // ------------------------------------------------ tutorial
  function tutorial() {
    const n = $('#tutorial'); n.hidden = false; GS.Game.paused = true;
    const touch = GS.Input.mode === 'touch';
    const C = GS.Game.ICON_COLORS, pad = GS.Input.device === 'gamepad';
    const glyphs = pad ? ['A', 'B', 'X', 'Y', 'RB'] : ['1', '2', '3', '4', '5'];
    const legend = `<div class="legend">${['X receiver', 'Z receiver', 'Slot', 'Tight end', 'Running back'].map((l, i) => `<span><i style="background:${C[i]}">${glyphs[i]}</i>${l}</span>`).join('')}</div>`;
    n.innerHTML = `<div class="mcard wide tut"><div class="card-head">HOW TO PLAY OFFENSE</div>
      <p style="margin:4px 0">Every receiver has a <b>color and a number</b>. His route is drawn on the field in that color, and the same icon floats over his head.</p>
      ${legend}
      <ol class="steps">
        ${touch ? `<li><b>Before the snap:</b> read the colored routes. Tap a receiver’s icon to give him a new route. Tap <b>SNAP</b> to start.</li>
        <li><b>Your QB drops back on his own.</b> Drag the left stick to move him in the pocket or scramble.</li>
        <li><b>Throw:</b> tap a receiver’s icon for a soft touch pass over defenders. <b>Hold</b> the icon for a hard bullet. Green <b>OPEN</b> means he’s free, red <b>COVERED</b> means a defender is on him.</li>
        <li><b>Aim:</b> hold the stick toward where you want the ball while you throw (forward = deeper, sideways = toward the sideline).</li>
        <li><b>After the catch</b> you control the receiver: stick to run, <b>SPRINT</b>, <b>JUKE</b>, <b>SPIN</b>, <b>DIVE</b>.</li>
        <li><b>Run plays:</b> the gold line is the path. After the handoff you control the runner.</li>`
      : `<li><b>Before the snap:</b> read the colored routes. Press ${glyphs.map(g => `<kbd>${g}</kbd>`).join('')} (or click an icon) to give that receiver a new route. Press <kbd>${pad ? 'A' : 'SPACE'}</kbd> to snap.</li>
        <li><b>Your QB drops back on his own.</b> Use ${pad ? 'the left stick' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows'} to move him in the pocket or scramble.</li>
        <li><b>Throw:</b> <b>tap</b> a receiver’s ${pad ? 'button' : 'number'} for a touch pass over defenders, <b>hold</b> it for a bullet. You can also click the icon. Green <b>OPEN</b> means he’s free, red <b>COVERED</b> means a defender is on him.</li>
        <li><b>Aim:</b> hold a direction while you throw to lead him (forward = deeper, sideways = toward the sideline).</li>
        <li><b>After the catch</b> you control the receiver: <kbd>${pad ? 'RT' : 'SHIFT'}</kbd> sprint, <kbd>${pad ? 'Y' : 'E'}</kbd> juke, <kbd>${pad ? 'B' : 'R'}</kbd> spin, <kbd>${pad ? 'X' : 'F'}</kbd> dive.</li>
`}
      </ol>
      <div class="card-head">DEFENSE</div>
      <ol class="steps">
        <li><b>Tackle:</b> the ball carrier has a <b>red ring</b>. Run into him, or <b>hold ${touch ? 'TACKLE' : `<kbd>${pad ? 'X' : 'F'}</kbd>`}</b> and your player chases him down and dives.</li>
        <li><b>Break up a pass:</b> a <b>white circle</b> shows where the ball will land and you take the closest defender. Get there and press <b>${touch ? 'SWAT' : `<kbd>${pad ? 'A' : 'SPACE'}</kbd>`}</b> to knock it down or <b>${touch ? 'PICK' : `<kbd>${pad ? 'X' : 'F'}</kbd>`}</b> to try for the interception, right as it arrives.</li>
        <li><b>Before the snap,</b> ${touch ? 'tap' : 'click'} any defender to play as him. <b>${touch ? 'SWITCH' : `<kbd>${pad ? 'A' : 'SPACE'}</kbd>`}</b> jumps to the defender closest to the ball during the play.</li>
      </ol>
      <div class="card-head">MORE</div>
      <ol class="steps">
        <li><b>${touch ? 'FIELD VIEW' : `<kbd>${pad ? 'D-pad ◀' : 'V'}</kbd>`}</b> before the snap lifts the camera so you can read the whole field.</li>
        <li><b>${touch ? 'CHALLENGE' : `<kbd>${pad ? 'D-pad ▶' : 'G'}</kbd>`}</b> after a play asks the officials to review it. You get two per game; a failed challenge costs a timeout.</li>
      </ol>
      <div class="row"><button class="btn gold big" id="tutOk"><span>Let's play</span></button></div></div>`;
    $('#tutOk').onclick = () => { n.hidden = true; lsSet('gs.tutorial4', '1'); GS.Game.paused = false; GS.Audio.select(); };
  }

  const UI = {
    init, showScreen: show, hideScreens, showHUD, hud, banner, flash, ticker, toast, replayTag, showPause, controls, frame, openHot, hideHot, hotOpen: () => hotOpen, kickMeter, tutorial, dataBanner, helmet,
  };
  GS.UI = UI;
})(window.GS);
