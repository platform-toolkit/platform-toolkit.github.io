/**
 * Defining a remembered setting, and reading one back safely.
 *
 * A READ ALWAYS ANSWERS
 *
 * `read` returns the stored value or the fallback and cannot do anything else.
 * No throw, no `null`, no "loading". That is what lets a component seed its
 * initial state in one line and never render a half-configured screen, and it is
 * the reason every rejection path below ends in the same place: a value that is
 * missing, truncated, malformed, out of bounds, or written by a build that
 * modelled the setting differently is *the same situation* to the lifter at the
 * rack -- they have no remembered setting -- and behaving differently in each
 * case would only be visible as flakiness.
 *
 * A value that fails to parse is also deleted. Without that, one bad entry costs
 * a parse on every read for the life of the origin, and -- worse -- the state is
 * invisible: everything looks normal, the setting silently never sticks, and the
 * only evidence is in a storage inspector nobody opens.
 *
 * A WRITE MAY FAIL, AND SAYS SO
 *
 * Quota is finite, storage can vanish between two reads, and a write to a full
 * disk throws. None of that may take the screen down -- the ramp is the product,
 * the remembered bar weight is a convenience -- so failure is a returned value
 * rather than an exception, with a coarse reason and nothing else. The same
 * shape the data-access seam uses for its failures, for the same reason: there
 * is no field to accidentally put a value in.
 *
 * READS ARE SYNCHRONOUS, DELIBERATELY
 *
 * Web storage is synchronous, and making the seam asynchronous for the sake of a
 * hypothetical native host would buy a "preferences not loaded yet" state in
 * every component in the collection -- a visible flash of defaults on every
 * mount, paid today against a maybe. An asynchronous backend can be added
 * without disturbing any of this by hydrating a snapshot once at start-up and
 * keeping these methods as they are; the change lands in construction, not in
 * callers.
 */
import * as v from 'valibot';

import type { PreferenceStorage } from './storage.js';
import type { PreferenceValue } from './value.js';

/**
 * Prefix on every key this package writes.
 *
 * A tool may share an origin with anything the site later serves, and
 * `forgetAll` has to be able to say which keys are its own. Sweeping the whole
 * origin would be a "reset my settings" button that deletes somebody else's.
 */
export const PREFERENCE_KEY_PREFIX = 'ptk.';

/**
 * Names are lowercase, dot-separated, and hyphenated within a segment.
 *
 * Checked rather than trusted because the name ends up as a storage key: a
 * definition with an empty segment or a stray dot produces a key that looks
 * plausible, collides with a different definition, and hands one tool's setting
 * to another.
 */
const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** A setting the toolkit remembers, its shape, and what it means to not have one. */
export interface PreferenceDefinition<Stored> {
  /** The name, without the package prefix. */
  readonly name: string;
  readonly value: PreferenceValue<Stored>;
  /** What `read` answers when there is nothing stored, or nothing usable. */
  readonly fallback: Stored;
}

/**
 * Declares a remembered setting.
 *
 * The fallback is validated here, at module load, against the same schema every
 * read uses. A default that does not satisfy its own shape is a bug that would
 * otherwise never surface: `read` would keep returning it, the value would be
 * out of bounds everywhere downstream, and every test that exercised the stored
 * path would pass.
 */
export function definePreference<Stored>(
  definition: PreferenceDefinition<Stored>,
): PreferenceDefinition<Stored> {
  if (!KEY_PATTERN.test(definition.name)) {
    throw new RangeError(
      `A preference name must be dot-separated lowercase, received "${definition.name}"`,
    );
  }
  if (!v.is(definition.value.schema, definition.fallback)) {
    throw new RangeError(`The fallback for "${definition.name}" does not satisfy its own shape`);
  }
  return definition;
}

/** Whether a write landed, and if not, why -- coarsely. */
export type PreferenceWriteResult =
  /** Stored. */
  | 'saved'
  /** There is no storage on this device or in this frame. Nothing was lost. */
  | 'unavailable'
  /** Storage exists and refused: full quota, or a policy that allows reads only. */
  | 'refused';

