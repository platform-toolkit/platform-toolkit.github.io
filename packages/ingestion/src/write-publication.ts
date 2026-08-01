import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { ArtifactPathSchema } from '@platform-toolkit/data-contracts';
import * as v from 'valibot';

import type { PublicationPlan, PublishedFile } from './publication.js';

/**
 * Writing a plan to disk.
 *
 * Everything interesting already happened in `planPublication`. This is the
 * part with no decisions in it, kept separate so that the decisions can be
 * tested without a temporary directory and so that the only code touching the
 * filesystem is this small.
 */

/** What a completed write produced, for the build log. */
export interface WriteSummary {
  readonly directory: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

/**
 * Writes every file in the plan under `directory`, creating parent directories
 * as needed.
 *
 * Files are written in plan order, so the index lands after the artifacts it
 * names. On a filesystem that ordering is mostly cosmetic; it matters when the
 * directory is uploaded by something that streams it in order, and costs
 * nothing to preserve here.
 *
 * @throws {TypeError} if a path in the plan would write outside `directory`.
 */
export async function writePublication(
  plan: PublicationPlan,
  directory: string,
): Promise<WriteSummary> {
  const root = resolve(directory);
  let totalBytes = 0;

  for (const file of plan.files) {
    const destination = resolveWithin(root, file);
    await mkdir(dirname(destination), { recursive: true });
    // `wx` rather than the default: a plan holds each path once, so a file that
    // already exists means either a collision between two artifacts or a stale
    // output directory. Both are worth failing on rather than overwriting, and
    // an overwrite here would leave a file the index does not describe.
    await writeFile(destination, file.contents, { encoding: 'utf8', flag: 'wx' });
    totalBytes += Buffer.byteLength(file.contents, 'utf8');
  }

  return { directory: root, fileCount: plan.files.length, totalBytes };
}

/**
 * Re-validates the path and resolves it under the root.
 *
 * The schema already ran when the plan was built, and it runs again here. A
 * path is the one value in this pipeline that turns into a write, so the check
 * belongs next to the write rather than only next to the code that happens to
 * call it today. The containment check afterwards is belt to that braces: it
 * holds whatever the schema does or does not catch.
 */
function resolveWithin(root: string, file: PublishedFile): string {
  // `meta.json` satisfies the same schema as a hashed artifact path, so there
  // is no exception to make for it.
  // `safeParse` rather than `v.is`, whose type predicate narrows the failing
  // branch to `never` and leaves the message unable to name the path.
  if (!v.safeParse(ArtifactPathSchema, file.path).success) {
    throw new TypeError(`Refusing to write "${file.path}": not a publishable path.`);
  }

  const destination = resolve(join(root, file.path));
  const within = relative(root, destination);
  if (within === '' || within.startsWith('..') || within.startsWith(sep)) {
    throw new TypeError(
      `Refusing to write "${file.path}": it resolves outside the output directory.`,
    );
  }
  return destination;
}
