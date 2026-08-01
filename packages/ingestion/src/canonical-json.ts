/**
 * One value, one byte sequence, every time.
 *
 * Published artifacts are content-addressed: the filename contains a hash of
 * the bytes, and a build that produces different bytes for unchanged data
 * republishes a file nobody needed and invalidates a cache entry every reader
 * already had. `JSON.stringify` does not give that guarantee, because object
 * key order follows insertion order, and insertion order follows whatever the
 * scraper happened to do that day. Sorting keys removes the difference.
 *
 * The same property makes a data diff readable in review: a changed line is a
 * changed fact, not a reordered object.
 */

/** Thrown when a value cannot be represented in JSON without silently changing. */
export class NonSerializableValueError extends TypeError {
  override readonly name = 'NonSerializableValueError';

  constructor(
    /** Where the offending value sits, e.g. `records[3].kilograms`. */
    readonly path: string,
    description: string,
  ) {
    super(`Cannot serialize ${path || 'the root value'}: ${description}`);
  }
}

/**
 * Serializes to JSON with object keys sorted, two-space indentation, and a
 * trailing newline.
 *
 * Unlike `JSON.stringify`, this refuses anything JSON cannot hold rather than
 * quietly dropping or transforming it. `JSON.stringify` turns `undefined` into
 * a missing key, `NaN` and `Infinity` into `null`, and a `Date` into a string
 * -- each of which would publish something subtly different from what the
 * caller assembled, and none of which would fail a build. A number that became
 * `null` here is a record that disappears from a lifter's screen, so it is
 * worth an exception.
 *
 * @throws {NonSerializableValueError} for `undefined`, non-finite numbers,
 *   bigints, symbols, functions, class instances, or a cycle.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(toCanonical(value, '', new Set()), null, 2)}\n`;
}

/**
 * Rebuilds the value with sorted keys, validating as it goes.
 *
 * Recursion is bounded by the value itself; `seen` tracks the ancestors of the
 * current node so that a cycle is reported as a cycle instead of overflowing
 * the stack. Ancestors are removed on the way back out, so a value that legibly
 * appears twice in different branches -- a shared scope object, say -- is not
 * mistaken for one.
 */
function toCanonical(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new NonSerializableValueError(path, `${String(value)} has no JSON representation`);
      }
      return value;
    case 'undefined':
      throw new NonSerializableValueError(
        path,
        'undefined is dropped by JSON rather than encoded; use null for an absent value',
      );
    case 'bigint':
      throw new NonSerializableValueError(path, 'a bigint has no JSON representation');
    case 'symbol':
    case 'function':
      throw new NonSerializableValueError(path, `a ${typeof value} has no JSON representation`);
    default:
      break;
  }

  // Narrowed to `object` by the switch above: every other `typeof` either
  // returned or threw.
  const object = value;
  if (seen.has(object)) {
    throw new NonSerializableValueError(path, 'the value refers back to itself');
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return object.map((item, index) => toCanonical(item, `${path}[${index}]`, seen));
    }
    const prototype: unknown = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      // A Date, Map, Set or class instance. `JSON.stringify` would emit
      // something for most of these -- an ISO string, or `{}` -- and the
      // difference between "empty object" and "the Map I meant to publish" is
      // not one a build should discover in production. A null prototype is
      // allowed: that is what a hardened plain object looks like.
      throw new NonSerializableValueError(
        path,
        'only plain objects and arrays can be published; convert it first',
      );
    }
    return sortedEntries(object as Record<string, unknown>, path, seen);
  } finally {
    seen.delete(object);
  }
}

function sortedEntries(
  object: Record<string, unknown>,
  path: string,
  seen: Set<object>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Sorted by code unit, which is what `Array.prototype.sort` does by default
  // and what every other canonical-JSON implementation agrees on. Locale-aware
  // collation would make the output depend on the machine that produced it.
  for (const key of Object.keys(object).sort()) {
    result[key] = toCanonical(object[key], path ? `${path}.${key}` : key, seen);
  }
  return result;
}
