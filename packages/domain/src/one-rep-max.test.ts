// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The ensemble, the refusals, and the grade.
 *
 * Most of what could go wrong here is not an arithmetic slip -- it is the engine
 * quietly producing a number in a situation where the honest answer is that
 * there isn't one. So the assertions cluster around the edges: a single that no
 * equation may overrule, an assisted set, a set too long to say anything about,
 * and the ordering guarantees that stop the three figures crossing over at a
 * rounding boundary.
 *
 * The property-style loops at the end are deliberate. The ordering and
 * monotonicity claims are made for every input the tool accepts, not for the
 * three examples that were convenient, and the only way to write that down is to
 * walk the range.
 */
import { describe, expect, it } from 'vitest';

import {
  ONE_REP_MAX_METHODOLOGY_VERSION,
  ROUNDING_INCREMENTS,
  defaultRoundingIncrement,
  estimateOneRepMax,
  type EstimatedMax,
  type OneRepMaxAdvisoryCode,
  type OneRepMaxEstimate,
  type OneRepMaxRequest,
  type RepsInReserve,
} from './one-rep-max.js';
import { ESTIMATE_LIFTS, type EstimateLift } from './one-rep-max-formulas.js';
import { defaultTechniqueFor } from './one-rep-max-technique.js';

function request(overrides: Partial<OneRepMaxRequest> = {}): OneRepMaxRequest {
  const lift = overrides.lift ?? 'bench-press';
  const displayUnit = overrides.displayUnit ?? 'kg';
  return {
    weight: { amount: 100, unit: 'kg' },
    completedReps: 5,
    repsInReserve: 0,
    lift,
    techniqueId: defaultTechniqueFor(lift)?.id ?? null,
    sex: null,
    experience: null,
    freshness: 'fresh',
    formQuality: 'consistent',
    assisted: false,
    displayUnit,
    roundTo: defaultRoundingIncrement(displayUnit),
    ...overrides,
  };
}

function estimate(overrides: Partial<OneRepMaxRequest> = {}): OneRepMaxEstimate {
  const result = estimateOneRepMax(request(overrides));
  if (!result.ok) {
    throw new Error(`Rejected: ${result.problems.map((problem) => problem.code).join(', ')}`);
  }
  return result.estimate;
}

function estimated(overrides: Partial<OneRepMaxRequest> = {}): EstimatedMax {
  const value = estimate(overrides);
  if (value.kind !== 'estimated') throw new Error(`Expected an estimate, got ${value.kind}.`);
  return value;
}

function problems(overrides: Partial<OneRepMaxRequest>): string[] {
  const result = estimateOneRepMax(request(overrides));
  if (result.ok) throw new Error('Expected the request to be rejected.');
  return result.problems.map((problem) => problem.code);
}

function advisories(value: OneRepMaxEstimate): OneRepMaxAdvisoryCode[] {
  return value.advisories.map((advisory) => advisory.code);
}

function included(value: OneRepMaxEstimate): string[] {
  return value.outcomes.filter((outcome) => outcome.included).map((outcome) => outcome.formula.id);
}

