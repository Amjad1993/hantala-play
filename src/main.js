// Hantala prototype — Phaser 3 + Matter.js. Level data: levels/*.json (meters, +y up).
const T = window.TUNING, P = T.ppm, STEP = 1/60;
const LEVEL_URL = new URLSearchParams(location.search).get('level') || 'levels/level1-1.json';
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
    for (const c of L.chains) for (let i = 0; i < c.length - 1; i++) {
      const [x1,y1] = c[i], [x2,y2] = c[i+1]; if (x2 <= x1) continue;
      const v = [{x:X(x1),y:Y(y1)},{x:X(x2),y:Y(y2)},{x:X(x2),y:Y(L.solidBottom)},{x:X(x1),y:Y(L.solidBottom)}];
      const ctr = M.Vertices.centre(v);
      this.matter.add.fromVertices(ctr.x, ctr.y, v, {isStatic:true, label:'ground', friction:T.friction});
      g.fillPoints(v, true);
    }
    for (const p of L.platforms){ const r = this.add.rectangle(X((p.x1+p.x2)/2), Y(p.y - p.h/2), X(p.x2-p.x1), X(p.h), 0x7a9a4a);
      this.matter.add.gameObject(r, {isStatic:true, label:'ground', friction:T.friction}); }
    for (const h of L.hazards){ // visual full size, collider inset
      g.fillStyle(0x7a2a3a);
      for (let x = h.x1; x < h.x2; x += 0.4) g.fillTriangle(X(x), Y(h.y), X(x+0.4), Y(h.y), X(x+0.2), Y(h.y+h.h));
      this.matter.add.rectangle(X((h.x1+h.x2)/2), Y(h.y + h.h/2), X(h.x2-h.x1-2*h.inset), X(h.h-h.inset), {isStatic:true, isSensor:true, label:'hazard'});
    }
    const sensor = (x,y,r,tex,label,extra) => { const s = this.matter.add.image(X(x), Y(y), tex, null, {isStatic:true, isSensor:true, label, shape:{type:'circle', radius:X(r)}}); Object.assign(s, extra); return s; };
    this.drops = L.dewdrops.map((d,i) => sensor(d.x, d.y, L.dropRadius, 'dew', 'dew', {idx:i}));
    this.feathers = L.feathers.map((f,i) => sensor(f.x, f.y, f.r||0.4, 'feather', 'feather', {idx:i}));
    this.nests = L.checkpoints.map(c => sensor(c.x, c.y + 0.3, c.r, 'nest', 'nest', {cp:c}));
    const gl = L.goal; this.add.image(X(gl.x), Y(gl.y + 0.6), 'goal');
    this.matter.add.rectangle(X(gl.x), Y(gl.y + gl.h/2), X(gl.w), X(gl.h), {isStatic:true, isSensor:true, label:'goal'});
    this.duck = this.matter.add.image(X(L.spawn.x), Y(L.spawn.y), 'duck', null, {shape:{type:'circle', radius:X(T.duckRadius)},
      friction:T.friction, frictionAir:0, restitution:T.restitution, density:T.density, label:'duck'});
    this.baseMass = this.duck.body.mass;
    this.matter.world.setGravity(0, 0); // custom gravity in m/s^2 applied in tick()
    const cam = this.cameras.main; cam.startFollow(this.duck, false, 1, 1); cam.setDeadzone(0, X(3));
    this.fitZoom(); this.scale.on('resize', () => this.fitZoom());
    this.st = { dew:new Set(), feathers:new Set(), deaths:0, t0:this.time.now, time:0, won:false, glide:false, diving:false,
                grounded:false, lastGround:-1e9, jumpBufferedAt:-1e9, jumpAt:-1e9, checkpoint:null, dead:false, lookX:0,
                prompts:{}, maxSpeed:0 };
    this.matter.world.on('collisionstart', e => e.pairs.forEach(p => this.onPair(p, true)));
    this.matter.world.on('collisionactive', e => e.pairs.forEach(p => this.onPair(p, false)));
    this.matter.world.on('beforeupdate', () => this.tick());
    this.hud = this.add.text(12, 10, '', {font:'18px sans-serif', color:'#16301c', backgroundColor:'#ffffffaa', padding:{x:6,y:4}}).setScrollFactor(0).setDepth(20);
    this.promptText = this.add.text(0, 60, '', {font:'22px sans-serif', color:'#fff', backgroundColor:'#16301ccc', padding:{x:10,y:6}}).setScrollFactor(0).setDepth(20).setOrigin(0.5,0);
    this.dbg = this.add.text(0, 10, '', {font:'14px monospace', color:'#000', backgroundColor:'#fff9', padding:{x:6,y:4}}).setScrollFactor(0).setDepth(21).setOrigin(1,0).setInteractive();
    this.dbg.on('pointerdown', (p, lx, ly, ev) => { ev.stopPropagation(); this.toggleDebug(); });
    this.debugOpen = false; this.setupInput(); window.__hantala = this;
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
  v(){ const b = this.duck.body.velocity; return {x: b.x*60/P, y: -b.y*60/P}; }
  setV(x, y){ this.duck.setVelocity(x*P/60, -y*P/60); }
  onPair(p, start){
    const a = p.bodyA, b = p.bodyB, o = a.label==='duck' ? b : b.label==='duck' ? a : null; if (!o) return;
    if (o.label === 'ground' || (o.parent && o.parent.label === 'ground')) {
      // walkable only if surface normal is within maxWalkableSlopeDeg of up; steeper = wall (no ground accel, no jump)
      const n = p.collision.normal, sgn = (a.label === 'duck') ? 1 : -1; // Matter normal points B->A; orient it surface->duck
      const ny = n.y * sgn; const ang = Math.acos(Phaser.Math.Clamp(-ny, -1, 1)) * 180 / Math.PI;
      if (ang <= T.maxWalkableSlopeDeg + 0.5) this.st.lastGround = this.time.now; else this.st.lastWall = this.time.now;
      return;
    }
    if (!start) return;
    const go = o.gameObject;
    if (o.label === 'dew' && go && go.active){ go.setActive(false).setVisible(false); this.st.dew.add(go.idx); }
    if (o.label === 'feather' && go && go.active){ go.setActive(false).setVisible(false); this.st.feathers.add(go.idx); }
    if (o.label === 'nest' && go){ if (this.st.checkpoint !== go.cp){ this.st.checkpoint = go.cp; go.setTint(0xfff0a0); } }
    if (o.label === 'hazard') this.kill('thorns');
    if (o.label === 'goal') this.win();
  }
  kill(reason){
    const s = this.st; if (s.dead || s.won) return; s.dead = true; s.deaths++; s.lastDeath = {reason, at:this.time.now};
    this.duck.setVisible(false); this.setV(0,0); this.duck.setStatic(true);
    this.time.delayedCall(T.respawnDelayMs, () => {
      const c = s.checkpoint || L.spawn; this.duck.setStatic(false); this.duck.setPosition(X(c.x), Y((c.y||0) + T.duckRadius + (s.checkpoint?0.05:0)));
      this.setV(0,0); this.duck.setVisible(true); s.dead = false; s.diving = false; s.glide = false; s.respawnedAt = this.time.now; // drops kept
    });
  }
  win(){
    const s = this.st; if (s.won) return; s.won = true; s.time = (this.time.now - s.t0)/1000;
    const lil = [s.dew.size === L.dewdrops.length, s.deaths === 0, s.time <= L.parTime]; s.lilies = lil;
    const w = this.scale.width, h = this.scale.height;
    this.add.rectangle(w/2, h/2, Math.min(520, w*0.9), 300, 0xffffff, 0.94).setScrollFactor(0).setDepth(30).setStrokeStyle(4, 0x2a7fd4);
    this.add.text(w/2, h/2, [`${L.id} "${L.name}" complete!`, '', `Time: ${s.time.toFixed(1)} s (par ${L.parTime} s)`,
      `Dewdrops: ${s.dew.size}/${L.dewdrops.length}   Feathers: ${s.feathers.size}/${L.feathers.length}`, `Deaths: ${s.deaths}`, '',
      `Lilies: ${lil.map(x => x ? '✿' : '·').join('  ')}   (all drops / no deaths / par)`, '', 'Press R or tap to replay'].join('\n'),
      {font:'20px sans-serif', color:'#16301c', align:'center'}).setOrigin(0.5).setScrollFactor(0).setDepth(31);
    this.input.once('pointerdown', () => this.scene.restart());
  }
  // ---- input
  setupInput(){
    const k = this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,UP,DOWN,SPACE,A,D,W,S,R,BACKTICK,ONE,TWO');
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
      if (p._side === 'L') this.touch.dir = Phaser.Math.Clamp((p.x - p._x0) / T.dragFullSpeedPx, -1, 1);
      if (p._side === 'R' && !p._dived && p.y - p._y0 >= T.swipeDownPx && this.time.now - p._t0 <= T.swipeMaxMs) { p._dived = true; this.dive(); }
    });
    this.input.on('pointerup', p => { if (p._side === 'L') this.touch.dir = 0; if (p._side === 'R') this.releaseJump(); p._side = null; });
    const jk = [k.SPACE, k.UP, k.W]; jk.forEach(x => { x.on('down', () => this.pressJump()); x.on('up', () => this.releaseJump()); });
    k.DOWN.on('down', () => this.dive()); k.S.on('down', () => this.dive());
    k.R.on('down', () => this.scene.restart()); k.BACKTICK.on('down', () => this.toggleDebug());
    k.ONE.on('down', () => { if (this.debugOpen) T.debug.coyote = !T.debug.coyote; });
    k.TWO.on('down', () => { if (this.debugOpen) T.debug.jumpBuffer = !T.debug.jumpBuffer; });
  }
  toggleDebug(){ this.debugOpen = !this.debugOpen; }
  jumpHeld(){ const k = this.keys; return k.SPACE.isDown || k.UP.isDown || k.W.isDown || this.input.manager.pointers.some(p => p._side === 'R' && p.isDown && !p._dived); }
  pressJump(){ this.st.holdStart = this.time.now; this.st.jumpBufferedAt = this.time.now; }
  releaseJump(){ const s = this.st, v = this.v();
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
    let v = this.v();
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
  }
  update(){
    const s = this.st, cam = this.cameras.main, v = this.v();
    if (!s.dead) this.duck.setScale(s.glide ? 1.25 : 1, s.glide ? 1.15 : 1);
    // camera: 3 m look-ahead, vertical dead zone ±1.5 m, clamp via bounds
    if (Math.abs(v.x) > 0.5) s.lookX = Phaser.Math.Linear(s.lookX, Math.sign(v.x) * X(3), 0.05);
    cam.setFollowOffset(-s.lookX, 0); cam.setLerp(0.1, 0.1);
    // prompts
    const mx = MX(this.duck.x); let show = '';
    for (const pr of L.prompts) { const st = s.prompts[pr.id] || (s.prompts[pr.id] = {shown:false, done:false});
      if (st.done) continue; if (mx >= pr.x - 1 && mx <= pr.x + 6) { st.shown = true; show = pr.text; }
      if (pr.id === 'P1' && st.shown && Math.abs(v.x) > 2) st.done = true;
      if (pr.id === "P2" && st.shown && (s.jumps||0) > 0) st.done = true;
      if (pr.id === 'P3' && st.shown && mx > pr.x + 5) st.done = true; }
    this.promptText.setText(show).setVisible(!!show && !s.won).setX(this.scale.width / 2);
    if (!s.won) s.time = (this.time.now - s.t0) / 1000;
    this.hud.setText(`Dewdrops ${s.dew.size}/${L.dewdrops.length}   Feathers ${s.feathers.size}/${L.feathers.length}   Deaths ${s.deaths}   ${s.time.toFixed(1)}s ${s.glide ? ' GLIDE' : s.diving ? ' DIVE' : ''}`);
    this.dbg.setX(this.scale.width - 10).setText(this.debugOpen
      ? `DEBUG (\` to close)\n[1] coyote ${T.debug.coyote ? 'ON' : 'off'} (${T.coyoteMs}ms)\n[2] jump buffer ${T.debug.jumpBuffer ? 'ON' : 'off'} (${T.jumpBufferMs}ms)\nx=${mx.toFixed(1)} y=${MY(this.duck.y).toFixed(1)} vx=${v.x.toFixed(1)} fps=${this.game.loop.actualFps.toFixed(0)}`
      : 'DBG');
  }
}
new Phaser.Game({type:Phaser.AUTO, parent:document.body, backgroundColor:'#cfe9d8',
  scale:{mode:Phaser.Scale.RESIZE, width:window.innerWidth, height:window.innerHeight},
  physics:{default:'matter', matter:{gravity:{y:0}, debug:window.TUNING.debug.showBodies}}, scene:[Play]});
