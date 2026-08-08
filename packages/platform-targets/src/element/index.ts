// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The custom elements, and the one call that puts them in the registry.
 *
 * Section 15 asks every tool package for an explicit `define…()` rather than a
 * side-effecting import, and the reason is that the registry is a global which
 * throws on a second write. A package that registered its tags on import would hand
 * a consumer a `NotSupportedError` at module-evaluation time -- before a line of its
 * own code ran, from a file it did not write, naming a tag it has never heard of --
 * the first time a bundler failed to dedupe this package or a second copy arrived
 * through a transitive dependency. So no file here carries a `@customElement`
 * decorator, and this is the only module that touches `customElements`.
 *
 * All seven tags are defined together, and that is not a convenience. Six of them
 * are inside the seventh's shadow root; defining only the root would leave a page of
 * unupgraded elements that render nothing and report no error, which is the worst
 * failure mode available -- a blank tool with a clean console.
 */
import type { LitElement } from 'lit';

import { PLATFORM_TARGETS_TAG, PtkPlatformTargets } from './ptk-platform-targets.js';
import { TARGET_CATEGORIES_TAG, PtkTargetCategories } from './ptk-target-categories.js';
import { TARGET_CONTEXT_TAG, PtkTargetContext } from './ptk-target-context.js';
import { TARGET_FRESHNESS_TAG, PtkTargetFreshness } from './ptk-target-freshness.js';
import { TARGET_GOALS_TAG, PtkTargetGoals } from './ptk-target-goals.js';
import { TARGET_LIFTS_TAG, PtkTargetLifts } from './ptk-target-lifts.js';
import { TARGET_REPORT_TAG, PtkTargetReport } from './ptk-target-report.js';

export {
  PLATFORM_TARGETS_TAG,
  PtkPlatformTargets,
  PtkTargetCategories,
  PtkTargetContext,
  PtkTargetFreshness,
  PtkTargetGoals,
  PtkTargetLifts,
  PtkTargetReport,
  TARGET_CATEGORIES_TAG,
  TARGET_CONTEXT_TAG,
  TARGET_FRESHNESS_TAG,
  TARGET_GOALS_TAG,
  TARGET_LIFTS_TAG,
  TARGET_REPORT_TAG,
};

/**
 * The events and detail shapes the six inner elements report with, and the three
 * status vocabularies a host has to speak to drive them.
 *
 * Re-exported rather than left behind their own modules because a host that
 * composes the elements itself -- which the standalone page does not, but an
 * embedder might -- has to name an event to listen for it, and a name copied into
 * a listener as a string literal is a name that stops matching without a compile
 * error. `PartitionRead` and the statuses are the other direction: they are what a
 * host hands *in*, and the transport that fills them stays outside this package.
 */
export {
  SELECTION_APPLIED_EVENT,
  SELECTION_CANCEL_EVENT,
  SELECTION_CHANGE_EVENT,
  type CatalogStatus,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';

export { CONTEXT_EDIT_EVENT } from './ptk-target-context.js';

export {
  CURRENT_LIFTS_EVENT,
  GOAL_REMOVE_EVENT,
  GOAL_TAG_EVENT,
  type GoalListDetail,
} from './ptk-target-goals.js';

export {
  ENTRIES_CHANGE_EVENT,
  LIFTS_FOLD_LABEL,
  type EntriesChangeDetail,
} from './ptk-target-lifts.js';

export {
  GOAL_REQUEST_EVENT,
  VIEW_CHANGE_EVENT,
  type GoalRequestDetail,
  type PartitionRead,
  type RecordsStatus,
  type StandardsStatus,
  type ViewChangeDetail,
} from './ptk-target-report.js';

/** Every tag this package owns, paired with what to register under it. */
const ELEMENTS: readonly (readonly [string, typeof LitElement])[] = [
  [TARGET_CATEGORIES_TAG, PtkTargetCategories],
  [TARGET_CONTEXT_TAG, PtkTargetContext],
  [TARGET_FRESHNESS_TAG, PtkTargetFreshness],
  [TARGET_GOALS_TAG, PtkTargetGoals],
  [TARGET_LIFTS_TAG, PtkTargetLifts],
  [TARGET_REPORT_TAG, PtkTargetReport],
  [PLATFORM_TARGETS_TAG, PtkPlatformTargets],
];

/**
 * Registers the tool's elements, once.
 *
 * Safe to call any number of times, from any number of modules, in any order.
 * Returns the root constructor so a consumer can reach the property types without a
 * second import.
 *
 * A tag already held by *something else* is left alone rather than reported. There
 * is nothing useful to do about it here -- the page that defined it did so first and
 * this package cannot take it back -- and throwing would turn somebody else's naming
 * collision into this tool refusing to load at all.
 */
export function definePlatformTargets(): typeof PtkPlatformTargets {
  for (const [tag, constructor] of ELEMENTS) {
    if (customElements.get(tag) === undefined) {
      customElements.define(tag, constructor);
    }
  }
  return PtkPlatformTargets;
}
