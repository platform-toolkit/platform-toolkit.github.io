// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a saved meet actually goes.
 *
 * §24 opens with what this is not: no sign-in, no account, no server, no
 * synchronisation. What is left is one device's browser, and this file is the
 * only thing in the tool that knows that.
 *
 * WHY THE SEAM IS ASYNCHRONOUS OVER A SYNCHRONOUS BACKING
 *
 * `localStorage` is synchronous, so every promise here is already resolved and
 * the awaits cost a microtask. They are there because §30 says a locally saved
 * meet should be able to migrate to an account later, and every candidate for
 * "later" -- IndexedDB, the Cache API, a fetch to a server, a native app's file
 * system -- is asynchronous. A synchronous seam would make that a rewrite of
 * every caller instead of one line in `view.ts`; §5.7's packaging-job test is
 * the same requirement said from the other end. This is the one place in the
 * collection where a promise is worth its cost, and the reason is that the port
 * behind it is expected to change.
 *
 * WHY THIS IS NOT A PREFERENCE
 *
 * `packages/preferences` holds settings: small, known-shaped, one value per
 * definition, with a builder that admits no free text (§5.12). A meet is a
 * document a person authors -- names, notes, an unbounded roster -- and widening
 * the preference model to carry one would put free text into the layer that
 * deliberately refuses it. So the *model* is separate, and stays separate.
 *
 * What is reused is `PreferenceStorage`, which is not the preference model at
 * all: it is a four-method port over "somewhere to keep strings", and it already
 * carries the write-and-delete probe, the throw-on-property-access guard, and
 * the fact that a framed tool often has no storage whatsoever. Rewriting that
 * here would be a second copy of the subtlest code in the repository, and the
 * copy would be the untested one.
 *
 * WHAT IS NEVER DELETED
 *
 * A meet whose stored text this build cannot parse is left exactly where it is.
 * It is not in the returned library, so nothing can open it, and it is never
 * overwritten or swept up -- because the reason a build cannot read a meet is
 * usually that a *newer* build wrote it, and a lifter who opens an old tab must
 * not thereby destroy the meet their current phone can open. Deleting the whole
 * shelf is the one thing that removes them, and that is a control a person
 * presses on purpose (§24.3).
 */
import { browserPreferenceStorage, type PreferenceStorage } from '@platform-toolkit/preferences';

import { readSavedMeet } from './meet-file.js';
import { EMPTY_LIBRARY, type MeetLibrary, type SavedMeet } from './saved-meet.js';

/** Everything this tool writes sits under here, so a sweep can find all of it. */
const KEY_PREFIX = 'ptk.meet-day.';

/** The shelf: what order, what is open, and where the counter has got to. */
const INDEX_KEY = `${KEY_PREFIX}library`;

/** One meet per key. See `save` for why it is not one key for the shelf. */
const MEET_PREFIX = `${KEY_PREFIX}meet.`;

/** What came back from storage, and what could not. */
export interface StoredLibrary {
  readonly library: MeetLibrary;
  /**
   * How many saved meets this build could not read.
   *
   * A count and not the meets themselves, because there is nothing to show: the
   * point of the number is a sentence saying some meets are here and this
   * version cannot open them, which is true and actionable and does not require
   * knowing anything about them.
   */
  readonly unreadable: number;
}

export type SaveOutcome =
  | 'saved'
  /** There is no storage on this device or in this frame. Nothing was written. */
  | 'no-storage'
  /** The quota is full. What was already saved is still there. */
  | 'storage-full'
  /** The write failed for some other reason. */
  | 'failed';

/**
 * How long a write lasts, which is three answers and not two.
 *
 * One field rather than a `durable` boolean beside a `keeps` boolean, because
 * `durable: true, keeps: false` is not a state any store can be in and a pair of
 * booleans is four states with one of them unreachable. The screen asks both
 * questions of this one field and gets a different screen for each answer:
 *
 * - `device` -- §24.3's reassuring warning ("only in this browser").
 * - `page` -- the same shelf under `STORAGE_WARNING_NOT_DURABLE`, because a
 *   lifter in a private window still has a meet to run and the honest sentence
 *   is that it goes when the tab does.
 * - `none` -- no shelf at all. Not the same as an empty one: Save, Export,
 *   Import and Delete everything are four controls that would each do nothing,
 *   and `apps/web/CLAUDE.md` is explicit that a button which cannot do anything
 *   is never on screen.
 */
export type MeetPersistence = 'device' | 'page' | 'none';

