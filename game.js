/* ============================================================
   THE MEME GAME — 16 levels of perfectly planned betrayal.
   Canvas platformer. The floor is lying. So is the door.
   Levels + strategies follow level_strategies.txt, plus one original (level 2).
   ============================================================ */
"use strict";

const W = 960, H = 540;
const cv = document.getElementById("game");
const ctx = cv.getContext("2d");

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const aabb = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const R = (x, y, w, h) => ({ x, y, w, h });
// a trigger is either a rect (player overlap) or a predicate on the game state
const triggered = (g, t) =>
  typeof t === "function" ? !!t(g) : t ? aabb(g.player, t) : false;
const FONT = "'Outfit', system-ui, -apple-system, sans-serif";

// ---------------------------------------------------------------- theme
const PALETTES = {
  dark: {
    paper: "#14161d", paper2: "#1c1f29", ink: "#ece8df",
    grid: "rgba(236,232,223,0.045)", vignette: "rgba(0,0,0,0.30)",
    danger: "#ff5d52", accent: "#ffb24d", door: "#ffb24d",
    blood: "#ff5d52", bloodDark: "#b83a31", dust: "#565b69",
    metal: "#2c3140", crack: "rgba(18,20,27,0.5)", wipe: "#0b0c11",
    shadow: "rgba(0,0,0,0.28)",
  },
  light: {
    paper: "#f5f2ea", paper2: "#e8e2d6", ink: "#1c1e26",
    grid: "rgba(28,30,38,0.05)", vignette: "rgba(70,55,40,0.06)",
    danger: "#e5463c", accent: "#ef7c1b", door: "#ef7c1b",
    blood: "#e5463c", bloodDark: "#a8322a", dust: "#c0b8a8",
    metal: "#c9c2b3", crack: "rgba(245,242,234,0.55)", wipe: "#1c1e26",
    shadow: "rgba(40,35,28,0.14)",
  },
};
let theme = PALETTES.dark;

function applyTheme(mode, save = true) {
  theme = PALETTES[mode] || PALETTES.dark;
  document.documentElement.setAttribute("data-theme", mode);
  if (save) { try { localStorage.setItem("tmg_theme", mode); } catch {} }
  const t = document.getElementById("ic-theme");
  if (t) t.innerHTML = mode === "dark" ? SUN_PATH : MOON_PATH;
}
function currentMode() { return document.documentElement.getAttribute("data-theme") || "dark"; }
function toggleTheme() { applyTheme(currentMode() === "dark" ? "light" : "dark"); }

// ---------------------------------------------------------------- audio
const AudioFX = (() => {
  let ac = null, muted = false;
  const ensure = () => {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    return ac;
  };
  function tone(freq, dur, type = "square", vol = 0.12, slide = 0) {
    if (muted) return;
    const a = ensure();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur + 0.02);
  }
  function noise(dur, vol = 0.25, lp = 900) {
    if (muted) return;
    const a = ensure();
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = lp;
    const g = a.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }
  return {
    init: ensure,
    jump: () => tone(330, 0.12, "square", 0.08, 260),
    land: () => noise(0.06, 0.10, 500),
    death: () => { noise(0.25, 0.3, 700); tone(160, 0.3, "sawtooth", 0.14, -110); },
    pop: () => tone(700, 0.07, "square", 0.09, 300),
    rumble: () => noise(0.35, 0.22, 220),
    slam: () => { noise(0.18, 0.3, 350); tone(90, 0.18, "sine", 0.2, -40); },
    poof: () => tone(500, 0.16, "triangle", 0.1, -320),
    bounce: () => tone(300, 0.18, "sine", 0.12, 520),
    zap: () => { tone(1200, 0.12, "sawtooth", 0.07, -700); noise(0.07, 0.1, 1600); },
    beep: () => tone(900, 0.04, "square", 0.04),
    win: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.16, "square", 0.09), i * 90)); },
    laugh: () => { [300, 260, 300, 260, 220].forEach((f, i) => setTimeout(() => tone(f, 0.09, "sawtooth", 0.06), i * 110)); },
    toggleMute: () => { muted = !muted; return muted; },
    isMuted: () => muted,
  };
})();

// ---------------------------------------------------------------- input
const keys = {};
let jumpBuffered = 0;
addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
  if (!keys[e.code]) {
    if (["Space", "ArrowUp", "KeyW"].includes(e.code)) jumpBuffered = 0.12;
  }
  keys[e.code] = true;
  if (e.code === "KeyR" && Game.state === "play") Game.restartLevel(true);
  if (e.code === "ArrowDown" || e.code === "KeyS") Game.tryFlip();
  if (e.code === "KeyH") toggleHint();
  if (e.code === "KeyM") setMuteIcon(AudioFX.toggleMute());
  if (e.code === "KeyT") toggleTheme();
  if (e.code === "KeyF") toggleFullscreen();
  AudioFX.init();
});
addEventListener("keyup", (e) => (keys[e.code] = false));

// touch input (mobile)
const touch = { left: false, right: false, jump: false };
const IS_TOUCH = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

const heldLeft = () => keys["ArrowLeft"] || keys["KeyA"] || touch.left;
const heldRight = () => keys["ArrowRight"] || keys["KeyD"] || touch.right;
const heldJump = () => keys["Space"] || keys["ArrowUp"] || keys["KeyW"] || touch.jump;

// ---------------------------------------------------------------- particles
const particles = [];
function spawnBlood(x, y) {
  for (let i = 0; i < 26; i++) {
    const a = rand(-Math.PI, 0), s = rand(120, 420);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: rand(2.5, 6), life: rand(0.5, 1.1), t: 0,
      color: Math.random() < 0.8 ? theme.blood : theme.bloodDark, grav: true,
    });
  }
}
function spawnDust(x, y, n = 6, color = null) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x: x + rand(-10, 10), y, vx: rand(-60, 60), vy: rand(-90, -20),
      r: rand(2, 4.5), life: rand(0.25, 0.5), t: 0, color: color || theme.dust, grav: false,
    });
  }
}
function spawnPoof(x, y) {
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2), s = rand(40, 160);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: rand(3, 7), life: rand(0.3, 0.55), t: 0, color: theme.accent, grav: false,
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t > p.life) { particles.splice(i, 1); continue; }
    if (p.grav) p.vy += 1300 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- blood stains (persist until respawn)
let stains = [];
function addStain(x, y) {
  for (let i = 0; i < 8; i++) stains.push({ x: x + rand(-26, 26), y: y + rand(-4, 4), r: rand(3, 9) });
}

// ================================================================ TRAPS
// Every trap implements: update(dt,g), solids() -> [rects], kills() -> [rects], draw()

class CollapseFloor {
  constructor(rect, trigger, opts = {}) {
    this.rect = { ...rect };
    this.trigger = trigger;
    this.shakeTime = opts.shakeTime ?? 0.18;
    this.delay = opts.delay ?? 0;
    this.reset();
  }
  reset() { this.state = "idle"; this.t = 0; this.dy = 0; this.vy = 0; }
  update(dt, g) {
    if (this.state === "idle" && triggered(g, this.trigger)) {
      this.state = "wait"; this.t = 0;
    } else if (this.state === "wait") {
      this.t += dt;
      if (this.t >= this.delay) { this.state = "shake"; this.t = 0; AudioFX.rumble(); g.shake(4, 0.18); }
    } else if (this.state === "shake") {
      this.t += dt;
      if (this.t >= this.shakeTime) { this.state = "fall"; AudioFX.pop(); }
    } else if (this.state === "fall") {
      this.vy += 2400 * dt;
      this.dy += this.vy * dt;
    }
  }
  solids() { return this.state === "fall" ? [] : [this.rect]; }
  kills() { return []; }
  draw() {
    if (this.dy > H) return;
    const r = this.rect;
    let ox = 0;
    if (this.state === "shake") ox = rand(-2.5, 2.5);
    ctx.fillStyle = theme.ink;
    if (this.state === "fall") {
      const n = Math.max(2, Math.floor(r.w / 46));
      const cw = r.w / n;
      for (let i = 0; i < n; i++) {
        const wob = Math.sin(i * 7.3) * this.dy * 0.18;
        ctx.fillRect(r.x + i * cw + 1, r.y + this.dy + wob, cw - 2, r.h);
      }
    } else {
      ctx.fillRect(r.x + ox, r.y, r.w, r.h);
    }
  }
}

class PopSpikes {
  constructor(x, y, w, trigger, opts = {}) {
    this.x = x; this.y = y; this.w = w;
    this.dir = opts.dir ?? "up";
    this.size = opts.size ?? 26;
    this.delay = opts.delay ?? 0;
    this.trigger = trigger; // null => periodic
    this.period = opts.period ?? 0;
    this.phase = opts.phase ?? 0;
    this.holdOut = opts.holdOut ?? 0.8;
    this.speed = opts.speed ?? 14;
    // seconds a TRIGGERED patch stays up before pulling back down; null => it
    // stays out for good (the original behaviour). Periodic patches use `holdOut`.
    this.retract = opts.retract ?? null;
    // { dx, speed, on, after } — the patch creeps sideways once armed. on:"overhead"
    // (default) waits until the player is in the air above it; on:"trigger"
    // starts the moment the patch itself is triggered. `after` holds the lunge
    // back that many seconds once armed, so a patch that is still rising has time
    // to surface first — without it a fast slide finishes underground and the
    // player only ever sees the patch sitting at its destination.
    this.slide = opts.slide ?? null;
    this.reset();
  }
  reset() {
    this.out = 0;
    this.state = this.trigger ? "idle" : "cycle";
    this.t = -this.delay; this.ct = this.phase;
    this.ox = 0; this.chasing = false; this.slideWait = 0;
  }
  update(dt, g) {
    if (this.state === "idle") {
      if (triggered(g, this.trigger)) { this.state = "popping"; this.t = -this.delay; }
    } else if (this.state === "popping") {
      this.t += dt;
      if (this.t >= 0) {
        if (this.out === 0) AudioFX.pop();
        this.out = clamp(this.out + this.speed * dt, 0, 1);
        // t hits 0 the instant they start showing, so this counts from the
        // spikes appearing rather than from the trigger being tripped
        if (this.retract !== null && this.t >= this.retract) this.state = "retracting";
      }
    } else if (this.state === "retracting") {
      this.out = clamp(this.out - this.speed * 0.6 * dt, 0, 1);
      if (this.out <= 0) this.state = "spent";
    } else if (this.state === "cycle") {
      this.ct += dt;
      const cyc = this.ct % this.period;
      if (cyc < this.holdOut) {
        if (this.out < 0.1) AudioFX.pop();
        this.out = clamp(this.out + this.speed * dt, 0, 1);
      } else {
        this.out = clamp(this.out - this.speed * 0.6 * dt, 0, 1);
      }
    }
    if (this.slide) this._creep(dt, g);
  }
  _creep(dt, g) {
    const p = g.player;
    const x0 = this.x + this.ox;
    // armed the moment they are in the air directly over the patch
    const armed = this.slide.on === "trigger"
      ? this.state !== "idle"
      : !p.grounded &&
        p.x + p.w > x0 && p.x < x0 + this.w &&
        p.y + p.h <= this.y;
    if (armed && !this.chasing) { this.chasing = true; if (!this.slide.after) AudioFX.rumble(); }
    if (!this.chasing) return;
    // hold station until `after` has elapsed, then lunge
    const wait = this.slide.after ?? 0;
    if (this.slideWait < wait) {
      this.slideWait += dt;
      if (this.slideWait >= wait) AudioFX.rumble();
      return;
    }
    const span = Math.abs(this.slide.dx);
    const left = span - Math.abs(this.ox);
    if (left <= 0) return;
    const step = Math.min((this.slide.speed ?? 240) * dt, left);
    this.ox += Math.sign(this.slide.dx) * step;
  }
  solids() { return []; }
  kills() {
    if (this.out < 0.45) return [];
    const h = this.size * this.out - 6;
    const x0 = this.x + this.ox;
    if (this.dir === "up") return [R(x0 + 4, this.y - h, this.w - 8, h)];
    return [R(x0 + 4, this.y, this.w - 8, h)];
  }
  draw() {
    if (this.out <= 0.01) return;
    const h = this.size * this.out;
    const n = Math.max(2, Math.round(this.w / 18));
    const sw = this.w / n;
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const bx = this.x + this.ox + i * sw;
      if (this.dir === "up") {
        ctx.moveTo(bx, this.y);
        ctx.lineTo(bx + sw / 2, this.y - h);
        ctx.lineTo(bx + sw, this.y);
      } else {
        ctx.moveTo(bx, this.y);
        ctx.lineTo(bx + sw / 2, this.y + h);
        ctx.lineTo(bx + sw, this.y);
      }
    }
    ctx.fill();
  }
}

class FallBlock {
  constructor(rect, trigger, opts = {}) {
    this.home = { ...rect };
    this.trigger = trigger;
    this.shakeT = opts.shakeTime ?? 0.12;
    this.floorY = opts.floorY ?? 480;
    this.reset();
  }
  reset() { this.rect = { ...this.home }; this.state = "idle"; this.t = 0; this.vy = 0; }
  update(dt, g) {
    if (this.state === "idle" && triggered(g, this.trigger)) {
      this.state = "shake"; this.t = 0; AudioFX.rumble();
    } else if (this.state === "shake") {
      this.t += dt;
      if (this.t > this.shakeT) this.state = "fall";
    } else if (this.state === "fall") {
      this.vy += 3000 * dt;
      this.rect.y += this.vy * dt;
      if (this.rect.y + this.rect.h >= this.floorY) {
        this.rect.y = this.floorY - this.rect.h;
        this.state = "landed";
        AudioFX.slam();
        g.shake(7, 0.22);
        spawnDust(this.rect.x + this.rect.w / 2, this.floorY, 12);
      }
    }
  }
  solids() { return this.state === "fall" ? [] : [this.rect]; }
  kills() { return this.state === "fall" ? [R(this.rect.x + 3, this.rect.y + 4, this.rect.w - 6, this.rect.h - 4)] : []; }
  draw() {
    const r = this.rect;
    let ox = this.state === "shake" ? rand(-2, 2) : 0;
    ctx.fillStyle = theme.ink;
    ctx.fillRect(r.x + ox, r.y, r.w, r.h);
    ctx.strokeStyle = theme.crack;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * 0.3 + ox, r.y);
    ctx.lineTo(r.x + r.w * 0.45 + ox, r.y + r.h * 0.5);
    ctx.lineTo(r.x + r.w * 0.32 + ox, r.y + r.h);
    ctx.stroke();
  }
}

