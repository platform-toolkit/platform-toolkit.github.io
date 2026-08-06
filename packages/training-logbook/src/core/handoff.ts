// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The warm-up calculator's session, landed as a workout. Section 4.3.
 *
 * WHY A RECORD OF INPUTS AND NOT A WORKOUT
 *
 * The obvious handoff is a `WorkoutSession`: the calculator knows every set it
 * drew, and this package can already read one. It would also be the logbook
 * accepting a whole document from outside its own database, and the two tools
 * are not guaranteed to be the same build -- an embedded calculator on somebody
 * else's page, a tab left open across a deploy. Section 8.1 forbids forking the
 * ramp algorithm; a record carrying computed sets is that fork with a delivery
 * mechanism attached, and the symptom would be a warm-up on the logging screen
 * that this build's engine would never have produced and cannot explain.
 *
 * So the record carries what the lifter *chose* -- the rack, the lifts, the
 * working weights -- and the ramp is built here, by this build, through the
 * same {@link warmupChange} every other caller uses. The one thing that cannot
 * be recomputed is the weight a lifter typed over a generated set, so the
 * adjustments travel with it.
 *
 * WHAT DOES NOT CROSS, AND WHY EACH IS DROPPED RATHER THAN REPAIRED
 *
 *   - A lift the calculator's user named themselves. It has no catalogue
 *     identifier, and the alternative -- carrying the name -- would let a
 *     record put an arbitrary string on this screen. The calculator names those
 *     lifts in a sentence before the lifter leaves, which is the only place the
 *     fact is any use.
 *   - An identifier this build's catalogue does not know. A record written by a
 *     newer calculator can name a lift added after this page was built.
 *   - A ramp the engine will not produce for the rack in the record -- a
 *     working weight at or below the bar, a rack with no plates. The lift still
 *     lands with its working sets, because those are the lifter's own numbers
 *     and refusing them would lose the session over a warm-up.
 */

import type { Weight } from '@platform-toolkit/domain';
import * as v from 'valibot';

import type {
  CalendarDay,
  EquipmentSnapshot,
  HandoffExercise,
  Instant,
  WarmupHandoff,
  WorkoutSession,
} from '../types.js';

import { findExercise, loadFor, warmupFamilyFor } from './catalog.js';
import {
  CountSchema,
  EquipmentSnapshotSchema,
  FiniteSchema,
  IdentifierSchema,
  InstantSchema,
  WeightSchema,
} from './schema.js';
import {
  addExercise,
  createWorkout,
  performance,
  startWorkout,
  type PlannedSet,
  type SessionContext,
} from './session.js';
import { applyWarmup, warmupChange } from './warmup.js';

/**
 * The record format this build writes and the only one it reads.
 *
 * A record from the future is refused whole rather than read for the fields it
 * happens to share. Section 19.2's rule for the database, applied to the one
 * shape that arrives from another page: a partial read of an unknown format is
 * how a lifter gets a session missing the half this build did not recognise.
 */
export const HANDOFF_VERSION = 1;

/**
 * Bounds on a record this package did not write.
 *
 * The rest of the package validates what came out of its own database and can
 * be brief about it. This is the one shape that arrives through storage any
 * script on the origin can write to, and every field below reaches a loop, an
 * array length or a plate search. The numbers are slack rather than product
 * limits -- the calculator's own list is capped at twenty-four rows and the
 * engine's longest ramp is seven -- so nothing a lifter can actually build is
 * refused here.
 */
const MAX_HANDOFF_EXERCISES = 24;
const MAX_HANDOFF_ADJUSTMENTS = 16;
const MAX_HANDOFF_SETS = 20;
const MAX_HANDOFF_REPS = 100;
const MAX_HANDOFF_WEIGHT = 100_000;

const AdjustmentSchema = v.object({
  index: v.pipe(CountSchema, v.maxValue(MAX_HANDOFF_ADJUSTMENTS)),
  total: v.pipe(FiniteSchema, v.minValue(0), v.maxValue(MAX_HANDOFF_WEIGHT)),
});

const HandoffExerciseSchema: v.GenericSchema<HandoffExercise> = v.object({
  exerciseId: IdentifierSchema,
  bar: v.nullable(WeightSchema),
  workingWeight: v.pipe(FiniteSchema, v.minValue(0), v.maxValue(MAX_HANDOFF_WEIGHT)),
  workingSets: v.pipe(CountSchema, v.minValue(1), v.maxValue(MAX_HANDOFF_SETS)),
  workingReps: v.pipe(CountSchema, v.minValue(1), v.maxValue(MAX_HANDOFF_REPS)),
  adjustments: v.pipe(v.array(AdjustmentSchema), v.maxLength(MAX_HANDOFF_ADJUSTMENTS)),
});

const WarmupHandoffSchema: v.GenericSchema<WarmupHandoff> = v.object({
  version: v.literal(HANDOFF_VERSION),
  createdAt: InstantSchema,
  equipment: EquipmentSnapshotSchema,
  exercises: v.pipe(
    v.array(HandoffExerciseSchema),
    v.minLength(1),
    v.maxLength(MAX_HANDOFF_EXERCISES),
  ),
});

/** What a calculator hands over, before it is stamped. */
export interface HandoffContent {
  readonly equipment: EquipmentSnapshot;
  readonly exercises: readonly HandoffExercise[];
}

/**
 * Stamps a record. The instant is the caller's; nothing here reads a clock.
 *
 * Trimming to the cap rather than refusing, because the writer is the tool the
 * lifter is standing in front of: a session of thirty lifts should hand over
 * the twenty-four that fit rather than silently do nothing.
 */
