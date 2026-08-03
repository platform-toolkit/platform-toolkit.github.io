// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { memoryPreferenceStorage, type PreferenceStorage } from './storage.js';
import {
  PREFERENCE_KEY_PREFIX,
  createPreferenceStore,
  definePreference,
  type PreferenceStore,
} from './store.js';
import { PreferenceValue } from './value.js';

const UNIT = definePreference({
  name: 'warmup.unit',
  value: PreferenceValue.choice(['kg', 'lb']),
  fallback: 'kg',
});

const BAR_WEIGHT = definePreference({
  name: 'warmup.bar-weight',
  value: PreferenceValue.quantity({ min: 5, max: 40 }),
  fallback: 20,
});

const INVENTORY = definePreference({
  name: 'warmup.plates',
  value: PreferenceValue.listOf(
    PreferenceValue.shape({
      weight: PreferenceValue.quantity({ min: 0.25, max: 50 }),
      pairs: PreferenceValue.count({ min: 0, max: 20 }),
    }),
    { maxLength: 12 },
  ),
  fallback: [],
});

function withStorage(): { store: PreferenceStore; storage: PreferenceStorage } {
  const storage = memoryPreferenceStorage();
  return { store: createPreferenceStore(storage), storage };
}

describe('definePreference', () => {
  it('rejects a name that would make an ambiguous key', () => {
    // The name becomes the storage key. An empty segment or a stray separator
    // produces a key that looks fine and can collide with another definition,
    // handing one tool's setting to a different tool.
    for (const name of ['', 'Warmup.Unit', 'warmup..unit', 'warmup.', '.unit', 'warm up']) {
      expect(
        () => definePreference({ name, value: PreferenceValue.flag(), fallback: false }),
        name,
      ).toThrow(RangeError);
    }
  });

  it('rejects a fallback that does not satisfy its own shape', () => {
    // Otherwise every read hands back a value the definition forbids, and every
    // test that only exercised the stored path passes.
    expect(() =>
      definePreference({
        name: 'warmup.bar-weight',
        value: PreferenceValue.quantity({ min: 5, max: 40 }),
        fallback: 100,
      }),
    ).toThrow(RangeError);
  });
});

describe('reading and writing', () => {
  it('answers the fallback when nothing is stored', () => {
    const { store } = withStorage();
    expect(store.read(UNIT)).toBe('kg');
    expect(store.read(BAR_WEIGHT)).toBe(20);
    expect(store.read(INVENTORY)).toEqual([]);
  });

  it('round-trips every shape', () => {
    const { store } = withStorage();
    expect(store.write(UNIT, 'lb')).toBe('saved');
    expect(store.write(BAR_WEIGHT, 15.5)).toBe('saved');
    expect(store.write(INVENTORY, [{ weight: 25, pairs: 2 }])).toBe('saved');

    expect(store.read(UNIT)).toBe('lb');
    expect(store.read(BAR_WEIGHT)).toBe(15.5);
    expect(store.read(INVENTORY)).toEqual([{ weight: 25, pairs: 2 }]);
  });

  it('survives a second store over the same storage', () => {
    // The reload case, which is the entire point of the package.
    const storage = memoryPreferenceStorage();
    createPreferenceStore(storage).write(UNIT, 'lb');
    expect(createPreferenceStore(storage).read(UNIT)).toBe('lb');
  });

  it('namespaces its keys', () => {
    const { store, storage } = withStorage();
    store.write(UNIT, 'lb');
    expect(storage.keys()).toEqual([`${PREFERENCE_KEY_PREFIX}warmup.unit`]);
  });

  it('refuses to write a value its own definition forbids', () => {
    // A caller bug, not a storage failure, and it has to be loud: written
    // silently it would be rejected on the next read and the setting would
    // appear to simply not stick.
    const { store } = withStorage();
    expect(() => store.write(BAR_WEIGHT, 400)).toThrow(RangeError);
  });
});

