const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 800, height: 450 } })).newPage();
  await p.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: path.join(__dirname, 'three.min.js'), contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await p.addInitScript(() => {
    window.__pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [window.__pad];
  });
  await p.goto('http://127.0.0.1:8765/index.html'); await p.waitForFunction(() => window.GS && document.querySelector('#mQuick'));
  const r = await p.evaluate(() => {
    const out = {}; const I = GS.Input, P = window.__pad;
    P.axes = [0.1, -0.1, 0, 0]; I.update(); out.deadzone = I.move();
    P.axes = [0.7, -0.7, 0, 0]; I.update(); out.diag = I.move(); out.device = I.device;
    P.buttons[0].pressed = true; I.update(); out.aPressed = I.peek('action'); P.buttons[0].pressed = false; I.update(); I.clear();
    P.buttons[7].pressed = true; P.buttons[7].value = 1; I.update(); out.sprint = I.sprint(); P.buttons[7].pressed = false; P.buttons[7].value = 0; I.update();
    I.setPassMode(true); P.buttons[1].pressed = true; I.update(); out.bInPass = I.peek('t2'); P.buttons[1].pressed = false; I.update(); I.clear(); I.setPassMode(false);
    P.buttons[3].pressed = true; I.update(); out.yRun = I.peek('juke'); P.buttons[3].pressed = false; I.update(); I.clear();
    out.label = I.label('juke');
    return out;
  });
  console.log(JSON.stringify(r)); await b.close();
})();
