#!/usr/bin/env node
/**
 * Points git at the repository's tracked hooks directory.
 *
 * Hooks in `.git/hooks` are not cloned, so a hook that only lives there protects
 * exactly one working copy and silently protects nothing everywhere else. Setting
 * `core.hooksPath` to a tracked directory during `pnpm install` means a fresh
 * clone is protected as soon as anyone installs dependencies.
 *
 * Failing here must never break an install: CI checkouts, published tarballs, and
 * dependency-only installs can all legitimately lack a git directory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(repoRoot, '.git'))) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
} catch {
  console.warn(
    '[hooks] Could not set core.hooksPath; commit identity checks will not run locally.',
  );
}
