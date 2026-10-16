// Headless verification for level 1-1. Usage: (cd game && python3 -m http.server 8765) & node game/test/verify.mjs
// Requires `npm i playwright && npx playwright install chromium` (or NODE_PATH pointing at one).
import { chromium } from 'playwright';
const OUT = process.env.SHOTS || '../docs/tech/screenshots', URL = process.env.URL || 'http://localhost:8765/';
const b = await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const pg = await b.newPage({viewport:{width:1280,height:720}});
const errs = []; pg.on('console', m => m.type()==='error' && errs.push(m.text())); pg.on('pageerror', e => errs.push(String(e)));
const R = {}; const sleep = ms => pg.waitForTimeout(ms);
const st = () => pg.evaluate(() => { const g = window.__hantala, s = g.st, v = g.v(); const L = g.cache.json.get('level');
  return {x:+(g.duck.x/40).toFixed(2), y:+(L.bounds.y1 - g.duck.y/40).toFixed(2), vx:+v.x.toFixed(2), vy:+v.y.toFixed(2), dew:s.dew.size, fea:s.feathers.size,
    deaths:s.deaths, won:s.won, glide:s.glide, diving:s.diving, grounded:s.grounded, cp:s.checkpoint&&s.checkpoint.id, dead:s.dead,
    prompts:JSON.stringify(s.prompts), fps:g.game.loop.actualFps, lilies:s.lilies, time:s.time}; });
const tp = (x, y, vx=0) => pg.evaluate(([x,y,vx]) => { const g = window.__hantala; const L = g.cache.json.get('level');
  g.duck.setPosition(x*40, (L.bounds.y1 - y)*40); g.setV(vx, 0); }, [x,y,vx]);
const load = async () => { await pg.goto(URL); await pg.waitForFunction(() => window.__hantala && window.__hantala.st, null, {timeout:15000}); await sleep(600); };
await load();
R.level = await pg.evaluate(() => { const L = window.__hantala.cache.json.get('level'); return {drops:L.dewdrops.length, feathers:L.feathers.length, spawn:L.spawn, cps:L.checkpoints, goal:L.goal, x1:L.bounds.x1}; });
R.spawnState = await st(); await pg.screenshot({path:`${OUT}/01-spawn.png`});
// --- scripted playthrough: hold right, jump at beats
const beats = [38.6, 45.9, 95.6, 118.6];
await pg.keyboard.down('ArrowRight'); let t0 = Date.now(), log = [], bi = 0, shot2 = false;
while (Date.now() - t0 < 60000) { const s = await st(); if (s.won) break;
  if (bi < beats.length && s.x >= beats[bi] && s.x < beats[bi] + 2) { await pg.keyboard.down('Space'); await sleep(200); await pg.keyboard.up('Space'); log.push(['jump', s.x, s.vx]); bi++; }
  else if (bi < beats.length && s.x > beats[bi] + 2) bi++;
  if (!shot2 && s.x > 22) { shot2 = true; await pg.screenshot({path:`${OUT}/02-hill-prompt.png`}); }
  if (s.deaths > (log.deaths||0)) { log.deaths = s.deaths; log.push(['death', s.x, s.y]); bi = beats.findIndex(x => x > s.x - 1); if (bi < 0) bi = beats.length; }
  await sleep(25); }
await pg.keyboard.up('ArrowRight');
R.run = {...await st(), wall:(Date.now()-t0)/1000, log}; await sleep(300); await pg.screenshot({path:`${OUT}/05-results.png`});
// --- G gap: standstill vs max speed
await load(); await tp(95.9, 1.0); await sleep(200); await pg.keyboard.down('Space'); await sleep(200); await pg.keyboard.up('Space'); await sleep(1400);
R.gapStandstill = await st();
await load(); await tp(86, -0.3, 7.5); await pg.keyboard.down('ArrowRight'); let s;
for (let i=0;i<200;i++){ s = await st(); if (s.x >= 95.6) break; await sleep(10); }
R.gapLaunchSpeed = s.vx; await pg.keyboard.down('Space'); await sleep(200); await pg.keyboard.up('Space'); await sleep(250); await pg.screenshot({path:`${OUT}/03-gap-jump.png`});
await sleep(1200); await pg.keyboard.up('ArrowRight'); R.gapMaxSpeed = await st();
// --- D pit: exitable without jumping (standstill start)
await load(); await tp(48.5, -1.55); await sleep(300); await pg.keyboard.down('ArrowRight'); await sleep(3500); await pg.keyboard.up('ArrowRight'); R.pitExit = await st();
await load(); await tp(44, 1.5, 7.5); await pg.keyboard.down('ArrowRight'); await sleep(2500); await pg.keyboard.up('ArrowRight'); R.pitExitWithSpeed = await st();
// --- thorns: kill + respawn at N2, drops kept
await load(); await tp(111.5, 0.6); await pg.keyboard.down('ArrowRight'); await sleep(1500);
let pre = await st(); for (let i=0;i<300;i++){ pre = await st(); if (pre.dead || pre.deaths) break; await sleep(5); }
const tk = Date.now(); let post; for (let i=0;i<200;i++){ post = await st(); if (!post.dead) break; await sleep(10); }
R.thorns = {preDeath:pre, respawnMs:Date.now()-tk, afterRespawn:post}; await pg.keyboard.up('ArrowRight');
// --- glide & dive
await load(); await tp(10, 8); await pg.keyboard.down('Space'); await sleep(700); R.glide = await st(); await pg.screenshot({path:`${OUT}/04-glide.png`});
await pg.keyboard.up('Space'); await sleep(50); await pg.keyboard.press('ArrowDown'); await sleep(250); R.dive = await st();
// --- touch: tap right half = jump; drag left = roll; swipe down = dive
await load(); await pg.mouse.move(1000, 400); await pg.mouse.down(); await sleep(60); await pg.mouse.up(); await sleep(120); R.tapJump = await st();
await sleep(1200); await pg.mouse.move(300, 400); await pg.mouse.down(); await pg.mouse.move(380, 400, {steps:5}); await sleep(1000); R.dragRoll = await st(); await pg.mouse.up();
await pg.mouse.move(1000, 400); await pg.mouse.down(); await sleep(30); await pg.mouse.up(); await sleep(250);
await pg.mouse.move(1000, 300); await pg.mouse.down(); await pg.mouse.move(1000, 420, {steps:3}); await pg.mouse.up(); await sleep(40); R.swipeDive = await st();
// --- debug toggles
await pg.keyboard.press('Backquote'); await pg.keyboard.press('Digit1'); await pg.keyboard.press('Digit2');
R.debugToggles = await pg.evaluate(() => ({...window.TUNING.debug})); await pg.screenshot({path:`${OUT}/06-debug-menu.png`});
await pg.keyboard.press('Digit1'); await pg.keyboard.press('Digit2');
// coyote: roll off ledge E->F? use step edge at x=44 (y1 -> y1 drop). jump 60ms after leaving ground
await load(); await tp(42.5, 1.5, 6); await pg.keyboard.down('ArrowRight');
let leftAt; for (let i=0;i<300;i++){ const q = await pg.evaluate(() => window.__hantala.time.now - window.__hantala.st.lastGround); if (q > 50 && q < 90){ leftAt = q; break; } await sleep(4); }
await pg.keyboard.press('Space'); await sleep(80); R.coyote = {msSinceGroundAtPress:leftAt, ...(await st())}; await pg.keyboard.up('ArrowRight');
R.errors = errs; console.log(JSON.stringify(R, null, 1)); await b.close();
