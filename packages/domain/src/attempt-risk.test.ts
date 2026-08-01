import { describe, expect, it } from 'vitest';

import {
  ATTEMPT_PLAN_METHODOLOGY_VERSION,
  ATTEMPT_RISKS,
  DATA_CONFIDENCES,
  assessDataConfidence,
  classifyAttemptRisk,
  isRiskierThan,
  type ConfidenceEvidence,
  type ConfidenceReasonCode,
} from './attempt-risk.js';

/**
 * A round 100 kg maximum throughout, so every attempt weight reads as its own
 * percentage. That is not a federation figure and could not be one -- it is a
 * number a lifter typed about themselves -- so §5.1's invented-fixture rule is
 * satisfied by the choice being arbitrary rather than by it being unlike anything
 * real.
 */
const MAXIMUM = 100;

function riskAt(kilograms: number, attemptNumber: 1 | 2 | 3, lift: 'squat' | 'bench' = 'squat') {
  return classifyAttemptRisk({
    lift,
    attemptNumber,
    kilograms,
    meetDayMaximumKilograms: MAXIMUM,
  });
}

describe('classifyAttemptRisk', () => {
  it('grades an opener from the strategy table as Secure', () => {
    // 88% and 89% are the First Meet and Conservative openers. A tool that called
    // its own most cautious preset anything but Secure would be arguing with
    // itself, and both halves would keep passing their own tests.
    expect(riskAt(88, 1)).toBe('secure');
    expect(riskAt(89, 1)).toBe('secure');
  });

  it('grades the Balanced and Personal Record openers as Recommended, not aggressive', () => {
    // §6.3 and §2.3 both say choosing an aggressive goal must not make the opener
    // aggressive. This is that rule as arithmetic.
    expect(riskAt(90, 1)).toBe('recommended');
    expect(riskAt(91, 1)).toBe('recommended');
  });

  it('grades an opener above anything the presets offer as a Push and then a Long Shot', () => {
    expect(riskAt(94, 1)).toBe('push');
    expect(riskAt(97, 1)).toBe('long-shot');
  });

  it('moves the scale with the attempt number rather than using one scale throughout', () => {
    // 96% is a Long Shot as an opener and a Recommended second. A single scale
    // would have to be wrong about one of the two.
    expect(riskAt(96, 1)).toBe('long-shot');
    expect(riskAt(96, 2)).toBe('recommended');
    expect(riskAt(96, 3)).toBe('secure');
  });

  it('grades a third at the top of the Personal Record range as a Push', () => {
    expect(riskAt(98, 3)).toBe('secure');
    expect(riskAt(101, 3)).toBe('recommended');
    expect(riskAt(103, 3)).toBe('push');
    expect(riskAt(106, 3)).toBe('long-shot');
  });

  it('treats the same percentage as riskier on a bench third than on a squat third', () => {
    // §9.2. A bench third is a handful of kilograms with no way to grind one out
    // of a bad position, so the scale shifts down rather than the percentages
    // being reinterpreted at each call site.
    expect(riskAt(100, 3, 'squat')).toBe('recommended');
    expect(riskAt(100, 3, 'bench')).toBe('push');
  });

  it('leaves the opener and second scales alone on the bench', () => {
    // The §9.2 sentence is about third attempts. An opener is a warm-up single on
    // every lift, and shifting its scale would make the bench opener conservative
    // by accident rather than by decision.
    expect(riskAt(91, 1, 'bench')).toBe(riskAt(91, 1, 'squat'));
    expect(riskAt(97, 2, 'bench')).toBe(riskAt(97, 2, 'squat'));
  });

  it('grades an unusable maximum as a Long Shot rather than throwing', () => {
    // A screen still has to label whatever is on it. Secure is the reading that
    // gets somebody hurt, so an absent denominator goes the other way.
    expect(
      classifyAttemptRisk({
        lift: 'squat',
        attemptNumber: 1,
        kilograms: 90,
        meetDayMaximumKilograms: 0,
      }),
    ).toBe('long-shot');
    expect(
      classifyAttemptRisk({
        lift: 'squat',
        attemptNumber: 1,
        kilograms: Number.NaN,
        meetDayMaximumKilograms: MAXIMUM,
      }),
    ).toBe('long-shot');
  });

  it('returns nothing that could be rendered as a probability', () => {
    // §10.2. The type is four words; this pins that the runtime value is one of
    // them and never a number somebody could put a percent sign after.
    for (const attemptNumber of [1, 2, 3] as const) {
      for (const weight of [50, 88, 95, 100, 110, 200]) {
        expect(ATTEMPT_RISKS).toContain(riskAt(weight, attemptNumber));
      }
    }
  });
});

describe('isRiskierThan', () => {
  it('orders the four labels', () => {
    expect(isRiskierThan('push', 'recommended')).toBe(true);
    expect(isRiskierThan('recommended', 'push')).toBe(false);
    expect(isRiskierThan('secure', 'secure')).toBe(false);
    expect(isRiskierThan('long-shot', 'secure')).toBe(true);
  });
});

/** The best-described lifter §10.1 describes. Every test below spoils one thing about it. */
const WELL_DESCRIBED: ConfidenceEvidence = {
  maximumSource: 'competition-single',
  evidenceAge: 'within-eight-weeks',
  openerTestedInTraining: true,
  equipmentMatchesMeet: true,
  priorMeets: 3,
  readiness: 'normal',
  effortDescribed: true,
};

