// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What to offer a lifter in the minute after the lights go up (§13).
 *
 * `meet-document.ts` records what happened and `meet-rules.ts` says what is
 * legal. Neither of them chooses a weight. This file is the only place that does,
 * and it does it as a pure function of the document -- nothing is stored, which
 * is what makes §13.9's undo restore the recommendation along with the total and
 * the clock without undo knowing that a recommendation exists.
 *
 * THREE CHOICES, AND ONE OF THEM IS HIGHLIGHTED
 *
 * §13 asks for Secure, Recommended and Push, with one highlighted and no legal
 * weight forbidden. The slot and the highlight are two fields here rather than
 * one, because §13.5 separates them: after a lift that hurt, the highlight moves
 * to the cautious option while the middle slot still holds the continuation. A
 * single "recommended" flag doing both jobs would make that requirement
 * unexpressible, and the way it would fail is by highlighting an aggressive
 * option for somebody who has just said they are in pain.
 *
 * The choices are an offer, never a gate. Nothing here refuses a weight; the only
 * thing that refuses one is `MeetRules`, on the way into the document, and it
 * refuses on the rulebook's arithmetic rather than on this file's opinion.
 *
 * WHAT IS NOT SAID
 *
 * No probability, ever (§10.2). Risk and data confidence are two axes and are not
 * fused into a score -- risk is `AttemptRisk` here and confidence is not in this
 * file at all, which is the separation made structural. When the lifter never
 * confirmed a meet-day maximum there is no denominator, so the risk label and the
 * percentage come back `null` rather than as a guess: a screen with nothing to say
 * should say nothing rather than reassure.
 *
 * Nothing here is medical advice, and §13.5 is written so that it cannot drift
 * into being any: it says what the tool cannot do, makes stopping easy to choose,
 * and leaves the judgement with the people in the room.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import type { AttemptPlan, PercentBand } from './attempt-plan.js';
import { classifyAttemptRisk, type AttemptRisk } from './attempt-risk.js';
import {
  attemptsOn,
  bestGoodLift,
  bombOutRisk,
  isResolved,
  liftsInFormat,
  nextAttemptOn,
  outstandingExtraAttempts,
  projectedTotalWith,
  takenOn,
  totalSoFar,
  type AttemptEffort,
  type BombOutRisk,
  type LiveAttempt,
  type LiveLifter,
  type MeetDocument,
  type MissReason,
  type RunningTotal,
} from './meet-document.js';
import type { MeetRules } from './meet-rules.js';

/**
 * The same tolerance `meet-rules.ts` uses, for the same reason.
 *
 * Duplicated rather than exported from there: it is the slack on comparing two
 * kilogram figures that have each been through a pound conversion, and a shared
 * constant would invite somebody to widen it for one caller and move the other's
 * answers with it.
 */
const SAME_WEIGHT_SLACK = 0.000_5;

function isSameWeight(left: number, right: number): boolean {
  return Math.abs(left - right) <= SAME_WEIGHT_SLACK;
}

function isAtLeast(value: number, floor: number): boolean {
  return value >= floor - SAME_WEIGHT_SLACK;
}

// -----------------------------------------------------------------------------
// What the result was, as this file reads it
// -----------------------------------------------------------------------------

/**
 * The reading of the last attempt that decides which of §13.1 to §13.8 applies.
 *
 * One value per branch the requirements name, plus the three honest gaps: the
 * lifter has not lifted yet, the effort question was answered "not sure", or the
 * miss reason was. Those are not folded into the nearest confident branch --
 * "not sure" is an answer §12.2 offers on purpose, and treating it as `solid`
 * would put a confident recommendation on screen over the top of somebody who
 * has just said they do not know.
 */
export type LiveTrigger =
  /** §13.1 */
  | 'flew'
  /** §13.2 */
  | 'solid'
  /** §13.3 */
  | 'slow'
  /** §13.4 */
  | 'grind'
  /** §13.5, from a good lift that hurt. */
  | 'pain'
  /** A good lift with no effort recorded, or "not sure". */
  | 'effort-not-recorded'
  /** §13.6 */
  | 'command-miss'
  /** §13.7 */
  | 'strength-miss'
  /** §13.5, from a miss. */
  | 'pain-miss'
  /** §13.8, before the officials have ruled. */
  | 'platform-error'
  /** A timeout or another administrative miss. */
  | 'administrative-miss'
  /** A miss with no reason recorded, or "not sure". */
  | 'miss-reason-not-recorded'
  /** §13.8, after the officials struck the attempt and granted an extra. */
  | 'attempt-set-aside'
  /** The opener, or a lift where nothing has been judged yet. */
  | 'nothing-recorded-yet';

const EFFORT_TRIGGERS: Readonly<Record<AttemptEffort, LiveTrigger>> = {
  flew: 'flew',
  solid: 'solid',
  slow: 'slow',
  grind: 'grind',
  pain: 'pain',
  unsure: 'effort-not-recorded',
};

