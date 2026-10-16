// Feather-2 / tap-jump apex probe + slope checks. Same setup as verify.mjs.
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8765/', TRIES = +(process.env.TRIES||5);
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const pg = await b.newPage({viewport:{width:1280,height:720}}); const errs=[]; pg.on('pageerror', e => errs.push(String(e)));
const sleep = ms => pg.waitForTimeout(ms);
const load = async () => { await pg.goto(URL); await pg.waitForFunction(() => window.__hantala && window.__hantala.st); await sleep(400); };
const R = {errors:errs, tries:{}};
for (const speed of [6, 7.5]) { R.tries[speed] = [];
  for (let i = 0; i < TRIES; i++) {
    await load();
    await pg.evaluate(sp => { window.TUNING.maxRollSpeed = sp; const g = window.__hantala, L = g.cache.json.get('level');
      g.duck.setPosition(84*40, (L.bounds.y1 - 0.9)*40); g.setV(sp, 0);
      g.__trk = {maxY:-99}; g.events.on('postupdate', () => { const y = L.bounds.y1 - g.duck.y/40, x = g.duck.x/40;
        if (x > 95.5 && x < 103 && y > g.__trk.maxY) g.__trk = {maxY:y, x}; if (Math.abs(x-96) < 0.6 && g.__trk.lipV == null) g.__trk.lipV = g.v().x; }); }, speed);
    await pg.keyboard.down('ArrowRight');
    for (let k = 0; k < 600; k++) { const x = await pg.evaluate(() => window.__hantala.duck.x/40); if (x >= 95.85) break; await sleep(4); }
    await pg.keyboard.down('Space'); await sleep(80); await pg.keyboard.up('Space'); await sleep(1300); await pg.keyboard.up('ArrowRight');
    R.tries[speed].push(await pg.evaluate(() => { const g = window.__hantala; return {apexX:+g.__trk.x.toFixed(2), apexY:+g.__trk.maxY.toFixed(2), lipVx:+(g.__trk.lipV||0).toFixed(2), feather2:g.st.feathers.has(1), deaths:g.st.deaths}; }));
  } }
// pit: roll out from standstill (start at rest on pit floor)
await load(); await pg.evaluate(() => { const g = window.__hantala, L = g.cache.json.get('level'); g.duck.setPosition(48.5*40, (L.bounds.y1 + 1.55)*40); g.setV(0,0); });
await sleep(400); await pg.keyboard.down('ArrowRight'); await sleep(3000); await pg.keyboard.up('ArrowRight');
R.pitStandstill = await pg.evaluate(() => { const g = window.__hantala, L = g.cache.json.get('level'); return {x:+(g.duck.x/40).toFixed(2), y:+(L.bounds.y1-g.duck.y/40).toFixed(2), feather3:g.st.feathers.has(2)}; });
await pg.screenshot({path:(process.env.SHOTS||'../docs/tech/screenshots') + '/07-pit-exit.png'});
// wall rule: push against the 1 m step face (x=40) from standstill -> must NOT be grounded on the face / climb it
await load(); await pg.evaluate(() => { const g = window.__hantala, L = g.cache.json.get('level'); g.duck.setPosition(39.3*40, (L.bounds.y1 - 0.46)*40); g.setV(0,0); });
await pg.keyboard.down('ArrowRight'); await sleep(1500);
R.wall = await pg.evaluate(() => { const g = window.__hantala, L = g.cache.json.get('level'); return {x:+(g.duck.x/40).toFixed(2), y:+(L.bounds.y1-g.duck.y/40).toFixed(2), sawWall:g.time.now - (g.st.lastWall||-1e9) < 200}; });
await pg.keyboard.up('ArrowRight');
console.log(JSON.stringify(R)); await b.close();
