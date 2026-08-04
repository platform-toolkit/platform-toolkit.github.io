// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §9.4's personal calibration: what this lifter's own past meets say.
 *
 * Everywhere else in this collection the advice comes from a population -- §9.2's
 * relative anchors, §9.3's research ranges, the classification tables. This is the
 * one module whose only evidence is the lifter in front of it, and that changes
 * what a wrong answer costs. A population figure that does not fit reads as
 * generic advice and gets ignored. A figure drawn from somebody's own two meets
 * reads as a fact about them, and a lifter told "your third attempts go up two
 * times in three" will believe it whether or not three attempts is enough to know.
 *
 * So the shape of every answer here is a figure **with the number of observations
 * behind it**, and a strength that says what may be done with it:
 *
 *   not-enough   fewer meets than §9.4's own floor. Show it, labelled, or not at
 *                all -- but never as a trend.
 *   indicative   enough to describe, not enough to plan from.
 *   established  enough that a screen may lead with it.
 *
 * §9.4's one hard rule is the first of those: "Do not call a personal trend
 * reliable after one meet." `MEETS_BEFORE_A_TREND` is that sentence and nothing
 * more. The second threshold is a judgement and is documented as one below.
 *
 * NOTHING HERE FEEDS A RECOMMENDATION YET, AND THAT IS DELIBERATE
 *
 * §9.4 says to elevate personal history into a recommendation factor "only after
 * there are enough comparable observations". No module in `live-choices.ts` or
 * `attempt-plan.ts` takes a `CalibrationReport`, and none should be given one
 * until there is a real corpus to decide the threshold against -- picking it from
 * a synthetic fixture would be inventing the very confidence this file exists to
 * report honestly. `elevatable` is the flag a future caller would gate on; today
 * it is read by an interface that shows the figure and by nothing that acts on it.
 *
 * MEDIANS, NOT MEANS
 *
 * A lifter who opened forty kilograms light at one meet has one enormous
 * first-to-second in their history, and a mean drags every figure toward it for
 * the rest of their career. The median moves by one place in the sorted list
 * instead. Where the count is even the lower of the two middle values is taken
 * rather than their average, which keeps every figure reported here a weight that
 * was actually taken -- an averaged 8.75 kg jump is a weight no bar was loaded to
 * and reads as precision that is not there.
 *
 * EQUIPMENT KEEPS HISTORY APART
 *
 * §9.4: "Keep raw, wraps, and equipped history separate unless the user explicitly
 * combines them." So the scope is an input, meets outside it are dropped, and the
 * count of what was dropped comes back -- a report built from three of a lifter's
 * eight meets with no way to say so is a screen that looks like it lost five.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import type { MissReason } from './meet-document.js';

/*
 * ---------------------------------------------------------------------------
 * What the caller supplies.
 * ---------------------------------------------------------------------------
 */

/**
 * Which of §9.4's three histories a meet belongs to.
 *
 * `unstated` is its own value rather than a default onto `raw`. A lifter who never
 * answered the equipment question has meets that belong to no comparison group,
 * and quietly filing them under raw would put an equipped total into a raw
 * lifter's calibration -- the one mixture §9.4 names.
 */
export type HistoryEquipment = 'raw' | 'wraps' | 'equipped' | 'unstated';

/** One completed attempt from a past meet, reduced to what calibration reads. */
export interface HistoricAttempt {
  /** 1, 2 or 3. A fourth-attempt record try is not a competition attempt and is not here. */
  readonly attemptNumber: number;
  readonly kilograms: number;
  readonly outcome: 'good' | 'no-lift' | 'passed';
  /** Present on a miss, `null` otherwise. */
  readonly missReason: MissReason | null;
}

export interface HistoricLift {
  readonly lift: PlatformLift;
  /** In attempt order. A lift that was not contested has none. */
  readonly attempts: readonly HistoricAttempt[];
  /**
   * The maximum the plan was built from, or `null` where the lifter confirmed none.
   *
   * §9.4's "performance relative to planned maximum" is unanswerable without it,
   * and a lifter who declined §7's confirmation genuinely has no planned maximum
   * -- so that lift contributes to every other figure and to that one not at all.
   */
  readonly plannedMaximumKilograms: number | null;
}

export interface HistoricMeet {
  /** Stable across sessions, so a report can say which meets it read. */
  readonly meetId: string;
  readonly equipment: HistoryEquipment;
  readonly lifts: readonly HistoricLift[];
}

