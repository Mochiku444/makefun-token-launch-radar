# makefun-token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mochiku444/makefun-token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mochiku444/makefun-token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's token-radar-01 bounty. The program (`main.ts`, Node 22, standard library only) reads the sealed DefiLlama snapshot of 758 protocols and ranks 198 that record no token — all 40 on the house watchlist plus 158 early finds — by an implied token value. The model is calibrated on the snapshot itself: the median market-cap/TVL ratio of each category's live-token protocols, adjusted for 7-day TVL momentum, for how long each protocol has run with no token, and for chain breadth. Wrapped, staked and bridged products of tokens that already trade (the WBTC trap) are screened out with the same rules the house watchlist uses. Every row carries a six-step farm plan with costs and times, and the static dashboard in `dashboard/` renders the board with search, category/chain filters, four sort orders, a per-protocol detail view showing the full value derivation, the calibration table, and the live-token set shown apart at market value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
