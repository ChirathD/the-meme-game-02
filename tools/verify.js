/* ============================================================
   verify.js — headless check that every level still works.

     node tools/verify.js            # from the project root
     node tools/verify.js 400        # more search seeds (slower, stricter)

   It loads game.js into a stubbed DOM/canvas sandbox and then:
     1. builds and simulates every level, catching runtime errors,
     2. sanity-checks the spawn point and the final door position,
     3. proves each level is completable — either by a randomized
        per-hop search bot, or by a hand-written route for the few
        levels whose take-off windows are too tight for the bot.

   Run this after editing LEVELS. A level that reports UNSOLVED has
   almost certainly become geometrically impossible.
   ============================================================ */
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const GAME = path.join(ROOT, "game.js");
const SEEDS = parseInt(process.argv[2] || "200", 10);

// ---------------------------------------------------------------- DOM / canvas stubs
function makeCtx() {
  const grad = { addColorStop() {} };
  const base = {
    canvas: {},
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
  };
  // every other member is either a no-op draw call or a writable style property
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : (t[k] = () => {})),
    set: (t, k, v) => ((t[k] = v), true),
  });
}

function makeEl(id) {
  const el = {
    id, textContent: "", innerHTML: "", disabled: false, style: {}, children: [],
    _cls: new Set(),
    classList: {
      add: (c) => el._cls.add(c),
      remove: (c) => el._cls.delete(c),
      contains: (c) => el._cls.has(c),
      toggle: (c, on) => {
        const v = on === undefined ? !el._cls.has(c) : !!on;
        v ? el._cls.add(c) : el._cls.delete(c);
        return v;
      },
    },
    _attrs: {},
    setAttribute: (k, v) => { el._attrs[k] = v; },
    getAttribute: (k) => (k in el._attrs ? el._attrs[k] : null),
    addEventListener: () => {},
    appendChild: (c) => (el.children.push(c), c),
    getContext: () => makeEl.ctx || (makeEl.ctx = makeCtx()),
    requestFullscreen: () => {},
  };
  return el;
}

class AudioContextStub {
  constructor() { this.state = "running"; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
  resume() {}
  createOscillator() {
    return {
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect: () => ({ connect() {} }), start() {}, stop() {},
    };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, connect: () => ({ connect() {} }) };
  }
  createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { connect: () => ({ connect: () => ({ connect() {} }) }), start() {} }; }
  createBiquadFilter() { return { frequency: {}, connect: () => ({ connect() {} }) }; }
}