/**
 * Which meets count as comparable, per §9.4's last sentence.
 *
 * `combineEquipment` is the "unless the user explicitly combines them" half, and it
 * is a boolean the caller has to set rather than a default: combining is a decision
 * a lifter makes, and a scope that combined by accident produces a report that is
 * wrong in the direction of looking richer.
 */
export interface HistoryScope {
  readonly equipment: HistoryEquipment;
  readonly combineEquipment: boolean;
}

/*
 * ---------------------------------------------------------------------------
 * The thresholds.
 * ---------------------------------------------------------------------------
 */

/**
 * §9.4's own floor, stated as a number: one meet is not a trend.
 *
 * This is the requirement rather than a judgement, which is why it is two and not
 * something more defensible-sounding. Below it nothing here is called a trend, in
 * any wording, at any confidence.
 */
export const MEETS_BEFORE_A_TREND = 2;

/**
 * Where "enough comparable observations" is drawn, and it is a judgement.
 *
 * §9.4 asks for a threshold and names none, so this one is chosen rather than
 * derived, and the reasoning is the median's: with three observations the middle
 * value is one of three, so a single new meet can move a reported jump by the
 * whole gap between two of them. With five, one new observation moves the median
 * by at most one step in a sorted list that already has a shape. Five is also
 * roughly two meets' worth of one lift's jumps, which is the smallest history a
 * lifter would recognise as their own.
 *
 * Revisit it against a real corpus. Do not tune it to make a fixture read better.
 */
export const OBSERVATIONS_FOR_A_TREND = 5;

/**
 * How much weight a figure can carry.
 *
 * Three values rather than a count, because every interface asking this question
 * asks it as "may I lead with this" and would otherwise each pick their own
 * boundary -- which is how one screen calls a history established and the next
 * calls the same history thin.
 */
export type HistoryStrength = 'not-enough' | 'indicative' | 'established';

/*
 * ---------------------------------------------------------------------------
 * What comes back.
 * ---------------------------------------------------------------------------
 */

/**
 * A figure and what stands behind it.
 *
 * `kilograms` is `null` where the observations exist but none of them answered
 * this question -- a lifter who has never missed has no typical missed jump, and
 * that is a fact about them rather than a gap in the data. `observations` is
 * therefore not redundant with it: zero and null mean different things and both
 * are worth printing.
 */
export interface CalibrationFigure {
  readonly kilograms: number | null;
  readonly observations: number;
  readonly strength: HistoryStrength;
}

/**
 * The same shape for a figure that is a share rather than a weight.
 *
 * Two near-identical interfaces rather than one with a unit-free `value`, because a
 * field called `kilograms` holding 96.4 is how a screen prints "96.4 kg" for a
 * lifter who reached 96% of their planned maximum, and no type would have caught it.
 */
export interface CalibrationShare {
  readonly percent: number | null;
  readonly observations: number;
  readonly strength: HistoryStrength;
}

/** A count of attempts and how many of them went up. */
export interface AttemptSuccess {
  readonly taken: number;
  readonly made: number;
  readonly strength: HistoryStrength;
}

export interface CalibrationLift {
  readonly lift: PlatformLift;
  /** §9.4's "typical successful jumps", as the median gap into a made attempt. */
  readonly successfulJump: CalibrationFigure;
  /** §9.4's "typical missed jumps". */
  readonly missedJump: CalibrationFigure;
  readonly secondAttempts: AttemptSuccess;
  readonly thirdAttempts: AttemptSuccess;
  /**
   * §9.4's "performance relative to planned maximum", as a percentage.
   *
   * The best good lift over the maximum the plan was built from, per meet, then
   * the median. Above a hundred means the lifter beat the figure they planned
   * from; below means they did not reach it. Reported as a share rather than as a
   * kilogram difference because the lifts are different sizes and a lifter reading
   * three rows is comparing them.
   */
  readonly reachedOfPlannedPercent: CalibrationShare;
}

/**
 * §9.4's "whether large misses cluster around a particular lift".
 *
 * One lift, or `null` for a history whose misses are spread. The share is of every
 * strength miss in scope, not of that lift's own attempts: the question is where a
 * lifter's misses go, and a lift with two misses out of three attempts is not the
 * answer if another lift has six.
 */
export interface MissCluster {
  readonly lift: PlatformLift;
  readonly misses: number;
  readonly ofMisses: number;
  readonly strength: HistoryStrength;
}

