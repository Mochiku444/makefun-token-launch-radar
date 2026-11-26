// Token launch radar: the valuation model.
//
// One sealed DefiLlama snapshot goes in; one ranked board of pre-token
// protocols comes out. The board's implied values are calibrated on the
// snapshot itself: the protocols in it that already have a token show
// what the market pays per dollar of TVL in each category, and a
// pre-token protocol is priced off the median of its own category,
// then adjusted for its seven-day TVL momentum, for how long it has
// run without a token, and for how many chains it spans. No protocol
// name is ever special-cased: one function prices every row, and the
// dashboard states the whole method next to the board it produced.

import { assessRisk, type RiskAssessment } from './risk.ts';

export type { RiskAssessment } from './risk.ts';

/** One protocol record, exactly as the sealed snapshot carries it. */
export interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** Raised when the snapshot is not shaped like the sealed input. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeDollars(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value !== '-' ? value : null;
}

/** Parse and normalise the snapshot text; throws SnapshotError on a bad shape. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  if (!isRecord(raw) || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new SnapshotError('snapshot lacks the protocols or watchlist array');
  }
  const protocols: ProtocolRecord[] = raw.protocols.filter(isRecord).map((p) => ({
    slug: String(p.slug ?? ''),
    name: String(p.name ?? ''),
    category: nullableText(p.category),
    chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
    tvl_usd: wholeDollars(p.tvl_usd),
    change_7d: nullableNumber(p.change_7d),
    mcap_usd: nullableNumber(p.mcap_usd),
    listed_at: nullableText(p.listed_at),
    gecko_id: nullableText(p.gecko_id),
    symbol: nullableText(p.symbol),
  }));
  return {
    as_of: String(raw.as_of ?? ''),
    source: String(raw.source ?? ''),
    floor_usd: wholeDollars(raw.floor_usd),
    protocols,
    watchlist: raw.watchlist.filter((s): s is string => typeof s === 'string'),
  };
}

/** True when the record shows no token: no market cap, no Gecko id, no symbol. */
export function recordsNoToken(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Names that end in a version marker are pools of another protocol, not launches. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Categories that are wrapped, staked or bridged products of a token that
 * already trades: the same screen the house watchlist applies. WBTC is
 * the standing example: its record shows no token, but it is a wrapped
 * product of one that trades, so a launch radar must not rank it.
 */
const WRAPPED_PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * A protocol the board may rank as an early find: it records no token
 * and passes the wrapped-product screen above. (Watchlist rows are
 * always carried, screened or not: covering them is the gate's rule.)
 */
export function isRankable(p: ProtocolRecord): boolean {
  return (
    recordsNoToken(p) &&
    !WRAPPED_PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED_NAME.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

const DAY_MS = 86_400_000;

/** Whole days between the day DefiLlama first tracked the protocol and the snapshot day. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The category calibration the snapshot's live-token protocols support. */
export interface Calibration {
  /** Median market-cap per TVL dollar across every live-token protocol. */
  globalMultiple: number;
  /** Per-category medians, only where at least MIN_COMPS live protocols price it. */
  byCategory: Map<string, { multiple: number; comps: number }>;
}

const MIN_COMPS = 4;
const MULTIPLE_MIN = 0.04;
const MULTIPLE_MAX = 2.5;

function clampMultiple(value: number): number {
  return Math.min(MULTIPLE_MAX, Math.max(MULTIPLE_MIN, value));
}

/**
 * Learn what a TVL dollar is worth from the snapshot's own market: every
 * protocol that already trades contributes its market-cap/TVL ratio, and
 * each category keeps its median when enough of its protocols trade.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const bucket = ratiosByCategory.get(key) ?? [];
    bucket.push(ratio);
    ratiosByCategory.set(key, bucket);
  }
  const byCategory = new Map<string, { multiple: number; comps: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length >= MIN_COMPS) {
      byCategory.set(category, { multiple: clampMultiple(median(ratios)), comps: ratios.length });
    }
  }
  return { globalMultiple: all.length > 0 ? clampMultiple(median(all)) : 0.2, byCategory };
}

/** The model's adjustment weights, stated on the dashboard beside the board. */
export const WEIGHTS = {
  growth_weight: 0.6,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  maturity_base: 0.72,
  maturity_span: 0.28,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.015,
  breadth_max_extra_chains: 12,
} as const;

/** The model's version label, printed on the dashboard. */
export const MODEL_VERSION = 'comp-calibrated-2';

/** How many board rows the radar carries: the watchlist plus the early field. */
export const BOARD_ROWS = 320;

/** One protocol's priced row, before ranks are assigned. */
export interface Scored {
  protocol: ProtocolRecord;
  implied: number;
  baseMultiple: number;
  comps: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  ageDays: number | null;
}

/** Price one protocol from the calibration and its own snapshot figures. */
export function scoreProtocol(p: ProtocolRecord, asOf: string, calibration: Calibration): Scored {
  const category = p.category ?? 'Uncategorised';
  const comp = calibration.byCategory.get(category);
  const baseMultiple = comp?.multiple ?? calibration.globalMultiple;
  const growthPct = Math.min(
    WEIGHTS.growth_cap_pct,
    Math.max(WEIGHTS.growth_floor_pct, p.change_7d ?? 0),
  );
  const growthMult = 1 + (growthPct / 100) * WEIGHTS.growth_weight;
  const ageDays = ageInDays(asOf, p.listed_at);
  const ageForModel = ageDays ?? WEIGHTS.unknown_age_days;
  const maturityMult =
    WEIGHTS.maturity_base +
    (Math.min(Math.max(ageForModel, 0), WEIGHTS.maturity_days) / WEIGHTS.maturity_days) * WEIGHTS.maturity_span;
  const breadthMult = 1 + WEIGHTS.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), WEIGHTS.breadth_max_extra_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * baseMultiple * growthMult * maturityMult * breadthMult));
  return {
    protocol: p,
    implied,
    baseMultiple,
    comps: comp?.comps ?? 0,
    growthPct,
    growthMult,
    maturityMult,
    breadthMult,
    ageDays,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/** Capital a farm position on this protocol reasonably needs, scaled to its TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** Days to keep a qualifying position open, from the protocol's own age. */
function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 90;
  if (ageDays < 365) return 60;
  if (ageDays < 730) return 45;
  return 30;
}

/** The core on-chain action for a category, in words a farmer can follow. */
function coreAction(p: ProtocolRecord, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply ${money(capital)} of USDC as collateral in ${name} on ${chain}, then borrow a small amount against it and repay, so the wallet shows both sides of the market`;
  if (c.includes('dex') || c.includes('aggregator'))
    return `Swap ${money(capital)} across three pairs on ${name} on ${chain} and add ${money(Math.round(capital / 2))} to its deepest stable pool`;
  if (c.includes('yield') || c.includes('farm'))
    return `Deposit ${money(capital)} into the highest-volume vault on ${name} on ${chain} and leave the receipt tokens in the wallet`;
  if (c.includes('bridge') || c.includes('canonical'))
    return `Bridge ${money(capital)} of USDC to ${chain} through ${name}, then spend part of it in one app on the far side instead of bridging straight back`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake ${money(capital)} of the native asset through ${name} on ${chain} and keep the liquid receipt token it issues`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Post ${money(capital)} of USDC as margin on ${name} and trade one small hedged position, long and short the same asset, to build volume without direction risk`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Allocate ${money(capital)} into a ${name} vault on ${chain} and keep the vault shares untouched for the full hold`;
  if (c.includes('rwa'))
    return `Mint ${money(capital)} of the tokenised asset ${name} offers on ${chain} and hold it past one full yield cycle`;
  if (c.includes('stable'))
    return `Mint or deposit ${money(capital)} of the stable asset through ${name} on ${chain} and route one payment through it`;
  if (c.includes('insurance'))
    return `Buy ${money(capital)} of cover from ${name} on ${chain} for a position you already hold elsewhere and keep the policy to expiry`;
  if (c.includes('prediction'))
    return `Fund ${money(capital)} on ${name} and take small positions in five separate markets rather than one large bet`;
  if (c.includes('nft') || c.includes('gaming'))
    return `Spend ${money(capital)} inside ${name} on ${chain} across several sessions: one purchase, one listing and one in-app action`;
  return `Deposit ${money(capital)} of USDC into ${name} on ${chain} and keep the position open and untouched`;
}

/**
 * The farm plan for one protocol: six concrete steps, each carrying its
 * cost and its time, derived from the protocol's own category, chains,
 * TVL and age. Nothing here names a protocol the snapshot does not.
 */
export function farmPlan(p: ProtocolRecord, ageDays: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(ageDays);
  const gas = capital >= 250 ? 12 : capital >= 100 ? 8 : 5;
  const steps: string[] = [
    `Start with a fresh wallet funded with ${money(capital + gas)} on ${chain} and nothing else, so the farm is the wallet's whole history. Cost: ${money(gas)} of gas to fund and set up. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: ${money(capital)} of capital plus about ${money(gas)} of gas. Time: 20 minutes to set up.`,
  ];
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push(
      `Repeat a smaller ${money(Math.round(capital / 2))} position on ${second}, the protocol's second chain, so activity is not confined to one network. Cost: ${money(Math.round(capital / 2))} of capital plus about ${money(4)} of gas. Time: 15 minutes.`,
    );
  } else {
    steps.push(
      `Return once a week and make one small extra transaction in ${p.name} (a partial rebalance or a second deposit of ${money(10)}), so the wallet reads as a returning user, not a one-off. Cost: about ${money(2)} of gas a visit. Time: 5 minutes a week for ${hold} days.`,
    );
  }
  steps.push(
    `Hold the position untouched for at least ${hold} days; snapshots for points and airdrops reward duration, and closing early is the most common way farmers disqualify themselves. Cost: the opportunity cost of ${money(capital)} for ${hold} days. Time: ${hold} days.`,
    `Use the protocol's second feature once (a different pool, market or vault than the first deposit), because multi-product users are the cohort most launches reward first. Cost: about ${money(5)} of gas. Time: 15 minutes.`,
    `Keep records as you go: save each transaction hash and a screenshot of the open position, so any later claim or appeal can be evidenced in minutes. Cost: nothing. Time: 5 minutes a week.`,
  );
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  risk: RiskAssessment;
  farm_steps: string[];
}

/** Build the ranked board: every watchlist slug, then the early field by value. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const calibration = calibrate(snapshot);
  const bySlugMap = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, ProtocolRecord>();
  for (const slug of snapshot.watchlist) {
    const p = bySlugMap.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => scoreProtocol(p, snapshot.as_of, calibration))
    .sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1))
    .slice(0, Math.max(0, BOARD_ROWS - chosen.size));
  for (const s of early) chosen.set(s.protocol.slug, s.protocol);
  const scored = [...chosen.values()].map((p) => scoreProtocol(p, snapshot.as_of, calibration));
  scored.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.protocol.slug,
    name: s.protocol.name,
    category: s.protocol.category,
    chains: s.protocol.chains,
    tvl_usd: s.protocol.tvl_usd,
    change_7d: s.protocol.change_7d,
    listed_at: s.protocol.listed_at,
    age_days: s.ageDays,
    token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(s.protocol.slug),
    implied_value_usd: s.implied,
    model: {
      base_multiple: round4(s.baseMultiple),
      comps: s.comps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
    },
    risk: assessRisk(s.protocol, snapshot.as_of),
    farm_steps: farmPlan(s.protocol, s.ageDays),
  }));
}

/** The first gate problem with a board, or null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `row names a protocol the snapshot does not: ${r.slug}`;
  for (const slug of snapshot.watchlist) if (!slugs.has(slug)) return `watchlist slug missing from the board: ${slug}`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `ranks are not exactly 1..N at row ${i}`;
    if (i > 0 && board[i - 1]!.implied_value_usd < r.implied_value_usd) return 'implied value rises as rank ascends';
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `bad implied value at ${r.slug}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `farm plan length out of range at ${r.slug}`;
    for (const step of r.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `farm step of ${len} chars at ${r.slug}`;
    }
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd))
    return 'every implied value is the same: the board ranks nothing';
  return null;
}

/** A live-token protocol, shown apart from the board at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** Everything the dashboard renders: board, live set, calibration and method. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  weights: typeof WEIGHTS;
  global_multiple: number;
  calibration: { category: string; multiple: number; comps: number }[];
  counts: { protocols: number; watchlist: number; board: number; early: number; live: number };
  /** The priority watch list: the highest implied values at Low or Moderate risk. */
  priority: { slug: string; name: string; implied_value_usd: number; risk_score: number; risk_tier: string }[];
  /** How the board spreads across the risk tiers. */
  risk_tiers: { Low: number; Moderate: number; Elevated: number; High: number };
  rows: (BoardRow & { farm_steps: string[] })[];
  live: LiveRow[];
}