describe('validation', () => {
  it('reports every problem at once rather than one per submission', () => {
    // §5.5. A form that reveals one fault at a time makes a lifter guess at the
    // rest, and the guessing is done on a phone between sets.
    expect(problems({ weight: { amount: -5, unit: 'kg' }, completedReps: 40 })).toEqual([
      'weight-not-positive',
      'reps-above-range',
    ]);
  });

  it('rejects a weight that is not a number at all', () => {
    expect(problems({ weight: { amount: Number.NaN, unit: 'kg' } })).toEqual(['weight-not-finite']);
    expect(problems({ weight: { amount: Number.POSITIVE_INFINITY, unit: 'kg' } })).toEqual([
      'weight-not-finite',
    ]);
  });

  it('rejects a fractional repetition count', () => {
    expect(problems({ completedReps: 4.5 })).toEqual(['reps-not-whole']);
  });

  it('rejects a repetition count outside the range a set can report', () => {
    expect(problems({ completedReps: 0 })).toEqual(['reps-below-range']);
    expect(problems({ completedReps: 21 })).toEqual(['reps-above-range']);
    expect(estimate({ completedReps: 20, repsInReserve: 0 }).kind).not.toBe('withheld');
  });

  it('rejects a technique that belongs to a different lift', () => {
    // A stored `touch-and-go` arriving against a squat is a wiring fault. Read
    // as "no technique stated" it would quietly downgrade an ordinary set and
    // nothing on screen would say why.
    expect(problems({ lift: 'squat', techniqueId: 'touch-and-go' })).toEqual(['technique-unknown']);
    expect(problems({ lift: 'bench-press', techniqueId: 'nonsense' })).toEqual([
      'technique-unknown',
    ]);
  });

  it('accepts no technique at all, on any lift', () => {
    // Every lift offers choices, including `other`, but none of them is
    // mandatory: a lifter who skipped the question has answered `null` and that
    // is a sincere answer, not a fault. It costs the technique advisory and
    // nothing else.
    expect(estimate({ lift: 'other', techniqueId: null }).kind).toBe('estimated');
    expect(estimate({ lift: 'squat', techniqueId: null }).kind).toBe('estimated');
  });

  it('rejects a rounding step that cannot round anything', () => {
    // A zero or negative step is a wiring fault rather than a lifter's answer,
    // so it throws where the rest of the input reports a problem code. Nothing
    // on a form can produce it, and returning a problem would put a case in
    // every caller's error rendering that no lifter can ever reach.
    expect(() => estimate({ roundTo: 0 })).toThrow(RangeError);
    expect(() => estimate({ roundTo: -1 })).toThrow(RangeError);
  });
});

describe('a single that was actually performed', () => {
  it('answers with the weight lifted and lets no equation overrule it', () => {
    const value = estimate({
      completedReps: 1,
      repsInReserve: 0,
      weight: { amount: 142.5, unit: 'kg' },
    });
    if (value.kind !== 'observed-single') throw new Error(`Got ${value.kind}.`);

    expect(value.observed).toEqual({ amount: 142.5, unit: 'kg' });
    // Mayhew returns nine percent over the load at one repetition. A tool that
    // let that through would tell somebody who just missed a second attempt
    // that they had in fact lifted more than they lifted.
    expect(included(value)).toEqual([]);
  });

  it('still shows what each equation would have said, marked as not counted', () => {
    const value = estimate({ completedReps: 1, repsInReserve: 0 });
    const rows = value.outcomes.filter((outcome) => outcome.estimate !== null);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.reasonCode, row.formula.id).toBe('single-observed');
      // No influence on an excluded row, so nothing downstream can read a weight
      // off it and put it back into an average.
      expect(row.influence, row.formula.id).toBeNull();
    }
  });

  it('treats an unstated reserve on a single as a single', () => {
    // Unknown reserve is assumed to be zero, so one repetition with no reserve
    // stated is a single that happened.
    expect(estimate({ completedReps: 1, repsInReserve: 'unknown' }).kind).toBe('observed-single');
  });

  it('treats one repetition with a repetition in reserve as an estimate', () => {
    // A lifter who could have done another did not perform a maximum single.
    const value = estimate({ completedReps: 1, repsInReserve: 1 });
    expect(value.kind).toBe('estimated');
    expect(value.effectiveReps).toBe(2);
  });
});

