// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Today's session: which lifts are on the list, what is typed against each, and
 * which sets have been ticked off.
 *
 * Pure, like `equipment.ts`, and for the same reason -- the interesting rules
 * here are about what happens when a lifter changes something halfway through,
 * and none of them need a browser to state.
 *
 * A CUSTOM LIFT LASTS THE SESSION AND IS NOT REMEMBERED
 *
 * The requirements ask for a custom lift, and a custom lift has a name the lifter
 * types. `packages/preferences` deliberately has no builder that can hold free
 * text, because that is the mechanism that stops a name or a profile address ever
 * reaching a disk. The two directions meet here, and the privacy rule wins: a
 * custom lift works for as long as the tab is open and is gone afterwards. The
 * interface says so where the lift is created, rather than letting a lifter find
 * out by coming back tomorrow.
 *
 * COMPLETION MARKS ARE PINNED TO THE RAMP THEY WERE MADE AGAINST
 *
 * A tick means "I did that set". Change the working weight and every set below it
 * changes too, so a mark carried across would claim a set nobody performed. Each
 * mark therefore records the total it was made under and is discarded when that
 * total changes -- which also means marks cannot survive into next Tuesday's
 * session by accident, on top of living in per-tab storage.
 *
 * AN ADJUSTED WARM-UP IS PINNED TO THE RAMP TOO, BUT NOT TO THE SAME THINGS
 *
 * An adjustment names a position in `plan.warmups`, so it survives exactly as
 * long as that position means the same set. The working weight and the bar
 * decide the whole ramp, so changing either discards the adjustments on that
 * row; the set and rep counts decide only how many times each rung is performed,
 * so changing those keeps them. Getting that backwards in either direction is a
 * silent failure -- too eager and a lifter who fixes a typo in their rep count
 * loses the ramp they built, too lax and yesterday's 65 lb reappears partway up
 * a ramp for a heavier day.
 */
