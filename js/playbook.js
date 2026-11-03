/* =========================================================================
   GS.Playbook — formations, plays, routes and diagram drawing
   Play space: x = lateral yards (+ = offense's right), dz = yards downfield
   from the line of scrimmage (negative = backfield).
   Offensive roles: QB RB X Z S TE LT LG C RG RT
   Defensive roles: LE DT NT RE WL ML LC RC NB FS SS   (nickel personnel)
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const OL = { LT: [-2.6, -0.8], LG: [-1.3, -0.7], C: [0, -0.6], RG: [1.3, -0.7], RT: [2.6, -0.8] };
  const F = {
    gun: { name: 'Shotgun', QB: [0, -5], RB: [-1.6, -5.2], X: [-20, -0.8], Z: [20, -1.4], S: [13, -1.4], TE: [3.9, -1] },
    single: { name: 'Singleback', QB: [0, -1.2], RB: [0, -6.5], X: [-19, -0.8], Z: [19, -1.4], S: [-12, -1.4], TE: [3.9, -1] },
    iform: { name: 'I-Form', QB: [0, -1.2], RB: [0, -7], X: [-19, -0.8], Z: [19, -1.4], S: [0, -4.4], TE: [3.9, -1] },
    trips: { name: 'Trips Right', QB: [0, -5], RB: [-1.6, -5.2], X: [-20, -0.8], Z: [21, -1.4], S: [15, -1.4], TE: [9, -1.4] },
    pistol: { name: 'Pistol', QB: [0, -3.8], RB: [0, -6.6], X: [-19, -0.8], Z: [18, -1.4], S: [-10, -1.4], TE: [-3.9, -1] },
    heavy: { name: 'Goal Line', QB: [0, -1.2], RB: [0, -6.2], X: [-9, -0.8], Z: [5.2, -1.2], S: [0, -4], TE: [3.9, -1] },
  };
  for (const k in F) Object.assign(F[k], OL);

  // Route templates for a receiver whose "outside" is +x (mirrored for left side).
  // settle: stop and sit at the end; else keep running along the last leg.
  const R = {
    go: { pts: [[0, 6], [0.4, 30]] }, seam: { pts: [[0, 4], [-1.5, 30]] },
    slant: { pts: [[0, 1.5], [-7, 8], [-14, 13]] }, out: { pts: [[0, 6], [9, 6.3]], settle: 1 },
    dig: { pts: [[0, 11], [-14, 11.5]] }, curl: { pts: [[0, 11], [-1.2, 9.5]], settle: 1 },
    post: { pts: [[0, 11], [-7, 26]] }, corner: { pts: [[0, 10], [7, 21]] },
    flat: { pts: [[2, 1], [8, 2.5]], settle: 1 }, wheel: { pts: [[4, 0], [8, 3], [8.5, 28]] },
    drag: { pts: [[0, 1.5], [-18, 4]] }, comeback: { pts: [[0, 14], [2.5, 11.5]], settle: 1 },
    hitch: { pts: [[0, 5.5], [-0.4, 4.5]], settle: 1 }, stick: { pts: [[0, 5.5], [-1.5, 5.5]], settle: 1 },
    screen: { pts: [[-2.5, -1.5], [-3.5, -1]], settle: 1 }, sit: { pts: [[0, 5], [0, 5]], settle: 1 },
    block: { block: 1, pts: [] },
  };
  const ROUTE_NAMES = { go: 'Go', seam: 'Seam', slant: 'Slant', out: 'Out', dig: 'Dig', curl: 'Curl', post: 'Post', corner: 'Corner', flat: 'Flat', wheel: 'Wheel', drag: 'Drag', comeback: 'Comeback', hitch: 'Hitch', stick: 'Stick', screen: 'Screen', sit: 'Sit', block: 'Block' };
  const HOT_ROUTES = ['go', 'slant', 'out', 'curl', 'post', 'flat', 'block'];

  // type: pass | run | pa (play-action) | screen | special
  const OFF = [
    { id: 'verts', name: 'Four Verticals', form: 'gun', type: 'pass', drop: 7, routes: { X: 'go', Z: 'go', S: 'seam', TE: 'seam', RB: 'flat' }, tag: 'Deep shot' },
    { id: 'mesh', name: 'Mesh', form: 'gun', type: 'pass', drop: 3, routes: { X: 'drag', S: 'drag', Z: 'corner', TE: 'sit', RB: 'flat' }, tag: 'Beats man' },
    { id: 'slants', name: 'Slant Flat', form: 'single', type: 'pass', drop: 3, routes: { X: 'slant', Z: 'slant', S: 'flat', TE: 'stick', RB: 'block' }, tag: 'Quick game' },
    { id: 'curlflat', name: 'Curl Flat', form: 'trips', type: 'pass', drop: 5, routes: { Z: 'curl', S: 'flat', TE: 'seam', X: 'post', RB: 'block' }, tag: 'Beats Cover 3' },
    { id: 'smash', name: 'Smash', form: 'gun', type: 'pass', drop: 5, routes: { X: 'hitch', Z: 'hitch', S: 'corner', TE: 'corner', RB: 'flat' }, tag: 'Beats Cover 2' },
    { id: 'boot', name: 'PA Boot', form: 'iform', type: 'pa', drop: 5, boot: 1, routes: { TE: 'drag', Z: 'corner', X: 'post', S: 'flat', RB: 'block' }, tag: 'Play action' },
    { id: 'deeppost', name: 'Deep Post', form: 'single', type: 'pass', drop: 7, routes: { X: 'post', Z: 'dig', S: 'go', TE: 'block', RB: 'block' }, tag: 'Max protect' },
    { id: 'screen', name: 'HB Screen', form: 'gun', type: 'screen', drop: 5, routes: { RB: 'screen', X: 'go', Z: 'go', S: 'go', TE: 'seam' }, tag: 'Vs. blitz' },
    { id: 'stick', name: 'Stick', form: 'trips', type: 'pass', drop: 3, routes: { S: 'stick', TE: 'flat', Z: 'go', X: 'slant', RB: 'block' }, tag: 'Move the sticks' },
    { id: 'comeback', name: 'Comebacks', form: 'pistol', type: 'pass', drop: 5, routes: { X: 'comeback', Z: 'comeback', S: 'dig', TE: 'stick', RB: 'flat' }, tag: 'Sideline' },
    { id: 'wheel', name: 'HB Wheel', form: 'gun', type: 'pass', drop: 5, routes: { RB: 'wheel', S: 'slant', Z: 'go', X: 'dig', TE: 'block' }, tag: 'Beats LBs' },
    { id: 'izone', name: 'Inside Zone', form: 'single', type: 'run', carrier: 'RB', path: [[0.6, -4], [1.2, 0.5], [1, 8]], side: 1, tag: 'Downhill' },
    { id: 'power', name: 'Power O', form: 'iform', type: 'run', carrier: 'RB', path: [[1.5, -4.5], [3.2, 0.3], [3.4, 8]], side: 1, lead: 'S', tag: 'Off tackle' },
    { id: 'toss', name: 'Toss Sweep', form: 'pistol', type: 'run', carrier: 'RB', toss: 1, path: [[6, -5], [10, -1.5], [11, 6]], side: 1, tag: 'Edge speed' },
    { id: 'draw', name: 'HB Draw', form: 'gun', type: 'run', carrier: 'RB', delay: 0.7, path: [[-0.6, -5], [-0.3, 0.5], [0, 9]], side: 0, tag: 'Vs. pass rush' },
    { id: 'counter', name: 'Counter', form: 'single', type: 'run', carrier: 'RB', path: [[1.2, -6], [-1.4, -3.5], [-3, 0.5], [-3.5, 8]], side: -1, tag: 'Misdirection' },
    { id: 'sneak', name: 'QB Sneak', form: 'heavy', type: 'run', carrier: 'QB', path: [[0.2, -0.6], [0.4, 4]], side: 0, tag: 'Short yardage' },
  ];
  const SPECIAL = [
    { id: 'punt', name: 'Punt', type: 'punt' },
    { id: 'fg', name: 'Field Goal', type: 'fg' },
    { id: 'kneel', name: 'QB Kneel', form: 'single', type: 'kneel' },
    { id: 'spike', name: 'Spike Ball', form: 'single', type: 'spike' },
  ];

  // Defensive alignment (x, dz) — dz positive = toward defense's side.
  const DALIGN = {
    LE: [-3.6, 0.9], DT: [-1.0, 0.9], NT: [1.0, 0.9], RE: [3.6, 0.9],
    WL: [-2.8, 4.8], ML: [2.2, 4.8], LC: [-19.5, 6.5], RC: [19.5, 6.5], NB: [12, 5.5], FS: [-7, 13], SS: [7, 12],
  };
  const Z = { // zone landmarks (x, dz)
    dL: [-16, 18], dM: [0, 21], dR: [16, 18], hL: [-11, 17], hR: [11, 17], q1: [-18, 16], q2: [-6, 19], q3: [6, 19], q4: [18, 16],
    fL: [-17, 4], fR: [17, 4], cL: [-9, 9], cR: [9, 9], mid: [0, 9], deepmid: [0, 15], hole: [0, 6],
  };
  const D = [
    { id: 'c2', name: 'Cover 2', tag: 'Two-deep zone', a: { LC: 'z:fL', RC: 'z:fR', FS: 'z:hL', SS: 'z:hR', WL: 'z:cL', ML: 'z:mid', NB: 'z:cR' } },
    { id: 'c3', name: 'Cover 3', tag: 'Three-deep zone', a: { LC: 'z:dL', RC: 'z:dR', FS: 'z:dM', SS: 'z:cR', WL: 'z:cL', ML: 'z:mid', NB: 'z:fR' } },
    { id: 'c1', name: 'Cover 1 Man', tag: 'Man + deep help', a: { LC: 'm:X', RC: 'm:Z', NB: 'm:S', SS: 'm:TE', WL: 'm:RB', ML: 'z:hole', FS: 'z:deepmid' } },
    { id: 'c0', name: 'Cover 0 Blitz', tag: 'All-out pressure', a: { LC: 'm:X', RC: 'm:Z', NB: 'm:S', SS: 'm:TE', FS: 'm:RB', WL: 'blitz', ML: 'blitz' } },
    { id: 'c4', name: 'Cover 4', tag: 'Quarters', a: { LC: 'z:q1', RC: 'z:q4', FS: 'z:q2', SS: 'z:q3', WL: 'z:fL', ML: 'z:mid', NB: 'z:fR' } },
    { id: 't2', name: 'Tampa 2', tag: 'Mike runs the pole', a: { LC: 'z:fL', RC: 'z:fR', FS: 'z:hL', SS: 'z:hR', WL: 'z:cL', ML: 'z:deepmid', NB: 'z:cR' } },
    { id: 'fire', name: 'Fire Zone', tag: '5-man zone pressure', a: { LC: 'z:dL', RC: 'z:dR', FS: 'z:dM', SS: 'z:cR', NB: 'blitz', WL: 'blitz', LE: 'z:fL', ML: 'z:mid' } },
    { id: 'c2m', name: '2-Man Under', tag: 'Man under, two deep', a: { LC: 'm:X', RC: 'm:Z', NB: 'm:S', SS: 'z:hR', FS: 'z:hL', WL: 'm:RB', ML: 'm:TE' } },
    { id: 'nblitz', name: 'Nickel Blitz', tag: 'Slot pressure', a: { LC: 'm:X', RC: 'm:Z', SS: 'm:S', ML: 'm:TE', WL: 'm:RB', FS: 'z:deepmid', NB: 'blitz' } },
    { id: 'zblitz', name: 'Zone Blitz', tag: 'Tackle drops', a: { LC: 'z:dL', RC: 'z:dR', FS: 'z:dM', NB: 'z:fR', SS: 'z:cR', DT: 'z:mid', WL: 'blitz', ML: 'blitz' } },
    { id: 'prevent', name: 'Prevent', tag: 'Nothing deep', a: { LC: 'z:q1', RC: 'z:q4', FS: 'z:q2', SS: 'z:q3', WL: 'z:cL', ML: 'z:mid', NB: 'z:cR', NT: 'z:hole' } },
    { id: 'runstop', name: 'Run Stop', tag: 'Eight in the box', align: { SS: [3.5, 5], FS: [-2, 9], NB: [7, 4.2] }, a: { LC: 'm:X', RC: 'm:Z', NB: 'run', SS: 'run', WL: 'run', ML: 'run', FS: 'z:deepmid' } },
    { id: 'robber', name: 'Robber', tag: 'Rob the dig', a: { LC: 'm:X', RC: 'm:Z', NB: 'm:S', WL: 'm:RB', ML: 'm:TE', SS: 'z:mid', FS: 'z:deepmid' } },
    { id: 'c6', name: 'Cover 6', tag: 'Quarter-quarter-half', a: { LC: 'z:fL', RC: 'z:q4', SS: 'z:q3', FS: 'z:hL', WL: 'z:cL', ML: 'z:mid', NB: 'z:cR' } },
  ];
  // every defender not listed rushes
  D.forEach(p => { for (const r of Object.keys(DALIGN)) if (!p.a[r]) p.a[r] = 'rush'; });

  function routePoints(name, align) { // returns absolute (x,dz) waypoints from alignment
    const t = R[name] || R.go; const s = align[0] >= 0 ? 1 : -1;
    // backfield receivers release to the side of the call
    return t.pts.map(([dx, dz]) => [align[0] + dx * s, Math.max(align[1] + dz, dz)]);
  }

  // ---------------- diagrams ----------------
  const INK = '#13213A', CHALK = '#F4F6F0', GOLD = '#FFC83D', COBALT = '#1F4FD8', RED = '#E4372C';
  function drawArrow(g, pts, color, dashed) {
    if (pts.length < 2) return;
    g.strokeStyle = color; g.lineWidth = 2; g.setLineDash(dashed ? [4, 3] : []); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke(); g.setLineDash([]);
    const a = pts[pts.length - 1], b = pts[pts.length - 2], ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
    g.fillStyle = color; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[0] - 7 * Math.cos(ang - 0.45), a[1] - 7 * Math.sin(ang - 0.45)); g.lineTo(a[0] - 7 * Math.cos(ang + 0.45), a[1] - 7 * Math.sin(ang + 0.45)); g.fill();
  }
  function diagram(canvas, play, side) {
    const W = canvas.width, H = canvas.height, g = canvas.getContext('2d');
    g.fillStyle = '#2F7A3A'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < 6; i++) if (i % 2) g.fillRect(0, i * H / 6, W, H / 6);
    const sx = W / 50, losY = H * 0.62, sz = H / 34;
    const P = (x, dz) => [W / 2 + x * sx, losY - dz * sz];
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, losY); g.lineTo(W, losY); g.stroke();
    if (side === 'off' && play.type !== 'punt' && play.type !== 'fg') {
      const f = F[play.form || 'gun'];
      if (play.type === 'run') { const c = f[play.carrier]; drawArrow(g, [P(c[0], c[1]), ...play.path.map(p => P(p[0], p[1]))], GOLD); }
      for (const r of ['X', 'Z', 'S', 'TE', 'RB']) {
        const rt = play.routes && play.routes[r]; if (!rt) continue;
        if (rt === 'block') { const p = P(f[r][0], f[r][1]); g.strokeStyle = CHALK; g.lineWidth = 2; g.beginPath(); g.moveTo(p[0] - 5, p[1] - 6); g.lineTo(p[0] + 5, p[1] - 6); g.stroke(); continue; }
        const pts = routePoints(rt, f[r]).map(p => P(p[0], Math.min(p[1], 24)));
        drawArrow(g, [P(f[r][0], f[r][1]), ...pts], r === 'RB' || r === 'TE' ? '#FFFFFF' : GOLD);
      }
      if (play.boot) drawArrow(g, [P(0, -1.2), P(4, -5), P(8, -4)], '#9FD0FF', true);
      for (const k in f) { if (k === 'name') continue; const p = P(f[k][0], f[k][1]); g.fillStyle = k === 'QB' ? GOLD : CHALK; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(p[0], p[1], 4.2, 0, 7); g.fill(); g.stroke(); }
    } else if (side === 'def') {
      const f = F.gun;
      for (const k in f) { if (k === 'name') continue; const p = P(f[k][0], f[k][1]); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.2; g.beginPath(); g.arc(p[0], p[1], 3.4, 0, 7); g.stroke(); }
      for (const r in DALIGN) {
        const al = (play.align && play.align[r]) || DALIGN[r]; const p = P(al[0], al[1]); const as = play.a[r];
        if (as.startsWith('z:')) { const z = Z[as.slice(2)]; const q = P(z[0], z[1]); const deep = z[1] > 14; g.fillStyle = deep ? 'rgba(31,79,216,0.55)' : 'rgba(255,200,61,0.55)'; g.beginPath(); g.ellipse(q[0], q[1], deep ? 15 : 11, deep ? 8 : 6, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
        else if (as.startsWith('m:')) { const t = f[as.slice(2)]; const q = P(t[0], t[1] + 1.5); drawArrow(g, [p, q], '#FFFFFF', true); }
        else if (as === 'blitz' || as === 'rush' || as === 'run') { drawArrow(g, [p, P(al[0] * 0.6, -3.5)], as === 'rush' ? 'rgba(255,255,255,0.8)' : RED); }
        g.strokeStyle = as === 'blitz' ? RED : CHALK; g.lineWidth = 2.4; g.beginPath(); g.moveTo(p[0] - 3.6, p[1] - 3.6); g.lineTo(p[0] + 3.6, p[1] + 3.6); g.moveTo(p[0] + 3.6, p[1] - 3.6); g.lineTo(p[0] - 3.6, p[1] + 3.6); g.stroke();
      }
    } else {
      g.fillStyle = CHALK; g.font = '700 26px "Big Shoulders Display", Impact, sans-serif'; g.textAlign = 'center';
      g.fillText(play.type === 'punt' ? 'PUNT' : play.type === 'fg' ? 'FIELD GOAL' : play.name.toUpperCase(), W / 2, H / 2 + 8);
    }
  }

  GS.Playbook = { F, R, OFF, SPECIAL, D, DALIGN, Z, routePoints, diagram, ROUTE_NAMES, HOT_ROUTES,
    offById: id => OFF.concat(SPECIAL).find(p => p.id === id), defById: id => D.find(p => p.id === id) };
})(window.GS);
