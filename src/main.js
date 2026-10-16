// Hantala prototype — Phaser 3 + Matter.js. Level data: levels/*.json (meters, +y up).
const T = window.TUNING, P = T.ppm, STEP = 1/60, STEP_MS = 1000/60;
const QS = new URLSearchParams(location.search);
const LEVEL_URL = QS.get('level') || 'levels/level1-1.json';
// Render scale: internal canvas = CSS size * RS. Capped by DPR, maxRenderScale and a pixel budget (fixed internal res, GPU-scaled to screen).
function renderScale(){ const css = innerWidth * innerHeight, want = +(QS.get('rs') || Math.min(devicePixelRatio || 1, T.perf.maxRenderScale));
  const saved = QS.get('rs') ? 99 : +(localStorage.getItem('hantala.rsCap') || 99); // auto-downgrade remembered across loads
  return Math.max(0.5, Math.min(want, saved, Math.sqrt(T.perf.maxRenderPixels / css))); }
let RS = renderScale();
const M = Phaser.Physics.Matter.Matter;
let L; // current level
const X = m => m * P, Y = m => (L.bounds.y1 - m) * P;          // meters -> px
const MX = px => px / P, MY = px => L.bounds.y1 - px / P;       // px -> meters

class Play extends Phaser.Scene {
  constructor(){ super('play'); }
  preload(){ this.load.json('level', LEVEL_URL); }
  create(){
    L = this.cache.json.get('level');
    const W = X(L.bounds.x1), H = (L.bounds.y1 - L.bounds.y0) * P;
    this.matter.world.setBounds(0, -2000, W, H + 4000, 64, true, true, false, false);
    this.cameras.main.setBounds(0, 0, W, H).setBackgroundColor('#cfe9d8');
    this.makeTextures();
    const g = this.add.graphics();
    g.fillStyle(0x5b7c3a);
    const parts = []; L.chains.forEach((c, i) => { c.__i = i; });
    for (const c of L.chains) for (let i = 0; i < c.length - 1; i++) {
      const [x1,y1] = c[i], [x2,y2] = c[i+1]; if (x2 <= x1) continue;
      const v = [{x:X(x1),y:Y(y1)},{x:X(x2),y:Y(y2)},{x:X(x2),y:Y(L.solidBottom)},{x:X(x1),y:Y(L.solidBottom)}];
      const ctr = M.Vertices.centre(v);
      (parts[c.__i] || (parts[c.__i] = [])).push(M.Bodies.fromVertices(ctr.x, ctr.y, [v], {label:'ground', friction:T.friction}));
      g.fillPoints(v, true);
    }
    // merge each terrain chain into ONE static compound body (fewer broadphase entries)
    for (const pp of parts) if (pp) this.matter.world.add(M.Body.create({parts:pp, isStatic:true, label:'ground', friction:T.friction}));
    for (const p of L.platforms){ const r = this.add.rectangle(X((p.x1+p.x2)/2), Y(p.y - p.h/2), X(p.x2-p.x1), X(p.h), 0x7a9a4a);
      this.matter.add.gameObject(r, {isStatic:true, label:'ground', friction:T.friction}); }
    this.boxes = [];
    for (const h of L.hazards){ // visual full size, collider inset
      g.fillStyle(0x7a2a3a);
      for (let x = h.x1; x < h.x2; x += 0.4) g.fillTriangle(X(x), Y(h.y), X(x+0.4), Y(h.y), X(x+0.2), Y(h.y+h.h));
      this.boxes.push({kind:'hazard', x1:h.x1 + h.inset, x2:h.x2 - h.inset, y1:h.y, y2:h.y + h.h - h.inset});
    }
    // Pickups/triggers are NOT physics bodies: plain circle overlap checks against the duck, sorted by x (see checkOverlaps)
    this.pickups = [];
    const sensor = (x,y,r,tex,label,extra) => { const s = this.add.image(X(x), Y(y), tex); Object.assign(s, extra);
      this.pickups.push({x, y, r, label, go:s, active:true}); return s; };
    this.drops = L.dewdrops.map((d,i) => sensor(d.x, d.y, L.dropRadius, 'dew', 'dew', {idx:i}));
    this.feathers = L.feathers.map((f,i) => sensor(f.x, f.y, f.r||0.4, 'feather', 'feather', {idx:i}));
    this.nests = L.checkpoints.map(c => sensor(c.x, c.y + 0.3, c.r, 'nest', 'nest', {cp:c}));
    const gl = L.goal; this.add.image(X(gl.x), Y(gl.y + 0.6), 'goal');
    this.boxes.push({kind:'goal', x1:gl.x - gl.w/2, x2:gl.x + gl.w/2, y1:gl.y, y2:gl.y + gl.h});
    this.pickups.sort((a, b) => a.x - b.x); this.pickStart = 0;
    this.duck = this.matter.add.image(X(L.spawn.x), Y(L.spawn.y), 'duck', null, {shape:{type:'circle', radius:X(T.duckRadius)},
      friction:T.friction, frictionAir:0, restitution:T.restitution, density:T.density, label:'duck'});
    this.baseMass = this.duck.body.mass;
    this.matter.world.setGravity(0, 0); // custom gravity in m/s^2 applied in tick()
    // Fixed-timestep physics: Matter autoUpdate is off (see game config); update() steps it with an accumulator.
    const eng = this.matter.world.engine; eng.positionIterations = T.perf.positionIterations; eng.velocityIterations = T.perf.velocityIterations;
    this.acc = 0; this.physSteps = 0;
    const cam = this.cameras.main; cam.startFollow(this.duck, false, 1, 1); cam.setDeadzone(0, X(3));
    this.fitZoom(); this.scale.on('resize', () => this.fitZoom());
    this.st = { dew:new Set(), feathers:new Set(), deaths:0, t0:this.time.now, time:0, won:false, glide:false, diving:false,
                grounded:false, lastGround:-1e9, jumpBufferedAt:-1e9, jumpAt:-1e9, checkpoint:null, dead:false, lookX:0,
                prompts:{}, maxSpeed:0 };
    const onPairs = e => { const ps = e.pairs; for (let i = 0; i < ps.length; i++) this.onPair(ps[i]); };
    this.matter.world.on('collisionstart', onPairs); this.matter.world.on('collisionactive', onPairs);
    this.matter.world.on('beforeupdate', () => this.tick());
    this.hud = this.add.text(12*RS, 10*RS, '', {font:`${Math.round(18*RS)}px sans-serif`, color:'#16301c', backgroundColor:'#ffffffaa', padding:{x:6,y:4}}).setScrollFactor(0).setDepth(20);
    this.promptText = this.add.text(0, 60*RS, '', {font:`${Math.round(22*RS)}px sans-serif`, color:'#fff', backgroundColor:'#16301ccc', padding:{x:10,y:6}}).setScrollFactor(0).setDepth(20).setOrigin(0.5,0);
    this.dbg = this.add.text(0, 10*RS, '', {font:`${Math.round(14*RS)}px monospace`, color:'#000', backgroundColor:'#fff9', padding:{x:6,y:4}}).setScrollFactor(0).setDepth(21).setOrigin(1,0).setInteractive();
    this.dbg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.toggleDebug(); });
    this.fpsText = this.add.text(12*RS, 44*RS, '', {font:`${Math.round(14*RS)}px monospace`, color:'#fff', backgroundColor:'#000a', padding:{x:4,y:2}}).setScrollFactor(0).setDepth(22);
    this.showFps = this.showFps ?? (QS.get('fps') === '1'); this.fpsAcc = 0; this.fpsFrames = 0; this.fpsWorst = 0;
    this._v = {x:0, y:0}; this._hudStr = ''; this._dbgStr = ''; this._promptStr = null;
    this.debugOpen = false; this.setupInput(); window.__hantala = this;
  }
  downgrade(fps){
    const old = RS; RS = 1; localStorage.setItem('hantala.rsCap', '1'); this.downgraded = {from:old, fps:+fps.toFixed(1)};
    GAME.scale.setGameSize(Math.round(innerWidth), Math.round(innerHeight));
    const f = RS / old; for (const t of [this.hud, this.promptText, this.dbg, this.fpsText]) { t.setScale(t.scaleX * f); t.y *= f; t.x *= f; }
  }
  fitZoom(){ const cam = this.cameras.main; cam.setZoom(this.scale.height / (14 * P)); }
  makeTextures(){
    const r = X(T.duckRadius), g = this.make.graphics({add:false});
    g.fillStyle(0xffd23f).fillCircle(r, r, r);
    g.fillStyle(0xd8282a).fillRect(r*0.25, r*0.35, r*1.5, r*0.28);               // red bandana
    g.fillStyle(0xf2b800).fillEllipse(r*0.8, r*1.3, r*0.9, r*0.6);              // wing
    g.fillStyle(0xff8c1a).fillTriangle(2*r-3, r-1, 2*r+5, r+4, 2*r-8, r+5);     // beak
    g.fillStyle(0x5a3a1a).fillRect(r*1.35, r*1.12, r*0.55, r*0.12);             // mustache
    g.fillStyle(0x222222).fillCircle(r*1.4, r*0.85, 2.5);
    g.generateTexture('duck', 2*r+6, 2*r); g.clear();
    const d = X(0.35); g.fillStyle(0x4fb6ff).fillCircle(d, d*1.2, d*0.8).fillTriangle(d*0.25, d, d*1.75, d, d, 0);
    g.generateTexture('dew', 2*d, 2*d); g.clear();
    g.fillStyle(0xffffff).fillEllipse(16, 16, 10, 30).lineStyle(2, 0x8899aa).lineBetween(16, 2, 16, 30);
    g.generateTexture('feather', 32, 32); g.clear();
    g.fillStyle(0x8a6a3a).fillEllipse(40, 30, 80, 24); g.fillStyle(0xc9a46a).fillEllipse(40, 24, 60, 12);
    g.generateTexture('nest', 80, 44); g.clear();
    g.fillStyle(0x3d6b2a).fillRect(36, 20, 8, 60); g.fillStyle(0xf2c94c).fillCircle(40, 16, 16); g.fillStyle(0x2a7fd4).fillRect(10, 70, 60, 10);
    g.generateTexture('goal', 80, 84); g.destroy();
  }
  // ---- velocity helpers (m/s, +y up)
  v(out){ const b = this.duck.body.velocity, o = out || {x:0, y:0}; o.x = b.x*60/P; o.y = -b.y*60/P; return o; } // pass a scratch object to avoid allocs
  setV(x, y){ this.duck.setVelocity(x*P/60, -y*P/60); }
  onPair(p){
    const a = p.bodyA, b = p.bodyB, o = a.label==='duck' ? b : b.label==='duck' ? a : null; if (!o) return;
    if (o.label === 'ground' || (o.parent && o.parent.label === 'ground')) {
      // walkable only if surface normal is within maxWalkableSlopeDeg of up; steeper = wall (no ground accel, no jump)
      const n = p.collision.normal, sgn = (a.label === 'duck') ? 1 : -1; // Matter normal points B->A; orient it surface->duck
      const ny = n.y * sgn; const ang = Math.acos(Phaser.Math.Clamp(-ny, -1, 1)) * 180 / Math.PI;
      if (ang <= T.maxWalkableSlopeDeg + 0.5) this.st.lastGround = this.time.now; else this.st.lastWall = this.time.now;
    }
  }
  // non-physics triggers: circles (pickups, x-sorted, windowed scan) + AABBs (hazard, goal); runs once per physics step
  checkOverlaps(){
    const s = this.st, dx = MX(this.duck.x), dy = MY(this.duck.y), r = T.duckRadius, pk = this.pickups;
    while (this.pickStart < pk.length && pk[this.pickStart].x < dx - 3) this.pickStart++;
    for (let i = Math.max(0, this.pickStart - 40); i < pk.length; i++) { const q = pk[i]; if (q.x > dx + 3) break; if (!q.active && q.label !== 'nest') continue;
      const ex = q.x - dx, ey = q.y - dy, rr = q.r + r; if (ex*ex + ey*ey > rr*rr) continue;
      if (q.label === 'dew'){ q.active = false; q.go.setVisible(false); s.dew.add(q.go.idx); }
      else if (q.label === 'feather'){ q.active = false; q.go.setVisible(false); s.feathers.add(q.go.idx); }
      else if (q.label === 'nest' && s.checkpoint !== q.go.cp){ s.checkpoint = q.go.cp; q.go.setTint(0xfff0a0); } }
    for (let i = 0; i < this.boxes.length; i++) { const bx = this.boxes[i];
      const cx = Phaser.Math.Clamp(dx, bx.x1, bx.x2), cy = Phaser.Math.Clamp(dy, bx.y1, bx.y2), ex = dx - cx, ey = dy - cy;
      if (ex*ex + ey*ey <= r*r) { if (bx.kind === 'hazard') this.kill('thorns'); else this.win(); } }
  }
  kill(reason){
    const s = this.st; if (s.dead || s.won) return; s.dead = true; s.deaths++; s.lastDeath = {reason, at:this.time.now};
    this.duck.setVisible(false); this.setV(0,0); this.duck.setStatic(true);
    this.time.delayedCall(T.respawnDelayMs, () => {
      const c = s.checkpoint || L.spawn; this.duck.setStatic(false); this.duck.setPosition(X(c.x), Y((c.y||0) + T.duckRadius + (s.checkpoint?0.05:0)));
      this.setV(0,0); this.duck.setVisible(true); s.dead = false; s.diving = false; s.glide = false; s.respawnedAt = this.time.now; this.pickStart = 0; // drops kept
    });
  }
  win(){
    const s = this.st; if (s.won) return; s.won = true; s.time = (this.time.now - s.t0)/1000;
    const lil = [s.dew.size === L.dewdrops.length, s.deaths === 0, s.time <= L.parTime]; s.lilies = lil;
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2, h/2, Math.min(520*RS, w*0.9), 300*RS, 0xffffff, 0.94).setScrollFactor(0).setDepth(30).setStrokeStyle(4, 0x2a7fd4);
    this.add.text(w/2, h/2, [`${L.id} "${L.name}" complete!`, '', `Time: ${s.time.toFixed(1)} s (par ${L.parTime} s)`,
      `Dewdrops: ${s.dew.size}/${L.dewdrops.length}   Feathers: ${s.feathers.size}/${L.feathers.length}`, `Deaths: ${s.deaths}`, '',
      `Lilies: ${lil.map(x => x ? '✿' : '·').join('  ')}   (all drops / no deaths / par)`, '', 'Press R or tap to replay'].join('\n'),
      {font:`${Math.round(20*RS)}px sans-serif`, color:'#16301c', align:'center'}).setOrigin(0.5).setScrollFactor(0).setDepth(31);
    this.input.once('pointerdown', () => this.scene.restart());
  }
  // ---- input
  setupInput(){
    const k = this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,UP,DOWN,SPACE,A,D,W,S,R,BACKTICK,ONE,TWO,THREE,F');
    this.touch = {dir:0, jumpHeld:false, jumpHeldAt:0};
    this.input.addPointer(2);
    const half = () => this.scale.width / 2;
    this.input.on('pointerdown', p => {
      if (this.st.won) return;
      if (p.x < half()) { p._side = 'L'; p._x0 = p.x; }
      else { p._side = 'R'; p._t0 = this.time.now; p._x0 = p.x; p._y0 = p.y; p._dived = false; this.pressJump(); }
    });
    this.input.on('pointermove', p => {
      if (!p.isDown) return;
      if (p._side === 'L') this.touch.dir = Phaser.Math.Clamp((p.x - p._x0) / (T.dragFullSpeedPx * RS), -1, 1);
      if (p._side === 'R' && !p._dived && p.y - p._y0 >= T.swipeDownPx * RS && this.time.now - p._t0 <= T.swipeMaxMs) { p._dived = true; this.dive(); }
    });
    this.input.on('pointerup', p => { if (p._side === 'L') this.touch.dir = 0; if (p._side === 'R') this.releaseJump(); p._side = null; });
    const jk = [k.SPACE, k.UP, k.W]; jk.forEach(x => { x.on('down', () => this.pressJump()); x.on('up', () => this.releaseJump()); });
    k.DOWN.on('down', () => this.dive()); k.S.on('down', () => this.dive());
    k.R.on('down', () => this.scene.restart()); k.BACKTICK.on('down', () => this.toggleDebug());
    k.ONE.on('down', () => { if (this.debugOpen) T.debug.coyote = !T.debug.coyote; });
    k.TWO.on('down', () => { if (this.debugOpen) T.debug.jumpBuffer = !T.debug.jumpBuffer; });
    k.THREE.on('down', () => { if (this.debugOpen) this.showFps = !this.showFps; }); k.F.on('down', () => { this.showFps = !this.showFps; });
  }
  toggleDebug(){ this.debugOpen = !this.debugOpen; }
  jumpHeld(){ const k = this.keys; if (k.SPACE.isDown || k.UP.isDown || k.W.isDown) return true;
    const ps = this.input.manager.pointers; for (let i = 0; i < ps.length; i++) { const p = ps[i]; if (p._side === 'R' && p.isDown && !p._dived) return true; } return false; }
  pressJump(){ this.st.holdStart = this.time.now; this.st.jumpBufferedAt = this.time.now; }
  releaseJump(){ const s = this.st, v = this.v(this._v);
    if (this.time.now - s.jumpAt < T.jumpHoldMs && v.y > 0) this.setV(v.x, v.y * T.jumpCutFactor); // variable jump
    s.holdStart = null; s.glide = false; }
  dive(){ const s = this.st; if (s.diving || s.dead) return; if (s.grounded) { s.diveBufferedAt = this.time.now; return; }
    s.diving = true; s.glide = false; M.Body.setMass(this.duck.body, this.baseMass * T.diveMassMul); this.duck.setTint(0xd09a00); }
  endDive(){ this.st.diving = false; M.Body.setMass(this.duck.body, this.baseMass); this.duck.clearTint(); }
  // ---- fixed physics tick (runs before each Matter step)
  tick(){
    const s = this.st, k = this.keys; if (s.dead || s.won || !k) return;
    const now = this.time.now, dt = STEP;
    const groundedNow = now - s.lastGround < 40;
    const canJumpFromGround = groundedNow || (T.debug.coyote && now - s.lastGround <= T.coyoteMs);
    if (groundedNow && s.diving) this.endDive();
    s.grounded = groundedNow;
    const v = this.v(this._v);
    // roll input
    let dir = this.touch.dir; if (k.LEFT.isDown || k.A.isDown) dir = -1; if (k.RIGHT.isDown || k.D.isDown) dir = 1;
    if (dir) { const acc = groundedNow ? T.groundAccel : T.airAccel; const target = dir * T.maxRollSpeed;
      if (Math.sign(v.x) !== Math.sign(dir) || Math.abs(v.x) < T.maxRollSpeed) v.x += Phaser.Math.Clamp(target - v.x, -acc*dt, acc*dt); }
    else if (groundedNow) v.x -= Math.sign(v.x) * Math.min(Math.abs(v.x), T.groundDecel * dt * 0.25); // (proto) gentle coast; full 28 m/s^2 felt too sticky for momentum
    if (Math.abs(v.x) > T.downhillCap) v.x = Math.sign(v.x) * T.downhillCap;
    // jump (buffer + coyote)
    const buffered = T.debug.jumpBuffer ? now - s.jumpBufferedAt <= T.jumpBufferMs : now - s.jumpBufferedAt <= 20;
    if (buffered && canJumpFromGround && now - s.jumpAt > 150) {
      v.y = Math.max(v.y, 0) * 0.5 + Math.sqrt(2 * T.gravity * T.jumpHeldHeight); s.jumpAt = now; s.jumpBufferedAt = -1e9; s.lastGround = -1e9; s.jumps = (s.jumps||0) + 1;
    }
    // glide: hold >= 150 ms while airborne and falling
    s.glide = !s.diving && !groundedNow && s.holdStart != null && this.jumpHeld() && now - s.holdStart >= T.glideEngageMs && v.y <= 0.5;
    // gravity
    let gMul = 1, cap = T.terminalFall;
    if (s.glide) { gMul = T.glideGravityMul; cap = T.glideFallCap; v.x *= Math.pow(T.glideHorizKeepPerSec, dt); }
    if (s.diving) { gMul = T.diveGravityMul; cap = T.diveTerminal; }
    v.y -= T.gravity * gMul * dt; if (v.y < -cap) v.y = -cap;
    this.setV(v.x, v.y);
    if (s.diveBufferedAt && now - s.diveBufferedAt > T.diveBufferMs) s.diveBufferedAt = 0;
    if (!groundedNow && s.diveBufferedAt) { s.diveBufferedAt = 0; this.dive(); }
    s.maxSpeed = Math.max(s.maxSpeed, Math.abs(v.x));
    if (MY(this.duck.y) < L.killY) this.kill('pit');
    this.checkOverlaps();
  }
  update(time, delta){
    // fixed 60 Hz physics with accumulator: gameplay speed is independent of render fps (max 5 catch-up steps/frame)
    this.acc += Math.min(delta, 250); let n = 0;
    while (this.acc >= STEP_MS && n < T.perf.maxStepsPerFrame) { this.matter.world.step(STEP_MS); this.acc -= STEP_MS; n++; this.physSteps++; }
    if (n === T.perf.maxStepsPerFrame) this.acc = 0; // spiral-of-death guard
    const s = this.st, cam = this.cameras.main, v = this.v(this._v), k60 = delta / STEP_MS;
    if (!s.dead) this.duck.setScale(s.glide ? 1.25 : 1, s.glide ? 1.15 : 1);
    // camera: 3 m look-ahead (frame-rate independent easing), vertical dead zone, clamp via bounds
    if (Math.abs(v.x) > 0.5) s.lookX += (Math.sign(v.x) * X(3) - s.lookX) * (1 - Math.pow(0.95, k60));
    cam.setFollowOffset(-s.lookX, 0); const lerp = 1 - Math.pow(0.9, k60); cam.setLerp(lerp, lerp);
    // prompts
    const mx = MX(this.duck.x); let show = '';
    for (let i = 0; i < L.prompts.length; i++) { const pr = L.prompts[i]; let st = s.prompts[pr.id]; if (!st) st = s.prompts[pr.id] = {shown:false, done:false};
      if (st.done) continue; if (mx >= pr.x - 1 && mx <= pr.x + 6) { st.shown = true; show = pr.text; }
      if (pr.id === 'P1' && st.shown && Math.abs(v.x) > 2) st.done = true;
      if (pr.id === "P2" && st.shown && (s.jumps||0) > 0) st.done = true;
      if (pr.id === 'P3' && st.shown && mx > pr.x + 5) st.done = true; }
    if (show !== this._promptStr) { this._promptStr = show; this.promptText.setText(show); }
    this.promptText.setVisible(!!show && !s.won).setX(this.scale.width / 2);
    if (!s.won) s.time = (this.time.now - s.t0) / 1000;
    // text objects re-rasterize on setText, so only update when the string actually changes
    const hud = `Dewdrops ${s.dew.size}/${L.dewdrops.length}   Feathers ${s.feathers.size}/${L.feathers.length}   Deaths ${s.deaths}   ${s.time.toFixed(1)}s ${s.glide ? ' GLIDE' : s.diving ? ' DIVE' : ''}`;
    if (hud !== this._hudStr) { this._hudStr = hud; this.hud.setText(hud); }
    const dbg = this.debugOpen ? `DEBUG (\` to close)\n[1] coyote ${T.debug.coyote ? 'ON' : 'off'} (${T.coyoteMs}ms)\n[2] jump buffer ${T.debug.jumpBuffer ? 'ON' : 'off'} (${T.jumpBufferMs}ms)\n[3] FPS counter ${this.showFps ? 'ON' : 'off'} (F)\nx=${mx.toFixed(1)} y=${MY(this.duck.y).toFixed(1)} vx=${v.x.toFixed(1)}` : 'DBG';
    if (dbg !== this._dbgStr) { this._dbgStr = dbg; this.dbg.setText(dbg); } this.dbg.setX(this.scale.width - 10*RS);
    // FPS counter (F, debug [3], ?fps=1): refresh 4x/s
    this.fpsAcc += delta; this.fpsFrames++; if (delta > this.fpsWorst) this.fpsWorst = delta;
    if (this.fpsAcc >= 250) { if (this.showFps) this.fpsText.setText(`${(1000 * this.fpsFrames / this.fpsAcc).toFixed(0)} fps  worst ${this.fpsWorst.toFixed(0)}ms  ${this.game.canvas.width}x${this.game.canvas.height}@${RS.toFixed(2)}`);
      this.fpsAcc = 0; this.fpsFrames = 0; this.fpsWorst = 0; }
    this.fpsText.setVisible(this.showFps);
    // adaptive resolution: if the 2 s average drops below perf.downgradeBelowFps, drop render scale to 1 (live + remembered)
    this.adAcc = (this.adAcc || 0) + delta; this.adFrames = (this.adFrames || 0) + 1;
    if (this.adAcc >= 2000) { const fps = 1000 * this.adFrames / this.adAcc; this.adAcc = 0; this.adFrames = 0;
      if (fps < T.perf.downgradeBelowFps && RS > 1 && !QS.get('rs') && this.time.now > 3000) this.downgrade(fps); }
  }
}
const GAME = new Phaser.Game({type:Phaser.WEBGL, parent:document.body, backgroundColor:'#cfe9d8',
  antialias:false, antialiasGL:false, roundPixels:true, powerPreference:'high-performance', disableContextMenu:true,
  fps:{target:60, smoothStep:false},
  scale:{mode:Phaser.Scale.FIT, autoCenter:Phaser.Scale.CENTER_BOTH, width:Math.round(innerWidth*RS), height:Math.round(innerHeight*RS)},
  physics:{default:'matter', matter:{gravity:{y:0}, autoUpdate:false, enableSleeping:false, debug:window.TUNING.debug.showBodies}}, scene:[Play]});
addEventListener('resize', () => { RS = renderScale(); GAME.scale.setGameSize(Math.round(innerWidth*RS), Math.round(innerHeight*RS)); });
