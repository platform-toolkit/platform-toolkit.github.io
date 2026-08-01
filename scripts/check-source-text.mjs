#!/usr/bin/env node
/**
 * Keeps invisible characters out of tracked text files.
 *
 * WHY THIS EXISTS
 *
 * A raw NUL byte reached `apps/web/src/platform-targets/view.ts`, used as the
 * separator in a composite cache key. It was legal JavaScript, so `tsc` was
 * happy; it sat inside a template literal, so Prettier and ESLint preserved it
 * without comment; and the tests passed, because a NUL separator works
 * perfectly well as a separator. Nothing in `verify` had anything to say.
 *
 * What it broke was review. Git classifies a file containing a NUL as binary,
 * so `git diff` stops printing that file's contents -- for that change and for
 * every change to it afterwards. In a repository whose safety story is that a
 * person reads the diff, one invisible byte turns a source file into an opaque
 * blob, permanently and silently.
 *
 * The other characters here are the same problem with sharper teeth. Bidi
 * overrides let source that a reviewer reads one way compile the other way
 * round, which is the Trojan Source class of attack; zero-width characters hide
 * inside identifiers so two distinct names look identical on screen. This
 * project renders published data from an upstream source, so text arriving from
 * elsewhere and landing in a file is an ordinary event here.
 *
 * WHAT IS ALLOWED
 *
 * Tab and newline, because they are how a text file is shaped. Everything else
 * in the C0 range and the invisible ranges is rejected wherever it appears
 * literally. Escape spellings are untouched: a backslash-u sequence is ordinary
 * printable ASCII in the file, which is the whole point. A separator that has
 * to be spelled is a separator a reader can see.
 *
 * The classifier below is written with numeric code points rather than regular
 * expressions holding the characters themselves, so that this file can describe
 * what it rejects without containing any of it.
 *
 * A byte-order mark is rejected too. Nothing here needs one, and a stray BOM at
 * the head of a JSON file is a syntax error to some readers and invisible to
 * others.
 *
 * USAGE
 *
 *   node scripts/check-source-text.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Files whose bytes are not meant to be read as text. Kept in step with the
 * same list in `scan-prohibited-references.mjs` by hand rather than shared: the
 * two scripts answer different questions, and one list would invite one of them
 * to grow an exclusion the other should not have.
 */
const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|zip|gz|br|pdf|mp4|webm|wasm)$/i;

const MAX_SCANNED_BYTES = 5 * 1024 * 1024;

const TAB = 0x09;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const UNIT_SEPARATOR = 0x1f;
const DELETE = 0x7f;

/**
 * What is wrong with this character, or `null` if nothing is.
 *
 * The name is what gets reported. The character itself never is: a terminal
 * would either swallow it or act on it, and "there is an invisible character
 * here" printed invisibly helps nobody.
 */
function forbiddenName(codePoint) {
  if (codePoint === TAB || codePoint === NEWLINE) return null;

  // Named on its own so the message can point at the likely cause -- a file
  // that arrived with Windows line endings -- rather than reading as damage.
  if (codePoint === CARRIAGE_RETURN) return 'carriage return (CRLF line ending)';

  if (codePoint <= UNIT_SEPARATOR || codePoint === DELETE) return 'control character';

  // Bidirectional marks, embeddings, overrides, and isolates: Trojan Source.
  if (codePoint === 0x200e || codePoint === 0x200f) return 'bidirectional override';
  if (codePoint >= 0x202a && codePoint <= 0x202e) return 'bidirectional override';
  if (codePoint >= 0x2066 && codePoint <= 0x2069) return 'bidirectional override';

  // Zero-width space, non-joiner, joiner, and word joiner.
  if (codePoint >= 0x200b && codePoint <= 0x200d) return 'zero-width character';
  if (codePoint === 0x2060) return 'zero-width character';

  if (codePoint === 0xfeff) return 'byte-order mark';

  // Line and paragraph separators. These once terminated a JavaScript line, and
  // they still split text unpredictably from one tool to the next.
  if (codePoint === 0x2028 || codePoint === 0x2029) return 'unicode line separator';

  return null;
}

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean);

const violations = [];
let scanned = 0;

for (const relativePath of trackedFiles) {
  if (BINARY_EXTENSIONS.test(relativePath)) continue;

  const absolutePath = join(repoRoot, relativePath);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch {
    continue; // Staged for deletion.
  }
  if (!stats.isFile() || stats.size > MAX_SCANNED_BYTES) continue;

  scanned += 1;

  // Split on newline only. Splitting on a general line break would consume the
  // very separators being looked for.
  const lines = readFileSync(absolutePath, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (let column = 0; column < line.length; column += 1) {
      const codePoint = line.charCodeAt(column);
      const name = forbiddenName(codePoint);
      if (name === null) continue;
      const spelled = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
      violations.push(`${relativePath}:${index + 1}:${column + 1}  ${name} (${spelled})`);
      // One report per line. A file saved with CRLF endings would otherwise
      // produce a finding per line and bury everything else.
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('Source text check FAILED.\n');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  console.error(
    [
      '',
      'These characters are invisible in an editor and change what a reviewer',
      'sees. A NUL also makes git treat the whole file as binary, so its diff',
      'stops being printed -- for this change and for every later one.',
      '',
      'If the character is genuinely wanted, spell it as a backslash-u escape.',
      'The escape is printable ASCII in the file, so the file stays reviewable',
      'and the intent is stated rather than left to be inferred.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`Source text check passed: ${scanned} files, no invisible characters.`);
