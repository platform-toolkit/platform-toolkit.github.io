// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What Platform Targets remembers between visits.
 *
 * Pure, like every other tool's session module: no DOM, no storage of its own,
 * a `PreferenceStore` handed in. The decisions here are about what is safe to
 * remember and what a half-restored screen would do to a lifter, and neither
 * needs a browser to state.
 *
 * WHY THIS IS WORTH REMEMBERING AT ALL
 *
 * The context is seven answers, four of them required, and none of them changes
 * between one week and the next: a lifter's sex category, equipment, tested
 * status and weight class are who they are at the moment, not a query. Asking
 * again on every visit is the difference between a tool consulted at a rack and
 * a form filled in at a rack. The 2026-08-02 review is explicit about it -- a
 * returning visit shows targets immediately, a first visit asks once.
 *
 * WHY THE ANSWERS ARE STORED AS IDENTIFIERS AND WHY THAT IS SAFE
 *
 * Four of the seven are named by the federation in a runtime artifact, so
 * `PreferenceValue.choice` cannot hold them -- its options must exist at module
 * load. `PreferenceValue.publishedId` was added for exactly this, and the rule
 * that makes it safe is the one this tool already followed for its own reasons:
 * a stored answer is fed back through `resolveSelection`, which drops anything
 * the catalogue does not offer. A value that is not a published identifier
 * therefore has no path to a screen. See the builder's own note.
 *
 * WHAT IS NOT REMEMBERED
 *
 * The lift entries. They are the one thing on this screen that is *about* the
 * lifter's performance rather than their category, the privacy rules say
 * imported athlete data is not persisted by default, and the entered figures
 * are the same kind of value. They also go stale in a way a weight class does
 * not: a squat from March is not a fact about today, and restoring it silently
 * marks classifications as reached on evidence the lifter no longer has.
 *
 * Nor is the open record detail, which is a reading position rather than a
 * setting, or the theme, which this collection never persists (§5.6).
 */
