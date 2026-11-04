// Runs many isolated plays CPU vs CPU and reports outcome distributions.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext()).newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.goto('http://127.0.0.1:8767/index.html'); await p.waitForFunction(() => window.GS && GS.Data.teams[0].starters);
  const N = +(process.argv[2] || 25);
  const out = await p.evaluate((N) => {
    const S = GS.Sim, PB = GS.Playbook, res = {};
    const off = GS.Data.byAbbr.KC, def = GS.Data.byAbbr.BUF;
    for (const play of PB.OFF) {
      const r = { n: 0, gain: 0, comp: 0, att: 0, inc: 0, int: 0, sack: 0, td: 0, big: 0, fum: 0, reasons: {}, dur: 0, gains: [] };
      for (let i = 0; i < N; i++) {
        const dp = PB.D[i % PB.D.length];
        S.setup({ off, def, offPlay: play, defPlay: dp, los: 30, spotX: 0, userSide: null, kind: 'scrim', diff: GS.Game.DIFF.pro, assist: true, togo: 10, hot: {} });
        S.snap(); let t = 0; while (S.phase === 'live' && t < 25) { S.step(1 / 60); t += 1 / 60; }
        S.drainEvents(); const R = S.result; if (!R) continue;
        r.n++; r.dur += R.duration; r.reasons[R.reason] = (r.reasons[R.reason] || 0) + 1;
        const ev = t => R.events.some(e => e.type === t);
        if (ev('throw')) r.att++; r.brk=(r.brk||0)+R.events.filter(e=>e.type==='broken').length; if (ev('catch')) r.comp++; if (ev('int')) r.int++; if (ev('sack')) r.sack++; if (ev('fumble')) r.fum++;
        if (R.reason === 'td') r.td++;
        const g = R.reason === 'incomplete' ? 0 : Math.round(Math.min(R.endZ, 100) - 30); r.gain += g; r.gains.push(g); if (g >= 20) r.big++;
      }
      r.avg = +(r.gain / r.n).toFixed(1); r.dur = +(r.dur / r.n).toFixed(1); r.gains.sort((a, b) => a - b); r.med = r.gains[Math.floor(r.gains.length / 2)]; delete r.gains; delete r.gain;
      res[play.id] = r;
    }
    return res;
  }, N);
  for (const k in out) { const r = out[k]; console.log(k.padEnd(9), 'avg', String(r.avg).padStart(5), 'med', String(r.med).padStart(3), 'cmp', r.comp + '/' + r.att, 'int', r.int, 'sack', r.sack, 'td', r.td, 'big', r.big, 'fum', r.fum, 'brk', r.brk, 'dur', r.dur, JSON.stringify(r.reasons)); }
  await b.close();
})();