describe('refusals', () => {
  it('withholds everything for an assisted set, including the formula table', () => {
    const value = estimate({ assisted: true });
    if (value.kind !== 'withheld') throw new Error(`Got ${value.kind}.`);

    expect(value.reason).toBe('assisted');
    // The one refusal with nothing to show. Every other one still renders the
    // table, because seeing what the equations said and why none of it counted
    // is the explanation -- an assisted set has no honest input to feed them.
    expect(value.outcomes).toEqual([]);
  });

  it('withholds an estimate when the reserve pushes the set past the supported range', () => {
    const value = estimate({ completedReps: 19, repsInReserve: 3 });
    if (value.kind !== 'withheld') throw new Error(`Got ${value.kind}.`);

    expect(value.reason).toBe('effective-reps-too-high');
    expect(value.effectiveReps).toBe(22);
    // Nineteen completed is a sincere answer and is not rejected as input; it
    // is the *effective* count that cannot be turned into a maximum. Conflating
    // the two tells an honest answer it was wrong.
    expect(estimateOneRepMax(request({ completedReps: 19, repsInReserve: 3 })).ok).toBe(true);
  });

  it('still shows the equations for a set past the range, all excluded', () => {
    const value = estimate({ completedReps: 18, repsInReserve: 3 });
    const shown = value.outcomes.filter((outcome) => outcome.estimate !== null);
    expect(shown.length).toBeGreaterThan(0);
    expect(included(value)).toEqual([]);
    expect(shown.every((row) => row.reasonCode === 'outside-supported-range')).toBe(true);
  });
});

describe('the ensemble', () => {
  it('counts the core seven and nothing else by default', () => {
    expect(included(estimated())).toEqual([
      'epley',
      'brzycki',
      'lander',
      'lombardi',
      'mayhew',
      'oconner',
      'wathan',
    ]);
  });

  it('never lets one relationship vote twice', () => {
    // The guarantee, stated as an invariant rather than as a count: whatever the
    // input, the included set holds at most one formula per family. Epley,
    // Baechle/Welday and Berger-linear are one relationship under three names.
    for (const lift of ESTIMATE_LIFTS) {
      for (const sex of ['man', 'woman', null] as const) {
        for (let reps = 2; reps <= 20; reps += 1) {
          const value = estimateOneRepMax(
            request({
              lift,
              sex,
              completedReps: reps,
              techniqueId: defaultTechniqueFor(lift)?.id ?? null,
            }),
          );
          if (!value.ok || value.estimate.kind !== 'estimated') continue;
          const families = value.estimate.outcomes
            .filter((outcome) => outcome.included)
            .map((outcome) => outcome.formula.family);
          expect(new Set(families).size, `${lift}/${String(sex)}/${String(reps)}`).toBe(
            families.length,
          );
        }
      }
    }
  });

  it('drops Brzycki from the consensus past ten repetitions but keeps the rest', () => {
    const value = estimated({ completedReps: 12 });
    expect(included(value)).not.toContain('brzycki');
    expect(included(value)).toContain('epley');

    const row = value.outcomes.find((outcome) => outcome.formula.id === 'brzycki');
    // The row is still there and says what happened. A silently missing row
    // reads as a bug in the table.
    expect(row?.reasonCode).toBe('declined');
    expect(row?.estimate).toBeNull();
  });

  it('shows the expanded and experimental equations without letting them count', () => {
    const value = estimated();
    const byId = new Map(value.outcomes.map((outcome) => [outcome.formula.id, outcome]));

    expect(byId.get('adams')?.reasonCode).toBe('expanded-tier');
    expect(byId.get('adams')?.included).toBe(false);
    expect(byId.get('adams')?.estimate).not.toBeNull();

    expect(byId.get('abadie')?.reasonCode).toBe('conditional-tier');
    expect(byId.get('weight-dependent-2026')?.reasonCode).toBe('experimental-tier');
    expect(byId.get('weight-dependent-2026')?.included).toBe(false);
  });

  it('excludes an equation that returns less than the weight already lifted', () => {
    // Physically impossible rather than merely low, and the reason says which.
    const value = estimated({
      weight: { amount: 10, unit: 'kg' },
      completedReps: 2,
      lift: 'overhead-press',
    });
    const row = value.outcomes.find((outcome) => outcome.formula.id === 'cummings-finn');
    expect(row?.reasonCode).toBe('below-entered-weight');
    expect(row?.included).toBe(false);
  });

  it('records the methodology version on every result', () => {
    // §14. A stored estimate with no version is a number nobody can reproduce
    // once the weighting changes.
    expect(estimated().methodologyVersion).toBe(ONE_REP_MAX_METHODOLOGY_VERSION);
    expect(estimate({ assisted: true }).methodologyVersion).toBe(ONE_REP_MAX_METHODOLOGY_VERSION);
  });
});

