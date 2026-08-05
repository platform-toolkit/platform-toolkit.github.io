// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The vocabulary of a training log: what was planned, what was performed, and
 * the difference between the two.
 *
 * THE ONE RULE EVERY TYPE HERE SERVES
 *
 * A plan and a performance are different facts about the same set, and this file
 * exists so that no amount of later editing can collapse them into one. A lifter
 * who wrote 225 x 5 and got 225 x 4 has two true statements about that set, and a
 * logbook that keeps only the second one has thrown away what they were trying to
 * do -- which is the half a coach reads first. So `WorkoutSet` carries `planned`
 * and `performed` side by side, both nullable, and nothing in this package
 * assigns one from the other except `completeSet` in `../core/session.ts`, which
 * copies the plan into the result and says so in its own documentation.
 *
 * WHY THE UNIONS
 *
 * Three fields here are unions where the obvious design is a bag of optional
 * fields, and in all three cases the bag admits a state that is not a fact about
 * a human being lifting something:
 *
 *   - {@link SetLoad}. A weighted chin-up has weight *added* to a body; an
 *     assisted chin-up has weight *taken off* one; a leg press has a number on a
 *     stack. Three optional mass fields let all three be set at once, and there
 *     is no set in the world that is all three.
 *   - {@link Effort}. RPE 8 and RIR 8 are near-opposite claims -- one is close to
 *     failure, the other is eight reps clear of it. Two optional numbers let a
 *     row carry both, and the screen would then have to pick one to believe.
 *   - {@link SetStatus}. Four members where section 7.4 enumerates five; see the
 *     note on the type for why the fifth is derived rather than stored.
 *
 * WHY A CALENDAR DAY IS A STRING AND AN INSTANT IS NOT
 *
 * `localDate` is the day the lifter says they trained, in their own calendar, and
 * it is a `YYYY-MM-DD` string. `new Date('2026-08-05')` is midnight UTC, which is
 * the fourth of August anywhere west of Greenwich -- so a workout logged at nine
 * on a Tuesday evening in California would file itself under Monday. The instants
 * (`startedAt`, `completedAt`, `createdAt`, `updatedAt`) are genuinely points in
 * time and are ISO 8601 strings with an offset, because "how long did that
 * session take" is a question about instants and not about calendars.
 */

import type {
  PlateDenomination,
  WarmupFamily,
  WarmupPlan,
  Weight,
  WeightUnit,
} from '@platform-toolkit/domain';

/**
 * A calendar day as `YYYY-MM-DD`.
 *
 * The same alias, for the same reason, as the one in the qualification-check
 * package. Deliberately not shared between them yet: they are two packages that
 * happen to agree, and hoisting an alias into `domain` to save eight characters
 * would couple a training log to a rulebook reader.
 */
export type CalendarDay = string;

/** A point in time, ISO 8601 with an offset. Never a `Date`; see the header. */
export type Instant = string;

/**
 * An opaque identifier.
 *
 * Opaque in the ordinary sense -- nothing may parse one, sort by one, or infer a
 * date from one. Section 11.3 forbids array indexes and dates as identity, and
 * the reason is restore: two backups merged by a future version have to be able
 * to tell two sets apart when both were the third set of a squat on the same
 * Tuesday.
 */
export type LogbookId = string;

/**
 * How an exercise is loaded, declared rather than guessed from its name.
 *
 * Section 6.3. The UI reads this to decide what to ask for, and the catalogue
 * declares it for every exercise including the ones a lifter invents -- "Do not
 * infer a warm-up algorithm from a custom name" is the same rule seen from the
 * other end. A tool that pattern-matched "chin-up" would ask an assisted
 * chin-up's user for the weight they lifted and record the machine's counterweight
 * as though it were load.
 */
export type LoadingModel =
  /** A barbell, loaded to a total including the bar and collars. */
  | 'barbell-total-weight'
  /** Bodyweight alone. Reps are the whole record. */
  | 'bodyweight'
  /** Bodyweight with weight hung, held, or worn. */
  | 'bodyweight-plus-added-weight'
  /** Bodyweight with a machine or band taking weight off. */
  | 'assisted-bodyweight'
  /** The number on a stack, a plate-loaded machine, or a cable. */
  | 'machine-or-cable-weight'
  /** No load is meaningful. Reps only. */
  | 'repetitions-only'
  /** A weight and reps whose meaning only the lifter knows. */
  | 'custom-weight-reps';

/**
 * What a load *means* for a set, once the loading model has been read.
 *
 * Four kinds rather than seven, because several loading models ask the same
 * question of the lifter. What separates the kinds is arithmetic and wording,
 * not equipment: `added` and `assisted` are the same number with opposite signs
 * against a body, and a screen that treated them alike would tell somebody they
 * had pulled 40 kg when a machine had lifted it for them.
 */
