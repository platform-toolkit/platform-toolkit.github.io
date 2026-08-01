/**
 * The equations, checked against arithmetic done by hand and against the
 * conditions each one declines under.
 *
 * The expected values here were computed from the published equations rather
 * than copied from another calculator, and they are written as the arithmetic
 * that produces them wherever that is readable -- `100 / 98.62877` says which
 * equation is being checked in a way that `1.0139` does not, and a transposed
 * coefficient shows up as a failing expression rather than as two numbers that
 * are both mysterious.
 */
import { describe, expect, it } from 'vitest';

import {
  ESTIMATE_LIFTS,
  FORMULAS,
  evaluateFormula,
  findFormula,
  formulasInTier,
  type EstimateLift,
  type FormulaDefinition,
  type FormulaId,
} from './one-rep-max-formulas.js';

function formula(id: FormulaId): FormulaDefinition {
  const found = findFormula(id);
  if (found === null) throw new Error(`No formula ${id}.`);
  return found;
}

function at(id: FormulaId, kilograms: number, reps: number, lift: EstimateLift = 'bench-press') {
  return evaluateFormula(formula(id), { kilograms, reps, lift });
}

describe('the formula library', () => {
  it('has no duplicate identifiers', () => {
    const ids = FORMULAS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every formula an equation and a citation to show beside it', () => {
    // §9.2 shows the equation and where it came from. A blank string renders as
    // a gap in the methodology table, which reads as a formula somebody made up.
    for (const entry of FORMULAS) {
      expect(entry.notation.length, entry.id).toBeGreaterThan(0);
      expect(entry.source.length, entry.id).toBeGreaterThan(0);
      expect(entry.notation, entry.id).toContain('1RM');
    }
  });

  it('finds nothing for an identifier this build does not carry', () => {
    // The identifiers reaching `findFormula` come from stored results and query
    // parameters, so the answer for an unknown one has to be an answer.
    expect(findFormula('not-a-formula')).toBeNull();
    expect(findFormula('')).toBeNull();
  });

  it('keeps exactly seven core formulas', () => {
    // The core set is what the consensus is built from, so its size is a fact
    // about the methodology rather than an implementation detail. Adding an
    // eighth is a methodology-version change and should fail here first.
    expect(formulasInTier('core').map((entry) => entry.id)).toEqual([
      'epley',
      'brzycki',
      'lander',
      'lombardi',
      'mayhew',
      'oconner',
      'wathan',
    ]);
  });

  it('groups the three equations that are one relationship into one family', () => {
    // Epley, Baechle/Welday and Berger-linear are `w × (1 + kr)` at k = 1/30,
    // 0.0333 and 0.03. Three names, one idea -- and three votes for it would
    // silently carry the median.
    const epleyFamily = FORMULAS.filter((entry) => entry.family === 'epley').map(
      (entry) => entry.id,
    );
    expect(epleyFamily).toEqual(['epley', 'baechle-welday', 'berger-linear']);

    // They also have to actually agree, or the grouping is hiding a real
    // difference rather than a duplicate. Two kilograms in a hundred and
    // seventeen: closer to each other than any of them is to the next-nearest
    // core formula, which is the property that makes counting all three a
    // duplicate vote rather than three opinions.
    const epley = at('epley', 100, 5);
    const baechle = at('baechle-welday', 100, 5);
    const berger = at('berger-linear', 100, 5);
    if (epley === null || baechle === null || berger === null) throw new Error('Declined.');
    expect(Math.abs(epley - baechle)).toBeLessThan(0.1);
    expect(Math.abs(epley - berger)).toBeLessThan(2);
  });
});