import {
  LIFTS,
  LOADING_TOLERANCE,
  adjustWarmups,
  convertWeight,
  findLift,
  planWarmup,
  roundForDisplay,
  warmupSteps,
  type BarbellSetup,
  type Loading,
  type PlateChange,
  type WarmupAdjustment,
  type WarmupFamily,
  type WarmupPlan,
  type WarmupPlanResult,
  type WarmupStage,
  type WarmupStep,
  type WeightUnit,
} from '@platform-toolkit/domain';
import {
  PreferenceValue,
  definePreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';
// These were declared here until `ptk-equipment-setup` moved into `packages/ui`
// and took its plate-pair counting with it. They return sentences rather than
// codes, which is why they sit in the screen layer and not in `domain`; the two
// ceilings are exported so `SESSION_PREFERENCES` below can state the same bound
// the parser enforces instead of restating the number.
//
// Through the subpath, not the package entry. This module is pure and its tests
// run in a bare Node project so that a DOM dependency introduced into it fails
// rather than quietly working -- and the entry's first act is to define thirteen
// custom elements.
import { MAX_COUNT, MAX_WEIGHT, parseCount, parseWeight } from '@platform-toolkit/ui/field-reading';

import { BAR_PRESETS, CUSTOM_BAR_ID, toBarbellSetup, type Equipment } from './equipment.js';

/** One lift on today's list, with whatever has been typed against it. */
export interface LiftEntry {
  /**
   * Identity for the row, stable while the row exists.
   *
   * For a catalogue lift this is the lift's own identifier, which is what lets a
   * remembered working weight find its way back to the right row. A custom lift
   * gets a generated key instead -- see the note at the top about why its name
   * cannot be one.
   */
  readonly key: string;
  /** The catalogue identifier, or `null` for a lift the lifter named themselves. */
  readonly liftId: string | null;
  readonly name: string;
  readonly family: WarmupFamily;
  /** Which bar this lift uses. Remembered per lift, because specialty bars are per lift. */
  readonly barId: string;
  /** Exactly what is in the field. Strings all the way until something parses them. */
  readonly weight: string;
  readonly sets: string;
  readonly reps: string;
  /**
   * Warm-up sets the lifter has given their own weight for, by ramp position.
   *
   * Numbers rather than strings, unlike every field above, because these are
   * never typed: a stepper answers with a weight the rack can already build, so
   * there is no half-finished value to hold on to.
   */
  readonly adjustments: readonly WarmupAdjustment[];
}

const CUSTOM_KEY_PREFIX = 'custom-';

/**
 * A key for a new custom lift that no current row is already using.
 *
 * Derived from the rows rather than drawn from a counter or a clock, so the same
 * list always produces the same next key -- which is what makes the reordering
 * and removal tests below able to assert on keys at all.
 */
function nextCustomKey(entries: readonly LiftEntry[]): string {
  const used = entries
    .map((entry) => entry.key)
    .filter((key) => key.startsWith(CUSTOM_KEY_PREFIX))
    .map((key) => Number.parseInt(key.slice(CUSTOM_KEY_PREFIX.length), 10))
    .filter((index) => Number.isInteger(index));
  return `${CUSTOM_KEY_PREFIX}${String(Math.max(0, ...used) + 1)}`;
}

/**
 * Adds a catalogue lift, or does nothing if it is already on the list.
 *
 * Refusing the duplicate rather than adding a second row is what keeps a key
 * equal to a lift identifier, and therefore what lets one remembered working
 * weight belong to one lift. Two Squat rows would also be two ramps for one
 * movement, which is not a session anybody runs.
 */
export function addLift(entries: readonly LiftEntry[], liftId: string): readonly LiftEntry[] {
  if (entries.some((entry) => entry.liftId === liftId)) return entries;
  const lift = findLift(liftId);
  if (lift === null) return entries;
  return [
    ...entries,
    {
      key: lift.id,
      liftId: lift.id,
      name: lift.name,
      family: lift.family,
      barId: '',
      weight: '',
      sets: String(lift.defaultSets),
      reps: String(lift.defaultReps),
      adjustments: [],
    },
  ];
}

/** Adds a lift the lifter named, with the family they chose for it. */
export function addCustomLift(
  entries: readonly LiftEntry[],
  name: string,
  family: WarmupFamily,
): readonly LiftEntry[] {
  const trimmed = name.trim();
  if (trimmed === '') return entries;
  return [
    ...entries,
    {
      key: nextCustomKey(entries),
      liftId: null,
      name: trimmed,
      family,
      barId: '',
      weight: '',
      // No catalogue default to draw on, so the commonest prescription in the
      // programme these ramps come from. Never written over afterwards.
      sets: '3',
      reps: '5',
      adjustments: [],
    },
  ];
}

export function removeEntry(entries: readonly LiftEntry[], key: string): readonly LiftEntry[] {
  return entries.filter((entry) => entry.key !== key);
}

/**
 * Moves a row one place earlier or later, or leaves the list alone at the ends.
 *
 * Clamping rather than wrapping. A lifter tapping "move up" on the first row
 * expects nothing to happen; sending it to the bottom is a reordering they have
 * to undo and, on a phone, one they may not have seen happen.
 */
export function moveEntry(
  entries: readonly LiftEntry[],
  key: string,
  direction: -1 | 1,
): readonly LiftEntry[] {
  const from = entries.findIndex((entry) => entry.key === key);
  if (from === -1) return entries;
  const to = from + direction;
  if (to < 0 || to >= entries.length) return entries;

  const moved = [...entries];
  const [entry] = moved.splice(from, 1);
  if (entry === undefined) return entries;
  moved.splice(to, 0, entry);
  return moved;
}

/**
 * Changes one field on one row. Unknown keys are left alone rather than appended.
 *
 * Changing the working weight or the bar throws away that row's adjustments,
 * because both of them rebuild the ramp from the bottom: an adjustment names a
 * position, and after either change position three is a different set. Keeping
 * them would put a weight the lifter chose for last week's 100 lb somewhere in
 * the middle of today's 135, which is worse than the calculated figure it
 * replaced and looks like the calculator being wrong. The set and rep counts are
 * deliberately not on that list -- they change how many times each rung is
 * performed and never what the rungs are.
 */
export function updateEntry(
  entries: readonly LiftEntry[],
  key: string,
  patch: Partial<Pick<LiftEntry, 'barId' | 'weight' | 'sets' | 'reps' | 'adjustments'>>,
): readonly LiftEntry[] {
  return entries.map((entry) => {
    if (entry.key !== key) return entry;
    const next = { ...entry, ...patch };
    // A patch that names the adjustments is the caller setting them, so it wins.
    if (patch.adjustments !== undefined) return next;
    const rebuilt = next.weight !== entry.weight || next.barId !== entry.barId;
    return rebuilt ? { ...next, adjustments: [] } : next;
  });
}

/**
 * The ramp for one row, or `null` when there is not yet enough typed to make one.
 *
 * `null` for an incomplete row rather than a problem list, because a lifter who
 * has typed nothing has not made a mistake. Only a value that is present and
 * wrong produces a message, and that comes from the field readings above rather
 * than from here.
 */
export function planFor(entry: LiftEntry, equipment: Equipment): WarmupPlanResult | null {
  const weight = parseWeight(entry.weight, equipment.plateUnit);
  if (!weight.ok) return null;
  const sets = parseCount(entry.sets, 'sets');
  const reps = parseCount(entry.reps, 'reps');
  if (!sets.ok || !reps.ok) return null;

  const result = planWarmup({
    setup: setupFor(entry, equipment),
    family: entry.family,
    workingWeight: weight.value,
    workingSets: sets.value,
    workingReps: reps.value,
  });
  // Applied here rather than in the card, so every reader of a plan -- the
  // checklist, the stored marks, the narrow-layout check -- sees the same ramp.
  // A card that adjusted its own copy would tick rows against one ramp and pin
  // them to another.
  if (!result.ok) return result;
  return { ok: true, plan: adjustWarmups(result.plan, entry.adjustments) };
}

/** The barbell for one row: the lift's own bar when it has one, the default otherwise. */
export function setupFor(entry: LiftEntry, equipment: Equipment): BarbellSetup {
  return toBarbellSetup(equipment, entry.barId === '' ? equipment.barId : entry.barId);
}

/*
 * ---------------------------------------------------------------------------
 * Changing the plate unit without reinterpreting anybody's numbers.
 * ---------------------------------------------------------------------------
 */

/**
 * Re-expresses every typed weight in the new unit.
 *
 * Offered as an explicit action and never applied automatically, because the two
 * readings of "I switched to pounds" are both common and they are tens of
 * kilograms apart: a lifter who typed 100 meaning kilograms wants 220 pounds,
 * and a lifter who mis-set the unit and typed 225 meaning pounds wants the 225
 * left alone. Guessing produces a warm-up for a weight nobody chose.
 *
 * Converts from the string that is currently in the field, which is the figure
 * the lifter last confirmed. Round-tripping kg to lb and back is therefore one
 * conversion each way and not a drift that accumulates per toggle -- the number
 * shown after a return trip is the display rounding of the original, not the
 * rounding of a rounding.
 *
 * An adjusted warm-up is carried over with its weight converted, not discarded.
 * The rack is the same rack -- only the unit the lifter reads it in changed --
 * and a converted total is safe to keep because an adjustment is resolved to the
 * nearest loadable weight when it is applied, so an inexact conversion lands on
 * whatever the plates can actually build rather than on a fractional figure.
 */
export function convertEntryWeights(
  entries: readonly LiftEntry[],
  from: WeightUnit,
  to: WeightUnit,
): readonly LiftEntry[] {
  if (from === to) return entries;
  return entries.map((entry) => {
    const adjustments = entry.adjustments.map((adjustment) => ({
      ...adjustment,
      total: convertWeight({ amount: adjustment.total, unit: from }, to).amount,
    }));
    const reading = parseWeight(entry.weight, from);
    if (!reading.ok) return { ...entry, adjustments };
    const converted = convertWeight({ amount: reading.value, unit: from }, to);
    return { ...entry, weight: String(roundForDisplay(converted.amount)), adjustments };
  });
}

/*
 * ---------------------------------------------------------------------------
 * The checklist.
 * ---------------------------------------------------------------------------
 */

/** One line of the checklist: one performance of one set, tickable on its own. */
export interface SessionRow {
  /** Position within this lift's checklist. Stable for as long as the ramp is. */
  readonly index: number;
  readonly kind: 'warm-up' | 'working';
  readonly stage: WarmupStage | null;
  /**
   * Which set of `plan.warmups` this row performs, or `null` for a working set.
   *
   * Not the same number as `index`: a repeated set is two rows of one warm-up.
   * It is here because an adjustment names a warm-up and the checklist has to
   * say which rows carry one, and deriving it in the card would be a second
   * copy of the expansion below.
   */
  readonly warmupIndex: number | null;
  /** The plates, or `null` for a working set whose weight cannot be built. */
  readonly loading: Loading | null;
  /** The total to put on the bar, in the plate unit. */
  readonly total: number;
  readonly reps: number;
  /** What to move from the previous row, or `null` for the first row. */
  readonly change: PlateChange | null;
}

/**
 * The plan as a list of individually tickable rows.
 *
 * A repeated set is expanded rather than shown once with a multiplier: the
 * requirements are explicit that the bar for five, twice, is two rows a lifter
 * ticks separately -- because they are performed minutes apart and the whole
 * point of the checklist is knowing which of them has happened.
 */
export function sessionRows(plan: WarmupPlan): readonly SessionRow[] {
  const rows: SessionRow[] = [];

  for (const [warmupIndex, set] of plan.warmups.entries()) {
    for (let repeat = 0; repeat < set.count; repeat += 1) {
      rows.push({
        index: rows.length,
        kind: 'warm-up',
        stage: set.stage,
        warmupIndex,
        loading: set.loading,
        total: set.loading.total,
        reps: set.reps,
        // Only the first performance of a repeated set moves any plates. The
        // second row saying "add nothing" would be noise on the one screen that
        // has to be read between sets with chalk on the lifter's hands.
        change: repeat === 0 ? set.change : null,
      });
    }
  }

  const working = plan.working;
  const loading = working.load.kind === 'loadable' ? working.load.loading : null;
  for (let set = 0; set < working.sets; set += 1) {
    rows.push({
      index: rows.length,
      kind: 'working',
      stage: null,
      warmupIndex: null,
      loading,
      total: working.total,
      reps: working.reps,
      change: set === 0 ? working.change : null,
    });
  }

  return rows;
}

/*
 * ---------------------------------------------------------------------------
 * The weights a lifter chose instead of the calculated ones.
 * ---------------------------------------------------------------------------
 */

/** One warm-up the lifter may move, as the control that offers to move it needs it. */
export interface AdjustableWarmup extends WarmupStep {
  /**
   * Its place among the movable warm-ups, counting from one.
   *
   * Not `index`, which counts the bar-only sets nobody can move -- so a ramp
   * that starts with two bar sets would otherwise offer to adjust "warm-up 3"
   * as its first row. This is the number the checklist prints too, which is the
   * only thing tying a row in the fold to the row a lifter ticks.
   */
  readonly ordinal: number;
  /** Whether this one is currently carrying a weight of the lifter's own. */
  readonly adjusted: boolean;
}

/**
 * The warm-ups of a plan that a lifter may give their own weight to.
 *
 * Derived from the plan rather than from the ramp rules, so a family that adds
 * a stage or a rack that collapses two of them is described correctly without
 * anything here being told about it. Each row arrives with both of its steps
 * already found, so drawing the control costs one search of the rack rather
 * than two per row -- see `warmupSteps`.
 *
 * `adjusted` asks whether the lifter *named* this set, not whether the answer
 * differs from the calculated one. Somebody who steps a set up and back down
 * has still chosen its weight, and a mark that vanished when the two figures
 * happened to coincide would make the reset button look broken.
 */
export function adjustableWarmups(
  plan: WarmupPlan,
  adjustments: readonly WarmupAdjustment[],
): readonly AdjustableWarmup[] {
  const named = new Set(adjustments.map((adjustment) => adjustment.index));
  return warmupSteps(plan).map((step, position) => ({
    ...step,
    ordinal: position + 1,
    adjusted: named.has(step.index),
  }));
}

/**
 * The adjustment list with one set given a weight, replacing any it already had.
 *
 * Sorted by position, which nothing reading it requires -- `adjustWarmups`
 * builds a map -- but which the storage cap does: `saveEntries` stops at the
 * limit, so an append-ordered list would drop whichever sets happened to be
 * adjusted last rather than the ones furthest up the ramp.
 */
export function withAdjustment(
  adjustments: readonly WarmupAdjustment[],
  index: number,
  total: number,
): readonly WarmupAdjustment[] {
  return [...adjustments.filter((adjustment) => adjustment.index !== index), { index, total }].sort(
    (left, right) => left.index - right.index,
  );
}

/**
 * Whether two totals are the same weight on the bar.
 *
 * Shares the plate module's tolerance rather than declaring another, for the
 * reason stated there: two modules comparing the same totals with two different
 * tolerances disagree only for the handful of weights that land between them.
 */
function sameTotal(left: number, right: number): boolean {
  return Math.abs(left - right) < LOADING_TOLERANCE;
}

/*
 * ---------------------------------------------------------------------------
 * What survives a refresh, and what does not.
 * ---------------------------------------------------------------------------
 */

/** A remembered working weight, per lift. Catalogue lifts only -- see the top of the file. */
interface StoredEntry {
  readonly lift: string;
  readonly bar: string;
  readonly weight: number;
  readonly sets: number;
  readonly reps: number;
  /** The unit the weight was typed in, so a stored figure is never re-read as the other. */
  readonly unit: WeightUnit;
}

/** A ticked set, pinned to the ramp it was ticked against. */
interface StoredMark {
  readonly lift: string;
  readonly row: number;
  readonly total: number;
}

/** A warm-up the lifter set the weight of, per lift and ramp position. */
interface StoredAdjustment {
  readonly lift: string;
  readonly row: number;
  readonly total: number;
  /** As with an entry: a stored figure is never re-read as the other unit. */
  readonly unit: WeightUnit;
}

function nonEmpty(values: readonly string[]): readonly [string, ...string[]] {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new RangeError('A preference choice needs at least one value.');
  }
  return [first, ...rest];
}