export type SetLoad =
  /** Nothing to record. Bodyweight and reps-only sets. */
  | { readonly kind: 'none' }
  /** The number on the implement: a barbell total, a stack, a cable. */
  | { readonly kind: 'implement'; readonly weight: Weight }
  /** Weight added to a body. */
  | { readonly kind: 'added'; readonly weight: Weight }
  /** Weight taken off a body by a machine or a band. */
  | { readonly kind: 'assisted'; readonly weight: Weight };

/** Which of the four shapes a loading model asks for. */
export type SetLoadKind = SetLoad['kind'];

/** The two effort scales, and never both at once. */
export type EffortScale = 'rpe' | 'rir';

/**
 * How hard a set was, on whichever scale the lifter turned on.
 *
 * Recorded and never interpreted. Section 15.3 and section 16.1: this package
 * stores an 8 and does not conclude anything from it, because concluding is
 * programming and programming is a different tool.
 */
export interface Effort {
  readonly scale: EffortScale;
  readonly value: number;
}

/** Where a set sits in a session. Section 7.3. */
export type SetKind =
  /** Generated or entered ramp work below the working weight. */
  | 'warmup'
  /** The prescribed work. */
  | 'working'
  /** Deliberately lighter work after the working sets. */
  | 'backoff'
  /** As many reps as possible. */
  | 'amrap'
  /** Assistance work. */
  | 'accessory';

/**
 * What became of a set. Section 7.4.
 *
 * Four states, not the five the requirements enumerate, and the missing one is
 * the point: "completed as planned" and "completed with an edited result" are
 * both `complete`, and which one a row is gets *derived* by comparing `planned`
 * with `performed` rather than stored. A stored flag is a third copy of a fact
 * the other two fields already carry, and the first edit that forgot to update it
 * would show a row as untouched while displaying a different number.
 */
export type SetStatus =
  /** Written down, not yet done. */
  | 'planned'
  /** Done. `performed` says what actually happened. */
  | 'complete'
  /** Attempted and not finished. `performed` may record the reps that were made. */
  | 'incomplete'
  /** Deliberately not done. Section 15.3: this is not a failure and is not scored. */
  | 'skipped';

/** A weight and a rep count, either planned or performed. */
export interface SetPerformance {
  readonly load: SetLoad;
  /**
   * Whole reps. `null` where the lifter has not said -- an incomplete set with
   * no count is "it did not happen", which is different from zero reps and
   * different again from a count nobody typed.
   */
  readonly repetitions: number | null;
  readonly effort: Effort | null;
}

/** One set of one exercise. */
export interface WorkoutSet {
  readonly id: LogbookId;
  readonly kind: SetKind;
  /** What the lifter meant to do. `null` for a set added mid-session. */
  readonly planned: SetPerformance | null;
  /** What happened. `null` until the set is completed or edited. */
  readonly performed: SetPerformance | null;
  readonly status: SetStatus;
  /** When it was ticked off, where that is known. */
  readonly completedAt: Instant | null;
  readonly note: string | null;
}

/**
 * The equipment a warm-up was generated against, kept with the workout.
 *
 * A snapshot rather than a reference to the lifter's current equipment profile.
 * Somebody who trains at two gyms changes their plates between sessions, and a
 * history that read today's profile would redraw last month's plate loading with
 * plates that were not in that building.
 */
export interface EquipmentSnapshot {
  readonly barWeight: Weight;
  readonly collarWeight: Weight;
  readonly plateUnit: WeightUnit;
  /**
   * The rack, largest denomination first, in `plateUnit`.
   *
   * The domain's own denomination rather than a bare number, because two of its
   * three fields decide what the ramp does. `fullDiameter` is how high the bar
   * sits off the floor, which is the whole difference between a deadlift warm-up
   * and a rack pull; `pairs` is whether the plate runs out halfway up. A list of
   * numbers would have to be widened back into this the moment section 8.3 was
   * read, and the widening would be a migration rather than an edit.
   */
  readonly plates: readonly PlateDenomination[];
}

/**
 * A gym, saved under a name.
 *
 * Separate from the snapshot in {@link LogbookSettings} on purpose, and the two
 * are not the same fact written twice. This is the library -- the two or three
 * places a lifter trains -- and the one in settings is the setup currently in use,
 * copied rather than referenced so that deleting a profile cannot strand a lifter
 * mid-session with no bar weight.
 */
