# Changelog

## V3 — model comp-calibrated-3 (2026-11-28, prepared, not submitted)

- **Model:** the 7-day momentum credit is capped at +60% (`growth_cap_pct`
  100 → 60), the same line where the risk filter starts calling a rise
  parabolic. V2 paid its maximum growth multiplier (×1.6) to six board
  rows at or past that line, including a +4,448% week that is a listing
  artifact, not demand. Values below +60% are unchanged.
- **Risk filter:** a protocol whose record carries no seven-day change
  now earns an unverified-momentum flag (+10) instead of being scored
  as a flat week (2 of the 198 board rows).
- **Farm plans:** every plan gains a seventh step that answers the
  protocol's own risk record — halve-and-wait on an outflow shock,
  tranche against a parabolic spike, size down for thin liquidity,
  learn a single chain first, or a monthly re-check for a clean row —
  each with its cost and time like the other six.
- **Dashboard:** a risk-tier filter (show at most Low / Moderate /
  Elevated / High) beside the existing search, category, chain and
  scope filters; a "Per $1 TVL" column showing the multiple the model
  actually applied to each row; the method text now lists the
  unverified-momentum flag so the page and `lib/risk.ts` agree.
- **Summary:** `entry.txt` now names the risk scoring as well as the
  board and the top row, still inside the 1–140 character gate.
- **Screenshots:** re-captured from the updated dashboard (board,
  detail of a flagged top-10 row, filtered view using the new
  risk filter).

## V2 — model comp-calibrated-2 (2026-11-26, submitted)

- Risk filter (`lib/risk.ts`): authority (wrapped-product proxy),
  concentration, liquidity and momentum-anomaly scoring, a priority
  watch list, and risk wired into the board, the dashboard and
  `state.json`; the one-line summary in `entry.txt`; README build log.

## V1 (2026-11-26, submitted, superseded by V2 the same day)

- Comp-calibrated implied-value model (per-category median mcap/TVL
  from the snapshot's own live-token protocols, adjusted for 7-day
  momentum, age and chain breadth), wrapped-product screen mirroring
  the house watchlist, 198-row board with six-step farm plans, and a
  filterable dashboard with per-protocol detail views.
