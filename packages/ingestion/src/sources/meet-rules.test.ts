import { describe, expect, it } from 'vitest';

import {
  MeetRulesSourceError,
  buildMeetRuleBook,
  readMeetRulesSourceReferences,
} from './meet-rules.js';

/**
 * Every figure below is invented, and invented to be *unlike* a real federation's:
 * a 2 kg bar multiple where every federation published here uses 2.5, a 90-second
 * window where they use 60. Asserting on a real profile would put a second copy of
 * a rulebook in the test suite, and the day the federation revised it, the test
 * would fail for being correct. Pinning the committed documents is
 * `meet-rules.data.test.ts`, which is deliberately a different file with a
 * different job.
 */

const DIGEST = 'a'.repeat(64);

interface Overrides {
  readonly id?: string;
  readonly rules?: Record<string, unknown>;
  readonly rulebook?: Record<string, unknown>;
  readonly provenance?: Record<string, unknown>;
}

function document(overrides: Overrides = {}): unknown {
  return {
    $comment: 'Tolerated and dropped, like everywhere else.',
    id: overrides.id ?? 'example',
    label: 'Example Federation',
    provenance: {
      id: `${overrides.id ?? 'example'}-meet-rules`,
      label: 'Example Federation technical rules',
      document: 'Example Federation Technical Rules',
      url: 'https://example.test/rulebook/',
      sections: ['6.1 Attempts'],
      retrievedAt: '2026-08-01T00:00:00.000Z',
      ...overrides.provenance,
    },
    rulebook: {
      revision: '2026v1',
      sha256: DIGEST,
      url: 'https://example.test/rulebook.pdf',
      ...overrides.rulebook,
    },
    rules: {
      attemptsPerLift: 3,
      barMultipleKilograms: 2,
      minimumProgressionKilograms: 2,
      recordProgressionKilograms: 0.25,
      submissionSeconds: 90,
      automaticAfterGoodLift: 'increase-by-increment',
      automaticAfterMiss: 'repeat',
      forbidsAttemptBelowFailedWeight: true,
      risingBar: true,
      openerChange: {
        allowed: 1,
        firstGroupMinutesBefore: 4,
        laterGroupAttemptsBefore: 6,
        summary: 'One change, up to four minutes before the first round of that lift.',
      },
      secondAttemptChangesAllowed: 0,
      thirdAttemptChanges: [
        {
          lift: 'squat',
          allowed: 0,
          lapsesOnceCalledToLoadedBar: false,
          notBelowPrecedingLifter: false,
        },
        {
          lift: 'bench',
          allowed: 0,
          lapsesOnceCalledToLoadedBar: false,
          notBelowPrecedingLifter: false,
        },
        {
          lift: 'deadlift',
          allowed: 2,
          lapsesOnceCalledToLoadedBar: true,
          notBelowPrecedingLifter: true,
        },
      ],
      formatOverrides: [
        {
          format: 'bench-only',
          lift: 'bench',
          allowed: 2,
          summary: 'Two changes in the third round of a single-lift bench press.',
        },
      ],
      fourthAttempt: null,
      tieBreak: ['lighter-bodyweight', 'declared-tie'],
      notes: [],
      ...overrides.rules,
    },
  };
}

/** The problems from a build that was supposed to fail. Fails the test if it did not. */
function problemsFrom(documents: readonly unknown[]): readonly string[] {
  try {
    buildMeetRuleBook(documents);
  } catch (error) {
    if (error instanceof MeetRulesSourceError) return error.problems;
    throw error;
  }
  throw new Error('expected the build to refuse these documents');
}