function codesFor(overrides: Partial<ConfidenceEvidence>): readonly ConfidenceReasonCode[] {
  return assessDataConfidence({ ...WELL_DESCRIBED, ...overrides }).reasons.map(
    (reason) => reason.code,
  );
}

function levelFor(overrides: Partial<ConfidenceEvidence>) {
  return assessDataConfidence({ ...WELL_DESCRIBED, ...overrides }).level;
}

describe('assessDataConfidence', () => {
  it('grades a recent competition single with a tested opener as High', () => {
    const assessment = assessDataConfidence(WELL_DESCRIBED);
    expect(assessment.level).toBe('high');
    expect(assessment.reasons).toStrictEqual([]);
  });

  it('keeps a competition-standard training single at High and still says where it came from', () => {
    // §10.1 asks for "recent competition-standard singles", which a paused,
    // depth-legal training single is. Recording it as a reason without lowering
    // the grade is what lets a screen explain a grade it did not reduce.
    const assessment = assessDataConfidence({
      ...WELL_DESCRIBED,
      maximumSource: 'competition-standard-single',
    });
    expect(assessment.level).toBe('high');
    expect(assessment.reasons.map((reason) => reason.code)).toStrictEqual([
      'competition-standard-single',
    ]);
  });

  it('holds a repetition estimate at Medium', () => {
    expect(levelFor({ maximumSource: 'low-repetition-estimate' })).toBe('medium');
  });

  it('drops a repetition estimate to Low when nobody said how hard the set was', () => {
    // §10.1 grants Medium to low-repetition data *with reasonable effort
    // information*. A set of three at an unknown effort estimates tens of
    // kilograms apart depending on the answer.
    expect(levelFor({ maximumSource: 'low-repetition-estimate', effortDescribed: false })).toBe(
      'low',
    );
  });

  it('holds a high-repetition estimate and an undated best at Low', () => {
    expect(levelFor({ maximumSource: 'high-repetition-estimate' })).toBe('low');
    expect(levelFor({ maximumSource: 'lifetime-best' })).toBe('low');
  });

  it('treats an unrecorded source as Low rather than as an average answer', () => {
    expect(levelFor({ maximumSource: 'unstated' })).toBe('low');
  });

  it('reads stale evidence as Low and months-old evidence as Medium', () => {
    expect(levelFor({ evidenceAge: 'within-six-months' })).toBe('medium');
    expect(levelFor({ evidenceAge: 'older' })).toBe('low');
    expect(levelFor({ evidenceAge: 'unstated' })).toBe('low');
  });

  it('holds different equipment at Low and unrecorded equipment at Medium', () => {
    // Not the same answer, because they are not the same situation: one is a
    // known mismatch and the other is a question nobody asked.
    expect(levelFor({ equipmentMatchesMeet: false })).toBe('low');
    expect(levelFor({ equipmentMatchesMeet: null })).toBe('medium');
  });

  it('holds uncertain and reduced readiness at Low', () => {
    expect(levelFor({ readiness: 'uncertain' })).toBe('low');
    expect(levelFor({ readiness: 'reduced' })).toBe('low');
    expect(levelFor({ readiness: 'unstated' })).toBe('medium');
  });

  it('lets a well-prepared first meet reach High on a tested opener alone', () => {
    // Requiring both a tested opener and meet history would make a first meet
    // ungradable at the top of the scale, and a first meet is what this tool is
    // most for.
    expect(levelFor({ priorMeets: 0 })).toBe('high');
  });

  it('holds an untested opener with no meet history at Medium', () => {
    expect(levelFor({ priorMeets: 0, openerTestedInTraining: null })).toBe('medium');
    expect(codesFor({ priorMeets: 0, openerTestedInTraining: false })).toContain(
      'no-tested-opener-and-no-meet-history',
    );
  });

  it('reports every ceiling that applied, not only the binding one', () => {
    // §5.5, and here it is also the answer to "what would I have to fix?" -- a
    // lifter told only about the binding ceiling improves it and is graded Low
    // again for the next one.
    const codes = codesFor({
      maximumSource: 'high-repetition-estimate',
      evidenceAge: 'older',
      readiness: 'uncertain',
    });
    expect(codes).toContain('high-repetition-estimate');
    expect(codes).toContain('evidence-is-stale');
    expect(codes).toContain('readiness-uncertain');
  });

  it('never lets a well-answered question raise the grade past a structural ceiling', () => {
    // Every rule is a ceiling and none is a bonus. A lifter who answers every
    // optional question about a set the tool distrusts stays where the distrust
    // put them.
    expect(
      levelFor({
        maximumSource: 'high-repetition-estimate',
        openerTestedInTraining: true,
        priorMeets: 20,
        effortDescribed: true,
      }),
    ).toBe('low');
  });

  it('answers with one of the three words and nothing numeric', () => {
    expect(DATA_CONFIDENCES).toContain(levelFor({}));
  });

  it('carries a methodology version so a saved plan is not silently reinterpreted', () => {
    // §30: the stored document has to record which reading produced it. An empty
    // or absent version reads as "current" forever.
    expect(ATTEMPT_PLAN_METHODOLOGY_VERSION).toMatch(/^attempt-plan-\d{4}\.\d+$/u);
  });
});
