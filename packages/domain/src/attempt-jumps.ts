/**
 * Whether the gaps between three attempts look like the gaps lifters actually take.
 *
 * §9.2 and §9.3 of the planner requirements, and both are *guardrails, never
 * verdicts*. Nothing in this file refuses a plan. A lifter who wants a 20 kg jump
 * into their third deadlift may have it; what they get back is a sentence saying
 * that jumps that size are unusual in the population the figure came from, and
 * what population that was.
 *
 * THE TWO KINDS OF ADVICE, AND WHY THEY ARE NOT ONE KIND
 *
 * §9.2 is *relative*: a first-to-second jump is commonly 5% to 7.5% of the
 * planning maximum, a second-to-third commonly 3% to 5%. That scales, so it
 * applies to everybody -- a 60 kg bench and a 260 kg squat are both described by
 * it. §9.3 is *absolute*: jumps in kilograms, measured on a specific population,
 * broken out by sex and lift. That does not scale, and the requirements are
 * explicit that it may not fit a given lifter.
 *
 * Folding the two into one warning would make the absolute figures look as
 * general as the relative ones, which is the false precision §9.3 names. So they
 * are separate codes with separate evidence labels, and a caller renders both.
 *
 * WHY THE THRESHOLDS ARE CODE
 *
 * The same line §5.1 draws and `lifts.ts` sits on: these are not a federation's
 * numbers, revisable between releases, but this project's reading of published
 * research. What keeps that honest is that a plan records
 * `ATTEMPT_PLAN_METHODOLOGY_VERSION`, so a plan made under one reading is not
 * silently reinterpreted under the next.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

/**
 * The sentence that has to accompany any §9.3 advisory.
 *
 * §9.3 requires the warning to state that the ranges come from population data in
 * raw competition under IPF rules and may not fit every lifter. Exported as one
 * constant rather than repeated into each message so an interface can render it
 * once beneath a list -- and so it cannot be dropped from one message and kept in
 * the others, which is how a caveat quietly stops applying to half the advice.
 */
export const RESEARCH_BASIS_NOTE =
  'These ranges come from population data on raw competition under IPF rules. They describe what is common, not what is possible, and they may not fit any particular lifter.';

/**
 * Which population's figures to compare against, or none at all.
 *
 * §8.2 makes this **opt-in and optional**, explicitly separate from any federation
 * competition category, and requires that declining it still produce a usable
 * tool. `none` is therefore a supported answer and not a missing one: the relative
 * anchors still apply, and the evidence label says the advice is less
 * specifically matched.
 */
export type ResearchComparison = 'male' | 'female' | 'none';

/**
 * How well the advice matches the lifter it is being given to.
 *
 * §9.3: equipped lifting, rules other than the ones the research was gathered
 * under, and unusually strong lifters "should receive a lower-evidence label
 * rather than false precision". So the guidance is not withheld -- withholding it
 * would leave a screen with nothing to say -- it is labelled.
 */
export type JumpEvidence = 'population-matched' | 'general';

/**
 * Who the lifter is, for the purpose of picking a comparison and a label.
 *
 * `ruleset` is a two-word answer rather than a federation identifier on purpose.
 * The domain must not know which federation the research population competed
 * under -- that would put a federation's name in code, which §5.1 keeps out --
 * and the caller already has the profile in hand to decide it.
 */
export interface JumpPopulation {
  readonly comparison: ResearchComparison;
  /** Raw is what the research measured; anything else lowers the label. */
  readonly equipment: 'raw' | 'equipped';
  readonly ruleset: 'research-population' | 'other';
}

export type JumpAdvisoryCode =
  /** §9.2: a first-to-second gap wider than the range lifters commonly take. */
  | 'first-to-second-wider-than-usual'
  /** §9.2: a gap so small it spends an attempt on almost nothing. */
  | 'first-to-second-narrower-than-usual'
  | 'second-to-third-wider-than-usual'
  | 'second-to-third-narrower-than-usual'
  /** §9.3: an absolute jump above what the comparison population commonly takes. */
  | 'first-to-second-above-research-range'
  | 'second-to-third-above-research-range';

/** How loudly to say it. Neither value refuses anything. */
export type JumpAdvisorySeverity = 'note' | 'strong';

