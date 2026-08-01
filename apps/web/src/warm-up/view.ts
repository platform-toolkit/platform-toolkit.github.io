/**
 * Builds the warm-up calculator and gives it somewhere to remember things.
 *
 * The counterpart of `platform-targets/view.ts`, and the same rule: this is the
 * only file in the tool that knows the browser has storage, exactly as that one
 * is the only file that knows it has a network. Everything below takes what it
 * needs as a property, which is what lets the whole interface be exercised in a
 * story, a Node test, or a browser test with nothing behind it.
 *
 * WHY TWO STORES
 *
 * What a lifter squats does not change between Tuesday and Thursday, and
 * re-typing four working weights at a rack is the friction this tool exists to
 * remove -- so the rack and the weights go in ordinary storage. A tick means "I
 * did that set today": it has to survive a phone locking and the tab reloading
 * an hour later, and it must be gone next week. That is `sessionStorage`, and
 * the ticks are additionally pinned to the weight they were made against, so
 * even within one tab a changed working weight discards them (see `session.ts`).
 *
 * Two stores rather than one with a lifetime flag, because the difference has to
 * be impossible to get wrong later: a flag is one edit away from remembering
 * last Tuesday's ticks against this Tuesday's ramp, and that failure reads as a
 * set the lifter has already done.
 */
import {
  browserPreferenceStorage,
  browserSessionStorage,
  createPreferenceStore,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import './ptk-warm-up-calculator.js';
import type { PtkWarmUpCalculator } from './ptk-warm-up-calculator.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'warm-up';

export interface WarmUpViewOptions {
  /** Defaults to this device's ordinary storage. Injected in tests. */
  readonly settings?: PreferenceStore;
  /** Defaults to this tab's storage. Injected in tests. */
  readonly marks?: PreferenceStore;
}

/**
 * The tool, ready to append.
 *
 * Storage that is unavailable is not an error and needs no branch here:
 * `browserPreferenceStorage` answers `null` when the origin refuses access, and
 * `createPreferenceStore(null)` reads fallbacks and reports `unavailable` on
 * every write. The screen then says so in one sentence rather than failing to
 * mount -- which is the case that matters, because a third-party iframe with
 * storage blocked is a configuration these tools are designed to ship into.
 */
export function createWarmUpView(options: WarmUpViewOptions = {}): PtkWarmUpCalculator {
  const element = document.createElement('ptk-warm-up-calculator');
  element.settings = options.settings ?? createPreferenceStore(browserPreferenceStorage());
  element.marks = options.marks ?? createPreferenceStore(browserSessionStorage());
  return element;
}
