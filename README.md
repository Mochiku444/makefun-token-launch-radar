# makefun-token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mochiku444/makefun-token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mochiku444/makefun-token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty. The program (`main.ts`, Node 22, standard library only) reads the sealed DefiLlama snapshot of 758 protocols and ranks 198 that record no token — all 40 on the house watchlist plus 158 early finds — by an implied token value. The model is calibrated on the snapshot itself: the median market-cap/TVL ratio of each category's live-token protocols, adjusted for 7-day TVL momentum, for how long each protocol has run with no token, and for chain breadth. Wrapped, staked and bridged products of tokens that already trade (the WBTC trap) are screened out with the same rules the house watchlist uses. Every row carries a six-step farm plan with costs and times, and the static dashboard in `dashboard/` renders the board with search, category/chain filters, four sort orders, a per-protocol detail view showing the full value derivation, the calibration table, and the live-token set shown apart at market value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

## Build log and transcripts

This entry was built by an AI agent in the open, and its make.fun submission carries the full session transcripts that wrote the code (bundled with the kit's `makefun bundle`, with the owner's name redacted; transcripts are read only by the entrant and make.fun's admins). The build, in order:

1. `makefun init` anchored the repository (drand round 34282518) and committed the MIT LICENSE; `.makefun/owner.json` names the agent wallet that signs the entry.
2. `lib/model.ts` — the comp-calibrated valuation model and farm-plan generator, written first, then revised twice: a wrapped-product screen (the WBTC trap) and the risk wiring.
3. `main.ts` — the entrypoint: sealed-snapshot ingest with clean refusals on malformed or empty input, deterministic outputs (`board.json`, `data.js`, `state.json`, and a validated 1–140 character summary in `entry.txt`), dashboard/screenshot copying, and the dossier write.
4. `dashboard/` — the board page: search, category/chain/scope filters, five sort orders (including lowest risk), per-protocol detail with the full value derivation and risk flags, the calibration table and the live-token set.
5. `lib/risk.ts` — the risk filter: authority (wrapped-product proxy), concentration, liquidity and momentum-anomaly scoring with a priority watch list.
6. `screenshots/` — captured from the running dashboard with headless Chrome at 1440×1000: the board, a detail view, and a filtered view.
7. Verified before submitting: two consecutive runs byte-identical, empty and malformed snapshots refused cleanly, and a secret scan over every tracked file and the full git history (no keys, no credentials — the signing keypair lives outside this repository and is never committed).

No API keys or secrets exist in this repository or its history; the program itself needs none — it reads only the sealed snapshot and the standard library.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
