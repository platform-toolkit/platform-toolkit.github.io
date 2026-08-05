// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §24's library, tested for the five things that lose a lifter's meet.
 *
 * **The set that JSON eats.** `MeetPrep.done` round-trips through a list, and
 * the test that matters is the one that goes all the way there and back through
 * an actual `JSON.parse(JSON.stringify(...))` -- a test that only calls the two
 * converters would pass with a `Set` still in the middle of the saved shape,
 * which is exactly the bug (`{}`, no error, every tick gone).
 *
 * **The map JSON eats the same way, plus a key nobody typed.** §20's board is a
 * `ReadonlyMap` and stringifies to the same silent `{}`, so it is saved as a list
 * -- and comes back through `new Map(...)` rather than a record, because a lifter
 * id arrives from an imported file and `constructor` is a legal one.
 *
 * **Writing to a meet that is over.** Archiving closes the meet, because an
 * archive that stays open is a screen whose auto-saves are all being refused.
 * Both halves are pinned: the refusal, and the close that keeps the refusal from
 * ever being reached in normal use.
 *
 * **Ids after an import.** Every imported meet is renumbered, including the ones
 * with no conflict, so the counter stays the only issuer. The test that proves
 * it is the one that imports a foreign `meet-9` into a library at 3 and then
 * creates a meet -- under the tempting "renumber only conflicts" rule that
 * sequence produces two meets with the same id and no error anywhere.
 *
 * **The stamps that must not move.** A duplicate carries the original's
 * methodology version and rule profile (§30); an auto-save touches neither.
 */
import { describe, expect, it } from 'vitest';

import { EMPTY_PREP, type MeetPrep } from './prep.js';
import {
  EMPTY_LIBRARY,
  EMPTY_SAVED_STATE,
  MEET_LIBRARY_MAX,
  MEET_NAME_MAX,
  NO_WARMUP_ANSWERS,
  SAVED_MEET_METHODOLOGY_VERSION,
  SAVED_MEET_VERSION,
  activeMeet,
  archiveMeet,
  archivedMeets,
  closeMeet,
  createMeet,
  deleteMeet,
  duplicateMeet,
  findMeet,
  fromSavedPrep,
  fromSavedWarmup,
  importMeets,
  type MeetLibrary,
  type NewMeet,
  openMeet,
  previewImport,
  readMeetName,
  renameMeet,
  resumableMeets,
  type SavedMeet,
  saveMeetState,
  toSavedPrep,
  toSavedWarmup,
} from './saved-meet.js';
import {
  EMPTY_PREFERENCES,
  EMPTY_WARMUP_STATE,
  EMPTY_WARMUP_STATES,
  type MeetWarmupState,
  type WarmupStates,
} from './warmup.js';

const NOW = 1_770_000_000_000;

function newMeet(overrides: Partial<NewMeet> = {}): NewMeet {
  return {
    name: 'Winter Open',
    now: NOW,
    rulesProfileId: 'uspa-2026',
    rulebookRevision: '2026-01',
    state: EMPTY_SAVED_STATE,
    ...overrides,
  };
}

/** Creates and unwraps, so a test about the fifth meet is not four unwraps long. */
function withMeet(library: MeetLibrary, overrides: Partial<NewMeet> = {}): MeetLibrary {
  const change = createMeet(library, newMeet(overrides));
  if (!change.ok) throw new Error(`unexpected refusal: ${change.reason}`);
  return change.library;
}

function filled(count: number): MeetLibrary {
  let library = EMPTY_LIBRARY;
  for (let index = 0; index < count; index += 1) {
    library = withMeet(library, { name: `Meet ${String(index + 1)}` });
  }
  return library;
}

