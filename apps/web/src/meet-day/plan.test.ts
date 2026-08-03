// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { MAX_COMPLETED_REPS } from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import { rulesFor } from './meet-rules.fixture.js';
import {
  buildPlan,
  populationFor,
  readinessWith,
  type LiftPlanView,
  type PlanContext,
  type PlannerView,
} from './plan.js';
import {
  EMPTY_SESSION,
  confirmMaximum,
  withExtras,
  withFigures,
  withSetup,
  withTargetTotal,
  GUIDED_REPS_MAX,
  type EquipmentCategory,
  type GuidedSet,
  type PlanMethod,
  type PlannerSession,
} from './session.js';

/** §7.2's set, filled in, so a test names only the field it is about. */
function set(patch: Partial<GuidedSet> = {}): GuidedSet {
  return {
    weight: '160',
    reps: '3',
    repsInReserve: 1,
    competitionStandard: 'unstated',
    age: 'unstated',
    sameEquipment: 'unstated',
    ...patch,
  };
}

/**
 * No conversion chart, which is the state every screen paints in first.
 *
 * §16 gives the pound figure to the federation's published chart and nowhere
 * else, and `attemptWeightFor` answers `no-chart` rather than computing one. A
 * fixture chart here would hide the case the site actually starts in.
 */
const CONTEXT: PlanContext = { rules: rulesFor(), chart: null };

/** A five-kilogram grid, for the two places the interaction with §9.1 matters. */
const COARSE: PlanContext = {
  rules: rulesFor({ barMultipleKilograms: 5, minimumProgressionKilograms: 5 }),
  chart: null,
};

const LIFTS: readonly PlatformLift[] = ['squat', 'bench', 'deadlift'];

/** Every lift given the same expected maximum, so one number reads three rows. */
function expecting(kilograms: string, session = EMPTY_SESSION): PlannerSession {
  return LIFTS.reduce(
    (carry, lift) => withFigures(carry, lift, { expectedMaximum: kilograms }),
    session,
  );
}

/** Every contested lift agreed to, which is what §7 gates the plan on. */
function confirmAll(session: PlannerSession): PlannerSession {
  return LIFTS.reduce((carry, lift) => confirmMaximum(carry, lift, true), session);
}

function squatOf(view: PlannerView): LiftPlanView {
  const squat = view.lifts.find((lift) => lift.lift === 'squat');
  if (squat === undefined) throw new Error('the fixture format contests the squat');
  return squat;
}

function weightsOf(lift: LiftPlanView): number[] {
  return lift.attempts.map((attempt) => attempt.weight.kilograms);
}

function using(method: PlanMethod, session: PlannerSession): PlannerSession {
  return withSetup(session, { method });
}

describe('readinessWith', () => {
  it('leaves every readiness alone when no cut was declared', () => {
    for (const answer of ['no', 'unstated'] as const) {
      expect(readinessWith('normal', answer)).toBe('normal');
      expect(readinessWith('uncertain', answer)).toBe('uncertain');
      expect(readinessWith('reduced', answer)).toBe('reduced');
      expect(readinessWith('unstated', answer)).toBe('unstated');
    }
  });

  it('lowers an unstated or normal answer to uncertain, and no further', () => {
    // No further because the cut may go fine. `reduced` is the worst band there
    // is, and putting a lifter in it for a fact that is a risk rather than an
    // observation grades them down for having answered an optional question.
    expect(readinessWith('normal', 'yes')).toBe('uncertain');
    expect(readinessWith('unstated', 'yes')).toBe('uncertain');
  });

  it('never raises a grade the lifter already lowered', () => {
    // The direction that matters. A lifter who said their readiness is reduced
    // knows something the cut question does not ask about; moving them up to
    // `uncertain` because they also ticked the cut box would make volunteering
    // more information produce a more confident grade.
    expect(readinessWith('reduced', 'yes')).toBe('reduced');
    // The control that the fold is doing anything at all on this axis.
    expect(readinessWith('uncertain', 'yes')).toBe('uncertain');
  });
});

