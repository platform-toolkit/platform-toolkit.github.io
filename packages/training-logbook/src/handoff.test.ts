// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The carrier, tested in Node against a fake.
 *
 * Everything worth asserting here is a failure a browser will not reproduce on
 * demand: storage that refuses a write, storage that throws on a read, a record
 * left behind by a tab that was closed an hour ago. `packages/preferences` makes
 * the same argument for the same reason -- the configurations that matter are
 * the ones no test browser can be put into.
 *
 * The claim underneath all of them: a page that never asked for a handoff must
 * never be interrupted by one, and a page that did must not lose it to a reload.
 */

import { describe, expect, it } from 'vitest';

import { AT_START } from './core/context.fixture.js';
import { DEFAULT_EQUIPMENT } from './core/equipment.js';
import {
  HANDOFF_MAX_AGE_MS,
  HANDOFF_STORAGE_KEY,
  createHandoffSource,
  offerHandoff,
  parseHandoff,
  type HandoffContent,
  type HandoffStorage,
} from './handoff.js';

const WRITTEN_AT = Date.parse(AT_START);

interface Fake extends HandoffStorage {
  readonly entries: Map<string, string>;
}

/** A store that works, unless told which method should throw. */
function aStorage(broken: 'read' | 'write' | 'remove' | null = null): Fake {
  const entries = new Map<string, string>();
  const guard = (method: string): void => {
    if (broken === method) throw new Error('this origin refuses storage.');
  };
  return {
    entries,
    read: (key) => {
      guard('read');
      return entries.get(key) ?? null;
    },
    write: (key, value) => {
      guard('write');
      entries.set(key, value);
    },
    remove: (key) => {
      guard('remove');
      entries.delete(key);
    },
  };
}

function aContent(): HandoffContent {
  return {
    equipment: DEFAULT_EQUIPMENT,
    exercises: [
      {
        exerciseId: 'squat',
        bar: null,
        workingWeight: 225,
        workingSets: 3,
        workingReps: 5,
        adjustments: [],
      },
    ],
  };
}

/** A source reading `storage`, at a fixed number of milliseconds after the write. */
function aSource(
  storage: HandoffStorage | null,
  msAfterWrite = 0,
): ReturnType<typeof createHandoffSource> {
  return createHandoffSource(storage, { now: () => WRITTEN_AT + msAfterWrite });
}

describe('the key itself', () => {
  it('sits under the prefix a settings reset sweeps', () => {
    // `forgetAll` in `packages/preferences` walks the origin by this prefix, so
    // a key outside it would leave an abandoned session behind after a lifter
    // had asked for everything to be forgotten.
    expect(HANDOFF_STORAGE_KEY.startsWith('ptk.')).toBe(true);
  });
});

describe('leaving a record', () => {
  it('writes something the other page can read', () => {
    const storage = aStorage();

    expect(offerHandoff(storage, aContent(), AT_START)).toBe('offered');
    expect(parseHandoff(storage.entries.get(HANDOFF_STORAGE_KEY) ?? '')).not.toBeNull();
  });

  it('says so where there is nowhere to write', () => {
    // A framed calculator on an origin the browser will not give storage to.
    // The calculator uses this to decide what its link says -- offering to hand
    // a session over and handing nothing over is the failure this prevents.
    expect(offerHandoff(null, aContent(), AT_START)).toBe('unavailable');
  });

  it('says so where the write is refused', () => {
    // A full quota, which is reached by other things on the origin far more
    // often than by this.
    expect(offerHandoff(aStorage('write'), aContent(), AT_START)).toBe('unavailable');
  });
});

describe('finding a record', () => {
  it('reads back the session that was left', () => {
    const storage = aStorage();
    offerHandoff(storage, aContent(), AT_START);

    expect(aSource(storage).peek()?.exercises[0]?.workingWeight).toBe(225);
  });

  it('does not consume it', () => {
    // The offer is on screen and the phone reloads the tab. Reading and deleting
    // in one step is the obvious shape and it loses the lifter's session to that
    // reload, silently, with the home screen looking entirely normal.
    const storage = aStorage();
    offerHandoff(storage, aContent(), AT_START);
    const source = aSource(storage);

    expect(source.peek()).not.toBeNull();
    expect(source.peek()).not.toBeNull();
  });

  it('finds nothing where nothing was left', () => {
    expect(aSource(aStorage()).peek()).toBeNull();
  });

  it('finds nothing where there is no storage at all', () => {
    expect(aSource(null).peek()).toBeNull();
  });

  it('finds nothing where the read itself throws', () => {
    expect(aSource(aStorage('read')).peek()).toBeNull();
  });
});

describe('a record that is no longer worth offering', () => {
  it('is refused once it is past its hour', () => {
    const storage = aStorage();
    offerHandoff(storage, aContent(), AT_START);

    expect(aSource(storage, HANDOFF_MAX_AGE_MS - 1).peek()).not.toBeNull();
    expect(aSource(storage, HANDOFF_MAX_AGE_MS + 1).peek()).toBeNull();
  });

  it('is deleted on the way past, and so is one that will not parse', () => {
    // The two cases `peek` may consume. Leaving them would have the logbook
    // reading the same rubbish on every visit, and an expired record would go on
    // being examined for as long as the browser kept it.
    const stale = aStorage();
    offerHandoff(stale, aContent(), AT_START);
    aSource(stale, HANDOFF_MAX_AGE_MS + 1).peek();

    const rubbish = aStorage();
    rubbish.write(HANDOFF_STORAGE_KEY, 'not a record');
    aSource(rubbish).peek();

    expect(stale.entries.has(HANDOFF_STORAGE_KEY)).toBe(false);
    expect(rubbish.entries.has(HANDOFF_STORAGE_KEY)).toBe(false);
  });

  it('is refused where the stamp cannot be read at all', () => {
    // The schema asks only for a non-empty string, which is the right question
    // for an instant everywhere else in this package. Here a record whose age
    // cannot be established has no claim to be recent.
    const storage = aStorage();
    offerHandoff(storage, aContent(), AT_START);
    const raw = storage.entries.get(HANDOFF_STORAGE_KEY) ?? '';
    storage.write(HANDOFF_STORAGE_KEY, raw.replace(AT_START, 'whenever'));

    expect(aSource(storage).peek()).toBeNull();
  });
});

describe('forgetting a record', () => {
  it('takes it out of storage', () => {
    const storage = aStorage();
    offerHandoff(storage, aContent(), AT_START);
    aSource(storage).clear();

    expect(storage.entries.has(HANDOFF_STORAGE_KEY)).toBe(false);
  });

  it('survives a remove that throws', () => {
    // Nothing to do about it and nothing to tell anybody: the record will be
    // refused again on the next read, and an error message here would be about
    // an offer the lifter has already dealt with.
    expect(() => {
      aSource(aStorage('remove')).clear();
    }).not.toThrow();
  });

  it('is safe where there is no storage at all', () => {
    expect(() => {
      aSource(null).clear();
    }).not.toThrow();
  });
});
