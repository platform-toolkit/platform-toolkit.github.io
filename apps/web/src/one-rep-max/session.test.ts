/**
 * The tool's session layer: what is typed, what is remembered, and for how long.
 *
 * Node rather than the browser, because none of this touches the DOM and the two
 * cases that matter most cannot be produced in a test browser at all -- storage
 * that refuses to remember, and storage holding a value written by an older
 * shape of this file.
 */
import {
  ESTIMATE_LIFTS,
  MAX_COMPLETED_REPS,
  ROUNDING_INCREMENTS,
  techniquesFor,
} from '@platform-toolkit/domain';
import {
  PREFERENCE_KEY_PREFIX,
  createPreferenceStore,
  memoryPreferenceStorage,
  type PreferenceStorage,
} from '@platform-toolkit/preferences';
import { describe, expect, it } from 'vitest';

import {
  DISPLAY_PREFERENCES,
  EMPTY_ENTRY,
  SET_PREFERENCES,
  STORED_TECHNIQUE_IDS,
  chooseReps,
  experienceFrom,
  experienceValueOf,
  formQualityFrom,
  freshnessFrom,
  liftFromValue,
  loadEntry,
  readReps,
  repsProblem,
  requestFor,
  reserveFromValue,
  saveEntry,
  setLift,
  setTechnique,
  setUnit,
  sexFrom,
  sexValueOf,
  typeReps,
  typeWeight,
  unitFromValue,
  weightProblem,
  type EstimateEntry,
} from './session.js';

function store() {
  return createPreferenceStore(memoryPreferenceStorage());
}

/** An entry with a real set in it, so a test can change one thing about it. */
function described(overrides: Partial<EstimateEntry> = {}): EstimateEntry {
  return { ...typeWeight(EMPTY_ENTRY, '142.5'), repsText: '5', ...overrides };
}

describe('the stored technique list', () => {
  /*
   * The list in `session.ts` is spelled out because `PreferenceValue.choice`
   * infers its literal union from a `const` type parameter, and one computed
   * from `techniquesFor` widens to `string` -- which turns a closed picklist
   * into the free-text builder `packages/preferences` deliberately does not have
   * (§5.12). This is the test that keeps the two spellings honest. Without it
   * the domain gains a standard, the preference refuses to store it, and a
   * lifter's chosen standard silently reverts on reload.
   */
  it('holds every identifier the domain offers, and no others', () => {
    const offered = ESTIMATE_LIFTS.flatMap((lift) => techniquesFor(lift)).map(
      (option) => option.id,
    );
    expect([...STORED_TECHNIQUE_IDS].sort()).toEqual([...offered].sort());
  });
});

describe('typing', () => {
  it('keeps exactly what was typed, including a half-finished number', () => {
    expect(typeWeight(EMPTY_ENTRY, '14.').weightText).toBe('14.');
  });

  it('reads a unit suffix as the unit the number is in', () => {
    const entry = typeWeight(EMPTY_ENTRY, '315 lb');
    expect(entry.unit).toBe('lb');
    // The rounding step moves with the unit by position, not by conversion: the
    // finest kilogram step is 0.5 and the finest pound step is 1.
    expect(entry.roundTo).toBe(ROUNDING_INCREMENTS.lb[0]);
  });

  it('reports nothing for an empty field', () => {
    expect(weightProblem(EMPTY_ENTRY)).toBeNull();
    expect(repsProblem(EMPTY_ENTRY)).toBeNull();
  });

  it('names what is wrong with a weight that cannot be read', () => {
    expect(weightProblem(typeWeight(EMPTY_ENTRY, '1o5'))).toContain('digits');
  });

  /*
   * Twenty-five is not a shape problem, it is a set problem, and the domain has
   * a specific thing to say about it (use a heavier weight for fewer reps).
   * Swallowing it here as "not a number" is how that sentence becomes
   * unreachable.
   */
  it('lets an out-of-range repetition count through to the domain', () => {
    const entry = typeReps(EMPTY_ENTRY, String(MAX_COMPLETED_REPS + 5));
    expect(repsProblem(entry)).toBeNull();
    expect(readReps(entry)).toBe(MAX_COMPLETED_REPS + 5);
  });

  it('refuses a repetition count that is not whole', () => {
    expect(readReps(typeReps(EMPTY_ENTRY, '3.5'))).toBeNull();
    expect(repsProblem(typeReps(EMPTY_ENTRY, '3.5'))).toContain('whole number');
  });

  it('writes the digits a chip stands for', () => {
    expect(chooseReps(EMPTY_ENTRY, 8).repsText).toBe('8');
  });
});

