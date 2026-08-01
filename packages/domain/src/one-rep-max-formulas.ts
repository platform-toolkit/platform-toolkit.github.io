/**
 * The published equations that estimate a one-repetition maximum from a
 * submaximal set, and nothing about how they are combined.
 *
 * WHY NUMBERS LIVE IN CODE HERE, WHEN §5.1 SAYS THEY DO NOT
 *
 * The rule elsewhere in this package is that federation figures belong in
 * published artifacts, because a federation revises them between releases and a
 * lifter planning against a stale number plans against the wrong target. A
 * published equation is the opposite kind of number: Brzycki's 36 and 37 were
 * fixed the day the paper was printed and cannot be revised by anybody. They
 * belong in code, beside the citation that fixes them.
 *
 * What is *not* a constant of the literature is which equations this tool lets
 * into its consensus and how heavily each counts. That is judgement, it changes
 * as evidence arrives, and it is why `one-rep-max.ts` carries a methodology
 * version and this file does not.
 *
 * EVERY EQUATION IS EVALUATED IN KILOGRAMS
 *
 * Most of these multiply the entered load, so the unit cancels and it makes no
 * difference. Several do not: the study-specific regressions carry intercepts
 * measured in kilograms, and feeding them pounds produces a number that is
 * wrong by a fixed amount rather than obviously broken -- roughly seven
 * kilograms, in Abadie's case, which on a bench press reads as an ordinary
 * answer. Rather than tag which equations care, every one of them takes
 * kilograms and the caller converts once.
 *
 * `null` MEANS THE EQUATION DECLINED, NOT THAT IT FAILED
 *
 * An equation returns `null` when its own conditions are not met: a denominator
 * heading for zero, a repetition count outside the range it was fitted on, a
 * lift it was never validated for. That is a real answer and the interface shows
 * it as one, because "Brzycki has nothing to say about a set of fifteen" is
 * information and a quietly missing row is not.
 */

/**
 * The lifts this calculator distinguishes.
 *
 * Deliberately fewer than `lifts.ts` offers, and the identifiers deliberately
 * match it where they overlap. Formula evidence exists for these movements and
 * not for the pin squat, so offering the full catalogue would imply a
 * lift-specific answer the literature cannot give -- but a future meet-day
 * planner has to be able to join a warm-up lift to an estimate, and it can only
 * do that if `squat` means `squat` in both places.
 */
export type EstimateLift = 'squat' | 'bench-press' | 'deadlift' | 'overhead-press' | 'other';

/** Every lift, in the order the interface offers them. The first three lead. */
export const ESTIMATE_LIFTS: readonly EstimateLift[] = [
  'squat',
  'bench-press',
  'deadlift',
  'overhead-press',
  'other',
];

/**
 * The three the evidence is actually about.
 *
 * Overhead press and "other" are calculable and are not validated, which the
 * grading cap in `one-rep-max.ts` enforces rather than merely mentioning.
 */
export const PROMINENT_LIFTS: readonly EstimateLift[] = ['squat', 'bench-press', 'deadlift'];

/**
 * How much a formula is allowed to influence the consensus.
 *
 * `core` is the seven equations the consensus is built from. `expanded` is
 * published and shown but does not vote unless something specific supports it --
 * Brown is the only one that ever does. `conditional` applies only when its
 * original test is reproduced. `experimental` is shown and never votes.
 */
export type FormulaTier = 'core' | 'expanded' | 'conditional' | 'experimental';

/**
 * The mathematical relationship behind an equation, which is not the same thing
 * as its name.
 *
 * Baechle/Welday is Epley with the coefficient written as 0.0333 instead of
 * 1/30, and Berger's linear equation is the same relationship again at 0.03.
 * Counted as three votes, one relationship outvotes every other model in the
 * median -- and it would do so silently, because three plausible names appear in
 * the table and nothing on screen says they are one idea. Grouping by family is
 * what stops that, and it is why the field exists separately from `id`.
 */
export type FormulaFamily =
  | 'epley'
  | 'brzycki'
  | 'lander'
  | 'lombardi'
  | 'mayhew'
  | 'oconner'
  | 'wathan'
  | 'adams'
  | 'brown'
  | 'berger-exponential'
  | 'kemmler'
  | 'kellner'
  | 'naclerio'
  | 'reynolds-bench'
  | 'reynolds-leg-press'
  | 'abadie'
  | 'cummings-finn'
  | 'dohoney'
  | 'weight-dependent-2026';

export type FormulaId =
  | 'epley'
  | 'brzycki'
  | 'lander'
  | 'lombardi'
  | 'mayhew'
  | 'oconner'
  | 'wathan'
  | 'adams'
  | 'brown'
  | 'baechle-welday'
  | 'berger-exponential'
  | 'berger-linear'
  | 'kemmler'
  | 'kellner'
  | 'naclerio'
  | 'reynolds-bench-5rm'
  | 'reynolds-leg-press-5rm'
  | 'abadie'
  | 'cummings-finn'
  | 'dohoney-4-6'
  | 'dohoney-7-10'
  | 'weight-dependent-2026';