export interface MeetStore {
  /** How long a write lasts. See `MeetPersistence` -- the screen branches on all three. */
  readonly persistence: MeetPersistence;
  load(): Promise<StoredLibrary>;
  save(library: MeetLibrary): Promise<SaveOutcome>;
  /** §24.3's delete control. Removes every key this tool wrote, readable or not. */
  clear(): Promise<void>;
}

/** The shelf itself, as it is stored. Deliberately small and separate from the meets. */
interface StoredIndex {
  readonly order: readonly string[];
  readonly activeMeetId: string | null;
  readonly nextOrdinal: number;
  /** Ids present in storage that the build which wrote this index could not read. */
  readonly orphans: readonly string[];
}

function readIndex(raw: string | null): StoredIndex | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A damaged index is recoverable in a way a damaged meet is not: the meets
    // are under their own keys and are found by prefix, so the shelf is rebuilt
    // rather than lost. Returning null is what triggers that.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record: Record<string, unknown> = { ...parsed };
  const order = record['order'];
  const activeMeetId = record['activeMeetId'];
  const nextOrdinal = record['nextOrdinal'];
  const orphans = record['orphans'];
  if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) return null;
  if (typeof nextOrdinal !== 'number' || !Number.isInteger(nextOrdinal)) return null;
  if (activeMeetId !== null && typeof activeMeetId !== 'string') return null;
  const strayIds =
    Array.isArray(orphans) && orphans.every((id) => typeof id === 'string') ? orphans : [];
  return { order, activeMeetId, nextOrdinal, orphans: strayIds };
}

/**
 * The counter, rebuilt from the ids on the shelf.
 *
 * Only reached when the index is missing or damaged. Taking the highest ordinal
 * seen and adding one is what stops a rebuilt shelf from re-issuing an id that
 * a meet already holds -- restarting at 1 would make the next created meet
 * collide with the oldest one, and the collision is silent because
 * `createMeet` has no way to know.
 */
function ordinalAfter(ids: readonly string[]): number {
  let highest = 0;
  for (const id of ids) {
    const digits = id.startsWith('meet-') ? id.slice('meet-'.length) : '';
    const value = /^[0-9]+$/u.test(digits) ? Number(digits) : 0;
    if (value > highest) highest = value;
  }
  return highest + 1;
}

/**
 * A meet store over any string storage.
 *
 * Takes the port rather than reaching for `localStorage`, for the reason
 * `webStorage` gives: the interesting failures -- no storage, a full quota, a
 * write that throws -- are otherwise only reachable in the browsers where they
 * happen, and therefore tested in none of them.
 */
export function storedMeets(storage: PreferenceStorage): MeetStore {
  /**
   * What is on the shelf as far as this page knows, by id.
   *
   * Held so that `save` can write only what changed. The library is immutable
   * and every transition in `saved-meet.ts` replaces exactly the meets it
   * touches, so reference identity is an exact and free answer to "did this one
   * change" -- and without it, a keystroke in a notes field would re-serialise
   * twenty meets and hand them all to a synchronous main-thread API, four times
   * a second, on a phone.
   */
  let written = new Map<string, SavedMeet>();
  let orphans: readonly string[] = [];

  function keyFor(id: string): string {
    return `${MEET_PREFIX}${id}`;
  }

  return {
    persistence: 'device',

    load: () =>
      Promise.resolve().then(() => {
        const stored = readIndex(storage.read(INDEX_KEY));
        const keys = storage.keys().filter((key) => key.startsWith(MEET_PREFIX));
        const found = keys.map((key) => key.slice(MEET_PREFIX.length));
        // The index gives the order; anything on the shelf it does not mention
        // is appended rather than dropped, so a meet written by a tab whose
        // index write failed is still found.
        const ordered =
          stored === null
            ? found
            : [...stored.order, ...found.filter((id) => !stored.order.includes(id))];

        const meets: SavedMeet[] = [];
        const unreadable: string[] = [];
        for (const id of ordered) {
          const raw = storage.read(keyFor(id));
          if (raw === null) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            unreadable.push(id);
            continue;
          }
          const meet = readSavedMeet(parsed);
          if (meet === null) unreadable.push(id);
          else meets.push(meet);
        }

        written = new Map(meets.map((meet) => [meet.id, meet]));
        orphans = unreadable;

        const activeMeetId = stored?.activeMeetId ?? null;
        const library: MeetLibrary = {
          meets,
          // An open meet that turned out to be unreadable is closed rather than
          // left pointing at nothing: `activeMeet` would return null either way,
          // but a dangling id survives the next save and outlives the problem.
          activeMeetId: meets.some((meet) => meet.id === activeMeetId) ? activeMeetId : null,
          nextOrdinal: Math.max(
            stored?.nextOrdinal ?? 1,
            ordinalAfter([...meets.map((meet) => meet.id), ...unreadable]),
          ),
        };
        return { library, unreadable: unreadable.length };
      }),

    save: (library) =>
      Promise.resolve().then(() => {
        const next = new Map(library.meets.map((meet) => [meet.id, meet]));
        try {
          for (const meet of library.meets) {
            if (written.get(meet.id) === meet) continue;
            storage.write(keyFor(meet.id), JSON.stringify(meet));
          }
          for (const id of written.keys()) {
            // Orphans are not in `written`, so this cannot reach one.
            if (!next.has(id)) storage.remove(keyFor(id));
          }
          const index: StoredIndex = {
            order: library.meets.map((meet) => meet.id),
            activeMeetId: library.activeMeetId,
            nextOrdinal: library.nextOrdinal,
            orphans,
          };
          storage.write(INDEX_KEY, JSON.stringify(index));
        } catch (error) {
          // The snapshot is deliberately not updated, so the next save retries
          // everything this one did not manage. Nothing about the error is
          // logged: the value that failed to write is a lifter's meet.
          return isQuotaError(error) ? 'storage-full' : 'failed';
        }
        written = next;
        return 'saved';
      }),

    clear: () =>
      Promise.resolve().then(() => {
        for (const key of storage.keys()) {
          if (key.startsWith(KEY_PREFIX)) storage.remove(key);
        }
        written = new Map();
        orphans = [];
      }),
  };
}