describe('the saved prep shape', () => {
  const prep: MeetPrep = {
    ...EMPTY_PREP,
    done: new Set(['weigh-in', 'rack-height']),
    notes: 'bring chalk',
    nextCustomOrdinal: 3,
  };

  it('survives a real trip through JSON', () => {
    const text = JSON.stringify(toSavedPrep(prep));
    const back = fromSavedPrep(JSON.parse(text));
    expect([...back.done].sort()).toEqual(['rack-height', 'weigh-in']);
    expect(back.notes).toBe('bring chalk');
    expect(back.nextCustomOrdinal).toBe(3);
  });

  it('writes the ticks as a list rather than an object', () => {
    // The failure this pins is silent: `JSON.stringify(new Set([...]))` is `{}`.
    // Read back through `unknown` and a narrow, rather than off the `any` that
    // `JSON.parse` returns: the assertion below is about the shape of `done`,
    // and an `any` would let it pass against a field that is not there at all.
    // Narrowed rather than cast, and read back through `unknown` rather than off
    // the `any` that `JSON.parse` returns: under `any` the two assertions below
    // pass against a field that is not there at all, which is the failure this
    // test exists to catch.
    const written: unknown = JSON.parse(JSON.stringify(toSavedPrep(prep)));
    if (typeof written !== 'object' || written === null || !('done' in written)) {
      throw new Error('The written prep has no ticks at all.');
    }
    expect(Array.isArray(written.done)).toBe(true);
    expect(written.done).toHaveLength(2);
  });

  it('starts a saved state from an empty prep with nothing ticked', () => {
    expect(EMPTY_SAVED_STATE.prep.done).toEqual([]);
    expect(EMPTY_SAVED_STATE.document).toBeNull();
  });
});

describe("§20's warm-up answers", () => {
  const answered: MeetWarmupState = {
    ...EMPTY_WARMUP_STATE,
    preferences: { ...EMPTY_PREFERENCES, restSeconds: '150' },
    weights: [{ index: 2, text: '82.5' }],
  };
  const states: WarmupStates = { ...EMPTY_WARMUP_STATES, bench: answered };

  it('carries all three fields there and back', () => {
    const back = fromSavedWarmup(
      toSavedWarmup({ states, lift: 'deadlift', byLifter: new Map([['lifter-2', states]]) }),
    );
    expect(back.lift).toBe('deadlift');
    expect(back.states.bench.preferences.restSeconds).toBe('150');
    expect(back.byLifter.get('lifter-2')?.bench.weights).toEqual([{ index: 2, text: '82.5' }]);
  });

  it('writes the board as a list rather than an object', () => {
    // The same failure `MeetPrep.done` has, and just as quiet: `JSON.stringify`
    // writes a `Map` as `{}`. Read back through `unknown` rather than off the
    // `any` `JSON.parse` returns, for the reason the prep test above gives.
    const written: unknown = JSON.parse(
      JSON.stringify(toSavedWarmup({ states, lift: 'squat', byLifter: new Map([['a', states]]) })),
    );
    if (typeof written !== 'object' || written === null || !('byLifter' in written)) {
      throw new Error('The written warm-up has no board at all.');
    }
    expect(Array.isArray(written.byLifter)).toBe(true);
    expect(written.byLifter).toHaveLength(1);
  });

  it('keeps a lifter filed under `constructor` out of the prototype', () => {
    // Why `fromSavedWarmup` rebuilds through `new Map(...)`. A lifter id comes
    // off an imported file, so this is the one path a foreign key reaches; under
    // a plain object the read below answers a function typed as a `WarmupStates`
    // and the first thing to touch it throws with no lifter in the stack.
    const back = fromSavedWarmup({
      states: EMPTY_WARMUP_STATES,
      lift: 'squat',
      byLifter: [{ lifterId: 'constructor', states }],
    });
    expect(back.byLifter.get('constructor')?.bench.preferences.restSeconds).toBe('150');
    expect(back.byLifter.get('__proto__')).toBeUndefined();
    expect(back.byLifter.size).toBe(1);
  });

  it('answers the empties for a meet saved before there was a warm-up', () => {
    expect(fromSavedWarmup(null)).toBe(NO_WARMUP_ANSWERS);
    expect(NO_WARMUP_ANSWERS.states).toBe(EMPTY_WARMUP_STATES);
    expect(NO_WARMUP_ANSWERS.byLifter.size).toBe(0);
    expect(EMPTY_SAVED_STATE.warmup).toBeNull();
  });
});