class Crusher {
  constructor(x, w, opts = {}) {
    this.x = x; this.w = w;
    this.topY = opts.topY ?? 0;
    this.headH = opts.headH ?? 46;
    this.floorY = opts.floorY ?? 480;
    this.period = opts.period ?? 0;
    this.phase = opts.phase ?? 0;
    this.trigger = opts.trigger ?? null;
    this.slamSpeed = opts.slamSpeed ?? 1500;
    this.upSpeed = opts.upSpeed ?? 240;
    this.holdT = opts.hold ?? 0.32;
    this.reset();
  }
  reset() {
    this.y = this.topY;
    this.state = this.trigger ? "armed" : "waiting";
    this.t = this.phase;
    this.slammed = false;
  }
  update(dt, g) {
    const maxY = this.floorY - this.headH;
    if (this.state === "armed") {
      if (triggered(g, this.trigger)) { this.state = "slam"; }
    } else if (this.state === "waiting") {
      this.t += dt;
      if (this.t >= this.period) { this.t = 0; this.state = "slam"; }
    } else if (this.state === "slam") {
      this.y += this.slamSpeed * dt;
      if (this.y >= maxY) {
        this.y = maxY;
        this.state = "hold"; this.t = 0;
        if (!this.slammed) { AudioFX.slam(); g.shake(6, 0.18); spawnDust(this.x + this.w / 2, this.floorY, 10); }
        this.slammed = true;
      }
    } else if (this.state === "hold") {
      this.t += dt;
      if (this.t >= this.holdT) this.state = "rise";
    } else if (this.state === "rise") {
      this.y -= this.upSpeed * dt;
      if (this.y <= this.topY) {
        this.y = this.topY;
        this.slammed = false;
        this.state = this.trigger ? "spent" : "waiting";
        this.t = 0;
      }
    }
  }
  headRect() { return R(this.x, this.y, this.w, this.headH); }
  solids() { return [this.headRect()]; }
  kills() {
    if (this.state === "slam") return [R(this.x + 2, this.y + this.headH - 14, this.w - 4, 16)];
    return [];
  }
  draw() {
    ctx.fillStyle = theme.metal;
    ctx.fillRect(this.x + this.w / 2 - 9, this.topY, 18, this.y - this.topY + 4);
    const h = this.headRect();
    ctx.fillStyle = theme.ink;
    ctx.fillRect(h.x, h.y, h.w, h.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(h.x, h.y + h.h - 12, h.w, 12);
    ctx.clip();
    ctx.fillStyle = theme.accent;
    for (let i = -1; i < h.w / 16 + 1; i++) {
      ctx.beginPath();
      ctx.moveTo(h.x + i * 16, h.y + h.h);
      ctx.lineTo(h.x + i * 16 + 8, h.y + h.h - 12);
      ctx.lineTo(h.x + i * 16 + 16, h.y + h.h - 12);
      ctx.lineTo(h.x + i * 16 + 8, h.y + h.h);
      ctx.fill();
    }
    ctx.restore();
  }
}

class CrumblePlatform {
  constructor(rect, opts = {}) {
    this.home = { ...rect };
    this.delay = opts.delay ?? 0.35;
    // how many separate arrivals it survives before it starts to go. 1 = the
    // usual "steps on it once and it crumbles"; 2 = safe the first time you
    // stand on it, gives way when you come back to it.
    this.afterVisits = opts.afterVisits ?? 1;
    // fraction of the player's width that must be over the tile before it counts
    // as standing on it. 0 = any overlap at all (the original behaviour).
    this.coverage = opts.coverage ?? 0;
    // the crack hatching reads as clutter on narrow tiles; off = a plain slab
    this.cracks = opts.cracks ?? true;
    // seconds the player must STAND on the tile before it commits to falling.
    // 0 = goes the instant they land on it (the original behaviour). The clock
    // only runs while they are actually on it and resets when they step off,
    // so a quick hop across is free and loitering is not.
    this.dwell = opts.dwell ?? 0;
    this.reset();
  }
  reset() {
    this.rect = { ...this.home };
    this.state = "idle"; this.t = 0; this.vy = 0;
    this.visits = 0; this.wasOn = false; this.on = 0; this._skipTick = false;
  }
  // overlap in px between the player and this tile's top face
  _over(p) {
    return Math.min(p.x + p.w, this.rect.x + this.rect.w) - Math.max(p.x, this.rect.x);
  }
  // the player's feet are on this tile's surface
  _level(p) {
    return p.grounded && Math.abs(p.y + p.h - this.rect.y) < 3;
  }
  // the least overlap that counts as this tile carrying part of the player.
  // Tiles can be laid out overlapping, so a couple of px of clip is not a bridge.
  _shareBar(p) { return p.w * this.coverage / 2; }
  // every other still-standing crumble tile on the same shelf that is genuinely
  // sharing the player's weight with this one
  _bridge(g, p) {
    const out = [];
    for (const t of g.level.traps) {
      if (t === this || !(t instanceof CrumblePlatform)) continue;
      if (t.state !== "idle") continue;
      if (Math.abs(t.rect.y - this.rect.y) > 1) continue;
      if (t._over(p) >= t._shareBar(p)) out.push(t);
    }
    return out;
  }
  // start falling, taking any tile bridged by the same player down with it, so a
  // player straddling a seam never gets to ride one half down. The transition is
  // deferred to each tile's own update so every bridged tile starts shaking on
  // the same frame no matter what order the traps are stored in.
  commit(g) {
    if (this.state !== "idle") return;
    this.state = "shaking"; this.t = 0; AudioFX.rumble();
    const p = g.player;
    if (!this._level(p) || this._over(p) <= 0) return;
    const traps = g.level.traps, self = traps.indexOf(this);
    for (const t of this._bridge(g, p)) {
      t.commit(g);
      // tiles further down the trap list still get updated this frame; hold their
      // first shake tick back so the whole bridged group runs on one clock
      if (traps.indexOf(t) > self) t._skipTick = true;
    }
  }
  update(dt, g) {
    if (this.state === "idle") {
      const p = g.player;
      const over = this._over(p);
      const onSurface = this._level(p) && over > 0;
      // normally a tile only counts once `coverage` of the player is over it.
      // Straddling a seam leaves neither tile past that bar even though the pair
      // is carrying the whole player, so pool the overlap across the bridge.
      const solo = over >= p.w * this.coverage;
      const shared = onSurface && !solo && over >= this._shareBar(p) &&
        over + this._bridge(g, p).reduce((n, t) => n + t._over(p), 0) >= p.w * this.coverage;
      const standing = onSurface && (solo || shared);
      // count arrivals, not frames — stepping off and back on is a new visit
      if (standing && !this.wasOn) this.visits++;
      this.wasOn = standing;
      if (standing && this.visits >= this.afterVisits) {
        this.on += dt;
        if (this.on > this.dwell) this.commit(g);
      } else if (!standing) {
        this.on = 0;
      }
    } else if (this.state === "shaking") {
      if (this._skipTick) { this._skipTick = false; return; }
      this.t += dt;
      if (this.t >= this.delay) this.state = "fall";
    } else if (this.state === "fall") {
      this.vy += 2400 * dt;
      this.rect.y += this.vy * dt;
    }
  }
  solids() { return this.state === "fall" ? [] : [this.rect]; }
  kills() { return []; }
  draw() {
    if (this.rect.y > H + 40) return;
    const ox = this.state === "shaking" ? rand(-2, 2) : 0;
    ctx.fillStyle = theme.ink;
    ctx.fillRect(this.rect.x + ox, this.rect.y, this.rect.w, this.rect.h);
    if (!this.cracks) return;
    ctx.fillStyle = theme.crack;
    for (let i = 1; i < 3; i++)
      ctx.fillRect(this.rect.x + (this.rect.w / 3) * i - 1 + ox, this.rect.y + 2, 2, this.rect.h - 4);
  }
}

class SlidingHole {
  constructor(x0, x1, opts = {}) {
    this.x0 = x0; this.x1 = x1;
    this.y = opts.y ?? 480;
    this.h = opts.h ?? 60;
    this.gapW = opts.gapW ?? 92;
    this.startGap = opts.startGap ?? x1 - 100;
    this.speed = opts.speed ?? 130;
    this.trigger = opts.trigger ?? null;
    this.homing = opts.homing ?? true;
    this.reset();
  }
  reset() { this.gx = this.startGap; this.active = !this.trigger; }
  update(dt, g) {
    if (!this.active && this.trigger && triggered(g, this.trigger)) { this.active = true; AudioFX.rumble(); }
    if (!this.active) return;
    const target = clamp(g.player.x + g.player.w / 2, this.x0 + this.gapW / 2 + 4, this.x1 - this.gapW / 2 - 4);
    const d = target - this.gx;
    const step = clamp(d, -this.speed * dt, this.speed * dt);
    this.gx += step;
  }
  solids() {
    const gl = this.gx - this.gapW / 2, gr = this.gx + this.gapW / 2;
    const out = [];
    if (gl > this.x0 + 2) out.push(R(this.x0, this.y, gl - this.x0, this.h));
    if (gr < this.x1 - 2) out.push(R(gr, this.y, this.x1 - gr, this.h));
    return out;
  }
  kills() { return []; }
  draw() {
    ctx.fillStyle = theme.ink;
    for (const s of this.solids()) ctx.fillRect(s.x, s.y, s.w, s.h);
    const gl = this.gx - this.gapW / 2, gr = this.gx + this.gapW / 2;
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      ctx.moveTo(gl, this.y + i * 18);
      ctx.lineTo(gl + 7, this.y + i * 18 + 9);
      ctx.lineTo(gl, this.y + i * 18 + 18);
      ctx.moveTo(gr, this.y + i * 18);
      ctx.lineTo(gr - 7, this.y + i * 18 + 9);
      ctx.lineTo(gr, this.y + i * 18 + 18);
    }
    ctx.fill();
  }
}

class StaticSpikes {
  constructor(x, y, w, opts = {}) {
    this.x = x; this.y = y; this.w = w;
    this.size = opts.size ?? 26;
    this.dir = opts.dir ?? "up";
  }
  reset() {}
  update() {}
  solids() { return []; }
  kills() {
    if (this.dir === "up") return [R(this.x + 4, this.y - this.size + 8, this.w - 8, this.size - 8)];
    return [R(this.x + 4, this.y, this.w - 8, this.size - 8)];
  }
  draw() {
    const n = Math.max(2, Math.round(this.w / 18)), sw = this.w / n;
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const bx = this.x + i * sw;
      if (this.dir === "up") {
        ctx.moveTo(bx, this.y); ctx.lineTo(bx + sw / 2, this.y - this.size); ctx.lineTo(bx + sw, this.y);
      } else {
        ctx.moveTo(bx, this.y); ctx.lineTo(bx + sw / 2, this.y + this.size); ctx.lineTo(bx + sw, this.y);
      }
    }
    ctx.fill();
  }
}

