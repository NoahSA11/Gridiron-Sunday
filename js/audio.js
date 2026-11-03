/* =========================================================================
   GS.Audio — fully procedural sound (Web Audio API, no files)
   crowd bed that swells with excitement, whistles, hits, catches, kicks,
   horns, stadium organ stingers and UI blips.
   ========================================================================= */
window.GS = window.GS || {};
(function (GS) {
  'use strict';
  let ctx = null, master = null, crowdGain = null, crowdFilter = null, chantGain = null, noiseBuf = null;
  let enabled = true, excite = 0.15, target = 0.15;
  const vol = { master: 0.8 };

  function makeNoise() {
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    // pinkish noise
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 0.9; }
    return buf;
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = enabled ? vol.master : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = makeNoise();
    // crowd bed: two detuned noise loops through band-pass + slow LFO "murmur"
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0.0;
    crowdFilter = ctx.createBiquadFilter(); crowdFilter.type = 'bandpass'; crowdFilter.frequency.value = 900; crowdFilter.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    for (let i = 0; i < 2; i++) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = 0.85 + i * 0.3;
      const g = ctx.createGain(); g.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23 + i * 0.17; const lg = ctx.createGain(); lg.gain.value = 0.25; lfo.connect(lg); lg.connect(g.gain); lfo.start();
      s.connect(g); g.connect(crowdFilter); s.start(0, i * 1.1);
    }
    crowdFilter.connect(lp); lp.connect(crowdGain); crowdGain.connect(master);
    chantGain = ctx.createGain(); chantGain.gain.value = 0; chantGain.connect(master);
    tick();
  }

  function tick() {
    if (!ctx) return;
    excite += (target - excite) * 0.05;
    target += (0.15 - target) * 0.006; // decays toward murmur
    const t = ctx.currentTime;
    crowdGain.gain.setTargetAtTime(0.10 + excite * 0.75, t, 0.12);
    crowdFilter.frequency.setTargetAtTime(700 + excite * 1300, t, 0.2);
    setTimeout(tick, 50);
  }

  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function osc(type, f, t, dur, peak, dest, f2) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(g, t, 0.005, peak, dur); o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.05); return o;
  }
  function noise(t, dur, peak, type, freq, q) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 800; f.Q.value = q || 0.8;
    const g = ctx.createGain(); env(g, t, 0.004, peak, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }

  const S = {
    whistle(long) {
      if (!ctx) return; const t = ctx.currentTime, dur = long ? 0.9 : 0.45;
      [2850, 3010].forEach(f => {
        const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
        o.frequency.value = f; lfo.frequency.value = 38; lg.gain.value = 120; lfo.connect(lg); lg.connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.02); g.gain.setValueAtTime(0.09, t + dur - 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      });
      noise(t, dur, 0.03, 'highpass', 4000);
    },
    hit(power) {
      if (!ctx) return; const t = ctx.currentTime, p = Math.min(1.4, 0.4 + power);
      osc('sine', 140, t, 0.25, 0.7 * p, null, 38);
      noise(t, 0.12, 0.6 * p, 'lowpass', 1400);
      noise(t + 0.01, 0.07, 0.25 * p, 'bandpass', 2600, 2); // pad clack
      S.cheer(0.25 * power);
    },
    catch() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.05, 0.35, 'bandpass', 1500, 3); osc('sine', 320, t, 0.06, 0.15, null, 200); },
    throw() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.18, 0.12, 'bandpass', 800, 1.5); },
    kick() { if (!ctx) return; const t = ctx.currentTime; osc('sine', 180, t, 0.18, 0.8, null, 50); noise(t, 0.06, 0.5, 'bandpass', 1800, 2); },
    snap() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.04, 0.2, 'bandpass', 1100, 3); },
    hike(word) { // QB cadence: short formant-ish bark
      if (!ctx) return; const t = ctx.currentTime;
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(word ? 170 : 150, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.18);
      f.type = 'bandpass'; f.frequency.value = word ? 900 : 650; f.Q.value = 4; env(g, t, 0.01, 0.25, 0.17); o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
    },
    horn() {
      if (!ctx) return; const t = ctx.currentTime;
      [196, 247, 294, 392].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.06); g.gain.setValueAtTime(0.06, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8); o.connect(g); g.connect(master); o.start(t + i * 0.01); o.stop(t + 1.9); });
    },
    organ() { // the classic "charge" stinger, written fresh
      if (!ctx) return; const t = ctx.currentTime, notes = [392, 523, 659, 784, 659, 784];
      const tm = [0, 0.15, 0.3, 0.45, 0.75, 0.9], du = [0.13, 0.13, 0.13, 0.28, 0.13, 0.5];
      notes.forEach((f, i) => { osc('square', f, t + tm[i], du[i], 0.06); osc('sine', f * 2, t + tm[i], du[i], 0.04); });
    },
    chant() { // "DE-FENSE" — two crowd swells + stomps
      if (!ctx) return; const t = ctx.currentTime;
      [0, 0.45].forEach((d, i) => { noise(t + d, 0.32, 0.5, 'bandpass', i ? 520 : 680, 1.2); osc('sine', 70, t + d, 0.15, 0.4, null, 40); });
      osc('sine', 60, t + 1.0, 0.12, 0.5, null, 35); osc('sine', 60, t + 1.25, 0.12, 0.5, null, 35);
    },
    ui() { if (!ctx) return; osc('triangle', 880, ctx.currentTime, 0.06, 0.12); },
    uiBack() { if (!ctx) return; osc('triangle', 520, ctx.currentTime, 0.07, 0.12, null, 380); },
    select() { if (!ctx) return; const t = ctx.currentTime; osc('triangle', 660, t, 0.06, 0.12); osc('triangle', 990, t + 0.06, 0.09, 0.12); },
    flag() { if (!ctx) return; const t = ctx.currentTime; osc('square', 440, t, 0.12, 0.08); osc('square', 330, t + 0.14, 0.2, 0.08); },
    cheer(amount) { target = Math.min(1.25, target + amount); },
    groan() { if (!ctx) return; const t = ctx.currentTime; noise(t, 1.2, 0.35, 'lowpass', 500); target = Math.max(0.1, target - 0.1); },
    setExcite(v) { target = Math.max(target, v); },
    meter(v) { if (!ctx) return; osc('sine', 300 + v * 600, ctx.currentTime, 0.03, 0.05); },
  };

  GS.Audio = Object.assign(S, {
    init,
    setEnabled(on) { enabled = on; if (master) master.gain.value = on ? vol.master : 0; },
    get enabled() { return enabled; },
  });
})(window.GS);