describe('reading a name', () => {
  it('trims', () => {
    expect(readMeetName('  Winter Open \n')).toEqual({ ok: true, name: 'Winter Open' });
  });

  it('refuses a blank one rather than inventing a default', () => {
    expect(readMeetName('   ')).toEqual({ ok: false, reason: 'name-required' });
  });

  it('accepts exactly the maximum and refuses one more', () => {
    const longest = 'x'.repeat(MEET_NAME_MAX);
    expect(readMeetName(longest)).toEqual({ ok: true, name: longest });
    expect(readMeetName(`${longest}x`)).toEqual({ ok: false, reason: 'name-too-long' });
  });

  it('measures the trimmed name, not what was typed', () => {
    const longest = 'x'.repeat(MEET_NAME_MAX);
    expect(readMeetName(`  ${longest}  `).ok).toBe(true);
  });
});

describe('creating a meet', () => {
  it('files it, opens it and stamps it', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const meet = activeMeet(library);
    expect(meet?.name).toBe('Winter Open');
    expect(meet?.createdAt).toBe(NOW);
    expect(meet?.updatedAt).toBe(NOW);
    expect(meet?.archived).toBe(false);
    expect(meet?.rulesProfileId).toBe('uspa-2026');
    expect(meet?.rulebookRevision).toBe('2026-01');
    expect(meet?.methodologyVersion).toBe(SAVED_MEET_METHODOLOGY_VERSION);
  });

  it('puts the newest first and leaves the rest where they were', () => {
    const library = withMeet(withMeet(EMPTY_LIBRARY, { name: 'First' }), { name: 'Second' });
    expect(library.meets.map((meet) => meet.name)).toEqual(['Second', 'First']);
  });

  it('never issues an id twice, even after the one before it was deleted', () => {
    const first = withMeet(EMPTY_LIBRARY, { name: 'First' });
    const id = first.meets[0]?.id ?? '';
    const removed = deleteMeet(first, id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const second = withMeet(removed.library, { name: 'Second' });
    expect(second.meets[0]?.id).not.toBe(id);
  });

  it('refuses a blank name', () => {
    expect(createMeet(EMPTY_LIBRARY, newMeet({ name: '  ' }))).toEqual({
      ok: false,
      reason: 'name-required',
    });
  });

  it('refuses once the shelf is full', () => {
    const full = filled(MEET_LIBRARY_MAX);
    expect(createMeet(full, newMeet())).toEqual({ ok: false, reason: 'library-full' });
  });

  it('has room for exactly the maximum', () => {
    expect(filled(MEET_LIBRARY_MAX).meets).toHaveLength(MEET_LIBRARY_MAX);
  });
});

describe('auto-saving the open meet', () => {
  it('replaces the state and moves the changed instant only', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const change = saveMeetState(
      library,
      id,
      { ...EMPTY_SAVED_STATE, mode: 'coach' },
      NOW + 60_000,
    );
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const meet = findMeet(change.library, id);
    expect(meet?.state.mode).toBe('coach');
    expect(meet?.updatedAt).toBe(NOW + 60_000);
    expect(meet?.createdAt).toBe(NOW);
  });

  it('leaves the rule profile and the methodology stamp alone', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const change = saveMeetState(library, id, EMPTY_SAVED_STATE, NOW + 1);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const meet = findMeet(change.library, id);
    expect(meet?.rulesProfileId).toBe('uspa-2026');
    expect(meet?.methodologyVersion).toBe(SAVED_MEET_METHODOLOGY_VERSION);
  });

  it('refuses an unknown meet instead of filing a new one', () => {
    expect(saveMeetState(EMPTY_LIBRARY, 'meet-7', EMPTY_SAVED_STATE, NOW)).toEqual({
      ok: false,
      reason: 'unknown-meet',
    });
  });

  it('refuses to write through an archive', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const archived = archiveMeet(library, id, true);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(saveMeetState(archived.library, id, EMPTY_SAVED_STATE, NOW + 1)).toEqual({
      ok: false,
      reason: 'meet-archived',
    });
  });
});

describe('renaming', () => {
  it('changes the name and nothing else', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const change = renameMeet(library, id, '  Nationals  ');
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const meet = findMeet(change.library, id);
    expect(meet?.name).toBe('Nationals');
    expect(meet?.updatedAt).toBe(NOW);
  });

  it('refuses to empty a name', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    expect(renameMeet(library, id, '')).toEqual({ ok: false, reason: 'name-required' });
    expect(findMeet(library, id)?.name).toBe('Winter Open');
  });

  it('renames an archived meet, which is the one thing an archive still allows', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const archived = archiveMeet(library, id, true);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const change = renameMeet(archived.library, id, '2025 Winter Open');
    expect(change.ok).toBe(true);
  });
});