describe('populationFor', () => {
  it('says the ruleset is not the one the research measured', () => {
    // §9.3's ranges come from raw IPF competition. Nothing in a published rule
    // profile says which ruleset it is, so claiming `research-population` would
    // hand out the population-matched label on a guess.
    for (const comparison of ['male', 'female', 'none'] as const) {
      const session = withExtras(EMPTY_SESSION, { comparison });
      expect(populationFor(session).ruleset).toBe('other');
    }
  });

  it('treats every equipment answer except raw as equipped, unstated included', () => {
    const equipmentOf = (equipment: EquipmentCategory) =>
      populationFor(withExtras(EMPTY_SESSION, { equipment })).equipment;
    expect(equipmentOf('raw')).toBe('raw');
    for (const equipment of ['wraps', 'single-ply', 'multi-ply', 'other', 'unstated'] as const) {
      expect(equipmentOf(equipment)).toBe('equipped');
    }
  });

  it('carries the comparison group through untouched', () => {
    for (const comparison of ['male', 'female', 'none'] as const) {
      expect(populationFor(withExtras(EMPTY_SESSION, { comparison })).comparison).toBe(comparison);
    }
  });
});

describe('buildPlan, before anything is typed', () => {
  it('reports no problems and no plan on an empty session', () => {
    // The first paint. A screen that opens by telling the lifter off is the
    // failure the three-way reading exists to prevent.
    const view = buildPlan(EMPTY_SESSION, CONTEXT);
    expect(view.lifts).toHaveLength(3);
    for (const lift of view.lifts) {
      expect(lift.problems).toEqual([]);
      expect(lift.attempts).toEqual([]);
      expect(lift.awaiting).toBe(true);
      expect(lift.awaitingConfirmation).toBe(false);
    }
    expect(view.complete).toBe(false);
    expect(view.plannedTotalKilograms).toBeNull();
  });

  it('reports every method’s empty state as awaiting rather than as wrong', () => {
    for (const method of ['expected-max', 'guided-estimate', 'known-opener', 'manual'] as const) {
      const view = buildPlan(using(method, EMPTY_SESSION), CONTEXT);
      expect(squatOf(view).problems, method).toEqual([]);
      expect(squatOf(view).awaiting, method).toBe(true);
    }
    // Target Total is the one whose emptiness is about the target rather than
    // the lift, so it is asserted on the view instead of on the row.
    const split = buildPlan(using('target-total', EMPTY_SESSION), CONTEXT);
    expect(split.proposalProblems).toEqual([]);
    expect(squatOf(split).awaiting).toBe(true);
  });

  it('names a field that holds something that is not a number', () => {
    const view = buildPlan(confirmAll(expecting('two hundred')), CONTEXT);
    expect(squatOf(view).problems.map((problem) => problem.code)).toEqual([
      'field-is-not-a-number',
    ]);
    expect(squatOf(view).problems[0]?.message).not.toBeNull();
    expect(squatOf(view).attempts).toEqual([]);
    // Not awaiting: something was typed, and it was wrong.
    expect(squatOf(view).awaiting).toBe(false);
  });
});

