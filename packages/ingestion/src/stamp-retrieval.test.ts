import { describe, expect, it } from 'vitest';

import { RetrievalStampError, stampRetrievedAt } from './stamp-retrieval.js';

/** A mapping in miniature: the shape that matters, none of the bulk. */
const DOCUMENT = `{
  "$comment": "A hand-written mapping.",
  "provenance": {
    "id": "fixture",
    "retrievedAt": "2026-01-01T00:00:00.000Z"
  }
}
`;

const LATER = '2026-02-01T00:00:00.000Z';

describe('stampRetrievedAt', () => {
  it('moves the timestamp forward', () => {
    expect(stampRetrievedAt(DOCUMENT, LATER)).toContain(`"retrievedAt": "${LATER}"`);
  });

  it('changes nothing else in the document', () => {
    // The reason this is a text edit rather than a JSON rewrite. A scheduled job
    // reflowing a hand-commented file produces a diff nobody can read, on a
    // morning when nobody is looking.
    const stamped = stampRetrievedAt(DOCUMENT, LATER);

    expect(stamped).toBe(DOCUMENT.replace('2026-01-01T00:00:00.000Z', LATER));
    expect(stamped.split('\n')).toHaveLength(DOCUMENT.split('\n').length);
  });

  it('leaves a document that already records the instant byte-identical', () => {
    // A re-run of a refresh that failed after the crawl. The caller checks for
    // this to decide whether to write, so it has to be exact equality.
    expect(stampRetrievedAt(DOCUMENT, '2026-01-01T00:00:00.000Z')).toBe(DOCUMENT);
  });

  it('refuses a timestamp that is not the canonical spelling', () => {
    // `new Date('2026-2-1')` is a valid date and an invalid ISO instant. The
    // schema reading the file would catch it -- at build time, after the job had
    // already committed it.
    for (const value of ['2026-2-1', '2026-02-01', '2026-02-01T00:00:00Z', 'now', '']) {
      expect(() => stampRetrievedAt(DOCUMENT, value), value).toThrow(RetrievalStampError);
    }
  });

  it('refuses to move the timestamp backwards', () => {
    // A runner with a skewed clock would otherwise reverse the provenance of
    // published data, and the only evidence would be a date on a page.
    expect(() => stampRetrievedAt(DOCUMENT, '2025-12-31T00:00:00.000Z')).toThrow(
      /backwards, from 2026-01-01T00:00:00.000Z to 2025-12-31T00:00:00.000Z/u,
    );
  });

  it('refuses a document with no timestamp to replace', () => {
    expect(() => stampRetrievedAt('{ "provenance": {} }', LATER)).toThrow(/found 0/u);
  });

  it('refuses a document with more than one', () => {
    // Not "rewrite the first". A second occurrence means the file grew a shape
    // this tool was not written against, and picking one of two is how the wrong
    // one gets picked every week from then on.
    const twice = `${DOCUMENT.trimEnd().slice(0, -1)}, "other": { "retrievedAt": "${LATER}" } }`;

    expect(() => stampRetrievedAt(twice, LATER)).toThrow(/found 2/u);
  });

  it('never puts the document in a failure message', () => {
    // §2.3 applied to tooling. These mappings are public, but a message that
    // quotes the file it failed on is a habit that reaches a private one.
    let thrown: unknown;
    try {
      stampRetrievedAt(DOCUMENT, 'not a timestamp');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RetrievalStampError);
    expect((thrown as Error).message).not.toContain('fixture');
  });
});