describe('a stored value that cannot be trusted', () => {
  const cases: readonly { readonly name: string; readonly raw: string }[] = [
    { name: 'truncated by a killed tab', raw: '{"weight": 25, "pai' },
    { name: 'not JSON at all', raw: 'kg' },
    { name: 'the right type but out of bounds', raw: '400' },
    { name: 'the wrong type entirely', raw: '"twenty"' },
    { name: 'null', raw: 'null' },
  ];

  it.each(cases)('$name: reads as the fallback', ({ raw }) => {
    const storage = memoryPreferenceStorage();
    storage.write(`${PREFERENCE_KEY_PREFIX}warmup.bar-weight`, raw);
    expect(createPreferenceStore(storage).read(BAR_WEIGHT)).toBe(20);
  });

  it.each(cases)('$name: is deleted rather than left to fail forever', ({ raw }) => {
    // Leaving it costs a failed parse on every read for the life of the origin,
    // and the state is invisible: the setting silently never sticks again and
    // the only evidence is in a storage inspector nobody opens.
    const storage = memoryPreferenceStorage();
    storage.write(`${PREFERENCE_KEY_PREFIX}warmup.bar-weight`, raw);
    createPreferenceStore(storage).read(BAR_WEIGHT);
    expect(storage.keys()).toEqual([]);
  });

  it('does not disturb a neighbouring setting', () => {
    const storage = memoryPreferenceStorage();
    storage.write(`${PREFERENCE_KEY_PREFIX}warmup.bar-weight`, 'rubbish');
    storage.write(`${PREFERENCE_KEY_PREFIX}warmup.unit`, '"lb"');
    const store = createPreferenceStore(storage);
    expect(store.read(BAR_WEIGHT)).toBe(20);
    expect(store.read(UNIT)).toBe('lb');
  });
});

describe('forgetting', () => {
  it('drops one setting and leaves the rest', () => {
    const { store } = withStorage();
    store.write(UNIT, 'lb');
    store.write(BAR_WEIGHT, 25);
    store.forget(UNIT);
    expect(store.read(UNIT)).toBe('kg');
    expect(store.read(BAR_WEIGHT)).toBe(25);
  });

  it('drops everything this package wrote, including keys no definition names', () => {
    // A build that removed a preference leaves its key behind. A reset that
    // walked the current definitions would step over it, and the visitor's
    // "forget my settings" would not have.
    const { store, storage } = withStorage();
    store.write(UNIT, 'lb');
    storage.write(`${PREFERENCE_KEY_PREFIX}retired.setting`, '"whatever"');
    store.forgetAll();
    expect(storage.keys()).toEqual([]);
  });

  it('leaves keys belonging to anything else on the origin', () => {
    // The site may one day serve something else from the same origin. A reset
    // button that clears a neighbour's data is a bug reported as data loss.
    const { store, storage } = withStorage();
    store.write(UNIT, 'lb');
    storage.write('some-other-app', 'important');
    store.forgetAll();
    expect(storage.keys()).toEqual(['some-other-app']);
  });
});

describe('when there is no storage', () => {
  const store = createPreferenceStore(null);

  it('says so', () => {
    expect(store.remembers).toBe(false);
  });

  it('still answers every read with the fallback', () => {
    // The framed and private-browsing case. A tool that cannot remember a bar
    // weight is a mild annoyance; a tool that throws during start-up inside
    // somebody else's page is broken.
    expect(store.read(UNIT)).toBe('kg');
    expect(store.read(INVENTORY)).toEqual([]);
  });

  it('reports a write as unavailable instead of throwing', () => {
    expect(store.write(UNIT, 'lb')).toBe('unavailable');
  });

  it('accepts forgetting as a no-op', () => {
    expect(() => {
      store.forget(UNIT);
      store.forgetAll();
    }).not.toThrow();
  });

  it('still validates what it is handed', () => {
    // The caller bug is a caller bug whether or not there is a disk. Skipping
    // the check here would make it reproduce only on devices with storage.
    expect(() => store.write(BAR_WEIGHT, 400)).toThrow(RangeError);
  });
});

describe('when storage refuses a write', () => {
  function refusingStorage(): PreferenceStorage {
    const backing = memoryPreferenceStorage();
    return {
      keys: () => backing.keys(),
      read: (key) => backing.read(key),
      write: () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
      remove: (key) => {
        backing.remove(key);
      },
    };
  }

  it('reports the refusal rather than throwing', () => {
    const store = createPreferenceStore(refusingStorage());
    expect(store.write(UNIT, 'lb')).toBe('refused');
  });

  it('still reads whatever was already there', () => {
    // Quota is reached by something else on the origin far more often than by
    // these few hundred bytes, and the settings already saved are still good.
    const storage = refusingStorage();
    const store = createPreferenceStore(storage);
    expect(store.write(UNIT, 'lb')).toBe('refused');
    expect(store.read(UNIT)).toBe('kg');
  });

  it('still claims to remember, because reads work', () => {
    // `remembers` answers "is there a store", not "did the last write land".
    // The write result is what carries the second question.
    expect(createPreferenceStore(refusingStorage()).remembers).toBe(true);
  });
});
