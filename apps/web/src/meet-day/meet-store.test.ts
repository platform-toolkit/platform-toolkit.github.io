// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The store, tested through a fake string storage rather than a browser.
 *
 * Four behaviours here are worth more than the rest, and each is a way to lose a
 * meet quietly:
 *
 * **Only what changed is written.** Not an optimisation with a test attached --
 * without it, one keystroke re-serialises the whole shelf into a synchronous
 * API. The test counts writes, which is the only way to see it.
 *
 * **A meet this build cannot read is left alone.** The failing case is a lifter
 * who opens an old tab: it must not sweep up meets the current build wrote. The
 * test writes a meet from the future, loads, saves, and checks the key survived.
 *
 * **A full quota does not advance the snapshot.** After a refused write the next
 * save has to try everything again; a store that recorded the write as done
 * would leave the meet only in memory, and the screen would say it was saved.
 *
 * **The counter survives a lost index.** The shelf is rebuilt from the keys, and
 * a rebuild that restarted the counter at one would hand the next new meet an id
 * an existing meet already holds.
 */
import { memoryPreferenceStorage, type PreferenceStorage } from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import {
  browserMeetStore,
  noMeetStore,
  sessionMeets,
  storedMeets,
  type MeetStore,
} from './meet-store.js';
import {
  EMPTY_LIBRARY,
  EMPTY_SAVED_STATE,
  type MeetLibrary,
  type SavedMeet,
  createMeet,
  deleteMeet,
  renameMeet,
} from './saved-meet.js';

const NOW = 1_770_000_000_000;

function meet(id: string, name: string): SavedMeet {
  return {
    id,
    name,
    createdAt: NOW,
    updatedAt: NOW,
    archived: false,
    rulesProfileId: 'uspa-2026',
    rulebookRevision: '2026-01',
    methodologyVersion: 'attempt-plan-2026.1',
    state: EMPTY_SAVED_STATE,
  };
}

function libraryOf(...meets: readonly SavedMeet[]): MeetLibrary {
  return {
    meets,
    activeMeetId: meets[0]?.id ?? null,
    nextOrdinal: meets.length + 1,
  };
}

/**
 * Counts writes and removals, and can be told to refuse.
 *
 * The refusal is a real `DOMException` rather than a bare `{ name }`, which is
 * both what a browser actually throws when the quota is full and what
 * `only-throw-error` requires. The store reads nothing but `.name` off it, so
 * the two are interchangeable to the code under test -- and a fixture throwing
 * something no browser throws is a test of a path production never takes.
 */
function countingStorage(): PreferenceStorage & {
  writes: string[];
  removals: string[];
  refuse: DOMException | null;
} {
  const inner = memoryPreferenceStorage();
  const spy = {
    writes: [] as string[],
    removals: [] as string[],
    refuse: null as DOMException | null,
    keys: () => inner.keys(),
    read: (key: string) => inner.read(key),
    write: (key: string, value: string) => {
      if (spy.refuse !== null) throw spy.refuse;
      spy.writes.push(key);
      inner.write(key, value);
    },
    remove: (key: string) => {
      spy.removals.push(key);
      inner.remove(key);
    },
  };
  return spy;
}

async function loadLibrary(store: MeetStore): Promise<MeetLibrary> {
  return (await store.load()).library;
}

