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

import type { Equipment } from '../warm-up/equipment.js';
import {
  MEET_FILE_KIND,
  type MeetFileReading,
  readMeetFile,
  readSavedMeet,
  writeMeetFile,
} from './meet-file.js';
import {
  EMPTY_SAVED_STATE,
  SAVED_MEET_VERSION,
  type SavedMeet,
  type SavedMeetState,
  toSavedWarmup,
} from './saved-meet.js';
import {
  DEFAULT_WARM_UP_ROOM,
  EMPTY_PREFERENCES,
  EMPTY_PROGRESS,
  EMPTY_WARMUP_STATE,
  EMPTY_WARMUP_STATES,
  type MeetWarmupState,
  SETS_BOUNDS,
} from './warmup.js';

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

describe("§9.4's history entry", () => {
  /** One finished lift, with all three outcomes and a reason on the miss. */
  const FINISHED: SavedMeet = {
    ...MEET,
    state: {
      ...EMPTY_SAVED_STATE,
      history: {
        equipment: 'wraps',
        lifts: [
          {
            lift: 'squat',
            plannedMaximumKilograms: 200,
            attempts: [
              { attemptNumber: 1, kilograms: 180, outcome: 'good', missReason: null },
              { attemptNumber: 2, kilograms: 190, outcome: 'no-lift', missReason: 'strength' },
              { attemptNumber: 3, kilograms: 190, outcome: 'passed', missReason: null },
            ],
          },
        ],
      },
    },
  };

  /** A meet as a build that had never heard of §9.4 wrote it. */
  function beforeThereWasOne(state: SavedMeetState): Record<string, unknown> {
    const { history: _history, ...rest } = state;
    return rest;
  }

  it('comes back field for field, miss reason and all', () => {
    // The whole entry rather than a spot check: what calibration reads next
    // season is this object, and a field silently dropped at the boundary --
    // the reason on a miss, the planned maximum a jump is measured against --
    // is a saved meet that parses cleanly and grades the lifter on less than
    // they lifted.
    const reading = readMeetFile(writeMeetFile([FINISHED], NOW));

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.file.meets[0]).toEqual(FINISHED);
  });

  it('reads a meet saved before there was a history to save', () => {
    // The claim that added the field without bumping `SAVED_MEET_VERSION`, so
    // it is the one that has to be true: every meet already on a shelf was
    // written without the key, and a required field would fail all of them at
    // the parser -- which `#restoreReport` counts as unreadable, so the release
    // that added §9.4 would blank the shelf of every lifter who had one.
    const older = readMeetFile(envelope({ ...MEET, state: beforeThereWasOne(EMPTY_SAVED_STATE) }));

    expect(refusal(older)).toBe('accepted');
    expect(older.ok ? older.file.meets[0]?.state.history : undefined).toBeNull();

    // The control, because "accepted" above would also be what a parser that
    // stopped reading the state at all produced: a key that is *not* optional,
    // removed the same way, is still a refusal.
    const { openLifterId: _openLifterId, ...withoutARequiredKey } = EMPTY_SAVED_STATE;
    expect(refusal(readMeetFile(envelope({ ...MEET, state: withoutARequiredKey })))).toBe(
      'damaged',
    );
  });

  it('refuses a fourth attempt in a history entry', () => {
    // A record try is not a competition attempt and is never in an entry --
    // `summariseMeet` filters on `kind`, and this says the same thing about a
    // file somebody else wrote. Read as a third, an exempted weight goes into
    // the jump the calibration measures.
    const recordTry = {
      ...FINISHED,
      state: {
        ...FINISHED.state,
        history: {
          equipment: 'raw',
          lifts: [
            {
              lift: 'squat',
              plannedMaximumKilograms: null,
              attempts: [{ attemptNumber: 4, kilograms: 205, outcome: 'good', missReason: null }],
            },
          ],
        },
      },
    };

    expect(refusal(readMeetFile(envelope(recordTry)))).toBe('damaged');
  });

  it('refuses a miss reason the attempt beside it would have accepted', () => {
    // The two picklists are one constant for this reason: a reason accepted on
    // an attempt and refused in the entry beside it makes a whole saved meet
    // unreadable, and the sentence the lifter sees is "this build cannot open
    // that meet" rather than anything about a miss reason. The control is that
    // a real reason on the same shape is accepted.
    function withReason(reason: unknown): string {
      return envelope({
        ...FINISHED,
        state: {
          ...FINISHED.state,
          history: {
            equipment: 'raw',
            lifts: [
              {
                lift: 'squat',
                plannedMaximumKilograms: null,
                attempts: [
                  { attemptNumber: 1, kilograms: 180, outcome: 'no-lift', missReason: reason },
                ],
              },
            ],
          },
        },
      });
    }

    expect(refusal(readMeetFile(withReason('platform-error')))).toBe('accepted');
    expect(refusal(readMeetFile(withReason('bad-day')))).toBe('damaged');
  });
});

