# nubcat-chat-pets

Every viewer in your Twitch chat becomes a roaming 3D nub cat on a transparent
overlay — drop it into OBS as a Browser Source and the crowd grows as people
chat. Pet behavior (roaming, hop reactions, celebration jumps, hearts) is
ported from the Hermes agent pet system; the cat is `cat.fbx` from the silly
nub cat meme pack, rigged and procedurally animated (no baked animations).

## Run

```bash
cd ~/nubcat-chat-pets
python3 -m http.server 8741
```

Then open:

- **Real chat:** `http://localhost:8741/index.html?channel=yourname`
- **Test mode:** `http://localhost:8741/index.html?mock=1&debug=1`
  (simulated chat, checkerboard bg + stats HUD)

## OBS setup

1. Sources → **+** → **Browser**.
2. URL: `http://localhost:8741/index.html?channel=yourname`
3. Width/Height: your canvas size (e.g. 1920×1080). The page background is
   fully transparent — only cats, labels, and bubbles composite onto the stream.
4. Tick "Shutdown source when not visible" if you want it to pause when hidden.

## Options (URL params)

| param    | default | what it does |
|----------|---------|--------------|
| `channel` | — | Twitch channel to read (anonymous read-only, no login) |
| `mock`    | off | simulated chat for testing |
| `max`     | 40 | max concurrent pets; oldest idle one is recycled beyond this |
| `ttl`     | 10 | minutes of silence before a viewer's pet despawns |
| `scale`   | 1 | global cat size multiplier (0.2–3) |
| `speed`   | 1 | walking speed multiplier (0.2–3) |
| `bubbles` | on | speech bubbles showing message text |
| `bubbleSec` | 4.5 | seconds a bubble stays up |
| `celebrate` | on | mass hops on subs/raids/sub-gifts |
| `flip`    | off | flip cats 180° if they walk backwards on your setup |
| `debug`   | off | checkerboard bg + pets/fps HUD |

**Mini-game params** (all games off with `games=0`):

| param | default | what it does |
|-------|---------|--------------|
| `games` | on | master switch for duels/races/boss/simon + points |
| `simonEvery` | 120 | seconds between simon-says rounds |
| `simonFirst` | 45 | delay before the first simon round |
| `simonWindow` | 6 | seconds cats have to comply with a command |
| `duelCooldown` | 90 | seconds between `!duel` fights |
| `crownSec` | 300 | how long a duel/race winner keeps the crown |
| `raceCooldown` | 180 | seconds between `!race` events |
| `raceJoin` | 12 | seconds to `!join` a race |
| `bossCooldown` | 420 | seconds between boss battles |
| `bossHp` | 250 | boss hit points (chat damages it by typing) |
| `bossMax` | 90 | boss despawns after this long if not defeated |
| `auraSec` | 300 | golden aura duration for boss participants |

## Behavior

- Each chatter gets a persistent cat (keyed by name) with their Twitch color
  (or a stable hashed hue) as a floating name label.
- Sending a message makes your cat hop; "love" messages (<3, ty, …) spawn
  hearts.
- Cats roam when idle, pause, look around, and separate so they don't stack.
- Raids / subs / sub-gifts trigger a group celebration + announcement.
- Quiet viewers despawn after the TTL so the crowd reflects live chat.

## Mini games

Chat-driven events inspired by Stream Avatars — one at a time, all with
cooldowns, all visual-only (nothing breaks the transparent OBS compositing).

- **Duels** — `!duel @name` (or random opponent). Cats charge, collide with a
  screen shake + star burst, and the winner is picked by weighted RNG: your
  points (earned by chatting) and chatters typing your name during the 8s
  cheer window both tip the odds. Loser does a dramatic KO flop, winner wears
  a spinning crown for `crownSec`.
- **Races** — `!race`, then `!join` within the window. Up to ~12 cats line up
  and hop-sprint across the screen with random trip-flops + dust puffs;
  podium shows the top 3, winner gets the crown.
- **Boss battle** — `!boss` (or the boss periodically appears): a giant dark
  nub cat with a red HP bar. Every message deals 1 damage, "love" messages
  crit for 5. Chat wins → coin rain + every participant gets a golden aura.
- **Simon says** — fires automatically between other games: "SIMON SAYS:
  hop!/sit!/spin!" — cats who obey get points, slackers faint.

Chatting earns points (localStorage, `nubcat_points_v1`), which feed duel odds
and show in the debug HUD. Turn everything off with `?games=0`.

## Files

```
index.html        shell + bubble/game CSS + error banner
src/main.js       boot, render loop, HUD, camera shake
src/scene.js      transparent three.js stage, camera, lights, ground bounds
src/cat.js        Cat class: Hermes state machine driving the FBX rig
src/manager.js    spawn/recycle, bubbles, hearts, celebrations, separation
src/games.js      GameDirector: duels, races, boss battles, simon says
src/fx.js         shared particles (stars, coins, dust) + screen shake
src/points.js     localStorage points per viewer
src/chat.js       anonymous Twitch IRC-over-WebSocket client
src/mock.js       fake chat for testing (also fires game commands)
src/config.js     URL-param config
tools/verify.mjs  headless-Chrome real-time verification driver
tools/games-test.mjs  programmatic exercise of every mini game
assets/           cat.fbx + texture.png
```

## Notes

- Requires internet at runtime: three.js loads from jsdelivr CDN.
- Verified headless: 21 pets @ ~57 fps in SwiftShader (software GL); real GPUs
  will do much better. Zero console errors.