const MISS_TRIGGERS: Readonly<Record<MissReason, LiveTrigger>> = {
  command: 'command-miss',
  strength: 'strength-miss',
  pain: 'pain-miss',
  'platform-error': 'platform-error',
  administrative: 'administrative-miss',
  unsure: 'miss-reason-not-recorded',
};

/** The last attempt on this lift that the referees actually judged. */
function lastJudgedOn(lifter: LiveLifter, lift: PlatformLift): LiveAttempt | null {
  let last: LiveAttempt | null = null;
  for (const attempt of attemptsOn(lifter, lift)) {
    // A record attempt is a lift for the wall and not a step in the sequence, and
    // a pass was never judged -- after a passed second the reading that still
    // describes the lifter is the first attempt, not silence.
    if (attempt.kind === 'record' || attempt.status === 'passed') continue;
    if (!isResolved(attempt)) continue;
    if (last === null || attempt.attemptNumber >= last.attemptNumber) last = attempt;
  }
  return last;
}

function triggerFor(attempt: LiveAttempt | null): LiveTrigger {
  if (attempt === null) return 'nothing-recorded-yet';
  if (attempt.status === 'extra-attempt-granted') return 'attempt-set-aside';
  if (attempt.status === 'good') return EFFORT_TRIGGERS[attempt.effort ?? 'unsure'];
  if (attempt.status === 'no-lift') return MISS_TRIGGERS[attempt.missReason ?? 'unsure'];
  return 'nothing-recorded-yet';
}

// -----------------------------------------------------------------------------
// Targets
// -----------------------------------------------------------------------------

/** The four kinds of thing §13 says a choice must report reaching. */
export type LiveTargetKind = 'personal-record' | 'qualification' | 'placing' | 'record';

/**
 * Something the lifter is trying to reach, supplied by whatever knows about it.
 *
 * Deliberately an input rather than something computed here. A qualifying total
 * comes from ingested meet rules, a placing figure comes from the other lifters in
 * the session, and a record comes from the published record set -- three sources
 * with three refresh cadences, none of which belong behind a function whose job is
 * to pick a weight. This file only answers whether a candidate reaches one.
 */
export interface LiveTarget {
  readonly kind: LiveTargetKind;
  /** Whether the figure is a weight on this lift or a competition total. */
  readonly measure: 'lift' | 'total';
  readonly kilograms: number;
  /** How the interface names it, in the caller's words. Never logged. */
  readonly label: string;
}

// -----------------------------------------------------------------------------
// A choice
// -----------------------------------------------------------------------------

/** Where a choice sits on the screen. §13's three positions, in its own words. */
export type LiveChoiceSlot = 'secure' | 'recommended' | 'push';

/** Why this weight, in one code an interface can route on. */
export type LiveChoiceReason =
  | 'continue-the-plan'
  | 'upper-end-of-the-plan'
  | 'one-increment-above-the-plan'
  | 'one-increment-below-the-plan'
  | 'smallest-legal-increase'
  | 'reduced-to-bank-the-lift'
  | 'the-plan-unreduced'
  | 'repeat-the-same-weight'
  | 'reaches-a-target'
  | 'pass-this-lift';

export interface LiveChoice {
  readonly slot: LiveChoiceSlot;
  /**
   * The weight to declare, or `null` for Pass / Stop This Lift.
   *
   * Governed by kilograms, always. A pound figure beside it on screen is a
   * conversion for the reader and is never what the arithmetic ran on.
   */
  readonly kilograms: number | null;
  /** Whether this is the weight that was just missed, taken again. */
  readonly repeat: boolean;
  /** Up from the preceding attempt. `null` on an opener, or on a pass. */
  readonly increaseKilograms: number | null;
  /** `null` when the lifter never confirmed a meet-day maximum. */
  readonly percentOfMaximum: number | null;
  /** What the lifter would have if this were made. §11's projected total. */
  readonly projected: RunningTotal;
  /** Targets this would reach, of those supplied. */
  readonly reaches: readonly LiveTarget[];
  /**
   * Targets the plan would have reached and this would not (§13.3).
   *
   * Computed against the planned weight rather than against the heaviest choice
   * on screen, because the thing a lifter is being asked to give up is the
   * attempt they came with, not the one the tool offered them thirty seconds ago.
   */
  readonly surrenders: readonly LiveTarget[];
  /** `null` when there is no confirmed maximum to grade it against (§10.2). */
  readonly risk: AttemptRisk | null;
  /** §13.4: a third taken for a small target after a grind, labelled as such. */
  readonly tactical: boolean;
  /** Exactly one choice in a set has this. §13's "highlight one option". */
  readonly highlighted: boolean;
  readonly reason: LiveChoiceReason;
  /** One short sentence. §13's "one short explanation". */
  readonly explanation: string;
}

// -----------------------------------------------------------------------------
// Advisories
// -----------------------------------------------------------------------------