describe('buildPlan, §7.1 Expected Max', () => {
  it('withholds the plan until the lifter agrees to the figure', () => {
    const typed = buildPlan(expecting('200'), CONTEXT);
    expect(squatOf(typed).awaitingConfirmation).toBe(true);
    expect(squatOf(typed).maximumKilograms).toBe(200);
    expect(squatOf(typed).attempts).toEqual([]);

    const agreed = buildPlan(confirmAll(expecting('200')), CONTEXT);
    expect(squatOf(agreed).awaitingConfirmation).toBe(false);
    expect(squatOf(agreed).attempts).toHaveLength(3);
  });

  it('plans three rising, legal attempts under the maximum', () => {
    const view = buildPlan(confirmAll(expecting('200')), CONTEXT);
    const weights = weightsOf(squatOf(view));
    expect(weights).toHaveLength(3);
    const [opener, second, third] = weights;
    expect(opener).toBeLessThan(second ?? 0);
    expect(second).toBeLessThan(third ?? 0);
    for (const weight of weights) {
      expect(CONTEXT.rules.isLegalBarWeight(weight)).toBe(true);
    }
  });

  it('marks only the third as a scenario', () => {
    const attempts = squatOf(buildPlan(confirmAll(expecting('200')), CONTEXT)).attempts;
    expect(attempts.map((attempt) => attempt.provisional)).toEqual([false, false, true]);
  });

  it('never refuses a weight it generated itself', () => {
    for (const lift of buildPlan(confirmAll(expecting('200')), CONTEXT).lifts) {
      for (const attempt of lift.attempts) {
        expect(attempt.refusals).toEqual([]);
      }
    }
  });

  it('adds the thirds up into a projected total, and only when every lift has one', () => {
    const whole = buildPlan(confirmAll(expecting('200')), CONTEXT);
    const thirds = whole.lifts.map((lift) => lift.attempts[2]?.weight.kilograms ?? 0);
    expect(whole.plannedTotalKilograms).toBeCloseTo(
      thirds.reduce((sum, third) => sum + third, 0),
      9,
    );

    // The control: one lift short and the total is withheld rather than being a
    // two-lift sum presented as a meet total.
    const partial = confirmAll(withFigures(expecting('200'), 'bench', { expectedMaximum: '' }));
    expect(buildPlan(partial, CONTEXT).plannedTotalKilograms).toBeNull();
  });

  it('holds the plan to a ceiling the lifter set', () => {
    const capped = confirmAll(
      LIFTS.reduce((carry, lift) => withFigures(carry, lift, { ceiling: '185' }), expecting('200')),
    );
    for (const weight of weightsOf(squatOf(buildPlan(capped, CONTEXT)))) {
      expect(weight).toBeLessThanOrEqual(185);
    }
    // The control: without the ceiling the plan goes past it.
    expect(
      Math.max(...weightsOf(squatOf(buildPlan(confirmAll(expecting('200')), CONTEXT)))),
    ).toBeGreaterThan(185);
  });

  it('passes §8.1’s jump limits through to the planner', () => {
    const limited = withExtras(confirmAll(expecting('200')), { maximumJump: '5' });
    const weights = weightsOf(squatOf(buildPlan(limited, CONTEXT)));
    const [opener, second, third] = weights;
    expect((second ?? 0) - (opener ?? 0)).toBeLessThanOrEqual(5);
    expect((third ?? 0) - (second ?? 0)).toBeLessThanOrEqual(5);
    // The control: unlimited, at least one gap is wider than five.
    const free = weightsOf(squatOf(buildPlan(confirmAll(expecting('200')), CONTEXT)));
    expect(
      Math.max((free[1] ?? 0) - (free[0] ?? 0), (free[2] ?? 0) - (free[1] ?? 0)),
    ).toBeGreaterThan(5);
  });

  it('reports a rounding note where §9.1 moved a weight, and none where it did not', () => {
    // A coarse grid cannot sit on the goal's percentages, so something moves.
    const coarse = squatOf(buildPlan(confirmAll(expecting('200')), COARSE));
    expect(coarse.attempts.some((attempt) => attempt.rounding !== null)).toBe(true);
    // The control: on the half-kilogram grid the same maximum needs far less
    // moving, so "there is always a note" would fail here.
    const fine = squatOf(buildPlan(confirmAll(expecting('200')), CONTEXT));
    expect(fine.attempts.filter((attempt) => attempt.rounding !== null).length).toBeLessThan(
      coarse.attempts.filter((attempt) => attempt.rounding !== null).length,
    );
  });
});