describe('evidence weighting', () => {
  it('counts Lombardi double for a man benching or squatting, and nowhere else', () => {
    const influence = (overrides: Partial<OneRepMaxRequest>, id: string): number | null =>
      estimated(overrides).outcomes.find((outcome) => outcome.formula.id === id)?.influence ?? null;

    expect(influence({ sex: 'man', lift: 'bench-press' }, 'lombardi')).toBe(2);
    expect(influence({ sex: 'man', lift: 'squat' }, 'lombardi')).toBe(2);
    // The deadlift evidence does not distinguish, so nothing may pretend it does.
    expect(influence({ sex: 'man', lift: 'deadlift' }, 'lombardi')).toBe(1);
    expect(influence({ sex: null, lift: 'bench-press' }, 'lombardi')).toBe(1);
  });

  it('lets Brown into the consensus only where a study supports it', () => {
    // The single exception to "expanded formulas are shown, not counted". It is
    // not a better equation in general; there is published support for it in one
    // population and two lifts, and it votes exactly there.
    const supported = estimated({ sex: 'woman', lift: 'squat' });
    expect(included(supported)).toContain('brown');
    expect(supported.outcomes.find((outcome) => outcome.formula.id === 'brown')?.influence).toBe(2);

    for (const overrides of [
      { sex: 'woman', lift: 'deadlift' },
      { sex: 'man', lift: 'squat' },
      { sex: null, lift: 'bench-press' },
    ] as const) {
      const value = estimated(overrides);
      expect(included(value), JSON.stringify(overrides)).not.toContain('brown');
      expect(value.outcomes.find((outcome) => outcome.formula.id === 'brown')?.reasonCode).toBe(
        'expanded-tier',
      );
    }
  });

  it('costs nothing but the weighting to decline to state sex', () => {
    const declined = estimated({ sex: null, lift: 'bench-press' });
    expect(declined.kind).toBe('estimated');
    expect(
      declined.outcomes.filter((outcome) => outcome.included).every((o) => o.influence === 1),
    ).toBe(true);
    expect(advisories(declined)).toContain('sex-weighting-declined');
  });

  it('moves the middle figure toward the formulas the evidence supports', () => {
    // The point of weighting: it has to actually do something, or it is a field
    // nobody can verify. Brzycki and Lander are the conservative pair, so a
    // woman's squat should land at or below the unweighted answer.
    const neutral = estimated({ sex: null, lift: 'squat', completedReps: 5 });
    const weighted = estimated({ sex: 'woman', lift: 'squat', completedReps: 5 });
    expect(weighted.unrounded.toolkit.amount).toBeLessThan(neutral.unrounded.toolkit.amount);
  });
});

