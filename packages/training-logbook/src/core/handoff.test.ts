// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The record the warm-up calculator leaves, read by a build that did not write it.
 *
 * Two claims. The first is that nothing a record says is taken on trust: it
 * arrives through storage any script on the origin can write to, so every
 * malformed shape below has to come out as the same `null`, and every string a
 * lifter reads afterwards has to have come from this build's own catalogue.
 *
 * The second is section 8.1 -- the ramp a handoff lands is the ramp the engine
 * would draw for those inputs, plus whatever the lifter typed over it. Not a
 * ramp carried in the record, which is why there is no ramp in the record.
 *
 * Every weight and plate here is invented (section 5.1).
 */

import { adjustWarmups, planWarmup } from '@platform-toolkit/domain';
import { describe, expect, it } from 'vitest';

import type { EquipmentSnapshot, HandoffExercise, WarmupHandoff } from '../types.js';

import { AT_START, ON_DAY, testContext } from './context.fixture.js';
import { DEFAULT_EQUIPMENT, toBarbellSetup } from './equipment.js';
import {
  HANDOFF_VERSION,
  createHandoff,
  handoffLifts,
  parseHandoff,
  serializeHandoff,
  workoutFromHandoff,
} from './handoff.js';

/** A rack nobody's defaults pick, so nothing can pass by resembling one. */
function aGym(): EquipmentSnapshot {
  return {
    barWeight: { amount: 20, unit: 'kg' },
    collarWeight: { amount: 5, unit: 'kg' },
    plateUnit: 'kg',
    plates: [
      { weight: 25, pairs: null, fullDiameter: true },
      { weight: 10, pairs: null, fullDiameter: true },
      { weight: 5, pairs: null, fullDiameter: false },
      { weight: 2.5, pairs: null, fullDiameter: false },
    ],
  };
}

function anExercise(overrides: Partial<HandoffExercise> = {}): HandoffExercise {
  return {
    exerciseId: 'squat',
    bar: null,
    workingWeight: 100,
    workingSets: 3,
    workingReps: 5,
    adjustments: [],
    ...overrides,
  };
}

function aRecord(
  exercises: readonly HandoffExercise[] = [anExercise()],
  equipment: EquipmentSnapshot = aGym(),
): WarmupHandoff {
  return createHandoff({ equipment, exercises }, AT_START);
}

/** What the engine answers for a record's lift, as totals in the rack's unit. */
function engineRamp(record: WarmupHandoff, entry: HandoffExercise): number[] {
  const result = planWarmup({
    setup: toBarbellSetup(record.equipment),
    family: 'squat-press',
    workingWeight: entry.workingWeight,
    workingSets: entry.workingSets,
    workingReps: entry.workingReps,
  });
  if (!result.ok) throw new Error('the engine refused a ramp this test needs.');
  return adjustWarmups(result.plan, entry.adjustments).warmups.flatMap((set) =>
    Array.from({ length: set.count }, () => set.loading.total),
  );
}

/** Every warm-up set's planned total, in order, for the first exercise. */
function landedRamp(record: WarmupHandoff): number[] {
  const landing = workoutFromHandoff(record, { localDate: ON_DAY, context: testContext() });
  if (landing === null) throw new Error('nothing landed.');
  const exercise = landing.session.exercises[0];
  if (exercise === undefined) throw new Error('the workout has no exercises.');
  return exercise.sets
    .filter((set) => set.kind === 'warmup')
    .map((set) => (set.planned?.load.kind === 'implement' ? set.planned.load.weight.amount : -1));
}

