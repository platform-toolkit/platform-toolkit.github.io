// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { AthleteEntry } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import type { ObservedStanding, ResolvedRegistration } from '../types.js';
import { collectStandings } from './history.js';
import {
  entry,
  MASTER_FIXTURE,
  OPEN_FIXTURE,
  SUBMASTER_FIXTURE,
  VOCABULARY_FIXTURE,
  wholeYearWindow,
} from './qualification.fixture.js';
import { proposeRegistration, resolveRegistration } from './registration.js';

const WINDOW = wholeYearWindow();

/** The standing one archive entry supports. */
function standingFor(patch: Partial<AthleteEntry> = {}): ObservedStanding {
  const [first, ...rest] = collectStandings([entry(patch)], WINDOW);
  if (first === undefined || rest.length > 0) {
    throw new Error('Expected one entry to make one standing.');
  }
  return first;
}

/**
 * The answer that unlocks the weight-class axis, given to every test that is not about
 * it. A ladder is published per sex, so a proposal made with no answers cannot offer a
 * class at all -- true, deliberate, and beside the point of a test about divisions.
 */
const MALE: Partial<ResolvedRegistration> = { sex: 'male' };

function proposalFor(
  patch: Partial<AthleteEntry> = {},
  answers: Partial<ResolvedRegistration> = MALE,
): ReturnType<typeof proposeRegistration> {
  return proposeRegistration(standingFor(patch), VOCABULARY_FIXTURE, answers);
}

describe('what proposeRegistration will fill in', () => {
  it('fills in only what it measured', () => {
    // A complete, unambiguous archive entry, and the form still has two questions on
    // it. That is not a gap: sex and equipment are matched by spelling, and this
    // federation's `Raw` is not the archive's `Raw`.
    expect(proposalFor().defaults).toEqual({
      weightClassId: 'to-94',
      divisionId: 'master-1',
      tested: true,
    });
  });

  it('names exactly the axes the reader has to answer', () => {
    expect(proposalFor().unsettled).toEqual(['sex', 'equipment']);
  });

  it('still offers the spelled matches it refused to assume', () => {
    const proposal = proposalFor();
    expect(proposal.sex.proposed).toBe('male');
    expect(proposal.equipment.proposed?.id).toBe('raw');
  });
});

/**
 * The axis that cannot be read until another one is answered.
 *
 * Weight classes are published one ladder per sex and the two overlap only partly, so
 * there is no such thing as "the 94 kg class" until the sex is settled. Every case here
 * is about the window before that -- and the failure being prevented is silent, because
 * a class off the wrong ladder is a plausible number in the right control.
 */
describe('the weight class, before the sex is known', () => {
  it('offers nothing, rather than a class off whichever ladder matched first', () => {
    const proposal = proposalFor({}, {});
    expect(proposal.weightClassOptions).toEqual([]);
    expect(proposal.defaults.weightClassId).toBeUndefined();
    expect(proposal.unsettled).toContain('weight-class');
  });

  it('does not measure a bodyweight against a ladder it has not chosen', () => {
    // 93.4 kg makes a class on both fixture ladders -- `to-94` on one, `f-over-71` on
    // the other -- so a proposal made with no sex would have to pick one, and both
    // answers look right on screen.
    const proposal = proposalFor({ bodyweightKg: 93.4 }, {});
    expect(proposal.weighedWeightClass.proposed).toBeNull();
  });

  it('reads the answered sex ladder and not the other one', () => {
    // The fixture ladders share no boundary and no identifier, so this asserts the
    // selection rather than a coincidence: `to-94` exists only on the male ladder.
    expect(proposalFor({}, { sex: 'male' }).weightClassOptions.map((one) => one.id)).toContain(
      'to-94',
    );
    expect(proposalFor({}, { sex: 'female' }).weightClassOptions.map((one) => one.id)).toEqual([
      'f-to-47',
      'f-to-59',
      'f-to-71',
      'f-over-71',
    ]);
  });

  it('will not put a woman in a class her federation publishes only for men', () => {
    // The whole reason the vocabulary keeps the ladders apart. This entry weighs 93.4
    // and entered "94", which is a real class on the male ladder and on no other; read
    // as a woman she belongs in the unbounded class, and a merged ladder would have
    // graded her against a men's 94 kg standard without a word on the screen.
    const proposal = proposalFor({ weightClassKg: '94', bodyweightKg: 93.4 }, { sex: 'female' });
    expect(proposal.enteredWeightClass.proposed).toBeNull();
    expect(proposal.weighedWeightClass.proposed?.id).toBe('f-over-71');
    expect(proposal.unsettled).toContain('weight-class');
  });
});