/**
 * Every catalogue lift identifier, as a picklist.
 *
 * Derived from the catalogue rather than written out again, so a lift added
 * upstream is storable without a second edit here -- and a lift *removed*
 * upstream stops being accepted, which is what makes a stored row drop out
 * quietly instead of lingering as an entry nothing can render.
 *
 * A picklist and not free text: that is the whole reason a catalogue lift can be
 * remembered at all while a lift the lifter named cannot.
 */
const LIFT_IDS = nonEmpty(LIFTS.map((lift) => lift.id));

/**
 * Every bar identifier, plus the empty string meaning "whatever the default is".
 *
 * The empty string is a real answer and not a missing one: a row that has never
 * had a bar chosen for it must follow the equipment default when that default
 * changes, and storing the resolved identifier instead would freeze it.
 */
const BAR_CHOICE_IDS = nonEmpty(['', ...BAR_PRESETS.map((preset) => preset.id), CUSTOM_BAR_ID]);

/** More rows than any session has, and few enough that the list stays a list. */
const ORDER_LIMIT = 24;

const ENTRY_SHAPE = PreferenceValue.shape({
  lift: PreferenceValue.choice(LIFT_IDS),
  bar: PreferenceValue.choice(BAR_CHOICE_IDS),
  weight: PreferenceValue.quantity({ min: 0, max: MAX_WEIGHT }),
  sets: PreferenceValue.count({ min: 1, max: MAX_COUNT }),
  reps: PreferenceValue.count({ min: 1, max: MAX_COUNT }),
  unit: PreferenceValue.choice(['kg', 'lb']),
});