describe('buildPlan, units', () => {
  it('plans the same meet whether the lifter typed kilograms or pounds', () => {
    // The one bug in this module that is invisible on screen: 405 is a plausible
    // squat in either unit, so a missing conversion produces a complete, legal,
    // confidently-labelled plan for a different lifter.
    //
    // 137.3 kg rather than a round number on purpose: §9.1 rounds an opener
    // *down* to a legal weight, so a maximum whose percentages land exactly on
    // the bar grid turns the last bit of floating-point noise in a unit
    // conversion into a whole half-kilogram of difference. That would make this
    // test flap on a conversion that is correct.
    const kilograms = buildPlan(confirmAll(expecting('137.3')), CONTEXT);
    const pounds = buildPlan(
      confirmAll(expecting('302.694686', withSetup(EMPTY_SESSION, { unit: 'lb' }))),
      CONTEXT,
    );
    expect(squatOf(pounds).maximumKilograms).toBeCloseTo(137.3, 3);
    expect(weightsOf(squatOf(pounds))).toEqual(weightsOf(squatOf(kilograms)));
  });

  it('converts the ceiling and the jump limits too, not only the maximum', () => {
    // Each of these is a separate call site, and a conversion forgotten at one of
    // them is a guardrail applied at 2.2 times its intended size.
    const inPounds = withExtras(
      confirmAll(
        LIFTS.reduce(
          (carry, lift) => withFigures(carry, lift, { ceiling: '407.855' }),
          expecting('440.925', withSetup(EMPTY_SESSION, { unit: 'lb' })),
        ),
      ),
      { maximumJump: '11.023' },
    );
    const weights = weightsOf(squatOf(buildPlan(inPounds, CONTEXT)));
    for (const weight of weights) expect(weight).toBeLessThanOrEqual(185);
    expect((weights[1] ?? 0) - (weights[0] ?? 0)).toBeLessThanOrEqual(5);
  });

  it('reports no published pound figure when no chart has loaded', () => {
    // §16: the chart says what the scoresheet prints, and nothing else may.
    for (const attempt of squatOf(buildPlan(confirmAll(expecting('200')), CONTEXT)).attempts) {
      expect(attempt.weight.publishedPounds).toBeNull();
      expect(attempt.weight.publishedPoundsReason).toBe('no-chart');
    }
  });
});

describe('buildPlan, §7.2 Guided Estimate', () => {
  function guided(patch: Partial<GuidedSet> = {}): PlannerSession {
    return using(
      'guided-estimate',
      LIFTS.reduce(
        (carry, lift) => withFigures(carry, lift, { guided: set(patch) }),
        EMPTY_SESSION,
      ),
    );
  }

  it('shows the estimate before the lifter has agreed to anything', () => {
    const view = squatOf(buildPlan(guided(), CONTEXT));
    expect(view.estimate).not.toBeNull();
    expect(view.awaitingConfirmation).toBe(true);
    expect(view.attempts).toEqual([]);
    expect(view.maximumKilograms).toBeGreaterThan(160);
  });

  it('plans off the figure the lifter was shown, not off an unrounded one', () => {
    // The plan and its own working have to agree. Planning off `unrounded` puts a
    // fraction of a kilogram between the number with a tick beside it and the
    // number the attempts came from, which reads as a bug in whichever the lifter
    // checks second.
    const session = confirmAll(guided());
    const view = squatOf(buildPlan(session, CONTEXT));
    const estimate = view.estimate;
    expect(estimate?.kind).toBe('estimated');
    if (estimate?.kind !== 'estimated') return;
    expect(view.maximumKilograms).toBeCloseTo(estimate.toolkit.amount, 9);
    expect(estimate.toolkit.amount).not.toBeCloseTo(estimate.unrounded.toolkit.amount, 9);
  });

  it('treats a single as observed rather than estimated', () => {
    const view = squatOf(buildPlan(confirmAll(guided({ reps: '1', repsInReserve: 0 })), CONTEXT));
    expect(view.estimate?.kind).toBe('observed-single');
    expect(view.maximumKilograms).toBe(160);
  });

  it('does not let §8.2’s comparison group move the estimate', () => {
    // §8.2 is an opt-in about which population's jump ranges to read against. It
    // is not a physiological input, and feeding it to the estimator would make
    // one answer quietly change two things -- a lifter picking a comparison to
    // read the warnings would move their planning maximum.
    const base = squatOf(buildPlan(confirmAll(guided()), CONTEXT)).maximumKilograms;
    for (const comparison of ['male', 'female'] as const) {
      const compared = withExtras(confirmAll(guided()), { comparison });
      expect(squatOf(buildPlan(compared, CONTEXT)).maximumKilograms).toBe(base);
    }
  });

  it('does not let §8.1’s meet count move the estimate either', () => {
    // Training experience and platform experience are different facts. A lifter
    // can have twenty years of training and one meet.
    const base = squatOf(buildPlan(confirmAll(guided()), CONTEXT)).maximumKilograms;
    const experienced = withExtras(confirmAll(guided()), { priorMeets: '40' });
    expect(squatOf(buildPlan(experienced, CONTEXT)).maximumKilograms).toBe(base);
    // The control that the field is read at all: it moves the confidence grade.
    expect(squatOf(buildPlan(experienced, CONTEXT)).confidence).not.toEqual(
      squatOf(buildPlan(confirmAll(guided()), CONTEXT)).confidence,
    );
  });

  it('answers an impossible set with the field’s own sentence', () => {
    // The field guard is what the lifter reads, because it is the only one of the
    // two that writes a sentence -- the estimator publishes bare codes and tool 3
    // supplies their wording from its own copy file.
    for (const reps of ['0', '21']) {
      const view = squatOf(buildPlan(guided({ reps }), CONTEXT));
      expect(
        view.problems.map((problem) => problem.code),
        reps,
      ).toEqual(['field-is-not-a-number']);
      expect(view.problems[0]?.message, reps).not.toBeNull();
      expect(view.attempts, reps).toEqual([]);
    }
  });

  it('keeps the field’s bounds no wider than the estimator’s', () => {
    // Which is what makes the test above true, and it is not a coincidence worth
    // relying on silently. Widening the field by one repetition would let a set
    // through to an estimator that refuses it, and the refusal comes back as a
    // code with no sentence attached -- so the screen would show a set that
    // produced nothing, with nothing to say why.
    expect(GUIDED_REPS_MAX).toBeLessThanOrEqual(MAX_COMPLETED_REPS);
  });
});