describe('the weight class a proposal defaults to', () => {
  it('is the class entered, not the class weighed into', () => {
    // A lifter may enter above their weigh-in, and standards are published per class
    // entered. Defaulting to the weighed class would grade a lifter who moved up
    // against the ladder they moved away from.
    const proposal = proposalFor({ weightClassKg: '112', bodyweightKg: 93.4 });
    expect(proposal.defaults.weightClassId).toBe('to-112');
  });

  it('shows both, so a disagreement between them is visible rather than mysterious', () => {
    const proposal = proposalFor({ weightClassKg: '112', bodyweightKg: 93.4 });
    expect(proposal.enteredWeightClass.proposed?.id).toBe('to-112');
    expect(proposal.weighedWeightClass.proposed?.id).toBe('to-94');
  });

  it('reads the lightest weigh-in of the window', () => {
    const [standing] = collectStandings(
      [
        entry({ date: '2026-02-02', bodyweightKg: 93.9 }),
        entry({ date: '2026-06-06', bodyweightKg: 77.4 }),
      ],
      WINDOW,
    );
    if (standing === undefined) throw new Error('Expected a standing.');
    expect(
      proposeRegistration(standing, VOCABULARY_FIXTURE, MALE).weighedWeightClass.proposed?.id,
    ).toBe('to-78');
  });

  it('is unsettled where the archive printed a class this ladder does not publish', () => {
    const proposal = proposalFor({ weightClassKg: 'SHW' });
    expect(proposal.defaults.weightClassId).toBeUndefined();
    expect(proposal.unsettled).toContain('weight-class');
  });
});

describe('the division axis', () => {
  it('is unsettled where the meet printed no age band', () => {
    const proposal = proposalFor({ ageClass: null });
    expect(proposal.defaults.divisionId).toBeUndefined();
    expect(proposal.unsettled).toContain('division');
  });

  it('offers every division the recorded age admits, grouped by the age', () => {
    const proposal = proposalFor({ ageClass: null, age: { years: 39, approximate: true } });
    expect(proposal.divisionsByAge).toEqual([
      {
        age: { years: 39, approximate: true, on: '2026-03-14' },
        candidates: [
          { division: OPEN_FIXTURE, support: 'either-reading' },
          { division: SUBMASTER_FIXTURE, support: 'younger-reading-only' },
          { division: MASTER_FIXTURE, support: 'older-reading-only' },
        ],
      },
    ]);
  });

  it('lists the options once each, in the order the entry form prints them', () => {
    // Accumulated from the age groups instead, the options would be ordered by which
    // of a lifter's ages the archive recorded first -- an ordering nobody could explain.
    const [standing] = collectStandings(
      [
        entry({ date: '2026-06-06', ageClass: null, age: { years: 41, approximate: false } }),
        entry({ date: '2026-02-02', ageClass: null, age: { years: 38, approximate: false } }),
      ],
      WINDOW,
    );
    if (standing === undefined) throw new Error('Expected a standing.');
    expect(
      proposeRegistration(standing, VOCABULARY_FIXTURE).divisionOptions.map((one) => one.id),
    ).toEqual(['open', 'submaster', 'master-1']);
  });

  it('includes the band the meet printed even where no recorded age reaches it', () => {
    // The band is evidence about the division the lifter actually entered, and an
    // archive that recorded no age at all still printed it.
    const proposal = proposalFor({ ageClass: '40-49', age: null });
    expect(proposal.divisionsByAge).toEqual([]);
    expect(proposal.divisionOptions.map((one) => one.id)).toEqual(['master-1']);
  });

  it('is settled by the band alone, because a band is two numbers and not a name', () => {
    expect(proposalFor({ age: null }).defaults.divisionId).toBe('master-1');
  });
});

describe('the drug-tested axis', () => {
  it('takes a recorded yes at its word', () => {
    expect(proposalFor({ tested: true }).tested).toEqual({
      observed: true,
      proposed: true,
      basis: 'measured',
    });
  });

  it('asks rather than assuming where the archive said nothing', () => {
    // The column only ever asserts the positive. Read as `false` a blank would put
    // untested standards in front of somebody whose meet was tested and unmarked.
    const proposal = proposalFor({ tested: null });
    expect(proposal.tested).toEqual({ observed: null, proposed: null, basis: 'none' });
    expect(proposal.defaults.tested).toBeUndefined();
    expect(proposal.unsettled).toContain('tested');
  });

  it('takes a recorded no at its word too, where a source one day says so', () => {
    expect(proposalFor({ tested: false }).defaults.tested).toBe(false);
  });
});

describe('resolveRegistration', () => {
  const ANSWERS: Partial<ResolvedRegistration> = { sex: 'male', equipmentId: 'raw' };

  it('completes a proposal with the reader answers', () => {
    const resolution = resolveRegistration(proposalFor(), ANSWERS);
    expect(resolution).toEqual({
      ok: true,
      registration: {
        sex: 'male',
        equipmentId: 'raw',
        weightClassId: 'to-94',
        divisionId: 'master-1',
        tested: true,
      },
    });
  });

  it('lets an answer override a measured default', () => {
    // Every proposal is a starting point. A lifter who intends to enter Open rather
    // than Masters says so, and nothing here argues.
    const resolution = resolveRegistration(proposalFor(), { ...ANSWERS, divisionId: 'open' });
    expect(resolution.ok && resolution.registration.divisionId).toBe('open');
  });

  it('reports every unanswered axis at once', () => {
    // So a form can mark all of them, rather than making somebody answer one question
    // to discover there are four more. Proposed with the same nothing it is resolved
    // with, which is what a freshly opened form holds -- and with no sex answered the
    // weight-class ladder is not chosen either, so this is the full set of five.
    const resolution = resolveRegistration(proposalFor({ tested: null, ageClass: null }, {}), {});
    expect(resolution).toEqual({
      ok: false,
      missing: ['sex', 'equipment', 'weight-class', 'division', 'tested'],
    });
  });

  it('refuses to produce a query out of four fifths of an answer', () => {
    const resolution = resolveRegistration(proposalFor(), { sex: 'male' });
    expect(resolution.ok).toBe(false);
  });
});
