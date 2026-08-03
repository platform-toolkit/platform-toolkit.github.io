// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What a federation's rules permit, as arithmetic.
 *
 * The profile this wraps is published data (`data-contracts/meet-rules.ts`) and
 * this file is the only place that reads it. Everything above -- the planner, the
 * live screen, the coach board -- asks questions in the language of a meet ("what
 * is the lightest weight this next attempt may be?") and never touches an
 * increment or a deadline directly. That separation is the point: a rulebook
 * revision is then a data refresh, and the code that has to be re-read when one
 * lands is this file and nothing else.
 *
 * TWO KINDS OF ANSWER, AND ONLY ONE OF THEM IS ENFORCEABLE
 *
 * Some rules are arithmetic the application can hold a lifter to -- the bar is a
 * multiple of 2.5 kg, an attempt is never below a weight already missed. Others
 * depend on the room: whether the speaker has already called the lifter to a
 * loaded bar, whether the previous lifter's weight now floors a change. The
 * application cannot see the platform, so those are carried as *conditions to
 * state*, never as conditions to assume. A planner that quietly assumed a change
 * was still available is the reason somebody walks to the expeditor and is turned
 * away in the round where there is no time left to recover.
 *
 * NOTHING HERE IS AUTHORITATIVE
 *
 * The head referee, the expeditor and the official scoring table are. This is a
 * reading of a document, made on a date the profile records, and every answer it
 * gives is one a lifter should be able to check. That is why a refusal names the
 * rule rather than merely returning false.
 */
import type {
  AutomaticAttemptBehaviour,
  MeetFormat,
  MeetRuleProfile,
  PlatformLift,
  TieBreakStep,
} from '@platform-toolkit/data-contracts';

import { ceilToIncrement, floorToIncrement, roundToIncrement } from './rounding.js';

/**
 * How close two kilogram figures may be and still count as the same weight.
 *
 * Half a gram, which is two orders of magnitude finer than the smallest record
 * increment either published federation uses and far coarser than the dust a
 * float divide leaves behind. Attempts arrive here having been through a
 * conversion from pounds and a rounding step, so exact equality would report a
 * repeat as an increase every time somebody typed in the wrong unit first.
 */
const SAME_WEIGHT_SLACK = 0.000_5;

function isSameWeight(left: number, right: number): boolean {
  return Math.abs(left - right) <= SAME_WEIGHT_SLACK;
}

function isAtLeast(value: number, floor: number): boolean {
  return value >= floor - SAME_WEIGHT_SLACK;
}

/** A problem with a profile, reported with a code so an interface can route on it. */
export type MeetRuleProblemCode =
  | 'duplicate-third-attempt-lift'
  | 'duplicate-format-override'
  | 'record-increment-not-a-relaxation'
  | 'fourth-attempt-window-narrower-than-its-margin'
  | 'tie-break-repeats-a-step'
  | 'tie-break-continues-past-a-declared-tie';

export interface MeetRuleProblem {
  readonly code: MeetRuleProblemCode;
  readonly message: string;
}

export type MeetRulesResult =
  | { readonly ok: true; readonly rules: MeetRules }
  | { readonly ok: false; readonly problems: readonly MeetRuleProblem[] };

/** Whether a lift on the platform counted, or was never taken. */
export type AttemptOutcome = 'good' | 'no-lift' | 'passed';

/** One attempt already behind the lifter, as the planner recorded it. */
export interface TakenAttempt {
  /** 1, 2 or 3 in the competition; 4 for a record attempt. */
  readonly attemptNumber: number;
  readonly kilograms: number;
  readonly outcome: AttemptOutcome;
}

/** Why the next attempt cannot be lighter than it is. */
export type AttemptFloorReason =
  /** Nothing has been attempted yet, so the floor is an empty bar. */
  | 'no-attempts-yet'
  /** The last attempt was good, so the bar must rise by at least the progression. */
  | 'progression-after-a-good-lift'
  /** Any increase, from a miss, is still at least one progression. */
  | 'minimum-progression'
  /** A weight already missed may not be requested again lower. */
  | 'not-below-a-failed-attempt'
  /** The bar only rises within a round. */
  | 'rising-bar';

/**
 * The bounds on the next attempt, and the rules that set them.
 *
 * `repeatAllowed` is separate from `minimumKilograms` because the legal set is
 * not an interval. After a miss a lifter may take the same weight again *or* go
 * up by at least the progression, and nothing in between -- so a single floor
 * would either forbid the repeat or admit a 0.5 kg increase, and both are wrong
 * in a way that only shows up at the expeditor's table.
 */
export interface NextAttemptBounds {
  /**
   * The lightest weight above a repeat that the next attempt may be.
   *
   * Already a legal bar weight: it has been rounded up onto the profile's own
   * multiple, so a caller never has to do that itself and cannot do it in the
   * wrong direction.
   */
  readonly minimumKilograms: number;

  /** Whether the exact weight of the previous attempt may be taken again. */
  readonly repeatAllowed: boolean;

  /** The weight a repeat would be, or `null` when there is nothing to repeat. */
  readonly repeatKilograms: number | null;

  /**
   * The heaviest weight already missed, where the profile forbids going under it.
   *
   * Separate from `minimumKilograms` because it explains a *different* refusal.
   * Told "that is less than one progression above your last attempt", a lifter
   * who just missed 100 kg and typed 98 goes looking for the arithmetic; told
   * "you have already missed 100 kg", they have the rule.
   */
  readonly failedFloorKilograms: number | null;

  /** Which rules produced the floor, so a screen can say why rather than assert. */
  readonly reasons: readonly AttemptFloorReason[];
}

/** Why a weight is not a legal next attempt. */
export type AttemptRefusalCode =
  'not-a-legal-bar-weight' | 'below-the-minimum-progression' | 'below-a-failed-attempt';

export type AttemptLegality =
  | { readonly legal: true }
  | { readonly legal: false; readonly reasons: readonly AttemptRefusalCode[] };

/** What the officials will write down if nobody submits in time. */
export interface AutomaticAttempt {
  readonly kilograms: number;
  readonly behaviour: AutomaticAttemptBehaviour;
  readonly seconds: number;
}

/** A condition on a change that the application cannot observe and must state. */
export type ChangeConditionCode =
  'lapses-once-called-to-a-loaded-bar' | 'not-below-the-preceding-lifter';

/** Whether an attempt may still be changed, how often, and on what terms. */
export interface ChangeAllowance {
  readonly allowed: number;
  readonly used: number;
  readonly remaining: number;
  /** Conditions the user must check with an official. Never enforced here. */
  readonly conditions: readonly ChangeConditionCode[];
  /** The rule in the rulebook's own terms, where the profile gave one. */
  readonly summary: string | null;
}

/** Why a fourth attempt is not available. */
export type FourthAttemptBlockCode =
  /** This federation does not have fourth attempts at all. */
  | 'not-offered'
  /** The third attempt was not good. */
  | 'third-attempt-not-successful'
  /** No record was given to measure against. */
  | 'no-record-supplied'
  /** The lifter is further from the record than the profile allows. */
  | 'outside-the-record-window';

export type FourthAttemptEligibility =
  | { readonly eligible: false; readonly reasons: readonly FourthAttemptBlockCode[] }
  | {
      readonly eligible: true;
      /** The lightest weight that would take the record, already a legal figure. */
      readonly minimumKilograms: number;
      readonly requiresPermission: boolean;
      readonly requiresPostLiftEquipmentCheck: boolean;
      readonly submissionSeconds: number;
      readonly excludedFrom: readonly string[];
      readonly summary: string;
    };

/** Three legal weights around a figure a lifter typed, none of them chosen. */
export interface LegalWeightsAround {
  /** The heaviest legal weight at or below the figure, or `null` if the floor is above it. */
  readonly below: number | null;
  /** The lightest legal weight at or above the figure. */
  readonly above: number;
  /**
   * Whichever of the two is closer, with a tie going to the lighter.
   *
   * The tie rule is the §16 requirement in one line: never silently choose the
   * heavier result. A lifter who typed a number between two legal weights has not
   * asked for either, and the one that gets picked for them must not be the one
   * that is harder to lift.
   */
  readonly nearest: number;
}

/**
 * One federation's rules, checked once and then total.
 *
 * A private constructor and a `from` that reports every problem at once, per
 * §5.5. The checks are the ones that make an answer below impossible rather than
 * merely odd -- a duplicated lift in the change table means two answers to one
 * question, and resolving it by document order would be a coin toss over whether
 * a lifter may change their third deadlift.
 */
export class MeetRules {
  private readonly thirdChanges: ReadonlyMap<
    PlatformLift,
    MeetRuleProfile['thirdAttemptChanges'][number]
  >;
  private readonly overrides: ReadonlyMap<string, MeetRuleProfile['formatOverrides'][number]>;

  private constructor(
    /** The profile as published, so a screen can cite the rulebook behind an answer. */
    readonly profile: MeetRuleProfile,
    thirdChanges: ReadonlyMap<PlatformLift, MeetRuleProfile['thirdAttemptChanges'][number]>,
    overrides: ReadonlyMap<string, MeetRuleProfile['formatOverrides'][number]>,
  ) {
    this.thirdChanges = thirdChanges;
    this.overrides = overrides;
  }

  static from(profile: MeetRuleProfile): MeetRulesResult {
    const problems: MeetRuleProblem[] = [];

    const thirdChanges = new Map<PlatformLift, MeetRuleProfile['thirdAttemptChanges'][number]>();
    for (const entry of profile.thirdAttemptChanges) {
      if (thirdChanges.has(entry.lift)) {
        problems.push({
          code: 'duplicate-third-attempt-lift',
          message: `The ${entry.lift} appears twice in the third-attempt change rules, so there are two answers to one question.`,
        });
        continue;
      }
      thirdChanges.set(entry.lift, entry);
    }

    const overrides = new Map<string, MeetRuleProfile['formatOverrides'][number]>();
    for (const entry of profile.formatOverrides) {
      const key = `${entry.format}/${entry.lift}`;
      if (overrides.has(key)) {
        problems.push({
          code: 'duplicate-format-override',
          message: `The ${entry.lift} in a ${entry.format} meet is overridden twice.`,
        });
        continue;
      }
      overrides.set(key, entry);
    }

    // A record increment that is not smaller than the ordinary one is not a
    // relaxation, and the only way it gets written down is a transcription that
    // copied the wrong figure. Left alone it would silently forbid the sub-
    // increment weight that is the entire reason record rules exist.
    const record = profile.recordProgressionKilograms;
    if (record !== null && record >= profile.minimumProgressionKilograms) {
      problems.push({
        code: 'record-increment-not-a-relaxation',
        message: `The record progression (${String(record)} kg) is not smaller than the ordinary one (${String(profile.minimumProgressionKilograms)} kg), so it permits nothing the ordinary rule does not.`,
      });
    }

    const fourth = profile.fourthAttempt;
    if (
      fourth !== null &&
      fourth.withinKilogramsOfRecord !== null &&
      fourth.minimumExcessKilograms > fourth.withinKilogramsOfRecord
    ) {
      problems.push({
        code: 'fourth-attempt-window-narrower-than-its-margin',
        message:
          'A lifter must be within a window of the record that is narrower than the amount they must exceed it by, so no fourth attempt could ever qualify.',
      });
    }

    const seen = new Set<TieBreakStep>();
    for (const [index, step] of profile.tieBreak.entries()) {
      if (seen.has(step)) {
        problems.push({
          code: 'tie-break-repeats-a-step',
          message: `The tie-break step "${step}" appears twice; the second occurrence can never separate two lifters the first did not.`,
        });
      }
      seen.add(step);
      if (step === 'declared-tie' && index !== profile.tieBreak.length - 1) {
        problems.push({
          code: 'tie-break-continues-past-a-declared-tie',
          message:
            'A step follows "declared-tie", which is the answer given when nothing further separates the lifters. It could never be reached.',
        });
      }
    }

    if (problems.length > 0) return { ok: false, problems };
    return { ok: true, rules: new MeetRules(profile, thirdChanges, overrides) };
  }

  // ---------------------------------------------------------------------------
  // Legal bar weights
  // ---------------------------------------------------------------------------

  /** Whether a bar may be loaded to this weight at all under the ordinary rules. */
  isLegalBarWeight(kilograms: number): boolean {
    if (!Number.isFinite(kilograms) || kilograms <= 0) return false;
    const multiple = this.profile.barMultipleKilograms;
    return isSameWeight(roundToIncrement(kilograms, multiple), kilograms);
  }

  /**
   * The heaviest legal weight at or below a figure.
   *
   * The direction openers take (§9.1), and the reason this is a named method
   * rather than a call to `floorToIncrement` at each site: rounding an opener the
   * other way turns a conservative attempt into an aggressive one, which is the
   * failure §9.1 calls out by name.
   */
  floorToLegal(kilograms: number): number {
    return floorToIncrement(kilograms, this.profile.barMultipleKilograms);
  }

  /** The lightest legal weight at or above a figure. */
  ceilToLegal(kilograms: number): number {
    return ceilToIncrement(kilograms, this.profile.barMultipleKilograms);
  }

  /**
   * The legal weights either side of a figure a lifter typed.
   *
   * §16, for a lifter who thinks in pounds: three answers and no decision. The
   * heavier one is never chosen for them, so a tie in `nearest` goes down.
   */
  legalWeightsAround(kilograms: number): LegalWeightsAround {
    const below = this.floorToLegal(kilograms);
    const above = this.ceilToLegal(kilograms);
    const hasBelow = below > 0;
    if (isSameWeight(below, above)) {
      return { below: hasBelow ? below : null, above, nearest: above };
    }
    if (!hasBelow) return { below: null, above, nearest: above };
    // `<=` and not `<`: the midpoint goes to the lighter weight.
    const nearest = kilograms - below <= above - kilograms ? below : above;
    return { below, above, nearest };
  }

  // ---------------------------------------------------------------------------
  // Sequencing one lifter's attempts
  // ---------------------------------------------------------------------------

  /**
   * What the next attempt on this lift may be, given everything already taken.
   *
   * `taken` is the attempts on **one lift**, in any order -- the floor is a
   * property of the set, not of the sequence, and sorting a caller's array here
   * is cheaper than a rule that silently depends on the caller having done it.
   */
  nextAttemptBounds(taken: readonly TakenAttempt[]): NextAttemptBounds {
    const reasons: AttemptFloorReason[] = [];
    const attempted = taken.filter((attempt) => attempt.outcome !== 'passed');

    if (attempted.length === 0) {
      return {
        // The lightest legal weight, which is one multiple. An empty bar is not
        // an attempt, and the profile's multiple is the smallest step it knows.
        minimumKilograms: this.profile.barMultipleKilograms,
        repeatAllowed: false,
        repeatKilograms: null,
        failedFloorKilograms: null,
        reasons: ['no-attempts-yet'],
      };
    }

    const last = attempted.reduce((latest, attempt) =>
      attempt.attemptNumber >= latest.attemptNumber ? attempt : latest,
    );

    let floor = last.kilograms + this.profile.minimumProgressionKilograms;
    if (last.outcome === 'good') {
      reasons.push('progression-after-a-good-lift');
    } else if (this.profile.risingBar) {
      // A missed attempt may be repeated or increased, never reduced. The floor
      // above already covers the increase; the repeat is the separate flag.
      reasons.push('rising-bar');
    } else {
      // Not a case either published profile has, but a profile that drops the
      // rising bar still has a progression, and an empty reason list would read
      // to a screen as "no rule sets this floor".
      reasons.push('minimum-progression');
    }

    let failedFloor: number | null = null;
    if (this.profile.forbidsAttemptBelowFailedWeight) {
      failedFloor = attempted
        .filter((attempt) => attempt.outcome === 'no-lift')
        .reduce<number | null>(
          (heaviest, attempt) =>
            heaviest === null || attempt.kilograms > heaviest ? attempt.kilograms : heaviest,
          null,
        );
      if (failedFloor !== null) {
        // Reported whether or not it is the binding floor. It usually is not --
        // one progression above the last attempt is normally higher -- but it is
        // still a rule constraining this attempt, and a screen listing only the
        // binding one would stop mentioning the miss the moment the arithmetic
        // happened to overtake it.
        floor = Math.max(floor, failedFloor);
        reasons.push('not-below-a-failed-attempt');
      }
    }

    // A repeat is only the *last* weight, and only when it was missed. A lifter
    // who made 180 kg cannot take 180 kg again.
    const repeatAllowed = last.outcome === 'no-lift';

    return {
      minimumKilograms: this.ceilToLegal(floor),
      repeatAllowed,
      repeatKilograms: repeatAllowed ? last.kilograms : null,
      failedFloorKilograms: failedFloor,
      reasons,
    };
  }

  /**
   * Whether a specific weight is a legal next attempt, and if not, which rules refuse it.
   *
   * Every reason at once rather than the first, per §5.5: a weight that is both
   * off the increment and below a failed attempt needs two corrections, and a
   * caller told about one of them fixes it and is refused again.
   */
  isLegalNextAttempt(taken: readonly TakenAttempt[], kilograms: number): AttemptLegality {
    const bounds = this.nextAttemptBounds(taken);
    const reasons: AttemptRefusalCode[] = [];

    const isRepeat =
      bounds.repeatKilograms !== null && isSameWeight(kilograms, bounds.repeatKilograms);

    if (!this.isLegalBarWeight(kilograms) && !isRepeat) {
      // A repeat is exempt: the weight on the bar was legal when it was loaded,
      // and a record attempt off the ordinary multiple is repeatable as itself.
      reasons.push('not-a-legal-bar-weight');
    }

    // Precedence, not two findings: one weight has one reason it is too light,
    // and the miss is the more useful of the two to be told about. A lifter who
    // just missed 100 kg and typed 98 is not making an arithmetic mistake.
    if (!isRepeat) {
      if (
        bounds.failedFloorKilograms !== null &&
        !isAtLeast(kilograms, bounds.failedFloorKilograms)
      ) {
        reasons.push('below-a-failed-attempt');
      } else if (!isAtLeast(kilograms, bounds.minimumKilograms)) {
        reasons.push('below-the-minimum-progression');
      }
    }

    return reasons.length === 0 ? { legal: true } : { legal: false, reasons };
  }

  /**
   * The next several legal weights from the floor upward.
   *
   * Used to draw a picker rather than to make a decision. A repeat, where one is
   * available, is not in the list: it is a different kind of choice and the
   * interface says so in words.
   */
  legalLadder(taken: readonly TakenAttempt[], count: number): readonly number[] {
    if (!Number.isInteger(count) || count <= 0) return [];
    const bounds = this.nextAttemptBounds(taken);
    const step = Math.max(this.profile.barMultipleKilograms, 0);
    const ladder: number[] = [];
    for (let index = 0; index < count; index += 1) {
      ladder.push(roundToIncrement(bounds.minimumKilograms + index * step, step));
    }
    return ladder;
  }

  /**
   * What the bar is loaded to if the minute runs out with nothing submitted.
   *
   * The single most useful thing this tool can tell somebody, because it is the
   * one rule that applies when nobody is looking at the screen. Returns `null`
   * only when there is no preceding attempt to apply it to.
   */
  automaticAttemptAfter(previous: TakenAttempt | null): AutomaticAttempt | null {
    if (previous === null || previous.outcome === 'passed') return null;
    const behaviour =
      previous.outcome === 'good'
        ? this.profile.automaticAfterGoodLift
        : this.profile.automaticAfterMiss;
    const kilograms =
      behaviour === 'repeat'
        ? previous.kilograms
        : this.ceilToLegal(previous.kilograms + this.profile.minimumProgressionKilograms);
    return { kilograms, behaviour, seconds: this.profile.submissionSeconds };
  }

  // ---------------------------------------------------------------------------
  // Changing an attempt already submitted
  // ---------------------------------------------------------------------------

  /**
   * Whether an attempt already submitted may still be changed.
   *
   * `used` is how many changes the lifter has already made to *this* attempt. The
   * conditions come back whether or not any changes remain, because a coach
   * needs to read them before deciding to walk to the table.
   */
  changeAllowance(query: {
    readonly lift: PlatformLift;
    readonly attemptNumber: number;
    readonly format: MeetFormat;
    readonly used: number;
  }): ChangeAllowance {
    const used = Math.max(0, query.used);

    if (query.attemptNumber <= 1) {
      const opener = this.profile.openerChange;
      return {
        allowed: opener.allowed,
        used,
        remaining: Math.max(0, opener.allowed - used),
        conditions: [],
        summary: opener.summary,
      };
    }

    if (query.attemptNumber === 2) {
      return {
        allowed: this.profile.secondAttemptChangesAllowed,
        used,
        remaining: Math.max(0, this.profile.secondAttemptChangesAllowed - used),
        conditions: [],
        summary: null,
      };
    }

    // Third and beyond. A format override wins where one exists, because that is
    // what an override is -- a single-lift bench press is not a full-power bench
    // press and the rulebooks say so in their own sections.
    const override = this.overrides.get(`${query.format}/${query.lift}`);
    const base = this.thirdChanges.get(query.lift);
    const allowed = override?.allowed ?? base?.allowed ?? 0;
    const conditions: ChangeConditionCode[] = [];
    if (base?.lapsesOnceCalledToLoadedBar === true) {
      conditions.push('lapses-once-called-to-a-loaded-bar');
    }
    if (base?.notBelowPrecedingLifter === true) {
      conditions.push('not-below-the-preceding-lifter');
    }

    return {
      allowed,
      used,
      remaining: Math.max(0, allowed - used),
      conditions,
      summary: override?.summary ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Fourth attempts
  // ---------------------------------------------------------------------------

  /**
   * Whether a fourth attempt at a record is available, and what it would have to be.
   *
   * Refuses with every reason rather than the first, and refuses outright when
   * the profile has no fourth attempt at all -- one of the two federations
   * published from this repository does not. `recordKilograms` is `null` when the
   * user has not told the tool what the record is, which is a different answer
   * from "you are too far away" and is reported as one.
   */
  fourthAttemptEligibility(query: {
    readonly thirdAttempt: TakenAttempt;
    readonly recordKilograms: number | null;
  }): FourthAttemptEligibility {
    const rule = this.profile.fourthAttempt;
    if (rule === null) return { eligible: false, reasons: ['not-offered'] };

    const reasons: FourthAttemptBlockCode[] = [];
    if (rule.requiresSuccessfulThird && query.thirdAttempt.outcome !== 'good') {
      reasons.push('third-attempt-not-successful');
    }
    if (query.recordKilograms === null) {
      reasons.push('no-record-supplied');
      return { eligible: false, reasons };
    }
    if (
      rule.withinKilogramsOfRecord !== null &&
      query.recordKilograms - query.thirdAttempt.kilograms > rule.withinKilogramsOfRecord
    ) {
      reasons.push('outside-the-record-window');
    }
    if (reasons.length > 0) return { eligible: false, reasons };

    // Not rounded onto the ordinary multiple: a record attempt is the one time a
    // federation lets a lifter off the ladder, and rounding up here would add up
    // to a full increment to a weight the rules say may exceed the record by half
    // a kilogram.
    const step = this.profile.recordProgressionKilograms ?? this.profile.barMultipleKilograms;
    const minimum = ceilToIncrement(query.recordKilograms + rule.minimumExcessKilograms, step);

    return {
      eligible: true,
      minimumKilograms: minimum,
      requiresPermission: rule.requiresPermission,
      requiresPostLiftEquipmentCheck: rule.requiresPostLiftEquipmentCheck,
      submissionSeconds: rule.submissionSeconds,
      excludedFrom: rule.excludedFrom,
      summary: rule.summary,
    };
  }

  // ---------------------------------------------------------------------------
  // Placing
  // ---------------------------------------------------------------------------

  /**
   * Which tie-break step first separates two lifters on the same total, if any.
   *
   * Answered from the sequence in the profile rather than from a rule written
   * here, because the two published federations already differ: one re-weighs and
   * may declare a tie, the other gives it to whoever reached the total first. The
   * tactical mode needs this to say whether a tie is worth taking, which is a
   * genuinely different decision under the two.
   */
  firstSeparatingTieBreak(comparison: {
    readonly bodyweightsDiffer: boolean;
    readonly reachedTotalFirstIsKnown: boolean;
  }): TieBreakStep | null {
    for (const step of this.profile.tieBreak) {
      if (step === 'lighter-bodyweight' && comparison.bodyweightsDiffer) return step;
      if (step === 'reweigh') return step;
      if (step === 'first-to-total' && comparison.reachedTotalFirstIsKnown) return step;
      if (step === 'declared-tie') return step;
    }
    return null;
  }
}