describe('buildMeetRuleBook', () => {
  it('produces the artifact the browser reads', () => {
    const { book } = buildMeetRuleBook([document()]);
    expect(book.profiles).toHaveLength(1);
    expect(book.profiles[0]?.id).toBe('example');
    expect(book.profiles[0]?.label).toBe('Example Federation');
    expect(book.profiles[0]?.barMultipleKilograms).toBe(2);
  });

  it('builds the citation from the provenance and the pin, not from a repeated field', () => {
    const { book } = buildMeetRuleBook([document()]);
    expect(book.profiles[0]?.source).toStrictEqual({
      label: 'Example Federation Technical Rules',
      url: 'https://example.test/rulebook.pdf',
      revision: '2026v1',
      verifiedOn: '2026-08-01',
    });
  });

  it('dates the verification from the day a person read the document', () => {
    // Not the day the build ran. A build stamps itself; only a reader can say
    // when these figures were last checked against the rulebook.
    const { book } = buildMeetRuleBook([
      document({ provenance: { retrievedAt: '2025-02-14T09:30:00.000Z' } }),
    ]);
    expect(book.profiles[0]?.source.verifiedOn).toBe('2025-02-14');
  });

  it('reports freshness per document, naming the revision it was read from', () => {
    const { freshness } = buildMeetRuleBook([document()]);
    expect(freshness).toHaveLength(1);
    expect(freshness[0]?.id).toBe('example-meet-rules');
    expect(freshness[0]?.label).toContain('2026v1');
    expect(freshness[0]?.retrievedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(freshness[0]?.status).toBe('ok');
  });

  it('sorts profiles by identifier rather than leaving them in directory order', () => {
    // The artifact is content-addressed. Left in the order the files were read, a
    // rename that changed nothing else would rewrite the filename and evict a
    // cache that was still correct.
    const { book } = buildMeetRuleBook([document({ id: 'zeta' }), document({ id: 'alpha' })]);
    expect(book.profiles.map((profile) => profile.id)).toStrictEqual(['alpha', 'zeta']);
  });

  it('refuses two documents claiming one federation', () => {
    // Which of the two answers a lookup is a coin toss, and the losing profile's
    // increment is what a lifter plans against.
    const problems = problemsFrom([document(), document()]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"example"');
  });

  it('refuses an empty set of documents', () => {
    // A book with no profiles renders as a federation question with no answers,
    // which reads as a form nobody can submit rather than as a failed load.
    expect(problemsFrom([])).toStrictEqual(['no meet rule source documents were found']);
  });

  it('reports the path and the expectation, and never the value', () => {
    const problems = problemsFrom([document({ rules: { barMultipleKilograms: -5 } })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('rules.barMultipleKilograms');
    expect(problems[0]).not.toContain('-5');
  });

  it('reports every unusable document rather than the first', () => {
    const problems = problemsFrom([
      document({ id: 'one', rules: { submissionSeconds: 0 } }),
      document({ id: 'two', rules: { attemptsPerLift: 0 } }),
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('document 0');
    expect(problems.join('\n')).toContain('document 1');
  });

  it('refuses rules that contradict themselves, naming the federation', () => {
    // The transcription parses -- every field is the right kind of thing -- and
    // the rules it describes are impossible: a record increment coarser than the
    // bar multiple relaxes nothing, which is a copy-paste, not a federation's
    // rule. Only the domain knows that, which is why it is asked here rather than
    // left to the browser.
    const problems = problemsFrom([document({ rules: { recordProgressionKilograms: 5 } })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('profile "example"');
  });

  it('refuses a digest that is not a lowercase sha-256', () => {
    // An uppercase digest compares unequal to what `check:upstream` computes, so
    // the watch would report drift every run and stop being read.
    const problems = problemsFrom([document({ rulebook: { sha256: DIGEST.toUpperCase() } })]);
    expect(problems[0]).toContain('rulebook.sha256');
  });

  it('carries a profile with no fourth attempt through as null', () => {
    // Not a zeroed block. A federation that has no fourth attempt is a different
    // statement from one that offers a fourth attempt nobody may take, and the
    // second puts a row on screen that sends a lifter to ask about something that
    // does not exist.
    const { book } = buildMeetRuleBook([document()]);
    expect(book.profiles[0]?.fourthAttempt).toBeNull();
  });

  it('drops the $comment rather than publishing it', () => {
    const { book } = buildMeetRuleBook([document()]);
    expect(Object.hasOwn(book.profiles[0] ?? {}, '$comment')).toBe(false);
  });
});

describe('readMeetRulesSourceReferences', () => {
  it('reads the pin', () => {
    expect(readMeetRulesSourceReferences(document())).toStrictEqual({
      federationId: 'example',
      rulebookSha256: DIGEST,
      rulebookUrl: 'https://example.test/rulebook.pdf',
    });
  });

  it('reads the pin from a document the build refuses', () => {
    // A profile that failed to publish is exactly when knowing whether the
    // rulebook moved is most useful, so this must not depend on the rules
    // parsing.
    const broken = {
      id: 'example',
      rulebook: { sha256: DIGEST, url: 'https://example.test/r.pdf' },
    };
    expect(readMeetRulesSourceReferences(broken).federationId).toBe('example');
  });

  it('refuses a document with no pin at all', () => {
    expect(() => readMeetRulesSourceReferences({ id: 'example' })).toThrow(MeetRulesSourceError);
  });
});
