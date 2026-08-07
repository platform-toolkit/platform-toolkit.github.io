// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The persistence port, against a manager that is two functions.
 *
 * In Node and not a browser, which is the point of the port existing: the whole file
 * under test is a mapping from what a `StorageManager` answers to what a screen can
 * say, and the only way to test that against the real one would be to find a browser
 * that refuses -- and then to find another that has no Storage API at all.
 */

import { describe, expect, it, vi } from 'vitest';

import { createStoragePersistence, type StorageManagerLike } from './persistence.js';

/** A manager that answers whatever it is told to. */
function manager(answers: Partial<StorageManagerLike>): StorageManagerLike {
  return {
    persisted: answers.persisted ?? ((): Promise<boolean> => Promise.resolve(false)),
    persist: answers.persist ?? ((): Promise<boolean> => Promise.resolve(false)),
  };
}

describe('reading what the browser already decided', () => {
  it('reports storage the browser has agreed to keep', async () => {
    const port = createStoragePersistence(manager({ persisted: () => Promise.resolve(true) }));
    await expect(port.durability()).resolves.toBe('persisted');
  });

  it('reports storage the browser may still clear', async () => {
    const port = createStoragePersistence(manager({ persisted: () => Promise.resolve(false) }));
    await expect(port.durability()).resolves.toBe('best-effort');
  });

  /**
   * A rejection is not a refusal, and the two must not collapse into one answer.
   *
   * `persisted()` rejects in a sandboxed frame. Read as `'best-effort'` it would put a
   * sentence on screen saying this browser may clear the training -- a claim about a
   * decision nobody made, drawn from an error.
   */
  it('reports nothing at all when the question throws', async () => {
    const port = createStoragePersistence(
      manager({ persisted: () => Promise.reject(new Error('partitioned')) }),
    );
    await expect(port.durability()).resolves.toBe('unknown');
  });

  /** Reading must never be the thing that asks. Section 10.3's timing rule, at the seam. */
  it('does not request persistence while reading', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const port = createStoragePersistence(manager({ persist }));

    await port.durability();

    expect(persist).not.toHaveBeenCalled();
  });
});

describe('asking the browser to keep it', () => {
  it('reports a granted request', async () => {
    const port = createStoragePersistence(manager({ persist: () => Promise.resolve(true) }));
    await expect(port.request()).resolves.toBe('persisted');
  });

  it('reports a declined request as an ordinary answer', async () => {
    const port = createStoragePersistence(manager({ persist: () => Promise.resolve(false) }));
    await expect(port.request()).resolves.toBe('best-effort');
  });

  it('reports nothing at all when the request throws', async () => {
    const port = createStoragePersistence(
      manager({ persist: () => Promise.reject(new Error('not allowed')) }),
    );
    await expect(port.request()).resolves.toBe('unknown');
  });

  /**
   * The read is what a screen calls to decide whether to draw the offer, so an ask that
   * quietly re-read instead of asking would make the button a no-op that reported the
   * state it started in.
   */
  it('asks rather than re-reading', async () => {
    const persisted = vi.fn(() => Promise.resolve(false));
    const persist = vi.fn(() => Promise.resolve(true));
    const port = createStoragePersistence(manager({ persisted, persist }));

    await expect(port.request()).resolves.toBe('persisted');

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persisted).not.toHaveBeenCalled();
  });
});

describe('a host with no storage manager', () => {
  /**
   * Both shapes of absence, because the two arrive from different places: a consumer
   * that has nothing to hand over writes `null`, and `navigator.storage` on an insecure
   * origin is `undefined` against a type that says it cannot be.
   */
  for (const [what, absent] of [
    ['null', null],
    ['undefined', undefined],
  ] as const) {
    it(`knows nothing, and asks nothing, when handed ${what}`, async () => {
      const port = createStoragePersistence(absent);

      await expect(port.durability()).resolves.toBe('unknown');
      await expect(port.request()).resolves.toBe('unknown');
    });
  }
});