describe('buildPlan, §7.3 Known Opener', () => {
  function opener(patch: { opener?: string; ceiling?: string } = {}): PlannerSession {
    return using(
      'known-opener',
      LIFTS.reduce(
        (carry, lift) => withFigures(carry, lift, { opener: '182', ceiling: '210', ...patch }),
        EMPTY_SESSION,
      ),
    );
  }

  it('puts the opener the lifter typed on the bar', () => {
    expect(weightsOf(squatOf(buildPlan(opener(), CONTEXT)))[0]).toBe(182);
  });

  it('asks for nothing to be confirmed, because nothing was estimated', () => {
    // §7.3 starts from a weight the lifter has already decided on. A tick box
    // asking them to agree to their own number is a step that means nothing.
    const view = buildPlan(opener(), CONTEXT);
    for (const lift of view.lifts) expect(lift.awaitingConfirmation).toBe(false);
    expect(view.complete).toBe(true);
  });

  it('shows the maximum the opener implies, as a note rather than as an input', () => {
    const view = squatOf(buildPlan(opener(), CONTEXT));
    expect(view.maximumKilograms).toBeGreaterThan(182);
    expect(view.openerNotes.length).toBeGreaterThanOrEqual(0);
  });

  it('waits for a ceiling rather than inventing a multiple of the opener', () => {
    // The method has no maximum to bound the third against, so without a ceiling
    // there is nothing to stop the plan at. Asking is better than guessing.
    const view = squatOf(buildPlan(opener({ ceiling: '' }), CONTEXT));
    expect(view.attempts).toEqual([]);
    expect(view.problems).toEqual([]);
    expect(view.awaiting).toBe(true);
  });

  it('refuses a ceiling under the opener in the lifter’s own numbers', () => {
    const view = squatOf(buildPlan(opener({ opener: '200', ceiling: '180' }), CONTEXT));
    expect(view.problems.map((problem) => problem.code)).toContain('ceiling-below-the-opener');
    expect(view.attempts).toEqual([]);
  });
});