/**
 * How far above an even spread a lift's share of the misses has to sit.
 *
 * A third of the misses on one of three lifts is no cluster at all, so the test is
 * against the even share for the number of lifts that were contested, times this.
 * Chosen, not derived: it is the point at which a lifter looking at their own
 * record would say "it is always the bench" rather than "the bench a bit more".
 */
const CLUSTER_MULTIPLE = 1.5;

/** The fewest strength misses worth calling a pattern rather than a bad day. */
const MISSES_BEFORE_A_CLUSTER = 3;

export interface CalibrationReport {
  /** Meets read, after the equipment scope was applied. */
  readonly meetsRead: number;
  /** Meets the scope excluded, so a screen can say what it is not showing. */
  readonly meetsOutOfScope: number;
  readonly scope: HistoryScope;
  /**
   * The report's own strength, which is the meet count and nothing else.
   *
   * A lift may have plenty of observations from one meet -- three attempts is
   * three -- and §9.4's rule is about meets, not attempts. So this caps what any
   * figure in the report may claim, and `strengthOf` reads both.
   */
  readonly strength: HistoryStrength;
  readonly lifts: readonly CalibrationLift[];
  readonly missCluster: MissCluster | null;
  /**
   * Whether §9.4 permits this history to become a recommendation factor.
   *
   * Nothing consults it yet; see the module header. It is here so that the day
   * something does, the condition is in one place and is the one §9.4 states,
   * rather than an inequality written into whichever module got there first.
   */
  readonly elevatable: boolean;
}

/** A report from no history at all, which is what a first meet produces. */
export const NO_CALIBRATION: CalibrationReport = {
  meetsRead: 0,
  meetsOutOfScope: 0,
  scope: { equipment: 'unstated', combineEquipment: false },
  strength: 'not-enough',
  lifts: [],
  missCluster: null,
  elevatable: false,
};

/*
 * ---------------------------------------------------------------------------
 * Building it.
 * ---------------------------------------------------------------------------
 */

function inScope(meet: HistoricMeet, scope: HistoryScope): boolean {
  if (scope.combineEquipment) return true;
  return meet.equipment === scope.equipment;
}

/**
 * The middle value, taking the lower of two on an even count.
 *
 * Not the average of the two, so every figure this module reports is a gap some
 * bar was actually loaded to. See the module header.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor((sorted.length - 1) / 2);
  return sorted[index] ?? null;
}

/**
 * The two strengths a figure sits under, taking the weaker.
 *
 * A lift with nine observations from one meet is still one meet, and one meet is
 * §9.4's named failure. A lift with one observation across five meets is five
 * meets and one observation, which is not a trend either.
 */
function strengthOf(meets: number, observations: number): HistoryStrength {
  if (meets < MEETS_BEFORE_A_TREND) return 'not-enough';
  if (observations < OBSERVATIONS_FOR_A_TREND) return 'indicative';
  return 'established';
}

/**
 * The weight the jump into this attempt is measured from.
 *
 * The nearest earlier attempt that was contested. A passed attempt is skipped
 * rather than treated as the floor: passing declares no weight the lifter took, so
 * measuring the third from a passed second would report a jump nobody made -- and
 * would report it as small, which is the flattering direction.
 */
function previousContested(
  attempts: readonly HistoricAttempt[],
  index: number,
): HistoricAttempt | null {
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    const attempt = attempts[earlier];
    if (attempt === undefined) continue;
    if (attempt.outcome !== 'passed') return attempt;
  }
  return null;
}

interface LiftObservations {
  readonly successfulJumps: number[];
  readonly missedJumps: number[];
  readonly reachedPercents: number[];
  secondsTaken: number;
  secondsMade: number;
  thirdsTaken: number;
  thirdsMade: number;
  strengthMisses: number;
  contested: boolean;
}

function emptyObservations(): LiftObservations {
  return {
    successfulJumps: [],
    missedJumps: [],
    reachedPercents: [],
    secondsTaken: 0,
    secondsMade: 0,
    thirdsTaken: 0,
    thirdsMade: 0,
    strengthMisses: 0,
    contested: false,
  };
}