/** Something the screen has to say that is not attached to one weight. */
export type LiveAdvisoryCode =
  /** §12.2's "not sure", carried forward honestly. */
  | 'effort-not-recorded'
  | 'miss-reason-not-recorded'
  /** No `M`, so no risk label and no percentage (§10.2). */
  | 'no-maximum-confirmed'
  /** §13.3 asked for a reduction the minimum progression does not allow. */
  | 'reduction-not-possible'
  /** §13.3's "explain what target may be surrendered". */
  | 'target-surrendered'
  /** §13.1's "do not automatically increase a third attempt merely because the opener flew". */
  | 'third-attempt-not-raised'
  /** §8.1's hard ceiling bit. */
  | 'ceiling-applied'
  | 'ceiling-below-the-minimum'
  /** §13.5. */
  | 'cannot-assess-injury'
  /** §13.6. */
  | 'confirm-the-technical-ruling'
  | 'bomb-out-risk-on-the-opener'
  /** §13.7. */
  | 'final-attempt-and-bomb-out'
  /** §13.8. */
  | 'confirm-the-extra-attempt'
  | 'extra-attempt-timing-unknown'
  | 'confirm-the-administrative-ruling'
  /** Nothing left to choose on this lift. */
  | 'lift-is-complete';

/** How loudly to say it. Neither value refuses anything. */
export type LiveAdvisorySeverity = 'note' | 'strong';

export interface LiveAdvisory {
  readonly code: LiveAdvisoryCode;
  readonly severity: LiveAdvisorySeverity;
  readonly message: string;
}

// -----------------------------------------------------------------------------
// The request and the answer
// -----------------------------------------------------------------------------

export interface LiveChoicesRequest {
  readonly document: MeetDocument;
  /**
   * The lifter, not an id.
   *
   * An id would give this function a way to fail that the caller would have to
   * branch on, and there is nothing useful it could return for a lifter who is
   * not in the meet. The caller has already done the lookup.
   */
  readonly lifter: LiveLifter;
  readonly lift: PlatformLift;
  /** `M`, confirmed by the lifter (§7). Omitted means no risk label, not zero. */
  readonly meetDayMaximumKilograms?: number | null | undefined;
  /** The plan this lift was set out with, where there is one. */
  readonly plan?: AttemptPlan | null | undefined;
  /** §8.1's hard ceiling: a weight the lifter will not go above whatever anything says. */
  readonly ceilingKilograms?: number | null | undefined;
  readonly targets?: readonly LiveTarget[] | undefined;
}

export interface LiveChoices {
  readonly lift: PlatformLift;
  readonly trigger: LiveTrigger;
  /** The attempt these would fill, or `null` when the lift is over. */
  readonly attemptId: string | null;
  readonly attemptNumber: number | null;
  /** The weight of the attempt just judged, which the increases are measured from. */
  readonly previousKilograms: number | null;
  /** Secure, then Recommended, then Push, minus any that collapsed onto another. */
  readonly choices: readonly LiveChoice[];
  readonly highlightedSlot: LiveChoiceSlot | null;
  readonly advisories: readonly LiveAdvisory[];
  /**
   * §13.8: granted, not yet taken, and deliberately not placed in the sequence.
   *
   * Reported beside the choices rather than among them. The round order belongs
   * to the expeditor, and an extra granted in round two may be taken after round
   * three -- putting it in the list would be the application assuming a timing
   * the requirements say it does not know.
   */
  readonly extraAttempts: readonly LiveAttempt[];
  readonly bombOut: BombOutRisk;
  /** What is banked right now, and whether it is yet a total. */
  readonly current: RunningTotal;
}

// -----------------------------------------------------------------------------
// Building the candidates
// -----------------------------------------------------------------------------

interface Candidate {
  readonly slot: LiveChoiceSlot;
  readonly kilograms: number | null;
  readonly reason: LiveChoiceReason;
  readonly tactical: boolean;
  readonly highlight: boolean;
}

function weight(
  slot: LiveChoiceSlot,
  kilograms: number,
  reason: LiveChoiceReason,
  highlight = false,
  tactical = false,
): Candidate {
  return { slot, kilograms, reason, tactical, highlight };
}

function pass(slot: LiveChoiceSlot, highlight = false): Candidate {
  return { slot, kilograms: null, reason: 'pass-this-lift', tactical: false, highlight };
}

function bandFor(
  percentages: AttemptPlan['percentages'],
  attemptNumber: number,
): PercentBand | null {
  if (attemptNumber === 1) return percentages.opener;
  if (attemptNumber === 2) return percentages.second;
  if (attemptNumber === 3) return percentages.third;
  return null;
}

/**
 * The whole of §13, as three weights per branch.
 *
 * Read as a table rather than as prose: every branch produces the same shape, so
 * a requirement that changes one line of §13 changes one line here, and the
 * places the requirements deliberately differ -- a pass in the Secure slot, a
 * missing Push -- are visible as differences rather than buried in conditions.
 */
