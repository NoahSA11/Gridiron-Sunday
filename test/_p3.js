const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext()).newPage();
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: '/home/user/gridiron-sunday/test/three.min.js', contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.goto('http://127.0.0.1:8767/index.html'); await p.waitForFunction(() => window.GS && GS.Data.teams[0].starters);
  const out = await p.evaluate(() => {
    const S = GS.Sim, PB = GS.Playbook, logs = []; let rushDist = [];
    for (let i = 0; i < 40 && logs.length < 2; i++) {
      S.setup({ off: GS.Data.byAbbr.KC, def: GS.Data.byAbbr.BUF, offPlay: PB.offById('curlflat'), defPlay: PB.D[i % 14], los: 30, spotX: 0, userSide: null, kind: 'scrim', diff: GS.Game.DIFF.pro, assist: true, togo: 10, hot: {} });
      S.snap(); let t = 0, caught = -1, thrownT = -1; const tr = [];
      while (S.phase === 'live' && t < 25) { S.step(1 / 60); t += 1 / 60;
        if (thrownT < 0 && S.thrown) { thrownT = t; const q = S.off.find(x => x.role === 'QB'); rushDist.push(Math.min(...S.def.map(d => Math.hypot(d.x - q.x, d.z - q.z))).toFixed(1) + '@' + t.toFixed(1)); }
        if (caught < 0 && S.log.some(e => e.type === 'catch')) caught = t;
        if (caught >= 0 && tr.length < 6 && Math.round((t - caught) * 60) % 30 === 0 && S.carrier) { const c = S.carrier; tr.push((t - caught).toFixed(1) + ' C(' + c.x.toFixed(0) + ',' + (c.z - 30).toFixed(0) + ' v' + c.speed.toFixed(1) + ') ' + S.def.filter(d => Math.hypot(d.x - c.x, d.z - c.z) < 12).map(d => d.role + Math.hypot(d.x - c.x, d.z - c.z).toFixed(1) + (d.engaged ? 'E' : '') + (d.stun > 0 ? 'S' : '') + (d.down > 0 ? 'D' : '') + (d.dive > 0 ? 'V' : '') + '@' + d.speed.toFixed(1) + ' tcd' + d.tackleCD.toFixed(1)).join(' ')); }
      }
      if (S.reason === 'td' && caught >= 0) logs.push({ d: PB.D[i % 14].id, who: S.log.find(e => e.type === 'catch').p.role, ev: S.log.filter(e => e.type !== 'engage').map(e => e.type).join(','), tr });
    }
    return { logs, rushDist };
  });
  console.log(JSON.stringify(out, null, 1)); await b.close();
})();