describe('the three figures', () => {
  it('orders them, before and after rounding', () => {
    const value = estimated({ completedReps: 8 });
    expect(value.unrounded.conservative.amount).toBeLessThanOrEqual(value.unrounded.toolkit.amount);
    expect(value.unrounded.toolkit.amount).toBeLessThanOrEqual(value.unrounded.optimistic.amount);
    expect(value.conservative.amount).toBeLessThanOrEqual(value.toolkit.amount);
    expect(value.toolkit.amount).toBeLessThanOrEqual(value.optimistic.amount);
  });

  it('rounds in three directions so the guarantees hold by construction', () => {
    const value = estimated({ completedReps: 7 });
    const step = defaultRoundingIncrement('kg');
    expect(value.conservative.amount).toBe(
      Math.floor(value.unrounded.conservative.amount / step) * step,
    );
    expect(value.optimistic.amount).toBe(
      Math.ceil(value.unrounded.optimistic.amount / step) * step,
    );
    // §10, stated directly: rounding may never push the conservative figure past
    // the unrounded middle one.
    expect(value.conservative.amount).toBeLessThanOrEqual(value.unrounded.toolkit.amount);
  });

  it('rounds to the step the caller asked for, in every unit and at every offered step', () => {
    // The step is the lifter's bar, not the arithmetic's: half a kilogram is a
    // real jump on a microloaded bar and noise on one loaded in 2.5 kg plates.
    // Whichever they pick, the three figures have to land *on* it -- a headline
    // figure of 142.5 beside a 2.5 kg step is a weight that cannot be loaded.
    for (const [unit, steps] of Object.entries(ROUNDING_INCREMENTS)) {
      for (const step of steps) {
        const value = estimated({
          displayUnit: unit === 'kg' ? 'kg' : 'lb',
          roundTo: step,
          completedReps: 6,
        });
        const where = `${unit}/${String(step)}`;
        for (const figure of [value.conservative, value.toolkit, value.optimistic]) {
          expect(figure.amount / step, `${where}/${String(figure.amount)}`).toBe(
            Math.round(figure.amount / step),
          );
        }
        // The §10 guarantee has to survive the coarsest step, which is where a
        // downward round travels furthest and is most likely to cross something.
        expect(value.conservative.amount, where).toBeLessThanOrEqual(
          value.unrounded.toolkit.amount,
        );
        expect(value.conservative.amount, where).toBeLessThanOrEqual(value.toolkit.amount);
        expect(value.toolkit.amount, where).toBeLessThanOrEqual(value.optimistic.amount);
      }
    }
  });

  it('holds the ordering across every input the tool accepts', () => {
    // Not three convenient examples. Three nearby values all rounded to nearest
    // is exactly how two of them land on the same number and the third crosses
    // over, and it happens at boundaries no hand-picked case visits.
    for (const lift of ESTIMATE_LIFTS) {
      for (const unit of ['kg', 'lb'] as const) {
        for (let reps = 2; reps <= 20; reps += 1) {
          for (const amount of [42.5, 100, 137.5, 315, 402.5]) {
            const result = estimateOneRepMax(
              request({
                lift,
                completedReps: reps,
                displayUnit: unit,
                weight: { amount, unit },
                techniqueId: defaultTechniqueFor(lift)?.id ?? null,
              }),
            );
            if (!result.ok || result.estimate.kind !== 'estimated') continue;
            const value = result.estimate;
            const where = `${lift}/${String(reps)}/${String(amount)}${unit}`;
            expect(value.conservative.amount, where).toBeLessThanOrEqual(value.toolkit.amount);
            expect(value.toolkit.amount, where).toBeLessThanOrEqual(value.optimistic.amount);
            expect(value.conservative.amount, where).toBeLessThanOrEqual(
              value.unrounded.toolkit.amount,
            );
            // No estimate may fall below the load the lifter actually moved.
            expect(value.conservative.amount, where).toBeGreaterThanOrEqual(Math.floor(amount));
          }
        }
      }
    }
  });

  it('reports the three figures in the unit asked for', () => {
    const metric = estimated({ weight: { amount: 100, unit: 'kg' }, displayUnit: 'kg' });
    const imperial = estimated({ weight: { amount: 100, unit: 'kg' }, displayUnit: 'lb' });

    expect(metric.toolkit.unit).toBe('kg');
    expect(imperial.toolkit.unit).toBe('lb');
    // The same set, so the same answer -- expressed differently, and rounded in
    // the unit it is shown in rather than converted after rounding.
    expect(imperial.unrounded.toolkit.amount).toBeCloseTo(
      metric.unrounded.toolkit.amount / 0.45359237,
      6,
    );
  });

  it('rises with repetitions at a fixed load', () => {
    let previous = 0;
    for (let reps = 2; reps <= 10; reps += 1) {
      const value = estimated({ completedReps: reps });
      expect(value.unrounded.toolkit.amount, `at ${String(reps)}`).toBeGreaterThan(previous);
      previous = value.unrounded.toolkit.amount;
    }
  });

  it('says so when the equations disagree widely, without calling it a probability', () => {
    // Never a confidence interval. The spread measures how much the published
    // models differ from one another, which is a fact about the literature and
    // not about this lifter.
    // Two repetitions is where the core seven are closest -- an interquartile
    // spread of about two and a half percent. Three is already 3.6% and earns
    // neither band, which is the point of having two thresholds with a gap
    // between them rather than one line every set falls on one side of.
    const tight = estimated({ completedReps: 2 });
    expect(advisories(tight)).not.toContain('estimates-disagree');
    expect(advisories(tight)).toContain('estimates-agree');

    const neither = estimated({ completedReps: 3 });
    expect(advisories(neither)).not.toContain('estimates-agree');
    expect(advisories(neither)).not.toContain('estimates-disagree');

    const wide = estimated({ completedReps: 15 });
    expect(wide.disagreement.interquartileRatio).toBeGreaterThan(
      tight.disagreement.interquartileRatio,
    );
    expect(advisories(wide)).toContain('estimates-disagree');
    expect(advisories(wide)).not.toContain('estimates-agree');
  });

  it('reports the five disagreement figures §8.4 asks for, all in the display unit', () => {
    const value = estimated({ completedReps: 8, displayUnit: 'lb', roundTo: 5 });
    const spread = value.disagreement;

    expect(spread.lowest.amount).toBeLessThan(spread.highest.amount);
    expect(spread.spread.amount).toBeCloseTo(spread.highest.amount - spread.lowest.amount, 9);
    expect(spread.fullRatio).toBeCloseTo(spread.spread.amount / value.unrounded.toolkit.amount, 9);
    expect(spread.interquartileSpread.amount).toBeCloseTo(
      value.unrounded.optimistic.amount - value.unrounded.conservative.amount,
      9,
    );
    expect(spread.interquartileRatio).toBeCloseTo(
      spread.interquartileSpread.amount / value.unrounded.toolkit.amount,
      9,
    );
    for (const figure of [spread.lowest, spread.highest, spread.spread, spread.interquartileSpread])
      expect(figure.unit).toBe('lb');
  });

  it('measures the whole cluster and the middle half separately', () => {
    // The grade is computed from the interquartile ratio, not the full one, and
    // the two are not interchangeable: one equation a long way out widens the
    // full range without moving the quartiles, and grading on the full range
    // would let it cost a well-described set a level it earned.
    const value = estimated({ completedReps: 10 });
    expect(value.disagreement.interquartileSpread.amount).toBeLessThan(
      value.disagreement.spread.amount,
    );
    expect(value.disagreement.interquartileRatio).toBeLessThan(value.disagreement.fullRatio);
  });
});