describe('duplicating', () => {
  it('opens the copy, not the original', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const change = duplicateMeet(library, id, 'Winter Open (copy)', NOW + 5);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(activeMeet(change.library)?.name).toBe('Winter Open (copy)');
    expect(change.library.activeMeetId).not.toBe(id);
    expect(change.library.meets).toHaveLength(2);
  });

  it('keeps the original stamps of the plan and takes fresh ones for the copy', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const change = duplicateMeet(library, id, 'Copy', NOW + 5);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const copy = activeMeet(change.library);
    expect(copy?.createdAt).toBe(NOW + 5);
    expect(copy?.updatedAt).toBe(NOW + 5);
    expect(copy?.rulesProfileId).toBe('uspa-2026');
    expect(copy?.methodologyVersion).toBe(SAVED_MEET_METHODOLOGY_VERSION);
  });

  it('unarchives on the way out, which is why anybody duplicates a finished meet', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const archived = archiveMeet(library, id, true);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const change = duplicateMeet(archived.library, id, 'Next one', NOW + 5);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(activeMeet(change.library)?.archived).toBe(false);
    expect(findMeet(change.library, id)?.archived).toBe(true);
  });

  it('refuses when the shelf is full', () => {
    const full = filled(MEET_LIBRARY_MAX);
    const id = full.meets[0]?.id ?? '';
    expect(duplicateMeet(full, id, 'One more', NOW)).toEqual({ ok: false, reason: 'library-full' });
  });

  it('refuses an unknown meet', () => {
    expect(duplicateMeet(EMPTY_LIBRARY, 'meet-1', 'Copy', NOW)).toEqual({
      ok: false,
      reason: 'unknown-meet',
    });
  });
});

describe('archiving, opening and closing', () => {
  it('closes the meet it archives, so no auto-save is silently refused', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const change = archiveMeet(library, id, true);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.library.activeMeetId).toBeNull();
    expect(activeMeet(change.library)).toBeNull();
  });

  it('leaves another open meet open', () => {
    const library = withMeet(withMeet(EMPTY_LIBRARY, { name: 'First' }), { name: 'Second' });
    const first = library.meets[1]?.id ?? '';
    const change = archiveMeet(library, first, true);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(activeMeet(change.library)?.name).toBe('Second');
  });

  it('sorts the shelf into resumable and archived', () => {
    const library = withMeet(withMeet(EMPTY_LIBRARY, { name: 'Old' }), { name: 'New' });
    const change = archiveMeet(library, library.meets[1]?.id ?? '', true);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(resumableMeets(change.library).map((meet) => meet.name)).toEqual(['New']);
    expect(archivedMeets(change.library).map((meet) => meet.name)).toEqual(['Old']);
  });

  it('unarchives what it opens', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const archived = archiveMeet(library, id, true);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const change = openMeet(archived.library, id);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(activeMeet(change.library)?.id).toBe(id);
    expect(findMeet(change.library, id)?.archived).toBe(false);
  });

  it('closes without touching anything', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const closed = closeMeet(library);
    expect(closed.activeMeetId).toBeNull();
    expect(closed.meets).toEqual(library.meets);
  });

  it('refuses to archive or open a meet that is not there', () => {
    expect(archiveMeet(EMPTY_LIBRARY, 'meet-1', true)).toEqual({
      ok: false,
      reason: 'unknown-meet',
    });
    expect(openMeet(EMPTY_LIBRARY, 'meet-1')).toEqual({ ok: false, reason: 'unknown-meet' });
  });
});

describe('deleting', () => {
  it('removes it and closes it if it was open', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const id = library.meets[0]?.id ?? '';
    const change = deleteMeet(library, id);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.library.meets).toEqual([]);
    expect(change.library.activeMeetId).toBeNull();
  });

  it('leaves a different open meet open', () => {
    const library = withMeet(withMeet(EMPTY_LIBRARY, { name: 'First' }), { name: 'Second' });
    const change = deleteMeet(library, library.meets[1]?.id ?? '');
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(activeMeet(change.library)?.name).toBe('Second');
  });

  it('refuses an unknown meet rather than reporting a deletion that did not happen', () => {
    expect(deleteMeet(EMPTY_LIBRARY, 'meet-4')).toEqual({ ok: false, reason: 'unknown-meet' });
  });
});

