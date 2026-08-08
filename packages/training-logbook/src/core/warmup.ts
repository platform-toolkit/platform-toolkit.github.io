// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Warm-up ramps, borrowed from the calculator and written into a session.
 *
 * THIS FILE CONTAINS NO WARM-UP RULES AND MUST NEVER GAIN ONE
 *
 * Section 8.1 is unusually direct about it: the logbook imports the official
 * warm-up package, the same input gives the same result in both tools, and the
 * algorithm is not forked. So there is no percentage here, no cap, no share, no
 * rep scheme and no rounding. Every number a lifter reads off a ramp came out of
 * `planWarmup`. What this file does is the three jobs the engine deliberately
 * does not do: turn a stored rack into the setup the engine wants, freeze the
 * answer with the versions that produced it, and decide what happens to the sets
 * already on the screen when a lifter asks for a new one.
 *
 * The temptation to break the rule arrives as a small convenience -- rounding a
 * warm-up to the nearest five before showing it, trimming the ramp to the sets a
 * lifter has not already done. Both are the fork. The failure mode is that the
 * two tools quietly stop agreeing, and nobody finds out at the rack, because
 * neither screen is wrong on its own.
 *
 * WHY A RECALCULATION IS A VALUE BEFORE IT IS A CHANGE
 *
 * Section 8.5 permits recalculating a warm-up mid-session and then constrains it
 * four ways: warn that unchecked sets will be replaced, preserve completed ones
 * as performed history, require explicit confirmation before removing them, and
 * never silently alter a completed set. A function that recalculated and wrote in
 * one step could satisfy none of those, because the confirmation has to be able
 * to name what it is about to throw away. So {@link warmupChange} computes the
 * whole answer and writes nothing, {@link applyWarmup} writes it, and the screen
 * in between is free to ask or not ask.
 *
 * It follows that the preview costs nothing: a {@link PlannedSet} carries no
 * identifier, so building one consumes no identity from the session context, and
 * a lifter who opens the confirmation and cancels leaves no trace.
 */

import {
  WARMUP_ENGINE_VERSION,
  WARMUP_RULESET_VERSION,
  adjustWarmups,
  convertWeight,
  planWarmup,
  type WarmupAdjustment,
  type WarmupFamily,
  type WarmupPlan,
  type WarmupProblem,
  type WarmupSet,
  type Weight,
} from '@platform-toolkit/domain';

