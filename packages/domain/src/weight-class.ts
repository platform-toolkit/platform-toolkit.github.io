import type { WeightClass } from '@platform-toolkit/data-contracts';

/**
 * Placing a lifter on a ladder of bodyweight classes.
 *
 * Two rules from the platform drive everything in this file:
 *
 *  1. A lifter makes a class by weighing at or under its limit. Exactly at the
 *     limit makes the class.
 *
 *  2. A lifter may always enter a class heavier than the one their bodyweight
 *     puts them in, and never a lighter one. Planning is therefore a question
 *     about a range of classes, not a single answer, and the interface has to
 *     be able to show that range.
 */

/** Why a proposed ladder could not be accepted. */
export type WeightClassLadderProblemCode =
  'empty' | 'duplicate-id' | 'not-ascending' | 'top-class-bounded' | 'unbounded-not-last';

export interface WeightClassLadderProblem {
  readonly code: WeightClassLadderProblemCode;
  /** Plain-language description, addressed to whoever maintains the data feed. */
  readonly message: string;
}

export type WeightClassLadderResult =
  | { readonly ok: true; readonly ladder: WeightClassLadder }
  | { readonly ok: false; readonly problems: readonly WeightClassLadderProblem[] };

/** Where a bodyweight sits relative to the class it makes and the one below it. */
export interface WeightClassFit {
  /** The lightest class this bodyweight makes. */
  readonly weightClass: WeightClass;

  /** How far under the limit, in kilograms. `null` in the unbounded top class. */
  readonly marginKilograms: number | null;

  /** The class immediately below, or `null` if this is already the lightest. */
  readonly nextClassDown: WeightClass | null;

  /** Kilograms that must come off to make `nextClassDown`. `null` when there is none. */
  readonly cutToNextClassDownKilograms: number | null;
}

/**
 * A ladder that has been checked, and therefore cannot fail to place a lifter.
 *
 * The constructor is private on purpose. Every ladder in the running system came
 * from {@link WeightClassLadder.from}, which means {@link WeightClassLadder.resolve}
 * can be total: no ladder exists whose heaviest class is bounded, so no bodyweight
 * falls off the end. Checking on the way in rather than defending on every read is
 * what keeps "which class am I in?" from having an error case the interface would
 * have to invent an answer for.
 */
export class WeightClassLadder {
  private constructor(readonly classes: readonly WeightClass[]) {}

  /** Checks a ladder as published and accepts it, or reports every problem found. */
  static from(classes: readonly WeightClass[]): WeightClassLadderResult {
    const problems = findProblems(classes);
    if (problems.length > 0) {
      return { ok: false, problems };
    }
    // Copied, so a caller mutating the array it passed in cannot invalidate a
    // ladder that has already been checked.
    return { ok: true, ladder: new WeightClassLadder([...classes]) };
  }

  /**
   * The lightest class this bodyweight makes.
   *
   * @throws {RangeError} if the bodyweight is not a positive finite number. That
   *   is a defect in the caller rather than a fact about a lifter, so it throws
   *   rather than being reported.
   */
  resolve(bodyweightKilograms: number): WeightClass {
    return this.locate(bodyweightKilograms).weightClass;
  }

  /**
   * Every class this lifter could enter: the one they make, and all heavier ones.
   *
   * Ordered lightest first, so the first entry is the class {@link resolve} returns.
   */
  eligible(bodyweightKilograms: number): readonly WeightClass[] {
    return this.classes.slice(this.locate(bodyweightKilograms).index);
  }

  /** Where this bodyweight sits, and what moving down a class would cost. */
  fit(bodyweightKilograms: number): WeightClassFit {
    const { index, weightClass } = this.locate(bodyweightKilograms);
    const nextClassDown = index === 0 ? null : (this.classes[index - 1] ?? null);
    const nextLimit = nextClassDown?.maximumKilograms ?? null;

    return {
      weightClass,
      // The margin rounds down and the cut rounds up. Binary floating point turns
      // `75 - 74.7` into 0.2999999999999972, which would otherwise reach the
      // interface verbatim. The directions differ on purpose: an understated
      // margin and an overstated cut are both conservative, and either opposite
      // would tell a lifter they have room they do not have. Same reasoning as
      // the ceiling in `units.ts`.
      marginKilograms:
        weightClass.maximumKilograms === null
          ? null
          : floorToHundredths(weightClass.maximumKilograms - bodyweightKilograms),
      nextClassDown,
      cutToNextClassDownKilograms:
        nextLimit === null ? null : ceilToHundredths(bodyweightKilograms - nextLimit),
    };
  }

