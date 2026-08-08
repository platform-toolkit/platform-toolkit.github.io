// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What a lifter is aiming at, and how this device remembers it.
 *
 * Pure, like `session.ts` beside it: no DOM, no data source, a `PreferenceStore`
 * handed in. The decisions here are about what a goal *is* -- which is a
 * surprisingly load-bearing question -- and none of them needs a browser.
 *
 * WHY A GOAL IS A HANDFUL OF IDENTIFIERS AND NOT A SENTENCE
 *
 * The obvious shape is the one the screen already has: the figure, and the
 * accessible name `report.ts` composed for the cell it was tapped in. It stores
 * in one field, it prints without resolving anything, and it is wrong twice
 * over.
 *
 * It is wrong for privacy, because a stored sentence is free text and
 * `packages/preferences` deliberately admits none -- that refusal is the
 * mechanism keeping names, profile addresses and dates of birth off the disk,
 * and a builder that took a caption would take anything a caller put in one.
 *
 * It is wrong for truth, because a caption is a snapshot of a published fact. A
 * federation that renames a division, republishes a record, or corrects a
 * standard leaves a stored sentence asserting last month's number under this
 * month's heading, with nothing on screen to say which. Identifiers resolved at
 * render time cannot drift: what cannot be resolved is simply not shown, which
 * is the same rule the context restore already runs on.
 *
 * WHY THE FIGURE IS STORED ANYWAY
 *
 * `kilograms` is the one non-identifier field, and it is here because a goal is
 * a commitment to a *weight*. A lifter who saved 197.5 kg when the record stood
 * at 195 has decided to pull 197.5; re-deriving it from a record that has since
 * moved would quietly change what they committed to, which is the opposite of
 * remembering it. So the figure is the goal and the identifiers are its
 * provenance -- and when the two disagree, the tray can say so rather than pick.
 *
 * WHAT IS NOT HERE
 *
 * A free-text label. The 2026-08-02 review asks for `Next meet`, `12-month`,
 * `Long-term` **or a custom one**, and the first three ship as a closed picklist
 * while the fourth does not, for the reason above: there is no builder that
 * takes text, and adding one to hold a goal label would open it for everything
 * else. This is a deliberate deviation from the review and is recorded as one.
 *
 * A lifter's current best, which is the other half of the gap arithmetic. That
 * stays in the session where the entered lifts already live (`session.ts` says
 * why at length): it is a fact about a body on a day, it goes stale in a way a
 * weight class does not, and restoring it silently would mark goals reached on
 * evidence the lifter no longer has.
 */
