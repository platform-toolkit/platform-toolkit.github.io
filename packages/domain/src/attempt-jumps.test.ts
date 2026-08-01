import { describe, expect, it } from 'vitest';

import {
  RESEARCH_BASIS_NOTE,
  reviewJumps,
  type JumpAdvisoryCode,
  type JumpPopulation,
  type JumpSequence,
} from './attempt-jumps.js';

/**
 * A 100 kg planning maximum throughout, so a kilogram is a percentage point and
 * every threshold below can be read off the requirement it comes from. Not a
 * federation figure -- it is a number a lifter says about themselves -- so §5.1's
 * invented-fixture rule is satisfied by the maximum being arbitrary.
 */
const MAXIMUM = 100;

/** Squat at 90 / 96 / 100: a 6% then 4% ladder, inside both §9.2 anchors. */
const ORDINARY: JumpSequence = {
  lift: 'squat',
  meetDayMaximumKilograms: MAXIMUM,
  openerKilograms: 90,
  secondKilograms: 96,
  thirdKilograms: 100,
};

const MALE_RAW: JumpPopulation = {
  comparison: 'male',
  equipment: 'raw',
  ruleset: 'research-population',
};

function codes(
  sequence: Partial<JumpSequence>,
  population: JumpPopulation = MALE_RAW,
): readonly JumpAdvisoryCode[] {
  return reviewJumps({ ...ORDINARY, ...sequence }, population).map((advisory) => advisory.code);
}

