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
import { boardIssue, buildBoard, buildRadarData, dataScript, parseSnapshot } from './lib/model.ts';
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

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const board = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model built a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(buildRadarData(snapshot, board)));

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
process.stdout.write(`token radar: ${board.length} rows, dossier ${dossier.length} bytes, wrote ${outDir}\n`);
