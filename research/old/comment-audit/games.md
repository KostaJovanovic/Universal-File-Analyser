# games comment audit

## assets/js/games/boss.js

- **Line 3-4** — `mothership on wave 5, serpent on wave 7, megastructure on wave 10` → Wrong wave numbers for two of the three scripted bosses. `bossTypeForWave()` (lines 33-38) and `isBossWave()` (line 21) put the serpent on wave **8** and the megastructure on wave **11**, not 7 and 10. (The module's own line 20 comment correctly says "5 / 8 / 11".) → **Fix:** `mothership on wave 5, serpent on wave 8, megastructure on wave 11`.
- **Line 7** — `the first boss beaten unlocks the optional Wave 10 start` → Beating a boss sets `g.bossEverBeaten` (e.g. line 150-153) and reveals the start-wave picker, whose ceiling is `maxStartWave()` (= `bestWave - 2`, state.js line 34), not a fixed "Wave 10". → **Fix:** `the first boss beaten unlocks the optional start-wave picker`.
- **Line 535** — `launch small UFOs on a timer, capped at 4 of its own alive at once` → The alive-UFO cap is checked as `< 6` (line 539), so the cap is 6, not 4. → **Fix:** `...capped at 6 of its own alive at once`.

## assets/js/games/ufos.js

- **Line 2-4** — `a teal reward saucer (destructible, drops a power-up) and a magenta ambient escort (indestructible, ...)` → Colours are swapped. config.js defines `UFO_REWARD_COLOR = '#ff4dd2'` (magenta) and `UFO_AMBIENT_COLOR = '#56d4dd'` (teal), and `makeUfo()` (line 36) assigns reward→`UFO_REWARD_COLOR`, ambient→`UFO_AMBIENT_COLOR`. So the reward saucer is magenta and the ambient escort is teal. → **Fix:** `a magenta reward saucer (destructible, drops a power-up) and a teal ambient escort (indestructible, ...)`.

## assets/js/games/state.js

- **Line 33** — `Highest wave you may start a run on: half your best-ever wave (floored), at least 1.` → The code is `Math.max(1, (g.bestWave || 0) - 2)` (line 34) - it subtracts 2 from the best wave, it does not halve it. → **Fix:** `Highest wave you may start a run on: your best-ever wave minus 2, at least 1.`

## assets/js/games/asteroids.js

- **Line 367-368** — `the ceiling is half your best-ever wave (maxStartWave)` → Same mismatch as state.js: `maxStartWave()` returns `bestWave - 2`, not half. → **Fix:** `the ceiling is your best-ever wave minus 2 (maxStartWave)`.

## assets/js/games/leaderboard.js

- **Line 168** — `prefill with the name used in the last day` → `rememberedName()` (lines 16-22) returns the stored name with no time check, and its own line 19 comment says `never expires`. The prefill is not limited to the last day. → **Fix:** `prefill with the remembered name (kept forever)`.

## assets/js/games/config.js — no issues
## assets/js/games/drones.js — no issues
## assets/js/games/geometry.js — no issues
## assets/js/games/input.js — no issues
## assets/js/games/menus.js — no issues
## assets/js/games/render.js — no issues
## assets/js/games/style.js — no issues
## assets/js/games/update.js — no issues
## assets/js/games/weapons.js — no issues
## assets/js/games/world.js — no issues