describe('the core seven', () => {
  it('reproduces Epley', () => {
    expect(at('epley', 100, 5)).toBeCloseTo(100 * (1 + 5 / 30), 9);
  });

  it('reproduces Brzycki, and returns the load itself at one repetition', () => {
    expect(at('brzycki', 100, 5)).toBeCloseTo((100 * 36) / 32, 9);
    // 36 / 36. The only core formula that is exactly right at a single, which is
    // worth pinning because it is the one place the arithmetic can be checked
    // without reference to anything.
    expect(at('brzycki', 142.5, 1)).toBeCloseTo(142.5, 9);
  });

  it('stops answering past the repetition range it was fitted on', () => {
    // The denominator is 37 - r, so it does not divide by zero until 37 -- but it
    // is producing nonsense long before that. Ten is where it stops.
    expect(at('brzycki', 100, 10)).not.toBeNull();
    expect(at('brzycki', 100, 11)).toBeNull();
    expect(at('brzycki', 100, 20)).toBeNull();
  });

  it('reproduces Lander', () => {
    expect(at('lander', 100, 5)).toBeCloseTo(10_000 / (101.3 - 2.67123 * 5), 9);
  });

  it('reproduces Lombardi, and returns the load itself at one repetition', () => {
    expect(at('lombardi', 100, 5)).toBeCloseTo(100 * 5 ** 0.1, 9);
    expect(at('lombardi', 142.5, 1)).toBeCloseTo(142.5, 9);
  });

  it('reproduces Mayhew', () => {
    expect(at('mayhew', 100, 5)).toBeCloseTo(10_000 / (52.2 + 41.9 * Math.exp(-0.275)), 9);
  });

  it("reproduces O'Conner", () => {
    expect(at('oconner', 100, 5)).toBeCloseTo(112.5, 9);
  });

  it('reproduces Wathan', () => {
    expect(at('wathan', 100, 5)).toBeCloseTo(10_000 / (48.8 + 53.8 * Math.exp(-0.375)), 9);
  });

  it('answers across the whole supported range for every core formula but Brzycki', () => {
    for (const entry of formulasInTier('core')) {
      for (let reps = 1; reps <= 20; reps += 1) {
        const value = evaluateFormula(entry, { kilograms: 100, reps, lift: 'squat' });
        if (entry.id === 'brzycki' && reps > 10) {
          expect(value, `${entry.id} at ${String(reps)}`).toBeNull();
          continue;
        }
        expect(value, `${entry.id} at ${String(reps)}`).not.toBeNull();
        expect(value, `${entry.id} at ${String(reps)}`).toBeGreaterThan(0);
      }
    }
  });

  it('never has a core formula return less than the load lifted', () => {
    // Every core equation is multiplicative with a factor of at least one, so an
    // estimate below the entered weight would mean a sign error rather than a
    // modelling disagreement.
    for (const entry of formulasInTier('core')) {
      for (let reps = 1; reps <= 20; reps += 1) {
        const value = evaluateFormula(entry, { kilograms: 137.5, reps, lift: 'deadlift' });
        if (value === null) continue;
        expect(value, `${entry.id} at ${String(reps)}`).toBeGreaterThanOrEqual(137.5 - 1e-9);
      }
    }
  });

  it('has every core formula rise with repetitions', () => {
    // A longer set at the same load implies a larger maximum. A model that fell
    // anywhere in the range would produce a conservative-looking wrong answer,
    // which is the hardest kind to notice.
    for (const entry of formulasInTier('core')) {
      let previous = 0;
      for (let reps = 1; reps <= 10; reps += 1) {
        const value = evaluateFormula(entry, { kilograms: 100, reps, lift: 'squat' });
        if (value === null) continue;
        expect(value, `${entry.id} at ${String(reps)}`).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });
});

describe('the expanded library', () => {
  it('reproduces Brown', () => {
    expect(at('brown', 100, 5)).toBeCloseTo(100 * (0.9849 + 0.0328 * 5), 9);
  });

  it('reproduces Adams and declines before its denominator reaches zero', () => {
    expect(at('adams', 100, 5)).toBeCloseTo(100 / 0.9, 9);
    // 1 - 0.02r is zero at fifty repetitions, which is outside the supported
    // range anyway -- but the guard is what stops a future range change from
    // producing an infinity.
    expect(at('adams', 100, 50)).toBeNull();
  });

  it('reproduces the Kemmler cubic and stops before it turns over', () => {
    expect(at('kemmler', 100, 5)).toBeCloseTo(
      100 * (0.988 + 0.0104 * 5 + 0.0019 * 25 - 0.0000584 * 125),
      9,
    );
    // Past its fitted range the cubic starts predicting a smaller maximum for a
    // longer set, which is not a wrong number a reader would question.
    expect(at('kemmler', 100, 13)).toBeNull();
  });

  it('reproduces Kellner, Naclerio and the two Bergers', () => {
    expect(at('kellner', 100, 5)).toBeCloseTo(100 * 0.98 * Math.exp(0.169), 9);
    expect(at('naclerio', 100, 5)).toBeCloseTo(100 / (0.951 * Math.exp(-0.105)), 9);
    expect(at('berger-exponential', 100, 5)).toBeCloseTo(100 / (1.0261 * Math.exp(-0.131)), 9);
    expect(at('berger-linear', 100, 5)).toBeCloseTo(115, 9);
  });
});

describe('the conditional regressions', () => {
  it('applies Reynolds only to a bench press at exactly five repetitions', () => {
    expect(at('reynolds-bench-5rm', 100, 5, 'bench-press')).toBeCloseTo(1.1307 * 100 + 0.6999, 9);
    expect(at('reynolds-bench-5rm', 100, 4, 'bench-press')).toBeNull();
    expect(at('reynolds-bench-5rm', 100, 6, 'bench-press')).toBeNull();
    // It was fitted on the bench press. Applied to a squat it is a number with
    // no meaning, and the squat is exactly where somebody would be tempted.
    expect(at('reynolds-bench-5rm', 100, 5, 'squat')).toBeNull();
  });

  it('never applies the leg-press equation to any lift this tool offers', () => {
    // Kept in the library as a warning rather than dropped, so a reader who has
    // seen the equation elsewhere finds out why it is not being used.
    for (const lift of ESTIMATE_LIFTS) {
      for (let reps = 1; reps <= 20; reps += 1) {
        expect(at('reynolds-leg-press-5rm', 100, reps, lift)).toBeNull();
      }
    }
  });

  it('holds the Dohoney equations to the repetition ranges they were fitted on', () => {
    expect(at('dohoney-4-6', 100, 3)).toBeNull();
    expect(at('dohoney-4-6', 100, 5)).toBeCloseTo(-24.62 + 112 + 5.09 * 5, 9);
    expect(at('dohoney-4-6', 100, 7)).toBeNull();

    expect(at('dohoney-7-10', 100, 6)).toBeNull();
    expect(at('dohoney-7-10', 100, 8)).toBeCloseTo(-1.89 + 116 + 1.68 * 8, 9);
    expect(at('dohoney-7-10', 100, 11)).toBeNull();
  });

  it('reproduces Abadie and Cummings and Finn in kilograms', () => {
    expect(at('abadie', 100, 5)).toBeCloseTo(112.24, 9);
    expect(at('cummings-finn', 100, 5)).toBeCloseTo(117.5 + 0.839 * 5 - 4.29787, 9);
  });

  it('produces a smaller answer at a light load, which the ensemble has to catch', () => {
    // Cummings and Finn has a negative intercept, so at a light enough load it
    // predicts a maximum below the weight already lifted. The equation is
    // reproduced faithfully here and excluded upstream -- this test exists so
    // that the exclusion in `one-rep-max.ts` is known to be reachable rather
    // than defensive.
    // 10 kg for two: light, and not hypothetical -- an overhead press at that
    // load is an ordinary entry from somebody starting out, which is the lifter
    // least equipped to recognise a nonsense row.
    const value = at('cummings-finn', 10, 2, 'overhead-press');
    if (value === null) throw new Error('Declined.');
    expect(value).toBeLessThan(10);
  });
});

describe('the experimental equation', () => {
  it('reproduces the 2026 preprint in kilograms', () => {
    const expected = 100 * (1 + 4 ** 0.85 / (-2.55 + 4.58 * Math.log(100)));
    expect(at('weight-dependent-2026', 100, 5)).toBeCloseTo(expected, 9);
  });

  it('returns the load itself at one repetition', () => {
    // (r - 1) is zero, so the correction vanishes. Worth pinning: a coefficient
    // slip here would show up first as a single that is not the weight lifted.
    expect(at('weight-dependent-2026', 100, 1)).toBeCloseTo(100, 9);
  });

  it('declines at a load too light for its logarithm', () => {
    // The denominator -2.55 + 4.58 ln w is zero near 1.7 kg. Nobody is entering
    // a 1 kg bench, but an unguarded division here returns a negative estimate
    // rather than an obvious failure.
    expect(at('weight-dependent-2026', 1, 5)).toBeNull();
    expect(at('weight-dependent-2026', 1.5, 5)).toBeNull();
  });

  it('is the only formula whose answer depends on the unit the load is expressed in', () => {
    // 100 kg and 220.46 "kg" are different points on ln w, which is exactly why
    // every equation in this file is evaluated in kilograms and the caller
    // converts once. If this assertion ever fails, the normalisation has been
    // removed somewhere upstream.
    const metric = at('weight-dependent-2026', 100, 5);
    const asIfPounds = at('weight-dependent-2026', 220.462, 5);
    if (metric === null || asIfPounds === null) throw new Error('Declined.');
    expect(metric / 100).not.toBeCloseTo(asIfPounds / 220.462, 4);
  });
});
