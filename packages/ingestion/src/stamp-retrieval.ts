/**
 * Moves a source mapping's `provenance.retrievedAt` forward.
 *
 * WHY THIS EXISTS
 *
 * The retrieval date on a mapping is the sentence the site prints under a
 * federation's figures: "retrieved on such a date". For the curated sources a
 * person edits that line in the same commit as the transcription, and it is
 * right by construction. The record corpus has no such commit -- the crawl runs
 * on a schedule with nobody watching -- so left alone the date would freeze on
 * the day the mapping was written while the figures beneath it refreshed every
 * week. A freshness label that is years out of date is worse than none: it is
 * the one part of the page a reader has no way to check.
 *
 * WHY IT IS A TEXT EDIT AND NOT A JSON REWRITE
 *
 * These mapping files are hand-written, heavily commented through `$comment:`
 * keys, and Prettier-formatted -- `.prettierignore` exempts only the snapshots
 * beside them. Parsing and re-serialising would very likely reproduce the file,
 * and "very likely" is the problem: the failure is a scheduled job reflowing a
 * hand-maintained document at two in the morning, and the diff that reveals it
 * is the whole file. Replacing one value in place cannot do that.
 *
 * WHAT IT REFUSES
 *
 * Everything it cannot do unambiguously. More than one `retrievedAt` in the
 * document, none at all, a timestamp that is not the canonical ISO instant, or a
 * timestamp earlier than the one already there. The last is the interesting one:
 * a runner whose clock is skewed backwards would otherwise quietly reverse the
 * provenance of published data, and the only evidence would be a date on a page.
 */

/** The key, spelled once. Both the search and the message below use it. */
const KEY = 'retrievedAt';

/**
 * The one occurrence this may rewrite.
 *
 * Deliberately not anchored inside `provenance`: a second `retrievedAt`
 * appearing anywhere in the document should stop this, not be skipped past. The
 * count is the safety property, so the pattern is broad on purpose.
 */
const RETRIEVED_AT = /"retrievedAt":\s*"([^"]*)"/gu;

/** Refused rather than half-applied. Carries no file content, only a reason. */
export class RetrievalStampError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RetrievalStampError';
  }
}

/**
 * Returns the document with its retrieval timestamp set, or throws.
 *
 * Pure, so the tests can put every refusal in front of it without a filesystem.
 * The caller writes the result; nothing here touches a disk.
 */
export function stampRetrievedAt(document: string, retrievedAt: string): string {
  if (!isCanonicalInstant(retrievedAt)) {
    // Canonical rather than merely parseable. `new Date('2026-8-1')` is a valid
    // date and an invalid ISO timestamp, and the schema that reads this file
    // would reject it at build time -- but only after the job had committed it.
    throw new RetrievalStampError(
      `"${retrievedAt}" is not a canonical ISO instant such as 2026-08-01T00:00:00.000Z.`,
    );
  }

  const found = [...document.matchAll(RETRIEVED_AT)];
  const [match] = found;
  if (match === undefined || found.length !== 1) {
    throw new RetrievalStampError(
      `Expected exactly one "${KEY}" in the document, found ${String(found.length)}.`,
    );
  }

  const previous = match[1];
  if (previous === undefined) {
    throw new RetrievalStampError(`The "${KEY}" in the document has no value to replace.`);
  }
  if (isCanonicalInstant(previous) && Date.parse(retrievedAt) < Date.parse(previous)) {
    throw new RetrievalStampError(
      `Refusing to move "${KEY}" backwards, from ${previous} to ${retrievedAt}.`,
    );
  }

  // `slice` rather than `String.replace`, whose replacement string reads `$&`
  // and friends as instructions. A timestamp cannot contain one today, and that
  // is exactly the kind of fact that stops being true quietly.
  const start = match.index;
  return (
    document.slice(0, start) +
    `"${KEY}": ${JSON.stringify(retrievedAt)}` +
    document.slice(start + match[0].length)
  );
}

/** True only for the spelling `Date.prototype.toISOString` produces. */
function isCanonicalInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}