function candidatesFor(input: {
  readonly trigger: LiveTrigger;
  /** The floor: the lightest legal next attempt above a repeat. */
  readonly floor: number;
  /** The planned next attempt, already legal and at or above the floor. */
  readonly planned: number;
  /** The top of the planned band, or the planned weight when the band is a point. */
  readonly upper: number;
  /** One legal increment under these rules. */
  readonly step: number;
  /** The weight to take again, where the rules allow a repeat. */
  readonly repeatKilograms: number | null;
  /** The lightest supplied target above the floor, for §13.4's tactical third. */
  readonly tacticalTarget: number | null;
  /** Whether the reading came from an attempt two rounds back rather than the last one. */
  readonly readingIsStale: boolean;
  readonly onTheLastChance: boolean;
  readonly conservativePlan: boolean;
}): readonly Candidate[] {
  const { trigger, floor, planned, upper, step, repeatKilograms } = input;
  const up = (from: number, steps = 1): number => from + steps * step;
  const down = (from: number, steps = 1): number => Math.max(floor, from - steps * step);
  const repeat = repeatKilograms ?? floor;
  const canRepeat = repeatKilograms !== null;

  switch (trigger) {
    case 'flew': {
      // §13.1. The continuation is the top of the planned range, and the push is
      // one step past it -- but only when the reading is about the attempt that
      // just happened. "Do not automatically increase a third attempt merely
      // because the opener flew" is `readingIsStale`: a passed second leaves the
      // opener as the last thing judged, and carrying its lightness into a third
      // is exactly the automatic increase that sentence forbids.
      const top = Math.max(planned, upper);
      if (input.readingIsStale) {
        return [
          weight('secure', down(planned), 'one-increment-below-the-plan'),
          weight('recommended', planned, 'continue-the-plan', true),
          weight('push', top, 'upper-end-of-the-plan'),
        ];
      }
      return [
        weight('secure', planned, 'continue-the-plan'),
        weight(
          'recommended',
          top,
          top > planned ? 'upper-end-of-the-plan' : 'continue-the-plan',
          true,
        ),
        weight('push', up(top), 'one-increment-above-the-plan'),
      ];
    }

    case 'solid':
    case 'effort-not-recorded':
    case 'attempt-set-aside': {
      // §13.2. The plan, a step under it, and a step over it -- and the step over
      // is dropped for a plan whose whole point was not to reach. "One sensible
      // higher option when supported by the user's goal and limits" is a
      // condition, and a First Meet plan does not support it.
      const offered: Candidate[] = [
        weight('secure', down(planned), 'one-increment-below-the-plan'),
        weight('recommended', planned, 'continue-the-plan', true),
      ];
      if (!input.conservativePlan) {
        offered.push(weight('push', up(planned), 'one-increment-above-the-plan'));
      }
      return offered;
    }

    case 'slow': {
      // §13.3. The reduction becomes the recommendation and the plan becomes the
      // push, which is the requirement's priority the right way round: building
      // the total is the default and the original weight is the thing the lifter
      // has to choose deliberately.
      const reduced = down(planned);
      return [
        weight('secure', floor, 'smallest-legal-increase'),
        weight('recommended', reduced, 'reduced-to-bank-the-lift', true),
        weight('push', planned, 'the-plan-unreduced'),
      ];
    }

    case 'grind': {
      // §13.4. Pass is a first-class option here rather than an afterthought, and
      // the push is a target rather than a jump: "a third may still be useful for
      // a small PR, qualification, or placing target" is a reason to add two and a
      // half kilos, and nothing in that sentence is a reason to add ten.
      const offered: Candidate[] = [
        pass('secure'),
        weight('recommended', floor, 'smallest-legal-increase', true),
      ];
      const target = input.tacticalTarget;
      if (target !== null && target > floor + SAME_WEIGHT_SLACK) {
        offered.push(weight('push', target, 'reaches-a-target', false, true));
      } else if (planned > floor + SAME_WEIGHT_SLACK) {
        offered.push(weight('push', planned, 'the-plan-unreduced', false, true));
      }
      return offered;
    }

    case 'pain':
    case 'pain-miss': {
      // §13.5. Stopping is the highlighted choice and it sits in the first slot,
      // where a thumb lands. There is no Push: the requirement forbids presenting
      // an aggressive option *as recommended*, and going one better than that
      // costs a lifter nothing -- any legal weight is still one field away, which
      // is the part §13 does insist on.
      const offered: Candidate[] = [pass('secure', true)];
      if (canRepeat) {
        offered.push(weight('recommended', repeat, 'repeat-the-same-weight'));
      } else {
        offered.push(weight('recommended', floor, 'smallest-legal-increase'));
      }
      return offered;
    }

    case 'command-miss':
    case 'administrative-miss':
    case 'platform-error':
    case 'strength-miss':
    case 'miss-reason-not-recorded': {
      // §13.6 and §13.7 are the same three weights and differ in what is said
      // around them -- both "normally recommend repeating the same weight", and
      // §13.7 adds "do not recommend going up by default", which is the highlight
      // sitting on the repeat rather than on the increase.
      const offered: Candidate[] = [
        canRepeat
          ? weight('secure', repeat, 'repeat-the-same-weight', true)
          : weight('secure', floor, 'smallest-legal-increase', true),
      ];
      if (!canRepeat || floor > repeat + SAME_WEIGHT_SLACK) {
        offered.push(weight('recommended', floor, 'smallest-legal-increase'));
      }
      // No push on the last chance. A lifter with no good lift and one attempt
      // left is being offered a way to bomb out, and the warning beside it does
      // not undo a weight sitting under a thumb.
      if (!input.onTheLastChance) {
        offered.push(weight('push', up(floor), 'one-increment-above-the-plan'));
      }
      return offered;
    }

    case 'nothing-recorded-yet': {
      // The opener. §9.1 rounded it down on the way in and nothing here rounds it
      // back up: the secure option is a step under the plan, not a step under
      // something re-derived from a percentage.
      return [
        weight('secure', down(planned), 'one-increment-below-the-plan'),
        weight('recommended', planned, 'continue-the-plan', true),
        weight('push', up(planned), 'one-increment-above-the-plan'),
      ];
    }
  }
}