describe('buildPlan, §7.4 Manual', () => {
  function manual(
    attempts: [string, string, string],
    extra: Partial<{ expectedMaximum: string }> = {},
  ) {
    return using(
      'manual',
      LIFTS.reduce(
        (carry, lift) => withFigures(carry, lift, { attempts, ...extra }),
        EMPTY_SESSION,
      ),
    );
  }

  it('puts the three weights the lifter typed on the bar, unchanged', () => {
    // The premise of the method is that the lifter has decided. Moving a weight
    // onto a legal one would hand back a plan they did not write.
    expect(weightsOf(squatOf(buildPlan(manual(['180', '190', '197.5']), CONTEXT)))).toEqual([
      180, 190, 197.5,
    ]);
  });

  it('reports an illegal weight where it was typed instead of correcting it', () => {
    const view = squatOf(buildPlan(manual(['180', '190', '192.3']), COARSE));
    expect(weightsOf(view)[2]).toBe(192.3);
    expect(view.attempts[2]?.refusals).toContain('not-a-legal-bar-weight');
    // The control: the first two sit on the coarse grid and are not refused.
    expect(view.attempts[0]?.refusals).toEqual([]);
    expect(view.attempts[1]?.refusals).toEqual([]);
  });

  it('applies the minimum progression between one attempt and the next', () => {
    // Each attempt is checked as though the ones before it were good lifts, which
    // is what makes a one-kilogram second attempt illegal rather than merely odd.
    const view = squatOf(buildPlan(manual(['180', '180.5', '190']), CONTEXT));
    expect(view.attempts[1]?.refusals).toContain('below-the-minimum-progression');
    expect(view.attempts[0]?.refusals).toEqual([]);
  });

  it('labels no risk at all when the lifter never said what they can lift', () => {
    // `classifyAttemptRisk` is total and grades a missing maximum as a Long Shot,
    // which is right for the domain and a fabricated warning on a screen. §10.2's
    // four words are a claim about the lifter, and there is nothing to base one on.
    const view = squatOf(buildPlan(manual(['180', '190', '197.5']), CONTEXT));
    for (const attempt of view.attempts) expect(attempt.risk).toBeNull();
    expect(view.maximumKilograms).toBeNull();
  });

  it('labels risk once the lifter volunteers an expected maximum', () => {
    const view = squatOf(
      buildPlan(manual(['180', '198', '200'], { expectedMaximum: '200' }), CONTEXT),
    );
    expect(view.maximumKilograms).toBe(200);
    for (const attempt of view.attempts) expect(attempt.risk).not.toBeNull();
    // Distinct labels rather than a named one, because the four words come from
    // §10.2's table and pinning one here would restate that table in a second
    // place. What matters is that the label tracks the weight.
    expect(new Set(view.attempts.map((attempt) => attempt.risk)).size).toBeGreaterThan(1);
  });

  it('reviews the jumps only when there is a maximum to measure them against', () => {
    // §9.2's anchors are percentages of the planning maximum, so without one
    // there is no gap to be wide *of*. An 18 kg gap into the second and a 2 kg
    // gap into the third are outside both anchors against a 200 kg maximum, and
    // are nothing at all without one.
    expect(squatOf(buildPlan(manual(['180', '198', '200']), CONTEXT)).advisories).toEqual([]);
    expect(
      squatOf(buildPlan(manual(['180', '198', '200'], { expectedMaximum: '200' }), CONTEXT))
        .advisories.length,
    ).toBeGreaterThan(0);
  });

  it('measures the gaps from the weights that were typed', () => {
    const view = squatOf(buildPlan(manual(['180', '190', '197.5']), CONTEXT));
    expect(view.attempts.map((attempt) => attempt.jumpKilograms)).toEqual([null, 10, 7.5]);
  });

  it('still calls the third a scenario, however it was arrived at', () => {
    // §9's rule is about what a third attempt *is*, not about who chose it. A
    // typed third that presented as settled would be the one place in the tool
    // where a lifter is told a third is a commitment.
    const attempts = squatOf(buildPlan(manual(['180', '190', '197.5']), CONTEXT)).attempts;
    expect(attempts.map((attempt) => attempt.provisional)).toEqual([false, false, true]);
  });

  it('claims nothing was rounded, because nothing was', () => {
    for (const attempt of squatOf(buildPlan(manual(['180', '190', '197.5']), CONTEXT)).attempts) {
      expect(attempt.rounding).toBeNull();
    }
  });

  it('waits rather than planning two of three attempts', () => {
    const view = squatOf(buildPlan(manual(['180', '190', '']), CONTEXT));
    expect(view.attempts).toEqual([]);
    expect(view.awaiting).toBe(true);
    expect(view.problems).toEqual([]);
  });
});