describe('reading a record', () => {
  it('reads back what it wrote', () => {
    const record = aRecord();

    expect(parseHandoff(serializeHandoff(record))).toEqual(record);
  });

  it('refuses text that is not JSON at all', () => {
    // The commonest thing in that key after a record is something else's data.
    expect(parseHandoff('not json')).toBeNull();
    expect(parseHandoff('')).toBeNull();
  });

  it('refuses a version it does not know', () => {
    // A record written by a newer calculator. Refused whole rather than read for
    // the fields it happens to share, because a partial read is how a lifter
    // gets a session missing the half this build did not recognise.
    const record = { ...aRecord(), version: HANDOFF_VERSION + 1 };

    expect(parseHandoff(JSON.stringify(record))).toBeNull();
  });

  it('refuses a record with no lifts in it', () => {
    expect(parseHandoff(JSON.stringify({ ...aRecord(), exercises: [] }))).toBeNull();
  });

  it('refuses weights and counts that would reach a loop or a plate search', () => {
    const cases = [
      anExercise({ workingSets: 0 }),
      anExercise({ workingSets: 5000 }),
      anExercise({ workingReps: 1.5 }),
      anExercise({ workingWeight: -10 }),
      anExercise({ workingWeight: 1e12 }),
    ];

    for (const entry of cases) {
      expect(parseHandoff(JSON.stringify(aRecord([entry])))).toBeNull();
    }
  });

  it('refuses a list longer than anything the calculator can build', () => {
    // Past the cap the writer trims to, so the only way to arrive here is for
    // something other than the calculator to have written the key.
    const many = Array.from({ length: 40 }, () => anExercise());

    expect(parseHandoff(JSON.stringify({ ...aRecord(), exercises: many }))).toBeNull();
  });

  it('refuses a number where the format wants a string, rather than coercing it', () => {
    // Section 2.4. The rest of the package's schemas say the same thing about a
    // backup file; this is the shape that arrives from somewhere else entirely.
    const record = { ...aRecord(), createdAt: 17 };

    expect(parseHandoff(JSON.stringify(record))).toBeNull();
  });

  it('trims a session longer than it can carry rather than refusing to hand it over', () => {
    const record = createHandoff(
      { equipment: aGym(), exercises: Array.from({ length: 40 }, () => anExercise()) },
      AT_START,
    );

    expect(record.exercises).toHaveLength(24);
    expect(parseHandoff(serializeHandoff(record))).not.toBeNull();
  });
});

describe('what the offer says it will do', () => {
  it('names every lift from the catalogue this build ships', () => {
    const lifts = handoffLifts(aRecord([anExercise({ exerciseId: 'bench-press' })]));

    expect(lifts).toEqual([
      {
        exerciseId: 'bench-press',
        name: 'Bench Press',
        weight: { amount: 100, unit: 'kg' },
        sets: 3,
        reps: 5,
      },
    ]);
  });

  it('leaves out a lift this build has never heard of', () => {
    // A record written by a calculator with a movement added after this page was
    // built. The offer has to promise what pressing it will actually produce, and
    // a card counting the record's entries would promise two lifts and land one.
    const lifts = handoffLifts(
      aRecord([anExercise(), anExercise({ exerciseId: 'invented-movement' })]),
    );

    expect(lifts.map((lift) => lift.exerciseId)).toEqual(['squat']);
  });

  it('says nothing at all where no lift in the record is known', () => {
    expect(handoffLifts(aRecord([anExercise({ exerciseId: 'invented-movement' })]))).toEqual([]);
  });
});