  private locate(bodyweightKilograms: number): {
    readonly index: number;
    readonly weightClass: WeightClass;
  } {
    if (!Number.isFinite(bodyweightKilograms)) {
      throw new RangeError(
        `Expected a finite bodyweight in kilograms, received ${String(bodyweightKilograms)}`,
      );
    }
    if (bodyweightKilograms <= 0) {
      throw new RangeError(
        `Expected a positive bodyweight in kilograms, received ${bodyweightKilograms}`,
      );
    }
    for (const [index, weightClass] of this.classes.entries()) {
      if (
        weightClass.maximumKilograms === null ||
        bodyweightKilograms <= weightClass.maximumKilograms
      ) {
        return { index, weightClass };
      }
    }
    // Unreachable while `from` is the only way to build a ladder: it rejects any
    // ladder whose heaviest class is bounded.
    throw new RangeError('Ladder has no class for this bodyweight.');
  }
}

function findProblems(classes: readonly WeightClass[]): WeightClassLadderProblem[] {
  if (classes.length === 0) {
    return [{ code: 'empty', message: 'A weight class ladder must have at least one class.' }];
  }

  const problems: WeightClassLadderProblem[] = [];

  const seen = new Set<string>();
  for (const weightClass of classes) {
    if (seen.has(weightClass.id)) {
      problems.push({
        code: 'duplicate-id',
        message: `Weight class id "${weightClass.id}" appears more than once.`,
      });
    }
    seen.add(weightClass.id);
  }

  const heaviest = classes[classes.length - 1];
  if (heaviest !== undefined && heaviest.maximumKilograms !== null) {
    problems.push({
      code: 'top-class-bounded',
      message: `The heaviest class "${heaviest.id}" must be unbounded, with a null maximum.`,
    });
  }

  for (const [index, weightClass] of classes.entries()) {
    if (weightClass.maximumKilograms === null) {
      if (index !== classes.length - 1) {
        problems.push({
          code: 'unbounded-not-last',
          message: `Weight class "${weightClass.id}" is unbounded but is not the heaviest class.`,
        });
      }
      continue;
    }
    const lighter = index === 0 ? undefined : classes[index - 1];
    if (
      lighter?.maximumKilograms != null &&
      weightClass.maximumKilograms <= lighter.maximumKilograms
    ) {
      problems.push({
        code: 'not-ascending',
        message: `Weight class "${weightClass.id}" does not weigh more than "${lighter.id}".`,
      });
    }
  }

  return problems;
}

/** Weigh-ins are recorded to a hundredth of a kilogram, so margins are reported there too. */
const HUNDREDTHS = 100;

/**
 * Absorbs representation error without absorbing a real difference.
 *
 * `74.7 - 60` is 14.700000000000003, and a bare ceiling would report a cut of
 * 14.71 kg -- safe, but wrong-looking enough that a lifter would distrust the
 * rest of the screen. This slack is around a billionth of a kilogram, some seven
 * orders of magnitude below the 0.01 kg a scale reports, so it can only ever
 * cancel noise. A genuinely sub-hundredth margin still rounds away, and a
 * genuinely sub-hundredth cut still rounds up.
 */
const FLOATING_POINT_SLACK = 1e-9;

function floorToHundredths(value: number): number {
  return Math.floor(value * HUNDREDTHS + FLOATING_POINT_SLACK) / HUNDREDTHS;
}

function ceilToHundredths(value: number): number {
  return Math.ceil(value * HUNDREDTHS - FLOATING_POINT_SLACK) / HUNDREDTHS;
}
