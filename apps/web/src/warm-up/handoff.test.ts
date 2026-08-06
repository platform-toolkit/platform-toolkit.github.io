// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The writing half of section 4.3, over a fake storage and a clock that is held.
 *
 * `browserLogbookHandoff` is deliberately not here. It is one line over
 * `browserPreferenceStorage()`, and the only thing a test of it could add is a
 * dependency on a real origin having storage -- which is the browser suite's
 * question and not this one's. What is worth pinning in bare Node is the pair of
 * failures a browser will not produce on demand: an origin that refuses storage
 * outright, and a storage that accepts the call and throws on the write.
 */

import {
  HANDOFF_STORAGE_KEY,
  HANDOFF_VERSION,
  parseHandoff,
  snapshotFrom,
  type HandoffStorage,
  type WarmupHandoff,
} from '@platform-toolkit/training-logbook/handoff';
import { describe, expect, it } from 'vitest';

import { manualClock } from '../clock.js';

import { DEFAULT_EQUIPMENT, type Equipment } from './equipment.js';
import { createLogbookHandoff } from './handoff.js';
import { addCustomLift, addLift, type LiftEntry } from './session.js';

/** Relative, the way the page supplies it. Nothing here resolves it. */
const HREF = '../logbook/';

/**
 * When the record is written.
 *
 * Invented, and in the past on purpose: a stamp read off the device's own clock
 * instead of the injected one would land within a second of the test running,
 * so a fixed instant nobody could arrive at by accident is what makes the
 * assertion about `clock` rather than about `Date`.
 */
const WRITTEN_AT = Date.parse('2026-04-18T17:40:00.000Z');

interface Fake extends HandoffStorage {
  readonly entries: Map<string, string>;
}