describe('buildPlan, §7.5 Target Total', () => {
  function target(total: string, patch: Record<PlatformLift, string>): PlannerSession {
    return withTargetTotal(
      using(
        'target-total',
        LIFTS.reduce(
          (carry, lift) => withFigures(carry, lift, { expectedMaximum: patch[lift] }),
          EMPTY_SESSION,
        ),
      ),
      total,
    );
  }

  const EXPECTATIONS: Record<PlatformLift, string> = {
    squat: '200',
    bench: '120',
    deadlift: '230',
  };

  it('splits the target and asks the lifter to agree to each share', () => {
    const view = buildPlan(target('500', EXPECTATIONS), CONTEXT);
    expect(view.proposal?.shares).toHaveLength(3);
    for (const lift of view.lifts) {
      expect(lift.awaitingConfirmation).toBe(true);
      expect(lift.attempts).toEqual([]);
      expect(lift.maximumKilograms).not.toBeNull();
    }
  });

  it('plans each lift off its own share once every share is agreed to', () => {
    const view = buildPlan(confirmAll(target('500', EXPECTATIONS)), CONTEXT);
    for (const lift of view.lifts) {
      const share = view.proposal?.shares.find((entry) => entry.lift === lift.lift);
      expect(lift.maximumKilograms).toBe(share?.proposedMaximumKilograms);
      expect(lift.attempts).toHaveLength(3);
    }
    expect(view.complete).toBe(true);
  });

  it('reports a refusal about the target once, not once per lift', () => {
    // The target is one figure and belongs to the meet. Three copies of the same
    // sentence beside three lifts reads as three separate faults.
    const view = buildPlan(target('not a number', EXPECTATIONS), CONTEXT);
    expect(view.proposalProblems.map((problem) => problem.code)).toEqual(['field-is-not-a-number']);
    for (const lift of view.lifts) expect(lift.problems).toEqual([]);
  });

  it('carries the split’s own warning about an unreachable target', () => {
    const view = buildPlan(target('600', EXPECTATIONS), CONTEXT);
    expect(view.proposal?.advisories.map((advisory) => advisory.code)).toContain(
      'target-is-above-what-the-lifter-expects',
    );
    // The control: a target inside the expectations carries no such sentence.
    const modest = buildPlan(target('500', EXPECTATIONS), CONTEXT);
    expect(modest.proposal?.advisories.map((advisory) => advisory.code)).not.toContain(
      'target-is-above-what-the-lifter-expects',
    );
  });

  it('waits when only some of the expectations are typed', () => {
    const partial = target('500', { ...EXPECTATIONS, bench: '' });
    const view = buildPlan(partial, CONTEXT);
    expect(view.proposal).toBeNull();
    expect(view.proposalProblems).toEqual([]);
    for (const lift of view.lifts) expect(lift.awaiting).toBe(true);
  });
});

