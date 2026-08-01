/**
 * Where remembered settings actually go, and the fact that quite often there is
 * nowhere.
 *
 * STORAGE IS OPTIONAL, NOT ASSUMED
 *
 * These tools are framed by third-party sites on purpose, and a framed document
 * is where storage disappears. Safari has blocked third-party storage for years;
 * Chrome partitions it and browsers increasingly refuse it outright to an
 * embedded frame the visitor has never interacted with. Private browsing takes
 * it away again. A managed device can turn it off entirely.
 *
 * So `localStorage` is not merely a thing that might fail to write. Touching the
 * property *throws* when access is denied -- before any method is called -- and
 * a tool that reaches for it during start-up dies at start-up, on the exact
 * configurations where nothing has gone wrong from the visitor's point of view.
 * That is why the probe below exists and why "no storage at all" is a supported
 * mode rather than an error path: a warm-up calculator that will not remember a
 * bar weight is a mild annoyance, and a warm-up calculator that shows a blank
 * screen inside somebody's blog is a broken tool.
 *
 * The port is deliberately not `Storage`. Four small methods keep the try/catch
 * in exactly one place and make a fake in a test a `Map`, and passing the real
 * `localStorage` straight through -- which is what a `Storage`-shaped port would
 * invite -- would put the unguarded object back in front of every caller.
 */

/** The narrow slice of the web storage API this package can use. */
interface WebStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Somewhere to keep a handful of small strings.
 *
 * `write` may throw -- a full quota is normal, not exceptional -- and the store
 * above is what turns that into an answer a caller can act on.
 */
export interface PreferenceStorage {
  /** Every key currently held, in no guaranteed order. */
  keys(): readonly string[];
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * The key the probe writes and immediately deletes.
 *
 * Namespaced like every other key so that a probe left behind by a tab killed
 * mid-write is swept up by `forgetAll` rather than sitting on the origin for
 * ever.
 */
const PROBE_KEY = 'ptk.storage-probe';

/**
 * Wraps a web storage object, or returns `null` when it cannot be used.
 *
 * The probe is a real write and a real delete, not a feature test. Safari's
 * private mode historically exposed a complete, working-looking `localStorage`
 * whose `setItem` threw on every call, and a capability check that only asked
 * "does this object have setItem" reported yes. The only reliable question is
 * whether a write succeeds.
 *
 * Takes the object as an argument rather than reading the global, so the failure
 * modes above can be exercised in a plain Node test with a few lines of fake --
 * the alternative is a code path that only runs in the browsers where it matters
 * and is therefore never tested in any of them.
 */
export function webStorage(candidate: WebStorageLike): PreferenceStorage | null {
  try {
    candidate.setItem(PROBE_KEY, '1');
    candidate.removeItem(PROBE_KEY);
  } catch {
    // Not swallowed: refusing storage is the answer this function exists to
    // give, and it is returned. There is nothing in the exception worth
    // reporting -- browsers throw a QuotaExceededError for "you may not do this
    // at all", so even the name would mislead.
    return null;
  }

  return {
    keys: () => {
      const found: string[] = [];
      for (let index = 0; index < candidate.length; index += 1) {
        const key = candidate.key(index);
        if (key !== null) found.push(key);
      }
      return found;
    },
    read: (key) => candidate.getItem(key),
    write: (key, value) => {
      candidate.setItem(key, value);
    },
    remove: (key) => {
      candidate.removeItem(key);
    },
  };
}

/**
 * The browser's own storage, or `null` where there is none to be had.
 *
 * Reading `globalThis.localStorage` is itself inside the try: the throw-on-access
 * behaviour described at the top of this file happens on the property getter, so
 * a check written as `if (typeof localStorage === 'undefined')` throws while
 * evaluating its own condition.
 */
export function browserPreferenceStorage(): PreferenceStorage | null {
  try {
    return webStorage(globalThis.localStorage);
  } catch {
    return null;
  }
}

/**
 * Storage that keeps values only for the life of the page.
 *
 * Not a test double -- tests use it, but its reason for existing is the native
 * app and the framed tool. Both want a store that behaves normally within a
 * session, and neither can rely on the browser's. Keeping this here means a
 * caller never has to branch on whether preferences are available in order to
 * write one.
 */
export function memoryPreferenceStorage(): PreferenceStorage {
  const entries = new Map<string, string>();
  return {
    keys: () => [...entries.keys()],
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}