export interface FormulaInput {
  /** The load lifted, in kilograms. Never the entered unit -- see the file header. */
  readonly kilograms: number;
  /** Effective maximum repetitions: completed plus any repetitions in reserve. */
  readonly reps: number;
  readonly lift: EstimateLift;
}

export interface FormulaDefinition {
  readonly id: FormulaId;
  readonly name: string;
  readonly tier: FormulaTier;
  readonly family: FormulaFamily;
  /** The equation as it is shown to a reader, which §9.2 requires. */
  readonly notation: string;
  /** Where it comes from, short enough to sit under the equation. */
  readonly source: string;
  /** The estimate in kilograms, or `null` when the equation's conditions are unmet. */
  readonly estimate: (input: FormulaInput) => number | null;
}

/**
 * The repetition count past which Brzycki stops being usable.
 *
 * Its denominator is `37 - r`, so the equation does not divide by zero until
 * thirty-seven repetitions -- but it is climbing steeply long before that, and a
 * set of fifteen produces an estimate half again as large as its neighbours'
 * with no arithmetic error anywhere. Ten is the documented range and the point
 * the requirements name for dropping it from the consensus, so it is also where
 * it stops answering at all.
 */
const BRZYCKI_MAX_REPS = 10;

/**
 * Where Kemmler's cubic stops being a fit and starts being a polynomial.
 *
 * A cubic fitted over a repetition range does whatever it likes outside it, and
 * this one turns over and starts falling: past roughly fifteen repetitions it
 * predicts a *smaller* maximum for a longer set. That is not a wrong number a
 * reader can spot, it is a wrong number that looks conservative.
 */
const KEMMLER_MAX_REPS = 12;

/** Below this the 2026 equation's denominator is zero or negative. */
const WEIGHT_DEPENDENT_MINIMUM_KILOGRAMS = 2;

/**
 * A guard for every equation with a denominator.
 *
 * Not `!== 0`: a denominator of a thousandth produces an estimate of several
 * thousand kilograms, which is not a division error and will render as a number.
 */
function positiveDenominator(value: number): number | null {
  return value > 1e-6 ? value : null;
}