export interface EquipmentProfile {
  readonly id: LogbookId;
  readonly name: string;
  readonly equipment: EquipmentSnapshot;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/**
 * A generated warm-up, frozen at the moment it was generated.
 *
 * Section 8.4, and the sentence in it that governs this whole type: *this
 * prevents future algorithm changes from rewriting the historical record*. The
 * plan is stored whole -- sets, plates, advisories -- alongside the version of
 * the engine that produced it, so a percentage changed next year alters what the
 * calculator suggests tomorrow and alters nothing a lifter has already done.
 */
export interface WarmupSnapshot {
  readonly plan: WarmupPlan;
  readonly equipment: EquipmentSnapshot;
  /** The version of the package whose engine produced `plan`. */
  readonly engineVersion: string;
  /** The version of the warm-up rules within that engine. */
  readonly rulesetVersion: string;
  readonly generatedAt: Instant;
}

/** One exercise within one workout, with its sets in order. */
export interface WorkoutExercise {
  readonly id: LogbookId;
  /** Catalogue or custom exercise identifier. */
  readonly exerciseId: string;
  /**
   * The exercise's name as it read on the day.
   *
   * Snapshotted because a custom exercise can be renamed and a catalogue entry
   * can be reworded, and neither should silently retitle a session somebody
   * already did.
   */
  readonly displayName: string;
  readonly loading: LoadingModel;
  readonly warmup: WarmupSnapshot | null;
  readonly note: string | null;
  readonly sets: readonly WorkoutSet[];
}

/** Where a workout came from. Section 11.5: provenance, not an integration API. */
export type WorkoutSource =
  'manual' | 'repeated-workout' | 'warmup-calculator-handoff' | 'toolkit-import' | 'json-restore';

/** A workout's place in its own lifecycle. Section 7.1. */
export type WorkoutStatus = 'draft' | 'active' | 'completed' | 'discarded';

/** One session, planned or performed. */
export interface WorkoutSession {
  readonly id: LogbookId;
  readonly schemaVersion: number;
  readonly status: WorkoutStatus;
  /** The lifter's own calendar day. See the header. */
  readonly localDate: CalendarDay;
  readonly startedAt: Instant | null;
  readonly completedAt: Instant | null;
  readonly title: string | null;
  readonly note: string | null;
  readonly exercises: readonly WorkoutExercise[];
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly source: WorkoutSource;
}

/**
 * An exercise a lifter invented.
 *
 * `warmupFamily` is `null` unless the lifter explicitly chose one, and that is
 * section 6.4's rule spelled as a type: warm-up generation is opt-in per custom
 * exercise, and the family is a thing they picked rather than a thing this
 * package worked out from the name they typed.
 */
export interface CustomExercise {
  readonly id: LogbookId;
  readonly name: string;
  readonly loading: LoadingModel;
  readonly warmupFamily: WarmupFamily | null;
  readonly defaultUnit: WeightUnit | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** The rest timer's settings. Section 7.11: simple, and deliberately not an interval engine. */
export interface RestTimerSettings {
  readonly enabled: boolean;
  /** Whole seconds. */
  readonly defaultSeconds: number;
  /** Per exercise, in whole seconds. Absent means the default. */
  readonly perExerciseSeconds: Readonly<Record<string, number>>;
}

/** How effort is entered, if at all. Section 7.10: `none` is the first-use default. */
export type EffortSetting = 'none' | EffortScale;

/** Everything a lifter has chosen about how the logbook behaves. */
export interface LogbookSettings {
  readonly schemaVersion: number;
  /** The unit weights are shown in. Entered values keep the unit they were typed in. */
  readonly displayUnit: WeightUnit;
  readonly effort: EffortSetting;
  readonly restTimer: RestTimerSettings;
  /** The equipment warm-ups are generated against by default. */
  readonly equipment: EquipmentSnapshot | null;
  /** Versions of the Terms and Privacy documents this lifter has accepted. */
  readonly acceptedTerms: Readonly<Record<string, string>>;
  /** When a JSON backup was last downloaded from this device, if ever. */
  readonly lastBackupAt: Instant | null;
}

/**
 * An exercise the logbook can offer, from the catalogue or from the lifter.
 *
 * Flattened from two sources on purpose: a screen offering exercises should not
 * have to branch on where one came from, and the two things it genuinely needs
 * to know -- can this be warmed up, and what does it ask for -- are fields.
 */
export interface ExerciseOption {
  readonly id: string;
  readonly name: string;
  readonly loading: LoadingModel;
  /** `null` where the engine has no ramp for this movement. */
  readonly warmupFamily: WarmupFamily | null;
  /** Whether the tool shows it without opening a picker. Section 6.1's four. */
  readonly primary: boolean;
  readonly defaultSets: number;
  readonly defaultReps: number;
  readonly origin: 'catalog' | 'custom';
}