const MARK_SHAPE = PreferenceValue.shape({
  lift: PreferenceValue.choice(LIFT_IDS),
  row: PreferenceValue.count({ min: 0, max: 200 }),
  total: PreferenceValue.quantity({ min: 0, max: MAX_WEIGHT }),
});

/** Higher than any ramp this builds, and low enough that the list stays bounded. */
const MAX_ADJUSTED_ROW = 40;

const ADJUSTMENT_SHAPE = PreferenceValue.shape({
  lift: PreferenceValue.choice(LIFT_IDS),
  row: PreferenceValue.count({ min: 0, max: MAX_ADJUSTED_ROW }),
  total: PreferenceValue.quantity({ min: 0, max: MAX_WEIGHT }),
  unit: PreferenceValue.choice(['kg', 'lb']),
});

/** Every rung of every row's ramp, with room to spare. A ramp is at most seven. */
const ADJUSTMENT_LIMIT = ORDER_LIMIT * 10;

/**
 * Where each of these two lives is a decision, not an accident.
 *
 * The entries belong in ordinary storage: what a lifter squats does not change
 * between Tuesday and Thursday, and re-typing four working weights at a rack is
 * the friction this tool exists to remove. The marks belong in per-tab storage,
 * because a tick means "I did that set today" -- it has to survive a phone
 * locking and the tab reloading an hour later, and it must be gone next week.
 * The caller chooses; these definitions only say what the shapes are.
 *
 * The adjustments are a third preference rather than a field on an entry, and
 * that is a decision about upgrades rather than about tidiness. A shape rejects
 * a row with a *missing* key (§5.12), and one rejected row fails the whole list
 * -- so adding a field to `ENTRY_SHAPE` would make every lifter's remembered
 * working weights vanish on the first read after this ships. A new key that
 * nothing has written yet simply reads as its fallback.
 */
