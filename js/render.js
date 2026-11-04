/* =========================================================================
   GS.Render — Three.js scene: stadium, field, crowd, low-poly players with
   blended procedural animation, ball, broadcast cameras, replays, effects.
   World mapping: worldX = -playX, worldZ = playZ, 1 unit = 1 yard.
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  let THREE, renderer, scene, camera, clock;
  let fieldMesh, fieldTex, fieldCanvas, losLine, fdLine, sun, hemi, crowd, crowdMat, board, boardCanvas, boardTex;
  let ballMesh, shadowMesh, ringUser, ringTarget, ringCarrier, ringLand, particles, confetti;
  const rigs = []; let quality = 'medium';
  const camState = { pos: null, look: null, shake: 0, fovKick: 0, mode: 'auto', replayCam: 0 };
  const W = (x) => -x;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------- geometry helpers
  function colored(geo, hex) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return geo;
  }
  function merge(geos) {
    let total = 0; geos.forEach(g => total += g.attributes.position.count);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3); let o = 0;
    for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('color', new THREE.BufferAttribute(col, 3)); return m;
  }
  function box(w, h, d, x, y, z, hex) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x || 0, y || 0, z || 0); return colored(g, hex); }
  function cyl(rt, rb, h, seg, x, y, z, hex) { const g = new THREE.CylinderGeometry(rt, rb, h, seg || 6); g.translate(x || 0, y || 0, z || 0); return colored(g, hex); }

  // ---------------------------------------------------------------- init
  function init(container, q) {
    THREE = window.THREE;
    quality = q || 'medium';
    const touch = GS.Input.mode === 'touch';
    renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: 'high-performance' });
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = quality === 'high'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#9FCBEF');
    scene.fog = new THREE.Fog('#BFDDF5', 140, 320);
    camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.3, 600);
    camera.position.set(0, 12, -15);
    camState.pos = new THREE.Vector3(0, 12, -15); camState.look = new THREE.Vector3(0, 0, 10);
    hemi = new THREE.HemisphereLight('#E8F3FF', '#4C7A3A', 0.75); scene.add(hemi);
    sun = new THREE.DirectionalLight('#FFF6E0', 1.0); sun.position.set(-40, 80, 20); scene.add(sun); scene.add(sun.target);
    sun.shadow.mapSize.set(1024, 1024); const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 10; sc.far = 200; sun.shadow.bias = -0.0008;
    sun.castShadow = quality === 'high';
    buildField(); buildStadium(); buildBall(); buildFx();
    clock = new THREE.Clock();
    window.addEventListener('resize', () => resize(container));
    window.addEventListener('orientationchange', () => setTimeout(() => resize(container), 250));
  }
  function pixelRatio() { const dpr = window.devicePixelRatio || 1; return quality === 'low' ? Math.min(1, dpr) : quality === 'medium' ? Math.min(1.5, dpr) : Math.min(2, dpr); }
  function resize(container) { if (!renderer) return; const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function setQuality(q) {
    quality = q; if (!renderer) return;
    renderer.setPixelRatio(pixelRatio()); renderer.shadowMap.enabled = q === 'high'; sun.castShadow = q === 'high';
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    if (crowd) crowd.count = q === 'low' ? Math.floor(crowd.userData.max * 0.4) : q === 'medium' ? Math.floor(crowd.userData.max * 0.7) : crowd.userData.max;
    rigs.forEach(r => { r.mask.visible = q !== 'low'; r.meshes.forEach(m => m.castShadow = q === 'high'); });
    resize(renderer.domElement.parentElement);
  }

  // ---------------------------------------------------------------- field
  function buildField() {
    fieldCanvas = document.createElement('canvas'); fieldCanvas.width = 1024; fieldCanvas.height = 2048;
    fieldTex = new THREE.CanvasTexture(fieldCanvas); fieldTex.encoding = THREE.sRGBEncoding;
    fieldTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const geo = new THREE.PlaneGeometry(53.33, 120); geo.rotateX(-Math.PI / 2);
    fieldMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: fieldTex })); fieldMesh.position.set(0, 0, 50); fieldMesh.receiveShadow = true; scene.add(fieldMesh);
    // the plane's +v is world -z; flip so canvas row 0 = z -10
    fieldTex.flipY = false; // canvas row 0 -> v=0 -> local -y?  handled by drawing with the mapping below
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(90, 150).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#2E6B34' }));
    apron.position.set(0, -0.02, 50); apron.receiveShadow = true; scene.add(apron);
    const track = new THREE.Mesh(new THREE.PlaneGeometry(130, 190).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#7A5C48' }));
    track.position.set(0, -0.05, 50); scene.add(track);
    const lineMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    losLine = new THREE.Mesh(new THREE.PlaneGeometry(53.33, 0.22).rotateX(-Math.PI / 2), lineMat('#2F62F0')); losLine.position.y = 0.03; scene.add(losLine);
    fdLine = new THREE.Mesh(new THREE.PlaneGeometry(53.33, 0.26).rotateX(-Math.PI / 2), lineMat('#FFC83D')); fdLine.position.y = 0.035; scene.add(fdLine);
    // goal posts
    const postMat = new THREE.MeshLambertMaterial({ color: '#F7D33C' });
    for (const z of [-10, 110]) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.33, 8), postMat); base.position.set(0, 1.66, z + (z > 0 ? 1.2 : -1.2)); g.add(base);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1.2), postMat); neck.position.set(0, 3.33, z + (z > 0 ? 0.6 : -0.6)); g.add(neck);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.17, 8), postMat); bar.rotation.z = Math.PI / 2; bar.position.set(0, 3.33, z); g.add(bar);
      for (const x of [-3.08, 3.08]) { const up = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 11.7, 8), postMat); up.position.set(x, 3.33 + 5.85, z); g.add(up); const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.2), new THREE.MeshBasicMaterial({ color: '#E4372C', side: THREE.DoubleSide })); fl.position.set(x, 15.3, z); g.add(fl); }
      scene.add(g);
    }
    drawField(null);
  }

  function drawField(home) {
    const c = fieldCanvas, g = c.getContext('2d'), Wd = c.width, H = c.height;
    // canvas x: u -> world x from -26.67..26.67 ; canvas y: v -> local... with flipY=false and rotateX(-90),
    // v=0 maps to local y=-60 -> world z=+60+50=110. So row 0 = z 110 (far end zone).
    const py = z => (110 - z) / 120 * H; const px = worldX => (worldX + 26.665) / 53.33 * Wd; const pxPlay = x => px(W(x));
    const yd = H / 120;
    // turf: mowing stripes every 5 yards
    for (let z = -10; z < 110; z += 5) { g.fillStyle = (Math.floor((z + 10) / 5) % 2) ? '#3D8B45' : '#36813F'; g.fillRect(0, py(z + 5), Wd, yd * 5 + 1); }
    // end zones
    const ez = home ? home.c1 : '#1F4FD8', ez2 = home ? home.c2 : '#FFC83D';
    g.fillStyle = ez; g.fillRect(0, py(110), Wd, yd * 10); g.fillRect(0, py(0), Wd, yd * 10);
    g.save(); g.globalAlpha = 0.22; g.fillStyle = '#000'; for (let i = -20; i < 40; i++) { g.beginPath(); g.moveTo(i * 40, py(110)); g.lineTo(i * 40 + 20, py(110)); g.lineTo(i * 40 + 20 + yd * 10, py(100)); g.lineTo(i * 40 + yd * 10, py(100)); g.fill(); g.beginPath(); g.moveTo(i * 40, py(0)); g.lineTo(i * 40 + 20, py(0)); g.lineTo(i * 40 + 20 + yd * 10, py(-10)); g.lineTo(i * 40 + yd * 10, py(-10)); g.fill(); } g.restore();
    const ezText = (txt, z, rot) => { g.save(); g.translate(Wd / 2, py(z)); g.rotate(rot); g.font = `900 ${Math.round(yd * 6.2)}px "Big Shoulders Display", Impact, "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = yd * 0.6; g.strokeStyle = ez2; g.fillStyle = '#FFFFFF'; g.strokeText(txt, 0, 0); g.fillText(txt, 0, 0); g.restore(); };
    ezText((home ? home.name : 'GRIDIRON').toUpperCase(), 105, Math.PI); ezText((home ? home.city : 'SUNDAY').toUpperCase(), -5, 0);
    // lines
    g.fillStyle = '#FFFFFF';
    const lw = Math.max(3, yd * 0.22);
    g.fillRect(0, 0, lw * 2, H); g.fillRect(Wd - lw * 2, 0, lw * 2, H);
    for (let z = 0; z <= 100; z += 5) g.fillRect(lw * 2, py(z) - lw / 2, Wd - lw * 4, lw);
    g.fillRect(0, py(110), Wd, lw * 2); g.fillRect(0, py(-10) - lw * 2, Wd, lw * 2);
    // hash marks & sideline ticks
    for (let z = 1; z < 100; z++) {
      if (z % 5 === 0) continue;
      for (const hx of [-3.08, 3.08]) g.fillRect(pxPlay(hx) - yd * 0.33, py(z) - lw / 3, yd * 0.66, lw * 0.66);
      g.fillRect(lw * 2, py(z) - lw / 3, yd * 0.8, lw * 0.66); g.fillRect(Wd - lw * 2 - yd * 0.8, py(z) - lw / 3, yd * 0.8, lw * 0.66);
      g.fillRect(pxPlay(-8.9) - yd * 0.33, py(z) - lw / 3, yd * 0.66, lw * 0.66); g.fillRect(pxPlay(8.9) - yd * 0.33, py(z) - lw / 3, yd * 0.66, lw * 0.66);
    }
    // numbers (read from each sideline)
    g.font = `700 ${Math.round(yd * 2.2)}px "Big Shoulders Display", Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let z = 10; z <= 90; z += 10) {
      const n = String(z <= 50 ? z : 100 - z);
      for (const side of [-1, 1]) {
        const x = pxPlay(side * 14.5);
        g.save(); g.translate(x, py(z)); g.rotate(side * Math.PI / 2 * -1);
        g.fillText(n.split('').join('  '), 0, 0);
        // direction arrow
        if (z !== 50) { const dir = z < 50 ? 1 : -1; g.beginPath(); const ax = dir * -side * yd * 1.9; g.moveTo(ax + side * dir * yd * 0.5, -yd * 1.2); g.lineTo(ax, -yd * 1.2 - yd * 0.45); g.lineTo(ax, -yd * 1.2 + yd * 0.45); g.closePath(); g.fill(); }
        g.restore();
      }
    }
    // midfield emblem: original shield-star in home colors
    g.save(); g.translate(Wd / 2, py(50)); const r = yd * 4.2;
    g.fillStyle = ez; g.strokeStyle = '#FFFFFF'; g.lineWidth = yd * 0.35;
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.85, -r * 0.55); g.lineTo(r * 0.7, r * 0.45); g.lineTo(0, r); g.lineTo(-r * 0.7, r * 0.45); g.lineTo(-r * 0.85, -r * 0.55); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = ez2; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.22 : r * 0.52; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill();
    g.restore();
    fieldTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- stadium
  function buildStadium() {
    const standMat = new THREE.MeshLambertMaterial({ color: '#C9CDD2' });
    const seatMat = new THREE.MeshLambertMaterial({ color: '#4A5A78' });
    const tiers = 9;
    const group = new THREE.Group(); scene.add(group);
    const sides = [
      { cx: 0, cz: 50, along: 'z', len: 150, off: 38, dir: 1 }, { cx: 0, cz: 50, along: 'z', len: 150, off: 38, dir: -1 },
      { cx: 0, cz: 50, along: 'x', len: 95, off: 86, dir: 1 }, { cx: 0, cz: 50, along: 'x', len: 95, off: 86, dir: -1 },
    ];
    const seatSpots = [], standGeos = [];
    for (const s of sides) {
      for (let t = 0; t < tiers; t++) {
        const depth = 2.2, h = 1.4, o = s.off + t * depth, y = t * h + 0.7;
        const geo = new THREE.BoxGeometry(s.along === 'z' ? depth : s.len + t * 4, h, s.along === 'z' ? s.len + t * 4 : depth);
        if (s.along === 'z') geo.translate(s.dir * o, y, s.cz); else geo.translate(0, y, s.cz + s.dir * o);
        standGeos.push(colored(geo, t % 3 === 2 ? '#C9CDD2' : '#4A5A78'));
        const L = s.len + t * 4;
        for (let k = 0; k < L; k += 0.85) seatSpots.push({ x: s.along === 'z' ? s.dir * o : -L / 2 + k, z: s.along === 'z' ? s.cz - L / 2 + k : s.cz + s.dir * o, y: y + h / 2, rot: s.along === 'z' ? (s.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : (s.dir > 0 ? Math.PI : 0) });
      }
      // roof fascia band
      const fg = new THREE.BoxGeometry(s.along === 'z' ? 2 : s.len + 40, 3, s.along === 'z' ? s.len + 40 : 2);
      const o = s.off + tiers * 2.2 + 1; if (s.along === 'z') fg.translate(s.dir * o, tiers * 1.4 + 3, s.cz); else fg.translate(0, tiers * 1.4 + 3, s.cz + s.dir * o);
      standGeos.push(colored(fg, '#1F2A44'));
    }
    group.add(new THREE.Mesh(merge(standGeos), new THREE.MeshLambertMaterial({ vertexColors: true })));
    // crowd: instanced fans with a bounce driven in the vertex shader
    const max = Math.min(seatSpots.length, 7000);
    const fanGeo = new THREE.BoxGeometry(0.5, 0.8, 0.35); fanGeo.translate(0, 0.4, 0);
    const phase = new Float32Array(max), rate = new Float32Array(max);
    crowdMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    crowdMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = { value: 0 }; sh.uniforms.uExcite = { value: 0.2 }; crowdMat.userData.sh = sh;
      sh.vertexShader = 'uniform float uTime; uniform float uExcite; attribute float aPhase; attribute float aRate;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); float jb = max(0.0, sin(uTime * aRate + aPhase)); transformed.y += jb * uExcite * 0.55; transformed.x *= 1.0 + 0.08*sin(uTime*1.3+aPhase);');
    };
    crowd = new THREE.InstancedMesh(fanGeo, crowdMat, max);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    // step through seats so the fill is even
    const stepK = seatSpots.length / max;
    for (let i = 0; i < max; i++) {
      const s = seatSpots[Math.floor(i * stepK)];
      q.setFromAxisAngle(up, s.rot + (Math.random() - 0.5) * 0.4); const h = 0.85 + Math.random() * 0.3; sc.set(1, h, 1);
      m4.compose(new THREE.Vector3(s.x + (Math.random() - 0.5) * 0.3, s.y, s.z + (Math.random() - 0.5) * 0.3), q, sc); crowd.setMatrixAt(i, m4);
      crowd.setColorAt(i, col.set('#888888'));
      phase[i] = Math.random() * 6.28; rate[i] = 6 + Math.random() * 6;
    }
    fanGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1)); fanGeo.setAttribute('aRate', new THREE.InstancedBufferAttribute(rate, 1));
    crowd.userData.max = max; crowd.count = quality === 'low' ? Math.floor(max * 0.4) : quality === 'medium' ? Math.floor(max * 0.7) : max;
    scene.add(crowd);
    // light towers
    const poleMat = new THREE.MeshLambertMaterial({ color: '#8E96A3' }), lampMat = new THREE.MeshBasicMaterial({ color: '#FFFBE8' });
    for (const [x, z] of [[-62, -20], [62, -20], [-62, 120], [62, 120]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 42, 6), poleMat); pole.position.set(x, 21, z); scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 1), lampMat); lamp.position.set(x, 43, z); lamp.lookAt(0, 0, 50); scene.add(lamp);
    }
    // video board behind the north end zone
    boardCanvas = document.createElement('canvas'); boardCanvas.width = 512; boardCanvas.height = 192;
    boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.encoding = THREE.sRGBEncoding;
    board = new THREE.Mesh(new THREE.PlaneGeometry(36, 13.5), new THREE.MeshBasicMaterial({ map: boardTex }));
    board.position.set(0, 28, 50 + 86 + 9 * 2.2 + 4); board.rotation.y = Math.PI; scene.add(board);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(38, 15.5, 1), new THREE.MeshLambertMaterial({ color: '#13213A' })); frame.position.copy(board.position); frame.position.z += 0.6; scene.add(frame);
    const board2 = board.clone(); board2.position.set(0, 28, 50 - 86 - 9 * 2.2 - 4); board2.rotation.y = 0; scene.add(board2);
    const frame2 = frame.clone(); frame2.position.copy(board2.position); frame2.position.z -= 0.6; scene.add(frame2);
  }

  function setCrowdColors(home, away) {
    const col = new THREE.Color(), pal = [home.c1, home.c1, home.c1, home.c2, home.c2, '#FFFFFF', '#E9E4DA', away.c1, '#2B2B2B', '#D9B98F'];
    for (let i = 0; i < crowd.userData.max; i++) crowd.setColorAt(i, col.set(pal[Math.floor(Math.random() * pal.length)]));
    crowd.instanceColor.needsUpdate = true;
  }

  function drawBoard(G) {
    const g = boardCanvas.getContext('2d'), w = boardCanvas.width, h = boardCanvas.height;
    g.fillStyle = '#0E1B2C'; g.fillRect(0, 0, w, h);
    if (!G) { g.fillStyle = '#FFC83D'; g.font = '900 64px "Big Shoulders Display", Impact, sans-serif'; g.textAlign = 'center'; g.fillText('GRIDIRON SUNDAY', w / 2, h / 2 + 22); boardTex.needsUpdate = true; return; }
    const half = (t, sc, x) => { g.fillStyle = t.c1; g.fillRect(x, 20, w / 2 - 30, 110); g.fillStyle = '#FFFFFF'; g.font = '800 46px "Big Shoulders Display", Impact, sans-serif'; g.textAlign = 'left'; g.fillText(t.abbr, x + 14, 92); g.textAlign = 'right'; g.font = '900 84px "Big Shoulders Display", Impact, sans-serif'; g.fillText(String(sc), x + w / 2 - 44, 106); };
    half(G.away, G.score.away, 20); half(G.home, G.score.home, w / 2 + 10);
    g.fillStyle = '#FFC83D'; g.font = '700 34px "Barlow Semi Condensed", Arial, sans-serif'; g.textAlign = 'center';
    const q = G.quarter > 4 ? 'OT' : 'Q' + G.quarter; const m = Math.floor(G.clock / 60), s = Math.floor(G.clock % 60);
    g.fillText(`${q}   ${m}:${String(s).padStart(2, '0')}`, w / 2, 170);
    boardTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- players
  const SKIN = ['#8D5524', '#C68642', '#E0AC69', '#6B3E1F', '#F1C27D'];
  function numberTexture(num, last, fg, stroke, withName) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (withName) { g.font = '700 17px "Barlow Semi Condensed", Arial Narrow, sans-serif'; g.fillStyle = fg; g.fillText(String(last || '').toUpperCase().slice(0, 12), 64, 16); }
    g.font = `900 ${withName ? 84 : 92}px "Big Shoulders Display", Impact, sans-serif`; g.lineWidth = 7; g.strokeStyle = stroke; g.fillStyle = fg;
    const y = withName ? 76 : 66; g.strokeText(String(num), 64, y); g.fillText(String(num), 64, y);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }

  function teamLook(team, homeSide) {
    // home: color jerseys; away: white jerseys with team-color numbers
    const dark = homeSide;
    const jersey = dark ? team.c1 : '#F4F6F0', trim = dark ? team.c2 : team.c1;
    const numFg = dark ? (GS.Data.colorDist(team.c1, '#FFFFFF') < 120 ? '#13213A' : '#FFFFFF') : team.c1;
    const numStroke = dark ? team.c2 : team.c2 === '#FFFFFF' ? '#13213A' : team.c2;
    const pants = dark ? (GS.Data.colorDist(team.c2, '#101820') < 60 ? '#E6E1D5' : team.c2) : (GS.Data.colorDist(team.c2, '#FFFFFF') < 60 ? team.c1 : team.c2);
    const helmet = GS.Data.colorDist(team.c1, '#FFFFFF') < 90 ? team.c2 : team.c1;
    return { jersey, trim, numFg, numStroke, pants, helmet, stripe: team.c2 === helmet ? '#FFFFFF' : team.c2 };
  }

  function makeRig(look, skin) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const root = new THREE.Group();
    const hips = new THREE.Group(); hips.position.y = 1.0; root.add(hips);
    const pelvis = new THREE.Mesh(merge([box(0.46, 0.26, 0.3, 0, 0, 0, look.pants), box(0.48, 0.05, 0.31, 0, 0.12, 0, look.trim)]), mat); hips.add(pelvis);
    const torso = new THREE.Group(); torso.position.y = 0.12; hips.add(torso);
    const chest = new THREE.Mesh(merge([
      box(0.5, 0.52, 0.32, 0, 0.27, 0, look.jersey), box(0.86, 0.2, 0.48, 0, 0.56, 0, look.jersey), box(0.6, 0.08, 0.44, 0, 0.67, 0, look.jersey),
      box(0.76, 0.04, 0.43, 0, 0.47, 0, look.trim), box(0.12, 0.12, 0.12, 0, 0.66, 0, skin),
    ]), mat); torso.add(chest);
    const head = new THREE.Group(); head.position.y = 0.82; torso.add(head);
    const helmetGeo = new THREE.SphereGeometry(0.205, 12, 9); helmetGeo.scale(1, 1.0, 1.15);
    const helm = new THREE.Mesh(merge([colored(helmetGeo, look.helmet), box(0.05, 0.03, 0.42, 0, 0.18, -0.01, look.stripe), box(0.3, 0.08, 0.04, 0, -0.05, 0.2, skin)]), mat); head.add(helm);
    const mask = new THREE.Mesh(merge([box(0.3, 0.03, 0.04, 0, -0.02, 0.23, '#B8BEC6'), box(0.28, 0.03, 0.04, 0, -0.1, 0.22, '#B8BEC6'), box(0.03, 0.12, 0.04, 0, -0.06, 0.235, '#B8BEC6')]), mat); head.add(mask);
    const numMatF = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false }), numMatB = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
    const nf = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), numMatF); nf.position.set(0, 0.3, 0.152); torso.add(nf);
    const nb = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), numMatB); nb.position.set(0, 0.32, -0.152); nb.rotation.y = Math.PI; torso.add(nb);
    const arm = (s) => {
      const sh = new THREE.Group(); sh.position.set(s * 0.36, 0.54, 0); torso.add(sh);
      const up = new THREE.Mesh(merge([box(0.17, 0.3, 0.17, 0, -0.14, 0, look.jersey), box(0.175, 0.05, 0.175, 0, -0.26, 0, look.trim)]), mat); sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.31; sh.add(el);
      const fo = new THREE.Mesh(merge([box(0.12, 0.28, 0.12, 0, -0.13, 0, skin), box(0.14, 0.11, 0.13, 0, -0.3, 0, '#1E2228')]), mat); el.add(fo);
      return { sh, el, meshes: [up, fo] };
    };
    const leg = (s) => {
      const hp = new THREE.Group(); hp.position.set(s * 0.13, -0.08, 0); hips.add(hp);
      const th = new THREE.Mesh(box(0.19, 0.44, 0.2, 0, -0.21, 0, look.pants), mat); hp.add(th);
      const kn = new THREE.Group(); kn.position.y = -0.43; hp.add(kn);
      const sn = new THREE.Mesh(merge([box(0.15, 0.4, 0.15, 0, -0.2, 0, look.jersey === '#F4F6F0' ? look.trim : look.jersey), box(0.17, 0.1, 0.3, 0, -0.43, 0.05, '#15171C')]), mat); kn.add(sn);
      return { hp, kn, meshes: [th, sn] };
    };
    const aL = arm(-1), aR = arm(1), lL = leg(-1), lR = leg(1);
    const meshes = [pelvis, chest, helm, mask, ...aL.meshes, ...aR.meshes, ...lL.meshes, ...lR.meshes];
    meshes.forEach(m => { m.castShadow = quality === 'high'; });
    root.visible = false; scene.add(root);
    return { root, hips, torso, head, aL, aR, lL, lR, mask, nf, nb, numMatF, numMatB, meshes, mat, pose: newPose(), look };
  }
  function newPose() { return { run: 0, crouch: 0, lean: 0, block: 0, armsUp: 0, fall: 0, dive: 0, kneel: 0, reach: 0, kick: 0, jukeLean: 0 }; }

  let rigsFor = null;
  function setupTeams(home, away) {
    rigs.forEach(r => { scene.remove(r.root); r.meshes.forEach(m => m.geometry.dispose()); });
    rigs.length = 0;
    const lh = teamLook(home, true), la = teamLook(away, false);
    for (let i = 0; i < 22; i++) { const r = makeRig(i < 11 ? lh : la, SKIN[i % SKIN.length]); r.team = i < 11 ? home.abbr : away.abbr; rigs.push(r); }
    rigsFor = { home, away };
    drawField(home); setCrowdColors(home, away);
    setQuality(quality);
  }

  // bind sim players to rigs (home rigs 0..10, away 11..21)
  function bindPlayers(players) {
    const used = { [rigsFor.home.abbr]: 0, [rigsFor.away.abbr]: 11 };
    rigs.forEach(r => r.root.visible = false);
    for (const p of players) {
      const k = p.team.abbr === rigsFor.home.abbr ? rigsFor.home.abbr : rigsFor.away.abbr;
      const r = rigs[used[k]++]; if (!r) continue;
      p.rig = r; r.root.visible = true; r.pose = newPose();
      const key = (p.info ? p.info.num : 0) + '|' + (p.info ? p.info.last : '');
      if (r.numKey !== key) {
        r.numKey = key;
        if (r.numMatF.map) r.numMatF.map.dispose(); if (r.numMatB.map) r.numMatB.map.dispose();
        r.numMatF.map = numberTexture(p.info ? p.info.num : 0, '', r.look.numFg, r.look.numStroke, false); r.numMatF.needsUpdate = true;
        r.numMatB.map = numberTexture(p.info ? p.info.num : 0, p.info ? p.info.last : '', r.look.numFg, r.look.numStroke, true); r.numMatB.needsUpdate = true;
      }
      const big = p.info ? clamp((p.info.wt - 200) / 140, 0, 1) : 0.5, tall = p.info ? clamp((p.info.ht - 68) / 12, 0, 1) : 0.5;
      r.root.scale.set(0.94 + big * 0.2, 0.94 + tall * 0.1, 0.94 + big * 0.16);
    }
  }

  // animation: target pose from state, blended toward with a time constant
  function poseTarget(s) {
    const T = newPose();
    const sp = s.speed || 0;
    T.run = clamp(sp / 7, 0, 1.1);
    switch (s.anim) {
      case 'stance': T.crouch = s.lineman ? 1 : 0.45; T.lean = s.lineman ? 0.9 : 0.35; T.run = 0; break;
      case 'block': T.block = 1; T.crouch = 0.35; T.lean = 0.45; T.run = Math.min(T.run, 0.4); break;
      case 'throw': T.lean = 0.1; break;
      case 'fall': case 'tackle': T.fall = 1; T.run = 0; T.block = s.anim === 'tackle' ? 1 : 0.3; break;
      case 'dive': T.dive = 1; T.block = 1; T.run = 0; break;
      case 'kneel': T.kneel = 1; T.run = 0; break;
      case 'celebrate': T.armsUp = 1; T.run = Math.min(T.run, 0.5); break;
      case 'kick': T.kick = 1; break;
      case 'juke': T.jukeLean = s.jukeSide || 1; T.crouch = 0.3; break;
      default: T.lean = clamp(sp / 9, 0, 0.35);
    }
    if (s.down && s.anim !== 'kneel') T.fall = 1;
    T.reach = s.reach || 0;
    return T;
  }

  function applyPose(r, s, dt) {
    const T = poseTarget(s), P = r.pose, k = 1 - Math.exp(-dt * 12), kf = 1 - Math.exp(-dt * 7);
    for (const key in T) P[key] += (T[key] - P[key]) * (key === 'fall' || key === 'dive' ? kf : k);
    const ph = s.phase || 0, run = P.run, sw = Math.sin(ph * 2.2);
    // legs
    const crouchK = P.crouch * 1.1 + P.kneel * 1.4;
    r.lL.hp.rotation.x = -sw * 0.85 * run - crouchK * 0.9 - P.kick * 0.3; r.lR.hp.rotation.x = sw * 0.85 * run - crouchK * 0.9 + P.kick * -1.6;
    r.lL.kn.rotation.x = Math.max(0, Math.cos(ph * 2.2)) * 1.2 * run + crouchK * 1.5; r.lR.kn.rotation.x = Math.max(0, -Math.cos(ph * 2.2)) * 1.2 * run + crouchK * 1.3 * (1 - P.kneel * 0.6) + P.kick * 0.2;
    // arms
    const thr = s.anim === 'throw' ? s.throwT : -1;
    let rArm = sw * 0.75 * run - P.block * 1.35 - P.armsUp * 2.9 - P.reach * 2.4, lArm = -sw * 0.75 * run - P.block * 1.35 - P.armsUp * 2.9 - P.reach * 2.4;
    if (thr >= 0) { rArm = thr < 0.16 ? lerp(0, -2.9, thr / 0.16) : lerp(-2.9, -0.6, clamp((thr - 0.16) / 0.18, 0, 1)); lArm = -1.0; }
    if (s.hasBall && thr < 0 && !P.armsUp) { rArm = -0.5 + sw * 0.1 * run; }
    r.aR.sh.rotation.x = rArm; r.aL.sh.rotation.x = lArm;
    r.aR.sh.rotation.z = -0.12 - P.armsUp * 0.35; r.aL.sh.rotation.z = 0.12 + P.armsUp * 0.35;
    r.aR.el.rotation.x = -0.5 * run - 0.2 - (s.hasBall && thr < 0 ? 1.2 : 0); r.aL.el.rotation.x = -0.5 * run - 0.2;
    // torso / hips
    r.torso.rotation.x = P.lean + P.crouch * 0.5 + P.block * 0.25 - P.armsUp * 0.15;
    r.torso.rotation.z = P.jukeLean * 0.3;
    r.hips.position.y = 1.0 - P.crouch * 0.33 - P.kneel * 0.42 + Math.abs(Math.sin(ph * 2.2)) * 0.06 * run + (s.anim === 'celebrate' ? Math.abs(Math.sin((s.celebrate || 0) * 7)) * 0.4 : 0);
    // whole-body fall / dive
    const fallAmt = Math.max(P.fall, P.dive);
    r.root.rotation.x = fallAmt * 1.45; r.root.position.y = fallAmt * 0.18;
  }

  function placeRig(p, frame) {
    const r = p.rig; if (!r) return;
    r.root.position.x = W(p.x); r.root.position.z = p.z;
    let face = -p.heading; // play heading atan2(vx,vz) -> world (−vx, vz)
    if (p.anim === 'spin' && p.spin) face += (1 - p.spin / 0.5) * Math.PI * 2;
    if (p.down && p.fallDir != null && p.anim === 'fall') face = -p.fallDir;
    r.root.rotation.y = face;
  }

  // ---------------------------------------------------------------- play art
  // segs: [{pts: [[x, z], ...] (play frame), color, arrow, cap, ring: {x, z, r}, w}]
  let artMesh = null;
  function setPlayArt(segs) {
    if (artMesh) { scene.remove(artMesh); artMesh.geometry.dispose(); artMesh = null; }
    if (!segs || !segs.length) return;
    const pos = [], col = [], c = new THREE.Color();
    const push = (P, hex, y) => { c.set(hex); for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(P[i][0], y, P[i][1]); col.push(c.r, c.g, c.b); } };
    const quad = (ax, az, bx, bz, w, hex, y) => { const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2; push([[ax + nx, az + nz], [ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz]], hex, y); };
    const tri = (A, B, C2, hex, y) => { c.set(hex); for (const P of [A, B, C2]) { pos.push(P[0], y, P[1]); col.push(c.r, c.g, c.b); } };
    for (const layer of [0, 1]) { // dark outline first, color on top
      for (const s of segs) {
        const hex = layer ? s.color : '#0E1B2C', y = layer ? 0.05 : 0.045, w = (s.w || 0.34) + (layer ? 0 : 0.18);
        if (s.ring) { const n = 28, R = s.ring.r; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; quad(W(s.ring.x) + Math.cos(a0) * R, s.ring.z + Math.sin(a0) * R * 0.75, W(s.ring.x) + Math.cos(a1) * R, s.ring.z + Math.sin(a1) * R * 0.75, w, hex, y); } }
        const P = (s.pts || []).map(p => [W(p[0]), p[1]]);
        for (let i = 1; i < P.length; i++) quad(P[i - 1][0], P[i - 1][1], P[i][0], P[i][1], w, hex, y);
        if (P.length > 1 && (s.arrow || s.cap)) {
          const a = P[P.length - 1], b = P[P.length - 2], dx = a[0] - b[0], dz = a[1] - b[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, k = layer ? 1 : 1.35;
          if (s.arrow) tri([a[0] + ux * 0.9 * k, a[1] + uz * 0.9 * k], [a[0] - uz * 0.6 * k, a[1] + ux * 0.6 * k], [a[0] + uz * 0.6 * k, a[1] - ux * 0.6 * k], hex, y);
          else quad(a[0] - uz * 0.55, a[1] + ux * 0.55, a[0] + uz * 0.55, a[1] - ux * 0.55, w, hex, y);
        }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    artMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
    artMesh.renderOrder = 2; scene.add(artMesh);
  }

  // ---------------------------------------------------------------- ball / fx
  function buildBall() {
    const g = new THREE.SphereGeometry(0.16, 12, 8); g.scale(1, 1, 1.75);
    ballMesh = new THREE.Group();
    const b = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#7A3F1D' })); ballMesh.add(b);
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.16), new THREE.MeshBasicMaterial({ color: '#FFFFFF' })); lace.position.y = 0.155; ballMesh.add(lace);
    for (const z of [-0.2, 0.2]) { const st = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 4, 14), new THREE.MeshBasicMaterial({ color: '#F4F6F0' })); st.position.z = z; ballMesh.add(st); }
    scene.add(ballMesh);
    // blob shadows (instanced)
    const sc = document.createElement('canvas'); sc.width = sc.height = 64; const sg = sc.getContext('2d'); const gr = sg.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
    const st = new THREE.CanvasTexture(sc);
    shadowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }), 24);
    shadowMesh.renderOrder = 1; scene.add(shadowMesh);
    const ringGeo = new THREE.RingGeometry(0.62, 0.8, 28).rotateX(-Math.PI / 2);
    ringUser = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#FFC83D', transparent: true, opacity: 0.95, depthWrite: false })); ringUser.position.y = 0.05; scene.add(ringUser);
    ringTarget = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#2F62F0', transparent: true, opacity: 0.9, depthWrite: false })); ringTarget.position.y = 0.05; scene.add(ringTarget);
    ringCarrier = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#E4372C', transparent: true, opacity: 0.95, depthWrite: false })); ringCarrier.position.y = 0.055; scene.add(ringCarrier);
    ringLand = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.9, depthWrite: false })); ringLand.position.y = 0.06; scene.add(ringLand);
  }
  function buildFx() {
    particles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 80);
    particles.userData.list = []; particles.count = 0; scene.add(particles);
    confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.35, 0.22), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), 260);
    confetti.userData.list = []; confetti.count = 0; scene.add(confetti);
  }
  function burst(x, z, power) {
    const L = particles.userData.list, col = new THREE.Color();
    for (let i = 0; i < 18 + power * 14; i++) {
      if (L.length >= 80) L.shift();
      L.push({ x: W(x), y: 0.4 + Math.random() * 0.8, z, vx: (Math.random() - 0.5) * 6 * power, vy: 2 + Math.random() * 5 * power, vz: (Math.random() - 0.5) * 6 * power, life: 0.6 + Math.random() * 0.5, c: Math.random() < 0.6 ? '#3E8A44' : Math.random() < 0.5 ? '#FFFFFF' : '#5B3A22' });
    }
    camState.shake = Math.max(camState.shake, 0.35 * power); camState.fovKick = Math.max(camState.fovKick, 3 * power);
  }
  function celebrate(team) {
    const L = confetti.userData.list; L.length = 0; const cols = [team.c1, team.c2, '#FFFFFF', '#FFC83D'];
    const c = camState.look;
    for (let i = 0; i < 260; i++) L.push({ x: c.x + (Math.random() - 0.5) * 30, y: 10 + Math.random() * 14, z: c.z + (Math.random() - 0.5) * 30, vy: -1.5 - Math.random() * 2, rx: Math.random() * 6, ry: Math.random() * 6, sp: 2 + Math.random() * 6, life: 6, c: cols[i % cols.length], sway: Math.random() * 6 });
  }
  const _m = () => new THREE.Matrix4(); let M4, Q, V, S, E, C;
  function fxStep(dt) {
    if (!M4) { M4 = new THREE.Matrix4(); Q = new THREE.Quaternion(); V = new THREE.Vector3(); S = new THREE.Vector3(1, 1, 1); E = new THREE.Euler(); C = new THREE.Color(); }
    const L = particles.userData.list; let n = 0;
    for (let i = L.length - 1; i >= 0; i--) { const p = L[i]; p.life -= dt; if (p.life <= 0 || p.y < 0) { L.splice(i, 1); continue; } p.vy -= 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
    for (const p of L) { M4.makeTranslation(p.x, p.y, p.z); particles.setMatrixAt(n, M4); particles.setColorAt(n, C.set(p.c)); n++; }
    particles.count = n; particles.instanceMatrix.needsUpdate = true; if (particles.instanceColor) particles.instanceColor.needsUpdate = true;
    const CL = confetti.userData.list; n = 0;
    for (let i = CL.length - 1; i >= 0; i--) { const p = CL[i]; p.life -= dt; p.y += p.vy * dt; p.x += Math.sin(p.life * 2 + p.sway) * dt * 1.2; p.rx += p.sp * dt; p.ry += p.sp * 0.7 * dt; if (p.y < 0.05) { p.y = 0.05; p.vy = 0; } if (p.life <= 0) CL.splice(i, 1); }
    for (const p of CL) { E.set(p.rx, p.ry, 0); Q.setFromEuler(E); V.set(p.x, p.y, p.z); M4.compose(V, Q, S); confetti.setMatrixAt(n, M4); confetti.setColorAt(n, C.set(p.c)); n++; }
    confetti.count = n; confetti.instanceMatrix.needsUpdate = true; if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- cameras
  // ctx: {sim, mode, userSide, view:'presnap'|'live'|'dead'|'kick', replay}
  const tmpLook = { x: 0, y: 0, z: 0 };
  function cameraTarget(ctx) {
    const sim = ctx.sim, b = sim.ball, los = sim.los, sx = W(sim.spotX);
    const defView = ctx.userSide === 'def' && sim.cfg.kind === 'scrim';
    const dirZ = defView ? -1 : 1; // camera looks toward +z for offense view
    const focus = sim.carrier && sim.ball.holder === sim.carrier ? { x: W(sim.carrier.x), z: sim.carrier.z, vx: -sim.carrier.vx, vz: sim.carrier.vz } : { x: W(b.x), z: b.z, vx: -b.vx || 0, vz: b.vz || 0 };
    let mode = ctx.mode;
    if (ctx.replay) return replayCam(ctx, focus);
    if (sim.phase === 'presnap') {
      if (sim.cfg.kind === 'kickoff') return { px: 0, py: 9, pz: los - 16, lx: 0, ly: 0, lz: los + 25, fov: 52 };
      if (mode === 'all22') return { px: sx * 0.5, py: 32, pz: los - 30 * dirZ, lx: sx * 0.4, ly: 0, lz: los + 10 * dirZ, fov: 46 };
      // pre-snap: pulled back far enough to see both wideouts and the routes
      const wide = GS.Input.mode === 'touch' ? 66 : 58;
      return defView ? { px: sx * 0.6, py: 8.6, pz: los + 15, lx: sx * 0.4, ly: 0.5, lz: los - 8, fov: wide } : { px: sx * 0.5, py: 7.6, pz: los - 13.5, lx: sx * 0.35, ly: 0.8, lz: los + 13, fov: wide };
    }
    // kicks: follow the ball, wide
    if (b.state === 'kick') return { px: focus.x * 0.6, py: 12 + b.y * 0.5, pz: b.z - 22, lx: focus.x, ly: b.y * 0.4, lz: b.z + 6, fov: 52 };
    if (mode === 'all22') return { px: focus.x * 0.4, py: 30, pz: focus.z - 26 * dirZ, lx: focus.x * 0.5, ly: 0, lz: focus.z + 6 * dirZ, fov: 46 };
    const carrierDir = sim.carrierDir;
    if (mode === 'follow' || (mode === 'auto' && sim.carrier && sim.carrier.role !== 'QB' && sim.ball.holder === sim.carrier)) {
      // tight chase cam behind the runner, looking upfield
      const sp = Math.hypot(focus.vx, focus.vz);
      let fx = carrierDir * 0, fz = carrierDir; if (sp > 2) { fx = focus.vx / sp * 0.35; fz = (focus.vz / sp) * 0.35 + carrierDir * 0.65; }
      const n = Math.hypot(fx, fz) || 1; fx /= n; fz /= n;
      const back = mode === 'follow' ? 6.5 : 9.5, h = mode === 'follow' ? 3.6 : 5.6;
      return { px: focus.x - fx * back, py: h, pz: focus.z - fz * back, lx: focus.x + fx * 5, ly: 0.8, lz: focus.z + fz * 5, fov: mode === 'follow' ? 58 : 52 };
    }
    // pass in the air: frame ball and its target
    if (b.state === 'air' && b.target) {
      const tx = W(b.target.x), tz = b.target.z;
      const mx = (focus.x + tx) / 2, mz = (focus.z + tz) / 2, span = Math.hypot(focus.x - tx, focus.z - tz);
      return { px: mx * 0.7, py: 8 + span * 0.25, pz: Math.min(focus.z, tz) - 12 - span * 0.25, lx: mx, ly: 0.8, lz: mz + 4, fov: 52 };
    }
    // behind-the-QB broadcast view
    const wide = GS.Input.mode === 'touch' ? 62 : 54;
    return { px: focus.x * 0.6, py: defView ? 8.2 : 6.4, pz: (defView ? focus.z + 14.5 : Math.min(focus.z, los) - 11.5), lx: focus.x * 0.55, ly: 1.0, lz: (defView ? focus.z - 8 : Math.max(focus.z, los) + 15), fov: wide };
  }
  function replayCam(ctx, focus) {
    const t = ctx.replayT || 0, k = camState.replayCam % 3;
    if (k === 0) return { px: focus.x + 0, py: 2.4, pz: focus.z + 14, lx: focus.x, ly: 1, lz: focus.z, fov: 40 }; // end-zone low angle
    if (k === 1) return { px: -38, py: 7, pz: focus.z - 2, lx: focus.x, ly: 1, lz: focus.z, fov: 34 }; // sideline iso
    const a = t * 0.5; return { px: focus.x + Math.cos(a) * 11, py: 4.5, pz: focus.z + Math.sin(a) * 11, lx: focus.x, ly: 1, lz: focus.z, fov: 44 }; // orbit
  }
  function updateCamera(ctx, dt) {
    const T = cameraTarget(ctx);
    const k = ctx.replay ? 1 - Math.exp(-dt * 6) : 1 - Math.exp(-dt * (ctx.sim.phase === 'presnap' ? 4 : 3.2));
    camState.pos.x = lerp(camState.pos.x, T.px, k); camState.pos.y = lerp(camState.pos.y, T.py, k); camState.pos.z = lerp(camState.pos.z, T.pz, k);
    camState.look.x = lerp(camState.look.x, T.lx, k * 1.3); camState.look.y = lerp(camState.look.y, T.ly, k * 1.3); camState.look.z = lerp(camState.look.z, T.lz, k * 1.3);
    camState.shake *= Math.exp(-dt * 6); camState.fovKick *= Math.exp(-dt * 5);
    const s = camState.shake;
    camera.position.set(camState.pos.x + (Math.random() - 0.5) * s, camState.pos.y + (Math.random() - 0.5) * s, camState.pos.z + (Math.random() - 0.5) * s);
    camera.lookAt(camState.look.x, camState.look.y, camState.look.z);
    let fov = T.fov - camState.fovKick;
    if (camera.aspect < 1.5) { const h = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 1.6); fov = Math.min(100, 2 * Math.atan(Math.tan(h / 2) / camera.aspect) * 180 / Math.PI); } if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, k); camera.updateProjectionMatrix(); }
    // camera basis on the ground in play frame for stick mapping
    const dx = camState.look.x - camState.pos.x, dz = camState.look.z - camState.pos.z, n = Math.hypot(dx, dz) || 1;
    const fwx = dx / n, fwz = dz / n; // camera forward on the ground (world)
    // world right = (-fwz, fwx); play frame negates x
    ctx.sim.camBasis = { fx: -fwx, fz: fwz, rx: fwz, rz: fwx };
    // sun follows the action so shadows stay crisp
    sun.position.set(camState.look.x - 25, 60, camState.look.z + 15); sun.target.position.set(camState.look.x, 0, camState.look.z);
  }

  // ---------------------------------------------------------------- frame
  function frame(ctx, dt) {
    const sim = ctx.sim;
    const recF = ctx.replay ? ctx.replayFrame : null;
    const players = sim.all;
    for (let i = 0; i < players.length; i++) {
      const p = players[i]; if (!p.rig) continue;
      let s = p;
      if (recF) { const f = recF.p[i]; if (!f) continue; s = { x: f[0], z: f[1], heading: f[2], speed: f[3], phase: f[4], anim: f[5], animT: f[6], down: f[7], celebrate: f[8], fallDir: f[9], throwT: f[10], reach: f[11], role: p.role, rig: p.rig, info: p.info, spin: 0 }; }
      s.lineman = ['LT', 'LG', 'C', 'RG', 'RT', 'LE', 'DT', 'NT', 'RE'].includes(p.role) && sim.cfg.kind === 'scrim';
      s.hasBall = !recF && sim.ball.holder === p && sim.ball.state === 'held';
      if (recF && recF.carrierIdx === i) s.hasBall = true;
      placeRig(s.rig ? s : p, recF); applyPose(p.rig, s, dt);
      M4 || fxStep(0);
      M4.makeTranslation(W(s.x), 0.03, s.z); shadowMesh.setMatrixAt(i, M4);
    }
    // ball
    let bx, by, bz, bspin, bair;
    if (recF) { [bx, by, bz, bspin, bair] = recF.b; } else { const b = sim.ball; bx = b.x; by = b.y; bz = b.z; bspin = b.spin; bair = b.state === 'air' || b.state === 'kick' || b.state === 'snap' || b.state === 'pitch'; }
    ballMesh.position.set(W(bx), by, bz);
    if (bair && !recF) { const b = sim.ball; const vx = -(b.vx || 0), vz = b.vz || 0, vy = b.vy || 0; ballMesh.rotation.set(0, Math.atan2(vx, vz), 0); ballMesh.rotateX(-Math.atan2(vy, Math.hypot(vx, vz))); ballMesh.rotateZ(bspin); }
    else if (!recF && sim.ball.holder) ballMesh.rotation.set(0.3, -sim.ball.holder.heading, 0);
    M4.makeTranslation(W(bx), 0.025, bz); M4.scale(new THREE.Vector3(0.45, 1, 0.45)); shadowMesh.setMatrixAt(players.length, M4);
    shadowMesh.count = players.length + 1; shadowMesh.instanceMatrix.needsUpdate = true;
    // lines
    const showLines = sim.cfg.kind === 'scrim' && !ctx.replay;
    losLine.visible = showLines; fdLine.visible = showLines && ctx.firstDownZ != null && ctx.firstDownZ < 100;
    losLine.position.z = sim.los; if (ctx.firstDownZ != null) fdLine.position.z = ctx.firstDownZ;
    if (artMesh) { const o = ctx.artOpacity == null ? 0 : ctx.artOpacity; artMesh.material.opacity = o; artMesh.visible = o > 0.02 && !ctx.replay; }
    // rings
    const u = sim.user; ringUser.visible = !!u && !ctx.replay; if (u) { ringUser.position.x = W(u.x); ringUser.position.z = u.z; ringUser.scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.06); }
    // defense: red ring on the ball carrier; anyone: white circle where a pass comes down
    const car = sim.carrier, showCar = ctx.userSide === 'def' && !ctx.replay && car && sim.ball.holder === car && car.side === 'off' && sim.phase === 'live' && !(car.role === 'QB' && sim.passAllowed);
    ringCarrier.visible = !!showCar; if (showCar) { ringCarrier.position.x = W(car.x); ringCarrier.position.z = car.z; ringCarrier.scale.setScalar(1 + Math.sin(performance.now() / 120) * 0.08); }
    const bl = sim.ball, showLand = !ctx.replay && ctx.userSide && bl.state === 'air' && !bl.resolved && bl.target;
    ringLand.visible = !!showLand; if (showLand) { ringLand.position.x = W(bl.target.x); ringLand.position.z = bl.target.z; ringLand.scale.setScalar(0.8 + 0.4 * Math.max(0, 1 - bl.flightT / (bl.flightDur || 1))); }
    const hl = sim.highlight; ringTarget.visible = !!hl && !ctx.replay && sim.passAllowed && !sim.thrown; if (hl) { ringTarget.position.x = W(hl.x); ringTarget.position.z = hl.z; }
    if (crowdMat.userData.sh) { crowdMat.userData.sh.uniforms.uTime.value = performance.now() / 1000; crowdMat.userData.sh.uniforms.uExcite.value = ctx.excite || 0.2; }
    fxStep(dt);
    if (ctx.freeCam) { camera.position.lerp(camState.pos, 1 - Math.exp(-dt * 2)); camera.lookAt(camState.look.x, camState.look.y, camState.look.z); if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); } } else updateCamera(ctx, dt);
    renderer.render(scene, camera);
  }

  const v3 = () => new THREE.Vector3();
  let PV;
  function project(x, y, z) {
    PV = PV || v3(); PV.set(W(x), y, z).project(camera);
    const el = renderer.domElement; return { x: (PV.x + 1) / 2 * el.clientWidth, y: (1 - PV.y) / 2 * el.clientHeight, vis: PV.z < 1 && PV.z > -1 };
  }

  GS.Render = {
    init, setQuality, setupTeams, bindPlayers, frame, setPlayArt, burst, celebrate, drawBoard, project,
    get quality() { return quality; }, camState,
    snapCamera(ctx) { const T = cameraTarget(ctx); camState.pos.set(T.px, T.py, T.pz); camState.look.set(T.lx, T.ly, T.lz); },
    get ready() { return !!renderer; },
    info() { return renderer ? { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures } : null; },
  };
})(window.GS);