/** Assemble the dashboard's data from the snapshot and the built board. */
export function buildRadarData(snapshot: Snapshot, board: BoardRow[]): RadarData {
  const calibration = calibrate(snapshot);
  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
    }));
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    weights: WEIGHTS,
    global_multiple: round4(calibration.globalMultiple),
    calibration: [...calibration.byCategory.entries()]
      .map(([category, v]) => ({ category, multiple: round4(v.multiple), comps: v.comps }))
      .sort((a, b) => b.comps - a.comps),
    counts: {
      protocols: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      board: board.length,
      early: board.filter((r) => !r.on_watchlist).length,
      live: live.length,
    },
    priority: board
      .filter((r) => r.risk.tier === 'Low' || r.risk.tier === 'Moderate')
      .slice(0, 5)
      .map((r) => ({
        slug: r.slug,
        name: r.name,
        implied_value_usd: r.implied_value_usd,
        risk_score: r.risk.score,
        risk_tier: r.risk.tier,
      })),
    risk_tiers: {
      Low: board.filter((r) => r.risk.tier === 'Low').length,
      Moderate: board.filter((r) => r.risk.tier === 'Moderate').length,
      Elevated: board.filter((r) => r.risk.tier === 'Elevated').length,
      High: board.filter((r) => r.risk.tier === 'High').length,
    },
    rows: board,
    live,
  };
}

/** The dashboard's data as a script: window.RADAR = {...}; */
export function dataScript(data: RadarData): string {
  return `window.RADAR = ${JSON.stringify(data)};\n`;
}
