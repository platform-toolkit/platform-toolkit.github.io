// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import {
  QualifyingFederationRulesSchema,
  QualifyingMeetBookSchema,
  QualifyingMeetSchema,
  type QualifyingFederationRules,
  type QualifyingMeet,
  type QualifyingMeetBook,
  type SourceFreshness,
} from '@platform-toolkit/data-contracts';
import * as v from 'valibot';

/**
 * Turning transcribed qualification criteria into the one artifact the tool reads.
 *
 * Two kinds of transcription arrive here and they fail differently, which is why
 * one adapter handles both. A federation's entry rules come out of a rulebook: it
 * prints a revision, it can be digested, and a change to it announces itself. A
 * meet's criteria come out of an announcement: no revision, edited in place,
 * gone once the meet is over. Nothing in this file can fetch either one, so it
 * cannot check that a transcription is *true*. What it can check is that the
 * transcription is coherent -- and every refusal below is a slip that would
 * otherwise publish cleanly and render as a real answer.
 *
 * WHY THE REFUSALS ARE SHAPED THE WAY THEY ARE
 *
 * The screen this feeds tells a lifter whether a meet's published criteria are
 * met. Every failure mode is therefore asymmetric: a criterion that renders as
 * unmet costs somebody a phone call, and a criterion that renders as met costs
 * them an entry fee, a flight, and a reclassification to guest lifter on the
 * official results. So the checks here are the ones that catch a *permission*
 * being published by accident -- a standard that resolves to nothing and
 * therefore never bites, a qualifying window that stays open past the meet, an
 * entry deadline that falls after the meet has finished.
 *
 * WHAT IS NOT CHECKED HERE, DELIBERATELY
 *
 * Whether a meet has already happened. This adapter takes no clock and gets no
 * `generatedAt`, and that is the same decision `planPublication` makes for the
 * same reason: a refusal that depends on the date fails a scheduled refresh, at
 * two in the morning, for being correct. Pastness is the screen's computation
 * against today. Which meets are worth publishing is the transcriber's call, and
 * the source document records it.
 */

/** Where a transcription came from and when. The shape the curated documents share. */
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
 * The pin on the exact rulebook bytes the entry rules were read from.
 *
 * Nothing here fetches them, and `check:upstream` deliberately does not watch
 * this copy either: it is the same PDF `data/sources/meet-rules/uspa.json`
 * already pins, and fetching one document twice a week to report one fact twice
 * is noise in the one report that has to stay worth reading. What keeps that
 * claim true is an assertion in `qualification.data.test.ts` that the two
 * digests match -- so the day they diverge, the build says so rather than a
 * watch quietly covering nothing.
 */
const RulebookSchema = v.object({
  revision: v.pipe(v.string(), v.minLength(1)),
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/u, 'a lowercase sha-256 digest')),
  url: v.pipe(v.string(), v.url()),
});

/**
 * The federation's own entry rules, minus the three fields this derives.
 *
 * `federationId`, `label` and `source` are omitted for the reason the meet-rule
 * document omits its own three: they would exist twice in one file, and the copy
 * that drifted would be the one on screen.
 */
const EntryRulesSchema = v.omit(QualifyingFederationRulesSchema, [
  'federationId',
  'label',
  'source',
]);

/**
 * One meet, minus the federation it is read against.
 *
 * Derived from the document rather than repeated on each meet, so that a file
 * cannot claim to be USPA's at the top and something else's halfway down.
 */
const MeetSchema = v.omit(QualifyingMeetSchema, ['federationId']);

export const QualificationSourceDocumentSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  label: v.pipe(v.string(), v.minLength(1)),
  provenance: ProvenanceSchema,
  rulebook: RulebookSchema,
  entryRules: EntryRulesSchema,
  meets: v.pipe(v.array(MeetSchema), v.minLength(1)),
});

export type QualificationSourceDocument = v.InferOutput<typeof QualificationSourceDocumentSchema>;

/** Thrown when transcribed criteria are unusable. Carries every problem, not the first. */
export class QualificationSourceError extends Error {
  override readonly name = 'QualificationSourceError';

  constructor(readonly problems: readonly string[]) {
    super(`Qualification source documents are unusable:\n  ${problems.join('\n  ')}`);
  }
}

export interface QualificationSourceResult {
  readonly book: QualifyingMeetBook;
  /** One entry per source document, so a stale transcription is attributable. */
  readonly freshness: readonly SourceFreshness[];
}

/**
 * The classification standards each federation publishes, by identifier.
 *
 * Required rather than inferred, and required for the reason the category
 * catalogue is (§5.1): a route names a standard by reference, so a standard
 * identifier that does not exist in the published ladder is a route that can
 * never resolve. Unresolved, it renders as "you have not qualified" -- a real
 * answer, correct-looking, and wrong for every lifter who reads it.
 */
