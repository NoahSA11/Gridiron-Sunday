# Gridiron Sunday

A 3D broadcast-style American football game that runs in the browser on phones and computers,
with current NFL rosters for all 32 teams. Three.js r128, plain JavaScript, no build step.

**Play:** https://noahsa11.github.io/Gridiron-Sunday/

- Quick Game or a 6-week Season with standings and a 4-team playoff
- 17 offensive plays, 14 defenses, hot routes, audibles, punts and field goals with a kick meter
- Rookie / Pro / All-Pro difficulty, four quarters, timeouts, penalties, overtime and a box score
- Touch controls (multi-touch stick + buttons), keyboard and gamepad

Team names, colors and player names come from public roster data. No league logos or marks are used.

## How to play offense

Every receiver has a color and a number (1 X, 2 Z, 3 slot, 4 tight end, 5 running back).
Before the snap his route is drawn on the field in that color, and the matching icon floats over his head.

| | Phone | Keyboard | Gamepad |
| --- | --- | --- | --- |
| Snap | SNAP | Space | A |
| Change a receiver's route | tap his icon | his number, or click the icon | RB, then pick |
| Move the QB | left stick | WASD / arrows | left stick |
| Touch pass | tap the receiver's icon | tap his number | tap his button (A B X Y RB) |
| Bullet pass | hold the icon | hold the number | hold the button |
| Lead the pass | hold the stick while throwing | hold a direction while throwing | hold the stick |
| Run after the catch | SPRINT / JUKE / SPIN / DIVE | Shift / E / R / F | RT / Y / B / X |

Icons say OPEN (green), TIGHT (amber) or COVERED (red). The QB never throws on his own.

## How to play defense

| | Phone | Keyboard | Gamepad |
| --- | --- | --- | --- |
| Tackle the ball carrier (red ring) | run into him, or hold TACKLE to chase and dive | hold F | hold X |
| Knock down a pass (white circle = landing spot) | SWAT as it arrives | Space | A |
| Go for the interception | PICK as it arrives | F | X |
| Switch to the defender nearest the ball | SWITCH | Space | A |

When a pass goes up you are given the defender closest to the landing spot, and after a handoff or catch
you are switched to the nearest free defender if yours is far away. Portrait and landscape both work on phones.

## Files

| File | Module | What lives there |
| --- | --- | --- |
| `index.html` | page | Markup, the whole visual system (CSS tokens, chyron buttons, scorebug, touch controls) |
| `js/data.js` | `GS.Data` | 32 teams and colors, roster loading and caching, the rating formula, starter selection |
| `js/rosters-snapshot.js` | — | Bundled fallback roster snapshot (generated) |
| `rosters.json` | — | Live roster feed the page polls (rebuilt daily by GitHub Actions) |
| `js/audio.js` | `GS.Audio` | Procedural Web Audio: crowd bed, whistles, hits, horn, organ, UI sounds |
| `js/input.js` | `GS.Input` | Keyboard, Gamepad API, multi-touch stick and buttons, haptics, computer-vs-phone layout detection |
| `js/playbook.js` | `GS.Playbook` | Formations, 17 offensive plays, 4 special plays, 14 defenses, route diagrams |
| `js/sim.js` | `GS.Sim` | One live play: physics, blocking, ball flight, catches, tackles, fumbles, kicks, replay recording |
| `js/ai.js` | `GS.AI` | QB reads, routes, protection, rush, man/zone coverage, pursuit, runner vision, CPU play-calling |
| `js/rules.js` | `GS.Rules` | Downs, clock, scoring, PAT/2-pt, penalties, overtime, box-score stats |
| `js/season.js` | `GS.Season` | 6-week season, standings, simulated league games, 4-team playoff |
| `js/render.js` | `GS.Render` | Stadium, field, crowd shader, player rigs and animation blending, cameras, effects |
| `js/ui.js` | `GS.UI` | Every screen and HUD element |
| `js/main.js` | `GS.Game` | Game-flow state machine and main loop; difficulty table |
| `tools/build_rosters.py` | — | Converts the nflverse roster CSV into `rosters.json` (and the snapshot with `--snapshot`) |
| `test/` | — | Playwright tests (`run.js`, `flow.js`, `focus.js`, `pad.js`, `replay.js`), play-balance statistics (`balance.js`) |
| `.github/workflows/deploy.yml` | — | Daily roster refresh + GitHub Pages deploy |

## Rosters

Source: the nflverse open roster feed,
`https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_<season>.csv`.
Browsers can't fetch that CSV cross-origin, so it is converted to `rosters.json` and served next to the page.
The GitHub Actions workflow rebuilds it every day and redeploys the site; you can also run it by hand
from the Actions tab ("Refresh rosters and deploy" → Run workflow). The page loads `rosters.json` → localStorage cache → bundled snapshot.

Refresh by hand:

```bash
curl -sSL -o /tmp/r.csv https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv
python3 -I tools/build_rosters.py /tmp/r.csv .
```

## Testing

Run locally with any static server:

```bash
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/. The Playwright tests also need a local copy of Three.js:

```bash
npm pack three@0.128.0 && tar xzf three-0.128.0.tgz && cp package/build/three.min.js test/
```

```bash
node test/run.js all
```

```bash
node test/modes.js
```

```bash
node test/offense.js
```

```bash
node test/defense.js
```

```bash
node test/balance.js 30
```

## Deployment

GitHub Pages, deployed by `.github/workflows/deploy.yml` on every push to `main` and once a day.
In the repository settings, Pages → Source must be set to **GitHub Actions**.
