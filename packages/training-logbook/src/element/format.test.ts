// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The set line, and the two mistakes it exists to prevent.
 *
 * Both are silent. A converted weight is a number that is not wrong so much as not
 * what was typed, and a flattened load shape is a counterweight printed as load --
 * neither throws, neither fails a type check, and both are only visible to somebody
 * who already knows what the answer should have been.
 */

import { describe, expect, it } from 'vitest';

import type { SetLoad, SetPerformance } from '../types.js';

import { ASSIST_SUFFIX, NOT_SET, formatLoad, formatPerformance, formatVolume } from './format.js';

// Invented numbers throughout. Nothing here is a federation figure; 60 and 20 are
// chosen because they are distinguishable from each other and from a rep count.
const SIXTY_KG = { amount: 60, unit: 'kg' } as const;
const TWENTY_KG = { amount: 20, unit: 'kg' } as const;

function performed(load: SetLoad, repetitions: number | null): SetPerformance {
  return { load, repetitions, effort: null };
}

describe('formatLoad', () => {
  it('says nothing for a set that carries no load', () => {
    // `null` and not an empty string, so each caller decides what an absent weight
    // reads as -- a bodyweight row says nothing and a half-filled planned row says
    // "Not set", and one formatter cannot be right about both.
    expect(formatLoad({ kind: 'none' })).toBeNull();
  });

  it('prints an implement weight as the weight', () => {
    expect(formatLoad({ kind: 'implement', weight: SIXTY_KG })).toBe('60 kg');
  });

  it('marks added weight with a plus, so it cannot read as the whole lift', () => {
    expect(formatLoad({ kind: 'added', weight: TWENTY_KG })).toBe('+20 kg');
  });

  it('labels a counterweight, so it cannot read as load', () => {
    expect(formatLoad({ kind: 'assisted', weight: TWENTY_KG })).toBe(`20 kg ${ASSIST_SUFFIX}`);
  });

  it('never prints an assisted set and an added set the same way', () => {
    // The whole point of section 6.2's four shapes, asserted on the one screen a
    // lifter reads them from. Same number, opposite facts.
    const added = formatLoad({ kind: 'added', weight: TWENTY_KG });
    const assisted = formatLoad({ kind: 'assisted', weight: TWENTY_KG });

    expect(added).not.toBe(assisted);
  });

  it('shows the unit the weight was recorded in and converts nothing', () => {
    // Section 11.4 and `HOME_NOTES.unitNote`, which promises exactly this in
    // prose. A lifter who typed 100 kg and later switched the display to pounds
    // must still see 100 kg on the sets they already logged; anything else makes
    // every repeat of that session round somewhere new.
    expect(formatLoad({ kind: 'implement', weight: { amount: 100, unit: 'kg' } })).toBe('100 kg');
    expect(formatLoad({ kind: 'implement', weight: { amount: 100, unit: 'lb' } })).toBe('100 lb');
  });
});

describe('formatPerformance', () => {
  it('says a set is not filled in yet rather than printing a blank', () => {
    expect(formatPerformance(null)).toBe(NOT_SET);
  });

  it('joins the weight and the rep count', () => {
    expect(formatPerformance(performed({ kind: 'implement', weight: SIXTY_KG }, 5))).toBe(
      '60 kg x 5',
    );
  });

  it('reads a bodyweight set as reps alone', () => {
    // Not an incomplete answer. A chin-up set is fully described by its rep count,
    // and printing "Not set" beside it would suggest something is missing.
    expect(formatPerformance(performed({ kind: 'none' }, 8))).toBe('8 reps');
  });

  it('reads a weight with no reps yet as the weight alone', () => {
    // The state a lifter is in between planning the bar and doing the set.
    expect(formatPerformance(performed({ kind: 'implement', weight: SIXTY_KG }, null))).toBe(
      '60 kg',
    );
  });

  it('says nothing is set when neither half is', () => {
    expect(formatPerformance(performed({ kind: 'none' }, null))).toBe(NOT_SET);
  });

  it('prints zero reps rather than treating it as nothing recorded', () => {
    // Zero is a fact: the lifter got under the bar and it did not move. A reader
    // that tested the rep count for truthiness would erase that and show the set
    // as unlogged, which is the one reading that is definitely wrong.
    expect(formatPerformance(performed({ kind: 'implement', weight: SIXTY_KG }, 0))).toBe(
      '60 kg x 0',
    );
  });

  it('keeps the load shape when it joins the two halves', () => {
    expect(formatPerformance(performed({ kind: 'assisted', weight: TWENTY_KG }, 6))).toBe(
      `20 kg ${ASSIST_SUFFIX} x 6`,
    );
    expect(formatPerformance(performed({ kind: 'added', weight: TWENTY_KG }, 6))).toBe(
      '+20 kg x 6',
    );
  });
});

/** Everything after the set count: the sign, and the reps it multiplies. */
function afterTheCount(volume: string): string {
  return volume.slice(volume.indexOf(' ') + 1);
}

describe('formatVolume', () => {
  it('writes a plan the way it is written on paper', () => {
    expect(formatVolume(3, 5)).toBe('3 x 5');
  });

  it('multiplies with the same sign a logged set is written with', () => {
    // The reason the function is in this file rather than at its one call site. A
    // plan and the sets it produced are read inches apart, and two callers each
    // picking their own sign would put them in two notations. Neither side is
    // compared against a literal here, so moving `TIMES` keeps this green and
    // forking it does not.
    const logged = formatPerformance(performed({ kind: 'implement', weight: SIXTY_KG }, 5));

    expect(logged).toContain(afterTheCount(formatVolume(3, 5)));
  });
});
