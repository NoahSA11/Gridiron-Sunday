/* =========================================================================
   GS.Input — one control state fed by keyboard, Gamepad API and touch.
   Actions:  sprint (held) · juke · spin · dive · action (snap/throw/switch)
             cycle · hot · call · camera · pause · replay · t1..t5 (targets)
   move = {x, y} in screen space, |move| <= 1, y = up/forward.
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  const held = { sprint: false };
  let pressed = new Set();
  const keyMove = { x: 0, y: 0 }, touchMove = { x: 0, y: 0 }, padMove = { x: 0, y: 0 };
  const keys = new Set();
  let device = 'keyboard';
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch) device = 'touch';

  const KEYMAP = {
    Space: 'action', Enter: 'action', KeyE: 'juke', KeyR: 'spin', KeyF: 'dive', KeyQ: 'cycle',
    Digit1: 't1', Digit2: 't2', Digit3: 't3', Digit4: 't4', Digit5: 't5',
    KeyH: 'hot', Tab: 'call', KeyP: 'call', KeyC: 'camera', Escape: 'pause', KeyX: 'replay',
  };

  function press(a) { pressed.add(a); }
  function onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const c = e.code;
    if (down) device = 'keyboard';
    if (c === 'ShiftLeft' || c === 'ShiftRight') { held.sprint = down; return; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) {
      if (down) keys.add(c); else keys.delete(c);
      keyMove.x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      keyMove.y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      e.preventDefault(); return;
    }
    const a = KEYMAP[c];
    if (a) { if (down && !e.repeat) press(a); if (c === 'Space' || c === 'Tab') e.preventDefault(); }
  }
  window.addEventListener('keydown', e => onKey(e, true));
  window.addEventListener('keyup', e => onKey(e, false));
  window.addEventListener('blur', () => { keys.clear(); keyMove.x = keyMove.y = 0; held.sprint = false; });

  // ---------------- gamepad ----------------
  const padPrev = [];
  // context-sensitive face buttons: during a pass the face buttons pick receivers (A,B,X,Y,RB)
  let passMode = false;
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null; for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) { padMove.x = padMove.y = 0; return; }
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0, m = Math.hypot(ax, ay), dz = 0.18;
    if (m > dz) { const k = (m - dz) / (1 - dz) / m; padMove.x = ax * k; padMove.y = -ay * k; device = 'gamepad'; } else { padMove.x = padMove.y = 0; }
    const b = i => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
    held.padSprint = b(7) || b(6);
    const map = passMode ? { 0: 't1', 1: 't2', 2: 't3', 3: 't4', 5: 't5', 4: 'cycle' }
      : { 0: 'action', 1: 'spin', 2: 'dive', 3: 'juke', 4: 'cycle', 5: 'hot' };
    Object.assign(map, { 8: 'call', 9: 'pause', 12: 'camera', 13: 'replay' });
    for (let i = 0; i < pad.buttons.length; i++) {
      const now = b(i); if (now && !padPrev[i] && map[i]) { press(map[i]); device = 'gamepad'; } padPrev[i] = now;
    }
  }

  // ---------------- touch ----------------
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not allowed */ } }

  function bindTouch(root) {
    const zone = root.querySelector('#stickZone'), base = root.querySelector('#stickBase'), knob = root.querySelector('#stickKnob');
    let sid = null, ox = 0, oy = 0; const R = 56, DZ = 0.14;
    const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
    zone.addEventListener('pointerdown', e => {
      if (sid !== null) return; sid = e.pointerId; zone.setPointerCapture(e.pointerId); device = 'touch';
      const r = zone.getBoundingClientRect(); ox = e.clientX; oy = e.clientY;
      base.style.left = (ox - r.left) + 'px'; base.style.top = (oy - r.top) + 'px'; base.classList.add('on'); setKnob(0, 0); vibrate(8);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - ox, dy = e.clientY - oy; const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      setKnob(dx, dy);
      const m = Math.min(1, d / R);
      if (m < DZ) { touchMove.x = touchMove.y = 0; } else { const k = (m - DZ) / (1 - DZ) / (Math.hypot(dx, dy) || 1); touchMove.x = dx * k; touchMove.y = -dy * k; }
      e.preventDefault();
    });
    const end = e => { if (e.pointerId !== sid) return; sid = null; touchMove.x = touchMove.y = 0; setKnob(0, 0); base.classList.remove('on'); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

    root.querySelectorAll('[data-act]').forEach(btn => {
      const a = btn.dataset.act;
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); device = 'touch'; btn.classList.add('down'); vibrate(a === 'dive' ? 22 : 12);
        if (a === 'sprint') held.touchSprint = true; else press(a);
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      const up = () => { btn.classList.remove('down'); if (a === 'sprint') held.touchSprint = false; };
      btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
    });
  }

  GS.Input = {
    isTouch, bindTouch, press, vibrate,
    get device() { return device; },
    setPassMode(on) { passMode = on; },
    update() { pollPad(); },
    move() {
      let x = keyMove.x + touchMove.x + padMove.x, y = keyMove.y + touchMove.y + padMove.y;
      const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
      return { x, y };
    },
    sprint() { return held.sprint || held.touchSprint || held.padSprint; },
    consume(a) { if (pressed.has(a)) { pressed.delete(a); return true; } return false; },
    peek(a) { return pressed.has(a); },
    clear() { pressed = new Set(); },
    label(a) { // button glyph for HUD hints
      if (device === 'gamepad') return { action: 'A', juke: 'Y', spin: 'B', dive: 'X', cycle: 'LB', hot: 'RB', sprint: 'RT', t1: 'A', t2: 'B', t3: 'X', t4: 'Y', t5: 'RB' }[a] || '';
      if (device === 'keyboard') return { action: 'SPACE', juke: 'E', spin: 'R', dive: 'F', cycle: 'Q', hot: 'H', sprint: 'SHIFT', call: 'TAB', t1: '1', t2: '2', t3: '3', t4: '4', t5: '5' }[a] || '';
      return '';
    },
  };
})(window.GS);