describe("§20's warm-up answers", () => {
  /** A room somebody set up, rather than the default one. */
  const ROOM: Equipment = {
    ...DEFAULT_WARM_UP_ROOM,
    inventory: {
      kg: [
        { weight: 25, pairs: null, fullDiameter: true },
        { weight: 2.5, pairs: 2, fullDiameter: false },
      ],
      lb: [],
    },
  };

  /** One lift's worth of every kind of answer §20 takes. */
  const ANSWERED: MeetWarmupState = {
    room: ROOM,
    preferences: {
      ...EMPTY_PREFERENCES,
      restSeconds: '150',
      sharedRackLifters: '2',
      delayPreference: 'repeat-a-light-movement',
      prep: {
        ...EMPTY_PREFERENCES.prep,
        'knee-wraps': { minutes: '6', when: 'after-the-final-warm-up' },
      },
    },
    progress: { ...EMPTY_PROGRESS, place: 'earlier-flight-running', flightSize: '14' },
    weights: [
      { index: 0, text: '60' },
      { index: 3, text: '132.5' },
    ],
    reps: [{ index: 0, text: '5' }],
  };

  const WARMED: SavedMeet = {
    ...MEET,
    state: {
      ...EMPTY_SAVED_STATE,
      warmup: toSavedWarmup({
        states: { ...EMPTY_WARMUP_STATES, squat: ANSWERED },
        lift: 'bench',
        byLifter: new Map([['lifter-2', { ...EMPTY_WARMUP_STATES, deadlift: ANSWERED }]]),
      }),
    },
  };

  /** A meet as a build that had never heard of §20's fold wrote it. */
  function beforeThereWasOne(state: SavedMeetState): Record<string, unknown> {
    const { warmup: _warmup, ...rest } = state;
    return rest;
  }

  it('comes back field for field, both paths and all', () => {
    // The whole object rather than a spot check, for §9.4's reason above and
    // one of its own: every figure here is typed text, so a field dropped at
    // the boundary is a blank box rather than an error, and the lifter's answer
    // is simply not there the next morning. The board half is the part most
    // likely to go missing, because a `Map` stringifies to `{}` in silence.
    const reading = readMeetFile(writeMeetFile([WARMED], NOW));

    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.file.meets[0]).toEqual(WARMED);
  });

  it('reads a meet saved before there was a warm-up to save', () => {
    // The `history` claim one release later, and it has to be true for the same
    // meets: a required field would fail every shelf written before §20 shipped
    // at the parser, which `#restoreReport` counts as unreadable.
    const older = readMeetFile(envelope({ ...MEET, state: beforeThereWasOne(EMPTY_SAVED_STATE) }));

    expect(refusal(older)).toBe('accepted');
    expect(older.ok ? older.file.meets[0]?.state.warmup : undefined).toBeNull();

    // The control, because "accepted" would also be what a parser that stopped
    // reading the state at all produced.
    const { openLifterId: _openLifterId, ...withoutARequiredKey } = EMPTY_SAVED_STATE;
    expect(refusal(readMeetFile(envelope({ ...MEET, state: withoutARequiredKey })))).toBe(
      'damaged',
    );
  });

  it('accepts a bar this build has no preset for', () => {
    // Why `barId` is free text rather than a picklist: the preset catalogue is
    // whatever this build happens to ship, so a file exported by a build with
    // one more bar in it would be refused whole -- over a field whose own reader
    // already falls back to the custom bar. The control is that the field is
    // still a string.
    //
    // The saved shape is spelled out here rather than built by `toSavedWarmup`,
    // for the reason the refusal below it is: the converter takes a
    // `WarmupAnswers`, whose `barId` is a `string`, so a test feeding it the
    // number that makes the control a control does not compile. Vitest strips
    // types and would have run it anyway -- `typecheck:tests` is what said so.
    function withBar(barId: unknown): string {
      return envelope({
        ...WARMED,
        state: {
          ...WARMED.state,
          warmup: {
            states: { ...EMPTY_WARMUP_STATES, squat: { ...ANSWERED, room: { ...ROOM, barId } } },
            lift: 'squat',
            byLifter: [],
          },
        },
      });
    }

    expect(refusal(readMeetFile(withBar('deadlift-bar-2029')))).toBe('accepted');
    expect(refusal(readMeetFile(withBar(20)))).toBe('damaged');
  });

  it('refuses a plate weight that is not a finite number', () => {
    // The one place in a saved meet where a number reaches arithmetic with no
    // parse in front of it. A bar or a plate of `Infinity` is caught nowhere
    // downstream: `planWarmup` answers a ramp of `Infinity` and no error at all.
    // JSON carries it as an exponent no `double` can hold, which is why this is
    // a substitution in the text rather than a value in an object literal --
    // `JSON.stringify(Infinity)` is `null`, and would test the wrong refusal.
    const text = envelope(WARMED);

    expect(refusal(readMeetFile(text))).toBe('accepted');
    expect(refusal(readMeetFile(text.replace('"weight":25', '"weight":1e999')))).toBe('damaged');
  });

  it('refuses answers outside the shapes the fold can produce', () => {
    function withState(state: Partial<Record<string, unknown>>): string {
      return envelope({
        ...MEET,
        state: {
          ...EMPTY_SAVED_STATE,
          warmup: {
            states: {
              ...EMPTY_WARMUP_STATES,
              squat: { ...EMPTY_WARMUP_STATE, ...state },
            },
            lift: 'squat',
            byLifter: [],
          },
        },
      });
    }

    // A control first: the same shape with nothing wrong in it.
    expect(refusal(readMeetFile(withState({})))).toBe('accepted');
    // A place the picker cannot answer.
    const elsewhere = withState({ progress: { ...EMPTY_PROGRESS, place: 'warming-up' } });
    expect(refusal(readMeetFile(elsewhere))).toBe('damaged');
    // More set answers than `SETS_BOUNDS.max` sets could ever have.
    const tooMany = Array.from({ length: SETS_BOUNDS.max + 1 }, (_unused, index) => ({
      index,
      text: '60',
    }));
    expect(refusal(readMeetFile(withState({ weights: tooMany })))).toBe('damaged');
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
