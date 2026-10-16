// Perf bench: mobile viewport (412x915 @ DPR 3), CPU throttle 4x/6x via CDP, 10 s scripted roll.
// Usage: URL=http://localhost:8765/ node test/perf.mjs  -> JSON per throttle rate
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8765/', SECS = +(process.env.SECS||10);
const rates = (process.env.RATES||'1,4,6').split(',').map(Number);
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--enable-precise-memory-info']});
const out = {};
for (const rate of rates) {
  const ctx = await b.newContext({viewport:{width:412,height:915}, deviceScaleFactor:3, isMobile:true, hasTouch:true});
  const pg = await ctx.newPage(); const cdp = await ctx.newCDPSession(pg); const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await cdp.send('Performance.enable');
  await pg.goto(URL); await pg.waitForFunction(() => window.__hantala && window.__hantala.st, null, {timeout:30000});
  await cdp.send('Emulation.setCPUThrottlingRate', {rate});
  await pg.waitForTimeout(1000);
  await pg.evaluate(() => { const f = window.__perf = {t:[], last:0, heap:[], x0:window.__hantala.duck.x, s0:performance.now()};
    const loop = now => { if (f.last) f.t.push(now - f.last); f.last = now; if (performance.memory && f.t.length % 10 === 0) f.heap.push(performance.memory.usedJSHeapSize); if (!f.stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop); });
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(1500);
  const dist1500 = await pg.evaluate(() => +((window.__hantala.duck.x - window.__perf.x0)/40).toFixed(2));
  await pg.waitForTimeout(SECS * 1000 - 1500); await pg.keyboard.up('ArrowRight');
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const r = await pg.evaluate(() => { const f = window.__perf; f.stop = true; const g = window.__hantala;
    const t = f.t.slice(5).sort((a,b) => a-b), n = t.length, avg = t.reduce((a,b) => a+b, 0)/n;
    const worst = t.slice(Math.floor(n*0.99)); const low1 = 1000 / (worst.reduce((a,b)=>a+b,0)/worst.length);
    let gcs = 0; for (let i = 1; i < f.heap.length; i++) if (f.heap[i] < f.heap[i-1] - 256*1024) gcs++;
    const bodies = g.matter.world.localWorld.bodies.length;
    const cv = g.game.canvas;
    return {avgFps:+(1000/avg).toFixed(1), low1Fps:+low1.toFixed(1), avgFrameMs:+avg.toFixed(2), p99FrameMs:+t[Math.floor(n*0.99)].toFixed(1), frames:n,
      bodies, staticBodies:g.matter.world.localWorld.bodies.filter(b=>b.isStatic).length, canvas:`${cv.width}x${cv.height}`,
      heapMinMB:+(Math.min(...f.heap)/1048576).toFixed(1), heapMaxMB:+(Math.max(...f.heap)/1048576).toFixed(1), gcDrops:gcs,
      distanceM:+((g.duck.x - f.x0)/40).toFixed(1), simSecs:+((performance.now()-f.s0)/1000).toFixed(1)}; });
  r.dist1500ms = dist1500; // metres rolled in 1.5 s wall time: should be ~equal at any fps if gameplay is frame-rate independent
  r.physStepsPerSec = await pg.evaluate(() => window.__hantala.physSteps != null ? +(window.__hantala.physSteps / (window.__hantala.time.now/1000)).toFixed(1) : null);
  r.scriptMsPerSec = +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / SECS).toFixed(0);
  r.taskMsPerSec = +(((m1.TaskDuration - m0.TaskDuration) * 1000) / SECS).toFixed(0);
  r.downgraded = await pg.evaluate(() => window.__hantala.downgraded || null); r.errors = errs; out[`cpu${rate}x`] = r; await ctx.close();
}
console.log(JSON.stringify(out, null, 1)); await b.close();
