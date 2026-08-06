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
  planWarmup,
  type WarmupFamily,
  type WarmupPlan,
  type WarmupProblem,
  type WarmupSet,
} from '@platform-toolkit/domain';

import type {
  EquipmentSnapshot,
  LogbookId,
  SetPerformance,
  WarmupSnapshot,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import { sameEquipment, toBarbellSetup } from './equipment.js';
import {
  attachWarmup,
  findWorkoutExercise,
  insertSets,
  removeSet,
  type PlannedSet,
  type SessionContext,
} from './session.js';

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

  const snapshot: WarmupSnapshot = {
    plan: result.plan,
    equipment: input.equipment,
    engineVersion: WARMUP_ENGINE_VERSION,
    rulesetVersion: WARMUP_RULESET_VERSION,
    generatedAt: context.at,
  };
  const sets = warmupSets(result.plan, input.equipment);
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
