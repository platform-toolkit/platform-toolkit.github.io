// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * How a record gets from the warm-up calculator to the logbook. Section 4.3.
 *
 * WHY STORAGE AND NOT A QUERY STRING
 *
 * A link is the obvious answer and it fails on the thing that makes this feature
 * worth having. A session of four lifts with adjusted rungs and a full plate
 * inventory is well past the length a URL survives being shared, and every byte
 * of it would be in the address bar, in the history, and in the `Referer` of
 * whatever the lifter opened next -- for a tool whose one promise is that
 * training stays on the device. Storage on the same origin carries the record
 * between two pages of the same site and nowhere else.
 *
 * The cost is that the carrier is writable by anything else running on the
 * origin, which is why `core/handoff.ts` validates the record as hard as it
 * validates a backup file, and why the record has no field that could put a
 * string of somebody else's choosing on a screen.
 *
 * WHY `localStorage` AND NOT `sessionStorage`
 *
 * The calculator's own ticks live in `sessionStorage` for a good reason -- see
 * `packages/preferences` -- and it is tempting to file this beside them, since a
 * handoff is scratch state if anything is. It does not work: a session store is
 * per tab, and a lifter who middle-clicks the link, or whose browser opens it in
 * a new tab, arrives in a tab that inherits nothing. That is not an edge case on
 * a phone, and the failure is the tool shrugging at somebody who just pressed a
 * button. The expiry below is what keeps it from behaving like a setting.
 *
 * WHY THE PORT IS THREE METHODS AND NOT THE PREFERENCE STORE
 *
 * {@link HandoffStorage} is deliberately the shape `PreferenceStorage` already
 * has, so the shell hands `browserPreferenceStorage()` straight in with no
 * adapter and this package takes no dependency on `packages/preferences`. What
 * it does not go through is the preference *store*, and that is not an oversight
 * to be tidied later: that store's value builders refuse free text on purpose,
 * and a record is a validated document rather than a setting. The rule the two
 * share is upheld here by the record's own shape -- there is no free-text field
 * in it to smuggle anything through.
 *
 * The key sits under the same `ptk.` prefix everything else on this origin uses,
 * so a lifter who clears the toolkit's remembered settings clears an abandoned
 * handoff along with them.
 */

import {
  createHandoff,
  parseHandoff,
  serializeHandoff,
  type HandoffContent,
} from './core/handoff.js';
import type { Instant, WarmupHandoff } from './types.js';

export {
  HANDOFF_VERSION,
  createHandoff,
  handoffLifts,
  parseHandoff,
  serializeHandoff,
  workoutFromHandoff,
  type HandoffContent,
  type HandoffLanding,
  type HandoffLandingOptions,
  type HandoffLift,
} from './core/handoff.js';
export type { HandoffExercise, WarmupHandoff } from './types.js';
/**
 * The rack bridge, re-exported so a writer needs nothing but this subpath.
 *
 * A calculator holds an `Equipment` -- a bar preset, a collar preset, an
 * inventory -- and a record carries the resolved weights, because the reading
 * build may not have the same presets. `snapshotFrom` is that conversion and it
 * is the only part of `./core` the writing side has any use for; sending it
 * there for one function would make the subpath's whole claim untrue.
 */
export { snapshotFrom } from './core/equipment.js';
export type { EquipmentSnapshot } from './types.js';

/** Where a pending handoff is left. Prefixed so a settings reset sweeps it. */
export const HANDOFF_STORAGE_KEY = 'ptk.logbook.warmup-handoff';

/**
 * How long a record stays worth offering.
 *
 * An hour, which is longer than the walk from the calculator to the logbook and
 * shorter than a training session. The number matters in one direction only: a
 * record with no expiry is a tool that offers to log Tuesday's warm-up on
 * Thursday, and the lifter has by then no idea where the offer came from.
 *
 * Deliberately not enforced by the writer. A record is written once and read on
 * a page that may be opened at any point afterwards, so the age is a question
 * the reader asks.
 */
export const HANDOFF_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Somewhere to leave a string for the other page.
 *
 * Structurally what `browserPreferenceStorage()` returns, so the shell passes
 * that in directly. `write` may throw -- a full quota is ordinary rather than
 * exceptional -- and everything below treats a throw as "there is nowhere to put
 * this", which is the only thing a caller can act on.
 */
export interface HandoffStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/** What the logbook reads. Nothing else in the tool touches the key. */
export interface HandoffSource {
  /**
   * The record waiting, if there is a usable one.
   *
   * **Does not consume it.** Reading and deleting in one step is the obvious
   * shape and it loses a lifter's session to a reload: the offer is on screen,
   * the phone reloads the tab, and the record it was about is gone. What is
   * deleted in passing is only what can never be used -- a record too old, or
   * one that does not parse -- because leaving those behind would have the
   * logbook re-reading the same rubbish on every visit.
   */
  peek(): WarmupHandoff | null;
  /** Forget the record. Called once the lifter has answered the offer. */
  clear(): void;
}

export interface HandoffSourceOptions {
  /** Epoch milliseconds. The shell's clock, so a test can move it. */
  readonly now: () => number;
}

/**
 * A reader over the origin's storage, or one that never finds anything.
 *
 * `null` storage is a supported mode and not an error -- the same rule
 * `createPreferenceStore(null)` follows. A logbook framed by a site where the
 * browser refuses storage simply never sees a handoff, which is correct: the
 * calculator in that frame could not have written one either.
 */
export function createHandoffSource(
  storage: HandoffStorage | null,
  options: HandoffSourceOptions,
): HandoffSource {
  const forget = (): void => {
    if (storage === null) return;
    try {
      storage.remove(HANDOFF_STORAGE_KEY);
    } catch {
      // Nothing to do and nothing to tell anybody. A remove that fails leaves a
      // record that will be refused again on the next read, and the alternative
      // -- reporting it -- is an error message about an offer the lifter has
      // already dealt with.
    }
  };

  return {
    peek: () => {
      if (storage === null) return null;
      let raw: string | null;
      try {
        raw = storage.read(HANDOFF_STORAGE_KEY);
      } catch {
        return null;
      }
      if (raw === null) return null;

      const record = parseHandoff(raw);
      if (record === null || isExpired(record, options.now())) {
        forget();
        return null;
      }
      return record;
    },
    clear: forget,
  };
}

/**
 * Leaves a record for the logbook to find.
 *
 * `'unavailable'` rather than a throw, and the calculator uses it to decide what
 * its link says -- section 2.3's storage-honesty rule from the other side. A tool
 * that offered to hand a session over and silently handed nothing over would send
 * a lifter to an empty home screen wondering what they pressed.
 */
export function offerHandoff(
  storage: HandoffStorage | null,
  content: HandoffContent,
  at: Instant,
): 'offered' | 'unavailable' {
  if (storage === null) return 'unavailable';
  try {
    storage.write(HANDOFF_STORAGE_KEY, serializeHandoff(createHandoff(content, at)));
    return 'offered';
  } catch {
    return 'unavailable';
  }
}

/**
 * Whether a record is past its hour.
 *
 * A stamp that will not parse counts as expired. It arrived through a schema
 * that only asked for a non-empty string -- which is the right question for an
 * instant everywhere else in this package, because `workoutDurationMillis`
 * already treats an unreadable one as "unknown duration". Here there is a
 * better answer available: a record whose age cannot be established is a record
 * with no claim to be recent.
 */
function isExpired(record: WarmupHandoff, now: number): boolean {
  const created = Date.parse(record.createdAt);
  if (Number.isNaN(created)) return true;
  return now - created > HANDOFF_MAX_AGE_MS;
}
