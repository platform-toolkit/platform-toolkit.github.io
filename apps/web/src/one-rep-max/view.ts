/**
 * Builds the estimator and gives it somewhere to remember things.
 *
 * The same rule as the other tools' `view.ts` files: this is the only file in
 * the tool that knows the browser has storage. Everything below it takes what it
 * needs as a property, which is what lets the whole interface be exercised in a
 * story, a Node test, or a browser test with nothing behind it.
 *
 * NO DATA SOURCE, AND NO FEDERATION
 *
 * Unlike tools 1 and 4 there is nothing to read. The published equations, the
 * evidence weights and the methodology version are all constants of the
 * literature and live in `packages/domain` beside their citations (§5.1's
 * exception, recorded in §11): a paper's coefficients were fixed the day it
 * printed and cannot change without a release. So there is no `DataSource`, no
 * `data-federation` attribute on the mount point, and nothing on this screen
 * that a federation could revise -- an estimate is arithmetic, not a rule.
 *
 * WHY TWO STORES
 *
 * The unit, the lift, the movement standard and the two step sizes are settings:
 * a lifter picks pounds once. The set itself is not. A weight and a repetition
 * count reopened next week is a training record the lifter never chose to write,
 * on a device that may not be theirs -- and the refinements are worse, because
 * one of them is a sex marker. So the set lives in `sessionStorage`, where it
 * survives a phone locking and a reload at the rack and is gone by Tuesday.
 *
 * Two stores rather than one with a lifetime flag, for the reason tool 2 gives:
 * a flag is one edit away from persisting the thing that must not persist, and
 * that edit reads as a tidy-up.
 */
import {
  browserPreferenceStorage,
  browserSessionStorage,
  createPreferenceStore,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import './ptk-one-rep-max-calculator.js';
import type { PtkOneRepMaxCalculator } from './ptk-one-rep-max-calculator.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'one-rep-max';

export interface OneRepMaxViewOptions {
  /** Defaults to this device's ordinary storage. Injected in tests. */
  readonly settings?: PreferenceStore;
  /** Defaults to this tab's storage. Injected in tests. */
  readonly session?: PreferenceStore;
}

/**
 * The tool, ready to append.
 *
 * Storage that is unavailable needs no branch: `browserPreferenceStorage`
 * answers `null` when the origin refuses access and `createPreferenceStore(null)`
 * reads fallbacks and reports `unavailable` on every write. A third-party iframe
 * with storage blocked is a configuration this collection is designed to ship
 * into, so it is the supported path rather than a failure to mount.
 */
export function createOneRepMaxView(options: OneRepMaxViewOptions = {}): PtkOneRepMaxCalculator {
  const element = document.createElement('ptk-one-rep-max-calculator');
  element.settings = options.settings ?? createPreferenceStore(browserPreferenceStorage());
  element.session = options.session ?? createPreferenceStore(browserSessionStorage());
  return element;
}