function finiteOrNull(value: number | null): number | null {
  if (value === null) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * Every equation this build knows, in the order the methodology lists them.
 *
 * Core first, then the wider published library, then the study-specific
 * regressions, then the experimental one. The order is what the interface shows,
 * so it is a reading order rather than an alphabet.
 */
export const FORMULAS: readonly FormulaDefinition[] = [
  {
    id: 'epley',
    name: 'Epley',
    tier: 'core',
    family: 'epley',
    notation: '1RM = w × (1 + r / 30)',
    source: 'Epley, 1985. The most widely used general estimate.',
    estimate: ({ kilograms, reps }) => kilograms * (1 + reps / 30),
  },
  {
    id: 'brzycki',
    name: 'Brzycki',
    tier: 'core',
    family: 'brzycki',
    notation: '1RM = w × 36 / (37 - r)',
    source: 'Brzycki, 1993. Conservative to middling at low and moderate repetitions.',
    estimate: ({ kilograms, reps }) => {
      if (reps > BRZYCKI_MAX_REPS) return null;
      const denominator = positiveDenominator(37 - reps);
      return denominator === null ? null : (kilograms * 36) / denominator;
    },
  },
  {
    id: 'lander',
    name: 'Lander',
    tier: 'core',
    family: 'lander',
    notation: '1RM = 100w / (101.3 - 2.67123r)',
    source: 'Lander, 1985. Linear denominator; similar to Brzycki through the middle.',
    estimate: ({ kilograms, reps }) => {
      const denominator = positiveDenominator(101.3 - 2.67123 * reps);
      return denominator === null ? null : (100 * kilograms) / denominator;
    },
  },
  {
    id: 'lombardi',
    name: 'Lombardi',
    tier: 'core',
    family: 'lombardi',
    notation: '1RM = w × r^0.10',
    source: "Lombardi, 1989. Most accurate for young men's bench press and squat (Ribeiro, 2024).",
    estimate: ({ kilograms, reps }) => kilograms * reps ** 0.1,
  },
  {
    id: 'mayhew',
    name: 'Mayhew',
    tier: 'core',
    family: 'mayhew',
    notation: '1RM = 100w / (52.2 + 41.9e^(-0.055r))',
    source: 'Mayhew et al., 1992. Curved model fitted on bench-press endurance data.',
    estimate: ({ kilograms, reps }) => {
      const denominator = positiveDenominator(52.2 + 41.9 * Math.exp(-0.055 * reps));
      return denominator === null ? null : (100 * kilograms) / denominator;
    },
  },
  {
    id: 'oconner',
    name: "O'Conner",
    tier: 'core',
    family: 'oconner',
    notation: '1RM = w × (1 + 0.025r)',
    source: "O'Conner et al., 1989. The most conservative of the core linear models.",
    estimate: ({ kilograms, reps }) => kilograms * (1 + 0.025 * reps),
  },
  {
    id: 'wathan',
    name: 'Wathan',
    tier: 'core',
    family: 'wathan',
    notation: '1RM = 100w / (48.8 + 53.8e^(-0.075r))',
    source: 'Wathan, 1994. Curved model used as a moderate-repetition cross-check.',
    estimate: ({ kilograms, reps }) => {
      const denominator = positiveDenominator(48.8 + 53.8 * Math.exp(-0.075 * reps));
      return denominator === null ? null : (100 * kilograms) / denominator;
    },
  },

  {
    id: 'brown',
    name: 'Brown',
    tier: 'expanded',
    family: 'brown',
    notation: '1RM = w × (0.9849 + 0.0328r)',
    source:
      "Brown, 1992. Similar to measured 1RM in young women's bench press and squat (Ribeiro, 2024).",
    estimate: ({ kilograms, reps }) => kilograms * (0.9849 + 0.0328 * reps),
  },
  {
    id: 'adams',
    name: 'Adams',
    tier: 'expanded',
    family: 'adams',
    notation: '1RM = w / (1 - 0.02r)',
    source: 'Adams, 1994. Published estimate; no lift-specific validation in the sources here.',
    estimate: ({ kilograms, reps }) => {
      const denominator = positiveDenominator(1 - 0.02 * reps);
      return denominator === null ? null : kilograms / denominator;
    },
  },
  {
    id: 'baechle-welday',
    name: 'Baechle / Welday',
    tier: 'expanded',
    family: 'epley',
    notation: '1RM = w × (1 + 0.0333r)',
    source: "Baechle and Welday. Epley's relationship with the coefficient written out.",
    estimate: ({ kilograms, reps }) => kilograms * (1 + 0.0333 * reps),
  },
  {
    id: 'berger-linear',
    name: 'Berger (linear)',
    tier: 'expanded',
    family: 'epley',
    notation: '1RM = w × (1 + 0.03r)',
    source: 'Berger, 1961. Historical linear estimate in the Epley family.',
    estimate: ({ kilograms, reps }) => kilograms * (1 + 0.03 * reps),
  },
  {
    id: 'berger-exponential',
    name: 'Berger (exponential)',
    tier: 'expanded',
    family: 'berger-exponential',
    notation: '1RM = w / (1.0261e^(-0.0262r))',
    source: 'Berger, 1961. Historical exponential form.',
    estimate: ({ kilograms, reps }) => {
      const denominator = positiveDenominator(1.0261 * Math.exp(-0.0262 * reps));
      return denominator === null ? null : kilograms / denominator;
    },
  },
  {
    id: 'kemmler',
    name: 'Kemmler',
    tier: 'expanded',
    family: 'kemmler',
    notation: '1RM = w × (0.988 + 0.0104r + 0.00190r² - 0.0000584r³)',
    source: 'Kemmler et al., 2006. Cubic fit; valid only inside the range it was fitted on.',
    estimate: ({ kilograms, reps }) => {
      if (reps > KEMMLER_MAX_REPS) return null;
      return kilograms * (0.988 + 0.0104 * reps + 0.0019 * reps ** 2 - 0.0000584 * reps ** 3);
    },
  },
  {
    id: 'kellner',
    name: 'Kellner',
    tier: 'expanded',
    family: 'kellner',
    notation: '1RM = w × 0.98e^(0.0338r)',
    source: 'Kellner. Additional exponential model.',
    estimate: ({ kilograms, reps }) => kilograms * 0.98 * Math.exp(0.0338 * reps),
  },
  {
    id: 'naclerio',
    name: 'Naclerio',
    tier: 'expanded',
    family: 'naclerio',
    notation: '1RM = w / (0.951e^(-0.021r))',
    source: 'Naclerio et al. Additional exponential model; no powerlift-specific support here.',
    estimate: ({ kilograms, reps }) => {
      const denominator = positiveDenominator(0.951 * Math.exp(-0.021 * reps));
      return denominator === null ? null : kilograms / denominator;
    },
  },

  {
    id: 'reynolds-bench-5rm',
    name: 'Reynolds (bench 5RM)',
    tier: 'conditional',
    family: 'reynolds-bench',
    notation: '1RM = 1.1307 × 5RM + 0.6999   (kilograms)',
    source: 'Reynolds et al., 2006. Fitted on a bench-press five-repetition maximum.',
    estimate: ({ kilograms, reps, lift }) => {
      if (lift !== 'bench-press' || reps !== 5) return null;
      return 1.1307 * kilograms + 0.6999;
    },
  },
  {
    // Kept in the library on purpose, permanently unavailable, because the
    // alternative is worse. This equation is published, it is easy to find, and
    // the obvious thing to do with it is apply it to the squat -- which it was
    // not fitted on and does not describe. A row saying so is a warning; leaving
    // it out is a gap that reads as an oversight.
    id: 'reynolds-leg-press-5rm',
    name: 'Reynolds (leg press 5RM)',
    tier: 'conditional',
    family: 'reynolds-leg-press',
    notation: '1RM = 1.0970 × 5RM + 14.2546   (kilograms)',
    source: 'Reynolds et al., 2006. Fitted on the leg press, which this tool does not offer.',
    estimate: () => null,
  },
  {
    id: 'abadie',
    name: 'Abadie',
    tier: 'conditional',
    family: 'abadie',
    notation: '1RM = 7.24 + 1.05w   (kilograms)',
    source:
      'Abadie. A study-specific load regression whose original test conditions are not reproduced here.',
    estimate: ({ kilograms }) => 7.24 + 1.05 * kilograms,
  },
  {
    id: 'cummings-finn',
    name: 'Cummings and Finn',
    tier: 'conditional',
    family: 'cummings-finn',
    notation: '1RM = 1.175w + 0.839r - 4.29787   (kilograms)',
    source: 'Cummings and Finn. Study-specific regression, not a general powerlifting equation.',
    estimate: ({ kilograms, reps }) => 1.175 * kilograms + 0.839 * reps - 4.29787,
  },
  {
    id: 'dohoney-4-6',
    name: 'Dohoney (4–6RM)',
    tier: 'conditional',
    family: 'dohoney',
    notation: '1RM = -24.62 + 1.12w + 5.09r   (kilograms)',
    source: 'Dohoney et al., 2002. Fitted on four- to six-repetition maxima.',
    estimate: ({ kilograms, reps }) => {
      if (reps < 4 || reps > 6) return null;
      return -24.62 + 1.12 * kilograms + 5.09 * reps;
    },
  },
  {
    id: 'dohoney-7-10',
    name: 'Dohoney (7–10RM)',
    tier: 'conditional',
    family: 'dohoney',
    notation: '1RM = -1.89 + 1.16w + 1.68r   (kilograms)',
    source: 'Dohoney et al., 2002. Fitted on seven- to ten-repetition maxima.',
    estimate: ({ kilograms, reps }) => {
      if (reps < 7 || reps > 10) return null;
      return -1.89 + 1.16 * kilograms + 1.68 * reps;
    },
  },

  {
    id: 'weight-dependent-2026',
    name: 'Weight-dependent (2026 preprint)',
    tier: 'experimental',
    family: 'weight-dependent-2026',
    notation: '1RM = w × (1 + (r - 1)^0.85 / (-2.55 + 4.58 ln w))   (kilograms)',
    source:
      'Marzagão, 2026 preprint. Optimized on 303,494 near-failure sets from a consumer fitness app; the data contained no directly measured maxima.',
    estimate: ({ kilograms, reps }) => {
      // The equation is weight-magnitude dependent through `ln w`, so the
      // kilogram normalisation every formula here gets is not a convenience for
      // this one -- in pounds it is a different curve.
      if (kilograms < WEIGHT_DEPENDENT_MINIMUM_KILOGRAMS) return null;
      const denominator = positiveDenominator(-2.55 + 4.58 * Math.log(kilograms));
      if (denominator === null) return null;
      return kilograms * (1 + (reps - 1) ** 0.85 / denominator);
    },
  },
];

const BY_ID: ReadonlyMap<string, FormulaDefinition> = new Map(
  FORMULAS.map((formula) => [formula.id, formula]),
);

/**
 * One equation by identifier, or `null` for one this build does not carry.
 *
 * Takes a `string` rather than a `FormulaId` because the identifiers that reach
 * it come from outside the type system: a stored result written by an earlier
 * methodology version, or a query parameter. Narrowing the parameter would push
 * a cast to every caller, which is the opposite of checking.
 */
export function findFormula(id: string): FormulaDefinition | null {
  return BY_ID.get(id) ?? null;
}

/** Every formula in one tier, in library order. */
export function formulasInTier(tier: FormulaTier): readonly FormulaDefinition[] {
  return FORMULAS.filter((formula) => formula.tier === tier);
}

/** Evaluates one equation, in kilograms, or `null` when it declines. */
export function evaluateFormula(formula: FormulaDefinition, input: FormulaInput): number | null {
  return finiteOrNull(formula.estimate(input));
}