class InvertZone {
  constructor(rect) { this.rect = rect; }
  reset() {}
  update(dt, g) { if (aabb(g.player, this.rect)) g.invertControls = true; }
  solids() { return []; }
  kills() { return []; }
  draw() {
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = theme.accent;
    ctx.font = `900 30px ${FONT}`;
    ctx.textAlign = "center";
    ctx.translate(this.rect.x + this.rect.w / 2, this.rect.y + 60);
    ctx.rotate(Math.PI);
    ctx.fillText("?", 0, 0);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- NEW TRAPS

class MovingPlatform {
  // ferries the player. Moves between (x,y) and (toX,toY) with easing + pause at ends.
  constructor(rect, opts = {}) {
    this.w = rect.w; this.h = rect.h;
    this.ax = rect.x; this.ay = rect.y;
    this.bx = opts.toX ?? rect.x; this.by = opts.toY ?? rect.y;
    this.speed = opts.speed ?? 80;
    this.phase = opts.phase ?? 0;
    this.pause = opts.pause ?? 0;
    // { when, dx, speed, back } — while `when` is true the whole platform slides
    // `dx` sideways and stays there, yanking the landing spot out from under a
    // jump that is already in the air. Once `back` is true the same trigger runs
    // the other way and walks it home again.
    this.shift = opts.shift ?? null;
    this.reset();
  }
  reset() {
    const dist = Math.hypot(this.bx - this.ax, this.by - this.ay) || 1;
    this.travel = dist / this.speed;
    this.cycle = this.travel * 2 + this.pause * 2;
    this.t = this.phase * this.cycle;
    this.ox = 0; this.shifted = false; this.phase = 0;
    const p = this._posAt(this.t);
    this.px = p.x; this.py = p.y; this.dx = 0; this.dy = 0;
  }
  _posAt(t) {
    let u = ((t % this.cycle) + this.cycle) % this.cycle;
    let f;
    if (u < this.travel) f = u / this.travel;
    else if (u < this.travel + this.pause) f = 1;
    else if (u < this.travel * 2 + this.pause) f = 1 - (u - this.travel - this.pause) / this.travel;
    else f = 0;
    const e = easeInOut(f);
    return { x: lerp(this.ax, this.bx, e), y: lerp(this.ay, this.by, e) };
  }
  update(dt, g) {
    const prevx = this.px, prevy = this.py;
    this.t += dt;

    // latch the sideways shift, then slide into it. phase 1 = shifted out,
    // phase 2 = sent back home because `back` has come true.
    if (this.shift) {
      const goingBack = this.shift.back ? triggered(g, this.shift.back) : false;
      if (triggered(g, this.shift.when)) {
        const want = goingBack ? 2 : 1;
        if (this.phase !== want) { this.phase = want; AudioFX.rumble(); }
        this.shifted = true;
      }
      const goal = this.phase === 1 ? this.shift.dx : 0;
      if (this.ox !== goal) {
        const left = goal - this.ox;
        this.ox += Math.sign(left) * Math.min((this.shift.speed ?? 420) * dt, Math.abs(left));
      }
    }

    const p = this._posAt(this.t);
    this.px = p.x + this.ox; this.py = p.y;
    this.dx = this.px - prevx; this.dy = this.py - prevy;
    const pl = g.player;
    const onTop = pl.vy >= -1 &&
      pl.x + pl.w > prevx + 2 && pl.x < prevx + this.w - 2 &&
      Math.abs((pl.y + pl.h) - prevy) <= 8;
    // Seat the rider on the surface rather than nudging them by dy. Nudging
    // leaves sub-pixel overlap, and a rider standing still has vx === 0, so the
    // horizontal resolver takes its "push out the nearest side" branch and fires
    // them off the platform. Only bites once a platform moves vertically.
    if (onTop) { pl.x += this.dx; pl.y = this.py - pl.h; pl.vy = 0; }
  }
  solids() { return [R(this.px, this.py, this.w, this.h)]; }
  kills() { return []; }
  draw() {
    ctx.fillStyle = theme.ink;
    roundRect(this.px, this.py, this.w, this.h, 4); ctx.fill();
    ctx.fillStyle = theme.paper;
    for (let i = 0; i < 3; i++)
      ctx.fillRect(this.px + this.w / 2 - 14 + i * 12, this.py + this.h / 2 - 1.5, 6, 3);
  }
}

class Conveyor {
  // a solid belt that pushes whoever stands on it.
  constructor(rect, opts = {}) {
    this.rect = { ...rect };
    this.dir = opts.dir ?? 1;
    this.force = opts.force ?? 150;
    this.reset();
  }
  reset() { this.t = 0; }
  update(dt, g) {
    this.t += dt * this.dir;
    const p = g.player, r = this.rect;
    const standing = p.grounded && Math.abs((p.y + p.h) - r.y) < 4 &&
      p.x + p.w > r.x && p.x < r.x + r.w;
    if (standing) p.x += this.dir * this.force * dt;
  }
  solids() { return [this.rect]; }
  kills() { return []; }
  draw() {
    const r = this.rect;
    ctx.fillStyle = theme.ink;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.fillStyle = theme.paper;
    const off = (this.t * 70) % 40;
    for (let x = r.x - 40 + off; x < r.x + r.w; x += 40) {
      ctx.beginPath();
      if (this.dir > 0) {
        ctx.moveTo(x, r.y + 10); ctx.lineTo(x + 12, r.y + r.h / 2); ctx.lineTo(x, r.y + r.h - 10);
      } else {
        ctx.moveTo(x + 12, r.y + 10); ctx.lineTo(x, r.y + r.h / 2); ctx.lineTo(x + 12, r.y + r.h - 10);
      }
      ctx.lineWidth = 3; ctx.strokeStyle = theme.paper; ctx.stroke();
    }
    ctx.restore();
  }
}

class Spring {
  // non-solid bounce pad. preserves horizontal momentum for running spring-jumps.
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y; this.w = opts.w ?? 50; this.h = opts.h ?? 14;
    this.power = opts.power ?? -980;
    this.reset();
  }
  reset() { this.c = 0; }
  update(dt, g) {
    this.c = Math.max(0, this.c - dt * 5);
    const p = g.player;
    const overX = p.x + p.w > this.x + 3 && p.x < this.x + this.w - 3;
    const bottom = p.y + p.h;
    if (overX && p.vy >= 0 && bottom >= this.y - 6 && bottom <= this.y + 40) {
      p.y = this.y - p.h;
      p.vy = this.power;
      p.grounded = false;
      this.c = 1;
      AudioFX.bounce();
      spawnDust(this.x + this.w / 2, this.y, 6);
    }
  }
  solids() { return []; }
  kills() { return []; }
  draw() {
    const comp = this.c * 6;
    const top = this.y + comp;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const coils = 3;
    for (let i = 0; i <= coils; i++) {
      const yy = lerp(this.y + this.h + 6, top + 4, i / coils);
      const xx = this.x + (i % 2 === 0 ? 6 : this.w - 6);
      if (i === 0) ctx.moveTo(this.x + 6, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.fillStyle = theme.accent;
    roundRect(this.x, top, this.w, 7, 3); ctx.fill();
  }
}

class Saw {
  // spinning blade gliding along a polyline (ping-pong by default).
  constructor(path, opts = {}) {
    this.path = path.map((p) => ({ ...p }));
    this.r = opts.r ?? 22;
    this.speed = opts.speed ?? 130;
    // dormant (invisible and harmless) until the trigger fires; null = always on
    this.trigger = opts.trigger ?? null;
    // one pass down the path instead of bouncing back and forth. It stays where
    // it stops, and stays lethal there.
    this.once = opts.once ?? false;
    this.reset();
  }
  reset() {
    this.seg = 0; this.dir = 1; this.f = 0; this.spin = 0;
    this.x = this.path[0].x; this.y = this.path[0].y;
    this.active = !this.trigger; this.done = false;
  }
  update(dt, g) {
    if (!this.active) {
      if (!triggered(g, this.trigger)) return;
      this.active = true;
      AudioFX.rumble();
    }
    this.spin += dt * 9;
    if (this.done || this.path.length < 2) return;
    const a = this.path[this.seg];
    const b = this.path[this.seg + this.dir];
    if (!b) { this.dir *= -1; return; }
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.f += (this.speed * dt) / len;
    while (this.f >= 1) {
      this.f -= 1;
      this.seg += this.dir;
      if (this.seg + this.dir < 0 || this.seg + this.dir >= this.path.length) {
        if (this.once) {
          const end = this.path[this.path.length - 1];
          this.x = end.x; this.y = end.y;
          this.done = true; this.f = 0;
          return;
        }
        this.dir *= -1;
      }
    }
    const a2 = this.path[this.seg], b2 = this.path[this.seg + this.dir] || a2;
    this.x = lerp(a2.x, b2.x, this.f);
    this.y = lerp(a2.y, b2.y, this.f);
  }
  solids() { return []; }
  kills() {
    if (!this.active) return [];
    return [R(this.x - this.r * 0.66, this.y - this.r * 0.66, this.r * 1.32, this.r * 1.32)];
  }
  draw() { if (this.active) drawBlade(this.x, this.y, this.r, this.spin, 10); }
}

class Laser {
  // telegraphed beam. off -> warn -> fire, cyclic.
  constructor(opts = {}) {
    this.x = opts.x; this.y = opts.y; this.len = opts.len ?? 400;
    this.vertical = opts.vertical ?? false;
    this.thick = opts.thick ?? 10;
    this.period = opts.period ?? 2.2;
    this.warn = opts.warn ?? 0.55;
    this.fire = opts.fire ?? 0.5;
    this.phase = opts.phase ?? 0;
    this.reset();
  }
  reset() { this.t = this.phase * this.period; this.fired = false; }
  update(dt) {
    this.t += dt;
    const st = this._state();
    if (st === "fire" && !this.fired) { AudioFX.zap(); this.fired = true; }
    if (st !== "fire") this.fired = false;
    if (st === "warn" && Math.random() < 0.06) AudioFX.beep();
  }
  _state() {
    const u = this.t % this.period;
    if (u < this.period - this.warn - this.fire) return "off";
    if (u < this.period - this.fire) return "warn";
    return "fire";
  }
  _beam() {
    return this.vertical
      ? R(this.x - this.thick / 2, this.y, this.thick, this.len)
      : R(this.x, this.y - this.thick / 2, this.len, this.thick);
  }
  solids() { return []; }
  kills() { return this._state() === "fire" ? [this._beam()] : []; }
  draw() {
    const st = this._state();
    // emitter nubs
    ctx.fillStyle = theme.metal;
    if (this.vertical) {
      ctx.fillRect(this.x - 8, this.y - 8, 16, 8);
      ctx.fillRect(this.x - 8, this.y + this.len, 16, 8);
    } else {
      ctx.fillRect(this.x - 8, this.y - 8, 8, 16);
      ctx.fillRect(this.x + this.len, this.y - 8, 8, 16);
    }
    if (st === "off") return;
    const b = this._beam();
    if (st === "warn") {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = theme.danger;
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (this.vertical) { ctx.moveTo(this.x, this.y); ctx.lineTo(this.x, this.y + this.len); }
      else { ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + this.len, this.y); }
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = theme.danger;
      ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.danger;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = theme.paper;
      ctx.globalAlpha = 0.5;
      if (this.vertical) ctx.fillRect(b.x + b.w / 2 - 1, b.y, 2, b.h);
      else ctx.fillRect(b.x, b.y + b.h / 2 - 1, b.w, 2);
      ctx.restore();
    }
  }
}

class Teleporter {
  // step in A -> appear at B (and back if twoWay).
  constructor(ax, ay, bx, by, opts = {}) {
    const w = opts.w ?? 30, h = opts.h ?? 48;
    this.a = R(ax, ay, w, h);
    this.b = R(bx, by, w, h);
    this.aHome = { x: ax, y: ay };
    this.drift = opts.drift ?? null;   // { dx, dy, speed } — makes mouth A wander
    this.twoWay = opts.twoWay ?? true;
    this.reset();
  }
  reset() {
    this.cool = 0; this.t = 0;
    this.a.x = this.aHome.x; this.a.y = this.aHome.y;
  }
  update(dt, g) {
    this.t += dt;
    if (this.drift) {
      const f = 0.5 * (1 - Math.cos(this.t * (this.drift.speed ?? 1) * 2));
      this.a.x = this.aHome.x + (this.drift.dx ?? 0) * f;
      this.a.y = this.aHome.y + (this.drift.dy ?? 0) * f;
    }
    this.cool = Math.max(0, this.cool - dt);
    if (this.cool > 0 || g.warpLock > 0) return;
    const p = g.player;
    const warp = (from, to) => {
      spawnPoof(from.x + from.w / 2, from.y + from.h / 2);
      p.x = to.x + to.w / 2 - p.w / 2;
      p.y = to.y + to.h - p.h;
      p.vx = 0;
      p.vy = 0;
      this.cool = 0.45;
      g.warpLock = 0.4;
      AudioFX.poof();
      spawnPoof(to.x + to.w / 2, to.y + to.h / 2);
    };
    if (aabb(p, this.a)) warp(this.a, this.b);
    else if (this.twoWay && aabb(p, this.b)) warp(this.b, this.a);
  }
  solids() { return []; }
  kills() { return []; }
  _portal(r) {
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.ellipse(0, 0, r.w / 2 - 2, r.h / 2 - 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = this.t * 2 + i * 2.1;
      ctx.beginPath();
      ctx.ellipse(0, 0, (r.w / 2 - 4) * (0.4 + 0.2 * i), (r.h / 2 - 4) * (0.4 + 0.2 * i), a, 0, Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }
  draw() { this._portal(this.a); if (this.twoWay) this._portal(this.b); else this._portal(this.b); }
}

class Button {
  // floor switch. sets g.flags[key]. momentary or latching.
  constructor(x, y, key, opts = {}) {
    this.x = x; this.y = y; this.w = opts.w ?? 44; this.h = 10;
    this.key = key;
    this.momentary = opts.momentary ?? false;
    this.needBig = opts.needBig ?? false;   // only a BIG player weighs enough
    this.reset();
  }
  reset() { this.pressed = false; this.dip = 0; }
  update(dt, g) {
    const hit = R(this.x, this.y - 8, this.w, this.h + 12);
    const on = aabb(g.player, hit) && (!this.needBig || g.player.size === "big");
    if (this.momentary) { this.pressed = on; }
    else if (on) { if (!this.pressed) AudioFX.beep(); this.pressed = true; }
    g.flags[this.key] = this.pressed;
    this.dip = clamp(this.dip + (this.pressed ? 1 : -1) * dt * 8, 0, 1);
  }
  solids() { return []; }
  kills() { return []; }
  draw() {
    ctx.fillStyle = theme.metal;
    ctx.fillRect(this.x + 4, this.y + 4, this.w - 8, this.h);
    ctx.fillStyle = this.pressed ? theme.accent : theme.ink;
    roundRect(this.x, this.y + this.dip * 5, this.w, 7, 3); ctx.fill();
  }
}

class Gate {
  // solid when closed; slides into the ceiling when its flag opens it.
  constructor(rect, key, opts = {}) {
    this.rect = { ...rect };
    this.key = key;
    this.invert = opts.invert ?? false;
    this.reset();
  }
  reset() { this.open = 0; }
  update(dt, g) {
    let want = !!g.flags[this.key];
    if (this.invert) want = !want;
    this.open = clamp(this.open + (want ? 1 : -1) * dt * 4, 0, 1);
  }
  _cur() {
    const r = this.rect;
    const shift = this.open * (r.h + 4);
    return R(r.x, r.y - shift, r.w, r.h);
  }
  solids() { return this.open > 0.92 ? [] : [this._cur()]; }
  kills() { return []; }
  draw() {
    const c = this._cur();
    ctx.fillStyle = theme.ink;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = theme.accent;
    for (let i = 0; i < 3; i++) ctx.fillRect(c.x + c.w / 2 - 2, c.y + 10 + i * (c.h / 3), 4, c.h / 6);
  }
}

class BlinkPlatform {
  // solid platform that phases in and out on a timer.
  constructor(rect, opts = {}) {
    this.rect = { ...rect };
    this.period = opts.period ?? 1.8;
    this.onFrac = opts.onFrac ?? 0.5;
    this.phase = opts.phase ?? 0;
    this.reset();
  }
  reset() { this.t = this.phase * this.period; }
  update(dt) { this.t += dt; }
  _on() { return (this.t % this.period) < this.period * this.onFrac; }
  solids() { return this._on() ? [this.rect] : []; }
  kills() { return []; }
  draw() {
    const on = this._on();
    const r = this.rect;
    if (on) {
      ctx.fillStyle = theme.ink;
      roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = theme.ink;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      roundRect(r.x, r.y, r.w, r.h, 4); ctx.stroke();
      ctx.restore();
    }
  }
}

class Pendulum {
  // swinging spiked bob mounted at (px,py).
  constructor(px, py, opts = {}) {
    this.px = px; this.py = py;
    this.len = opts.len ?? 380;
    this.amp = opts.amp ?? 0.85;
    this.speed = opts.speed ?? 1.6;
    this.r = opts.r ?? 18;
    this.phase = opts.phase ?? 0;
    this.reset();
  }
  reset() { this.t = this.phase; }
  update(dt) { this.t += dt; }
  _ang() { return Math.sin(this.t * this.speed) * this.amp; }
  _bob() { const a = this._ang(); return { x: this.px + Math.sin(a) * this.len, y: this.py + Math.cos(a) * this.len }; }
  solids() { return []; }
  kills() { const b = this._bob(); return [R(b.x - this.r * 0.66, b.y - this.r * 0.66, this.r * 1.32, this.r * 1.32)]; }
  draw() {
    const b = this._bob();
    ctx.strokeStyle = theme.metal;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(this.px, this.py); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = theme.ink;
    ctx.beginPath(); ctx.arc(this.px, this.py, 5, 0, Math.PI * 2); ctx.fill();
    // spiked bob
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = theme.ink;
    const teeth = 8;
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
      ctx.lineTo(Math.cos(a0) * this.r, Math.sin(a0) * this.r);
      ctx.lineTo(Math.cos(a1) * this.r * 0.7, Math.sin(a1) * this.r * 0.7);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

class Turret {
  // fires projectiles horizontally on a timer.
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.dir = opts.dir ?? -1;
    this.period = opts.period ?? 1.6;
    this.speed = opts.speed ?? 260;
    this.phase = opts.phase ?? 0;
    this.r = opts.r ?? 7;
    this.reset();
  }
  reset() { this.t = this.phase * this.period; this.shots = []; }
  update(dt) {
    this.t += dt;
    if (this.t >= this.period) { this.t -= this.period; this.shots.push({ x: this.x, y: this.y }); AudioFX.pop(); }
    for (const s of this.shots) s.x += this.dir * this.speed * dt;
    this.shots = this.shots.filter((s) => s.x > -30 && s.x < W + 30);
  }
  solids() { return []; }
  kills() { return this.shots.map((s) => R(s.x - this.r, s.y - this.r, this.r * 2, this.r * 2)); }
  draw() {
    ctx.fillStyle = theme.metal;
    ctx.fillRect(this.x - (this.dir < 0 ? 4 : 14), this.y - 11, 18, 22);
    ctx.fillRect(this.x + (this.dir < 0 ? -14 : 6), this.y - 4, 10, 8);
    ctx.fillStyle = theme.danger;
    for (const s of this.shots) {
      ctx.beginPath(); ctx.arc(s.x, s.y, this.r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ---------------------------------------------------------------- MEME-GAME TRAPS
// One new mechanic per level, tracked to level_strategies.txt (plus the level 2 original).

const SIZES = {
  small: { w: 16, h: 20 },
  normal: { w: 26, h: 32 },
  big: { w: 38, h: 46 },
};

function setPlayerSize(g, mode) {
  const p = g.player;
  let key = mode;
  if (mode === "toggle") key = p.size === "big" ? "small" : "big";
  if (!SIZES[key] || key === p.size) return false;
  const s = SIZES[key];
  const cx = p.x + p.w / 2;
  const foot = p.grav > 0 ? p.y + p.h : p.y;
  p.w = s.w; p.h = s.h; p.size = key;
  p.x = clamp(cx - p.w / 2, 2, W - p.w - 2);
  p.y = p.grav > 0 ? foot - p.h : foot;
  return true;
}

function flipGravity(g, dir) {
  const p = g.player;
  if (p.grav === dir) return false;
  p.grav = dir;
  p.vy = 0;
  p.grounded = false;
  p.coyote = 0;
  p.jumping = false;
  p.jumpsLeft = g.level ? (g.level.airJumps ?? 0) : 0;
  AudioFX.poof();
  spawnPoof(p.x + p.w / 2, p.y + p.h / 2);
  g.shake(4, 0.14);
  return true;
}

function drawBlade(x, y, r, spin, teeth = 10) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.fillStyle = theme.ink;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
    ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    ctx.lineTo(Math.cos(a1) * r * 0.74, Math.sin(a1) * r * 0.74);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.paper;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

class PopWall {
  // A wall that shoves itself out of a surface to box you in (level 5).
  // With `slide` it keeps going: once the player lands, the erupted block
  // bulldozes sideways and walks them off the ledge (level 2).
  constructor(rect, trigger, opts = {}) {
    this.rect = { ...rect };
    this.trigger = trigger;
    this.dir = opts.dir ?? "up";     // up | down | left | right
    this.speed = opts.speed ?? 480;  // px/s of extension
    this.delay = opts.delay ?? 0;
    this.push = opts.push ?? 0;      // pin the eject direction (-1 left, 1 right)
    // { dx, speed, after } — after erupting, wait for the player to touch down,
    // then travel dx at `speed`, shoving whatever is in the way along with it
    this.slide = opts.slide ?? null;
    this.reset();
  }
  reset() { this.out = 0; this.ox = 0; this.state = "idle"; this.t = 0; }
  update(dt, g) {
    if (this.state === "idle") {
      if (triggered(g, this.trigger)) { this.state = "wait"; this.t = 0; }
      return;
    }
    if (this.state === "wait") {
      this.t += dt;
      if (this.t >= this.delay) { this.state = "out"; AudioFX.slam(); g.shake(5, 0.16); }
    } else if (this.state === "out") {
      const span = (this.dir === "left" || this.dir === "right") ? this.rect.w : this.rect.h;
      this.out = clamp(this.out + (this.speed / span) * dt, 0, 1);
      if (this.out >= 1) { this.state = this.slide ? "armed" : "done"; this.t = 0; }
    } else if (this.state === "armed") {
      // hold until they actually commit to the ledge, then lunge
      if (g.player.grounded) {
        this.t += dt;
        if (this.t >= (this.slide.after ?? 0)) {
          this.state = "sliding";
          AudioFX.rumble();
          g.shake(4, 0.18);
        }
      }
    } else if (this.state === "sliding") {
      const dir = Math.sign(this.slide.dx);
      const left = Math.abs(this.slide.dx) - Math.abs(this.ox);
      const step = Math.min((this.slide.speed ?? 110) * dt, left);
      this.ox += dir * step;
      this._carry(g, dir * step);
      if (left - step <= 0) this.state = "done";
      if (Math.random() < 0.3) {
        const c = this._cur();
        spawnDust(c.x + (dir < 0 ? 0 : c.w), c.y + c.h, 2);
      }
    }
    this._shove(g);
  }
  _carry(g, step) {
    // riding on top of the block moves you with it
    const c = this._cur(), p = g.player;
    const onTop = p.vy >= -1 &&
      p.x + p.w > c.x + 2 && p.x < c.x + c.w - 2 &&
      Math.abs((p.y + p.h) - c.y) <= 8;
    if (onTop) p.x += step;
  }
  _shove(g) {
    // never crush the player inside the wall - walk them out of it instead.
    // traps update before the player's collision pass, so solid collision has
    // already parked them flush against the face; test with a little slack or a
    // block that moves INTO them would never register the contact it just made.
    const c = this._cur(), p = g.player;
    if (this.out <= 0.02) return;
    // ...but only while it is actually moving. A standing block must use its exact
    // rect, or the slack grabs anyone stood flush against it and pins them there
    // by zeroing vx every frame.
    const contact = this.state === "sliding" ? R(c.x - 2, c.y, c.w + 4, c.h) : c;
    if (!aabb(p, contact)) return;
    if (this.dir === "up" || this.dir === "down") {
      const left = c.x - p.w, right = c.x + c.w;
      const side = this.push || (Math.abs(p.x - left) < Math.abs(p.x - right) ? -1 : 1);
      p.x = side < 0 ? left : right;
    } else {
      p.y = (p.y + p.h / 2 < c.y + c.h / 2) ? c.y - p.h : c.y + c.h;
    }
    p.vx = 0;
  }
  _cur() {
    const r = this.rect, ox = this.ox;
    if (this.dir === "up") { const h = r.h * this.out; return R(r.x + ox, r.y + r.h - h, r.w, h); }
    if (this.dir === "down") return R(r.x + ox, r.y, r.w, r.h * this.out);
    if (this.dir === "right") return R(r.x, r.y, r.w * this.out, r.h);
    const w = r.w * this.out;
    return R(r.x + r.w - w, r.y, w, r.h);
  }
  solids() { return this.out > 0.02 ? [this._cur()] : []; }
  kills() { return []; }
  draw() {
    const r = this.rect;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = theme.metal;
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.restore();
    if (this.out <= 0.02) return;
    const c = this._cur();
    ctx.fillStyle = theme.ink;
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = theme.accent;
    const horiz = this.dir === "up" || this.dir === "down";
    const n = Math.max(1, Math.floor((horiz ? c.h : c.w) / 26));
    for (let i = 0; i < n; i++) {
      if (horiz) ctx.fillRect(c.x + 5, c.y + 8 + i * 26, c.w - 10, 3);
      else ctx.fillRect(c.x + 8 + i * 26, c.y + 5, 3, c.h - 10);
    }
  }
}

class PushBox {
  // a crate the player can shove along the ground. It falls like a body and
  // counts as solid ground while it is there, so it can be walked on as well as
  // walked into.
  constructor(rect, opts = {}) {
    this.home = { ...rect };
    this.speed = opts.speed ?? 150;   // how fast it gives way when shoved
    this.reset();
  }
  reset() { this.rect = { ...this.home }; this.vy = 0; this.capping = false; }
  // this crate plus any crates it is already touching in the push direction, so
  // shoving the first one drives the whole row
  _chain(g, dir) {
    const chain = [this];
    for (let guard = 0; guard < 8; guard++) {
      const last = chain[chain.length - 1].rect;
      const next = g.level.traps.find((t) => {
        if (!(t instanceof PushBox) || chain.includes(t)) return false;
        const b = t.rect;
        if (b.y + b.h <= last.y + 2 || b.y >= last.y + last.h - 2) return false;
        return dir > 0
          ? Math.abs(b.x - (last.x + last.w)) <= 3
          : Math.abs(last.x - (b.x + b.w)) <= 3;
      });
      if (!next) break;
      chain.push(next);
    }
    return chain;
  }
  // every solid in the level except this box itself
  _others(g) {
    const out = [...g.level.solids];
    for (const t of g.level.traps) if (t !== this) out.push(...t.solids());
    return out;
  }
  update(dt, g) {
    const r = this.rect;
    if (r.y > H + 200) return;          // gone down the hole; stop simulating
    const p = g.player, others = this._others(g);

    // Shoved sideways when the player is level with it and walking into it.
    // NOTE: read the INPUT, not p.vx — the crate is solid, so the player's own
    // collision resolution zeroes their vx the instant they touch it, and a
    // vx-based test could therefore never fire.
    let dir = 0;
    if (heldRight()) dir += 1;
    if (heldLeft()) dir -= 1;
    if (g.invertControls) dir = -dir;

    const levelWith = p.y + p.h > r.y + 2 && p.y < r.y + r.h - 2;
    if (levelWith && dir !== 0) {
      const touching = dir > 0
        ? p.x + p.w >= r.x - 4 && p.x < r.x + r.w
        : p.x <= r.x + r.w + 4 && p.x + p.w > r.x;
      if (touching) {
        // crates in front get shoved along too, so a row of them moves together
        const chain = this._chain(g, dir);
        let step = this.speed * dt;
        for (const c of chain) {
          const cr = c.rect;
          // anything solid that is NOT part of the chain limits how far it goes
          for (const sol of c._others(g)) {
            if (chain.some((k) => k.rect === sol)) continue;
            if (cr.y + cr.h <= sol.y + 1 || cr.y >= sol.y + sol.h - 1) continue;
            const gap = dir > 0 ? sol.x - (cr.x + cr.w) : cr.x - (sol.x + sol.w);
            if (gap >= 0) step = Math.min(step, gap);
          }
        }
        for (const c of chain) c.rect.x += dir * step;
      }
    }

    this.vy = clamp(this.vy + 2150 * dt, -980, 980);
    const wasAbove = r.y + r.h;
    r.y += this.vy * dt;
    for (const s of others) {
      if (aabb(r, s)) {
        if (this.vy > 0) r.y = s.y - r.h;
        else if (this.vy < 0) r.y = s.y + s.h;
        this.vy = 0;
      }
    }

    // spike beds hold the crate up: shove it into a pit and it caps the spikes,
    // turning them into somewhere you can stand
    this.capping = false;
    if (this.vy >= 0) {
      for (const t of g.level.traps) {
        if (t === this) continue;
        for (const k of t.kills()) {
          if (aabb(r, k) && wasAbove <= k.y + 2) {
            r.y = k.y - r.h; this.vy = 0; this.capping = true;
          }
        }
      }
    }
  }
  // the footprint the crate is shielding while it sits on a spike bed
  cover() { return this.capping ? this.rect : null; }
  solids() { return this.rect.y > H + 200 ? [] : [this.rect]; }
  kills() { return []; }
  draw() {
    const r = this.rect;
    if (r.y > H + 40) return;
    ctx.fillStyle = theme.metal;
    roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
    ctx.strokeStyle = theme.paper;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x + 5, r.y + 5); ctx.lineTo(r.x + r.w - 5, r.y + r.h - 5);
    ctx.moveTo(r.x + r.w - 5, r.y + 5); ctx.lineTo(r.x + 5, r.y + r.h - 5);
    ctx.stroke();
  }
}

class LiftPlatform {
  // A weight-driven floating platform. Put weight on it and it travels to `to`;
  // take the weight off and it returns to where it started. `to` can be above or
  // below home, so the same class gives a riser and a sinker.
  //   needs: "any"  — the player or a crate is enough (default)
  //          "both" — it only moves with the player AND a crate aboard
  constructor(rect, opts = {}) {
    this.home = { ...rect };
    this.speed = opts.speed ?? 70;                // rate while loaded
    this.fall = opts.fall ?? opts.speed ?? 70;    // rate returning home
    this.to = opts.to ?? opts.top ?? 0;           // where weight drives it
    this.needs = opts.needs ?? "any";
    this.reset();
  }
  reset() {
    this.rect = { ...this.home };
    this.moving = false; this.loaded = false;
    this.breaking = null;   // seconds since it gave way, null while intact
  }
  // a body is riding if it overlaps horizontally and its feet are on the surface
  _riding(b) {
    const r = this.rect;
    return b.x + b.w > r.x + 2 && b.x < r.x + r.w - 2 &&
           Math.abs(b.y + b.h - r.y) <= 6;
  }
  // ...and this is the platform actually holding it up. A body straddling the
  // seam between two platforms rides both, and if both claim it they seat it to
  // different heights in the same frame — which leaves it overlapping one of
  // them and the horizontal resolver flings it sideways. Highest surface wins,
  // ties broken by trap order so the choice never flickers.
  _carries(b, g) {
    if (!this._riding(b)) return false;
    const traps = g.level.traps, mine = traps.indexOf(this);
    for (const t of traps) {
      if (t === this || !(t instanceof LiftPlatform) || !t._riding(b)) continue;
      if (t.rect.y < this.rect.y) return false;
      if (t.rect.y === this.rect.y && traps.indexOf(t) < mine) return false;
    }
    return true;
  }
  update(dt, g) {
    const r = this.rect, p = g.player;

    // already given way: drop out from under everything, then restart the level
    if (this.breaking !== null) {
      this.breaking += dt;
      r.y += 900 * dt;
      if (this.breaking > 0.4) g.die(r.x + r.w / 2, Math.min(r.y + r.h / 2, H - 20));
      return;
    }

    const crates = g.level.traps.filter((t) => t instanceof PushBox && this._carries(t.rect, g));

    // Two crates at once is more than it will take — but only crates sitting
    // wholly within the slab count. One hanging over an edge is not really on it.
    const squarelyOn = crates.filter((c) =>
      c.rect.x >= r.x - 0.5 && c.rect.x + c.rect.w <= r.x + r.w + 0.5);
    if (squarelyOn.length >= 2) {
      this.breaking = 0;
      this.moving = false;
      AudioFX.rumble();
      g.shake(8, 0.35);
      return;
    }

    const playerOn = this._carries(p, g);
    this.loaded = this.needs === "both"
      ? playerOn && crates.length > 0
      : playerOn || crates.length > 0;

    // loaded -> travel towards `to`; empty -> return to where it started
    const goal = this.loaded ? this.to : this.home.y;
    const rate = this.loaded ? this.speed : this.fall;
    const delta = goal - r.y;
    const dy = Math.sign(delta) * Math.min(rate * dt, Math.abs(delta));
    this.moving = dy !== 0;
    if (!this.moving) return;
    r.y += dy;

    // Seat the riders exactly on the new surface rather than nudging them by the
    // same step. Nudging leaves sub-pixel overlap, and because a rider standing
    // still has vx === 0 the horizontal resolver takes its "push out the nearest
    // side" branch and fires them clean off the platform.
    if (playerOn) { p.y = r.y - p.h; p.vy = 0; }
    for (const c of crates) { c.rect.y = r.y - c.rect.h; c.vy = 0; }
  }
  solids() { return this.breaking !== null ? [] : [this.rect]; }
  kills() { return []; }
  draw() {
    const r = this.rect;
    if (r.y > H + 40) return;
    ctx.save();
    if (this.breaking !== null) {
      ctx.globalAlpha = Math.max(0, 1 - this.breaking * 2);
      ctx.translate(rand(-3, 3), rand(-3, 3));
    }
    ctx.fillStyle = theme.ink;
    roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
    // little up-chevrons so it reads as a lift
    ctx.strokeStyle = theme.paper;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const cx = r.x + r.w / 2 - 22 + i * 22;
      ctx.moveTo(cx - 5, r.y + r.h / 2 + 3);
      ctx.lineTo(cx, r.y + r.h / 2 - 3);
      ctx.lineTo(cx + 5, r.y + r.h / 2 + 3);
    }
    ctx.stroke();
    ctx.restore();
  }
}

class Coin {
  // LEVEL 6 - bait. Optionally arms a flag that other traps listen to.
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.r = opts.r ?? 11;
    this.flag = opts.flag ?? null;
    this.reset();
  }
  reset() { this.got = false; this.t = (this.x + this.y) * 0.01; }
  update(dt, g) {
    this.t += dt;
    if (this.got) return;
    if (aabb(g.player, R(this.x - this.r, this.y - this.r, this.r * 2, this.r * 2))) {
      this.got = true;
      g.coins++;
      AudioFX.beep();
      spawnPoof(this.x, this.y);
      if (this.flag) g.flags[this.flag] = true;
    }
  }
  solids() { return []; }
  kills() { return []; }
  draw() {
    if (this.got) return;
    const bob = Math.sin(this.t * 2.6) * 3;
    const sq = Math.abs(Math.cos(this.t * 2.2));
    ctx.save();
    ctx.translate(this.x, this.y + bob);
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.r * (0.32 + 0.68 * sq), this.r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = theme.paper;
    ctx.beginPath();
    ctx.ellipse(-this.r * 0.2 * sq, -this.r * 0.25, this.r * 0.16 * sq, this.r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class FakePlatform {
  // LEVELS 8 / 16 - looks like a ledge. Has never been a ledge.
  constructor(rect) { this.rect = { ...rect }; this.reset(); }
  reset() { this.a = 1; this.gone = false; }
  update(dt, g) {
    if (this.gone) { this.a = Math.max(0, this.a - dt * 3.2); return; }
    const p = g.player, r = this.rect;
    const near = p.x + p.w > r.x - 2 && p.x < r.x + r.w + 2 &&
      p.y + p.h > r.y - 8 && p.y < r.y + r.h + 8;
    if (near) {
      this.gone = true;
      AudioFX.laugh();
      spawnDust(r.x + r.w / 2, r.y, 12);
    }
  }
  solids() { return []; }   // it was never real
  kills() { return []; }
  draw() {
    if (this.a <= 0) return;
    const r = this.rect;
    ctx.save();
    ctx.globalAlpha = this.a;
    ctx.fillStyle = theme.ink;
    roundRect(r.x, r.y, r.w, r.h, 4); ctx.fill();
    ctx.restore();
  }
}

class IceZone {
  // LEVEL 16 - momentum you did not ask for.
  constructor(rect) { this.rect = { ...rect }; }
  reset() {}
  update(dt, g) { if (aabb(g.player, this.rect)) g.slippery = true; }
  solids() { return []; }
  kills() { return []; }
  draw() {
    const r = this.rect;
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    for (let x = r.x + 14; x < r.x + r.w - 14; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, r.y + 5);
      ctx.lineTo(x + 16, r.y + 5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

class SizeButton {
  // LEVEL 11 - resize pad. mode: small | normal | big | toggle
  constructor(x, y, mode, opts = {}) {
    this.x = x; this.y = y;
    this.w = opts.w ?? 52;
    this.mode = mode;
    this.reset();
  }
  reset() { this.on = false; this.dip = 0; }
  update(dt, g) {
    const on = aabb(g.player, R(this.x, this.y - 12, this.w, 26));
    if (on && !this.on && setPlayerSize(g, this.mode)) {
      AudioFX.pop();
      spawnPoof(g.player.x + g.player.w / 2, g.player.y + g.player.h / 2);
    }
    this.on = on;
    this.dip = clamp(this.dip + (on ? 1 : -1) * dt * 8, 0, 1);
  }
  solids() { return []; }
  kills() { return []; }
  draw() {
    ctx.fillStyle = theme.metal;
    ctx.fillRect(this.x + 4, this.y + 4, this.w - 8, 10);
    ctx.fillStyle = this.on ? theme.accent : theme.ink;
    roundRect(this.x, this.y + this.dip * 5, this.w, 8, 3); ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = theme.accent;
    ctx.font = "800 13px " + FONT;
    ctx.textAlign = "center";
    const tag = this.mode === "big" ? "BIG" : this.mode === "small" ? "SMOL" : this.mode.toUpperCase();
    ctx.fillText(tag, this.x + this.w / 2, this.y - 10);
    ctx.restore();
  }
}

class WarpWall {
  // LEVEL 17 - touch the wall, wake up somewhere else.
  constructor(rect, opts = {}) {
    this.rect = { ...rect };
    this.toX = opts.toX ?? 60;
    this.toY = opts.toY ?? null;
    this.reset();
  }
  reset() { this.t = 0; this.flash = 0; }
  update(dt, g) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    if (g.warpLock > 0) return;
    const p = g.player;
    if (!aabb(p, this.rect)) return;
    spawnPoof(p.x + p.w / 2, p.y + p.h / 2);
    p.x = this.toX;
    if (this.toY != null) p.y = this.toY;
    p.vx = 0; p.vy = 0;
    g.warpLock = 0.4;
    this.flash = 1;
    AudioFX.poof();
    spawnPoof(p.x + p.w / 2, p.y + p.h / 2);
  }
  solids() { return []; }
  kills() { return []; }
  draw() {
    const r = this.rect;
    ctx.save();
    ctx.globalAlpha = 0.13 + this.flash * 0.3;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const y = r.y + (((this.t * 60 + i * 90) % r.h) + r.h) % r.h;
      ctx.beginPath();
      ctx.moveTo(r.x + 1, y);
      ctx.lineTo(r.x + r.w - 1, y + 10);
      ctx.stroke();
    }
    ctx.restore();
  }
}

class InvisibleWarp {
  // LEVEL 18 - the thing the guide warns you about.
  constructor(rect, opts = {}) {
    this.rect = { ...rect };
    this.toX = opts.toX ?? 60;
    this.toY = opts.toY ?? 440;
    this.reset();
  }
  reset() { this.revealed = 0; }
  update(dt, g) {
    if (this.revealed > 0) this.revealed = Math.max(0, this.revealed - dt * 0.7);
    if (g.warpLock > 0) return;
    const p = g.player;
    if (!aabb(p, this.rect)) return;
    this.revealed = 1;
    AudioFX.laugh();
    spawnPoof(p.x + p.w / 2, p.y + p.h / 2);
    p.x = this.toX; p.y = this.toY;
    p.vx = 0; p.vy = 0;
    g.warpLock = 0.5;
    g.shake(7, 0.24);
  }
  solids() { return []; }
  kills() { return []; }
  draw() {
    if (this.revealed <= 0.01) return;
    const r = this.rect;
    ctx.save();
    ctx.globalAlpha = 0.3 * this.revealed;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 0.85 * this.revealed;
    ctx.fillStyle = theme.accent;
    ctx.font = "900 22px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText("GOTCHA", r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
  }
}

class ChaserSaw {
  // LEVEL 13 - it follows, it speeds up, it never gets tired.
  constructor(x, y, opts = {}) {
    this.hx = x; this.hy = y;
    this.r = opts.r ?? 24;
    this.speed = opts.speed ?? 210;
    this.accel = opts.accel ?? 0;
    this.maxSpeed = opts.maxSpeed ?? 430;
    this.delay = opts.delay ?? 0;
    this.followY = opts.followY ?? false;
    this.reset();
  }
  reset() { this.x = this.hx; this.y = this.hy; this.spin = 0; this.v = this.speed; this.t = 0; }
  update(dt, g) {
    this.t += dt;
    this.spin += dt * 11;
    if (this.t < this.delay) return;
    this.v = Math.min(this.maxSpeed, this.v + this.accel * dt);
    const tx = g.player.x + g.player.w / 2;
    this.x += clamp(tx - this.x, -this.v * dt, this.v * dt);
    if (this.followY) {
      const ty = g.player.y + g.player.h / 2;
      this.y += clamp(ty - this.y, -this.v * 0.45 * dt, this.v * 0.45 * dt);
    }
  }
  solids() { return []; }
  kills() { return [R(this.x - this.r * 0.62, this.y - this.r * 0.62, this.r * 1.24, this.r * 1.24)]; }
  draw() { drawBlade(this.x, this.y, this.r, this.spin, 12); }
}

class GravityPad {
  // LEVEL 15 - forced flip. dir: -1 = ceiling, 1 = floor.
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.w = opts.w ?? 54;
    this.dir = opts.dir ?? -1;
    this.reset();
  }
  reset() { this.on = false; this.t = 0; }
  update(dt, g) {
    this.t += dt;
    const on = aabb(g.player, R(this.x, this.y - 14, this.w, 28));
    if (on && !this.on) flipGravity(g, this.dir);
    this.on = on;
  }
  solids() { return []; }
  kills() { return []; }
  draw() {
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-this.w / 2, 0); ctx.lineTo(this.w / 2, 0);
    ctx.stroke();
    const d = this.dir;
    const wob = Math.sin(this.t * 4) * 3;
    ctx.beginPath();
    ctx.moveTo(-9, d * (10 + wob)); ctx.lineTo(0, d * (-4 + wob)); ctx.lineTo(9, d * (10 + wob));
    ctx.stroke();
    ctx.restore();
  }
}

class TrickDoor {
  // LEVEL 12 - a door being used as furniture. Some of them hold.
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.w = opts.w ?? 46; this.h = opts.h ?? 62;
    this.fake = opts.fake ?? false;
    this.delay = opts.delay ?? 0.45;
    this.label = opts.label ?? null;
    this.reset();
  }
  reset() { this.state = "idle"; this.t = 0; this.a = 1; }
  update(dt, g) {
    if (this.state === "idle") {
      if (!this.fake) return;
      const p = g.player;
      const standing = p.grounded && Math.abs((p.y + p.h) - this.y) < 6 &&
        p.x + p.w > this.x && p.x < this.x + this.w;
      if (standing) { this.state = "creak"; this.t = 0; AudioFX.rumble(); }
    } else if (this.state === "creak") {
      this.t += dt;
      if (this.t >= this.delay) {
        this.state = "gone";
        AudioFX.laugh();
        spawnPoof(this.x + this.w / 2, this.y + this.h / 2);
      }
    } else if (this.state === "gone") {
      this.a = Math.max(0, this.a - dt * 4.5);
    }
  }
  solids() { return this.state === "gone" ? [] : [R(this.x, this.y, this.w, this.h)]; }
  kills() { return []; }
  draw() {
    if (this.a <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.a;
    const ox = this.state === "creak" ? rand(-2, 2) : 0;
    drawDoorShape(this.x + ox, this.y, this.w, this.h, theme.metal);
    if (this.label) {
      ctx.globalAlpha = this.a * 0.45;
      ctx.fillStyle = theme.ink;
      ctx.font = "italic 14px " + FONT;
      ctx.textAlign = "center";
      ctx.fillText(this.label, this.x + this.w / 2, this.y - 10);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- door
function drawDoorShape(x, y, w, h, color = null) {
  ctx.fillStyle = color || theme.door;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + 14);
  ctx.quadraticCurveTo(x, y, x + w / 2, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + 14);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.paper;
  ctx.beginPath();
  ctx.arc(x + w - 9, y + h / 2 + 4, 3.4, 0, Math.PI * 2);
  ctx.fill();
}

class FakeDoor {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y; this.w = 38; this.h = 64;
    this.label = opts.label ?? null;
    this.reset();
  }
  reset() { this.sprung = false; this.out = 0; }
  update(dt, g) {
    if (!this.sprung && aabb(g.player, R(this.x - 2, this.y, this.w + 4, this.h))) {
      this.sprung = true;
      AudioFX.laugh();
    }
    if (this.sprung) this.out = clamp(this.out + 16 * dt, 0, 1);
  }
  solids() { return []; }
  kills() { return this.out > 0.4 ? [R(this.x - 6, this.y, this.w + 12, this.h)] : []; }
  draw() {
    drawDoorShape(this.x, this.y, this.w, this.h);
    if (this.label) {
      ctx.fillStyle = theme.ink;
      ctx.globalAlpha = 0.45;
      ctx.font = `italic 15px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(this.label, this.x + this.w / 2, this.y - 12);
      ctx.globalAlpha = 1;
    }
    if (this.out > 0.01) {
      const n = 4;
      ctx.fillStyle = theme.ink;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const by = this.y + this.h - i * (this.h / n);
        const len = 30 * this.out;
        ctx.moveTo(this.x + 4, by);
        ctx.lineTo(this.x - len, by - this.h / n / 2);
        ctx.lineTo(this.x + 4, by - this.h / n);
        ctx.moveTo(this.x + this.w - 4, by);
        ctx.lineTo(this.x + this.w + len, by - this.h / n / 2);
        ctx.lineTo(this.x + this.w - 4, by - this.h / n);
      }
      ctx.fill();
    }
  }
}

class Door {
  constructor(positions, opts = {}) {
    this.positions = positions.map((p) => ({ ...p }));
    this.fleeDist = opts.fleeDist ?? 110;
    this.w = 38; this.h = 64;
    // { when, delay, after, to } — `delay` seconds after the first time `when` is
    // true the door blinks out of existence, and `after` seconds later it turns up
    // again at `to`. While it is gone it cannot be entered and is not drawn.
    this.vanish = opts.vanish ?? null;
    this.reset();
  }
  reset() {
    this.i = 0; this.poofT = 0;
    // doorDrive levels move the door as a physics body; these are its state
    this.vx = 0; this.vy = 0; this.grounded = false;
    this.vanishT = null; this.gone = false; this.armT = null;
  }
  body() { return R(this.pos.x, this.pos.y, this.w, this.h); }
  get pos() { return this.positions[this.i]; }
  update(dt, g) {
    this.poofT = Math.max(0, this.poofT - dt);

    if (this.vanish) {
      // arm on the trigger, then hold for `delay` before actually bailing out
      if (this.armT === null && triggered(g, this.vanish.when)) this.armT = 0;
      if (this.armT !== null && this.vanishT === null) {
        this.armT += dt;
        if (this.armT >= (this.vanish.delay ?? 0)) {
          this.vanishT = 0;
          this.gone = true;
          spawnPoof(this.pos.x + this.w / 2, this.pos.y + this.h / 2);
          AudioFX.poof();
        }
      } else if (this.gone) {
        this.vanishT += dt;
        if (this.vanishT >= (this.vanish.after ?? 3)) {
          this.pos.x = this.vanish.to.x;
          if (this.vanish.to.y !== undefined) this.pos.y = this.vanish.to.y;
          this.gone = false;
          this.poofT = 0.25;
          spawnPoof(this.pos.x + this.w / 2, this.pos.y + this.h / 2);
          AudioFX.laugh();
        }
      }
    }
    if (this.i < this.positions.length - 1) {
      const p = g.player;
      const dx = (p.x + p.w / 2) - (this.pos.x + this.w / 2);
      const dy = (p.y + p.h / 2) - (this.pos.y + this.h / 2);
      if (Math.hypot(dx, dy) < this.fleeDist) {
        spawnPoof(this.pos.x + this.w / 2, this.pos.y + this.h / 2);
        this.i++;
        this.poofT = 0.25;
        spawnPoof(this.pos.x + this.w / 2, this.pos.y + this.h / 2);
        AudioFX.poof();
        if (this.i === this.positions.length - 1) AudioFX.laugh();
      }
    }
  }
  playerWins(p) {
    if (this.gone) return false;
    const r = R(this.pos.x + 6, this.pos.y + 6, this.w - 12, this.h - 6);
    return this.i === this.positions.length - 1 && aabb(p, r);
  }
  draw() {
    if (this.gone) return;
    const s = this.poofT > 0 ? 1 + this.poofT * 1.2 : 1;
    ctx.save();
    ctx.translate(this.pos.x + this.w / 2, this.pos.y + this.h);
    ctx.scale(s, s);
    ctx.translate(-(this.w / 2), -this.h);
    drawDoorShape(0, 0, this.w, this.h);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- decor text
class Note {
  constructor(x, y, text, opts = {}) {
    this.x = x; this.y = y; this.text = text;
    this.size = opts.size ?? 16;
    this.angle = opts.angle ?? 0;
  }
  reset() {} update() {} solids() { return []; } kills() { return []; }
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = 0.36;
    ctx.font = `italic ${this.size}px Georgia, serif`;
    ctx.textAlign = "center";
    ctx.fillText(this.text, 0, 0);
    ctx.restore();
  }
}

// ================================================================ LEVELS
const floorSeg = (x0, x1, y = 480) => R(x0, y, x1 - x0, H - y);
const wallL = () => R(-40, -200, 40, H + 400);
const wallR = () => R(W, -200, 40, H + 400);
const roof = (h = 30) => R(0, 0, W, h);

// Strategy notes are lifted straight from level_strategies.txt (Levels 1-16).
// `what` = what the level does to you, `safe` = the move that works,
// `oops` = the mistake that kills most runs. Shown in-game and in the GUIDE screen.
const STRATEGY = [
  {
    topic: "Collapsing floor intro",
    what: "Floors can collapse or open into pits when you commit.",
    safe: "Keep moving with short, controlled steps - don't stand still on suspicious tiles.",
    oops: "Sprinting straight forward and trusting the first safe-looking platform.",
  },
  {
    topic: "Erupting block shove",
    what: "Both pits are guarded by blocks that burst out of the ground and walk into you — the first drops in front and shoves you backwards, the second pops up behind and drives you forwards.",
    safe: "Never stand still on a ledge here. Jump the first block the moment you land, and jump the second pit as soon as its floor drops. Spikes erupt in front of the door while you are still airborne - land short of them, then hop the band.",
    oops: "Waiting to see what the block does. Both of them are walking you into a hole while you watch. Also: sprinting at the door after the last pit, straight into the spikes.",
  },
  {
    topic: "Collapsing platform segments",
    what: "Two floating platforms over a wide spike pit. The near one is four tiles: only the second one is solid, and the other three drop if you stand on them for more than a quarter of a second. Stop on a seam and both tiles under you go at once.",
    safe: "Cross the crumbling tiles without stopping. The second tile is the only place you can wait - take off from there and use the last two tiles as steps, not as standing room.",
    oops: "Pausing on a crumbling tile to line up the jump. A quarter second is all it takes, and a seam takes two tiles with it.",
  },
  {
    topic: "Hidden spikes timing",
    what: "Ground spikes pop when you approach certain tiles.",
    safe: "Pause for a split second before each jump to confirm the spike timing.",
    oops: "Speedrunning the level and jumping blind into a trigger tile.",
  },
  {
    topic: "The door drives, not you",
    what: "Your controls are wired to the exit instead of to you, and mirrored: right drives the door left, left drives it right. The door falls, lands and dies like a player. There is a spiked hole in the way, a blade that drops in behind the door once it is past the hole and chases it the whole way, and spikes that pop up near the end. You never move at all.",
    safe: "Hold right and keep the door moving - it is barely faster than the blade, so every wasted moment is ground lost. Jump the hole, keep going, and jump the spikes near the end without stopping.",
    oops: "Reading the controls the normal way and shoving the door off the far side, walking it into the hole, or hesitating once the blade is up and letting it catch the door from behind.",
  },
  {
    topic: "One ledge and a very long gap",
    what: "A 60px ledge, then a 700px drop carpeted end to end with spikes, then the platform holding the door.",
    safe: "Nothing about that gap is survivable on the way down - look for another way across.",
    oops: "Stepping off the ledge on reflex.",
  },
  {
    topic: "One ledge and a patrolling blade",
    what: "Two vertical shafts between you and the door, split by a wall whose top is level with the top of the platforms' travel. Setting foot on the far platform makes the door vanish and turn up again back at the start, and spikes fill the doorway it left behind.",
    safe: "Both platforms move the moment you leave the ground - the first retreats, the second runs away ahead of you - so never aim at where they are. Once the door bails out they reverse and go back to where they started, so the trip home needs the opposite aim again.",
    oops: "Jumping at the platform you can see, and treating the far platform as the finish line.",
  },
];

const LEVELS = [
  // ---------------------------------------------------- 1 — collapsing floors
  {
    name: "FLOOR? NEVER HEARD OF HER",
    build: () => ({
      spawn: { x: 56, y: 440 },
      door: new Door([{ x: 876, y: 416 }]),
      solids: [floorSeg(0, 340), floorSeg(460, 700), floorSeg(820, 960), wallL(), wallR()],
      traps: [
        new CollapseFloor(R(340, 480, 120, 60), R(335, 300, 5, 180), { delay: 0.1 }),
        new CollapseFloor(R(700, 480, 120, 60), R(680, 300, 5, 180), { delay: 0.5 }),
        new Note(178, 430, "just walk to the door bro"),
        new Note(766, 398, "this bit is fine, trust", { angle: 0.03, size: 14 }),
      ],
    }),
  },
  // ---------------------------------------------------- 2 — erupting block shove
  {
    name: "RUDE.",
    build: () => ({
      spawn: { x: 56, y: 440 },
      door: new Door([{ x: 922, y: 416 }]),
      // same two collapsing floors as level 1, untouched
      solids: [floorSeg(0, 340), floorSeg(460, 700), floorSeg(820, 960), wallL(), wallR()],
      traps: [
        new CollapseFloor(R(340, 480, 120, 60), R(252, 300, 26, 180), { delay: 0.18 }),
        new CollapseFloor(R(700, 480, 120, 60), R(616, 300, 26, 180), { delay: 0.5 }),
        // armed while you are still in the air over the pit, so you watch it
        // erupt on your way down; the moment you touch the ledge it starts
        // walking left and scrapes you back off the edge
        new PopWall(R(496, 424, 28, 56), R(362, 300, 70, 180), {
          speed: 300, push: -1,
          slide: { dx: -36, speed: 500, after: 0.05 },
        }),
        // mirror of the first: this one pops up BEHIND you while you wait for the
        // second floor to drop, then walks right and shoves you into that pit
        new PopWall(R(600, 424, 28, 56), R(622, 300, 50, 180), {
          speed: 300, push: 1,
          slide: { dx: 72, speed: 400, after: 0.05 },
        }),
        // spikes guarding the doormat: dormant until you commit to the final
        // leap over the second pit, then they erupt while you are still airborne
        // and watching. you land short of them and have to clear them cold.
        new PopSpikes(820, 480, 80, (g) => g.player.x > 720, {
          delay: 0.04, retract: 2,
        }),
        new Note(178, 430, "same as before. easy."),
        new Note(624, 372, "...", { size: 16 }),
      ],
    }),
  },
  // ---------------------------------------------------- 3 — collapsing platform segments
  {
    name: "SEGMENTATION FAULT",
    build: () => ({
      spawn: { x: 56, y: 440 },
      door: new Door([{ x: 876, y: 416 }]),
      // two floating platforms. Platform 1 is four contiguous 50px tiles spanning
      // 300-500; only segment 2 is honest, the other three drop if you loiter.
      solids: [
        floorSeg(0, 270),
        R(350, 402, 50, 16),        // platform 1, segment 2 — stable
        R(600, 402, 100, 16),       // platform 2 — stable
        floorSeg(760, 960),
        wallL(), wallR(),
      ],
      traps: [
        new Saw([{ x: 260, y: 360 }, { x: 700, y: 360 }], { speed: 200, r: 20 }),
        // segments 1, 3 and 4: stand on any of them for more than half a second
        // and it goes. Cross them without stopping and they hold; the middle tile
        // is the only one you can actually rest on.
        new CrumblePlatform(R(300, 402, 50, 16), { delay: 0.05, dwell: 0.1, coverage: 2 / 3, cracks: false }),
        new CrumblePlatform(R(400, 402, 50, 16), { delay: 0.05, dwell: 0.1, coverage: 2 / 3, cracks: false }),
        new CrumblePlatform(R(450, 402, 50, 16), { delay: 0.05, dwell: 0.1, coverage: 2 / 3, cracks: false }),
        new Coin(420, 344),
        new Coin(645, 344),
        new Coin(500, 250, { flag: "greed" }),
        new PopSpikes(600, 402, 100, (g) => !!g.flags.greed, { delay: 0.02, size: 26 }),
        new StaticSpikes(270, 540, 490, { dir: "up", size: 52 }),
        new Note(150, 430, "free coins. no strings."),
        new Note(500, 366, "don't go back.", { size: 13 }),
      ],
    }),
  },
  // ---------------------------------------------------- 4 — hidden spikes
  {
    name: "SPIKES? IN THIS ECONOMY?",
    build: () => ({
      spawn: { x: 50, y: 440 },
      door: new Door([{ x: 890, y: 416 }]),
      solids: [floorSeg(0, 960), wallL(), wallR()],
      traps: [
        // ~100px of safe floor between patches: every patch is jumpable, but the
        // late-popping ones punish an over-committed leap.
        new PopSpikes(288, 480, 68, R(222, 300, 20, 180), { delay: 0.08 }),
        // the middle patch does not wait to be jumped — once you are over it, it
        // slides right to meet you where you were going to land.
        // NOTE: width + dx is the whole danger span, and the player needs their own
        // 26px clear on top of it. Measured ceiling is ~122px of span; 88 + 20 sits
        // just inside it, 88 + 30 does not and the level becomes impossible.
        new PopSpikes(456, 480, 88, R(288, 300, 20, 180), {
          delay: 0.1, slide: { dx: 60, speed: 500 },
        }),
        // the last patch is armed at x=600 and immediately lunges left at you.
        // NOTE: width is capped by the door at x=890, not by the jump — the patch
        // starts at 792, so anything past ~100 wide buries the door and no route
        // exists at any slide distance (144 and 120 both fail even with dx: 0).
        new PopSpikes(760, 480, 80, R(780, 300, 60, 180), {
          delay: 0.06, slide: { dx: -0, speed: 500, on: "trigger", after: 0.5 },
        }),
        new Note(126, 420, "pause. then jump. i'm serious."),
      ],
    }),
  },
  // ---------------------------------------------------- 5 — the door drives
  {
    name: "YOU'RE NOT THE MAIN CHARACTER",
    build: () => ({
      // the input no longer belongs to you: it drives the DOOR, mirrored, and the
      // door falls, collides and dies exactly like a player would. You just stand
      // on the spawn tile and watch.
      doorDrive: { speed: 265 },
      spawn: { x: 56, y: 440 },
      door: new Door([{ x: 920, y: 416 }]),
      solids: [floorSeg(0, 800), floorSeg(900, 960), wallL(), wallR()],
      traps: [
        // the hole the door has to clear on its way to you — it is the door that
        // falls in, and the door landing on spikes is what kills the run
        new StaticSpikes(800, 540, 100, { dir: "up", size: 25 }),
        // dormant until the door passes x=800; then it drops in at x=750 and makes
        // a single run left at the player. No return trip — it stops where it ends
        // and sits there, still lethal.
        new Saw([{ x: 900, y: 430 }, { x: -20, y: 430 }], {
          speed: 280, r: 20, once: true,
          trigger: (g) => g.level.door.pos.x <= 800,
        }),
        // NOTE: the trigger watches the DOOR, not the player — the player never
        // leaves x=56 on this level, so a player-based test would already be true
        // on the first frame and these would be up before anything happened.
        new PopSpikes(200, 480, 60, (g) => g.level.door.pos.x <= 300, { delay: 0.12 }),
        new Note(112, 430, "you don't move. it does."),
        new Note(596, 372, "right means left. mind the hole.", { size: 13 }),
      ],
    }),
  },
  // ---------------------------------------------------- 6 — one ledge, one pit
  {
    name: "MIND THE GAP",
    build: () => ({
      spawn: { x: 16, y: 440 },
      door: new Door([{ x: 876, y: 416 }]),
      // any landing after a fall of more than 100px kills
      maxDrop: 142,
      // a 100px ledge to stand on, the spiked gap, and the door platform
      solids: [
        floorSeg(0, 100),
        R(0, 150, 100, 16),          // upper ledge at the top of the riser's travel
        R(200, 150, 10, 430),        // 10px divider between the two lifts
        floorSeg(560, 960),          // door platform
        wallL(), wallR(),
      ],
      traps: [
        // spikes carpeting the full width of the gap
        new StaticSpikes(60, 540, 500, { dir: "up", size: 44 }),
        // crate sitting on the lip of the ledge — walk into it to shove it
        new PushBox(R(75, 430, 25, 50)),
        // crate waiting up on the high ledge, directly above the first one
        new PushBox(R(75, 100, 25, 50)),
        // riser: any weight sends it up to y=150, and it sinks back to y=480
        // the moment it is empty
        new LiftPlatform(R(100, 480, 100, 16), { speed: 70, fall: 70, to: 150 }),
        // sinker: the mirror of it — parked at y=150, weight drives it DOWN to
        // y=480, and it climbs back to 150 once it is empty
        new LiftPlatform(R(210, 150, 100, 16), { speed: 70, fall: 70, to: 480 }),
      ],
    }),
  },
  // ---------------------------------------------------- 7 — two shafts, one wall
  {
    name: "ROUND AND ROUND",
    build: () => ({
      spawn: { x: 16, y: 440 },
      // Touch the far platform and the door blinks out; three seconds later it
      // reappears back at the start, at x=50.
      door: new Door([{ x: 876, y: 416 }], {
        vanish: {
          when: (g) => g.player.x + g.player.w > 700 && g.player.grounded,
          delay: 2,
          after: 3,
          to: { x: 50, y: 416 },
        },
      }),
      // start floor, two vertical shafts split by a wall, then the door platform.
      // The wall's top face sits at y=150, level with the top of both platforms'
      // travel, so it doubles as the bridge between the two shafts.
      solids: [
        floorSeg(0, 200),
        R(425, 150, 50, 430),       // wall separating the two shafts
        floorSeg(700, 960),
        R(0, 0, 200, 350),          // roof over each end; the shafts stay open
        R(675, 0, 500, 350),
        wallL(), wallR(),
      ],
      traps: [
        // shaft 1: rides between the floor and the top of the wall, and slides
        // 50px left the moment you are airborne past x=200 — so the spot you
        // aimed at is not the spot you land on
        new MovingPlatform(R(350, 480, 50, 16), {
          toY: 150, speed: 70, pause: 1,
          shift: {
            when: (g) => g.player.x > 200 && !g.player.grounded,
            dx: -100,
            // only reverses once the door platform has been visited AND you are
            // back on its near side; out past x=400 it still runs away from you
            back: (g) => g.level.door.armT !== null && g.player.x < 400,
          },
        }),
        // shaft 2: the same trick, armed once you are airborne past x=450
        new MovingPlatform(R(500, 480, 50, 16), {
          toY: 150, speed: 70, pause: 1,
          // no `back` on this one: once it has run away to 575-625 it stays there,
          // even after the door platform has been visited
          shift: {
            when: (g) => g.player.x > 450 && !g.player.grounded,
            dx: 75,
          },
        }),
        // the door is not your friend: walk up to it and it spits spikes out of
        // its own doorway, right where you were about to stand
        // spikes fill the old doorway the moment the door bails out — or the
        // moment you walk up to it, whichever you manage first
        new PopSpikes(874, 480, 42,
          (g) => g.level.door.gone || g.player.x > 820, { delay: 0.04, size: 30 }),
      ],
    }),
  },
];

const DEATH_LINES = [
  "SKILL ISSUE.", "L + RATIO.", "BRUH.", "TASK FAILED SUCCESSFULLY.",
  "NOT STONKS.", "THIS IS FINE.", "RIP BOZO.", "IT'S OVER.",
  "AND I TOOK THAT PERSONALLY.", "CERTIFIED OOPS MOMENT.", "SUS.",
  "HE-HE.", "WHO PUT THAT THERE?", "TRY WALKING SLOWER.", "PERFECTLY PLANNED.",
];
const ROASTS = [
  [0, "wait... flawless?! upload the VOD."],
  [25, "respectable. barely any rage."],
  [75, "the devil enjoyed every single one."],
  [150, "have you considered walking?"],
  [9999, "the floor knows you personally now."],
];

// ================================================================ GAME
const Game = {
  state: "menu",
  levelIndex: 0,
  level: null,
  player: null,
  deaths: 0,
  levelDeaths: 0,
  coins: 0,
  invertControls: false,
  slippery: false,
  warpLock: 0,
  flipCool: 0,
  flags: {},
  deathT: 0,
  deathLine: "",
  winT: 0,
  shakeAmt: 0,
  shakeT: 0,
  wipe: 0,
  wipeDir: 0,
  wipeNext: null,
  time: 0,

  shake(amt, t) { this.shakeAmt = Math.max(this.shakeAmt, amt); this.shakeT = Math.max(this.shakeT, t); },

  loadLevel(i) {
    if (i !== this.levelIndex || this.level === null) this.levelDeaths = 0;
    this.levelIndex = i;
    const def = LEVELS[i];
    this.flags = {};
    this.coins = 0;
    this.warpLock = 0;
    this.flipCool = 0;
    this.slippery = false;
    this.level = def.build();
    this.level.name = def.name;
    this.spawnPlayer();
    stains = [];
    particles.length = 0;
    document.getElementById("hud-levelname").textContent = def.name;
    document.getElementById("hud-levelnum").textContent = i + 1;
    syncLevelHud();
  },

  spawnPlayer() {
    const s = this.level.spawn;
    const size = SIZES[this.level.startSize ?? "normal"];
    this.player = {
      x: s.x, y: s.y, w: size.w, h: size.h,
      vx: 0, vy: 0,
      grounded: false, coyote: 0, face: 1,
      squash: 0, jumping: false,
      grav: this.level.startGravity ?? 1,
      size: this.level.startSize ?? "normal",
      jumpsLeft: this.level.airJumps ?? 0,
      apexY: s.y,                 // highest point of the current fall, for maxDrop
    };
  },

  restartLevel(manual = false) {
    if (manual) { this.deaths++; saveProgress(); updateDeathHud(); }
    this.loadLevel(this.levelIndex);
    this.state = "play";
  },

  die(x, y) {
    if (this.state !== "play") return;
    this.deaths++;
    this.levelDeaths++;
    maybeOfferHint();
    saveProgress();
    updateDeathHud();
    AudioFX.death();
    spawnBlood(x, y);
    addStain(x, Math.min(y + 20, 478));
    this.shake(9, 0.3);
    this.state = "dead";
    this.deathT = 0;
    this.deathLine = DEATH_LINES[Math.floor(Math.random() * DEATH_LINES.length)];
  },

  winLevel() {
    this.state = "win";
    this.winT = 0;
    AudioFX.win();
    const done = getDone();
    done[this.levelIndex] = true;
    localStorage.setItem("tmg_done", JSON.stringify(done));
  },

  startWipe(cb) { this.wipeDir = 1; this.wipeNext = cb; },

  tryFlip() {
    if (this.state !== "play" || !this.level || !this.level.gravityFlip) return;
    if (this.flipCool > 0) return;
    if (flipGravity(this, -this.player.grav)) this.flipCool = 0.22;
  },

  update(dt) {
    this.time += dt;
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.shakeT <= 0) this.shakeAmt = 0;
    updateParticles(dt);

    if (this.wipeDir !== 0) {
      this.wipe += this.wipeDir * dt * 3;
      if (this.wipeDir > 0 && this.wipe >= 1) {
        this.wipe = 1;
        if (this.wipeNext) this.wipeNext();
        this.wipeNext = null;
        this.wipeDir = -1;
      } else if (this.wipeDir < 0 && this.wipe <= 0) {
        this.wipe = 0; this.wipeDir = 0;
      }
    }

    if (this.state === "play") this.updatePlay(dt);
    else if (this.state === "dead") {
      this.deathT += dt;
      for (const t of this.level.traps) t.update(dt, this);
      if (this.deathT > 0.85) {
        this.startWipe(() => { this.loadLevel(this.levelIndex); this.state = "play"; });
        this.state = "respawning";
      }
    } else if (this.state === "win") {
      this.winT += dt;
      if (this.winT > 0.8) {
        this.state = "betweenLevels";
        if (this.levelIndex + 1 >= LEVELS.length) {
          this.startWipe(() => showEnd());
        } else {
          this.startWipe(() => { this.loadLevel(this.levelIndex + 1); this.state = "play"; });
        }
      }
    }
  },

  collectSolids() {
    const out = [...this.level.solids];
    for (const t of this.level.traps) out.push(...t.solids());
    return out;
  },

  // The door as a physics body: the same gravity, collision and lethality the
  // player gets, steered by mirrored input. Returns true if it died this frame.
  driveDoor(dt, dir, drive) {
    const door = this.level.door, d = door.pos;
    const speed = drive.speed ?? 265;

    const target = -dir * speed;            // mirrored: right drags it left
    const rate = 2600;
    if (target > door.vx) door.vx = Math.min(target, door.vx + rate * dt);
    else if (target < door.vx) door.vx = Math.max(target, door.vx - rate * dt);

    if (drive.jump !== false && jumpBuffered > 0 && door.grounded) {
      door.vy = -645; door.grounded = false; jumpBuffered = 0; AudioFX.jump();
      spawnDust(d.x + door.w / 2, d.y + door.h, 4);
    }
    if (!heldJump() && door.vy < -220) door.vy = -220;
    door.vy = clamp(door.vy + 2150 * dt, -980, 980);

    const solids = this.collectSolids();
    d.x += door.vx * dt;
    for (const s of solids) {
      if (aabb(door.body(), s)) {
        if (door.vx > 0) d.x = s.x - door.w;
        else if (door.vx < 0) d.x = s.x + s.w;
        door.vx = 0;
      }
    }
    d.y += door.vy * dt;
    door.grounded = false;
    for (const s of solids) {
      if (aabb(door.body(), s)) {
        if (door.vy > 0) { d.y = s.y - door.h; door.grounded = true; }
        else if (door.vy < 0) d.y = s.y + s.h;
        door.vy = 0;
      }
    }
    d.x = clamp(d.x, drive.min ?? 0, drive.max ?? W - door.w);

    // spikes and the void take the door exactly as they would take the player
    for (const t of this.level.traps) {
      for (const k of t.kills()) {
        if (aabb(door.body(), k)) { this.die(d.x + door.w / 2, d.y + door.h / 2); return true; }
      }
    }
    if (d.y > H + 40) { this.die(d.x + door.w / 2, H); return true; }
    return false;
  },

  updatePlay(dt) {
    const p = this.player;
    this.invertControls = false;
    this.slippery = false;
    this.warpLock = Math.max(0, this.warpLock - dt);
    this.flipCool = Math.max(0, this.flipCool - dt);

    for (const t of this.level.traps) t.update(dt, this);
    this.level.door.update(dt, this);

    let dir = 0;
    if (heldLeft()) dir -= 1;
    if (heldRight()) dir += 1;
    if (this.invertControls) dir = -dir;

    // `doorDrive` hijacks the input entirely: it drives the DOOR, mirrored — right
    // sends it left, left sends it right. The door is a physics body like the
    // player (gravity, solids, spikes, the void), and the player just stands
    // there. Walking the door into the player is what finishes the level.
    const drive = this.level.doorDrive;
    if (drive) {
      if (this.driveDoor(dt, dir, drive)) return;
      dir = 0;
    }

    if (dir !== 0) p.face = dir;

    const SPEED = 265;
    const onIce = this.slippery && p.grounded;
    const accel = p.grounded ? (onIce ? 380 : 2600) : 1800;
    const brake = onIce ? 150 : accel;
    const target = dir * SPEED;
    const rate = dir === 0 ? brake : accel;
    if (target > p.vx) p.vx = Math.min(target, p.vx + rate * dt);
    else if (target < p.vx) p.vx = Math.max(target, p.vx - rate * dt);

    jumpBuffered = Math.max(0, jumpBuffered - dt);
    p.coyote = p.grounded ? 0.1 : Math.max(0, p.coyote - dt);
    if (jumpBuffered > 0 && (p.coyote > 0 || p.jumpsLeft > 0)) {
      if (p.coyote <= 0) p.jumpsLeft--;
      p.vy = -645 * p.grav;
      p.grounded = false;
      p.coyote = 0;
      p.jumping = true;
      jumpBuffered = 0;
      AudioFX.jump();
      spawnDust(p.x + p.w / 2, p.grav > 0 ? p.y + p.h : p.y, 4);
    }
    // "rising" is relative to whichever way gravity currently points
    if (p.vy * p.grav >= 0) p.jumping = false;
    if (!heldJump() && p.jumping && p.vy * p.grav < -220) { p.vy = -220 * p.grav; p.jumping = false; }

    p.vy = clamp(p.vy + 2150 * dt * p.grav, -980, 980);

    const solids = this.collectSolids();
    const wasGrounded = p.grounded;

    p.x += p.vx * dt;
    for (const s of solids) {
      if (aabb(p, s)) {
        if (p.vx > 0) p.x = s.x - p.w;
        else if (p.vx < 0) p.x = s.x + s.w;
        else p.x = p.x + p.w / 2 < s.x + s.w / 2 ? s.x - p.w : s.x + s.w;
        p.vx = 0;
      }
    }

    p.y += p.vy * dt;
    p.grounded = false;
    for (const s of solids) {
      if (aabb(p, s)) {
        const landing = p.vy * p.grav > 0;
        const impact = Math.abs(p.vy);
        if (p.vy > 0) p.y = s.y - p.h;
        else if (p.vy < 0) p.y = s.y + s.h;
        if (landing) {
          p.grounded = true;
          if (!wasGrounded && impact > 350) {
            AudioFX.land();
            spawnDust(p.x + p.w / 2, p.grav > 0 ? p.y + p.h : p.y, 5);
            p.squash = 0.12;
          }
        }
        p.vy = 0;
      }
    }
    // Fall damage, when the level asks for it: measure the drop from the highest
    // point reached since leaving the ground, and kill on a landing taller than
    // `maxDrop`. Tracked against gravity's direction so flipped levels work too.
    if (this.level.maxDrop) {
      if (p.grounded) {
        if (!wasGrounded && (p.y - p.apexY) * p.grav > this.level.maxDrop) {
          this.die(p.x + p.w / 2, p.y + p.h / 2);
          return;
        }
        p.apexY = p.y;
      } else {
        p.apexY = p.grav > 0 ? Math.min(p.apexY, p.y) : Math.max(p.apexY, p.y);
      }
    }

    if (p.grounded) p.jumpsLeft = this.level.airJumps ?? 0;
    p.squash = Math.max(0, p.squash - dt);

    for (const s of solids) {
      if (aabb(R(p.x + 4, p.y + 4, p.w - 8, p.h - 8), s)) {
        this.die(p.x + p.w / 2, p.y + p.h / 2);
        return;
      }
    }

    const covers = [];
    for (const t of this.level.traps) if (t.cover) { const c = t.cover(); if (c) covers.push(c); }
    for (const t of this.level.traps) {
      for (const k of t.kills()) {
        if (!aabb(p, k)) continue;
        // a crate parked on the spikes shields whatever is under it
        if (covers.some((c) => aabb(p, c))) continue;
        this.die(p.x + p.w / 2, p.y + p.h / 2); return;
      }
    }

    if (p.y > H + 40 || p.y + p.h < -40) {
      this.deaths++;
      this.levelDeaths++;
      maybeOfferHint();
      saveProgress();
      updateDeathHud();
      AudioFX.death();
      this.state = "dead";
      this.deathT = 0;
      this.deathLine = DEATH_LINES[Math.floor(Math.random() * DEATH_LINES.length)];
      this.shake(6, 0.25);
      return;
    }

    if (this.coins !== this._coinsShown) {
      this._coinsShown = this.coins;
      document.getElementById("hud-coins").textContent = this.coins;
    }

    if (this.level.door.playerWins(p)) this.winLevel();
  },

  // ============================================================== draw
  draw() {
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.paper;
    ctx.fillRect(0, 0, W, H);

    if (this.shakeAmt > 0) {
      ctx.translate(rand(-this.shakeAmt, this.shakeAmt), rand(-this.shakeAmt, this.shakeAmt));
    }

    if (this.level) {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y <= H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = theme.blood;
      for (const s of stains) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      this.level.door.draw();

      ctx.fillStyle = theme.ink;
      for (const s of this.level.solids) {
        if (s.x < -20 || s.x > W) continue;
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }

      for (const t of this.level.traps) t.draw();

      if (this.state === "play" || this.state === "win" || this.state === "betweenLevels") this.drawPlayer();

      drawParticles();

      // vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.95);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, theme.vignette);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      if (this.state === "dead" || this.state === "respawning") {
        const a = clamp(this.deathT * 4, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = theme.danger;
        ctx.font = `900 58px ${FONT}`;
        ctx.textAlign = "center";
        const wob = Math.sin(this.time * 30) * 2 * (1 - this.deathT);
        ctx.fillText(this.deathLine, W / 2 + wob, H / 2 - 30);
        ctx.globalAlpha = 1;
      }

      if (this.state === "win" || this.state === "betweenLevels") {
        const a = clamp(this.winT * 5, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = theme.accent;
        ctx.font = `900 52px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(this.levelIndex + 1 >= LEVELS.length ? "WHAT?!" : "FINE. NEXT.", W / 2, H / 2 - 40);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    if (this.wipe > 0.001) {
      const maxR = Math.hypot(W, H) / 2 + 40;
      const r = (1 - this.wipe) * maxR;
      ctx.fillStyle = theme.wipe;
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(W / 2, H / 2, Math.max(r, 0), 0, Math.PI * 2, true);
      ctx.fill();
    }
  },

  drawPlayer() {
    const p = this.player;
    const k = p.h / 32;                       // metrics scale with the resize pads
    const squashY = p.squash > 0 ? 1 - p.squash * 2.2 : 1;
    const stretchY = !p.grounded ? clamp(1 + Math.abs(p.vy) / 2600, 1, 1.18) : squashY;
    const sx = 1 / stretchY;
    const cx = p.x + p.w / 2;
    const by = p.grav > 0 ? p.y + p.h : p.y;  // whichever edge the feet are on

    // ground shadow
    if (p.grounded) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = theme.shadow;
      ctx.beginPath();
      ctx.ellipse(cx, by + 2 * p.grav, p.w * 0.6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(cx, by);
    ctx.scale(sx, stretchY * p.grav);         // flipping gravity flips the little guy
    ctx.fillStyle = theme.ink;
    roundRect(-p.w / 2, -p.h, p.w, p.h, 7 * k);
    ctx.fill();

    const lookX = p.face * 3 * k;
    const lookY = clamp(p.vy / 700, -2.5, 2.5) * p.grav;
    const eyeY = -p.h + 11 * k;
    ctx.fillStyle = theme.paper;
    ctx.beginPath();
    ctx.ellipse(-5 * k + lookX, eyeY, 4.6 * k, 5.6 * k, 0, 0, Math.PI * 2);
    ctx.ellipse(6 * k + lookX, eyeY, 4.6 * k, 5.6 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.ink;
    ctx.beginPath();
    ctx.arc(-5 * k + lookX + p.face * 1.4 * k, eyeY + lookY, 2 * k, 0, Math.PI * 2);
    ctx.arc(6 * k + lookX + p.face * 1.4 * k, eyeY + lookY, 2 * k, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    if (p.grounded && Math.abs(p.vx) > 180 && Math.random() < 0.25) {
      spawnDust(p.x + p.w / 2 - p.face * 10, by, 1);
    }
  },
};

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- progress / DOM
function getDone() {
  try { return JSON.parse(localStorage.getItem("tmg_done")) || {}; } catch { return {}; }
}
function saveProgress() { localStorage.setItem("tmg_deaths", Game.deaths); }
function loadProgress() {
  Game.deaths = parseInt(localStorage.getItem("tmg_deaths")) || 0;
}
function updateDeathHud() {
  document.getElementById("hud-deaths").textContent = Game.deaths;
  document.getElementById("menu-deaths").textContent = Game.deaths;
}

// ---------------------------------------------------------------- strategy / hints
// Everything below is driven by STRATEGY[], which mirrors level_strategies.txt.
let hintOffered = false;

function syncLevelHud() {
  const lv = Game.level;
  Game._coinsShown = Game.coins;
  const hasCoins = !!lv && lv.traps.some((t) => t instanceof Coin);
  document.getElementById("hud-coins-wrap").classList.toggle("hidden", !hasCoins);
  document.getElementById("hud-coins").textContent = Game.coins;
  const flipBtn = document.getElementById("tc-flip");
  if (flipBtn) flipBtn.classList.toggle("hidden", !(lv && lv.gravityFlip));
  const s = STRATEGY[Game.levelIndex];
  document.getElementById("hud-topic").textContent = s ? s.topic : "";
  if (Game.levelDeaths === 0) { hintOffered = false; hideHint(); }
}

function showHint() {
  const s = STRATEGY[Game.levelIndex];
  if (!s) return;
  document.getElementById("hint-topic").textContent = s.topic;
  document.getElementById("hint-what").textContent = s.what;
  document.getElementById("hint-safe").textContent = s.safe;
  document.getElementById("hint-oops").textContent = s.oops;
  document.getElementById("hint-frame").classList.remove("hidden");
}
function hideHint() { document.getElementById("hint-frame").classList.add("hidden"); }
function toggleHint() {
  if (Game.state === "menu" || Game.state === "end") return;
  const el = document.getElementById("hint-frame");
  if (el.classList.contains("hidden")) showHint(); else hideHint();
}
// after the third death on a level the devil relents and quotes the walkthrough
function maybeOfferHint() {
  if (Game.levelDeaths >= 3 && !hintOffered) { hintOffered = true; showHint(); }
}

function buildGuide() {
  const wrap = document.getElementById("guide-list");
  wrap.innerHTML = "";
  LEVELS.forEach((lv, i) => {
    const st = STRATEGY[i];
    const card = document.createElement("div");
    card.className = "guide-card";
    const h = document.createElement("h3");
    const num = document.createElement("span");
    num.className = "gnum";
    num.textContent = i + 1;
    h.appendChild(num);
    h.appendChild(document.createTextNode(lv.name));
    card.appendChild(h);
    const rows = [
      ["gtopic", "", st.topic],
      ["", "What happens: ", st.what],
      ["gsafe", "Safe move: ", st.safe],
      ["goops", "Common mistake: ", st.oops],
    ];
    for (const [cls, label, text] of rows) {
      const pEl = document.createElement("p");
      if (cls) pEl.className = cls;
      if (label) {
        const b = document.createElement("b");
        b.textContent = label;
        pEl.appendChild(b);
      }
      pEl.appendChild(document.createTextNode(text));
      card.appendChild(pEl);
    }
    wrap.appendChild(card);
  });
}

const menuEl = document.getElementById("menu");
const hudEl = document.getElementById("hud");
const endEl = document.getElementById("end-screen");
const touchEl = document.getElementById("touch-controls");
const guideEl = document.getElementById("guide-screen");
const hintFrameEl = document.getElementById("hint-frame");

// ---------------------------------------------------------------- topbar controls (theme / mute / fullscreen)
const SUN_PATH = '<svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="4.4" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5 5l1.9 1.9M17.1 17.1L19 19M19 5l-1.9 1.9M6.9 17.1L5 19"/></g></svg>';
const MOON_PATH = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.4 6.4 0 0 0 10.5 10.5z" fill="currentColor"/></svg>';
const VOL_ON = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7.5 7.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const VOL_OFF = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const FS_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const FS_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>';

function setMuteIcon(muted) {
  const el = document.getElementById("ic-mute");
  if (el) el.innerHTML = muted ? VOL_OFF : VOL_ON;
}
function setFsIcon() {
  const el = document.getElementById("ic-fs");
  if (el) el.innerHTML = document.fullscreenElement ? FS_ON : FS_OFF;
}
function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  try {
    if (!d.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen)?.call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen)?.call(d);
    }
  } catch {}
}
document.addEventListener("fullscreenchange", () => { setFsIcon(); fit(); });

function wireTopbar() {
  const bt = document.getElementById("btn-theme");
  const bm = document.getElementById("btn-mute");
  const bf = document.getElementById("btn-fs");
  if (bt) bt.addEventListener("click", () => { toggleTheme(); });
  if (bm) bm.addEventListener("click", () => { AudioFX.init(); setMuteIcon(AudioFX.toggleMute()); });
  if (bf) bf.addEventListener("click", () => { toggleFullscreen(); });
  setMuteIcon(AudioFX.isMuted());
  setFsIcon();
}

// ---------------------------------------------------------------- touch controls
function bindHold(id, on, off) {
  const el = document.getElementById(id);
  const press = (e) => { e.preventDefault(); el.classList.add("held"); AudioFX.init(); on(); };
  const release = (e) => { e.preventDefault(); el.classList.remove("held"); off(); };
  el.addEventListener("pointerdown", press);
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("pointerleave", release);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}
bindHold("tc-left", () => (touch.left = true), () => (touch.left = false));
bindHold("tc-right", () => (touch.right = true), () => (touch.right = false));
bindHold("tc-jump",
  () => { touch.jump = true; jumpBuffered = 0.12; },
  () => (touch.jump = false)
);
document.getElementById("tc-restart").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (Game.state === "play") Game.restartLevel(true);
});
document.getElementById("tc-flip").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  AudioFX.init();
  Game.tryFlip();
});

function setTouchControlsVisible(v) {
  touchEl.classList.toggle("hidden", !(v && IS_TOUCH));
}

function buildLevelGrid() {
  const grid = document.getElementById("level-grid");
  grid.innerHTML = "";
  const done = getDone();
  for (let i = 0; i < LEVELS.length; i++) {
    const b = document.createElement("button");
    b.textContent = i + 1;
    // every level is open from the start — pick whichever one you want
    b.disabled = false;
    if (done[i]) b.classList.add("done");
    b.addEventListener("click", () => startGame(i));
    grid.appendChild(b);
  }
}

function startGame(i) {
  AudioFX.init();
  if (IS_TOUCH && !document.fullscreenElement) toggleFullscreen();
  menuEl.classList.add("hidden");
  endEl.classList.add("hidden");
  guideEl.classList.add("hidden");
  Game.level = null;
  Game.levelDeaths = 0;
  hudEl.classList.remove("hidden");
  setTouchControlsVisible(true);
  Game.loadLevel(i);
  Game.state = "play";
  Game.wipe = 1;
  Game.wipeDir = -1;
}

function showMenu() {
  buildLevelGrid();
  updateDeathHud();
  hideHint();
  menuEl.classList.remove("hidden");
  endEl.classList.add("hidden");
  guideEl.classList.add("hidden");
  hudEl.classList.add("hidden");
  setTouchControlsVisible(false);
  Game.state = "menu";
}

function showEnd() {
  hudEl.classList.add("hidden");
  hideHint();
  setTouchControlsVisible(false);
  endEl.classList.remove("hidden");
  Game.state = "end";
  document.getElementById("end-deaths").textContent = Game.deaths;
  let roast = ROASTS[ROASTS.length - 1][1];
  for (const [n, t] of ROASTS) { if (Game.deaths <= n) { roast = t; break; } }
  document.getElementById("end-roast").textContent = roast;
}

document.getElementById("play-btn").addEventListener("click", () => startGame(0));
document.getElementById("end-menu-btn").addEventListener("click", showMenu);
document.getElementById("guide-btn").addEventListener("click", () => {
  menuEl.classList.add("hidden");
  guideEl.classList.remove("hidden");
});
document.getElementById("guide-back").addEventListener("click", () => {
  guideEl.classList.add("hidden");
  menuEl.classList.remove("hidden");
});
document.getElementById("hud-hint-btn").addEventListener("click", toggleHint);
document.getElementById("hint-close").addEventListener("click", hideHint);

// ---------------------------------------------------------------- layout / overlays sizing
function fit() {
  const vw = window.innerWidth;
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const pad = IS_TOUCH ? 0 : 36;
  const scale = Math.min((vw - pad) / W, (vh - pad) / H);
  const cw = Math.round(W * scale), ch = Math.round(H * scale);
  cv.style.width = cw + "px";
  cv.style.height = ch + "px";
  for (const el of [menuEl, hudEl, endEl, guideEl, hintFrameEl]) {
    el.style.width = cw + "px";
    el.style.height = el === hudEl ? "auto" : ch + "px";
    el.style.left = `calc(50% - ${cw / 2}px)`;
    el.style.top = `calc(50% - ${ch / 2}px)`;
  }
  // portrait rotate hint
  const rot = document.getElementById("rotate-hint");
  if (rot) rot.classList.toggle("show", IS_TOUCH && vw < vh);
}
addEventListener("resize", fit);
if (window.visualViewport) window.visualViewport.addEventListener("resize", fit);

// ---------------------------------------------------------------- boot
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("tmg_theme"); } catch {}
  if (!saved) saved = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  applyTheme(saved, false);
})();
wireTopbar();
loadProgress();
updateDeathHud();
buildLevelGrid();
buildGuide();
fit();

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 1 / 30);
  Game.update(dt);
  Game.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