describe('the grade', () => {
  it('starts from the repetition count', () => {
    expect(estimated({ completedReps: 3 }).grade).toBe('strong');
    expect(estimated({ completedReps: 7 }).grade).toBe('useful');
    expect(estimated({ completedReps: 10 }).grade).toBe('rough');
    expect(estimated({ completedReps: 14 }).grade).toBe('endurance-dominated');
  });

  it('lowers the grade one level for each thing that makes the set harder to read', () => {
    // Each of these on its own is cancelled by the upgrade the rest of the set
    // has earned (§8.3 grants exactly one improvement), so the count is what is
    // measured here: two concerns cost a level, three cost two.
    const two = estimated({ completedReps: 3, freshness: 'fatigued', formQuality: 'degraded' });
    expect(two.grade).toBe('useful');

    const three = estimated({
      completedReps: 3,
      freshness: 'fatigued',
      formQuality: 'degraded',
      techniqueId: 'touch-and-go',
    });
    expect(three.grade).toBe('rough');
  });

  it('grants at most one upgrade however many good answers there are', () => {
    // §8.3: "the grade may improve by one level". A fresh set at zero reps in
    // reserve with competition technique and tight formula agreement has four
    // reasons to be upgraded and gets one, which is why a set with two concerns
    // still loses a level. Written down because the obvious implementation --
    // counting upgrades against downgrades -- makes a well-described set immune
    // to criticism, and nothing on screen would say so.
    const spotless = estimated({ completedReps: 3, sex: 'man', experience: 'experienced' });
    const raising = spotless.advisories.filter(
      (advisory) => advisory.effect === 'raises-confidence',
    );
    expect(raising.length).toBeGreaterThan(1);

    // One concern is absorbed; the second is not.
    expect(estimated({ completedReps: 3, sex: 'man', freshness: 'fatigued' }).grade).toBe('strong');
    expect(
      estimated({
        completedReps: 3,
        sex: 'man',
        freshness: 'fatigued',
        formQuality: 'degraded',
      }).grade,
    ).toBe('useful');
  });

  it('counts training experience against the input rather than against the number', () => {
    // §8.3 lists "new to the movement or to maximal effort" as a downgrade, and
    // the requirements are explicit that experience must not move the estimate:
    // there is no defensible coefficient for inexperience. So the three answers
    // produce one arithmetic result and three grades.
    const base = { completedReps: 3, freshness: 'fatigued' } as const;
    const novice = estimated({ ...base, experience: 'new' });
    const middling = estimated({ ...base, experience: 'intermediate' });
    const veteran = estimated({ ...base, experience: 'experienced' });

    expect(novice.unrounded.toolkit.amount).toBe(middling.unrounded.toolkit.amount);
    expect(veteran.unrounded.toolkit.amount).toBe(middling.unrounded.toolkit.amount);

    // Fatigue plus inexperience is two concerns against one upgrade.
    expect(advisories(novice)).toContain('new-to-maximal-effort');
    expect(novice.grade).toBe('useful');
    expect(middling.grade).toBe('strong');
    expect(advisories(veteran)).toContain('experienced-with-singles');
    expect(veteran.grade).toBe('strong');
  });

  it('treats a moderate reserve as a concern and a low one as support', () => {
    // Two or three in reserve is a downgrade even though the arithmetic accepts
    // it cleanly: the addition is a heuristic, and a lifter reporting three left
    // is describing a feeling that is worth less the further from failure it was.
    const low = estimated({ completedReps: 3, repsInReserve: 1 });
    expect(advisories(low)).toContain('reps-in-reserve-low');

    const moderate = estimated({ completedReps: 3, repsInReserve: 2, freshness: 'fatigued' });
    expect(advisories(moderate)).toContain('reps-in-reserve-moderate');
    expect(moderate.grade).toBe('useful');
  });

  it('never lets an upgrade beat the repetition count', () => {
    // Five well-described repetitions and fifteen well-described repetitions are
    // not the same evidence, and no amount of care about technique makes a set
    // of fifteen a strong basis for a maximum.
    const careful = estimated({ completedReps: 12, sex: 'man', lift: 'squat' });
    expect(careful.grade).toBe('endurance-dominated');
    expect(advisories(careful)).toContain('repetitions-high');
  });

  it('caps an unvalidated lift below strong however carefully it is described', () => {
    for (const lift of ['overhead-press', 'other'] as const) {
      const value = estimated({
        lift,
        completedReps: 3,
        sex: 'man',
        techniqueId: defaultTechniqueFor(lift)?.id ?? null,
      });
      expect(value.grade, lift).toBe('useful');
      expect(advisories(value), lift).toContain('lift-not-validated');
    }
  });

  it('says a push press cannot stand in for a strict press', () => {
    const value = estimated({
      lift: 'overhead-press',
      techniqueId: 'push-press',
      completedReps: 3,
    });
    expect(value.technique?.match).toBe('differs');
    expect(value.technique?.note).toContain('cannot reliably estimate a strict-press maximum');
    expect(advisories(value)).toContain('technique-differs');
  });

  it('never produces a grade outside the four it defines', () => {
    const seen = new Set<string>();
    for (const lift of ESTIMATE_LIFTS) {
      for (const reserve of [0, 1, 2, 3, 'four-or-more', 'unknown'] satisfies RepsInReserve[]) {
        for (let reps = 2; reps <= 16; reps += 1) {
          const result = estimateOneRepMax(
            request({
              lift,
              completedReps: reps,
              repsInReserve: reserve,
              techniqueId: defaultTechniqueFor(lift)?.id ?? null,
            }),
          );
          if (!result.ok || result.estimate.kind !== 'estimated') continue;
          seen.add(result.estimate.grade);
        }
      }
    }
    expect([...seen].sort()).toEqual(['endurance-dominated', 'rough', 'strong', 'useful']);
  });
});