export const SESSION_PREFERENCES = {
  entries: definePreference<readonly StoredEntry[]>({
    name: 'warm-up.entries',
    value: PreferenceValue.listOf(ENTRY_SHAPE, { maxLength: ORDER_LIMIT }),
    fallback: [],
  }),
  adjustments: definePreference<readonly StoredAdjustment[]>({
    name: 'warm-up.adjustments',
    value: PreferenceValue.listOf(ADJUSTMENT_SHAPE, { maxLength: ADJUSTMENT_LIMIT }),
    fallback: [],
  }),
  marks: definePreference<readonly StoredMark[]>({
    name: 'warm-up.completed',
    value: PreferenceValue.listOf(MARK_SHAPE, { maxLength: 400 }),
    fallback: [],
  }),
};

/**
 * The remembered list, re-expressed in the unit now in force.
 *
 * The unit each weight was typed in is stored beside it, so a lifter who last
 * visited in pounds and now has kilograms selected sees their weights converted
 * rather than reinterpreted. Storing the bare number would make 225 lb read back
 * as 225 kg -- a plausible figure, a hundred kilograms out, with nothing on
 * screen to indicate it.
 */
export function loadEntries(store: PreferenceStore, unit: WeightUnit): readonly LiftEntry[] {
  const adjustments = new Map<string, WarmupAdjustment[]>();
  for (const stored of store.read(SESSION_PREFERENCES.adjustments)) {
    const total = convertWeight({ amount: stored.total, unit: stored.unit }, unit).amount;
    const forLift = adjustments.get(stored.lift) ?? [];
    forLift.push({ index: stored.row, total });
    adjustments.set(stored.lift, forLift);
  }

  const rows: LiftEntry[] = [];
  for (const stored of store.read(SESSION_PREFERENCES.entries)) {
    const lift = findLift(stored.lift);
    // A lift this build no longer has. The row is dropped rather than kept under
    // its bare identifier, which would render as a nameless card.
    if (lift === null) continue;
    const converted = convertWeight({ amount: stored.weight, unit: stored.unit }, unit).amount;
    rows.push({
      key: lift.id,
      liftId: lift.id,
      name: lift.name,
      family: lift.family,
      barId: stored.bar,
      // Zero is the encoding for "the field was empty", the way `pairs: 0` is
      // for "as many as needed" -- neither has a nullable builder to lean on and
      // neither collides with a value the interface can produce.
      weight: stored.weight === 0 ? '' : String(roundForDisplay(converted)),
      sets: String(stored.sets),
      reps: String(stored.reps),
      // Not filtered against the ramp, because there is no ramp yet -- the plan
      // is built from this entry. `adjustWarmups` drops what does not fit.
      adjustments: adjustments.get(lift.id) ?? [],
    });
  }
  return rows;
}