describe('importing', () => {
  function incoming(id: string, name: string): SavedMeet {
    return {
      id,
      name,
      createdAt: NOW - 100,
      updatedAt: NOW - 50,
      archived: false,
      rulesProfileId: 'ipl-2026',
      rulebookRevision: '2026-02',
      methodologyVersion: 'attempt-plan-2025.4',
      state: EMPTY_SAVED_STATE,
    };
  }

  it('previews without changing anything', () => {
    const library = withMeet(EMPTY_LIBRARY);
    const preview = previewImport(library, [incoming('meet-1', 'Theirs')]);
    expect(preview.entries[0]?.disposition).toBe('conflict');
    expect(preview.overflow).toBe(0);
    expect(library.meets).toHaveLength(1);
  });

  it('calls an id nobody here is using new', () => {
    const preview = previewImport(withMeet(EMPTY_LIBRARY), [incoming('meet-9', 'Theirs')]);
    expect(preview.entries[0]?.disposition).toBe('new');
  });

  it('renumbers even the meets that did not conflict', () => {
    // The sequence that breaks under "renumber only conflicts": a foreign id
    // ahead of the counter, then a meet created here on top of it.
    const library = withMeet(EMPTY_LIBRARY);
    const outcome = importMeets(library, previewImport(library, [incoming('meet-9', 'Theirs')]));
    const after = withMeet(outcome.library, { name: 'Mine' });
    const ids = after.meets.map((meet) => meet.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never overwrites a meet whose id it shares', () => {
    const library = withMeet(EMPTY_LIBRARY, { name: 'Mine' });
    const id = library.meets[0]?.id ?? '';
    const outcome = importMeets(library, previewImport(library, [incoming(id, 'Theirs')]));
    expect(outcome.library.meets).toHaveLength(2);
    expect(findMeet(outcome.library, id)?.name).toBe('Mine');
    expect(outcome.renumbered).toBe(1);
    expect(outcome.added).toBe(1);
  });

  it('keeps the imported plan under the stamps it arrived with', () => {
    const outcome = importMeets(
      EMPTY_LIBRARY,
      previewImport(EMPTY_LIBRARY, [incoming('meet-1', 'Theirs')]),
    );
    const filedMeet = outcome.library.meets[0];
    expect(filedMeet?.rulesProfileId).toBe('ipl-2026');
    expect(filedMeet?.methodologyVersion).toBe('attempt-plan-2025.4');
    expect(filedMeet?.createdAt).toBe(NOW - 100);
  });

  it('opens nothing, so an import at a meet cannot replace the screen in use', () => {
    const library = withMeet(EMPTY_LIBRARY, { name: 'Mine' });
    const openId = library.activeMeetId;
    const outcome = importMeets(library, previewImport(library, [incoming('meet-9', 'Theirs')]));
    expect(outcome.library.activeMeetId).toBe(openId);
  });

  it('counts what will not fit rather than dropping it quietly', () => {
    const full = filled(MEET_LIBRARY_MAX - 1);
    const preview = previewImport(full, [incoming('a', 'One'), incoming('b', 'Two')]);
    expect(preview.overflow).toBe(1);
    const outcome = importMeets(full, preview);
    expect(outcome.added).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect(outcome.library.meets).toHaveLength(MEET_LIBRARY_MAX);
  });

  it('files nothing from an empty file', () => {
    const outcome = importMeets(EMPTY_LIBRARY, previewImport(EMPTY_LIBRARY, []));
    expect(outcome).toEqual({ library: EMPTY_LIBRARY, added: 0, renumbered: 0, skipped: 0 });
  });
});

describe('the version stamp', () => {
  it('is a whole number that a reader can compare', () => {
    expect(Number.isInteger(SAVED_MEET_VERSION)).toBe(true);
    expect(SAVED_MEET_VERSION).toBeGreaterThan(0);
  });
});