describe('a store over browser storage', () => {
  it('keeps a write on the device', () => {
    expect(storedMeets(memoryPreferenceStorage()).persistence).toBe('device');
  });

  it('starts empty', async () => {
    const stored = await storedMeets(memoryPreferenceStorage()).load();
    expect(stored).toEqual({ library: EMPTY_LIBRARY, unreadable: 0 });
  });

  it('round-trips a shelf, in order, with the open meet still open', async () => {
    const storage = memoryPreferenceStorage();
    const library = libraryOf(meet('meet-2', 'Second'), meet('meet-1', 'First'));
    expect(await storedMeets(storage).save(library)).toBe('saved');

    const back = await loadLibrary(storedMeets(storage));
    expect(back.meets.map((entry) => entry.name)).toEqual(['Second', 'First']);
    expect(back.activeMeetId).toBe('meet-2');
    expect(back.nextOrdinal).toBe(3);
  });

  it('writes only the meets that changed', async () => {
    const storage = countingStorage();
    const store = storedMeets(storage);
    const first = libraryOf(meet('meet-1', 'First'), meet('meet-2', 'Second'));
    await store.save(first);
    storage.writes.length = 0;

    const renamed = renameMeet(first, 'meet-1', 'Renamed');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    await store.save(renamed.library);

    expect(storage.writes).toEqual(['ptk.meet-day.meet.meet-1', 'ptk.meet-day.library']);
  });

  it('writes nothing but the index when only the open meet changed', async () => {
    const storage = countingStorage();
    const store = storedMeets(storage);
    const library = libraryOf(meet('meet-1', 'First'));
    await store.save(library);
    storage.writes.length = 0;

    await store.save({ ...library, activeMeetId: null });
    expect(storage.writes).toEqual(['ptk.meet-day.library']);
  });

  it('removes the key of a deleted meet', async () => {
    const storage = countingStorage();
    const store = storedMeets(storage);
    const library = libraryOf(meet('meet-1', 'First'), meet('meet-2', 'Second'));
    await store.save(library);

    const removed = deleteMeet(library, 'meet-2');
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    await store.save(removed.library);

    expect(storage.removals).toEqual(['ptk.meet-day.meet.meet-2']);
    expect(await loadLibrary(storedMeets(storage))).toMatchObject({
      meets: [{ id: 'meet-1' }],
    });
  });

  it('writes what a fresh store loaded, and no more, after a reload', async () => {
    const storage = countingStorage();
    await storedMeets(storage).save(libraryOf(meet('meet-1', 'First')));

    const reopened = storedMeets(storage);
    const library = await loadLibrary(reopened);
    storage.writes.length = 0;
    await reopened.save(library);
    // The snapshot came from `load`, so nothing about the meet is rewritten --
    // which is what stops a page that merely opened from touching every key.
    expect(storage.writes).toEqual(['ptk.meet-day.library']);
  });
});

