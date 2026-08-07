// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Asking the browser to keep this origin's storage. Section 10.3.
 *
 * A second axis from {@link LogbookStore.durable}, and confusing the two is the
 * mistake this file exists to prevent. `durable` answers "does a write here survive
 * the tab closing" -- IndexedDB yes, the memory store no. This answers "will the
 * browser throw it away when the device runs short of room", which is a question
 * about a database that is already durable. A logbook can be perfectly durable and
 * still be the first thing evicted, and a lifter told only the first half has been
 * told the reassuring half.
 *
 * WHY A PORT AND NOT `navigator.storage`
 *
 * Same rule as every other platform edge in this package: it is supplied, never
 * reached for. The word `navigator` appears nowhere below, so this compiles and
 * unit-tests without a DOM, a test hands in two functions instead of monkey-patching
 * a global that other tests in the same file share, and a host that has already
 * requested persistence for its own reasons can answer from what it knows rather
 * than asking the browser a second time.
 *
 * WHY THE REQUEST IS NOT MADE HERE, EVER, ON ITS OWN
 *
 * Section 10.3 is as much about *when* as about what: the ask happens at a
 * user-driven moment after the tool has shown it is worth keeping, and never on load.
 * Nothing in this file runs by itself -- {@link StoragePersistence.request} is called
 * from a press and from nowhere else, and {@link StoragePersistence.durability} is
 * the read that lets a screen know what to offer without asking for anything. Firefox
 * puts a permission prompt behind `persist()`, so a load-time call would be a
 * permission dialog thrown at somebody who has not yet logged a set -- the surest way
 * to be refused, permanently, by a person who would have said yes in a month.
 */

/**
 * What the browser says about this origin's storage.
 *
 * `'best-effort'` is the platform's own word for storage it may evict, and it is used
 * here rather than a boolean because the third answer is not a `false`: a browser with
 * no Storage API has not declined anything, and a screen that read `false` as a refusal
 * would tell a lifter their training is at risk on the strength of a missing method.
 */
export type StorageDurability = 'persisted' | 'best-effort' | 'unknown';

/**
 * The two questions, kept apart.
 *
 * Reading is free and silent; asking may raise a permission prompt and may only be
 * done on a press. One method that did both would make it impossible to render the
 * screen without triggering the thing the screen is offering.
 */
export interface StoragePersistence {
  /** What is true now. Asks the browser for nothing. */
  durability(): Promise<StorageDurability>;

  /**
   * Ask for persistence, and report what came back.
   *
   * Only ever from a press. A `'best-effort'` answer is an ordinary outcome and not
   * an error -- Chromium decides from its own engagement heuristics and will simply
   * say no to a site somebody has visited twice.
   */
  request(): Promise<StorageDurability>;
}

/**
 * The slice of `StorageManager` this needs.
 *
 * Structurally what `navigator.storage` already is, so the shell passes it straight
 * in. Declared rather than imported from the DOM lib so that this module has no
 * ambient dependency on one.
 */
export interface StorageManagerLike {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

/** The spec's two states, in this file's vocabulary. */
function fromGranted(granted: boolean): StorageDurability {
  return granted ? 'persisted' : 'best-effort';
}

/**
 * A persistence port over the browser's manager, or one that never knows anything.
 *
 * Absent is a supported mode and not an error -- the rule `createHandoffSource(null)`
 * follows, for the same reason: a host with no Storage API, or a frame whose storage
 * is partitioned away, is an ordinary place for this tool to run. It reports
 * `'unknown'` to both questions, and the screen offers nothing rather than offering a
 * control that cannot work.
 *
 * `undefined` is accepted alongside `null` so the browser case needs no check at the
 * call site. `navigator.storage` is typed as always present and is undefined on an
 * insecure origin, so a caller guarding it writes a condition its own compiler calls
 * dead -- and a dead-looking guard is one somebody deletes. Taking both here puts the
 * discrepancy in the file that knows about it.
 *
 * A rejected promise is `'unknown'` too, and that mapping is deliberate. `persist()`
 * rejects in a partitioned or sandboxed frame, and the honest reading of a rejection
 * is that the browser did not answer -- not that it said no. Reporting it as
 * `'best-effort'` would put a refusal on screen that nobody made.
 */
export function createStoragePersistence(
  manager: StorageManagerLike | null | undefined,
): StoragePersistence {
  if (manager === null || manager === undefined) {
    return {
      durability: (): Promise<StorageDurability> => Promise.resolve('unknown'),
      request: (): Promise<StorageDurability> => Promise.resolve('unknown'),
    };
  }

  return {
    durability: async (): Promise<StorageDurability> => {
      try {
        return fromGranted(await manager.persisted());
      } catch {
        return 'unknown';
      }
    },
    request: async (): Promise<StorageDurability> => {
      try {
        return fromGranted(await manager.persist());
      } catch {
        return 'unknown';
      }
    },
  };
}
