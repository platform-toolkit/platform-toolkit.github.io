// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  MeetRuleBookSchema,
  MeetRuleProfileSchema,
  type MeetRuleBook,
  type MeetRuleProfile,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import { MeetRules } from '@platform-toolkit/domain';
import * as v from 'valibot';

/**
 * Turning transcribed rulebooks into the one artifact the planner reads.
 *
 * Every profile here is a hand transcription of a federation's published rules,
 * so this file is aimed at one failure: a figure that is not what the rulebook
 * says. Nothing in it can supply, adjust, or infer a rule. It validates and it
 * refuses, and a document it will not accept is a document somebody has to go and
 * read against the source again.
 *
 * WHY THIS BUILDS A BOOK RATHER THAN A PROFILE AT A TIME
 *
 * Unlike records and classifications, the profiles ship as a single artifact
 * (see `MeetRuleBookSchema`) -- the planner's first question is which federation
 * the meet is under, so it needs the whole list before it can draw one control.
 * That makes two cross-document checks possible, and both are worth having: a
 * duplicated federation id, and an empty book. Neither is detectable from one
 * file, and both fail silently downstream -- a duplicate id resolves to whichever
 * copy the browser's lookup reaches first, which is a coin toss over which
 * federation's increment a lifter is planning against.
 *
 * WHAT IS NOT CHECKED HERE, DELIBERATELY
 *
 * Whether the figures are *true*. No program can check a transcription against a
 * PDF it is not reading; that is what the verification notes in each source
 * document and the digest in `rulebook.sha256` are for. What this can check is
 * that the figures are internally coherent -- which `MeetRules.from` does, and
 * which catches the transcription slips that produce a profile that is wrong
 * rather than merely unusual.
 */

/**
 * Where a transcription came from and when.
 *
 * The same shape the other curated documents use. `retrievedAt` is the day a
 * person read the document, not the day the build ran.
 */
const ProvenanceSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  /** The upstream document, named as it names itself. */
  document: v.pipe(v.string(), v.minLength(1)),
  url: v.pipe(v.string(), v.url()),
  sections: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
  retrievedAt: v.pipe(v.string(), v.isoTimestamp()),
});

/**
 * The pin on the exact bytes a profile was read from.
 *
 * Nothing here fetches them. `check:upstream` does, on a schedule, and reports a
 * revision the repository has not caught up with. This pair is why the rulebook
 * PDFs are not committed: a document carrying a federation's logo can be pinned
 * without being redistributed.
 */
const RulebookSchema = v.object({
  revision: v.pipe(v.string(), v.minLength(1)),
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u, 'a lowercase sha-256 digest')),
  url: v.pipe(v.string(), v.url()),
});

/**
 * The rules themselves: the published profile minus the three fields this derives.
 *
 * `id`, `label` and `source` are not in here, because they would then exist twice
 * in one file -- once at the top and once inside `rules` -- and the copy that
 * drifted would be the one on screen. They are built from `id`, `label`,
 * `provenance` and `rulebook` below.
 */
const RulesSchema = v.omit(MeetRuleProfileSchema, ['id', 'label', 'source']);

export const MeetRulesSourceDocumentSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  provenance: ProvenanceSchema,
  rulebook: RulebookSchema,
  rules: RulesSchema,
});

export type MeetRulesSourceDocument = v.InferOutput<typeof MeetRulesSourceDocumentSchema>;

/** Thrown when a transcribed rulebook is unusable. Carries every problem, not the first. */
export class MeetRulesSourceError extends Error {
  override readonly name = 'MeetRulesSourceError';

  constructor(readonly problems: readonly string[]) {
    super(`Meet rule source documents are unusable:\n  ${problems.join('\n  ')}`);
  }
}

export interface MeetRulesSourceResult {
  readonly book: MeetRuleBook;
  /** One entry per source document, so a stale rulebook is attributable. */
  readonly freshness: readonly SourceFreshness[];
}

/**
 * Validates every transcribed rulebook and produces the artifact plus its freshness.
 *
 * @throws {MeetRulesSourceError} if any document does not parse, describes rules
 *   that contradict themselves, or collides with another document's federation id.
 */
