// Token launch radar: the risk filter.
//
// Every candidate the radar ranks is also scored for risk, so the
// board can prioritise the candidates worth watching first. The
// classic launch-radar checks map onto the sealed snapshot like this:
//
//   mint/freeze authority  -> not a field the snapshot carries; the
//                             checkable proxy is whether the record is
//                             really pre-token, or a wrapped, staked or
//                             bridged product of a token that already
//                             trades (its supply is controlled
//                             elsewhere), which the authority flag
//                             catches.
//   holder concentration   -> proxied by deployment breadth: a
//                             protocol live on one chain only has its
//                             whole user base in one place.
//   liquidity status       -> TVL bands: below $10M is thin, below
//                             $50M is shallow, for a launch valuation.
//   volume anomalies       -> the 7-day TVL change: a fall of 25% or
//                             more is an outflow shock; a rise of 60%
//                             or more in a week is a parabolic spike
//                             that rarely holds; no change on record
//                             is unverified momentum, flagged, never
//                             scored as a flat week.
//
// Each flag adds fixed points; the total is the risk score, 0..100,
// and the tier names the band it falls in. The same record always
// earns the same score: nothing here reads a clock or a network.

import { ageInDays, recordsNoToken, type ProtocolRecord } from './model.ts';

/** One risk flag: its id, the points it adds, and what it means. */
export interface RiskFlag {
  id: string;
  points: number;
  detail: string;
}

/** A protocol's risk assessment. */
export interface RiskAssessment {
  score: number;
  tier: 'Low' | 'Moderate' | 'Elevated' | 'High';
  flags: RiskFlag[];
}

const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function tierFor(score: number): RiskAssessment['tier'] {
  if (score >= 75) return 'High';
  if (score >= 50) return 'Elevated';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

/** Score one protocol's risk from its snapshot record alone. */
export function assessRisk(p: ProtocolRecord, asOf: string): RiskAssessment {
  const flags: RiskFlag[] = [];
  const add = (id: string, points: number, detail: string) => flags.push({ id, points, detail });

  // Authority proxy: the record claims no token, but the protocol is a
  // wrapped, staked or bridged product of one that already trades.
  if (WRAPPED_CATEGORIES.has(p.category ?? '') || WRAPPED_WORD.test(p.name)) {
    add('authority', 35, 'wrapped, staked or bridged product of a token that already trades: its effective supply is controlled elsewhere');
  }
  if (!recordsNoToken(p)) {
    add('authority', 35, 'the record already carries a token, so this is not a launch candidate at all');
  }
  // A versioned pool belongs to another protocol's launch story.
  if (VERSIONED_NAME.test(p.name)) {
    add('version_pool', 25, 'name ends in a version marker: a pool of another protocol, not a launch of its own');
  }
  // Concentration proxy: the whole deployment sits on one chain.
  if (p.chains.length <= 1) {
    add('concentration', 15, 'deployed on a single chain: its whole user base is concentrated in one place');
  }
  // Liquidity status: TVL bands.
  if (p.tvl_usd < 10_000_000) {
    add('liquidity', 20, 'thin liquidity: under $10M of TVL behind the implied value');
  } else if (p.tvl_usd < 50_000_000) {
    add('liquidity', 10, 'shallow liquidity: under $50M of TVL behind the implied value');
  }
  // Momentum anomalies in the 7-day TVL change. An unreported change
  // is not a flat week: the record carries no momentum to verify, and
  // the filter says so instead of scoring the gap as calm.
  const change = p.change_7d;
  if (change === null) {
    add('momentum', 10, 'no seven-day change on record: the momentum behind this candidate cannot be verified');
  } else if (change <= -25) {
    add('momentum', 20, `outflow shock: TVL fell ${Math.abs(change).toFixed(1)}% in seven days`);
  } else if (change >= 60) {
    add('momentum', 10, `parabolic spike: TVL rose ${change.toFixed(1)}% in seven days, a pace that rarely holds`);
  }
  // Maturity: barely tracked, or no listing date on record.
  const age = ageInDays(asOf, p.listed_at);
  if (age === null) {
    add('maturity', 10, 'no listing date on record: the track record cannot be measured');
  } else if (age < 90) {
    add('maturity', 15, `unproven: tracked for only ${age} days`);
  }

  const score = Math.min(100, flags.reduce((sum, f) => sum + f.points, 0));
  return { score, tier: tierFor(score), flags };
}
