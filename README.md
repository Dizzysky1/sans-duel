# Sans Duel

Race a friend through **the real sans fight**. Both players play
[jcw87's Bad Time Simulator](https://github.com/jcw87/c2-sans-fight) (a 1:1 recreation of
the UNDERTALE sans fight) at the same time. You get the same attacks in the same order, and
each player watches the other's game live next to their own.

**Play:** https://dizzysky1.github.io/sans-duel/

## How a race works

1. One player hosts, sends the 5-letter code (or the link) to the other, and they join.
2. Both click inside their own game when they're ready, and a 3-2-1 countdown starts you together.
3. **The first to beat sans wins.** If you die, your opponent wins as soon as they get past the
   attack you died on. If both die, whoever got further wins, and on a tie whoever lasted longer.

Both games share a random seed, and the RNG is re-seeded on every attack. That way the
random attack picks in the second half are the same for both players.

Controls are the original ones: arrows to move, **Z**/Enter to confirm, **X**/Shift to go back.

## How it works

- `game/` is jcw87's exported Construct 2 build, unmodified apart from a few small additions
  in `game/index.html`:
  - `?race=1`: a "click when ready" layer (a real click inside the frame unlocks audio) and
    an input lock that is released at GO.
  - `?seed=N`: a seeded `Math.random`, re-seeded per attack.
  - `?testclock=1`: a manual frame pump for automated tests.
  - The service worker and analytics tag were removed.
- `src/bridge.js` reads the running game from outside the iframe (HP/KR globals, sans'
  `HitAttempts`/`NextAttack`, sans' speech text) and presses keys for it.
- `src/net.js`: PeerJS (WebRTC). A data channel carries race state, and a video call carries
  each player's game canvas (`canvas.captureStream`).
- `src/race.js`: the win rules (unit-tested: `npm test`).

Local dev: `npm run serve` serves the site on http://localhost:3035.

## Credits

- Sans fight recreation (code, sprites, attack scripts): **jcw87**, https://github.com/jcw87/c2-sans-fight
- UNDERTALE, sans and Megalovania © Toby Fox. This is a non-commercial fan project.
