// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The persisted vocabulary, as runtime schemas.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * One trust boundary: a JSON file the lifter chose from their own disk. Everything
 * else this package reads it wrote itself, and a schema over a database it owns
 * would be ceremony. A backup file is different -- it may have been written by an
 * older build, by a future one, by a text editor, or by somebody who renamed a
 * `.txt`. Section 10.7 requires the format identifier and the schema to be
 * validated before anything is written, and this is that check.
 *
 * EVERY SCHEMA IS ANNOTATED WITH THE INTERFACE IT DESCRIBES
 *
 * `v.GenericSchema<WorkoutSession>` and its neighbours are not decoration. Without
 * the annotation a schema and its interface drift the first time a field is added
 * to one of them, and the drift is silent in the worst direction: restore quietly
 * discards a field the rest of the package expects to be there. With it, adding a
 * field to `types.ts` and forgetting it here is a compile error.
 *
 * NOTHING HERE COERCES
 *
 * Section 2.4. A weight that arrives as the string `"100"` is rejected, not turned
 * into a number -- a file that disagrees with the format about what a number is
 * disagrees about other things too, and a restore that repaired it would be
 * guessing at a lifter's training history.
 */

import type {
  BarbellSetup,
  Loading,
  PlateChange,
  PlateDenomination,
  WarmupPlan,
  WarmupSet,
  Weight,
  WorkingSetPlan,
} from '@platform-toolkit/domain';
import * as v from 'valibot';

import type {
  CustomExercise,
  Effort,
  EquipmentProfile,
  EquipmentSnapshot,
  LogbookSettings,
  RestTimerSettings,
  SetLoad,
  SetPerformance,
  WarmupSnapshot,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

/** A non-empty opaque identifier. Never parsed; only compared. */
const IdentifierSchema = v.pipe(v.string(), v.minLength(1));

/**
 * A calendar day as `YYYY-MM-DD`.
 *
 * Shape only. Whether the thirtieth of February exists is a question for whoever
 * displays it; a restore that refused the whole file over one impossible day
 * would lose a lifter's entire history to a typo in one row.
 */
const CalendarDaySchema = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/u));

/**
 * An instant.
 *
 * Deliberately not a strict ISO 8601 pattern. `workoutDurationMillis` already
 * treats a stamp it cannot read as "unknown duration" rather than as an error, so
 * the strictness here would buy nothing and would reject a file another tool
 * wrote with a slightly different serialiser.
 */
const InstantSchema = v.pipe(v.string(), v.minLength(1));

/** A finite number. Rejects `NaN` and both infinities, which JSON cannot carry anyway. */
const FiniteSchema = v.pipe(v.number(), v.finite());

/** A count of things: whole, and not negative. */
const CountSchema = v.pipe(v.number(), v.integer(), v.minValue(0));

const WeightUnitSchema = v.picklist(['kg', 'lb'] as const);

const WeightSchema: v.GenericSchema<Weight> = v.object({
  amount: FiniteSchema,
  unit: WeightUnitSchema,
});

const SetLoadSchema: v.GenericSchema<SetLoad> = v.variant('kind', [
  v.object({ kind: v.literal('none') }),
  v.object({ kind: v.literal('implement'), weight: WeightSchema }),
  v.object({ kind: v.literal('added'), weight: WeightSchema }),
  v.object({ kind: v.literal('assisted'), weight: WeightSchema }),
]);

const EffortSchema: v.GenericSchema<Effort> = v.object({
  scale: v.picklist(['rpe', 'rir'] as const),
  value: FiniteSchema,
});

const SetPerformanceSchema: v.GenericSchema<SetPerformance> = v.object({
  load: SetLoadSchema,
  repetitions: v.nullable(CountSchema),
  effort: v.nullable(EffortSchema),
});

const WorkoutSetSchema: v.GenericSchema<WorkoutSet> = v.object({
  id: IdentifierSchema,
  kind: v.picklist(['warmup', 'working', 'backoff', 'amrap', 'accessory'] as const),
  planned: v.nullable(SetPerformanceSchema),
  performed: v.nullable(SetPerformanceSchema),
  status: v.picklist(['planned', 'complete', 'incomplete', 'skipped'] as const),
  completedAt: v.nullable(InstantSchema),
  note: v.nullable(v.string()),
});

const WarmupFamilySchema = v.picklist([
  'squat-press',
  'deadlift',
  'pull',
  'olympic',
  'assistance',
] as const);

const PlateDenominationSchema: v.GenericSchema<PlateDenomination> = v.object({
  weight: FiniteSchema,
  pairs: v.nullable(CountSchema),
  fullDiameter: v.boolean(),
});

const BarbellSetupSchema: v.GenericSchema<BarbellSetup> = v.object({
  plateUnit: WeightUnitSchema,
  bar: WeightSchema,
  collars: WeightSchema,
  plates: v.array(PlateDenominationSchema),
});

const LoadingSchema: v.GenericSchema<Loading> = v.object({
  total: FiniteSchema,
  perSide: v.array(FiniteSchema),
});

const PlateChangeSchema: v.GenericSchema<PlateChange> = v.object({
  removed: v.array(FiniteSchema),
  added: v.array(FiniteSchema),
});