export interface JumpAdvisory {
  readonly code: JumpAdvisoryCode;
  readonly severity: JumpAdvisorySeverity;
  /** Which attempt the gap leads into: 2 or 3. */
  readonly intoAttempt: 2 | 3;
  readonly evidence: JumpEvidence;
  readonly message: string;
}

/**
 * The relative anchors of §9.2, as shares of the planning maximum.
 *
 * "Commonly", not "correctly": a plan outside these is annotated, never refused.
 */
const RELATIVE_ANCHORS: Readonly<
  Record<2 | 3, { readonly minimumPercent: number; readonly maximumPercent: number }>
> = {
  2: { minimumPercent: 5, maximumPercent: 7.5 },
  3: { minimumPercent: 3, maximumPercent: 5 },
};

/**
 * How low an opener has to be before a wide first-to-second stops being unusual.
 *
 * §9.2: "a lower opener may reasonably create a larger first-to-second percentage
 * jump". Read against the §9 strategy table, whose most cautious opener is 88% --
 * an opener below the range any preset would produce is a deliberate choice to
 * bank the total early, and the wider second that follows is the consequence of
 * that choice rather than a mistake. Warning about it anyway would train a lifter
 * to dismiss the warnings that matter.
 */
const CAUTIOUS_OPENER_PERCENT = 88;

/**
 * §9.3's absolute figures, in kilograms, one row per comparison group and lift.
 *
 * Each threshold is the **upper** end of the range the requirements state, and the
 * comparison is strictly greater. The requirements give several of these as a
 * range ("approximately 12 to 12.5 kg"), and taking the low end would fire the
 * warning on 12.5 kg -- five of the smallest plate, the single most common jump
 * anybody makes -- inside a range the research itself calls ordinary. A warning
 * that fires on the ordinary case is a warning nobody reads, which costs more than
 * the handful of jumps the coarser threshold lets through.
 *
 * `null` means the requirements state no figure for that jump. It is left null
 * rather than interpolated from the neighbouring row: inventing one is exactly the
 * false precision §9.3 forbids.
 */
interface ResearchThresholds {
  /** Flag a first-to-second above this many kilograms. */
  readonly firstToSecond: number | null;
  readonly secondToThird: number | null;
  /** Above this, the same advisory is raised as `strong`. */
  readonly strongSecondToThird: number | null;
}

const RESEARCH_THRESHOLDS: Readonly<
  Record<'male' | 'female', Readonly<Record<PlatformLift, ResearchThresholds>>>
> = {
  male: {
    // Squat: first-to-second above ~15 kg, second-to-third above ~12 to 12.5 kg.
    squat: { firstToSecond: 15, secondToThird: 12.5, strongSecondToThird: null },
    // Bench: jumps above ~10 kg at all, with a stronger warning for a third.
    bench: { firstToSecond: 10, secondToThird: 10, strongSecondToThird: 10 },
    // Deadlift: 5 to 20 kg was the common first-to-second, so above 20 is the
    // flag; second-to-third above ~12 to 12.5 kg.
    deadlift: { firstToSecond: 20, secondToThird: 12.5, strongSecondToThird: null },
  },
  female: {
    squat: { firstToSecond: 10, secondToThird: 8, strongSecondToThird: null },
    // Bench: the requirements name only the third -- "warn when a third exceeds
    // approximately 4 to 5 kg, strongly approaching or exceeding 10 kg" -- and
    // say of the first-to-second only that smaller legal jumps are favoured. No
    // figure is stated, so none is used.
    bench: { firstToSecond: null, secondToThird: 5, strongSecondToThird: 10 },
    deadlift: { firstToSecond: 11, secondToThird: 10, strongSecondToThird: null },
  },
};

/** The three weights a review is about, in kilograms. */
export interface JumpSequence {
  readonly lift: PlatformLift;
  /** `M`, the confirmed meet-day maximum the relative anchors are measured against. */
  readonly meetDayMaximumKilograms: number;
  readonly openerKilograms: number;
  readonly secondKilograms: number;
  /** The planned third, which §9 calls a scenario rather than a commitment. */
  readonly thirdKilograms: number;
}