/**
 * Whether a failed write was the quota rather than something worse.
 *
 * By name and by legacy code, because the two engines disagree and neither
 * exposes a type worth narrowing to. Getting it wrong is not serious -- both
 * branches are a refusal -- but the sentences differ: a full shelf is something
 * a person can fix by deleting a meet, and anything else is not.
 */
function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const named: { name?: unknown; code?: unknown } = error;
  return (
    named.name === 'QuotaExceededError' ||
    named.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    named.code === 22 ||
    named.code === 1014
  );
}

/**
 * A store that keeps meets for the life of the page and no longer.
 *
 * Not only a test double. It is what an embedded tool gets if it is ever given
 * a store at all, and what a private-browsing visitor falls back to -- in both
 * cases the screen can behave normally and say plainly that nothing is being
 * kept, which is better than a shelf control that refuses every press.
 */
export function sessionMeets(): MeetStore {
  let held = EMPTY_LIBRARY;
  return {
    persistence: 'page',
    load: () => Promise.resolve({ library: held, unreadable: 0 }),
    save: (library) => {
      held = library;
      return Promise.resolve('saved');
    },
    clear: () => {
      held = EMPTY_LIBRARY;
      return Promise.resolve();
    },
  };
}

/**
 * A store that holds nothing and says so.
 *
 * The embed's answer. Distinct from `sessionMeets` because an embedded planner
 * must not accumulate a lifter's meet in memory belonging to somebody else's
 * page: the parent shares that memory for as long as the frame is open, and a
 * bodyweight, an age, three maximums and a name are not this project's to leave
 * lying about on somebody else's site.
 *
 * `persistence: 'none'` is what withdraws §24 from the screen entirely, rather
 * than leaving four controls up that would each refuse. It is also the default
 * on `ptk-meet-day-planner`, so an element handed no store shows no shelf --
 * which is the honest default in both directions: a route that forgets to pass
 * a store loses a feature visibly, where the fail-open version would keep a
 * lifter's document under an origin nobody chose.
 */
export function noMeetStore(): MeetStore {
  return {
    persistence: 'none',
    load: () => Promise.resolve({ library: EMPTY_LIBRARY, unreadable: 0 }),
    save: () => Promise.resolve('no-storage'),
    clear: () => Promise.resolve(),
  };
}

/**
 * The store a standalone page uses: the browser's, or the page's memory.
 *
 * The fallback is `sessionMeets` rather than `noMeetStore` because a lifter in a
 * private window still has a meet to run, and a shelf that works until the tab
 * closes is worth having as long as the screen says so -- which is the whole
 * difference between `page` and `none`. Called from a page entry only; nothing
 * below it reaches for a global.
 */
export function browserMeetStore(): MeetStore {
  const storage = browserPreferenceStorage();
  return storage === null ? sessionMeets() : storedMeets(storage);
}