import {
  PreferenceValue,
  definePreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import type { CategoryCatalog, Lift, ClassificationBook } from '@platform-toolkit/data-contracts';

import { TARGET_LABELS, type TargetBasis } from './record-standings.js';
import { LIFT_LABELS } from './standards.js';

/** Which half of the report a goal came from. */
export const GOAL_KINDS = ['classification', 'record'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/**
 * Which attempt a record goal is for, or `none` for a classification.
 *
 * The three named values are exactly {@link TargetBasis}. They are spelled out
 * as a literal rather than derived, because `PreferenceValue.choice` infers its
 * union from a `const` type parameter and a named constant annotated with the
 * wider type widens it straight back to `string` -- the gotcha `session.ts`
 * records for the lift picklist. What keeps the two lists in step is the
 * assignment in `report.ts`, which puts a `TargetBasis` in this field: a
 * federation rule that produced a fourth basis would stop compiling there.
 */
export const GOAL_ATTEMPTS = ['none', 'chip', 'match', 'full-increment'] as const;
export type GoalAttempt = (typeof GOAL_ATTEMPTS)[number];

/**
 * When a lifter means to hit it.
 *
 * Three horizons and "no label", which is the default and is not a lesser
 * answer: most goals are set in the twenty seconds between two working sets and
 * filing them is a second decision nobody asked for.
 */
export const GOAL_TAGS = ['none', 'next-meet', 'twelve-month', 'long-term'] as const;
export type GoalTag = (typeof GOAL_TAGS)[number];

/** What each horizon is called on screen. */
export const GOAL_TAG_LABELS: Readonly<Record<GoalTag, string>> = {
  none: 'No label',
  'next-meet': 'Next meet',
  'twelve-month': '12-month',
  'long-term': 'Long-term',
};

/**
 * One target a lifter could commit to, as the report hands it over.
 *
 * Built where the identifiers already exist -- in the loop that drew the cell --
 * rather than reassembled from a rendered table. Reassembly is how a goal comes
 * to name the division above the one it was set in.
 *
 * An axis that does not apply is stored as `''`, the spelling `session.ts` uses
 * for the same reason: it is the one value {@link PreferenceValue.publishedId}
 * accepts that no federation can publish, and a missing key fails the whole
 * shape.
 */
export interface GoalTarget {
  readonly lift: Lift;
  readonly kind: GoalKind;
  /** The weight committed to. See the header: this is the goal itself. */
  readonly kilograms: number;
  /** The classification standard's identifier, or `''` for a record. */
  readonly standardId: string;
  readonly weightClassId: string;
  readonly divisionId: string;
  /** The competition level, or `''` for a classification. */
  readonly levelId: string;
  /** `''` when the level is not subdivided, and for a classification. */
  readonly regionId: string;
  /** The event, or `''` for a classification. */
  readonly disciplineId: string;
  readonly attempt: GoalAttempt;
}

/** A target that has been saved, with the horizon the lifter filed it under. */
export interface Goal extends GoalTarget {
  readonly tag: GoalTag;
}

/**
 * How many goals one device keeps.
 *
 * A bound is required by {@link PreferenceValue.listOf} and this is a real one
 * rather than a formality: four lifts by two target types by two classes by two
 * divisions is sixteen plausible goals for one meet, and a lifter with twenty
 * saved has a list they no longer read. The tray says so rather than silently
 * dropping the oldest, because a goal that vanishes without being removed is a
 * goal a lifter goes looking for.
 */
export const MAX_GOALS = 20;

/**
 * The heaviest figure a goal may hold.
 *
 * Bounds are required for the reason the builder gives -- a hand-edited entry
 * otherwise becomes a gap of `1e308` -- and these are set well outside anything
 * a platform has seen rather than snugly around it. A bound that tracks the
 * current world record is a bound that refuses the goal of breaking it.
 */
const GOAL_KILOGRAM_BOUNDS = { min: 0.5, max: 1000 } as const;

const GOAL_SHAPE = PreferenceValue.shape({
  lift: PreferenceValue.choice(['squat', 'bench', 'deadlift', 'total']),
  kind: PreferenceValue.choice(['classification', 'record']),
  kilograms: PreferenceValue.quantity(GOAL_KILOGRAM_BOUNDS),
  standardId: PreferenceValue.publishedId(),
  weightClassId: PreferenceValue.publishedId(),
  divisionId: PreferenceValue.publishedId(),
  levelId: PreferenceValue.publishedId(),
  regionId: PreferenceValue.publishedId(),
  disciplineId: PreferenceValue.publishedId(),
  attempt: PreferenceValue.choice(['none', 'chip', 'match', 'full-increment']),
  tag: PreferenceValue.choice(['none', 'next-meet', 'twelve-month', 'long-term']),
});

export const GOALS_PREFERENCE = definePreference<readonly Goal[]>({
  name: 'platform-targets.goals',
  value: PreferenceValue.listOf(GOAL_SHAPE, { maxLength: MAX_GOALS }),
  fallback: [],
});

/**
 * One goal's identity, as a string.
 *
 * Every axis that makes two goals different, and nothing else. The weight is
 * excluded on purpose: setting the Class I standard for a division twice after
 * the federation revised the figure is one goal with a new number, not two goals
 * a lifter has to notice are the same target. The tag is excluded for the same
 * reason -- filing a goal under a horizon does not make it a different goal.
 *
 * Newline-separated, matching `partitionKey`: every identifier here is a slug
 * from published data and may contain a hyphen or a dot, so any of those as a
 * separator would let two goals collide and the second silently replace the
 * first. Written as an escape rather than as a literal break, per §2.4.
 */
export function goalKey(target: GoalTarget): string {
  return [
    target.kind,
    target.lift,
    target.standardId,
    target.weightClassId,
    target.divisionId,
    target.levelId,
    target.regionId,
    target.disciplineId,
    target.attempt,
  ].join('\n');
}

/** What happened when a lifter pressed Set as goal. */
export type AddGoalOutcome =
  | { readonly kind: 'added'; readonly goals: readonly Goal[]; readonly key: string }
  /** Already on the list. Pressing again is not an error and changes nothing. */
  | { readonly kind: 'already-saved'; readonly key: string }
  /** The list is at {@link MAX_GOALS}. */
  | { readonly kind: 'full' }
  /**
   * An identifier behind this target is not shaped like a published one.
   *
   * Reported rather than dropped or stored verbatim. `session.ts` degrades one
   * field to unanswered in the same situation, which is right there -- losing a
   * weight class costs a re-pick -- and wrong here: a goal missing its division
   * is a goal for a category nobody chose, and saving it would be inventing the
   * missing axis. Unreachable in practice, and cheap to be honest about.
   */
  | { readonly kind: 'unstorable' };

/**
 * Adds a target to a list, if it belongs there.
 *
 * Pure: the caller writes the result. Which is what lets undo be the plain thing
 * it should be -- the element keeps the list it had and writes that back --
 * rather than a second operation that has to reconstruct what was removed.
 *
 * Appended rather than sorted. The order goals were set in is the order a lifter
 * remembers deciding them, and re-sorting by weight or by lift moves a goal they
 * just saved away from where they were looking.
 */
export function addGoal(goals: readonly Goal[], target: GoalTarget): AddGoalOutcome {
  if (!storable(target)) {
    return { kind: 'unstorable' };
  }
  const key = goalKey(target);
  if (goals.some((goal) => goalKey(goal) === key)) {
    return { kind: 'already-saved', key };
  }
  if (goals.length >= MAX_GOALS) {
    return { kind: 'full' };
  }
  return { kind: 'added', goals: [...goals, { ...target, tag: 'none' }], key };
}

export function removeGoal(goals: readonly Goal[], key: string): readonly Goal[] {
  return goals.filter((goal) => goalKey(goal) !== key);
}

/** Files a saved goal under a horizon, or back under none. */
export function tagGoal(goals: readonly Goal[], key: string, tag: GoalTag): readonly Goal[] {
  return goals.map((goal) => (goalKey(goal) === key ? { ...goal, tag } : goal));
}

/**
 * Whether every identifier on a target can be written as published.
 *
 * Asked before the write rather than after, for the reason `session.ts` gives at
 * {@link PreferenceValue.accepts}: a write that violates its own definition
 * throws by design, and taking the screen down over an unusually spelled
 * identifier would lose the lifter the report as well as the goal.
 */
function storable(target: GoalTarget): boolean {
  return (
    [
      target.standardId,
      target.weightClassId,
      target.divisionId,
      target.levelId,
      target.regionId,
      target.disciplineId,
    ].every((id) => PUBLISHED_ID.accepts(id)) && GOAL_KILOGRAMS.accepts(target.kilograms)
  );
}

/** The same builders the shape above is made of, so there is one copy of each rule. */
const PUBLISHED_ID = PreferenceValue.publishedId();
const GOAL_KILOGRAMS = PreferenceValue.quantity(GOAL_KILOGRAM_BOUNDS);

export function loadGoals(store: PreferenceStore): readonly Goal[] {
  return store.read(GOALS_PREFERENCE);
}

export function saveGoals(store: PreferenceStore, goals: readonly Goal[]): void {
  store.write(GOALS_PREFERENCE, goals);
}

/**
 * A target written out from published data, saved or merely offered.
 *
 * A {@link GoalTarget} rather than a {@link Goal}, so the panel a lifter presses
 * "Set as goal" in and the tray listing it afterwards are named by one function.
 * Two would be two chances for the thing saved to be called something else once
 * it was.
 *
 * Every part is resolved and any part that will not resolve is **left out**
 * rather than replaced by a placeholder or by the identifier itself. A tray
 * reading "Class I · f-75 · Master 50-54" has printed an internal slug at a
 * lifter; a tray reading "Class I · Master 50-54" has printed less and lied
 * about nothing, and the missing part reappears the moment the artifact that
 * names it lands.
 */
export interface GoalDescription {
  /** "Class I", or "Texas State record". The heading. */
  readonly title: string;
  /** "Deadlift · Full power · 75 kg · Master 50-54". Everything else, one line. */
  readonly scope: string;
  /** "Chip target". `null` for a classification. */
  readonly attemptLabel: string | null;
}

/** What a goal can be resolved against. Both halves may be absent. */
export interface GoalVocabulary {
  readonly catalog: CategoryCatalog | null;
  /**
   * This sex and equipment category's standards, if they have arrived.
   *
   * The only source of a classification level's *name* -- the catalogue holds
   * every other axis but not this one, because the levels are published inside
   * the tables they belong to. A goal set in one equipment category and read
   * while another is loaded therefore shows its scope and not its level name,
   * which is the honest answer rather than a guess at which ladder it came from.
   */
  readonly classifications: ClassificationBook | null;
}

/** What a classification goal is called when no book names its level. */
const UNRESOLVED_STANDARD = 'Classification standard';

/** What a record goal is called when no catalogue names its level. */
const UNRESOLVED_RECORD = 'Record';

const SCOPE_SEPARATOR = ' · ';

export function describeGoal(goal: GoalTarget, vocabulary: GoalVocabulary): GoalDescription {
  const { catalog } = vocabulary;
  const weightClass = weightClassLabel(catalog, goal.weightClassId);
  const division = divisionLabel(catalog, goal.divisionId);

  if (goal.kind === 'classification') {
    return {
      title: standardLabel(vocabulary.classifications, goal.standardId) ?? UNRESOLVED_STANDARD,
      scope: joined([LIFT_LABELS[goal.lift], weightClass, division]),
      attemptLabel: null,
    };
  }

  return {
    title: recordTitle(catalog, goal),
    scope: joined([
      LIFT_LABELS[goal.lift],
      disciplineLabel(catalog, goal.disciplineId),
      weightClass,
      division,
    ]),
    attemptLabel: attemptLabel(goal.attempt),
  };
}

/**
 * "Texas State record", the way the report's own row heading says it.
 *
 * Assembled from the same two published labels `partitionsFor` uses, in the same
 * order, because a goal set from a row headed "Texas State record" and listed in
 * a tray as "State record, Texas" is two names for one thing and a reader has to
 * check they match.
 */
function recordTitle(catalog: CategoryCatalog | null, goal: GoalTarget): string {
  const level = catalog?.levels.find((candidate) => candidate.id === goal.levelId);
  if (level === undefined) {
    return UNRESOLVED_RECORD;
  }
  const region = level.regions.find((candidate) => candidate.id === goal.regionId);
  return region === undefined ? `${level.label} record` : `${region.label} ${level.label} record`;
}

/**
 * A class's label, from whichever ladder publishes it.
 *
 * Every ladder rather than the one for a stored sex category, because a goal
 * does not store one: the sex is fixed by the context and a goal set under
 * another one is not a goal this lifter can be shown a figure for anyway. Two
 * ladders sharing a class identifier would have to share its label as well --
 * the identifier carries the class in it -- so the first match is not a guess
 * between two answers.
 */
function weightClassLabel(catalog: CategoryCatalog | null, id: string): string | null {
  for (const ladder of catalog?.weightClassLadders ?? []) {
    const found = ladder.classes.find((weightClass) => weightClass.id === id);
    if (found !== undefined) {
      return found.label;
    }
  }
  return null;
}

function divisionLabel(catalog: CategoryCatalog | null, id: string): string | null {
  return catalog?.ageDivisions.divisions.find((division) => division.id === id)?.label ?? null;
}

function disciplineLabel(catalog: CategoryCatalog | null, id: string): string | null {
  return catalog?.disciplines.find((discipline) => discipline.id === id)?.label ?? null;
}

/**
 * A classification level's name, from anywhere in the book that publishes it.
 *
 * The tables are per (weight class x division) and the seven level identifiers
 * are stable across all of them, so the first table naming this one names it the
 * same way every other does -- the fact `report.ts` already relies on to key its
 * rows on the standard rather than on the table.
 */
function standardLabel(book: ClassificationBook | null, id: string): string | null {
  for (const table of book?.tables ?? []) {
    const found = table.standards.find((standard) => standard.id === id);
    if (found !== undefined) {
      return found.label;
    }
  }
  return null;
}

function attemptLabel(attempt: GoalAttempt): string | null {
  if (attempt === 'none') {
    return null;
  }
  // The annotation is the coverage check the picklist above cannot make: a
  // fourth basis in the domain leaves this assignment unassignable, rather than
  // leaving one attempt quietly unlabelled in a tray.
  const basis: TargetBasis = attempt;
  return TARGET_LABELS[basis];
}

function joined(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(SCOPE_SEPARATOR);
}