export function buildMeetRuleBook(documents: readonly unknown[]): MeetRulesSourceResult {
  if (documents.length === 0) {
    // An empty book leaves the planner's first question with no answers, and the
    // screen it draws is a form nobody can submit rather than a load failure
    // anybody would report.
    throw new MeetRulesSourceError(['no meet rule source documents were found']);
  }

  const problems: string[] = [];
  const profiles: MeetRuleProfile[] = [];
  const freshness: SourceFreshness[] = [];
  const seenIds = new Set<string>();

  for (const [index, document] of documents.entries()) {
    const parsed = v.safeParse(MeetRulesSourceDocumentSchema, document);
    if (!parsed.success) {
      // Path and expectation, never the value (§5.4). These documents are public
      // federation rules rather than personal data, but the habit is the point --
      // one adapter that prints values is one adapter somebody copies.
      problems.push(
        ...parsed.issues.map(
          (issue) =>
            `document ${String(index)}: ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
        ),
      );
      continue;
    }
    const source = parsed.output;

    if (seenIds.has(source.id)) {
      problems.push(
        `two source documents both claim the federation id "${source.id}". A lookup would ` +
          'resolve to whichever copy it reached first, which is a coin toss over which ' +
          "federation's rules a lifter plans against.",
      );
      continue;
    }
    seenIds.add(source.id);

    const candidate = {
      ...source.rules,
      id: source.id,
      label: source.label,
      source: {
        label: source.provenance.document,
        url: source.rulebook.url,
        revision: source.rulebook.revision,
        // The day the document was read is the day these rules were last checked
        // against it. Two fields for one fact would eventually disagree.
        verifiedOn: source.provenance.retrievedAt.slice(0, 'YYYY-MM-DD'.length),
      },
    };

    // Against the contract the browser reads it with, before the domain sees it.
    const contract = v.safeParse(MeetRuleProfileSchema, candidate);
    if (!contract.success) {
      problems.push(
        ...contract.issues.map(
          (issue) =>
            `built profile "${source.id}": ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
        ),
      );
      continue;
    }

    // The domain holds the coherence rules -- a lift named twice in the change
    // table, a record increment that relaxes nothing, a fourth-attempt window
    // narrower than the margin it demands. Checked here rather than only in the
    // browser because this is where the failure can name the file to edit.
    const built = MeetRules.from(contract.output);
    if (!built.ok) {
      problems.push(
        ...built.problems.map((problem) => `profile "${source.id}": ${problem.message}`),
      );
      continue;
    }

    profiles.push(contract.output);
    freshness.push({
      id: source.provenance.id,
      label: `${source.provenance.label} (${source.provenance.document} ${source.rulebook.revision})`,
      retrievedAt: source.provenance.retrievedAt,
      // Always `ok`. Whether upstream has revised the rulebook is
      // `check:upstream`'s question and it has the digest to answer it with;
      // guessing here would put a claim on screen that nothing backs.
      status: 'ok',
    });
  }

  if (problems.length > 0) throw new MeetRulesSourceError(problems);

  // Sorted by id, not left in directory order. The artifact is content-addressed,
  // so a rename that merely reordered the files would rewrite the filename and
  // evict a cache that was still correct.
  profiles.sort((left, right) => left.id.localeCompare(right.id));

  const book = v.safeParse(MeetRuleBookSchema, { profiles });
  if (!book.success) {
    throw new MeetRulesSourceError(
      book.issues.map(
        (issue) => `built book: ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }

  return { book: book.output, freshness };
}

/**
 * Reads the pin without validating the rest of the document.
 *
 * `check:upstream` needs the digest and the URL and nothing else, and it has to
 * keep working on a document the build is currently rejecting -- a profile that
 * failed to publish is precisely when knowing whether the rulebook moved is most
 * useful.
 */
export function readMeetRulesSourceReferences(document: unknown): {
  readonly federationId: string;
  readonly rulebookSha256: string;
  readonly rulebookUrl: string;
} {
  const PinSchema = v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    rulebook: v.object({
      sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u, 'a lowercase sha-256 digest')),
      url: v.pipe(v.string(), v.url()),
    }),
  });

  const parsed = v.safeParse(PinSchema, document);
  if (!parsed.success) {
    throw new MeetRulesSourceError(
      parsed.issues.map(
        (issue) => `${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }
  return {
    federationId: parsed.output.id,
    rulebookSha256: parsed.output.rulebook.sha256,
    rulebookUrl: parsed.output.rulebook.url,
  };
}
