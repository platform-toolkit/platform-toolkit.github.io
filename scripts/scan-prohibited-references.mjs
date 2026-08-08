#!/usr/bin/env node
// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Keeps strings that must not appear in this repository out of it -- in file
 * contents, in file paths, and in commit metadata.
 *
 * It also carries a second, unrelated check over the same walk: orphaned
 * docblocks. See ORPHANED DOCBLOCKS below. The two share a pass over every
 * tracked file and nothing else; a second walk to look at the same bytes again
 * is the only reason they are in one script.
 *
 * WHY THE LIST IS NOT COMMITTED
 *
 * A denylist of forbidden strings, committed here, would be exactly the thing it
 * exists to prevent. Hashing does not help: the candidate space is small enough
 * that a wordlist recovers the originals in seconds, so a committed digest list
 * is a committed list. The tokens therefore come from outside version control --
 * an untracked local file or an environment variable -- and this script only
 * ever holds them in memory.
 *
 * When no list is supplied the scan reports that it was skipped and exits
 * successfully. A check that is loudly absent is honest; one that silently
 * passes because its input vanished is worse than no check at all.
 *
 * That default is right for contributors and for pull requests from forks,
 * which GitHub does not give secrets to. It is wrong on the path that publishes
 * the site, where a missing list means the check did not run on the thing about
 * to go live and nobody was told. `--require-tokens` turns the skip into a
 * failure, and the deploy workflow uses it.
 *
 * WHY THIS IS A DENYLIST AND NOT AN IDENTITY ALLOWLIST
 *
 * The risk being managed is one maintainer's machine defaulting to an employer
 * email address. Requiring a single permitted address would also reject every
 * outside contributor, which is a much worse outcome than the problem it solves.
 * So commit identity is checked the same way as everything else: an email is
 * rejected only if it contains a forbidden token. Anyone else's address passes
 * untouched, because their address is not on anyone's list.
 *
 * The maintainer's own stricter requirement -- one exact address, always signed
 * -- lives in an untracked `.commit-identity.local` file that exists only on
 * that machine. See `--pending`.
 *
 * ORPHANED DOCBLOCKS
 *
 * A docblock immediately followed by another docblock. Every tool that reads
 * JSDoc takes the nearest block above a declaration, so the first one is
 * discarded and its paragraph explains a symbol nobody was asking about. It
 * happens the same way every time -- something is inserted above a declaration
 * and lands between it and its comment -- which is why this is a check and not
 * four edits.
 *
 * The signature is exact, and the indentation is most of it: two adjacent
 * lines, the first closing a block comment and holding nothing else, the second
 * opening a docblock and holding nothing else, both indented. An unindented
 * pair is a module header above a first declaration and is correct. A blank
 * line between the two is the ordinary case, and allowing one turns four
 * findings into two hundred and four.
 *
 * USAGE
 *
 *   node scripts/scan-prohibited-references.mjs                  history and worktree
 *   node scripts/scan-prohibited-references.mjs --pending        also the commit
 *                                                                about to be made
 *                                                                (pre-commit)
 *   node scripts/scan-prohibited-references.mjs --require-tokens fail if no list
 *                                                                is configured
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkPending = process.argv.includes('--pending');
const requireTokens = process.argv.includes('--require-tokens');

/** Untracked, gitignored. One token per line; `#` comments and blanks ignored. */
const LOCAL_TOKEN_FILE = '.prohibited-tokens.local';

/** Alternative source, for CI or one-off runs. Same format. */
const TOKEN_ENV_VAR = 'PTK_PROHIBITED_TOKENS';

/**
 * Untracked, gitignored, and absent for everyone but the maintainer who wants
 * it. A single line holding the exact email address this machine must commit
 * as. Its presence also turns on the signing requirement.
 */
const LOCAL_IDENTITY_FILE = '.commit-identity.local';

const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|zip|gz|br|pdf|mp4|webm|wasm)$/i;

const MAX_SCANNED_BYTES = 5 * 1024 * 1024;

const git = (args) =>
  execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    // Capture stderr rather than inheriting it. `rev-parse HEAD` is expected to
    // fail on a repository with no commits, and its error text is not a problem
    // the reader needs to see.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const gitConfig = (key) => {
  try {
    return git(['config', '--get', key]).trim();
  } catch {
    return ''; // Unset. `git config --get` exits non-zero rather than printing.
  }
};

const readLocalFile = (name) => {
  try {
    return readFileSync(join(repoRoot, name), 'utf8');
  } catch {
    return null; // Absent is the normal case for everyone but the maintainer.
  }
};

