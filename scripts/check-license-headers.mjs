#!/usr/bin/env node
/**
 * Requires every first-party source file to carry a copyright and SPDX header,
 * and can insert the missing ones.
 *
 * WHY EVERY FILE AND NOT JUST THE LICENSE FILE
 *
 * Source files travel. Somebody copies one module into their own project, or a
 * bundler inlines it, or a file turns up in a search result with no repository
 * around it. A LICENSE at the root answers the licensing question only for
 * people who arrived through the front door. The Apache License's own appendix
 * asks for the notice to be attached to each file for exactly this reason, and
 * the SPDX line is the machine-readable half -- scanners read it, and a file
 * without one is reported as unknown provenance no matter what the root says.
 *
 * WHY THE YEAR IS A CONSTANT
 *
 * One project-wide line, checked literally. Per-file years drift the moment
 * anyone edits a file without touching its header, and a header that is
 * plausibly stale is worse than a uniform one: it invites the reader to work out
 * which files were touched when, from a field that was never maintained. The
 * authoritative dates are in the git history.
 *
 * WHY DOCUMENTATION IS NOT INCLUDED
 *
 * A markdown file's licence belongs in prose a reader can see, not in an HTML
 * comment that renders as nothing. README.md and each governance file state the
 * terms in the open. Adding an invisible SPDX line to them would satisfy a
 * scanner and tell a human nothing.
 *
 * USAGE
 *
 *   node scripts/check-license-headers.mjs            check only
 *   node scripts/check-license-headers.mjs --write    insert missing headers
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

const COPYRIGHT = 'Copyright 2026 Jason Smathers';
const IDENTIFIER = 'SPDX-License-Identifier: Apache-2.0';

/** Extensions carrying first-party code, and the comment syntax each needs. */
const SYNTAX = new Map([
  ['ts', 'line'],
  ['mjs', 'line'],
  ['js', 'line'],
  ['css', 'block'],
]);

/**
 * @param {'line' | 'block'} syntax
 * @returns {string}
 */
function headerFor(syntax) {
  return syntax === 'line'
    ? `// ${COPYRIGHT}\n// ${IDENTIFIER}\n`
    : `/* ${COPYRIGHT} */\n/* ${IDENTIFIER} */\n`;
}

/**
 * Splits a leading shebang off the rest of a file.
 *
 * The header goes after it, never before: a `#!` line only works as the first
 * bytes of the file, and several scripts here are executable.
 *
 * @param {string} contents
 * @returns {{ shebang: string, body: string }}
 */
function splitShebang(contents) {
  if (!contents.startsWith('#!')) return { shebang: '', body: contents };
  const end = contents.indexOf('\n');
  if (end === -1) return { shebang: `${contents}\n`, body: '' };
  return { shebang: contents.slice(0, end + 1), body: contents.slice(end + 1) };
}

/**
 * @returns {string[]} repository-relative paths of tracked first-party source
 */
function trackedSources() {
  const patterns = [...SYNTAX.keys()].map((extension) => `*.${extension}`);
  const listed = execFileSync('git', ['ls-files', '-z', ...patterns], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return listed.split('\0').filter((path) => path !== '');
}

async function main() {
  const write = process.argv.includes('--write');
  const missing = [];
  let inserted = 0;

  for (const path of trackedSources()) {
    const extension = path.slice(path.lastIndexOf('.') + 1);
    const syntax = SYNTAX.get(extension);
    if (syntax === undefined) continue;

    const absolute = join(REPOSITORY_ROOT, path);
    const contents = await readFile(absolute, 'utf8');
    const { shebang, body } = splitShebang(contents);
    const header = headerFor(syntax);

    if (body.startsWith(header)) continue;

    if (!write) {
      missing.push(path);
      continue;
    }

    // A blank line after the header unless the file was empty, so the header
    // never fuses with a JSDoc block that documents the module rather than
    // licenses it.
    const separator = body.trimStart() === '' ? '' : '\n';
    await writeFile(absolute, `${shebang}${header}${separator}${body}`, 'utf8');
    inserted += 1;
  }

  if (write) {
    console.log(`License headers inserted into ${String(inserted)} files.`);
    return;
  }

  if (missing.length > 0) {
    console.error(
      `License header check failed. ${String(missing.length)} file(s) have no header. Run \`pnpm run licenses:headers\`:\n  ${missing.slice(0, 40).join('\n  ')}${missing.length > 40 ? `\n  ... and ${String(missing.length - 40)} more` : ''}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('License header check passed: every tracked source file carries an SPDX header.');
}

await main();