export function createHandoff(content: HandoffContent, at: Instant): WarmupHandoff {
  return {
    version: HANDOFF_VERSION,
    createdAt: at,
    equipment: content.equipment,
    exercises: content.exercises.slice(0, MAX_HANDOFF_EXERCISES),
  };
}

export function serializeHandoff(record: WarmupHandoff): string {
  return JSON.stringify(record);
}

/**
 * Reads a record, or `null` for anything this build cannot use.
 *
 * One answer for every kind of failure -- not JSON, not this shape, a version
 * this build does not know -- because there is exactly one thing to do with all
 * of them, which is to forget the record and show the home screen. A lifter who
 * never asked for a handoff must not meet an error about one, and a lifter who
 * did still has the calculator tab they pressed it in.
 */
export function parseHandoff(text: string): WarmupHandoff | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = v.safeParse(WarmupHandoffSchema, parsed);
  return result.success ? result.output : null;
}

/** One line of the offer: what the logbook would log, in the logbook's words. */
export interface HandoffLift {
  readonly exerciseId: string;
  /** From this build's catalogue. Never a string carried by the record. */
  readonly name: string;
  readonly weight: Weight;
  readonly sets: number;
  readonly reps: number;
}

/**
 * The lifts a record would actually land, named from this build's catalogue.
 *
 * The offer has to describe what pressing it will do, and that is not quite
 * what the record says: an unknown identifier lands nothing. Reading the offer
 * from the same lookup the landing uses is what keeps the two in step -- a card
 * counting the record's entries would promise four lifts and produce three.
 *
 * An empty answer means the record is worth nothing to this build, which is a
 * record to forget rather than a screen to draw.
 */
export function handoffLifts(record: WarmupHandoff): readonly HandoffLift[] {
  return record.exercises.flatMap((entry) => {
    const option = findExercise(entry.exerciseId);
    if (option === null) return [];
    return [
      {
        exerciseId: option.id,
        name: option.name,
        weight: { amount: entry.workingWeight, unit: record.equipment.plateUnit },
        sets: entry.workingSets,
        reps: entry.workingReps,
      },
    ];
  });
}

/** A workout built from a record, and what it could not do. */
export interface HandoffLanding {
  readonly session: WorkoutSession;
  /**
   * Lifts that landed with their working sets and no warm-up.
   *
   * Named rather than counted, because the sentence a lifter needs at a rack is
   * which lift has no ramp under it. Empty in the ordinary case.
   */
  readonly unramped: readonly string[];
}

export interface HandoffLandingOptions {
  /** The lifter's own calendar day. Never derived from `context.at`. */
  readonly localDate: CalendarDay;
  readonly context: SessionContext;
}

/**
 * Builds a started workout from a record, or `null` where nothing lands.
 *
 * Started, and not left as a draft. The lifter pressed a button that said they
 * are about to train; a session that arrived needing a second Start would be
 * asking them to confirm the thing they just confirmed, at the rack, with the
 * bar loaded.
 *
 * The ramp goes through {@link warmupChange} and {@link applyWarmup} rather
 * than being assembled here, which is what puts the handoff on the same path as
 * every other generated warm-up: one snapshot format, one insertion order, one
 * set of engine versions frozen into the record.
 */
export function workoutFromHandoff(
  record: WarmupHandoff,
  options: HandoffLandingOptions,
): HandoffLanding | null {
  const { context } = options;
  let session = createWorkout(context, {
    localDate: options.localDate,
    source: 'warmup-calculator-handoff',
  });
  const unramped: string[] = [];
  let landed = 0;

  for (const entry of record.exercises) {
    const option = findExercise(entry.exerciseId);
    if (option === null) continue;

    // The lift's own bar over the rack's, which is the whole of the difference
    // between the two -- see `snapshotFrom`. Built per lift rather than once,
    // because a session mixing a specialty bar with a standard one is ordinary
    // and a single rack for all of them would ramp the wrong implement.
    const equipment: EquipmentSnapshot =
      entry.bar === null ? record.equipment : { ...record.equipment, barWeight: entry.bar };
    const load = loadFor(option.loading, {
      amount: entry.workingWeight,
      unit: equipment.plateUnit,
    });
    const plan: readonly PlannedSet[] = Array.from(
      { length: entry.workingSets },
      (): PlannedSet => ({ kind: 'working', performance: performance(load, entry.workingReps) }),
    );

    session = addExercise(session, context, {
      exerciseId: option.id,
      displayName: option.name,
      loading: option.loading,
      plan,
    });
    landed += 1;

    // `addExercise` appends and mints the identifier itself, so the exercise
    // just added is the last one. Reading it back rather than threading an id
    // out of the core keeps the identifier generator the only thing that names
    // anything.
    const added = session.exercises[session.exercises.length - 1];
    const family = warmupFamilyFor(option);
    if (added === undefined || family === null) continue;

    const change = warmupChange(
      session,
      added.id,
      {
        family,
        equipment,
        workingWeight: entry.workingWeight,
        workingSets: entry.workingSets,
        workingReps: entry.workingReps,
        adjustments: entry.adjustments,
      },
      context,
    );
    if (change?.ok === true) {
      session = applyWarmup(session, added.id, change.change, context);
    } else {
      unramped.push(option.name);
    }
  }

  if (landed === 0) return null;
  return { session: startWorkout(session, context), unramped };
}