/** A storage that works, or one whose quota is full. */
function aStorage(full = false): Fake {
  const entries = new Map<string, string>();
  return {
    entries,
    read: (key) => entries.get(key) ?? null,
    write: (key, value) => {
      if (full) throw new Error('This origin has no room left.');
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

function aHandoff(storage: HandoffStorage | null) {
  return createLogbookHandoff({ href: HREF, storage, clock: manualClock(WRITTEN_AT) });
}

/**
 * A finished squat row. The figures are invented; nothing reads them as data.
 *
 * Sets and reps are stated rather than left to the catalogue, because every
 * assertion below names them and a suggestion changed upstream should read as a
 * catalogue change and not as this file failing.
 */
function squat(overrides: Partial<LiftEntry> = {}): LiftEntry {
  const [entry] = addLift([], 'squat');
  if (entry === undefined) throw new Error('The catalogue has no squat.');
  return { ...entry, weight: '185', sets: '3', reps: '5', ...overrides };
}

/** The record the other page would find, read back through that page's own parser. */
function recordIn(storage: Fake): WarmupHandoff {
  const raw = storage.entries.get(HANDOFF_STORAGE_KEY);
  if (raw === undefined) throw new Error('Nothing was left for the logbook.');
  const record = parseHandoff(raw);
  if (record === null) throw new Error('The logbook could not read what was written.');
  return record;
}

/**
 * The record exactly as it was written, before any reader tidies it.
 *
 * `parseHandoff` cannot answer the question the test below asks: the reader's
 * schema drops an entry it does not declare, so a computed field written into
 * the record would come back off it clean and still be sitting on the origin
 * for some later build to start trusting.
 */
function written(storage: Fake): unknown {
  const raw = storage.entries.get(HANDOFF_STORAGE_KEY);
  if (raw === undefined) throw new Error('Nothing was left for the logbook.');
  return JSON.parse(raw);
}

describe('createLogbookHandoff', () => {
  it('points the action wherever the page said', () => {
    // Untouched, because this file is not allowed to know where it is. The href
    // is relative and the anchor resolves it, which is what survives the site
    // moving under a base path.
    expect(aHandoff(aStorage()).href).toBe(HREF);
  });

  it('leaves a record the logbook parses back as the session', () => {
    const storage = aStorage();
    const answer = aHandoff(storage).offer(
      [
        squat({ adjustments: [{ index: 2, total: 95 }] }),
        {
          ...squat({ weight: '135' }),
          key: 'bench-press',
          liftId: 'bench-press',
          barId: 'squat-25',
        },
      ],
      DEFAULT_EQUIPMENT,
    );

    expect(answer).toBe('offered');
    expect(recordIn(storage).exercises).toEqual([
      {
        exerciseId: 'squat',
        bar: null,
        workingWeight: 185,
        workingSets: 3,
        workingReps: 5,
        adjustments: [{ index: 2, total: 95 }],
      },
      {
        exerciseId: 'bench-press',
        bar: { amount: 25, unit: 'kg' },
        workingWeight: 135,
        workingSets: 3,
        workingReps: 5,
        adjustments: [],
      },
    ]);
  });

  it('writes the typed inputs and nothing either tool could work out', () => {
    // An exact comparison over the whole written record, not a check that the
    // six fields are present: what section 8.1 forbids is an *extra* key -- a
    // ramp, a plate list, a total -- and only `toEqual` fails on one. Read off
    // the bytes rather than through `parseHandoff`, for the reason `written`
    // gives. Both builds ask their own engine the same question from the same
    // inputs and therefore agree by construction; a record carrying an answer
    // is that rule with a delivery mechanism attached.
    const storage = aStorage();
    aHandoff(storage).offer([squat({ adjustments: [{ index: 2, total: 95 }] })], DEFAULT_EQUIPMENT);

    expect(written(storage)).toEqual({
      version: HANDOFF_VERSION,
      createdAt: new Date(WRITTEN_AT).toISOString(),
      equipment: snapshotFrom(DEFAULT_EQUIPMENT),
      exercises: [
        {
          exerciseId: 'squat',
          bar: null,
          workingWeight: 185,
          workingSets: 3,
          workingReps: 5,
          adjustments: [{ index: 2, total: 95 }],
        },
      ],
    });
  });

  it('stamps each record with the instant the clock reads then', () => {
    // Then, and not when the handoff was built. This link sits on a screen a
    // lifter has open for the length of a session, and the reader refuses a
    // record older than an hour -- so a stamp taken at construction would make
    // the button do nothing on exactly the press that mattered.
    const storage = aStorage();
    const clock = manualClock(WRITTEN_AT);
    const handoff = createLogbookHandoff({ href: HREF, storage, clock });

    handoff.offer([squat()], DEFAULT_EQUIPMENT);
    clock.advance(20 * 60 * 1000);
    handoff.offer([squat()], DEFAULT_EQUIPMENT);

    expect(recordIn(storage).createdAt).toBe(new Date(WRITTEN_AT + 20 * 60 * 1000).toISOString());
  });

  it('freezes the rack into weights rather than the presets it was picked from', () => {
    // The reading build may not have this build's presets, and a preset whose
    // weight is later corrected would quietly re-weigh a bar the lifter already
    // loaded. The second assertion is what stops the first being a comparison of
    // `snapshotFrom` against itself.
    const storage = aStorage();
    // A rack whose default bar is neither the catalogue's nor this suite's, so a
    // snapshot taken against any bar but this one's reads differently.
    const metric: Equipment = { ...DEFAULT_EQUIPMENT, plateUnit: 'kg', barId: 'squat-25' };
    aHandoff(storage).offer([squat()], metric);

    const { equipment } = recordIn(storage);
    expect(equipment).toEqual(snapshotFrom(metric));
    expect(equipment.barWeight).toEqual({ amount: 25, unit: 'kg' });
  });

  it('answers unavailable where the browser gives this page no storage', () => {
    // A supported mode and not an error. The caller says so in a sentence, which
    // is the whole reason this answers rather than throws.
    expect(aHandoff(null).offer([squat()], DEFAULT_EQUIPMENT)).toBe('unavailable');
  });

  it('answers unavailable rather than throwing when there is no room to write', () => {
    // A full quota is ordinary. Letting it out would take down the screen a
    // lifter is mid-session on, over a button they can simply not press.
    const storage = aStorage(true);
    expect(aHandoff(storage).offer([squat()], DEFAULT_EQUIPMENT)).toBe('unavailable');
    expect(storage.entries.size).toBe(0);
  });

  it('answers unavailable when the session holds nothing that could be logged', () => {
    // The same answer as nowhere-to-put-it, on purpose: the action means one
    // thing to the person pressing it and there is one sentence to show either
    // way. An empty record would be worse than none -- it parses, so the logbook
    // would offer to land a session with no lifts in it.
    const storage = aStorage();
    const handoff = aHandoff(storage);
    // Finished, and still nothing to log: a lift the lifter titled has no
    // identifier to travel under, so a session of only those is as empty here as
    // a session of blank rows.
    const titled = addCustomLift([], 'Zercher Squat', 'squat-press').map((entry) => ({
      ...entry,
      weight: '95',
    }));

    expect(handoff.offer([], DEFAULT_EQUIPMENT)).toBe('unavailable');
    expect(handoff.offer([squat({ weight: '' })], DEFAULT_EQUIPMENT)).toBe('unavailable');
    expect(handoff.offer(titled, DEFAULT_EQUIPMENT)).toBe('unavailable');
    expect(storage.entries.size).toBe(0);
  });
});
