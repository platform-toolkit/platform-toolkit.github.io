// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The trust boundary, tested from the outside.
 *
 * Nearly every test here hands `readMeetFile` a string rather than an object,
 * because a string is what it will actually be given and because parsing is
 * half of what it does -- a test that started from an object would skip the
 * step where a file that is not JSON arrives.
 *
 * The four refusals are separated on purpose. §24.4 asks for unsupported and
 * older data to be reported *clearly*, and "clearly" is the difference between
 * telling somebody their backup is damaged and telling them it was written by a
 * newer version of the tool. Those are opposite instructions -- throw it away,
 * or go and update -- so each has its own code and its own test.
 *
 * The colour field is tested hardest of anything in the schema, because it is
 * the only value in a saved meet that reaches a stylesheet.
 */
import { describe, expect, it } from 'vitest';

import {
  MEET_FILE_KIND,
  type MeetFileReading,
  readMeetFile,
  readSavedMeet,
  writeMeetFile,
} from './meet-file.js';
import { EMPTY_SAVED_STATE, SAVED_MEET_VERSION, type SavedMeet } from './saved-meet.js';

const NOW = 1_770_000_000_000;

const MEET: SavedMeet = {
  id: 'meet-1',
  name: 'Winter Open',
  createdAt: NOW - 1000,
  updatedAt: NOW,
  archived: false,
  rulesProfileId: 'uspa-2026',
  rulebookRevision: '2026-01',
  methodologyVersion: 'attempt-plan-2026.1',
  state: EMPTY_SAVED_STATE,
};

/** A file whose body is whatever a test wants, with a correct envelope. */
function envelope(body: unknown): string {
  return JSON.stringify({
    kind: MEET_FILE_KIND,
    version: SAVED_MEET_VERSION,
    exportedAt: NOW,
    meets: [body],
  });
}

function refusal(reading: MeetFileReading): string {
  return reading.ok ? 'accepted' : reading.reason;
}

describe('a round trip', () => {
  it('comes back equal', () => {
    const reading = readMeetFile(writeMeetFile([MEET], NOW));
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.file.meets).toEqual([MEET]);
    expect(reading.file.exportedAt).toBe(NOW);
    expect(reading.file.version).toBe(SAVED_MEET_VERSION);
  });

  it('carries a whole planning session through, field for field', () => {
    const planned: SavedMeet = {
      ...MEET,
      state: {
        ...EMPTY_SAVED_STATE,
        session: {
          ...EMPTY_SAVED_STATE.session,
          targetTotal: '500',
          setup: { ...EMPTY_SAVED_STATE.session.setup, federationId: 'uspa', goalChosen: true },
          figures: {
            ...EMPTY_SAVED_STATE.session.figures,
            squat: {
              ...EMPTY_SAVED_STATE.session.figures.squat,
              expectedMaximum: '200',
              attempts: ['180', '190', '200'],
              confirmed: true,
            },
          },
        },
        prep: { ...EMPTY_SAVED_STATE.prep, done: ['singlet'], notes: 'chalk' },
      },
    };
    const reading = readMeetFile(writeMeetFile([planned], NOW));
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.file.meets[0]).toEqual(planned);
  });

  it('writes something a person could read in a text editor', () => {
    expect(writeMeetFile([MEET], NOW)).toContain('\n  "kind"');
  });

  it('writes an empty file for an empty shelf rather than refusing', () => {
    const reading = readMeetFile(writeMeetFile([], NOW));
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.file.meets).toEqual([]);
  });

  it('refuses to write a meet it could not read back', () => {
    const broken = { ...MEET, name: 'x'.repeat(500) };
    expect(() => writeMeetFile([broken], NOW)).toThrow();
  });
});