describe('changing unit', () => {
  /*
   * §15 makes this an acceptance test in its own words: converting repeatedly
   * introduces no cumulative drift. It passes only because the entry holds the
   * origin the lifter typed and re-shows it, rather than rewriting the number
   * each time.
   */
  it('converts rather than reinterpreting, with no drift over repeated flicks', () => {
    let entry = typeWeight(EMPTY_ENTRY, '100');
    expect(setUnit(entry, 'lb').weightText).not.toBe('100');

    for (let flick = 0; flick < 20; flick += 1) {
      entry = setUnit(entry, entry.unit === 'kg' ? 'lb' : 'kg');
    }
    expect(setUnit(entry, 'kg').weightText).toBe('100');
  });

  it('leaves an empty field empty rather than converting nothing into a number', () => {
    expect(setUnit(EMPTY_ENTRY, 'lb').weightText).toBe('');
  });
});

describe('changing lift', () => {
  /*
   * Technique identifiers are unique within a lift and not across lifts, so a
   * carried-over identifier either selects nothing or claims a standard the
   * lifter never chose.
   */
  it('resets the movement standard to one the new lift offers', () => {
    const benched = setTechnique(setLift(EMPTY_ENTRY, 'bench-press'), 'touch-and-go');
    const squatted = setLift(benched, 'squat');
    expect(techniquesFor('squat').map((option) => option.id)).toContain(squatted.techniqueId);
  });

  it('ignores a standard the current lift does not offer', () => {
    expect(setTechnique(EMPTY_ENTRY, 'touch-and-go')).toEqual(EMPTY_ENTRY);
  });
});

describe('the string mappers', () => {
  /*
   * Every one of these takes a string out of the DOM and every one is total. The
   * fallback matters more than the happy path: an unrecognised value has to land
   * on the answer that claims nothing, not on a state no control can show back.
   */
  it('falls back rather than inventing an answer', () => {
    expect(liftFromValue('curl')).toBe('squat');
    expect(unitFromValue('stone')).toBe('kg');
    expect(reserveFromValue('seven')).toBe('unknown');
    expect(freshnessFrom('rested')).toBe('unstated');
    expect(formQualityFrom('perfect')).toBe('unstated');
    expect(sexFrom('declined')).toBeNull();
    expect(experienceFrom('declined')).toBeNull();
  });

  it('round-trips the two answers that are stored as a word for "no answer"', () => {
    expect(sexFrom(sexValueOf(null))).toBeNull();
    expect(sexFrom(sexValueOf('woman'))).toBe('woman');
    expect(experienceFrom(experienceValueOf(null))).toBeNull();
    expect(experienceFrom(experienceValueOf('experienced'))).toBe('experienced');
  });
});

describe('the request handed to the domain', () => {
  it('is null while either field is unreadable', () => {
    expect(requestFor(EMPTY_ENTRY)).toBeNull();
    expect(requestFor(typeWeight(EMPTY_ENTRY, '142.5'))).toBeNull();
    expect(requestFor(typeReps(EMPTY_ENTRY, '5'))).toBeNull();
  });

  it('carries every optional answer through', () => {
    const entry = described({ sex: 'woman', experience: 'new', assisted: true });
    const request = requestFor(entry);
    expect(request).not.toBeNull();
    expect(request?.sex).toBe('woman');
    expect(request?.experience).toBe('new');
    expect(request?.assisted).toBe(true);
  });
});

