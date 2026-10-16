// ALL feel constants in one config. Physics units: meters, seconds (converted to px internally).
// Values from docs/design/gdd.md §4 unless marked (proto).
window.TUNING = {
  ppm: 40,                 // (proto) pixels per meter
  duckRadius: 0.45,        // level1-1 spec
  gravity: 30,             // m/s^2
  maxRollSpeed: 7.5,       // m/s ground
  downhillCap: 10,         // m/s on downhill momentum
  groundAccel: 22, groundDecel: 28, airAccel: 12, // m/s^2
  terminalFall: 14,        // m/s
  jumpHeldHeight: 3.0,     // m (held 200 ms)
  jumpTapHeight: 2.2,      // m (tap)
  jumpHoldMs: 200, jumpCutFactor: 0.5,
  glideGravityMul: 0.18, glideFallCap: 2.5, glideHorizKeepPerSec: 0.95, glideEngageMs: 150,
  diveGravityMul: 2.6, diveTerminal: 22, diveMassMul: 3,
  coyoteMs: 100, jumpBufferMs: 120, diveBufferMs: 80,
  tapMaxMs: 180, tapMaxMovePx: 20,
  swipeDownPx: 60, swipeMaxMs: 200,
  respawnDelayMs: 300,     // (proto) must be <= 600 per spec
  dragFullSpeedPx: 60,     // (proto) drag distance for full analog roll
  density: 0.001, friction: 0.6, restitution: 0.05,
  // debug toggles (debug menu: press ` or tap the DBG button)
  debug: { coyote: true, jumpBuffer: true, showBodies: false }
};