const EXPLANATIONS: Readonly<Record<LiveChoiceReason, string>> = {
  'continue-the-plan': 'The weight you planned for this attempt.',
  'upper-end-of-the-plan': 'The top of the range you planned, since that one flew.',
  'one-increment-above-the-plan': 'One legal step above the plan.',
  'one-increment-below-the-plan': 'One legal step under the plan.',
  'smallest-legal-increase': 'The smallest increase these rules allow.',
  'reduced-to-bank-the-lift': 'Under the plan, to bank the lift and build the total.',
  'the-plan-unreduced': 'The weight you planned, unchanged.',
  'repeat-the-same-weight': 'The same weight again.',
  'reaches-a-target': 'The lightest legal weight that still reaches a target you set.',
  'pass-this-lift': 'Take no further attempt on this lift.',
};

// -----------------------------------------------------------------------------
// The function
// -----------------------------------------------------------------------------

/**
 * The three choices for the next attempt on one lift, and everything said around them.
 *
 * Total. There is no lifter, lift or document it refuses -- a lift with no
 * attempts left comes back with an empty choice list and the reason, which is a
 * screen state rather than an error, and a lifter with no plan and no confirmed
 * maximum still gets three legal weights with the labels honestly absent.
 */
export function liveChoicesFor(rules: MeetRules, request: LiveChoicesRequest): LiveChoices {
  const { document, lifter, lift } = request;
  const taken = takenOn(lifter, lift);
  const bounds = rules.nextAttemptBounds(taken);
  const next = nextAttemptOn(lifter, lift);
  const judged = lastJudgedOn(lifter, lift);
  const trigger = triggerFor(judged);
  const risk = bombOutRisk(lifter, lift);
  const current = totalSoFar(document, lifter);
  const extraAttempts = outstandingExtraAttempts(lifter, lift);
  const targets = request.targets ?? [];

  const advisories: LiveAdvisory[] = [];
  const maximum = usableMaximum(request.meetDayMaximumKilograms);

  if (next === null) {
    advisories.push({
      code: 'lift-is-complete',
      severity: 'note',
      message: 'There are no competition attempts left on this lift.',
    });
    addExtraAttemptAdvisories(advisories, trigger, extraAttempts);
    return {
      lift,
      trigger,
      attemptId: null,
      attemptNumber: null,
      previousKilograms: judged?.kilograms ?? null,
      choices: [],
      highlightedSlot: null,
      advisories,
      extraAttempts,
      bombOut: risk,
      current,
    };
  }

  const step = rules.profile.barMultipleKilograms;
  const floor = bounds.minimumKilograms;
  const planned = plannedWeight(rules, request, next.attemptNumber, floor);
  const upper = upperEnd(rules, request, next.attemptNumber, planned, maximum);

  // A reading is stale when the attempt it came from is not the one immediately
  // before this attempt -- a passed second, or an attempt the officials struck.
  const readingIsStale = judged !== null && judged.attemptNumber < next.attemptNumber - 1;

  const strategy = request.plan?.strategy ?? null;
  const conservativePlan = strategy === 'first-meet' || strategy === 'conservative';

  const candidates = candidatesFor({
    trigger,
    floor,
    planned,
    upper,
    step,
    repeatKilograms: bounds.repeatAllowed ? bounds.repeatKilograms : null,
    tacticalTarget: lightestTargetAbove(document, lifter, lift, targets, floor, rules),
    readingIsStale,
    onTheLastChance: risk.onTheLastChance,
    conservativePlan,
  });

  const capped = applyCeiling(rules, request.ceilingKilograms, floor, candidates, advisories);
  const previousKilograms = judged?.kilograms ?? null;
  const plannedTargets = reachedBy(document, lifter, lift, targets, planned);

  const built = capped.map((candidate) =>
    buildChoice({
      candidate,
      document,
      lifter,
      lift,
      attemptNumber: next.attemptNumber,
      previousKilograms,
      maximum,
      targets,
      plannedTargets,
      repeatKilograms: bounds.repeatAllowed ? bounds.repeatKilograms : null,
    }),
  );

  const choices = collapseDuplicates(built);
  const highlighted = choices.find((choice) => choice.highlighted) ?? null;

  addTriggerAdvisories(advisories, {
    trigger,
    judged,
    next,
    floor,
    planned,
    risk,
    maximum,
    highlighted,
    extraAttempts,
  });

  return {
    lift,
    trigger,
    attemptId: next.id,
    attemptNumber: next.attemptNumber,
    previousKilograms,
    choices,
    highlightedSlot: highlighted?.slot ?? null,
    advisories,
    extraAttempts,
    bombOut: risk,
    current,
  };
}