/**
 * Writes the list back, keeping every stored field inside its own shape.
 *
 * A write that violates its definition throws by design (§5.12), which is the
 * right behaviour for a caller bug and the wrong thing to do here: these values
 * come from fields a lifter is mid-way through typing, so half of them are
 * invalid half the time. Clamping to a storable stand-in loses at most a partly
 * typed number; letting the throw out loses the screen.
 */
export function saveEntries(
  store: PreferenceStore,
  entries: readonly LiftEntry[],
  unit: WeightUnit,
): void {
  const stored: StoredEntry[] = [];
  const adjustments: StoredAdjustment[] = [];
  for (const entry of entries.slice(0, ORDER_LIMIT)) {
    // Custom lifts are absent from here, not blanked: their name is free text
    // and there is deliberately nowhere to put it. See the top of the file.
    if (entry.liftId === null) continue;
    for (const adjustment of entry.adjustments) {
      if (adjustments.length >= ADJUSTMENT_LIMIT) break;
      const candidate = {
        lift: entry.liftId,
        row: adjustment.index,
        total: adjustment.total,
        unit,
      };
      // Asked of the shape rather than re-tested by hand, so the two cannot
      // drift (§5.12), and dropped rather than clamped, unlike the fields below:
      // a clamped weight would put a warm-up somewhere the lifter never chose
      // and the checklist would present it as their own figure. Dropping it
      // shows the calculated set, which is the honest answer here.
      if (!ADJUSTMENT_SHAPE.accepts(candidate)) continue;
      adjustments.push(candidate);
    }
    const weight = parseWeight(entry.weight, unit);
    const sets = parseCount(entry.sets, 'sets');
    const reps = parseCount(entry.reps, 'reps');
    const lift = findLift(entry.liftId);
    stored.push({
      lift: entry.liftId,
      bar: BAR_CHOICE_IDS.includes(entry.barId) ? entry.barId : '',
      weight: weight.ok ? weight.value : 0,
      // The catalogue suggestion rather than a constant, so a row saved mid-edit
      // comes back as what the lift starts with and not as somebody else's 3x5.
      sets: sets.ok ? sets.value : (lift?.defaultSets ?? 1),
      reps: reps.ok ? reps.value : (lift?.defaultReps ?? 1),
      unit,
    });
  }
  store.write(SESSION_PREFERENCES.entries, stored);
  store.write(SESSION_PREFERENCES.adjustments, adjustments);
}

