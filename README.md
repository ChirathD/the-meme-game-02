# THE MEME GAME

A 5-level browser rage-platformer built on the FableDevil engine. Every level is a
memory puzzle: the obvious floor is a lie, the obvious door is bait, and the walkthrough
is built into the game.

![Play in browser](https://img.shields.io/badge/play-in%20browser-ffb24d)
![License](https://img.shields.io/badge/license-MIT-blue)

## Play

Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
# or
python -m http.server 8080
```

## Controls

| Key | Action |
|-----|--------|
| ← → / A D | Move |
| ↑ / W / Space | Jump (some levels give you air jumps) |
| ↓ / S | Flip gravity (level 13) |
| H | Show/hide the strategy card |
| R | Restart level |
| M | Mute &nbsp;·&nbsp; T theme &nbsp;·&nbsp; F fullscreen |

On mobile the game goes fullscreen with floating touch controls. The gravity-flip button
only appears on levels that use it.

## The levels

Levels 1, 2 aside, and level 4 are a direct implementation of [`level_strategies.txt`](level_strategies.txt),
each introducing the mechanic that entry describes. Levels 2 and 3 are originals: level 2
reuses level 1's layout with traps of its own, and level 3 is a reworked copy of the coin
level built around a platform that comes apart under you.

| # | Level | Mechanic |
|---|-------|----------|
| 1 | FLOOR? NEVER HEARD OF HER | Collapsing floors |
| 2 | RUDE. | Level 1's layout + two erupting blocks that bulldoze you into each pit, then spikes that erupt in front of the door mid-jump |
| 3 | SEGMENTATION FAULT | Platform split into 3 segments, two of them timed to drop |
| 4 | SPIKES? IN THIS ECONOMY? | Hidden spikes, pop timing |
| 5 | YOU'RE NOT THE MAIN CHARACTER | You never move: mirrored controls drive the door itself, which falls and dies like a player. Walk it over a spiked hole and into you |

## Strategy cards

The walkthrough is playable, not external:

- **WALKTHROUGH** on the menu lists all 5 entries — what happens, the safe move, and
  the common mistake.
- In-game, the **?** button (or `H`) shows the card for the level you're on.
- After your third death on a level the card opens by itself.

## Traps

Inherited from the base engine: collapsing floors, pop spikes, falling blocks, crushers,
crumbling platforms, homing floor gaps, fake doors, inverted controls, moving platforms,
conveyors, springs, saws, lasers, teleporters, buttons + gates, blinking platforms,
pendulums, turrets.

Added for this game: `PopWall`, `Coin`, `FakePlatform`, `IceZone`, `SizeButton`,
`WarpWall`, `InvisibleWarp`, `ChaserSaw`, `GravityPad`, `TrickDoor` — plus engine support
for gravity flipping, air jumps, slippery friction, and player resizing.

Traps accept either a rectangle trigger or a predicate, so a trap can fire on game state
rather than position — that's how level 4's coin arms the platform spikes:

```js
new PopSpikes(352, 402, 96, (g) => !!g.flags.greed, { delay: 0.02, size: 24 })
```

`PopWall` also takes `slide` and `push`, which is what turns level 2's blocks into
bulldozers. `slide` waits for `g.player.grounded`, travels `dx` at `speed`, and shoves
anything in its path along with it — riding on top moves you too. `push` pins which way
it ejects you, so the shove always aims at the hole. Level 2 uses one of each direction:

```js
// pit 1 — erupts in front while you are mid-jump, then drives LEFT
new PopWall(R(496, 424, 28, 56), R(362, 300, 70, 180), {
  speed: 300, push: -1,
  slide: { dx: -36, speed: 500, after: 0.05 },
})

// pit 2 — erupts BEHIND you while you wait for the floor to drop, then drives RIGHT
new PopWall(R(580, 424, 28, 56), R(622, 300, 50, 180), {
  speed: 300, push: 1,
  slide: { dx: 96, speed: 220, after: 0.45 },
})
```

Jumping is the escape for both.

## Verifying level edits

```bash
node tools/verify.js        # ~1 min
node tools/verify.js 400    # more search seeds, stricter
```

`tools/verify.js` loads `game.js` into a stubbed DOM/canvas, builds and simulates every
level (catching runtime errors, spawns inside walls, off-canvas doors), then proves each
one is still completable — with a randomized search bot, or with a recorded route for the
levels whose take-off windows are too narrow for a bot to stumble into. If it reports
`UNSOLVED` after a level edit, that level has very likely become impossible.

## Tech

Pure HTML, CSS, and JavaScript on a 2D `<canvas>` — no build step, no framework. The only
dependency is `@vercel/analytics`, loaded over an import map. Progress is kept in
`localStorage` under `tmg_*` keys, separate from the original game's saves.

## License

MIT — see [LICENSE](LICENSE). A fan recreation for learning and fun; not affiliated with
any original game.