describe('a meet this build cannot read', () => {
  async function shelfWithStranger(): Promise<PreferenceStorage> {
    const storage = memoryPreferenceStorage();
    await storedMeets(storage).save(libraryOf(meet('meet-1', 'Mine')));
    storage.write('ptk.meet-day.meet.meet-4', JSON.stringify({ id: 'meet-4', from: 'the future' }));
    return storage;
  }

  it('is counted, and is not on the shelf', async () => {
    const stored = await storedMeets(await shelfWithStranger()).load();
    expect(stored.unreadable).toBe(1);
    expect(stored.library.meets.map((entry) => entry.id)).toEqual(['meet-1']);
  });

  it('survives a save that rewrites everything around it', async () => {
    const storage = await shelfWithStranger();
    const store = storedMeets(storage);
    const library = await loadLibrary(store);
    const added = createMeet(library, {
      name: 'Another',
      now: NOW,
      rulesProfileId: 'uspa-2026',
      rulebookRevision: '2026-01',
      state: EMPTY_SAVED_STATE,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    await store.save(added.library);

    expect(storage.read('ptk.meet-day.meet.meet-4')).not.toBeNull();
  });

  it('never has its id handed to a new meet', async () => {
    const storage = await shelfWithStranger();
    const library = await loadLibrary(storedMeets(storage));
    expect(library.nextOrdinal).toBeGreaterThan(4);
  });

  it('is not counted as text that merely failed to parse differently', async () => {
    const storage = memoryPreferenceStorage();
    storage.write('ptk.meet-day.meet.meet-1', 'not json at all');
    const stored = await storedMeets(storage).load();
    expect(stored.unreadable).toBe(1);
    expect(stored.library.meets).toEqual([]);
  });

  it('goes when the whole shelf is deleted, which is the only thing that removes it', async () => {
    const storage = await shelfWithStranger();
    await storedMeets(storage).clear();
    expect(storage.keys().filter((key) => key.startsWith('ptk.meet-day.'))).toEqual([]);
  });
});

describe('a damaged or missing index', () => {
  it('rebuilds the shelf from the keys', async () => {
    const storage = memoryPreferenceStorage();
    await storedMeets(storage).save(libraryOf(meet('meet-1', 'First'), meet('meet-2', 'Second')));
    storage.remove('ptk.meet-day.library');

    const library = await loadLibrary(storedMeets(storage));
    expect(library.meets.map((entry) => entry.id).sort()).toEqual(['meet-1', 'meet-2']);
    expect(library.activeMeetId).toBeNull();
  });

  it('does not restart the counter, which would collide with an existing meet', async () => {
    const storage = memoryPreferenceStorage();
    await storedMeets(storage).save(libraryOf(meet('meet-7', 'Seventh')));
    storage.write('ptk.meet-day.library', '{ not json');

    const library = await loadLibrary(storedMeets(storage));
    expect(library.nextOrdinal).toBe(8);
  });

  it('picks up a meet the index never mentioned', async () => {
    const storage = memoryPreferenceStorage();
    await storedMeets(storage).save(libraryOf(meet('meet-1', 'First')));
    storage.write('ptk.meet-day.meet.meet-2', JSON.stringify(meet('meet-2', 'Orphan')));

    const library = await loadLibrary(storedMeets(storage));
    expect(library.meets.map((entry) => entry.name).sort()).toEqual(['First', 'Orphan']);
  });

  it('closes an open meet whose id is no longer on the shelf', async () => {
    const storage = memoryPreferenceStorage();
    await storedMeets(storage).save(libraryOf(meet('meet-1', 'First')));
    storage.remove('ptk.meet-day.meet.meet-1');

    const library = await loadLibrary(storedMeets(storage));
    expect(library.activeMeetId).toBeNull();
  });
});

describe('when the write is refused', () => {
  it('reports a full quota as its own outcome', async () => {
    const storage = countingStorage();
    storage.refuse = new DOMException('The quota is full.', 'QuotaExceededError');
    expect(await storedMeets(storage).save(libraryOf(meet('meet-1', 'First')))).toBe(
      'storage-full',
    );
  });

  it('reports anything else as a plain failure', async () => {
    const storage = countingStorage();
    storage.refuse = new DOMException('Storage is blocked.', 'SecurityError');
    expect(await storedMeets(storage).save(libraryOf(meet('meet-1', 'First')))).toBe('failed');
  });

  it('retries the whole shelf on the next save', async () => {
    const storage = countingStorage();
    const store = storedMeets(storage);
    const library = libraryOf(meet('meet-1', 'First'), meet('meet-2', 'Second'));
    storage.refuse = new DOMException('The quota is full.', 'QuotaExceededError');
    await store.save(library);

    storage.refuse = null;
    storage.writes.length = 0;
    expect(await store.save(library)).toBe('saved');
    expect(storage.writes).toEqual([
      'ptk.meet-day.meet.meet-1',
      'ptk.meet-day.meet.meet-2',
      'ptk.meet-day.library',
    ]);
  });
});

describe('the stores that keep nothing on the device', () => {
  it('holds a shelf for the life of the page and says the page is all it is', async () => {
    const store = sessionMeets();
    expect(store.persistence).toBe('page');
    await store.save(libraryOf(meet('meet-1', 'First')));
    expect((await loadLibrary(store)).meets).toHaveLength(1);
    await store.clear();
    expect((await loadLibrary(store)).meets).toEqual([]);
  });

  it('refuses to save at all in the embed', async () => {
    const store = noMeetStore();
    expect(store.persistence).toBe('none');
    expect(await store.save(libraryOf(meet('meet-1', 'First')))).toBe('no-storage');
    expect((await loadLibrary(store)).meets).toEqual([]);
  });

  /*
   * The two above are the whole reason `persistence` is three values rather than
   * a `durable` boolean, so they are asserted as *different* as well as
   * individually -- a narrowing back to two would satisfy both of the assertions
   * above under some pairing, and the screen branches on the difference: one gets
   * §24 under a warning, the other gets no §24 at all.
   */
  it('distinguishes a shelf that lasts the page from no shelf', () => {
    expect(sessionMeets().persistence).not.toBe(noMeetStore().persistence);
  });
});

describe('choosing a store for the page', () => {
  it('falls back to a session shelf where there is no browser storage', () => {
    // Node has no `localStorage`, which is the same answer a framed tool gets.
    // `page` and not `none`: a lifter in a private window still has a meet to
    // run, so the fallback keeps the shelf and the screen says what it is worth.
    expect(browserMeetStore().persistence).toBe('page');
  });
});