const WarmupSetSchema: v.GenericSchema<WarmupSet> = v.object({
  stage: v.picklist(['empty-implement', 'first', 'middle', 'inserted', 'final'] as const),
  loading: LoadingSchema,
  reps: CountSchema,
  count: CountSchema,
  change: PlateChangeSchema,
});

const WorkingSetPlanSchema: v.GenericSchema<WorkingSetPlan> = v.object({
  total: FiniteSchema,
  sets: CountSchema,
  reps: CountSchema,
  load: v.variant('kind', [
    v.object({ kind: v.literal('loadable'), loading: LoadingSchema }),
    v.object({
      kind: v.literal('not-loadable'),
      below: v.nullable(LoadingSchema),
      above: v.nullable(LoadingSchema),
    }),
  ]),
  change: v.nullable(PlateChangeSchema),
});

/**
 * A stored warm-up plan, validated in full rather than trusted.
 *
 * It is tempting to wave this through -- the engine produced it, after all. It did
 * not: a backup file produced it, and the plan is rendered as plate instructions
 * at a rack. A `perSide` array holding a string would reach a display that adds
 * numbers together, and the failure would be a lifter reading `2510` off a screen.
 */
const WarmupPlanSchema: v.GenericSchema<WarmupPlan> = v.object({
  family: WarmupFamilySchema,
  setup: BarbellSetupSchema,
  emptyImplement: LoadingSchema,
  warmups: v.array(WarmupSetSchema),
  working: WorkingSetPlanSchema,
  advisories: v.array(
    v.object({
      code: v.picklist([
        'working-weight-not-loadable',
        'working-weight-at-or-below-implement',
        'no-plates-available',
        'full-diameter-unavailable',
        'jump-exceeds-full-plate',
      ] as const),
    }),
  ),
});

const EquipmentSnapshotSchema: v.GenericSchema<EquipmentSnapshot> = v.object({
  barWeight: WeightSchema,
  collarWeight: WeightSchema,
  plateUnit: WeightUnitSchema,
  plates: v.array(PlateDenominationSchema),
});

const WarmupSnapshotSchema: v.GenericSchema<WarmupSnapshot> = v.object({
  plan: WarmupPlanSchema,
  equipment: EquipmentSnapshotSchema,
  engineVersion: v.string(),
  rulesetVersion: v.string(),
  generatedAt: InstantSchema,
});

const LoadingModelSchema = v.picklist([
  'barbell-total-weight',
  'bodyweight',
  'bodyweight-plus-added-weight',
  'assisted-bodyweight',
  'machine-or-cable-weight',
  'repetitions-only',
  'custom-weight-reps',
] as const);

const WorkoutExerciseSchema: v.GenericSchema<WorkoutExercise> = v.object({
  id: IdentifierSchema,
  exerciseId: IdentifierSchema,
  displayName: v.string(),
  loading: LoadingModelSchema,
  warmup: v.nullable(WarmupSnapshotSchema),
  note: v.nullable(v.string()),
  sets: v.array(WorkoutSetSchema),
});

/** One workout, validated whole. */
export const WorkoutSessionSchema: v.GenericSchema<WorkoutSession> = v.object({
  id: IdentifierSchema,
  schemaVersion: CountSchema,
  status: v.picklist(['draft', 'active', 'completed', 'discarded'] as const),
  localDate: CalendarDaySchema,
  startedAt: v.nullable(InstantSchema),
  completedAt: v.nullable(InstantSchema),
  title: v.nullable(v.string()),
  note: v.nullable(v.string()),
  exercises: v.array(WorkoutExerciseSchema),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  source: v.picklist([
    'manual',
    'repeated-workout',
    'warmup-calculator-handoff',
    'toolkit-import',
    'json-restore',
  ] as const),
});

/** An exercise a lifter invented. */
export const CustomExerciseSchema: v.GenericSchema<CustomExercise> = v.object({
  id: IdentifierSchema,
  name: v.string(),
  loading: LoadingModelSchema,
  warmupFamily: v.nullable(WarmupFamilySchema),
  defaultUnit: v.nullable(WeightUnitSchema),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});

/** A named equipment profile: one gym's bar, collars and plates. */
export const EquipmentProfileSchema: v.GenericSchema<EquipmentProfile> = v.object({
  id: IdentifierSchema,
  name: v.string(),
  equipment: EquipmentSnapshotSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});

const RestTimerSettingsSchema: v.GenericSchema<RestTimerSettings> = v.object({
  enabled: v.boolean(),
  defaultSeconds: CountSchema,
  perExerciseSeconds: v.record(v.string(), CountSchema),
});

/** Everything a lifter has chosen about how the logbook behaves. */
export const LogbookSettingsSchema: v.GenericSchema<LogbookSettings> = v.object({
  schemaVersion: CountSchema,
  displayUnit: WeightUnitSchema,
  effort: v.picklist(['none', 'rpe', 'rir'] as const),
  restTimer: RestTimerSettingsSchema,
  equipment: v.nullable(EquipmentSnapshotSchema),
  acceptedTerms: v.record(v.string(), v.string()),
  lastBackupAt: v.nullable(InstantSchema),
});