function usableMaximum(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * The weight this attempt was going to be before the last result changed anything.
 *
 * Three sources in order of authority: the plan, then a weight already set on the
 * attempt, then the floor. The last is not a recommendation and is not treated as
 * one -- it is what "the plan" means for a lifter who never made one, and every
 * branch that reduces from it reduces to itself.
 */
function plannedWeight(
  rules: MeetRules,
  request: LiveChoicesRequest,
  attemptNumber: number,
  floor: number,
): number {
  const fromPlan = request.plan?.attempts.find(
    (attempt) => attempt.attemptNumber === attemptNumber,
  )?.kilograms;
  const chosen = fromPlan ?? nextWeightFromDocument(request, attemptNumber) ?? floor;
  return Math.max(floor, rules.ceilToLegal(chosen));
}

function nextWeightFromDocument(request: LiveChoicesRequest, attemptNumber: number): number | null {
  const attempt = attemptsOn(request.lifter, request.lift).find(
    (candidate) => candidate.kind === 'competition' && candidate.attemptNumber === attemptNumber,
  );
  return attempt?.kilograms ?? null;
}

/**
 * The top of the planned percentage band, for §13.1's "upper end of the range".
 *
 * Floored onto a legal weight rather than rounded, so the figure stays inside the
 * band the plan named. Where the band is a single percentage -- which is every
 * strategy but Personal Record -- this is the planned weight, and §13.1's "or the
 * upper end" collapses to its first clause, which is the correct reading.
 */
function upperEnd(
  rules: MeetRules,
  request: LiveChoicesRequest,
  attemptNumber: number,
  planned: number,
  maximum: number | null,
): number {
  const { plan } = request;
  if (plan == null || maximum === null) return planned;
  const band = bandFor(plan.percentages, attemptNumber);
  if (band === null) return planned;
  return Math.max(planned, rules.floorToLegal((maximum * band.highPercent) / 100));
}

/**
 * §8.1's ceiling, applied by clamping rather than by removing a choice.
 *
 * Clamping keeps the shape of the offer -- three slots, one highlighted -- when a
 * lifter's own limit lands in the middle of it, and the duplicates that result
 * collapse a moment later. Removing choices instead would sometimes take the
 * highlighted one away, and moving a highlight because of a ceiling is how a
 * screen ends up recommending something nobody chose.
 */
function applyCeiling(
  rules: MeetRules,
  ceilingKilograms: number | null | undefined,
  floor: number,
  candidates: readonly Candidate[],
  advisories: LiveAdvisory[],
): readonly Candidate[] {
  const ceiling = usableMaximum(ceilingKilograms);
  if (ceiling === null) return candidates;

  const cap = rules.floorToLegal(ceiling);
  if (cap < floor - SAME_WEIGHT_SLACK) {
    advisories.push({
      code: 'ceiling-below-the-minimum',
      severity: 'note',
      message: `Your ceiling of ${describe(ceiling)} is below the lightest attempt these rules allow here, which is ${describe(floor)}. Nothing below that is a legal declaration.`,
    });
    return candidates;
  }

  const overCeiling = (candidate: Candidate): boolean =>
    candidate.kilograms !== null && candidate.kilograms > cap + SAME_WEIGHT_SLACK;

  const capped = candidates.map((candidate) =>
    overCeiling(candidate) ? { ...candidate, kilograms: cap } : candidate,
  );

  if (candidates.some(overCeiling)) {
    advisories.push({
      code: 'ceiling-applied',
      severity: 'note',
      message: `Held at your ceiling of ${describe(cap)}.`,
    });
  }
  return capped;
}

function buildChoice(input: {
  readonly candidate: Candidate;
  readonly document: MeetDocument;
  readonly lifter: LiveLifter;
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  readonly previousKilograms: number | null;
  readonly maximum: number | null;
  readonly targets: readonly LiveTarget[];
  readonly plannedTargets: readonly LiveTarget[];
  readonly repeatKilograms: number | null;
}): LiveChoice {
  const { candidate, document, lifter, lift, maximum } = input;
  const { kilograms } = candidate;

  const projected =
    kilograms === null
      ? totalSoFar(document, lifter)
      : projectedTotalWith(document, lifter, lift, kilograms);

  const reaches =
    kilograms === null
      ? reachedBy(document, lifter, lift, input.targets, bestGoodLift(lifter, lift) ?? 0)
      : reachedBy(document, lifter, lift, input.targets, kilograms);

  const surrenders = input.plannedTargets.filter(
    (target) => !reaches.some((reached) => reached === target),
  );

  return {
    slot: candidate.slot,
    kilograms,
    repeat:
      kilograms !== null &&
      input.repeatKilograms !== null &&
      isSameWeight(kilograms, input.repeatKilograms),
    increaseKilograms:
      kilograms === null || input.previousKilograms === null
        ? null
        : kilograms - input.previousKilograms,
    percentOfMaximum: kilograms === null || maximum === null ? null : (kilograms / maximum) * 100,
    projected,
    reaches,
    surrenders,
    risk: gradeRisk(lift, input.attemptNumber, kilograms, maximum),
    tactical: candidate.tactical,
    highlighted: candidate.highlight,
    reason: candidate.reason,
    explanation: EXPLANATIONS[candidate.reason],
  };
}

/**
 * The §10.2 label, or nothing at all.
 *
 * `classifyAttemptRisk` is total and answers Long Shot for a maximum it cannot
 * use, which is the right answer for a caller that has decided to show a label
 * regardless. It is the wrong answer here: a lifter who never confirmed a maximum
 * has not been graded, and putting the harshest of four words on every choice
 * they are offered would be a judgement made out of an absence.
 */
function gradeRisk(
  lift: PlatformLift,
  attemptNumber: number,
  kilograms: number | null,
  maximum: number | null,
): AttemptRisk | null {
  if (kilograms === null || maximum === null) return null;
  if (attemptNumber !== 1 && attemptNumber !== 2 && attemptNumber !== 3) return null;
  return classifyAttemptRisk({ lift, attemptNumber, kilograms, meetDayMaximumKilograms: maximum });
}

/** Which of the supplied targets a weight on this lift would reach, if it were made. */
function reachedBy(
  document: MeetDocument,
  lifter: LiveLifter,
  lift: PlatformLift,
  targets: readonly LiveTarget[],
  kilograms: number,
): readonly LiveTarget[] {
  if (targets.length === 0) return [];
  const projected = projectedTotalWith(document, lifter, lift, kilograms);
  return targets.filter((target) => {
    if (target.measure === 'lift') return isAtLeast(kilograms, target.kilograms);
    // A total target is only reached by a total. A lifter two lifts in has a
    // subtotal, and a subtotal that happens to clear a qualifying figure has
    // qualified for nothing -- they bomb the deadlift and place nowhere.
    return projected.isTotal && isAtLeast(projected.kilograms, target.kilograms);
  });
}

/**
 * The lightest weight on this lift that reaches any supplied target, above a floor.
 *
 * §13.4's tactical third. A total target is converted into a weight on this lift
 * only when every other contested lift already has a good lift -- otherwise the
 * figure would depend on attempts that have not happened, and offering a weight
 * derived from an assumed squat is the false precision the whole document warns
 * about.
 */
function lightestTargetAbove(
  document: MeetDocument,
  lifter: LiveLifter,
  lift: PlatformLift,
  targets: readonly LiveTarget[],
  floor: number,
  rules: MeetRules,
): number | null {
  let lightest: number | null = null;
  for (const target of targets) {
    const needed = weightNeededFor(document, lifter, lift, target);
    if (needed === null) continue;
    const legal = Math.max(floor, rules.ceilToLegal(needed));
    if (lightest === null || legal < lightest) lightest = legal;
  }
  return lightest;
}

function weightNeededFor(
  document: MeetDocument,
  lifter: LiveLifter,
  lift: PlatformLift,
  target: LiveTarget,
): number | null {
  if (target.measure === 'lift') return target.kilograms;
  let banked = 0;
  for (const other of liftsInFormat(document.format)) {
    if (other === lift) continue;
    const best = bestGoodLift(lifter, other);
    if (best === null) return null;
    banked += best;
  }
  return target.kilograms - banked;
}

/**
 * Fold choices that landed on the same weight into one card.
 *
 * A ceiling, a floor or a plan already at the minimum can put two slots on the
 * same figure, and three cards reading 102.5 kg is a screen that looks like it is
 * offering a decision it is not. The earlier slot survives, except that a
 * highlight always moves onto the survivor -- losing it would leave §13's "one
 * highlighted option" with none.
 */
function collapseDuplicates(choices: readonly LiveChoice[]): readonly LiveChoice[] {
  const kept: LiveChoice[] = [];
  for (const choice of choices) {
    const existing = kept.findIndex(
      (other) =>
        (other.kilograms === null && choice.kilograms === null) ||
        (other.kilograms !== null &&
          choice.kilograms !== null &&
          isSameWeight(other.kilograms, choice.kilograms)),
    );
    if (existing === -1) {
      kept.push(choice);
      continue;
    }
    const survivor = kept[existing];
    if (survivor !== undefined && choice.highlighted && !survivor.highlighted) {
      kept[existing] = { ...survivor, highlighted: true };
    }
  }
  return kept;
}

function addExtraAttemptAdvisories(
  advisories: LiveAdvisory[],
  trigger: LiveTrigger,
  extraAttempts: readonly LiveAttempt[],
): void {
  if (trigger === 'platform-error') {
    advisories.push({
      code: 'confirm-the-extra-attempt',
      severity: 'strong',
      message:
        'Confirm the ruling with the head referee or the expeditor. Whether an extra attempt is granted, and when it is taken, is theirs to decide and not this tool’s to assume.',
    });
  }
  if (extraAttempts.length > 0) {
    advisories.push({
      code: 'extra-attempt-timing-unknown',
      severity: 'note',
      message:
        extraAttempts.length === 1
          ? 'An extra attempt is outstanding on this lift. It is tracked separately from the three, because the expeditor decides when it is taken.'
          : `${String(extraAttempts.length)} extra attempts are outstanding on this lift. They are tracked separately from the three, because the expeditor decides when they are taken.`,
    });
  }
}

function addTriggerAdvisories(
  advisories: LiveAdvisory[],
  input: {
    readonly trigger: LiveTrigger;
    readonly judged: LiveAttempt | null;
    readonly next: LiveAttempt;
    readonly floor: number;
    readonly planned: number;
    readonly risk: BombOutRisk;
    readonly maximum: number | null;
    readonly highlighted: LiveChoice | null;
    readonly extraAttempts: readonly LiveAttempt[];
  },
): void {
  const { trigger, risk } = input;

  switch (trigger) {
    case 'effort-not-recorded':
      advisories.push({
        code: 'effort-not-recorded',
        severity: 'note',
        message:
          'How that one felt was not recorded, so these are the weights you planned rather than a reading of the lift.',
      });
      break;
    case 'miss-reason-not-recorded':
      advisories.push({
        code: 'miss-reason-not-recorded',
        severity: 'note',
        message:
          'Why that one was missed was not recorded, so the same weight again is the default rather than a judgement about what went wrong.',
      });
      break;
    case 'slow':
      if (!(input.floor < input.planned - SAME_WEIGHT_SLACK)) {
        advisories.push({
          code: 'reduction-not-possible',
          severity: 'note',
          message: `A lighter attempt is not available: ${describe(input.floor)} is the lightest these rules allow after that lift.`,
        });
      }
      break;
    case 'pain':
    case 'pain-miss':
      advisories.push({
        code: 'cannot-assess-injury',
        severity: 'strong',
        message:
          'This tool cannot assess an injury and will not try to. If something hurt, that judgement belongs to you and the people with you. Stopping the lift here keeps the rest of the day available.',
      });
      break;
    case 'command-miss':
      advisories.push({
        code: 'confirm-the-technical-ruling',
        severity: 'note',
        message:
          'The strength was there. Check the command or the technical call with your coach before the bar is loaded again.',
      });
      break;
    case 'administrative-miss':
      advisories.push({
        code: 'confirm-the-administrative-ruling',
        severity: 'note',
        message: 'Confirm with the scoring table what was recorded and what happens next.',
      });
      break;
    default:
      break;
  }

  if (trigger === 'command-miss' && input.judged?.attemptNumber === 1) {
    advisories.push({
      code: 'bomb-out-risk-on-the-opener',
      severity: 'strong',
      message:
        'That was the opener. Two attempts left, and a lift has to be made on one of them for there to be a total at all.',
    });
  }

  if (risk.misses >= 2 && risk.attemptsRemaining > 0 && risk.onTheLastChance) {
    advisories.push({
      code: 'final-attempt-and-bomb-out',
      severity: 'strong',
      message:
        'Last attempt on this lift, with nothing made yet. Miss it and there is no total for the day.',
    });
  }

  addExtraAttemptAdvisories(advisories, trigger, input.extraAttempts);

  if (input.maximum === null) {
    advisories.push({
      code: 'no-maximum-confirmed',
      severity: 'note',
      message:
        'No meet-day maximum was confirmed, so these weights carry no risk label and no percentage.',
    });
  }

  const surrendered = input.highlighted?.surrenders ?? [];
  if (surrendered.length > 0) {
    advisories.push({
      code: 'target-surrendered',
      severity: 'note',
      message: `Taking the lighter weight gives up ${listTargets(surrendered)} for now.`,
    });
  }
}

function listTargets(targets: readonly LiveTarget[]): string {
  const labels = targets.map((target) => target.label);
  if (labels.length === 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`;
}

/** A kilogram figure without the trailing zeros that read as false precision. */
function describe(kilograms: number): string {
  return `${String(Number(kilograms.toFixed(2)))} kg`;
}