describe('buildPlan, §10 risk and data confidence as two axes', () => {
  it('does not move a single attempt when only the evidence changes', () => {
    // §10 forbids fusing the two. The clearest way to state that here is that the
    // whole evidence section can be filled in and no weight and no risk label
    // moves -- because risk is where the bar sits against `M`, and nothing else.
    const base = confirmAll(expecting('200'));
    const strong = withExtras(base, {
      readiness: 'normal',
      hardCut: 'no',
      priorMeets: '12',
      maximumSource: 'competition-single',
      evidenceAge: 'within-eight-weeks',
    });
    const weak = withExtras(base, {
      readiness: 'reduced',
      hardCut: 'yes',
      priorMeets: '0',
      maximumSource: 'lifetime-best',
      evidenceAge: 'older',
    });
    expect(weightsOf(squatOf(buildPlan(weak, CONTEXT)))).toEqual(
      weightsOf(squatOf(buildPlan(strong, CONTEXT))),
    );
    expect(squatOf(buildPlan(weak, CONTEXT)).attempts.map((a) => a.risk)).toEqual(
      squatOf(buildPlan(strong, CONTEXT)).attempts.map((a) => a.risk),
    );
    // The control: the same change does move the other axis, so the equality
    // above is the two axes staying separate rather than nothing happening.
    expect(squatOf(buildPlan(weak, CONTEXT)).confidence.level).not.toBe(
      squatOf(buildPlan(strong, CONTEXT)).confidence.level,
    );
  });

  it('grades the confidence of a lift with no plan on it at all', () => {
    // The grade is about the evidence, not about the attempts, so it exists from
    // the first paint. A screen that showed it only alongside a plan would be
    // treating it as a property of the plan.
    expect(squatOf(buildPlan(EMPTY_SESSION, CONTEXT)).confidence.level).toBeDefined();
  });

  it('folds §8.1’s cut into the grade the same way the exported rule does', () => {
    const cut = withExtras(confirmAll(expecting('200')), { readiness: 'normal', hardCut: 'yes' });
    expect(buildPlan(cut, CONTEXT).readiness).toBe('uncertain');
    expect(squatOf(buildPlan(cut, CONTEXT)).confidence).toEqual(
      squatOf(
        buildPlan(withExtras(confirmAll(expecting('200')), { readiness: 'uncertain' }), CONTEXT),
      ).confidence,
    );
  });

  it('counts a described effort only where an effort was actually described', () => {
    // `unknown` is the reps-in-reserve nobody touched, and an untouched default is
    // not a description. Nor is a maximum typed with no set behind it.
    const described = using(
      'guided-estimate',
      withFigures(EMPTY_SESSION, 'squat', { guided: set({ repsInReserve: 1 }) }),
    );
    const silent = using(
      'guided-estimate',
      withFigures(EMPTY_SESSION, 'squat', { guided: set({ repsInReserve: 'unknown' }) }),
    );
    expect(squatOf(buildPlan(described, CONTEXT)).confidence).not.toEqual(
      squatOf(buildPlan(silent, CONTEXT)).confidence,
    );
  });

  it('ignores a described effort belonging to a method that is not open', () => {
    // `session.ts` holds every method's fields for every lift, so a lifter who
    // tried Guided Estimate and then switched to Expected Max still has a set on
    // record. Reading its reps-in-reserve here would grade a bare typed maximum
    // as though a set had been described -- an upgrade earned by a field that is
    // no longer on screen, and one nothing in the interface could explain.
    //
    // Stated as a low-repetition estimate because that is §10.1's Medium
    // condition, and the only grade the effort answer is allowed to move. With
    // any other source the two sessions grade the same however the flag is set,
    // and the test would pass while measuring nothing.
    const bare = withExtras(confirmAll(expecting('200')), {
      maximumSource: 'low-repetition-estimate',
      evidenceAge: 'within-eight-weeks',
    });
    const withStaleSet = LIFTS.reduce(
      (carry, lift) => withFigures(carry, lift, { guided: set({ repsInReserve: 1 }) }),
      bare,
    );

    // The control. Without it the equality below passes on a session where the
    // flag was never consulted, which is how this test read before the branch
    // above was looked up.
    expect(
      squatOf(buildPlan(bare, CONTEXT)).confidence.reasons.map((reason) => reason.code),
    ).toContain('effort-not-described');

    expect(squatOf(buildPlan(withStaleSet, CONTEXT)).confidence).toEqual(
      squatOf(buildPlan(bare, CONTEXT)).confidence,
    );
  });
});

describe('buildPlan, the meet format', () => {
  it('plans only the lifts the meet contests', () => {
    const pushPull = withSetup(confirmAll(expecting('200')), { format: 'push-pull' });
    expect(buildPlan(pushPull, CONTEXT).lifts.map((lift) => lift.lift)).toEqual([
      'bench',
      'deadlift',
    ]);
  });

  it('totals only the lifts the meet contests', () => {
    const pushPull = withSetup(confirmAll(expecting('200')), { format: 'push-pull' });
    const whole = buildPlan(confirmAll(expecting('200')), CONTEXT);
    const partial = buildPlan(pushPull, CONTEXT);
    expect(partial.plannedTotalKilograms).toBeLessThan(whole.plannedTotalKilograms ?? 0);
    expect(partial.complete).toBe(true);
  });
});

describe('buildPlan, the confirmation gate', () => {
  it('is not satisfied by a tick left over from another method', () => {
    // Switching method clears the ticks in `session.ts`, and this is the second
    // lock: a method that asks for no confirmation must not be able to reach a
    // finished plan through a flag that happens to be set.
    const view = buildPlan(confirmAll(expecting('200')), CONTEXT);
    expect(view.complete).toBe(true);
    const half = buildPlan(confirmMaximum(expecting('200'), 'squat', true), CONTEXT);
    expect(half.complete).toBe(false);
  });

  it('reports complete only when every contested lift has three attempts', () => {
    const short = confirmAll(withFigures(expecting('200'), 'deadlift', { expectedMaximum: '' }));
    expect(buildPlan(short, CONTEXT).complete).toBe(false);
  });
});