function evidenceFor(population: JumpPopulation): JumpEvidence {
  return population.comparison !== 'none' &&
    population.equipment === 'raw' &&
    population.ruleset === 'research-population'
    ? 'population-matched'
    : 'general';
}

function describeKilograms(value: number): string {
  // Trailing zeros read as false precision on a figure that is already
  // approximate: "7.5 kg" and "8 kg", never "8.0 kg".
  return `${Number(value.toFixed(2))} kg`;
}

/**
 * Everything worth saying about the gaps in a three-attempt plan.
 *
 * Returns an empty array for an ordinary plan, which is the common case and is
 * meant to be: a screen with nothing to say here should say nothing rather than
 * reassure. Advisories come back in attempt order, relative before absolute, so a
 * list renders in the order a lifter reads their own plan.
 */
export function reviewJumps(
  sequence: JumpSequence,
  population: JumpPopulation,
): readonly JumpAdvisory[] {
  const { meetDayMaximumKilograms: maximum } = sequence;
  if (!Number.isFinite(maximum) || maximum <= 0) {
    // No denominator for the relative anchors and no basis for the absolute
    // thresholds either, since a maximum that is not a weight means the three
    // attempts were not derived from one. Silence beats a fabricated warning.
    return [];
  }

  const evidence = evidenceFor(population);
  const advisories: JumpAdvisory[] = [];
  const openerPercent = (sequence.openerKilograms / maximum) * 100;

  const gaps = [
    {
      intoAttempt: 2 as const,
      kilograms: sequence.secondKilograms - sequence.openerKilograms,
      label: 'first to second',
    },
    {
      intoAttempt: 3 as const,
      kilograms: sequence.thirdKilograms - sequence.secondKilograms,
      label: 'second to third',
    },
  ];

  for (const gap of gaps) {
    const percent = (gap.kilograms / maximum) * 100;
    const anchor = RELATIVE_ANCHORS[gap.intoAttempt];
    const wider =
      gap.intoAttempt === 2
        ? 'first-to-second-wider-than-usual'
        : 'second-to-third-wider-than-usual';
    const narrower =
      gap.intoAttempt === 2
        ? 'first-to-second-narrower-than-usual'
        : 'second-to-third-narrower-than-usual';

    const openerExplainsIt = gap.intoAttempt === 2 && openerPercent < CAUTIOUS_OPENER_PERCENT;
    if (percent > anchor.maximumPercent && !openerExplainsIt) {
      advisories.push({
        code: wider,
        severity: 'note',
        intoAttempt: gap.intoAttempt,
        evidence,
        message: `The ${gap.label} jump is ${percent.toFixed(1)}% of the planning maximum, wider than the ${anchor.minimumPercent}% to ${anchor.maximumPercent}% lifters commonly take.`,
      });
    } else if (percent < anchor.minimumPercent) {
      advisories.push({
        code: narrower,
        severity: 'note',
        intoAttempt: gap.intoAttempt,
        evidence,
        message: `The ${gap.label} jump is ${percent.toFixed(1)}% of the planning maximum, narrower than the ${anchor.minimumPercent}% to ${anchor.maximumPercent}% lifters commonly take, so it spends an attempt on very little.`,
      });
    }
  }

  if (population.comparison === 'none') {
    // §8.2: declining the comparison still produces a usable tool. The relative
    // anchors above are the general guidance it produces, already labelled.
    return advisories;
  }

  const thresholds = RESEARCH_THRESHOLDS[population.comparison][sequence.lift];
  for (const gap of gaps) {
    const limit = gap.intoAttempt === 2 ? thresholds.firstToSecond : thresholds.secondToThird;
    if (limit === null || gap.kilograms <= limit) continue;

    const strongLimit = gap.intoAttempt === 3 ? thresholds.strongSecondToThird : null;
    const severity: JumpAdvisorySeverity =
      strongLimit !== null && gap.kilograms > strongLimit ? 'strong' : 'note';
    advisories.push({
      code:
        gap.intoAttempt === 2
          ? 'first-to-second-above-research-range'
          : 'second-to-third-above-research-range',
      severity,
      intoAttempt: gap.intoAttempt,
      evidence,
      message: `A ${describeKilograms(gap.kilograms)} ${gap.label} jump is above the ${describeKilograms(limit)} that is common in the comparison group.`,
    });
  }

  return advisories;
}