const violations = [];
const orphanedDocblocks = [];

// ---- token list ------------------------------------------------------------

/**
 * Reduces a token to the same alphanumeric-only form `tokenize` produces, so a
 * list entry written as "Some Name" also matches "some-name", "someName",
 * "SOME_NAME", and "@some-name" without the list needing every spelling.
 */
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

function loadTokenSource() {
  const fromEnv = process.env[TOKEN_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return { source: `$${TOKEN_ENV_VAR}`, raw: fromEnv };
  }
  const raw = readLocalFile(LOCAL_TOKEN_FILE);
  return raw === null ? null : { source: LOCAL_TOKEN_FILE, raw };
}

const tokenSource = loadTokenSource();

const deniedTokens = new Set(
  (tokenSource?.raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map(normalize)
    .filter((token) => token.length >= 4),
);

// Checked before any scanning, so a misconfigured publish fails in seconds
// rather than after a full build. This also catches a secret that exists but is
// empty, or one whose entries are all too short to be usable -- both of which
// otherwise look identical to success.
if (requireTokens && deniedTokens.size === 0) {
  console.error(
    [
      'Reference scan FAILED: --require-tokens was passed and no usable token list',
      'was found.',
      '',
      `Provide one through $${TOKEN_ENV_VAR} or an untracked ${LOCAL_TOKEN_FILE}.`,
      'In GitHub Actions that means a repository secret of the same name.',
      '',
      'This flag exists for the workflow that publishes the site. Skipping the',
      'scan there would mean nothing checked what is about to go live, and saying',
      'so is the whole point -- a check that quietly passes when its input is',
      'missing is worse than no check.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * Splits text into lowercase alphanumeric tokens, plus the concatenation of each
 * adjacent pair.
 *
 * The pairs are what catch a two-word name written with a space or a hyphen: the
 * separator is discarded, so "a b", "a-b", and "ab" all produce the token "ab".
 */
function* tokenize(text) {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  let previous = '';
  for (const word of words) {
    if (word === '') {
      previous = '';
      continue;
    }
    yield word;
    if (previous !== '') {
      yield previous + word;
    }
    previous = word;
  }
}

/**
 * Returns the length of the first denied token found, or null. The token itself
 * is deliberately not returned: printing it in a failure message would write it
 * into the CI log, which is the same leak by another route. A file and line
 * number is what a person needs in order to fix it anyway.
 */
function findViolation(text) {
  if (deniedTokens.size === 0) return null;
  for (const token of tokenize(text)) {
    if (token.length < 4) continue;
    if (deniedTokens.has(token)) {
      return token.length;
    }
  }
  return null;
}

// ---- the signing key -------------------------------------------------------

/**
 * The `type base64` of a public key, with the comment dropped.
 *
 * `user.signingkey` is either a literal `key::ssh-ed25519 AAAA...` or a path, and
 * a path may name either half of the pair -- git reads `<path>.pub` when handed a
 * private key -- so both are tried before giving up.
 */
function signingPublicKey(value) {
  const text = (() => {
    if (value.startsWith('key::')) return value.slice('key::'.length);
    const path = value.replace(/^~/, process.env['HOME'] ?? '~');
    for (const candidate of [path, `${path}.pub`]) {
      try {
        return readFileSync(candidate, 'utf8');
      } catch {
        continue;
      }
    }
    return null;
  })();
  if (text === null) return null;
  const [type, blob] = text.trim().split(/\s+/);
  if (type === undefined || blob === undefined || !type.startsWith('ssh-')) return null;
  return `${type} ${blob}`;
}

/** Whether the allowed signers file sanctions this key for this identity. */
function isAllowedSignerFor(allowedSigners, identity, publicKey) {
  const wanted = identity.toLowerCase();
  return allowedSigners
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .some((line) => {
      if (!line.includes(publicKey)) return false;
      const [principals] = line.trim().split(/\s+/);
      return (principals ?? '')
        .split(',')
        .some((principal) => principal.replaceAll('"', '').toLowerCase() === wanted);
    });
}

// ---- the commit about to be made (pre-commit only) -------------------------

if (checkPending) {
  // `git var` reports the identity actually about to be used, including any
  // environment override. More accurate here than reading config.
  const identityOf = (variable) => {
    const match = /^(.*?)\s*<(.*)>/.exec(git(['var', variable]).trim());
    return { name: match?.[1] ?? '', email: match?.[2] ?? '' };
  };

  const author = identityOf('GIT_AUTHOR_IDENT');
  const committer = identityOf('GIT_COMMITTER_IDENT');

  // Applies to everyone: an address or name carrying a forbidden token is
  // rejected. With no token list configured this does nothing, which is the
  // correct behaviour for a contributor who has none.
  for (const [role, identity] of [
    ['author', author],
    ['committer', committer],
  ]) {
    if (findViolation(identity.email) !== null) {
      violations.push(`pending commit: ${role} email contains a prohibited token`);
    }
    if (findViolation(identity.name) !== null) {
      violations.push(`pending commit: ${role} name contains a prohibited token`);
    }
  }

  // Applies only where the maintainer opted in by creating the file.
  const requiredIdentity = readLocalFile(LOCAL_IDENTITY_FILE)
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#'));

  if (requiredIdentity !== undefined) {
    for (const [role, identity] of [
      ['author', author],
      ['committer', committer],
    ]) {
      if (identity.email.toLowerCase() !== requiredIdentity.toLowerCase()) {
        // Echo the wrong address back only when it is safe to. The common
        // failure is precisely that it is the employer address, and printing it
        // to say "do not use this" would write it to the log anyway.
        const shown =
          identity.email === ''
            ? '<unset>'
            : findViolation(identity.email) !== null
              ? '<redacted: contains a prohibited token>'
              : `"${identity.email}"`;
        violations.push(
          `pending commit: ${role} email is ${shown}, ` +
            `but ${LOCAL_IDENTITY_FILE} requires "${requiredIdentity}"`,
        );
      }
    }

    if (gitConfig('commit.gpgsign') !== 'true') {
      violations.push(
        `pending commit: signing is off, but ${LOCAL_IDENTITY_FILE} requires it ` +
          '(git config --local commit.gpgsign true)',
      );
    }

    // Reject a key belonging to a different identity -- signing with the wrong key
    // stamps the wrong person on the commit just as surely as the wrong author
    // field does. The question is what "belonging" means, and it is deliberately
    // not the key's comment field: that is a free-text label `ssh-keygen -C`
    // rewrites at will, nothing verifies it, and one person who signs as two
    // addresses can only put one of them there. The allowed signers file is what
    // git itself checks a signature against, so it decides here too -- the key has
    // to be listed in it under the required identity. Two addresses for one person
    // is two lines naming the same key; somebody else's key is in neither.
    const signingKey = gitConfig('user.signingkey');
    const allowedSignersFile = gitConfig('gpg.ssh.allowedsignersfile');
    if (signingKey === '') {
      violations.push('pending commit: no user.signingkey is configured');
    } else if (allowedSignersFile === '') {
      violations.push(
        `pending commit: ${LOCAL_IDENTITY_FILE} requires a signing key belonging to ` +
          `"${requiredIdentity}", and there is no gpg.ssh.allowedsignersfile to check ` +
          'that against (git config --local gpg.ssh.allowedsignersfile <path>)',
      );
    } else {
      const publicKey = signingPublicKey(signingKey);
      const allowedSigners = (() => {
        try {
          return readFileSync(allowedSignersFile.replace(/^~/, process.env['HOME'] ?? '~'), 'utf8');
        } catch {
          return null;
        }
      })();

      if (publicKey === null) {
        violations.push(`pending commit: no public key could be read from ${signingKey}`);
      } else if (allowedSigners === null) {
        violations.push(`pending commit: ${allowedSignersFile} cannot be read`);
      } else if (!isAllowedSignerFor(allowedSigners, requiredIdentity, publicKey)) {
        violations.push(
          `pending commit: ${allowedSignersFile} does not list the signing key ` +
            `under "${requiredIdentity}"`,
        );
      }
    }
  }
}

// ---- commit history --------------------------------------------------------

let hasCommits = true;
try {
  git(['rev-parse', 'HEAD']);
} catch {
  hasCommits = false;
}

let commitCount = 0;

if (hasCommits && deniedTokens.size > 0) {
  // Unit separator between fields, record separator between commits. Commit
  // messages contain newlines, so no line-oriented format can parse this.
  const FIELD = '\x1f';
  const RECORD = '\x1e';
  const log = git(['log', '--all', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e']);

  for (const record of log.split(RECORD)) {
    const trimmed = record.trim();
    if (trimmed === '') continue;
    commitCount += 1;

    const [hash, authorName, authorEmail, committerName, committerEmail, ...messageParts] =
      trimmed.split(FIELD);

    for (const [field, value] of [
      ['author name', authorName],
      ['author email', authorEmail],
      ['committer name', committerName],
      ['committer email', committerEmail],
      ['commit message', messageParts.join(FIELD)],
    ]) {
      if (value && findViolation(value) !== null) {
        violations.push(`commit ${(hash ?? '').slice(0, 12)}  (prohibited token in ${field})`);
      }
    }
  }
}

// ---- orphaned docblocks ----------------------------------------------------

/**
 * A line that closes a block comment, indented, with nothing else on it.
 *
 * The leading run of whitespace is required rather than optional, because that
 * is what tells a stranded block from a module header. Both anchors matter too:
 * a closing marker with code after it is somebody's inline type cast.
 */
const CLOSES_A_BLOCK = /^[ \t]+\*\/$/;

/** Its counterpart -- an indented line that opens a docblock and nothing else. */
const OPENS_A_DOCBLOCK = /^[ \t]+\/\*\*$/;

// ---- tracked file contents -------------------------------------------------

const trackedFiles = git(['ls-files', '-z']).split('\0').filter(Boolean);

// Files actually opened, which is fewer than `trackedFiles.length`: the images,
// fonts and archives are skipped unread.
let readFiles = 0;

for (const relativePath of trackedFiles) {
  if (BINARY_EXTENSIONS.test(relativePath)) continue;

  const absolutePath = join(repoRoot, relativePath);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch {
    continue; // Staged for deletion.
  }
  if (!stats.isFile() || stats.size > MAX_SCANNED_BYTES) {
    continue;
  }

  const lines = readFileSync(absolutePath, 'utf8').split('\n');
  readFiles += 1;

  for (let index = 0; index < lines.length; index += 1) {
    // `findViolation` answers null with no list configured, so this costs
    // nothing on a contributor's machine and needs no guard of its own.
    const matchLength = findViolation(lines[index]);
    if (matchLength !== null) {
      violations.push(`${relativePath}:${index + 1}  (prohibited token, ${matchLength} chars)`);
    }

    // The line reported is the stranded block's last, because that block is the
    // one the reader has to find a home for.
    if (CLOSES_A_BLOCK.test(lines[index]) && OPENS_A_DOCBLOCK.test(lines[index + 1] ?? '')) {
      orphanedDocblocks.push(`${relativePath}:${index + 1}`);
    }
  }

  // The path itself must be clean too.
  if (findViolation(relativePath) !== null) {
    violations.push(`${relativePath}  (prohibited token in file path)`);
  }
}

// ---- report ----------------------------------------------------------------

if (violations.length > 0) {
  console.error('Reference scan FAILED.\n');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  console.error(
    [
      '',
      'Prohibited strings are intentionally not printed: naming them here would',
      'put them in the log, which is the same leak by another route.',
      '',
      'A finding in the metadata of an existing commit cannot be fixed by editing',
      'files -- the commit itself has to be rewritten, which is only realistic',
      'before it is pushed.',
      '',
    ].join('\n'),
  );
}

if (orphanedDocblocks.length > 0) {
  console.error('Docblock scan FAILED.\n');
  for (const orphan of orphanedDocblocks) {
    console.error(`  ${orphan}`);
  }
  console.error(
    [
      '',
      'Each line above ends a docblock that the next line immediately follows with',
      'another one. Every tool that reads JSDoc takes the nearest block above a',
      'declaration, so the first is discarded: the paragraph is not shown where it',
      'was written to be shown, and the reader hovering the declaration under it is',
      'handed an explanation of a different symbol.',
      '',
      'It happens when something is inserted above a declaration and lands between',
      'it and its comment. Put the stranded block back on the declaration it was',
      'written for. Where it is a heading over a run of members rather than a',
      'comment on one, make it a banner -- an ordinary block comment, not a',
      'docblock, with a blank line under it -- so nothing reads it as',
      'documentation of the member below.',
      '',
    ].join('\n'),
  );
}

if (violations.length > 0 || orphanedDocblocks.length > 0) {
  process.exit(1);
}

const contentScan =
  deniedTokens.size > 0
    ? `${trackedFiles.length} files, ${commitCount} commits, ${deniedTokens.size} tokens from ${tokenSource?.source}`
    : `skipped -- no ${LOCAL_TOKEN_FILE} and no $${TOKEN_ENV_VAR} (expected for most contributors)`;

console.log(`Reference scan passed: ${contentScan}`);
console.log(`Docblock scan passed: ${readFiles} files, none orphaned`);