describe('refusing', () => {
  it('says unreadable for something that is not JSON', () => {
    expect(refusal(readMeetFile('not a file'))).toBe('unreadable');
    expect(refusal(readMeetFile(''))).toBe('unreadable');
  });

  it('says not-a-meet-file for JSON that is something else', () => {
    expect(refusal(readMeetFile('{"invoice":42}'))).toBe('not-a-meet-file');
    expect(refusal(readMeetFile('[]'))).toBe('not-a-meet-file');
    expect(refusal(readMeetFile('null'))).toBe('not-a-meet-file');
  });

  it('distinguishes a newer file from a damaged one, and says which version', () => {
    const reading = readMeetFile(
      JSON.stringify({ kind: MEET_FILE_KIND, version: SAVED_MEET_VERSION + 3, meets: 'nonsense' }),
    );
    expect(refusal(reading)).toBe('newer-version');
    expect(reading.ok ? null : reading.foundVersion).toBe(SAVED_MEET_VERSION + 3);
  });

  it('distinguishes an older file, which is a migration and not a corruption', () => {
    const reading = readMeetFile(JSON.stringify({ kind: MEET_FILE_KIND, version: 0.5 }));
    // 0.5 is not a version this ever wrote; the envelope reads any number so
    // that a hand-edited file is reported as old rather than as unrecognisable.
    expect(refusal(reading)).toBe('older-version');
  });

  it('says damaged only when the kind and the version were both right', () => {
    expect(refusal(readMeetFile(envelope({ id: 'meet-1' })))).toBe('damaged');
  });

  it('refuses a meet whose figures are missing a lift', () => {
    const noBench = {
      ...MEET,
      state: {
        ...EMPTY_SAVED_STATE,
        session: {
          ...EMPTY_SAVED_STATE.session,
          figures: {
            squat: EMPTY_SAVED_STATE.session.figures.squat,
            deadlift: EMPTY_SAVED_STATE.session.figures.deadlift,
          },
        },
      },
    };
    expect(refusal(readMeetFile(envelope(noBench)))).toBe('damaged');
  });

  it('refuses free text past its cap rather than truncating it', () => {
    const shouty = {
      ...MEET,
      state: {
        ...EMPTY_SAVED_STATE,
        prep: { ...EMPTY_SAVED_STATE.prep, notes: 'x'.repeat(5000) },
      },
    };
    expect(refusal(readMeetFile(envelope(shouty)))).toBe('damaged');
  });

  it('refuses a weight that is not a number', () => {
    const damaged = {
      ...MEET,
      state: {
        ...EMPTY_SAVED_STATE,
        document: {
          rulesProfileId: 'uspa-2026',
          rulebookRevision: '2026-01',
          format: 'full-power',
          lifters: [
            {
              id: 'lifter-1',
              name: 'A',
              attempts: [
                {
                  id: 'attempt-1',
                  lift: 'squat',
                  attemptNumber: 1,
                  kind: 'competition',
                  kilograms: '180',
                  status: 'planned',
                  effort: null,
                  rpe: null,
                  missReason: null,
                  lights: null,
                  note: null,
                  changesUsed: 0,
                  submittedAt: null,
                  grantedFor: null,
                },
              ],
              countdown: null,
              nextAttemptOrdinal: 2,
            },
          ],
          focusedLifterId: 'lifter-1',
          nextLifterOrdinal: 2,
        },
      },
    };
    expect(refusal(readMeetFile(envelope(damaged)))).toBe('damaged');
  });
});

describe('a board entry colour', () => {
  function withColour(colour: unknown): string {
    return envelope({
      ...MEET,
      state: {
        ...EMPTY_SAVED_STATE,
        entries: [{ lifterId: 'lifter-1', colour }],
      },
    });
  }

  it('accepts the two hex lengths a picker produces', () => {
    expect(refusal(readMeetFile(withColour('#abc')))).toBe('accepted');
    expect(refusal(readMeetFile(withColour('#A1B2C3')))).toBe('accepted');
  });

  it('accepts none at all', () => {
    expect(refusal(readMeetFile(withColour(null)))).toBe('accepted');
  });

  it('refuses anything that could steer how the page paints', () => {
    // Each of these is a string CSS would accept in a custom property.
    for (const hostile of [
      'var(--ptk-color-danger)',
      'red; position: fixed',
      'image-set("https://example.test/x.png")',
      'rgb(0 0 0 / 50%)',
    ]) {
      expect(refusal(readMeetFile(withColour(hostile)))).toBe('damaged');
    }
  });

  it('refuses a hex of the wrong length', () => {
    expect(refusal(readMeetFile(withColour('#abcd')))).toBe('damaged');
    expect(refusal(readMeetFile(withColour('abc')))).toBe('damaged');
  });
});

describe('reading one meet out of storage', () => {
  it('returns it when it fits', () => {
    expect(readSavedMeet(JSON.parse(JSON.stringify(MEET)))).toEqual(MEET);
  });

  it('returns nothing rather than throwing when it does not', () => {
    expect(readSavedMeet({ id: 'meet-1' })).toBeNull();
    expect(readSavedMeet(null)).toBeNull();
    expect(readSavedMeet('meet-1')).toBeNull();
  });
});
