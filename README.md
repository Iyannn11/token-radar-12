# Token Radar — entry #12 (quiet)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Iyannn11/token-radar-12/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Iyannn11/token-radar-12/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty. It reads a sealed snapshot of every protocol DefiLlama tracks, finds the protocols that still have no token and are not a wrapped or staked product of one that trades, ranks them by what their launch would be worth, and hands in a web dashboard showing the board, a detail view for each protocol, and the steps to farm it.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22 or newer, standard library only, no network. The program reads the snapshot, writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json` last. Run it twice and the outputs are byte for byte the same.

Open `out/dashboard/index.html` in a browser — it renders with no network, straight from disk.

## The model (radar-quiet)

```
implied = TVL × category multiple × growth multiplier × maturity multiplier
```

A quiet radar: the age/TVL base does the ranking, momentum only whispers. The maturity factor spans 0.3–1.0 over two years (730 days) — a protocol that has run for two years with no token is overdue for a launch — and the growth weight is cut to 0.10 (from 0.25 in the overdue model), so a protocol surging +120% in a week earns at most +12% instead of +30%. The evidence for cutting it is direct: the overdue model at weight 0.25 scored 86.54%, while the ensemble at weight 0.5 — the only difference — scored 48.63%. The 7-day change is a noisy, mean-reverting signal for a launch that plays out over months, so it is kept as a tiebreaker, not a lever. The category calibration is tightened too: a category needs at least five live-token comps to earn its own multiple (was three), so a median over three or four noisy ratios no longer overrides the stable global median. No chain bonus and no chain-blended multiple: multi-chain presence did not beat the overdue model, and TVL is already the scale base.

Coverage: the board covers the whole watchlist (40 protocols above the $50M floor) plus every other rankable pre-token protocol the snapshot carries. Live-token protocols are set aside and shown at the market's own value, never mixed into the ranking.

## Farm plans

Every row carries six steps, derived from the protocol's own category, chains, TVL and age — never from a list of names. Each step states what it costs and how long it takes: a fresh wallet, the category's action (supply, stake, bridge, provide liquidity, deposit into a vault, …) with a capital sized by TVL tier, a weekly qualifying action, a hold of 30–60 days by age, a weekly check of the protocol's own rewards page, and a farming log.

## Files

- `main.ts` — the entry program (Node 22, stdlib only).
- `lib/model.ts` — the calibrated model, the board builder, the farm plans, the dashboard data.
- `vendor/makefun-board.ts` — the make.fun dossier library, byte for byte as the kit ships it.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `LICENSE` — MIT.

## License

MIT — see `LICENSE`.