function readLift(lift: HistoricLift, into: LiftObservations): void {
  const attempts = lift.attempts;
  if (attempts.length > 0) into.contested = true;

  // An indexed loop rather than `forEach`, because the callback's assignments to
  // `best` are invisible to control-flow narrowing: the compiler reads it as still
  // `null` afterwards and the lint rule then calls the guard below dead.
  let best: number | null = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (attempt === undefined) continue;

    if (attempt.outcome === 'good' && (best === null || attempt.kilograms > best)) {
      best = attempt.kilograms;
    }
    if (attempt.outcome === 'no-lift' && attempt.missReason === 'strength') {
      into.strengthMisses += 1;
    }
    if (attempt.attemptNumber === 2 && attempt.outcome !== 'passed') {
      into.secondsTaken += 1;
      if (attempt.outcome === 'good') into.secondsMade += 1;
    }
    if (attempt.attemptNumber === 3 && attempt.outcome !== 'passed') {
      into.thirdsTaken += 1;
      if (attempt.outcome === 'good') into.thirdsMade += 1;
    }

    if (attempt.outcome === 'passed') continue;
    const from = previousContested(attempts, index);
    if (from === null) continue;
    const jump = attempt.kilograms - from.kilograms;
    // A non-positive gap is a corrected entry or a lowered attempt after an
    // official's ruling, not a jump. Counting it would pull the median toward
    // zero and report a lifter as taking smaller jumps than they take.
    if (jump <= 0) continue;
    if (attempt.outcome === 'good') into.successfulJumps.push(jump);
    else into.missedJumps.push(jump);
  }

  const planned = lift.plannedMaximumKilograms;
  if (best !== null && planned !== null && planned > 0) {
    into.reachedPercents.push((best / planned) * 100);
  }
}

function figureFor(values: readonly number[], meets: number): CalibrationFigure {
  return {
    kilograms: median(values),
    observations: values.length,
    strength: strengthOf(meets, values.length),
  };
}

function shareFor(values: readonly number[], meets: number): CalibrationShare {
  const middle = median(values);
  return {
    // One decimal. A share carried to fourteen places is arithmetic showing
    // through, and rounding it here means every reader rounds it the same way.
    percent: middle === null ? null : Math.round(middle * 10) / 10,
    observations: values.length,
    strength: strengthOf(meets, values.length),
  };
}

function clusterFrom(
  perLift: ReadonlyMap<PlatformLift, LiftObservations>,
  meets: number,
): MissCluster | null {
  let total = 0;
  let contested = 0;
  for (const observations of perLift.values()) {
    total += observations.strengthMisses;
    if (observations.contested) contested += 1;
  }
  if (total < MISSES_BEFORE_A_CLUSTER || contested < 2) return null;

  const evenShare = total / contested;
  let worst: MissCluster | null = null;
  for (const [lift, observations] of perLift) {
    if (observations.strengthMisses < evenShare * CLUSTER_MULTIPLE) continue;
    if (worst !== null && observations.strengthMisses <= worst.misses) continue;
    worst = {
      lift,
      misses: observations.strengthMisses,
      ofMisses: total,
      strength: strengthOf(meets, total),
    };
  }
  return worst;
}

/**
 * Everything §9.4 asks about a lifter's own record, with its evidence attached.
 *
 * Lifts come back in the order they were first seen in the history, so a report
 * reads in the order the lifter's own meets were contested rather than in an order
 * this module imposed. A lift nobody has contested is absent rather than present
 * and empty -- an empty row reads as a lift that went badly.
 */
export function calibrateFrom(
  history: readonly HistoricMeet[],
  scope: HistoryScope,
): CalibrationReport {
  const read = history.filter((meet) => inScope(meet, scope));
  const meets = read.length;
  const perLift = new Map<PlatformLift, LiftObservations>();

  for (const meet of read) {
    for (const lift of meet.lifts) {
      const observations = perLift.get(lift.lift) ?? emptyObservations();
      readLift(lift, observations);
      perLift.set(lift.lift, observations);
    }
  }

  const lifts: CalibrationLift[] = [];
  for (const [lift, observations] of perLift) {
    if (!observations.contested) continue;
    lifts.push({
      lift,
      successfulJump: figureFor(observations.successfulJumps, meets),
      missedJump: figureFor(observations.missedJumps, meets),
      secondAttempts: {
        taken: observations.secondsTaken,
        made: observations.secondsMade,
        strength: strengthOf(meets, observations.secondsTaken),
      },
      thirdAttempts: {
        taken: observations.thirdsTaken,
        made: observations.thirdsMade,
        strength: strengthOf(meets, observations.thirdsTaken),
      },
      reachedOfPlannedPercent: shareFor(observations.reachedPercents, meets),
    });
  }

  const strength = strengthOf(meets, meets);
  return {
    meetsRead: meets,
    meetsOutOfScope: history.length - meets,
    scope,
    strength,
    lifts,
    missCluster: clusterFrom(perLift, meets),
    elevatable: strength === 'established',
  };
}