/** Which rows of which lifts have been ticked, keyed for lookup. */
export type Completion = ReadonlySet<string>;

export function markKey(entryKey: string, index: number): string {
  return `${entryKey}:${String(index)}`;
}

export function toggleMark(completion: Completion, key: string): Completion {
  const next = new Set(completion);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function loadCompletion(
  store: PreferenceStore,
  entries: readonly LiftEntry[],
  equipment: Equipment,
): Completion {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const reading = parseWeight(entry.weight, equipment.plateUnit);
    if (reading.ok) totals.set(entry.key, reading.value);
  }

  const marks = new Set<string>();
  for (const mark of store.read(SESSION_PREFERENCES.marks)) {
    const total = totals.get(mark.lift);
    if (total === undefined || !sameTotal(total, mark.total)) continue;
    marks.add(markKey(mark.lift, mark.row));
  }
  return marks;
}

export function saveCompletion(
  store: PreferenceStore,
  completion: Completion,
  entries: readonly LiftEntry[],
  equipment: Equipment,
): void {
  const stored: StoredMark[] = [];
  for (const entry of entries) {
    if (entry.liftId === null) continue;
    const reading = parseWeight(entry.weight, equipment.plateUnit);
    if (!reading.ok) continue;
    for (const key of completion) {
      const [entryKey, index] = key.split(':');
      if (entryKey !== entry.key || index === undefined) continue;
      stored.push({ lift: entry.liftId, row: Number(index), total: reading.value });
    }
  }
  store.write(SESSION_PREFERENCES.marks, stored);
}
