import { describe, expect, it } from 'vitest';

import {
  browserPreferenceStorage,
  browserSessionStorage,
  memoryPreferenceStorage,
  webStorage,
} from './storage.js';

/** A minimal stand-in for the browser's own storage, with the failures made switchable. */
function fakeWebStorage(options: { readonly refuseWrites?: boolean } = {}) {
  const entries = new Map<string, string>();
  return {
    entries,
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.refuseWrites === true) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

describe('webStorage', () => {
  it('wraps storage that works', () => {
    const storage = webStorage(fakeWebStorage());
    expect(storage).not.toBe(null);
    storage?.write('ptk.unit', '"kg"');
    expect(storage?.read('ptk.unit')).toBe('"kg"');
    expect(storage?.keys()).toEqual(['ptk.unit']);
    storage?.remove('ptk.unit');
    expect(storage?.read('ptk.unit')).toBe(null);
  });

  it('leaves nothing behind after the probe', () => {
    // A probe key that survives is a key `forgetAll` has to sweep and a row in
    // every visitor's storage inspector.
    const backing = fakeWebStorage();
    webStorage(backing);
    expect(backing.entries.size).toBe(0);
  });

  it('refuses storage that reads but will not write', () => {
    // Safari's private mode did exactly this for years: a complete
    // `localStorage` object whose every `setItem` threw. A capability check that
    // only asked whether the method existed reported success.
    expect(webStorage(fakeWebStorage({ refuseWrites: true }))).toBe(null);
  });

  it('refuses storage that throws on the way in', () => {
    const hostile = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error('Access is denied to this document.');
      },
      removeItem: () => undefined,
    };
    expect(webStorage(hostile)).toBe(null);
  });

  it('skips a key index that answers null', () => {
    // `key(i)` may return null when entries are removed while it is being
    // walked. A null in the list becomes a null key handed to `startsWith`.
    const shifting = {
      length: 3,
      key: (index: number) => (index === 1 ? null : `ptk.${String(index)}`),
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(webStorage(shifting)?.keys()).toEqual(['ptk.0', 'ptk.2']);
  });
});

describe('memoryPreferenceStorage', () => {
  it('round-trips within a session', () => {
    const storage = memoryPreferenceStorage();
    storage.write('ptk.a', '1');
    storage.write('ptk.b', '2');
    expect(storage.read('ptk.a')).toBe('1');
    expect([...storage.keys()].sort()).toEqual(['ptk.a', 'ptk.b']);
    storage.remove('ptk.a');
    expect(storage.read('ptk.a')).toBe(null);
    expect(storage.keys()).toEqual(['ptk.b']);
  });
});

describe('browserPreferenceStorage', () => {
  it('answers null where there is no browser storage rather than throwing', () => {
    // This runs in Node, which is the point: the function has to survive a host
    // with no `localStorage` at all. A server-rendered or pre-rendered pass
    // reaching a component that seeds itself from preferences would otherwise
    // die on an undefined global.
    expect(browserPreferenceStorage()).toBe(null);
  });
});

describe('browserSessionStorage', () => {
  it('answers null where there is no browser storage rather than throwing', () => {
    // Same guarantee as its sibling, asserted separately because the two read
    // different globals: a copy-paste that left `localStorage` in place here
    // would pass every test that only exercised one of them.
    expect(browserSessionStorage()).toBe(null);
  });
});