describe('what survives, and where', () => {
  it('restores a described set from the two stores', () => {
    const display = store();
    const session = store();
    const entry = described({ reserve: '1', freshness: 'fatigued', sex: 'man' });
    saveEntry(display, session, entry);

    expect(loadEntry(display, session)).toEqual(entry);
  });

  /*
   * The privacy split, asserted rather than described. A set reopened next week
   * is a training record the lifter never chose to write, and one of the answers
   * in it is a sex marker -- so nothing about the set may reach the store that
   * outlives the tab, whatever else changes about this file.
   */
  it('writes nothing about the set to the store that outlives the tab', () => {
    const written: string[] = [];
    const recording: PreferenceStorage = {
      read: () => null,
      write: (key) => {
        written.push(key);
        return 'saved';
      },
      remove: () => undefined,
      keys: () => [],
    };
    const display = createPreferenceStore(recording);
    saveEntry(display, store(), described({ sex: 'woman', experience: 'new' }));

    // The prefix is part of the key the store actually writes, so the
    // assertions have to carry it. Comparing against the bare definition names
    // would make the `not.toContain` below pass whatever was written.
    const keyOf = (preference: { readonly name: string }): string =>
      `${PREFERENCE_KEY_PREFIX}${preference.name}`;
    for (const preference of Object.values(SET_PREFERENCES)) {
      expect(written).not.toContain(keyOf(preference));
    }
    expect(written).toEqual(Object.values(DISPLAY_PREFERENCES).map(keyOf));
  });

  /*
   * Storage is a trust boundary like any other. A rounding step that is not one
   * of this unit's steps leaves the control with nothing selected -- which reads
   * as a broken render, not as a rejected value.
   */
  it('replaces a remembered rounding step the current unit does not offer', () => {
    const display = store();
    const session = store();
    saveEntry(display, session, typeWeight(EMPTY_ENTRY, '315 lb'));
    // 2.5 is a kilogram step and not a pound one, so it is refused on the way back.
    display.write(DISPLAY_PREFERENCES.roundTo, 2.5);

    expect(ROUNDING_INCREMENTS.lb).toContain(loadEntry(display, session).roundTo);
  });

  it('replaces a remembered standard belonging to another lift', () => {
    const display = store();
    const session = store();
    saveEntry(display, session, setLift(EMPTY_ENTRY, 'deadlift'));
    session.write(SET_PREFERENCES.technique, 'touch-and-go');

    const restored = loadEntry(display, session);
    expect(techniquesFor('deadlift').map((option) => option.id)).toContain(restored.techniqueId);
  });

  /*
   * Zero is a weight somebody can type, so "nothing entered" cannot be encoded
   * as a zero amount -- it needs the flag beside it, or a typed 0 comes back as
   * a blank field.
   */
  it('tells a typed zero apart from an empty field', () => {
    const display = store();
    const session = store();
    saveEntry(display, session, typeWeight(EMPTY_ENTRY, '0'));
    expect(loadEntry(display, session).weightText).toBe('0');

    saveEntry(display, session, EMPTY_ENTRY);
    expect(loadEntry(display, session).weightText).toBe('');
  });

  it('reads defaults, and refuses nothing, when the device has no storage', () => {
    const nowhere = createPreferenceStore(null);
    saveEntry(nowhere, nowhere, described());
    expect(loadEntry(nowhere, nowhere)).toEqual(EMPTY_ENTRY);
  });

  /*
   * Half the values passing through `saveEntry` are mid-edit, and a write that
   * violates its own definition throws by design (§5.12). A count of 4,000 is
   * two keystrokes away from 4, so it has to be stored as "nothing entered"
   * rather than throwing on the way past.
   */
  it('stores an unstorable repetition count as nothing entered', () => {
    const display = store();
    const session = store();
    expect(() => {
      saveEntry(display, session, typeReps(EMPTY_ENTRY, '4000'));
    }).not.toThrow();
    expect(loadEntry(display, session).repsText).toBe('');
  });
});