describe('reviewJumps', () => {
  it('says nothing about an ordinary ladder', () => {
    // The common case, and the one that must stay silent: a screen that
    // reassures on every plan trains a lifter to skip the section entirely.
    expect(reviewJumps(ORDINARY, MALE_RAW)).toStrictEqual([]);
  });

  it('flags a first-to-second wider than lifters commonly take', () => {
    expect(codes({ secondKilograms: 99, thirdKilograms: 102 })).toContain(
      'first-to-second-wider-than-usual',
    );
  });

  it('flags a jump so narrow it spends an attempt on almost nothing', () => {
    // Not a safety problem, which is why it is a note. It is still worth saying:
    // a 1 kg second attempt costs a lifter one of the three chances they get.
    expect(codes({ secondKilograms: 91, thirdKilograms: 95 })).toContain(
      'first-to-second-narrower-than-usual',
    );
  });

  it('accepts a wide first-to-second when the opener was deliberately cautious', () => {
    // §9.2 says so directly: a lower opener may reasonably create a larger
    // first-to-second percentage. Banking the total early and then catching up is
    // a choice, and warning about its consequence would train a lifter to dismiss
    // the warnings that matter.
    expect(codes({ openerKilograms: 84, secondKilograms: 93, thirdKilograms: 97 })).not.toContain(
      'first-to-second-wider-than-usual',
    );
  });

  it('still flags a wide second-to-third after a cautious opener', () => {
    // The exemption is about the first gap only. A cautious opener explains
    // catching up once; it does not explain a wide third as well.
    expect(codes({ openerKilograms: 84, secondKilograms: 93, thirdKilograms: 101 })).toContain(
      'second-to-third-wider-than-usual',
    );
  });

  it('flags a male squat second-to-third above the research figure', () => {
    // 13 kg, above the 12.5 kg the requirements give for this group and lift.
    expect(codes({ secondKilograms: 92, thirdKilograms: 105 })).toContain(
      'second-to-third-above-research-range',
    );
  });

  it('leaves a jump exactly at the research figure alone', () => {
    // The threshold is the coarse end of a stated range and the comparison is
    // strictly greater, so 12.5 kg -- five of the smallest plate, the most common
    // jump anybody makes -- does not fire a warning inside a range the research
    // itself calls ordinary.
    expect(codes({ secondKilograms: 92, thirdKilograms: 104.5 })).not.toContain(
      'second-to-third-above-research-range',
    );
  });

  it('warns harder about a female bench third approaching ten kilograms', () => {
    const female: JumpPopulation = { ...MALE_RAW, comparison: 'female' };
    const gentle = reviewJumps(
      { ...ORDINARY, lift: 'bench', secondKilograms: 93, thirdKilograms: 100 },
      female,
    );
    const severe = reviewJumps(
      { ...ORDINARY, lift: 'bench', secondKilograms: 88, thirdKilograms: 100 },
      female,
    );
    expect(gentle.find((a) => a.code === 'second-to-third-above-research-range')?.severity).toBe(
      'note',
    );
    expect(severe.find((a) => a.code === 'second-to-third-above-research-range')?.severity).toBe(
      'strong',
    );
  });

  it('states no first-to-second figure for the female bench, rather than inventing one', () => {
    // The requirements say only that smaller legal jumps are favoured there. An
    // interpolated threshold would be exactly the false precision §9.3 forbids,
    // and it would be indistinguishable on screen from a researched one.
    const female: JumpPopulation = { ...MALE_RAW, comparison: 'female' };
    expect(
      codes(
        { lift: 'bench', openerKilograms: 84, secondKilograms: 95, thirdKilograms: 98 },
        female,
      ),
    ).not.toContain('first-to-second-above-research-range');
  });

  it('reads the male deadlift first-to-second range as generous', () => {
    // 5 to 20 kg was the common band, so 18 kg is unremarkable and 22 kg is not.
    // A threshold copied from the squat row would flag both.
    expect(
      codes({ lift: 'deadlift', openerKilograms: 80, secondKilograms: 98, thirdKilograms: 102 }),
    ).not.toContain('first-to-second-above-research-range');
    expect(
      codes({ lift: 'deadlift', openerKilograms: 80, secondKilograms: 102, thirdKilograms: 106 }),
    ).toContain('first-to-second-above-research-range');
  });

  it('gives general guidance and no population figures when the comparison is declined', () => {
    // §8.2: declining must still produce a usable tool. The relative anchors are
    // what it produces.
    const declined: JumpPopulation = { ...MALE_RAW, comparison: 'none' };
    const found = codes({ secondKilograms: 92, thirdKilograms: 105 }, declined);
    expect(found).toContain('second-to-third-wider-than-usual');
    expect(found).not.toContain('second-to-third-above-research-range');
  });

  it('labels advice as population-matched only when the lifter matches the population', () => {
    const matched = reviewJumps({ ...ORDINARY, thirdKilograms: 103 }, MALE_RAW);
    expect(matched.every((advisory) => advisory.evidence === 'population-matched')).toBe(true);
  });

  it('lowers the evidence label for an equipped lifter rather than withholding the advice', () => {
    // §9.3 asks for a lower-evidence label, not silence. Withholding would leave
    // the screen with nothing to say about a plan that still has a wide jump in it.
    const equipped = reviewJumps(
      { ...ORDINARY, secondKilograms: 92, thirdKilograms: 105 },
      { ...MALE_RAW, equipment: 'equipped' },
    );
    expect(equipped.length).toBeGreaterThan(0);
    expect(equipped.every((advisory) => advisory.evidence === 'general')).toBe(true);
  });

  it('lowers the evidence label under rules the research was not gathered under', () => {
    const other = reviewJumps(
      { ...ORDINARY, secondKilograms: 92, thirdKilograms: 105 },
      { ...MALE_RAW, ruleset: 'other' },
    );
    expect(other.every((advisory) => advisory.evidence === 'general')).toBe(true);
  });

  it('says nothing at all when there is no usable planning maximum', () => {
    expect(reviewJumps({ ...ORDINARY, meetDayMaximumKilograms: 0 }, MALE_RAW)).toStrictEqual([]);
  });

  it('never phrases an advisory as a probability or a prohibition', () => {
    // §10.2 forbids the language of probability, and these are guardrails rather
    // than verdicts. Asserted on the rendered sentences rather than trusted to
    // review, the same way tool 3 pins its forbidden phrases.
    const everything = [
      ...reviewJumps({ ...ORDINARY, secondKilograms: 99, thirdKilograms: 112 }, MALE_RAW),
      ...reviewJumps({ ...ORDINARY, secondKilograms: 91, thirdKilograms: 92 }, MALE_RAW),
    ];
    expect(everything.length).toBeGreaterThan(0);
    for (const advisory of everything) {
      for (const forbidden of [
        'probability',
        'chance',
        'likely',
        'guarantee',
        'not allowed',
        '% chance',
      ]) {
        expect(advisory.message.toLowerCase()).not.toContain(forbidden);
      }
    }
  });

  it('carries the caveat as one constant rather than repeating it into each message', () => {
    // A caveat copied into every message is a caveat that gets dropped from one
    // of them, and the one it is dropped from is the one somebody acts on.
    expect(RESEARCH_BASIS_NOTE).toContain('may not fit');
    for (const advisory of reviewJumps({ ...ORDINARY, thirdKilograms: 110 }, MALE_RAW)) {
      expect(advisory.message).not.toContain('may not fit');
    }
  });

  it('reports every gap that is worth mentioning, not the first', () => {
    const found = codes({ openerKilograms: 90, secondKilograms: 107, thirdKilograms: 121 });
    expect(found).toContain('first-to-second-wider-than-usual');
    expect(found).toContain('second-to-third-wider-than-usual');
    expect(found).toContain('first-to-second-above-research-range');
    expect(found).toContain('second-to-third-above-research-range');
  });
});
