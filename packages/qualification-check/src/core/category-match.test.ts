// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { WeightClass } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import type { ObservedAge } from '../types.js';
import {
  divisionsForAge,
  mayPreselect,
  proposeDivisionFromAgeClass,
  proposeEquipment,
  proposeSex,
  proposeWeightClassFromBodyweight,
  proposeWeightClassFromEntry,
} from './category-match.js';
import {
  DIVISIONS_FIXTURE,
  EQUIPMENT_FIXTURE,
  MASTER_FIXTURE,
  OPEN_FIXTURE,
  SUBMASTER_FIXTURE,
  WEIGHT_CLASSES_FIXTURE,
} from './qualification.fixture.js';

/** An age the archive was sure of. */
function exactly(years: number): ObservedAge {
  return { years, approximate: false, on: '2026-03-14' };
}

/** An age the archive recorded as "that, or one year older". */
function about(years: number): ObservedAge {
  return { years, approximate: true, on: '2026-03-14' };
}

describe('mayPreselect', () => {
  it('admits only a measurement', () => {
    expect(mayPreselect('measured')).toBe(true);
  });

  it('refuses a word two documents happen to share', () => {
    // The rule the whole package turns on, and the one place it lives. The failure
    // it prevents is silent: a lifter graded against the wrong equipment ladder sees
    // a plausible number, on the right screen, under the right heading.
    expect(mayPreselect('spelled')).toBe(false);
  });

  it('refuses an absence', () => {
    expect(mayPreselect('none')).toBe(false);
  });
});

describe('proposeSex', () => {
  it('reads the archive initial as a spelling, not a measurement', () => {
    const proposal = proposeSex('M');
    expect(proposal.proposed).toBe('male');
    expect(proposal.basis).toBe('spelled');
    expect(mayPreselect(proposal.basis)).toBe(false);
  });

  it('reads the full word too', () => {
    expect(proposeSex('Female').proposed).toBe('female');
  });

  it('proposes nothing for a category the published vocabulary has no room for', () => {
    // `Mx` is a value the archive publishes and the catalogue has nowhere to put. The
    // honest outcome is a question, not a coin toss between the two that do exist.
    const proposal = proposeSex('Mx');
    expect(proposal.candidates).toEqual([]);
    expect(proposal.proposed).toBeNull();
    expect(proposal.basis).toBe('none');
  });

  it('proposes nothing where the archive printed nothing', () => {
    expect(proposeSex(null)).toEqual({
      observed: null,
      candidates: [],
      proposed: null,
      basis: 'none',
    });
  });
});

describe('proposeEquipment', () => {
  it('will not fill in an exact match, which is the case that matters most', () => {
    // The archive prints `Raw` and this federation publishes `Raw`, and they differ
    // over knee wraps. An exact label match is therefore *actively wrong* for the
    // most common entry in the corpus -- so it is offered and never assumed.
    const proposal = proposeEquipment('Raw', EQUIPMENT_FIXTURE);
    expect(proposal.proposed).toEqual({ id: 'raw', label: 'Raw' });
    expect(mayPreselect(proposal.basis)).toBe(false);
  });

  it('shows the reader what the archive said, beside what it matched', () => {
    expect(proposeEquipment('Raw', EQUIPMENT_FIXTURE).observed).toBe('Raw');
  });

  it('looks past the punctuation two documents disagree about', () => {
    expect(proposeEquipment('single ply', EQUIPMENT_FIXTURE).proposed?.id).toBe('single-ply');
    expect(proposeEquipment('SINGLE-PLY', EQUIPMENT_FIXTURE).proposed?.id).toBe('single-ply');
  });

  it('matches the federation id as readily as its label', () => {
    expect(proposeEquipment('raw-wraps', EQUIPMENT_FIXTURE).proposed?.id).toBe('raw-wraps');
  });

  it('does not stem, abbreviate or guess', () => {
    // `Wraps` is plainly what `Raw with Wraps` is called elsewhere, and saying so
    // would be this project asserting an equivalence nobody has checked.
    expect(proposeEquipment('Wraps', EQUIPMENT_FIXTURE).candidates).toEqual([]);
    expect(proposeEquipment('Multi-ply', EQUIPMENT_FIXTURE).candidates).toEqual([]);
  });
});

describe('proposeWeightClassFromEntry', () => {
  it('matches a printed class against a published boundary, and that is a measurement', () => {
    const proposal = proposeWeightClassFromEntry('94', WEIGHT_CLASSES_FIXTURE);
    expect(proposal.proposed?.id).toBe('to-94');
    expect(mayPreselect(proposal.basis)).toBe(true);
  });

  it('reads a trailing zero as the same boundary', () => {
    expect(proposeWeightClassFromEntry('94.00', WEIGHT_CLASSES_FIXTURE).proposed?.id).toBe('to-94');
  });

  it('matches the unbounded class only against the boundary below it', () => {
    expect(proposeWeightClassFromEntry('112+', WEIGHT_CLASSES_FIXTURE).proposed?.id).toBe(
      'over-112',
    );
  });

  it('refuses another federation heavyweight class as this one', () => {
    // A lifter who was 120+ somewhere else is not in this ladder's 112+ class, and
    // proposing one for the other is exactly the translation this module refuses.
    expect(proposeWeightClassFromEntry('120+', WEIGHT_CLASSES_FIXTURE).candidates).toEqual([]);
  });

  it('refuses SHW outright', () => {
    // It plainly means the heaviest class. The heaviest class of *which ladder* is
    // the whole question.
    const proposal = proposeWeightClassFromEntry('SHW', WEIGHT_CLASSES_FIXTURE);
    expect(proposal.candidates).toEqual([]);
    expect(proposal.observed).toBe('SHW');
  });

  it('refuses a boundary this federation does not publish', () => {
    expect(proposeWeightClassFromEntry('90', WEIGHT_CLASSES_FIXTURE).candidates).toEqual([]);
  });

  it('proposes nothing from a ladder with nothing below its top class', () => {
    // One unbounded class and no boundary to check the printed figure against. The
    // honest answer is no proposal rather than a match on the only candidate there is.
    const single: readonly WeightClass[] = [
      { id: 'all', label: 'One class', maximumKilograms: null },
    ];
    expect(proposeWeightClassFromEntry('112+', single).candidates).toEqual([]);
  });
});