describe('landing a record as a workout', () => {
  it('arrives started, dated by the lifter, and marked where it came from', () => {
    const landing = workoutFromHandoff(aRecord(), {
      localDate: ON_DAY,
      context: testContext(),
    });

    expect(landing?.session.status).toBe('active');
    expect(landing?.session.localDate).toBe(ON_DAY);
    expect(landing?.session.source).toBe('warmup-calculator-handoff');
  });

  it('plans the working sets the lifter asked for', () => {
    const landing = workoutFromHandoff(aRecord([anExercise({ workingSets: 4 })]), {
      localDate: ON_DAY,
      context: testContext(),
    });
    const working = landing?.session.exercises[0]?.sets.filter((set) => set.kind === 'working');

    expect(working).toHaveLength(4);
    expect(working?.[0]?.planned?.load).toEqual({
      kind: 'implement',
      weight: { amount: 100, unit: 'kg' },
    });
  });

  it('builds the ramp the engine would have built for those inputs', () => {
    // The claim section 8.1 makes: not a ramp carried in the record, and not one
    // assembled here. If this file's arithmetic and the engine's ever disagree,
    // this is the assertion that says so rather than a hard-coded list that
    // would simply be updated.
    const record = aRecord();
    const entry = record.exercises[0];
    if (entry === undefined) throw new Error('the fixture has no lifts.');

    expect(landedRamp(record)).toEqual(engineRamp(record, entry));
  });

  it('keeps a rung the lifter typed over in the other tool', () => {
    // The one thing that cannot be recomputed, which is the whole reason the
    // adjustments travel. Index 2 is a middle rung -- the bar-only sets are not
    // adjustable, and `adjustWarmups` would drop an adjustment naming one.
    const record = aRecord([anExercise({ adjustments: [{ index: 2, total: 70 }] })]);

    expect(landedRamp(record)).toContain(70);
    expect(landedRamp(record)).not.toEqual(landedRamp(aRecord()));
  });

  it('freezes the adjusted ramp, not the one the lifter overrode', () => {
    // The stored snapshot is what section 8.4 froze, and the card is drawn from
    // it. Storing the engine's plan alongside separate overrides would leave the
    // two disagreeing the first time anything read the snapshot instead of the
    // sets.
    const record = aRecord([anExercise({ adjustments: [{ index: 2, total: 70 }] })]);
    const landing = workoutFromHandoff(record, { localDate: ON_DAY, context: testContext() });
    const totals = landing?.session.exercises[0]?.warmup?.plan.warmups.map(
      (set) => set.loading.total,
    );

    expect(totals).toContain(70);
  });

  it('uses a lift own bar over the rack default', () => {
    // A specialty bar on the squat and the rack's on everything else is ordinary,
    // and a single rack for all of them would ramp the wrong implement.
    const heavy = aRecord([anExercise({ bar: { amount: 30, unit: 'kg' } })]);

    expect(landedRamp(heavy)[0]).toBe(35); // 30 kg bar plus the gym's 5 kg collars.
    expect(landedRamp(aRecord())[0]).toBe(25);
  });

  it('skips a lift this build has never heard of and lands the rest', () => {
    const landing = workoutFromHandoff(
      aRecord([anExercise({ exerciseId: 'invented-movement' }), anExercise()]),
      { localDate: ON_DAY, context: testContext() },
    );

    expect(landing?.session.exercises.map((exercise) => exercise.exerciseId)).toEqual(['squat']);
  });

  it('answers with nothing where no lift in the record is known', () => {
    // A record worth nothing to this build is a record to forget, not an empty
    // workout to put a lifter in front of.
    const landing = workoutFromHandoff(aRecord([anExercise({ exerciseId: 'invented-movement' })]), {
      localDate: ON_DAY,
      context: testContext(),
    });

    expect(landing).toBeNull();
  });

  it('lands a lift with no ramp available, and names it', () => {
    // Zero is inside what the format allows and outside what the engine will
    // plan for. Refusing the lift would lose a session over a warm-up; the
    // working sets are the lifter's own numbers either way.
    const landing = workoutFromHandoff(aRecord([anExercise({ workingWeight: 0 })]), {
      localDate: ON_DAY,
      context: testContext(),
    });

    expect(landing?.unramped).toEqual(['Squat']);
    expect(landing?.session.exercises[0]?.warmup).toBeNull();
    expect(landing?.session.exercises[0]?.sets).toHaveLength(3);
  });

  it('says nothing about a lift that was never going to have a ramp', () => {
    // A chin-up has no warm-up family, so there is no ramp missing and nothing to
    // tell anybody. A tool that listed it beside a genuine failure would be
    // reporting the absence of a thing it never offers.
    const landing = workoutFromHandoff(aRecord([anExercise({ exerciseId: 'chin-up' })]), {
      localDate: ON_DAY,
      context: testContext(),
    });

    expect(landing?.unramped).toEqual([]);
    expect(landing?.session.exercises[0]?.sets).toHaveLength(3);
  });

  it('names every lift from the catalogue rather than from the record', () => {
    const landing = workoutFromHandoff(aRecord(), {
      localDate: ON_DAY,
      context: testContext(),
    });

    expect(landing?.session.exercises[0]?.displayName).toBe('Squat');
  });

  it('mints an identifier for every set it lands', () => {
    // `addExercise` is what names things, and reading the added exercise back off
    // the end of the list is what keeps it that way. A duplicate here would be
    // this file having invented an identity of its own.
    const landing = workoutFromHandoff(
      aRecord([anExercise(), anExercise({ exerciseId: 'deadlift' })]),
      {
        localDate: ON_DAY,
        context: testContext(),
      },
    );
    const ids = (landing?.session.exercises ?? []).flatMap((exercise) => [
      exercise.id,
      ...exercise.sets.map((set) => set.id),
    ]);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ramps against the rack in the record and not the catalogue default', () => {
    // The default is pounds and this gym is kilograms. A landing that reached for
    // `DEFAULT_EQUIPMENT` would produce a plausible ramp of entirely wrong
    // numbers, which is the failure nobody catches until the bar comes off the
    // rack.
    const landing = workoutFromHandoff(aRecord(), { localDate: ON_DAY, context: testContext() });

    expect(landing?.session.exercises[0]?.warmup?.equipment).toEqual(aGym());
    expect(DEFAULT_EQUIPMENT.plateUnit).toBe('lb');
  });
});
