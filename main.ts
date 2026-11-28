// Token launch radar: the entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json, prices every
// pre-token protocol with the comp-calibrated model in lib/model.ts,
// and writes the hand-in to /output:
//   board.json    the ranked board the gate scores
//   data.js       the same board, as the dashboard's data
//   dashboard/    this repository's dashboard, copied
//   screenshots/  this repository's screenshots, copied
//   dossier.json  the judge's summary, written by vendor/makefun-board.ts
//
// The program is deterministic: two runs over the same snapshot write
// the same bytes. Outside the grader's container, MAKEFUN_OUTPUT_DIR
// stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, buildRadarData, dataScript, parseSnapshot, type RadarData } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap: the judge reads at most this many bytes of source. */
const TEXT_MAX_BYTES = 65_536;
/** The gate's screenshot caps, restated so a bad hand-in fails here first. */
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 524_288;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments, else the fallback. */
function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argument('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = argument('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Ingest: the sealed snapshot is the radar's only data source (the
// grading container has no network). A malformed or empty snapshot is
// a clean refusal with a reason, never a stack trace.
let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (error) {
  fail(`could not ingest the snapshot: ${error instanceof Error ? error.message : String(error)}`);
}
if (snapshot.protocols.length === 0) fail('the snapshot carries no protocols: nothing to rank');

const board = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model built a board the gate refuses: ${issue}`);
const radar = buildRadarData(snapshot, board);

/** One structured log line: the run's events, machine-readable. */
function log(event: string, fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

/**
 * The one-line summary of the run, for /output/entry.txt. It is built
 * from the board's own figures, shortened deterministically until it
 * fits the strict gate, and validated before anything is written:
 * 1 to 140 UTF-8 characters, never blank.
 */
export function summaryLine(data: RadarData): string {
  const top = data.rows[0];
  const topText = top === undefined ? 'no rows' : `${top.name} $${(top.implied_value_usd / 1e6).toFixed(1)}M`;
  const head =
    `Token Launch Radar ${data.as_of}: ${data.counts.board} pre-token protocols ranked, ` +
    `${data.counts.watchlist} watchlist covered`;
  // Prefer the full line: risk scoring and the model both named. Drop
  // whole segments in that order rather than cutting a word in half,
  // and only then trim to a word boundary.
  const candidates = [
    `${head}, all risk-scored; top ${topText}; model ${data.model_version}.`,
    `${head}, all risk-scored; top ${topText}.`,
    `${head}; top ${topText}; model ${data.model_version}.`,
    `${head}; top ${topText}.`,
  ];
  let line = candidates.find((c) => c.length <= 140) ?? candidates[candidates.length - 1]!;
  if (line.length > 140) {
    const cut = line.slice(0, 137);
    line = `${cut.slice(0, cut.lastIndexOf(' '))}...`;
  }
  if (line.trim().length < 1 || line.length > 140) {
    throw new Error(`summary line out of gate: ${line.length} characters`);
  }
  new TextEncoder().encode(line); // raises if the line is not UTF-8 encodable
  return line;
}

/** The run's structured state: everything a monitor needs, as JSON. */
export function stateDocument(data: RadarData): Record<string, unknown> {
  return {
    radar: 'token-launch-radar',
    model_version: data.model_version,
    as_of: data.as_of,
    source: data.source,
    counts: data.counts,
    risk_tiers: data.risk_tiers,
    priority_watch: data.priority,
    top: data.rows.slice(0, 10).map((r) => ({
      rank: r.rank,
      slug: r.slug,
      implied_value_usd: r.implied_value_usd,
      risk_score: r.risk.score,
      risk_tier: r.risk.tier,
    })),
  };
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));
writeFileSync(join(outDir, 'state.json'), `${JSON.stringify(stateDocument(radar), null, 2)}\n`);
const summary = summaryLine(radar);
writeFileSync(join(outDir, 'entry.txt'), summary);
log('board_written', { rows: board.length, watchlist: radar.counts.watchlist, summary_chars: summary.length });

/** Copy a directory's regular files into the output, skipping dot names. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > SCREENSHOT_MAX) {
  fail(`screenshots/ holds ${shots.length} images: hand in 3 (board, detail, filtered view)`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
  const bytes = statSync(join(outDir, 'screenshots', name)).size;
  if (bytes > SCREENSHOT_MAX_BYTES) fail(`screenshots/${name} is ${bytes} bytes, past the 512 KiB cap`);
}

const dossier = buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES });
writeFileSync(join(outDir, 'dossier.json'), dossier);
log('run_complete', { rows: board.length, dossier_bytes: dossier.length, out: outDir });