describe('proposeWeightClassFromBodyweight', () => {
  it('places a weigh-in on the ladder', () => {
    const proposal = proposeWeightClassFromBodyweight(93.4, WEIGHT_CLASSES_FIXTURE);
    expect(proposal.proposed?.id).toBe('to-94');
    expect(mayPreselect(proposal.basis)).toBe(true);
  });

  it('makes the class exactly at the limit', () => {
    expect(proposeWeightClassFromBodyweight(94, WEIGHT_CLASSES_FIXTURE).proposed?.id).toBe('to-94');
  });

  it('places a heavyweight in the unbounded class', () => {
    expect(proposeWeightClassFromBodyweight(130, WEIGHT_CLASSES_FIXTURE).proposed?.id).toBe(
      'over-112',
    );
  });

  it('proposes nothing where nobody weighed in', () => {
    expect(proposeWeightClassFromBodyweight(null, WEIGHT_CLASSES_FIXTURE).proposed).toBeNull();
  });

  it('proposes nothing off a ladder the federation published wrongly', () => {
    // A data fault, and this screen is not where it gets reported -- but resolving a
    // class off an unchecked ladder would put an arbitrary answer in front of a lifter.
    const descending: readonly WeightClass[] = [
      { id: 'to-94', label: '94 kg', maximumKilograms: 94 },
      { id: 'to-78', label: '78 kg', maximumKilograms: 78 },
    ];
    expect(proposeWeightClassFromBodyweight(80, descending).proposed).toBeNull();
  });
});

describe('divisionsForAge', () => {
  it('returns every division an exact age admits, in the order the form prints them', () => {
    expect(divisionsForAge(exactly(41), DIVISIONS_FIXTURE)).toEqual([
      { division: OPEN_FIXTURE, support: 'either-reading' },
      { division: MASTER_FIXTURE, support: 'either-reading' },
    ]);
  });

  it('returns both readings of an age the archive was unsure of', () => {
    // The research finding this exists for. A lifter recorded as "39 or 40" is a
    // Submaster on one reading and a Master on the other, and rounding either way
    // answers a question the source declined to answer.
    expect(divisionsForAge(about(39), DIVISIONS_FIXTURE)).toEqual([
      { division: OPEN_FIXTURE, support: 'either-reading' },
      { division: SUBMASTER_FIXTURE, support: 'younger-reading-only' },
      { division: MASTER_FIXTURE, support: 'older-reading-only' },
    ]);
  });

  it('does not widen an age the archive was sure of', () => {
    expect(divisionsForAge(exactly(39), DIVISIONS_FIXTURE).map((one) => one.division.id)).toEqual([
      'open',
      'submaster',
    ]);
  });

  it('marks an unambiguous approximate age as reachable either way', () => {
    // Approximate does not mean uncertain about the *answer*. At 44 or 45 the lifter
    // is in the same two divisions, and saying so is what stops the screen asking a
    // question with one possible answer.
    expect(divisionsForAge(about(44), DIVISIONS_FIXTURE)).toEqual([
      { division: OPEN_FIXTURE, support: 'either-reading' },
      { division: MASTER_FIXTURE, support: 'either-reading' },
    ]);
  });

  it('returns nothing for an age below every division', () => {
    expect(divisionsForAge(exactly(11), DIVISIONS_FIXTURE)).toEqual([]);
  });
});

describe('proposeDivisionFromAgeClass', () => {
  it('matches two published numbers against two published numbers', () => {
    // Measured rather than spelled, because a band of 40 to 49 is a band of 40 to 49
    // whatever either document calls it.
    const proposal = proposeDivisionFromAgeClass('40-49', DIVISIONS_FIXTURE);
    expect(proposal.proposed?.id).toBe('master-1');
    expect(mayPreselect(proposal.basis)).toBe(true);
  });

  it('reads an open-ended band', () => {
    expect(proposeDivisionFromAgeClass('14+', DIVISIONS_FIXTURE).proposed?.id).toBe('open');
  });

  it('proposes nothing for a band this federation does not run', () => {
    // Real and common for an archive spanning hundreds of federations, and not a
    // fault in either document.
    expect(proposeDivisionFromAgeClass('40-44', DIVISIONS_FIXTURE).candidates).toEqual([]);
  });

  it('proposes nothing from a division name', () => {
    // `Masters 1` is the label this federation prints, and matching on it would be
    // the spelled claim this function exists to avoid making.
    expect(proposeDivisionFromAgeClass('Masters 1', DIVISIONS_FIXTURE).candidates).toEqual([]);
  });

  it('proposes nothing for a band written back to front', () => {
    expect(proposeDivisionFromAgeClass('49-40', DIVISIONS_FIXTURE).candidates).toEqual([]);
  });

  it('proposes nothing where the archive printed no band', () => {
    expect(proposeDivisionFromAgeClass(null, DIVISIONS_FIXTURE).proposed).toBeNull();
  });
});