export type PublishedStandardIds = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Validates every transcribed document and produces the artifact plus its freshness.
 *
 * @throws {QualificationSourceError} if any document does not parse, describes
 *   criteria that contradict themselves or the federation's published ladder, or
 *   collides with another document.
 */
export function buildQualifyingMeetBook(
  documents: readonly unknown[],
  standardsByFederation: PublishedStandardIds,
): QualificationSourceResult {
  if (documents.length === 0) {
    // An empty book leaves the tool's first question -- which meet -- with no
    // answers, and the screen it draws is a form nobody can submit rather than a
    // load failure anybody would report.
    throw new QualificationSourceError(['no qualification source documents were found']);
  }

  const problems: string[] = [];
  const federations: QualifyingFederationRules[] = [];
  const meets: QualifyingMeet[] = [];
  const freshness: SourceFreshness[] = [];
  const seenFederations = new Set<string>();
  const seenMeets = new Map<string, string>();

  for (const [index, document] of documents.entries()) {
    const parsed = v.safeParse(QualificationSourceDocumentSchema, document);
    if (!parsed.success) {
      // Path and expectation, never the value (§5.4). These are public federation
      // documents rather than personal data, but one adapter that prints values
      // is one adapter somebody copies onto a corpus where it matters.
      problems.push(
        ...parsed.issues.map(
          (issue) =>
            `document ${String(index)}: ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
        ),
      );
      continue;
    }
    const source = parsed.output;

    if (seenFederations.has(source.id)) {
      problems.push(
        `two source documents both claim the federation id "${source.id}". A lookup would ` +
          'resolve to whichever copy it reached first, which is a coin toss over which ' +
          "federation's entry rules a lifter reads.",
      );
      continue;
    }
    seenFederations.add(source.id);

    const standards = standardsByFederation.get(source.id);
    if (standards === undefined) {
      problems.push(
        `federation "${source.id}": no classification standards are published for it, so no ` +
          'route can resolve the standard it names.',
      );
      continue;
    }

    const verifiedOn = source.provenance.retrievedAt.slice(0, 'YYYY-MM-DD'.length);
    const rules = {
      ...source.entryRules,
      federationId: source.id,
      label: source.label,
      source: {
        label: source.provenance.document,
        url: source.rulebook.url,
        revision: source.rulebook.revision,
        sections: source.provenance.sections,
        // The day the document was read is the day these rules were last checked
        // against it. Two fields for one fact would eventually disagree.
        verifiedOn,
      },
    };

    const contract = v.safeParse(QualifyingFederationRulesSchema, rules);
    if (!contract.success) {
      problems.push(
        ...contract.issues.map(
          (issue) =>
            `built rules "${source.id}": ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
        ),
      );
      continue;
    }

    problems.push(...gearLadderProblems(contract.output));
    problems.push(...duplicateIdProblems(`federation "${source.id}"`, contract.output.conditions));
    federations.push(contract.output);

    for (const candidate of source.meets) {
      const meet = v.safeParse(QualifyingMeetSchema, { ...candidate, federationId: source.id });
      if (!meet.success) {
        problems.push(
          ...meet.issues.map(
            (issue) =>
              `meet "${candidate.id}": ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
          ),
        );
        continue;
      }

      const owner = seenMeets.get(meet.output.id);
      if (owner !== undefined) {
        problems.push(
          `two meets both claim the id "${meet.output.id}" (${owner} and ${source.id}). One of ` +
            "them would never be shown, and which one is the artifact's line order.",
        );
        continue;
      }
      seenMeets.set(meet.output.id, source.id);

      problems.push(...meetProblems(meet.output, standards));
      meets.push(meet.output);
    }

    freshness.push({
      id: source.provenance.id,
      label: `${source.provenance.label} (${source.provenance.document} ${source.rulebook.revision})`,
      retrievedAt: source.provenance.retrievedAt,
      // Always `ok`. Whether an announcement has been edited since it was read is
      // not a question anything here can answer -- there is no revision on one to
      // compare against -- and guessing would put a claim on screen that nothing
      // backs. `source.verifiedOn` is what the visitor gets instead.
      status: 'ok',
    });
  }

  if (problems.length > 0) throw new QualificationSourceError(problems);

  // Sorted rather than left in directory order. The artifact is content-addressed,
  // so a file rename that merely reordered these would rewrite the filename and
  // evict a cache that was still correct.
  federations.sort((left, right) => left.federationId.localeCompare(right.federationId));
  meets.sort((left, right) => left.id.localeCompare(right.id));

  const book = v.safeParse(QualifyingMeetBookSchema, { federations, meets });
  if (!book.success) {
    throw new QualificationSourceError(
      book.issues.map(
        (issue) => `built book: ${v.getDotPath(issue) ?? '(root)'}: expected ${issue.expected}`,
      ),
    );
  }

  return { book: book.output, freshness };
}

/**
 * What a gear ladder must say about itself to be a ladder at all.
 *
 * The published table is eight rows of three category names and is transcribed by
 * eye, which is the one activity that produces exactly these mistakes. None of
 * them fails to parse and none of them is visible on screen: a row that drops the
 * category the lifter competed in silently withdraws an entry they already had,
 * and a row listed twice answers one question two ways.
 */
function gearLadderProblems(rules: QualifyingFederationRules): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const row of rules.gearLadder) {
    // U+001F between the two halves, spelled as an escape (§2.4). Run together,
    // a pair like ("Raw", "Classic Raw") and ("Raw Classic", "Raw") are one
    // string, and the second row vanishes into the first as a duplicate.
    const key = `${row.competedIn}\u{001F}${row.standardReachedIn}`;
    if (seen.has(key)) {
      problems.push(
        `federation "${rules.federationId}": the gear ladder answers "${row.competedIn}" plus a ` +
          `"${row.standardReachedIn}" total twice.`,
      );
    }
    seen.add(key);

    if (!row.opens.includes(row.competedIn)) {
      problems.push(
        `federation "${rules.federationId}": a "${row.competedIn}" lifter reaching the ` +
          `"${row.standardReachedIn}" standard is not offered "${row.competedIn}", which is the ` +
          'category they already qualified in.',
      );
    }
    if (!row.opens.includes(row.standardReachedIn)) {
      problems.push(
        `federation "${rules.federationId}": a total reaching the "${row.standardReachedIn}" ` +
          'standard does not open that category.',
      );
    }
    if (new Set(row.opens).size !== row.opens.length) {
      problems.push(
        `federation "${rules.federationId}": the row for "${row.competedIn}" plus a ` +
          `"${row.standardReachedIn}" total names a category twice.`,
      );
    }
  }

  return problems;
}

/** Everything a meet has to be internally consistent about. */
function meetProblems(meet: QualifyingMeet, standards: ReadonlySet<string>): readonly string[] {
  const problems: string[] = [];

  if (meet.entryClosesOn !== null && meet.entryClosesOn > meet.held.to) {
    // Entries closing after the meet has finished is a transcription slip with a
    // very specific consequence: the tool would tell a lifter there is still time
    // to enter a meet that is over.
    problems.push(
      `meet "${meet.id}": entries are recorded as closing on ${meet.entryClosesOn}, after the ` +
        `meet finishes on ${meet.held.to}.`,
    );
  }

  problems.push(...duplicateIdProblems(`meet "${meet.id}"`, meet.conditions));

  if (meet.entry.kind !== 'standard') return problems;

  const seenRoutes = new Set<string>();
  for (const route of meet.entry.routes) {
    if (seenRoutes.has(route.id)) {
      problems.push(`meet "${meet.id}": two qualifying routes both use the id "${route.id}".`);
    }
    seenRoutes.add(route.id);

    if (route.standard.kind === 'classification' && !standards.has(route.standard.standardId)) {
      // The refusal this adapter exists for. A standard identifier the ladder
      // does not carry cannot resolve to a total, and an unresolved route renders
      // as "you have not qualified" -- which is a real answer, so nobody
      // investigates it, and every lifter who could have entered is turned away
      // by a typo.
      problems.push(
        `meet "${meet.id}", route "${route.id}": "${route.standard.standardId}" is not a ` +
          `published classification standard of federation "${meet.federationId}".`,
      );
    }

    if (route.window.to > meet.held.from) {
      // A window that stays open past the first day of the meet admits a
      // performance that has not happened yet at the moment entry is decided.
      problems.push(
        `meet "${meet.id}", route "${route.id}": the qualifying window closes on ` +
          `${route.window.to}, after the meet begins on ${meet.held.from}.`,
      );
    }

    if (route.appliesToTested === true && meet.testedOffering === 'untested') {
      problems.push(
        `meet "${meet.id}", route "${route.id}": it opens tested entry at a meet that runs no ` +
          'tested competition.',
      );
    }
    if (route.appliesToTested === false && meet.testedOffering === 'tested') {
      problems.push(
        `meet "${meet.id}", route "${route.id}": it opens untested entry at a meet that runs no ` +
          'untested competition.',
      );
    }
  }

  return problems;
}

/**
 * Conditions sharing an identifier, which is how a rendered list loses one.
 *
 * Two conditions under one id is not a parse failure and shows up as a list that
 * is one item short -- and the item that goes missing is a membership deadline or
 * a lifter cap, which is to say the half of the criteria no total can satisfy.
 */
function duplicateIdProblems(
  owner: string,
  conditions: readonly { readonly id: string }[],
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const condition of conditions) {
    if (seen.has(condition.id)) {
      problems.push(`${owner}: two conditions both use the id "${condition.id}".`);
    }
    seen.add(condition.id);
  }
  return problems;
}