import {
  PreferenceValue,
  definePreference,
  readPreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import type { Lift } from '@platform-toolkit/data-contracts';

import type { CategorySelection, SelectionField, TargetType } from '../types.js';
import { NO_SELECTION } from './selection.js';

/**
 * How an unanswered question is stored.
 *
 * `null` has no representation in a preference shape and a missing key fails
 * the whole shape, which would make clearing the optional age division reset
 * the four required answers beside it. The empty string is the one value
 * {@link PreferenceValue.publishedId} accepts that no federation can publish,
 * so the round trip is unambiguous in both directions.
 */
const UNANSWERED = '';

/**
 * The seven answers, in storage form.
 *
 * Written out field by field rather than generated from `SelectionField`,
 * because `PreferenceValue.shape` infers the stored type from the literal keys
 * and a computed object widens it to an index signature. The
 * {@link CategorySelection} round trip below is what keeps the two lists in
 * step: adding an axis to the selection and forgetting it here fails to
 * compile.
 */
const CONTEXT_SHAPE = PreferenceValue.shape({
  sex: PreferenceValue.publishedId(),
  equipment: PreferenceValue.publishedId(),
  tested: PreferenceValue.publishedId(),
  weightClass: PreferenceValue.publishedId(),
  comparisonWeightClass: PreferenceValue.publishedId(),
  division: PreferenceValue.publishedId(),
  region: PreferenceValue.publishedId(),
});

type StoredContext = Readonly<Record<SelectionField, string>>;

const NO_STORED_CONTEXT: StoredContext = {
  sex: UNANSWERED,
  equipment: UNANSWERED,
  tested: UNANSWERED,
  weightClass: UNANSWERED,
  comparisonWeightClass: UNANSWERED,
  division: UNANSWERED,
  region: UNANSWERED,
};

export const TARGETS_PREFERENCES = {
  context: definePreference<StoredContext>({
    name: 'platform-targets.context',
    value: CONTEXT_SHAPE,
    fallback: NO_STORED_CONTEXT,
  }),
  /**
   * Where the two navigation bars were left.
   *
   * One preference holding both rather than two holding one each, because they
   * are read and written together and a device that stored one write and
   * refused the other would reopen on the deadlift's classifications when the
   * lifter left it on the bench press's records -- a screen that is wrong in a
   * way nothing on it contradicts.
   */
  view: definePreference<StoredView>({
    name: 'platform-targets.view',
    value: PreferenceValue.shape({
      // Spelled inline for the reason convert's `core/session.ts` records: `choice`
      // infers its union from a `const` type parameter, and a named constant
      // annotated `readonly Lift[]` widens it straight back to `string`.
      lift: PreferenceValue.choice(['squat', 'bench', 'deadlift', 'total']),
      targetType: PreferenceValue.choice(['classifications', 'records']),
    }),
    // The squat's classifications: the first lift of a meet, and the half of
    // the tool that applies to every lifter rather than the few in reach of a
    // record.
    fallback: { lift: 'squat', targetType: 'classifications' },
  }),
};

interface StoredView {
  readonly lift: Lift;
  readonly targetType: TargetType;
}

/** Everything the tool reads back on start-up. */
export interface TargetsSettings {
  /**
   * The remembered answers, as a request rather than as a resolution.
   *
   * Deliberately the same shape the questions produce, and deliberately not
   * checked against a catalogue here: this module has none, and checking it
   * twice is how the two checks come to disagree. The caller seeds the
   * questions with it and `resolveSelection` discards whatever this federation
   * no longer offers -- which is also what makes a stored value that was never
   * a published identifier harmless.
   */
  readonly context: CategorySelection;
  readonly lift: Lift;
  readonly targetType: TargetType;
}

/** A `null` store is a host that named nowhere to remember, so nothing is restored. */
export function loadSettings(store: PreferenceStore | null): TargetsSettings {
  const context = readPreference(store, TARGETS_PREFERENCES.context);
  const view = readPreference(store, TARGETS_PREFERENCES.view);
  return {
    context: toSelection(context),
    lift: view.lift,
    targetType: view.targetType,
  };
}

/**
 * Writes the context back.
 *
 * Only ever called with an *applied* context, not with a draft. A lifter part
 * way through changing their weight class would otherwise have a half-edited
 * category stored on every tap, and closing the sheet without applying would
 * leave it there for the next visit to restore.
 *
 * A `null` store means the host named nowhere to put this, so it goes nowhere.
 * Not to a store built here, which would be this package choosing the placement
 * on their behalf.
 */
export function saveContext(store: PreferenceStore | null, selection: CategorySelection): void {
  store?.write(TARGETS_PREFERENCES.context, toStored(selection));
}

export function saveView(store: PreferenceStore | null, lift: Lift, targetType: TargetType): void {
  store?.write(TARGETS_PREFERENCES.view, { lift, targetType });
}

/** Forgets the remembered context, which is what "start over" means here. */
export function forgetContext(store: PreferenceStore | null): void {
  store?.forget(TARGETS_PREFERENCES.context);
  store?.forget(TARGETS_PREFERENCES.view);
}

/**
 * Storage form to selection form.
 *
 * Every empty string becomes `null`, which is the selection's own spelling of
 * "not answered". Nothing else is interpreted: a value the catalogue does not
 * offer travels through unchanged and is dropped by the resolver, which is one
 * place doing the checking rather than two.
 */
function toSelection(stored: StoredContext): CategorySelection {
  const selection: Record<SelectionField, string | null> = { ...NO_SELECTION };
  for (const field of CONTEXT_FIELDS) {
    const value = stored[field];
    selection[field] = value === UNANSWERED ? null : value;
  }
  return selection;
}

/**
 * Selection form to storage form.
 *
 * An answer that is not identifier-shaped is stored as unanswered rather than
 * verbatim. A write that violates its own definition throws by design (§5.12),
 * which is the right behaviour for a caller bug and the wrong one here: this
 * runs when a lifter presses Show targets, and taking the screen down over an
 * identifier a federation spelled unusually would lose them the report as well
 * as the memory of it. Dropping the one field costs a re-pick.
 */
function toStored(selection: CategorySelection): StoredContext {
  const stored: Record<SelectionField, string> = { ...NO_STORED_CONTEXT };
  for (const field of CONTEXT_FIELDS) {
    const value = selection[field];
    stored[field] = value !== null && PUBLISHED_ID.accepts(value) ? value : UNANSWERED;
  }
  return stored;
}

/**
 * The shape one answer has to satisfy, asked before a write rather than after.
 *
 * The same builder the context shape above is made of, so there is one copy of
 * the pattern. Two copies is how a widened shape in `packages/preferences`
 * leaves this file still refusing values the store would now take, and the
 * symptom is a weight class that silently never sticks.
 */
const PUBLISHED_ID = PreferenceValue.publishedId();

/**
 * Every field carried across, listed once.
 *
 * Typed as `SelectionField` so that adding an axis to the selection without
 * adding it here is a compile error at {@link NO_STORED_CONTEXT} rather than a
 * setting that silently stops being remembered.
 */
const CONTEXT_FIELDS: readonly SelectionField[] = [
  'sex',
  'equipment',
  'tested',
  'weightClass',
  'comparisonWeightClass',
  'division',
  'region',
];