import type {
  EquipmentSnapshot,
  ExerciseOption,
  LogbookId,
  SetPerformance,
  WarmupSnapshot,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { warmupFamilyFor } from './catalog.js';
import { sameEquipment, toBarbellSetup } from './equipment.js';
import {
  attachWarmup,
  findWorkoutExercise,
  insertSets,
  removeSet,
  type PlannedSet,
  type SessionContext,
} from './session.js';
import { isWorkingSet } from './summary.js';

/** What a ramp is wanted for. Everything section 8.3 says the logbook passes. */
export interface WarmupInput {
  /**
   * The ramp to use, chosen rather than inferred.
   *
   * Section 6.4 forbids working a family out from a custom exercise's name, and
   * `warmupFamilyFor` in `./catalog.js` is the only thing that should be asked
   * for one. Taking it as a parameter here keeps that decision in one place.
   */
  readonly family: WarmupFamily;
  readonly equipment: EquipmentSnapshot;
  /** The planned total in the rack's plate unit, bar and collars included. */
  readonly workingWeight: number;
  readonly workingSets: number;
  readonly workingReps: number;
  /**
   * Rungs the lifter gave a weight of their own, by position in the ramp.
   *
   * Not a rule and not an exception to the one at the top of this file. A rule
   * is the engine's answer to "what should this person lift"; this is a person
   * saying what they are going to lift instead, which is the one input the
   * engine has no opinion about. `adjustWarmups` recomputes the plate changes
   * around it and drops an adjustment naming a rung that is no longer there.
   *
   * Optional because every caller inside the logbook has none: the ramp is
   * generated and then edited set by set, through the ordinary set editor, and
   * those edits are already in the session. It is here for
   * {@link ../handoff.js}, where the lifter did their editing in the other tool
   * and the ramp has not been drawn on this side yet. Applying them through
   * this function rather than in the handoff is what keeps `planWarmup` called
   * from exactly one place in the package -- two call sites is how the two
   * tools start disagreeing about a ramp, one snapshot at a time.
   */
  readonly adjustments?: readonly WarmupAdjustment[];
}

/**
 * A generated ramp and everything applying it would disturb.
 *
 * The three set lists are disjoint and together account for every warm-up row in
 * the exercise before and after: `preserved` stays untouched, `replaced` goes,
 * and `sets` arrives.
 */
export interface WarmupChange {
  readonly snapshot: WarmupSnapshot;
  /** The ramp, one entry per set to perform. Section 8.4's expansion. */
  readonly sets: readonly PlannedSet[];
  /**
   * Warm-up sets that have been ticked off, skipped, or half-done.
   *
   * Kept exactly as they are, which is section 8.5's "preserve completed sets as
   * performed history". Nothing in this module writes to one.
   */
  readonly preserved: readonly WorkoutSet[];
  /** Untouched warm-up sets this would throw away. The thing to warn about. */
  readonly replaced: readonly WorkoutSet[];
  /**
   * Whether applying this changes a row the lifter can see.
   *
   * `false` when the new ramp is the one already written -- which is the common
   * case for a change to the working *sets* or *reps*, because neither reaches
   * the ramp. A tool that warned "3 warm-up sets will be replaced" before
   * replacing three sets with the same three sets would teach lifters to dismiss
   * the warning that matters.
   */
  readonly changesPlan: boolean;
}

/** A ramp, or the reasons there is not one. */
export type WarmupChangeResult =
  | { readonly ok: true; readonly change: WarmupChange }
  | { readonly ok: false; readonly problems: readonly WarmupProblem[] };

/**
 * Generates a ramp and works out what writing it would cost.
 *
 * Writes nothing. An exercise that is not in the session is a `null` answer
 * rather than a thrown error, for the same reason every other lookup in this
 * package is: the caller is a screen holding an identifier that a background
 * reload may have removed.
 */
export function warmupChange(
  session: WorkoutSession,
  exerciseId: LogbookId,
  input: WarmupInput,
  context: SessionContext,
): WarmupChangeResult | null {
  const exercise = findWorkoutExercise(session, exerciseId);
  if (exercise === null) return null;

  const result = planWarmup({
    setup: toBarbellSetup(input.equipment),
    family: input.family,
    workingWeight: input.workingWeight,
    workingSets: input.workingSets,
    workingReps: input.workingReps,
  });
  if (!result.ok) return { ok: false, problems: result.problems };

  // Adjusted before it is frozen, so the snapshot is the ramp the lifter is
  // about to walk rather than the one they overrode. Storing the engine's
  // version of it and the overrides separately would leave the card and the
  // record disagreeing, and section 8.4 froze the plan precisely so that what
  // is stored is what was on the screen.
  const plan = adjustWarmups(result.plan, input.adjustments ?? []);
  const snapshot: WarmupSnapshot = {
    plan,
    equipment: input.equipment,
    engineVersion: WARMUP_ENGINE_VERSION,
    rulesetVersion: WARMUP_RULESET_VERSION,
    generatedAt: context.at,
  };
  const sets = warmupSets(plan, input.equipment);
  const warmups = exercise.sets.filter((set) => set.kind === 'warmup');
  const preserved = warmups.filter(isSettled);
  const replaced = warmups.filter((set) => !isSettled(set));

  return {
    ok: true,
    change: { snapshot, sets, preserved, replaced, changesPlan: !sameRamp(replaced, sets) },
  };
}

/**
 * Writes a ramp into the session.
 *
 * Order is the whole of the difference between this and appending. The ramp goes
 * in after the last warm-up set that survives and before everything else, so a
 * lifter who has already done two sets sees those two, then the new ladder, then
 * their working sets -- reading down the card in the order they will walk it.
 *
 * The new ramp starts from the empty bar even where the preserved sets already
 * covered its first rungs, and that is deliberate. Trimming it to "what you still
 * need" is the tool deciding how somebody should warm up from a weight change it
 * knows nothing about, which is the one thing this package does not do. The
 * lifter skips the rungs they have done; the record keeps both facts.
 */
export function applyWarmup(
  session: WorkoutSession,
  exerciseId: LogbookId,
  change: WarmupChange,
  context: SessionContext,
): WorkoutSession {
  const attached = attachWarmup(session, exerciseId, change.snapshot, context);
  const cleared = change.replaced.reduce(
    (current, set) => removeSet(current, set.id, context),
    attached,
  );
  return insertSets(cleared, exerciseId, insertionPoint(cleared, exerciseId), change.sets, context);
}

/**
 * Takes a warm-up off an exercise without touching what was performed under it.
 *
 * The snapshot goes and the sets stay, which reads backwards until you ask what
 * the two are for. The snapshot is the claim "this ramp was generated, by this
 * engine, from this rack"; the sets are the record of what somebody lifted. A
 * lifter turning generation off is retracting the first and has not undone the
 * second. Untouched rows go, because nobody performed them.
 */
export function clearWarmup(
  session: WorkoutSession,
  exerciseId: LogbookId,
  context: SessionContext,
): WorkoutSession {
  const exercise = findWorkoutExercise(session, exerciseId);
  if (exercise === null) return session;
  const dropped = exercise.sets.filter((set) => set.kind === 'warmup' && !isSettled(set));
  const cleared = dropped.reduce((current, set) => removeSet(current, set.id, context), session);
  return attachWarmup(cleared, exerciseId, null, context);
}

/**
 * Why no ramp was written. Two answers, because a caller does two things with them.
 *
 * `no-ramp` is the catalogue saying this movement has none -- an accessory, a machine,
 * a custom exercise nobody gave a family to. Ordinary, expected, and **silent**: a
 * lifter who planned a squat and a curl did not ask for a curl ramp and should not be
 * told one was skipped. `refused` is the engine turning down inputs that should have
 * worked, which is the one a screen names, because something the lifter typed is why.
 */
export type RampRefusal = 'no-ramp' | 'refused';

/** A ramp written, or the session unchanged and the reason it was not. */
export type RampOutcome =
  | { readonly ok: true; readonly session: WorkoutSession }
  | { readonly ok: false; readonly session: WorkoutSession; readonly reason: RampRefusal };

/**
 * Ramps the exercise that was just added, or explains why it was not.
 *
 * Shared by the two screens that compose a session from scratch -- the calculator
 * handoff and the builder -- and it exists because they had begun to be the same
 * fifteen lines twice. Root section 5.8's fork rule with a specific failure behind it:
 * the pair would agree about the ladder, since both go through {@link warmupChange},
 * and disagree about the edges nobody looks at. Which lift gets named as unramped,
 * whether a missing family is silent, whether the snapshot is written before the sets.
 * Two screens producing subtly different records of the same warm-up is the kind of
 * thing found months later in an exported backup.
 *
 * The exercise is read back as the last one rather than passed in by identifier,
 * because `addExercise` appends and mints the identifier itself. Threading one out of
 * the core would mean something other than the identifier generator naming things.
 */
export function rampLastExercise(
  session: WorkoutSession,
  option: ExerciseOption,
  input: Omit<WarmupInput, 'family'>,
  context: SessionContext,
): RampOutcome {
  const added = session.exercises[session.exercises.length - 1];
  // A session with no exercises in it is grouped with the no-family answer rather than
  // given a third reason. Both mean there is nothing to ramp and nothing to say about
  // it, and a caller that reached here with an empty session has a bug the name of a
  // refusal code would not help with.
  if (added === undefined) return { ok: false, session, reason: 'no-ramp' };
  return rampExercise(session, added.id, option, input, context);
}

/**
 * Ramps a named exercise that is already in the session.
 *
 * The general form of {@link rampLastExercise}, and the reason it is not merely a
 * convenience is the repeat flow. A repeated session arrives with its exercises and
 * their identifiers already minted and its warm-ups deliberately dropped -- the copy
 * carries no snapshot, because last week's ladder was generated against last week's
 * rack. Rebuilding it means ramping named lifts one at a time, in the middle of a
 * session that is not being appended to, which the tail-reading form structurally
 * cannot reach: after the first lift, every later one is not the last.
 *
 * The refusals mean exactly what they mean there, including an exercise the session
 * does not hold being `no-ramp` rather than a third code. A screen holding an
 * identifier a background reload removed has nothing to tell the lifter either.
 */
export function rampExercise(
  session: WorkoutSession,
  exerciseId: LogbookId,
  option: ExerciseOption,
  input: Omit<WarmupInput, 'family'>,
  context: SessionContext,
): RampOutcome {
  const family = warmupFamilyFor(option);
  if (family === null || findWorkoutExercise(session, exerciseId) === null) {
    return { ok: false, session, reason: 'no-ramp' };
  }

  const change = warmupChange(session, exerciseId, { ...input, family }, context);
  if (change?.ok !== true) return { ok: false, session, reason: 'refused' };
  return { ok: true, session: applyWarmup(session, exerciseId, change.change, context) };
}

/** What an exercise's own sets say it is working up to. */
export interface WorkingPrescription {
  /** In the unit it was recorded in, never converted. Section 11.4. */
  readonly weight: Weight;
  readonly sets: number;
  readonly reps: number;
}

/**
 * Reads back the three numbers a ramp is generated from, off the sets themselves.
 *
 * A READ OF THE PLAN, NOT A WARM-UP RULE
 *
 * Nothing here is a percentage, a cap or a rounding, and the file's header still
 * holds: this reports what somebody already wrote down. It lives beside the ramp
 * because the ramp path is its only caller -- {@link rampExercise} wants a
 * {@link WarmupInput} and a repeated exercise has no snapshot to take one from, so
 * the prescription has to come back out of the copied sets.
 *
 * `null` where there is nothing to work up to, which a caller reads the same way it
 * reads `no-ramp`: silence.
 */
export function workingPrescription(exercise: WorkoutExercise): WorkingPrescription | null {
  // `isWorkingSet` from `./summary.js` rather than a predicate of our own, and it
  // excludes more than warm-ups: accessory work is out, backoff and AMRAP sets are
  // in. Both inclusions are right here. A backoff set is lighter by definition and
  // so cannot win the weight below, and the count it adds to is work at this lift
  // that only ever lands in the frozen prescription -- neither `workingSets` nor
  // `workingReps` reaches the ladder. A second definition of "the work" in this
  // package is how two screens start disagreeing about what a session was.
  const working = exercise.sets.filter(isWorkingSet);

  let heaviest: { readonly set: WorkoutSet; readonly weight: Weight } | null = null;
  let heaviestKilograms = 0;
  for (const set of working) {
    // The plan and never the performance. A repeated draft is `performed: null`
    // everywhere, so reading the result would answer `null` for every session a
    // lifter had not already done, and the ramp would silently never be offered.
    const load = set.planned?.load;
    // Only a barbell total is a thing to work up to. `none`, `added` and `assisted`
    // are facts about a body rather than about a bar, so flattening the union to
    // "whatever weight is in there" would ramp somebody to the 20 kg hanging off
    // their belt on a chin-up.
    if (load?.kind !== 'implement') continue;
    // The heaviest working set, not the first. A hand-edited session -- and every
    // repeat of one -- can hold unequal working sets, and a ramp built to the
    // lightest of them is a ramp that stops below the work. Compared in one unit
    // because the sets need not share one, and the winner is still handed back
    // exactly as it was recorded: section 11.4, a weight is shown in the unit it was
    // typed in. A tie leaves the earlier set in place, which is the order on screen.
    const kilograms = convertWeight(load.weight, 'kg').amount;
    if (heaviest === null || kilograms > heaviestKilograms) {
      heaviest = { set, weight: load.weight };
      heaviestKilograms = kilograms;
    }
  }

  if (heaviest === null) return null;
  const reps = heaviest.set.planned?.repetitions ?? null;
  // A set nobody gave a rep count to cannot answer the whole prescription. Borrowing
  // a lighter set's count would attach one set's reps to another set's weight and
  // freeze a prescription nobody wrote, and defaulting to a number is this package
  // prescribing. So it is the same silence as no working sets at all.
  if (reps === null) return null;
  return { weight: heaviest.weight, sets: working.length, reps };
}

/**
 * The ramp as individual sets, with the engine's repeat counts expanded.
 *
 * Section 8.4 requires the stored plan to hold "set count expanded into
 * individual sets", and `WarmupSet.count` is the one place the engine collapses
 * them -- two bar-only sets arrive as one entry with a count of two. Expanding
 * here rather than at the screen is what makes each of them tickable: a lifter
 * who has done the first bar set and not the second has a fact to record, and a
 * single row with a multiplier on it has nowhere to put it.
 */
export function warmupSets(plan: WarmupPlan, equipment: EquipmentSnapshot): readonly PlannedSet[] {
  return plan.warmups.flatMap((set) =>
    Array.from({ length: set.count }, (): PlannedSet => ({
      kind: 'warmup',
      performance: rampPerformance(set, equipment),
    })),
  );
}

/**
 * Whether a stored ramp was generated against the rack now in use.
 *
 * Cheaper than regenerating and comparing, and it answers the question a screen
 * actually asks on load: is this plan still about the equipment in front of me.
 * A stored ramp whose answer is `false` is not wrong -- it is a true record of a
 * different gym -- so this is an offer to recalculate and never a reason to hide
 * what is there.
 */
export function warmupMatchesEquipment(
  snapshot: WarmupSnapshot,
  equipment: EquipmentSnapshot,
): boolean {
  return sameEquipment(snapshot.equipment, equipment);
}

/**
 * Whether a stored ramp came out of the engine this build ships.
 *
 * Both versions, because they answer different questions -- see their
 * declarations in the domain package. A `false` here is worth a sentence beside
 * a historical plan and is never worth regenerating one: rewriting a finished
 * workout's ramp to today's rules is exactly what section 8.4 froze the versions
 * to prevent.
 */
export function warmupIsCurrent(snapshot: WarmupSnapshot): boolean {
  return (
    snapshot.engineVersion === WARMUP_ENGINE_VERSION &&
    snapshot.rulesetVersion === WARMUP_RULESET_VERSION
  );
}

/**
 * Which of a ramp's inputs moved out from under it.
 *
 * A record rather than a list, because the two are independent and the sentence
 * beside the offer names them separately: somebody who changed gyms and somebody
 * who dropped their top set are being told different things about the same button.
 */
export interface WarmupStaleReasons {
  /** The working sets are planned at a weight this ramp was not built to. */
  readonly workingWeight: boolean;
  /** The rack is not the one it was generated against. */
  readonly equipment: boolean;
}

/**
 * Where a written ramp stands against the lift it is attached to.
 *
 * `unbuildable` is a ramp that exists and could not be produced again -- the working
 * sets it was built from are gone, or the engine now refuses them. There is nothing
 * to offer but taking it off, which is why {@link clearWarmup} and the rebuild hang
 * off one answer rather than off two separate questions.
 */
export type WarmupStanding =
  | { readonly kind: 'none' }
  | { readonly kind: 'current' }
  | { readonly kind: 'stale'; readonly reasons: WarmupStaleReasons; readonly change: WarmupChange }
  | { readonly kind: 'unbuildable' };

/**
 * Whether a written ramp is still the ramp this lift would generate, and what it
 * would cost to say yes.
 *
 * Section 8.5's mid-session recalculation, as a value -- the same split as
 * {@link warmupChange}, one level up. Nothing here writes and nothing here decides
 * to write: a `stale` answer is an offer for a screen to put in front of somebody,
 * and applying it is a separate press through {@link applyWarmup}.
 *
 * TWO GATES, AND WHY IT IS NOT "DO THE ROWS DIFFER"
 *
 * The first gate is the ramp's *inputs*: the weight the working sets are planned at,
 * and the rack. The obvious alternative -- regenerate and compare against what is
 * written -- is wrong here, and permanently so. A session handed over from the
 * calculator arrives with the lifter's own rung adjustments already folded into the
 * frozen plan, and the snapshot does not keep them separately (see
 * {@link WarmupInput.adjustments}). Its written rows therefore differ from a fresh
 * generation with nothing having changed, so a screen that triggered on the rows
 * would offer, every time the lift was drawn, to undo the lifter's overrides.
 *
 * The second gate is {@link WarmupChange.changesPlan}: inputs that moved but produce
 * the ladder already on the card are worth nothing to say. A rack gains a pair of
 * 25s, a working weight moves half a kilo -- both are real changes to the inputs and
 * neither reaches a rung.
 *
 * Working *sets* and *reps* are deliberately not a trigger. Neither reaches the
 * ladder, so the answer would be `current` every time, and the cost of asking is not
 * zero: an exercise with a rung already ticked off has a `changesPlan` of `true` for
 * any regeneration at all, so adding a back-off set after warming up would raise an
 * offer whose sentence has nothing to name.
 *
 * Applying a `stale` answer drops any rung adjustment along with the rest of the old
 * ladder. That is the calculator's rule -- a recalculated ramp is the engine's again
 * -- and it is the reason the offer is an offer.
 */
export function warmupStanding(
  session: WorkoutSession,
  exerciseId: LogbookId,
  option: ExerciseOption,
  equipment: EquipmentSnapshot,
  context: SessionContext,
): WarmupStanding {
  const exercise = findWorkoutExercise(session, exerciseId);
  if (exercise === null) return { kind: 'none' };
  const snapshot = exercise.warmup;
  if (snapshot === null) return { kind: 'none' };

  const family = warmupFamilyFor(option);
  const prescription = workingPrescription(exercise);
  if (family === null || prescription === null) return { kind: 'unbuildable' };

  // Compared in the unit the snapshot was generated in, which makes this the exact
  // arithmetic the create path ran on the exact same stored weight: a lift nobody has
  // touched compares equal rather than nearly equal. Converting the other way would
  // put a rounding error between a ramp and itself every time a lifter read in pounds
  // off a kilo rack.
  const working = snapshot.plan.working;
  const reasons: WarmupStaleReasons = {
    workingWeight:
      convertWeight(prescription.weight, snapshot.equipment.plateUnit).amount !== working.total,
    equipment: !warmupMatchesEquipment(snapshot, equipment),
  };
  if (!reasons.workingWeight && !reasons.equipment) return { kind: 'current' };

  const { amount } = convertWeight(prescription.weight, equipment.plateUnit);
  const result = warmupChange(
    session,
    exerciseId,
    {
      family,
      equipment,
      workingWeight: amount,
      workingSets: prescription.sets,
      workingReps: prescription.reps,
    },
    context,
  );
  // `null` is unreachable -- the exercise was found above -- and is grouped with the
  // engine's refusal rather than asserted away, because both mean the same thing to
  // the one screen that asks: there is a ramp here and no new one to put in its place.
  if (result?.ok !== true) return { kind: 'unbuildable' };
  if (!result.change.changesPlan) return { kind: 'current' };
  return { kind: 'stale', reasons, change: result.change };
}

/** A set nobody has touched yet, and so a set that may be rewritten. */
function isSettled(set: WorkoutSet): boolean {
  return set.status !== 'planned';
}

function rampPerformance(set: WarmupSet, equipment: EquipmentSnapshot): SetPerformance {
  return {
    // The plate unit rather than the display unit. This is the number that will
    // be built out of the plates beside it, and converting it here would put a
    // total on the card that its own `perSide` list does not add up to.
    load: { kind: 'implement', weight: { amount: set.loading.total, unit: equipment.plateUnit } },
    repetitions: set.reps,
    // Section 7.10: effort is entered, never generated. A ramp arriving with an
    // RPE would be this package deciding how hard a warm-up ought to feel.
    effort: null,
  };
}

/**
 * Where the new ramp goes, once the replaced sets are already gone.
 *
 * After the last surviving warm-up set, which puts it at the front when none
 * survived. Computed from the session rather than from the caller's arithmetic
 * because the removals have shifted every index behind them.
 */
function insertionPoint(session: WorkoutSession, exerciseId: LogbookId): number {
  const exercise = findWorkoutExercise(session, exerciseId);
  if (exercise === null) return 0;
  const last = exercise.sets.reduce(
    (found, set, index) => (set.kind === 'warmup' ? index : found),
    -1,
  );
  return last + 1;
}

/**
 * Whether a generated ramp is the one already written down.
 *
 * Compared as loads and reps rather than as plans, because that is what a lifter
 * would see change. Two plans can differ in a field the card never renders -- an
 * advisory, a plate change on a set whose predecessor moved -- and warning about
 * that is warning about nothing.
 */
function sameRamp(existing: readonly WorkoutSet[], generated: readonly PlannedSet[]): boolean {
  if (existing.length !== generated.length) return false;
  return existing.every((set, index) => {
    const wanted = generated[index];
    if (wanted === undefined) return false;
    return set.planned !== null && samePerformance(set.planned, wanted.performance);
  });
}

function samePerformance(left: SetPerformance, right: SetPerformance): boolean {
  if (left.repetitions !== right.repetitions) return false;
  if (left.load.kind !== right.load.kind) return false;
  if (left.load.kind === 'none' || right.load.kind === 'none') return true;
  return (
    left.load.weight.amount === right.load.weight.amount &&
    left.load.weight.unit === right.load.weight.unit
  );
}