export interface PreferenceStore {
  /**
   * Whether anything written here will survive a reload.
   *
   * Exposed so a screen offering a "remember my equipment" affordance can avoid
   * promising something it cannot deliver. Never required: every method works
   * either way.
   */
  readonly remembers: boolean;
  read<Stored>(definition: PreferenceDefinition<Stored>): Stored;
  write<Stored>(definition: PreferenceDefinition<Stored>, value: Stored): PreferenceWriteResult;
  /** Drops one setting, so the next read answers with the fallback. */
  forget<Stored>(definition: PreferenceDefinition<Stored>): void;
  /**
   * Drops every setting this package has written, including ones no current
   * definition names.
   *
   * The keys are swept rather than the definitions walked, because "reset
   * everything" has to include the settings left behind by a build that has
   * since removed them. A definition list would quietly leave those in place and
   * the reset would not be one.
   */
  forgetAll(): void;
}

function storageKey(definition: PreferenceDefinition<unknown>): string {
  return PREFERENCE_KEY_PREFIX + definition.name;
}

/**
 * Builds a store over the given storage, or over nothing at all.
 *
 * `null` is an ordinary argument here, not an error: see the note at the top of
 * `storage.ts`. The resulting store reads fallbacks, reports `unavailable` on
 * every write, and is otherwise indistinguishable, so no caller needs a branch.
 */
export function createPreferenceStore(storage: PreferenceStorage | null): PreferenceStore {
  return {
    remembers: storage !== null,

    read<Stored>(definition: PreferenceDefinition<Stored>): Stored {
      if (storage === null) return definition.fallback;

      const raw = storage.read(storageKey(definition));
      if (raw === null) return definition.fallback;

      const parsed = parseStored(definition, raw);
      if (parsed === null) {
        // Delete on the way past. A tab killed mid-write leaves truncated JSON
        // that can never parse, and leaving it means the setting silently never
        // sticks again with nothing on screen to explain why.
        storage.remove(storageKey(definition));
        return definition.fallback;
      }
      return parsed.value;
    },

    write<Stored>(definition: PreferenceDefinition<Stored>, value: Stored): PreferenceWriteResult {
      if (!v.is(definition.value.schema, value)) {
        // Not a storage failure and not silently dropped either: a caller
        // writing a value its own definition forbids is a programming error, and
        // the next read would hand back the fallback with no indication that
        // anything had gone wrong.
        //
        // Checked before the storage test, so the bug behaves the same way on a
        // device with no storage. The other order makes it a defect that
        // reproduces only for some visitors, which is the hardest kind to be
        // told about.
        throw new RangeError(
          `The value written to "${definition.name}" does not satisfy its shape`,
        );
      }
      if (storage === null) return 'unavailable';
      try {
        storage.write(storageKey(definition), JSON.stringify(value));
        return 'saved';
      } catch {
        // The reason is not inspected. Browsers report a full quota, a
        // read-only policy, and a partitioned frame with the same exception
        // name, so any finer classification would be a guess -- and the caller's
        // only real choice is whether to say "this will not be remembered".
        return 'refused';
      }
    },

    forget<Stored>(definition: PreferenceDefinition<Stored>): void {
      storage?.remove(storageKey(definition));
    },

    forgetAll(): void {
      if (storage === null) return;
      for (const key of storage.keys()) {
        if (key.startsWith(PREFERENCE_KEY_PREFIX)) storage.remove(key);
      }
    },
  };
}

/**
 * Parses one stored string, or `null` for anything unusable.
 *
 * Wrapped in an object so that a legitimately stored `null`-ish value could
 * never be confused with a rejection. Nothing stores `null` today; relying on
 * that is how a reasonable-looking change breaks a read months later.
 */
function parseStored<Stored>(
  definition: PreferenceDefinition<Stored>,
  raw: string,
): { readonly value: Stored } | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    // Truncated or hand-edited. There is nothing to report and nothing to fix:
    // the caller gets the fallback and the entry is cleared by the caller above.
    return null;
  }

  const result = v.safeParse(definition.value.schema, decoded);
  // The issues are deliberately not read, let alone logged. They quote the
  // offending value, and although a preference is equipment rather than
  // identity, a log line is forever and the shape of this code is what the next
  // preference will be modelled on.
  return result.success ? { value: result.output } : null;
}