describe('repetitions in reserve', () => {
  it('adds a stated reserve to the completed count', () => {
    expect(estimated({ completedReps: 5, repsInReserve: 2 }).effectiveReps).toBe(7);
  });

  it('assumes nothing in reserve when it is unstated, and says so', () => {
    // The conservative direction: assuming reserve would inflate the estimate.
    const value = estimated({ completedReps: 5, repsInReserve: 'unknown' });
    expect(value.effectiveReps).toBe(5);
    expect(advisories(value)).toContain('reps-in-reserve-unknown');
  });

  it('takes the floor of the four-or-more bucket, and says the set was far from failure', () => {
    // Four rather than a guess at five or seven, because a floor cannot flatter
    // and a lifter who could have done four more has no better idea than that.
    const value = estimated({ completedReps: 5, repsInReserve: 'four-or-more' });
    expect(value.effectiveReps).toBe(9);
    expect(advisories(value)).toContain('far-from-failure');
  });
});

describe('what a later tool can read off the result', () => {
  it('carries everything needed to reproduce the estimate without reading the screen', () => {
    // §14. The meet-day planner consumes this object; anything it has to scrape
    // out of rendered text is a coupling that breaks on a wording change.
    const value = estimated({
      lift: 'squat',
      sex: 'woman',
      completedReps: 5,
      repsInReserve: 1,
      weight: { amount: 315, unit: 'lb' },
      displayUnit: 'lb',
    });

    expect(value.methodologyVersion).toBe(ONE_REP_MAX_METHODOLOGY_VERSION);
    expect(value.lift).toBe('squat');
    expect(value.entered).toEqual({ amount: 315, unit: 'lb' });
    expect(value.displayUnit).toBe('lb');
    expect(value.completedReps).toBe(5);
    expect(value.repsInReserve).toBe(1);
    expect(value.effectiveReps).toBe(6);
    expect(value.technique?.id).toBe('competition-squat');
    expect(value.familyCount).toBeGreaterThanOrEqual(3);
    expect(value.outcomes.length).toBeGreaterThan(10);
    expect(value.disagreement.fullRatio).toBeGreaterThan(0);
  });

  it('gives an influence to included rows and none to the rest', () => {
    for (const outcome of estimated().outcomes) {
      if (outcome.included) {
        expect(outcome.influence, outcome.formula.id).toBeGreaterThan(0);
      } else {
        expect(outcome.influence, outcome.formula.id).toBeNull();
      }
    }
  });

  it('shows each formula unrounded so the comparison view is not three identical rows', () => {
    // §9.2. Rounding the per-formula figures to whole units would collapse
    // several of them onto the same number and hide the disagreement the
    // section exists to show.
    const value = estimated({ completedReps: 6 });
    const rows = value.outcomes.filter((outcome) => outcome.estimate !== null);
    const fractional = rows.filter((outcome) => !Number.isInteger(outcome.estimate?.amount ?? 0));
    expect(fractional.length).toBeGreaterThan(rows.length / 2);
  });
});

describe('the lift catalogue', () => {
  it('produces an answer for every lift it offers', () => {
    for (const lift of ESTIMATE_LIFTS satisfies readonly EstimateLift[]) {
      const value = estimated({ lift, techniqueId: defaultTechniqueFor(lift)?.id ?? null });
      expect(value.kind, lift).toBe('estimated');
      expect(value.familyCount, lift).toBeGreaterThanOrEqual(3);
    }
  });
});
