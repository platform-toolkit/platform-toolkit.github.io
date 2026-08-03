#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Catches a backtick inside a `css` tagged template literal.
 *
 * WHY THIS EXISTS
 *
 * A CSS comment inside `static styles = css` + backtick is the one place in this
 * codebase where the surrounding prose convention and the language disagree.
 * Every other comment in the repository quotes an identifier in backticks --
 * §5.9 asks for comments that explain why, and naming the thing being explained
 * is how they read. Inside a tagged template that same keystroke *ends the
 * template*, and everything after it is parsed as expressions.
 *
 * What that costs is not the error, it is the shape of the error. The template
 * runs on to the next backtick somewhere further down the file, and from there
 * every decorator, every `override`, and every property below it is a syntax
 * error: 273 of them in one file on the occasion that prompted this script,
 * across four files, of which exactly one line number was useful. The natural
 * response is to read the last error rather than the first, and the last error
 * is in a file that is fine.
 *
 * So this is not a new rule -- the compiler already rejects it. It is the same
 * rejection delivered as one line naming the comment, before `tsc` runs.
 *
 * HOW IT DECIDES
 *
 * It finds each tag, walks the template the way the parser does (honouring a
 * backslash-escaped backtick and skipping interpolations), and asks one
 * question of the body: does it end inside an unterminated CSS comment?
 *
 * That is the failure exactly. The stray backtick is *in a comment* -- that is
 * what the mistake is -- so the body the parser sees always breaks off between
 * a comment opener and its closer. Nothing that ends where its author meant it
 * to does.
 *
 * Two tidier-looking tests were tried first and both are wrong here:
 *
 *   - Balanced braces. The stray backtick is normally in the comment above the
 *     *first* rule, so the truncated body holds one complete rule and balances.
 *   - What follows the closing backtick (punctuation for a real template, prose
 *     for a truncated one). This works on the code and cannot be made to work
 *     on the comments: a file explaining this construct writes the construct,
 *     and no character-level rule distinguishes prose quoting a tag from a tag.
 *     It reported ten findings and no bugs, including eight in this file.
 *
 * So the check is deliberately narrow: it answers "did this template break off
 * inside a comment", not "is this valid CSS". A backtick smuggled into a CSS
 * string would slip past it, and that has never happened; a backtick in a
 * comment has happened four times in two days, because every other comment in
 * this repository quotes identifiers that way and the habit does not stop at
 * the template boundary.
 *
 * USAGE
 *
 *   node scripts/check-css-templates.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Directories with nothing hand-written in them.
 *
 * `dist` matters more than it looks: a built copy of a component holds the same
 * template, so without this every finding is reported twice and the second copy
 * points at a file nobody can fix.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  'storybook-static',
  'coverage',
  'tmp',
]);

const SOURCE_EXTENSIONS = /\.(m?[jt]s|tsx)$/;

/**
 * Every source file in the working tree.
 *
 * A walk rather than `git ls-files`, which is what the first draft used and what
 * made it pass over the very file being written: an untracked file is not in the
 * index, so a brand-new component -- the case this check exists for, since the
 * mistake is made while writing one -- was silently skipped. A check that goes
 * quiet exactly when it is needed is worse than no check, because the green line
 * is read as coverage.
 */
function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* sourceFiles(join(directory, entry.name));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
      yield join(directory, entry.name);
    }
  }
}

/**
 * Whether this file can contain the tag at all.
 *
 * A file that never imported it cannot have written one, so anything matching
 * in such a file is prose about the construct -- and the files that write most
 * about the construct are exactly the ones with no template in them: this
 * script, the narrow-layout check, a test asserting on a token. Filtering on
 * the import is what lets those keep quoting identifiers the way §5.9 asks
 * every other comment here to.
 *
 * The character class crosses newlines on purpose (it is not a dot), so a
 * multi-line import list matches too.
 */
function importsTheTag(source) {
  return /import\s+\{[^}]*\bcss\b[^}]*\}\s*from\s*'lit'/.test(source);
}

/**
 * Where each tag starts.
 *
 * The preceding character has to be a non-identifier one, or a name ending in
 * those three letters would match. A dot is excluded as well: comments across
 * this repository cite stylesheets by name, and a quoted tokens dot c-s-s in
 * prose ends in exactly the characters a tag does. There is no member
 * expression by this name for the exclusion to hide.
 *
 * Matches inside comments and strings are not filtered out and do not need to
 * be. Distinguishing them needs a lexer; the comment test below throws them out
 * for free, because prose does not break off mid-comment.
 */
function* cssTags(source) {
  const pattern = /(^|[^A-Za-z0-9_$.])css`/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    yield match.index + match[0].length;
  }
}

/**
 * Whether this template body breaks off between a comment opener and a closer.
 *
 * Scans forward alternating between the two rather than counting each, because
 * the closer only counts once an opener is open: a CSS comment does not nest,
 * so a stray closer outside one is not a comment ending.
 */
function endsInsideComment(body) {
  let index = 0;
  for (;;) {
    const opened = body.indexOf('/*', index);
    if (opened === -1) return false;
    const closed = body.indexOf('*/', opened + 2);
    if (closed === -1) return true;
    index = closed + 2;
  }
}

/**
 * The index just past the template that starts at `start`, or `null` if the
 * file ends first.
 *
 * Walks rather than regexes because both things that can appear inside a
 * template -- an escaped backtick and an interpolation -- need state. An
 * interpolation is skipped by brace depth, which is enough here: these are
 * simple references (`${sharedStyles}`), and a nested template inside one would
 * be a different construct with its own reasons.
 */
function endOfTemplate(source, start) {
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '$' && source[index + 1] === '{') {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') depth -= 1;
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (character === '`') return index;
  }
  return null;
}

const violations = [];
let scanned = 0;

for (const absolutePath of sourceFiles(repoRoot)) {
  const relativePath = relative(repoRoot, absolutePath);
  const source = readFileSync(absolutePath, 'utf8');
  if (!importsTheTag(source)) continue;
  scanned += 1;

  for (const start of cssTags(source)) {
    const end = endOfTemplate(source, start);
    if (end === null) continue;
    if (!endsInsideComment(source.slice(start, end))) continue;

    const line = source.slice(0, end).split('\n').length;
    violations.push(`${relativePath}:${line}`);
  }
}

if (violations.length > 0) {
  console.error('CSS template check FAILED.\n');
  for (const violation of violations) {
    console.error(`  ${violation}  a backtick ends the css template here`);
  }
  console.error(
    [
      '',
      'A backtick inside a css tagged template ends it, whatever it is inside --',
      'including a CSS comment. Everything below is then parsed as expressions,',
      'so the compiler reports dozens of syntax errors and only the first line',
      'number points anywhere useful.',
      '',
      'Write the identifier without backticks in a CSS comment.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`CSS template check passed: ${scanned} files, no truncated css templates.`);