function loadGame() {
  const els = {}, store = {};
  const sandbox = {
    console,
    document: {
      documentElement: makeEl("html"),
      fullscreenElement: null,
      getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
      createElement: () => makeEl("dyn"),
      createTextNode: (t) => ({ textContent: t }),
      addEventListener: () => {},
      exitFullscreen: () => {},
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1280, innerHeight: 800, visualViewport: null,
    AudioContext: AudioContextStub,
    setTimeout: () => 0,
    Math, Date, JSON, Float32Array, Proxy, Set,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(GAME, "utf8"), sandbox, { filename: "game.js" });
  // top-level const/let live in the script's lexical scope, not on the context object
  return vm.runInContext(
    "({ Game, LEVELS, STRATEGY, keys, bufferJump: (v) => { jumpBuffered = v; } })",
    sandbox
  );
}

const api = loadGame();
const { Game: G, LEVELS, STRATEGY, keys } = api;

const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

let failures = 0;
const fail = (msg) => { failures++; console.error("  FAIL  " + msg); };

// ================================================================ 1. structure
console.log(`levels: ${LEVELS.length}   strategy entries: ${STRATEGY.length}\n`);
if (LEVELS.length !== 5) fail(`expected 5 levels, found ${LEVELS.length}`);
if (STRATEGY.length !== LEVELS.length) fail("STRATEGY and LEVELS lengths disagree");

// ================================================================ 2. build + simulate
console.log("-- build & runtime --");
for (let i = 0; i < LEVELS.length; i++) {
  const name = LEVELS[i].name;
  try {
    G.loadLevel(i);
    G.state = "play";
  } catch (e) {
    fail(`L${i + 1} "${name}" failed to build: ${e.message}`);
    continue;
  }

  const p = G.player;
  const inner = { x: p.x + 4, y: p.y + 4, w: p.w - 8, h: p.h - 8 };
  if (G.collectSolids().some((s) => hits(inner, s))) fail(`L${i + 1} "${name}" spawns inside a solid`);

  const d = G.level.door;
  const last = d.positions[d.positions.length - 1];
  if (last.x < 0 || last.x + d.w > 960 || last.y < 0 || last.y + d.h > 540) {
    fail(`L${i + 1} "${name}" final door sits off-canvas`);
  }

  try {
    for (let f = 0; f < 420; f++) {
      keys["ArrowRight"] = Math.floor(f / 40) % 3 !== 1;
      keys["ArrowLeft"] = Math.floor(f / 40) % 3 === 1;
      if (f % 23 === 0) api.bufferJump(0.12);
      if (G.level.gravityFlip && f % 97 === 0) G.tryFlip();
      G.update(1 / 60);
      G.draw();
      if (G.state === "win" || G.state === "betweenLevels") break;
    }
  } catch (e) {
    fail(`L${i + 1} "${name}" threw while playing: ${String(e.stack).split("\n")[0]}`);
  }
}
if (!failures) console.log("  all levels build, draw and simulate cleanly\n");

// ================================================================ 3. completability
// Hand-written routes for levels whose take-off windows are too narrow for the
// search bot to stumble into. Steps: R>x / L<x hold a direction past x, J jump,
// W n stand still n frames, U<y hold course until above y (survives a teleport).
const ROUTES = {
  4:  "R>240 J R>424 J R>690 J R>940",
  // level 5 does not move the player at all — the input steers the door, so the
  // route drives the door into place and then waits for the ledge to drop.
  5:  "D<800 J D<300 W120",
};

function runRoute(level, plan) {
  const steps = plan.trim().split(/\s+/);
  G.loadLevel(level);
  G.state = "play";
  let step = 0, hold = 0, wait = 0;
  const setDir = (d) => {
    const press = G.invertControls ? -d : d;
    keys["ArrowRight"] = press > 0;
    keys["ArrowLeft"] = press < 0;
  };
  for (let f = 0; f < 45 * 60; f++) {
    if (G.state === "win" || G.state === "betweenLevels") return true;
    if (G.state !== "play") return false;
    const p = G.player;
    if (wait > 0) { wait--; setDir(0); }
    else if (step >= steps.length) setDir(0);
    else {
      const c = steps[step];
      if (c[0] === "R") { setDir(1); if (p.x + p.w / 2 > parseFloat(c.slice(2))) step++; }
      else if (c[0] === "L") { setDir(-1); if (p.x + p.w / 2 < parseFloat(c.slice(2))) step++; }
      else if (c[0] === "U") { if (p.y < parseFloat(c.slice(2))) step++; }
      else if (c[0] === "J") { api.bufferJump(0.12); hold = 22; step++; }
      else if (c[0] === "W") { wait = parseInt(c.slice(1), 10); step++; }
      // D<x / D>x — drive the DOOR past x. The controls are mirrored on those
      // levels, so pressing right is what walks the door leftwards.
      else if (c[0] === "D") {
        const target = parseFloat(c.slice(2));
        if (c[1] === "<") { setDir(1); if (G.level.door.pos.x < target) step++; }
        else { setDir(-1); if (G.level.door.pos.x > target) step++; }
      }
      else if (c[0] === "F") { G.tryFlip(); step++; }
    }
    keys["Space"] = hold > 0;
    if (hold > 0) hold--;
    G.update(1 / 60);
  }
  return false;
}

// Search bot: re-rolls wait / take-off distance / jump hold at every landing, so a
// level only comes back unsolved when no combination of those reaches the door.
const UNTRUSTED = new Set(["CollapseFloor", "CrumblePlatform"]);
const firmSolids = () => {
  const out = [...G.level.solids];
  for (const t of G.level.traps) if (!UNTRUSTED.has(t.constructor.name)) out.push(...t.solids());
  return out;
};
function dangerAhead(p, dir, solids, firm) {
  const g = p.grav, lead = dir > 0 ? p.x + p.w : p.x;
  for (let d = 2; d <= 230; d += 3) {
    const x = dir > 0 ? lead + d : lead - d - 5;
    if (!firm.some((s) => hits({ x, y: g > 0 ? p.y + p.h + 2 : p.y - 26, w: 5, h: 24 }, s))) return d;
    if (solids.some((s) => hits({ x, y: p.y + 2, w: 5, h: p.h - 4 }, s))) return d;
    for (const t of G.level.traps)
      for (const k of t.kills())
        if (hits({ x, y: p.y - 4, w: 5, h: p.h + 10 }, k)) return d;
  }
  return Infinity;
}
const groundBelow = (p, solids, depth) =>
  solids.some((s) => hits({ x: p.x + 2, y: p.grav > 0 ? p.y + p.h + 2 : p.y - depth - 2, w: p.w - 4, h: depth }, s));

function searchAttempt(level, seed) {
  const rnd = rng(seed);
  G.loadLevel(level);
  G.state = "play";
  let wasGrounded = true, wait = 0, takeoff = 18, hold = 0, holdLeft = 0, airAt = 0.5, hop = 0;
  const roll = () => {
    wait = rnd() < 0.4 ? Math.floor(rnd() * 80) : 0;
    takeoff = 3 + rnd() * 40;
    hold = 6 + Math.floor(rnd() * 32);
    airAt = 0.15 + rnd() * 0.8;
    hop = rnd() < 0.5 ? 0 : rnd() * 0.05;
  };
  roll();
  for (let f = 0; f < 34 * 60; f++) {
    if (G.state === "win" || G.state === "betweenLevels") return true;
    if (G.state !== "play") { G.update(1 / 60); continue; }
    const p = G.player, g = p.grav;
    if (p.grounded && !wasGrounded) roll();
    wasGrounded = p.grounded;

    const door = G.level.door;
    const tx = door.pos.x + door.w / 2, ty = door.pos.y + door.h / 2;
    let dir = tx > p.x + p.w / 2 + 4 ? 1 : (tx < p.x + p.w / 2 - 4 ? -1 : 0);
    const solids = G.collectSolids();
    const dN = dangerAhead(p, dir || 1, solids, firmSolids());
    if (p.grounded && wait > 0) { wait--; dir = 0; }
    if (!p.grounded && p.vy * g > 0 && groundBelow(p, solids, 200)) dir = 0;

    const press = G.invertControls ? -dir : dir;
    keys["ArrowRight"] = press > 0;
    keys["ArrowLeft"] = press < 0;

    let jump = false;
    if (p.grounded && !wait && dN <= takeoff) jump = true;
    if (p.grounded && !wait && rnd() < hop) jump = true;
    if (p.grounded && !wait && (g > 0 ? ty < p.y - 40 : ty > p.y + 40) && dN < 70) jump = true;
    if (!p.grounded && p.jumpsLeft > 0 && p.vy * g > -640 * airAt && !groundBelow(p, solids, 200)) jump = true;
    if (jump) { api.bufferJump(0.12); holdLeft = hold; }
    keys["Space"] = holdLeft > 0;
    if (holdLeft > 0) holdLeft--;
    if (G.level.gravityFlip && rnd() < 0.03) G.tryFlip();
    G.update(1 / 60);
  }
  return false;
}

console.log(`-- completability (${SEEDS} seeds per level) --`);
for (let i = 0; i < LEVELS.length; i++) {
  const route = ROUTES[i + 1];
  if (route && runRoute(i, route)) {
    console.log(`  ok    L${String(i + 1).padStart(2)} ${LEVELS[i].name.padEnd(32)} scripted route clears it`);
    continue;
  }
  let wins = 0;
  for (let s = 1; s <= SEEDS; s++) if (searchAttempt(i, s * 2654435761)) wins++;
  if (wins) {
    console.log(`  ok    L${String(i + 1).padStart(2)} ${LEVELS[i].name.padEnd(32)} bot cleared ${wins}/${SEEDS}`);
  } else {
    fail(`L${i + 1} "${LEVELS[i].name}" — no route found; the level may be impossible`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nverify: everything checks out");
process.exit(failures ? 1 : 0);
