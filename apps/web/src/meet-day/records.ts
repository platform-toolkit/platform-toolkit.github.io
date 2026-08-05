// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §19's record attempt on the meet-day screen: what somebody typed, and the plan
 * behind it.
 *
 * NOTHING HERE WORKS OUT WHAT A RECORD COSTS
 *
 * `packages/domain/src/records.ts` says what has to go on the bar to take a
 * record, and `packages/domain/src/meet-records.ts` says which of the two routes
 * to it are open and what each is worth. Both of them were built and tested
 * before any screen existed, and this file is the seam between them and one --
 * it holds what was typed, reads it, and hands the readings over. A second
 * margin rule written here would be the §5.8 fork the collection exists to
 * avoid, and it would be discovered by a lifter loading a bar that the tool told
 * them takes a record and does not.
 *
 * KILOGRAMS, AND ONLY KILOGRAMS
 *
 * The record field is not offered in pounds and does not follow the session's
 * display unit. Records are governed in kilograms, record books print kilograms,
 * and §16 is explicit that a pound figure is a conversion for reading and never
 * a number to compute a target from. A lifter typing 445 into a field labelled
 * pounds would be handing over 201.85 kg, a figure no book contains, and every
 * margin below it would be measured from a rounding error. So the field asks for
 * the book's own figure and says so, which is also the shorter question.
 *
 * A TYPED-IN RECORD IS NOT A PUBLISHED ONE, AND MUST NOT LOOK LIKE ONE
 *
 * §19 asks to "allow the user to enter **or** retrieve" a record, and this is the
 * entering half. What comes back is a {@link RecordUnderAttempt} -- the four
 * facts the arithmetic touches -- and deliberately not a `FederationRecord`,
 * because assembling one would mean asserting a sex, a weight class, a division
 * and a discipline the planner never asked about. See the type's own comment in
 * `records.ts`: a fabricated axis that nothing reads is still fabricated, and the
 * day something does read it, it matches the wrong category in silence.
 *
 * The same rule governs what does *not* change. §29's pack omits `'records'`
 * because no record book has been read on this device, and a figure typed into
 * this fold does not retire that omission or reword it. One is a statement about
 * a lifter's own note; the other is a statement about this application's data,
 * and they stay separate.
 *
 * WHERE THE RECORD SITS RELATIVE TO THE MEET IS ASKED, NEVER GUESSED
 *
 * `records.ts` produces two figures for one record and refuses to choose between
 * them, because the condition is the level of the meet being lifted at and no
 * code in this repository can see that. This file does not choose either. It asks
 * ({@link RecordLevelRelation}), and where the answer is "not sure" it takes the
 * domain's own default and says on screen that it has -- with both figures still
 * shown. Silently applying the heavier rule would tell most lifters to load more
 * than the record needs, on every panel nobody has answered.
 */
import type {
  Lift,
  MeetFormat,
  MeetRuleProfile,
  PlatformLift,
} from '@platform-toolkit/data-contracts';
import { LiftSchema } from '@platform-toolkit/data-contracts';
import {
  liftsInFormat,
  recordPlan,
  type MeetRules,
  type RecordMarginRules,
  type RecordPlan,
  type RecordPlanRequest,
  type RecordUnderAttempt,
  type TakenAttempt,
} from '@platform-toolkit/domain';

import { parseWeight, type FieldReading } from './session.js';

/*
 * ---------------------------------------------------------------------------
 * Which record.
 * ---------------------------------------------------------------------------
 */

/**
 * The four things a federation keeps a record in.
 *
 * An alias of the record contract's own `Lift` rather than a fourth spelling of
 * the same list, so that {@link recordUnderAttemptFrom} can hand the answer
 * straight to `RecordScope.lift` with nothing in between to drift. It is
 * deliberately not `PlatformLift`, which is the three lifts an attempt is taken
 * *on*: a total is a record a lifter can chase and is not a thing they walk onto
 * a platform to attempt, which is exactly why the two picklists exist.
 */
export type RecordSubject = Lift;

export const RECORD_SUBJECTS: readonly RecordSubject[] = LiftSchema.options;

/**
 * The subjects this meet has records for.
 *
 * The total is offered even in a single-lift meet, where it is arithmetically
 * the same weight as the one lift. That is not a bug to be tidied away: a
 * federation publishes a bench record and a bench-only total record separately,
 * they can stand at different figures, and deciding here that one of them is
 * redundant would hide a record a lifter came to take.
 */
export function recordSubjectsIn(format: MeetFormat): readonly RecordSubject[] {
  return [...liftsInFormat(format), 'total'];
}

/**
 * Which subject the fold is showing, clamped to the ones this meet contests.
 *
 * The same shape the warm-up fold's lift picker uses and for the same reason:
 * the clamp is shared so it cannot be spelled two ways. `null` means the meet
 * contests nothing at all.
 */
export function recordSubjectIn(
  subjects: readonly RecordSubject[],
  picked: RecordSubject,
): RecordSubject | null {
  const first = subjects[0];
  if (first === undefined) return null;
  return subjects.includes(picked) ? picked : first;
}

/**
 * The lift a record attempt on this subject is taken on.
 *
 * A total record is taken on the meet's **last** lift, and that is arithmetic
 * rather than a convention: a total is not a total until every lift is over, so
 * an attempt that raises it past a record can only be the final one. Asking the
 * lifter which lift instead would be asking a question with one answer.
 *
 * `null` for a lift the format does not contest, which is a caller that has not
 * passed its picker through {@link recordSubjectIn}.
 */
export function liftForSubject(subject: RecordSubject, format: MeetFormat): PlatformLift | null {
  const lifts = liftsInFormat(format);
  if (subject === 'total') return lifts.at(-1) ?? null;
  return lifts.includes(subject) ? subject : null;
}

/*
 * ---------------------------------------------------------------------------
 * Where the record sits against this meet.
 * ---------------------------------------------------------------------------
 */

/**
 * The question `records.ts` says nothing in this repository can answer.
 *
 * Three answers rather than a checkbox, because the third one is real and is not
 * the same as either of the others. A lifter who has not been told whether their
 * state meet is sanctioned to allow a national claim is in a different position
 * from one who knows it is not, and a two-way control would file them both under
 * whichever side it defaulted to.
 */
export type RecordLevelRelation =
  /** A state record at a state meet, or a national record at a state meet that allows the claim. */
  | 'at-or-above-the-meet'
  /** A state record at a national championship: the full loading increment, on a legal load. */
  | 'below-the-meet'
  /** Not answered. Both figures are shown and the assumption is stated. */
  | 'not-sure';

export const RECORD_LEVEL_RELATIONS: readonly RecordLevelRelation[] = [
  'at-or-above-the-meet',
  'below-the-meet',
  'not-sure',
];

/*
 * ---------------------------------------------------------------------------
 * What was typed.
 * ---------------------------------------------------------------------------
 */

/** Everything one lifter has typed about one record. */
export interface MeetRecordState {
  /** The record in kilograms, as the book prints it. Never a pound figure. */
  readonly kilograms: string;

  /**
   * What the book calls the level -- "State", "National". Shown back, never matched on.
   *
   * Held for the screen and for §24's save, and deliberately not used as a
   * `RecordScope.levelId`. See {@link recordUnderAttemptFrom}.
   */
  readonly levelLabel: string;

  /**
   * Whether the figure is a standard the federation seeded the book with rather
   * than a lift somebody made.
   *
   * False until answered, which asserts that somebody holds it. That is the safe
   * direction: a record somebody holds is never matched into, so the lifter is
   * asked for the margin over it. Defaulting the other way would tell a lifter
   * that putting the record itself on the bar takes it.
   */
  readonly unclaimed: boolean;

  readonly levelRelation: RecordLevelRelation;

  /**
   * The total the other lifts have already banked, in kilograms.
   *
   * Only read for a total record. Empty rather than zero for `session.ts`'s
   * reason: a total of zero is a lifter who has bombed everything else, and
   * `meet-records.ts` refuses to plan a record attempt off it.
   */
  readonly totalFromOtherLifts: string;
}

export const EMPTY_RECORD_STATE: MeetRecordState = {
  kilograms: '',
  levelLabel: '',
  unclaimed: false,
  levelRelation: 'not-sure',
  totalFromOtherLifts: '',
};

/**
 * One lifter's record answers, per subject.
 *
 * Total over {@link RecordSubject} rather than partial, for the reason
 * `WarmupStates` is: a subject the format does not contest is one nobody will
 * ask about, and a missing key is a question every reader downstream has to
 * decide the meaning of.
 *
 * **Nothing fans out between subjects**, which is the difference from the
 * warm-up fold and is worth saying rather than leaving as an absence. Every
 * field above is a fact about one record: the squat record and the total record
 * stand at different figures, at levels the federation may have set separately,
 * and one of them can be unclaimed while the other is not. Carrying any of it
 * across would fill in an answer about a record nobody has looked up.
 */
export type RecordStates = Readonly<Record<RecordSubject, MeetRecordState>>;

export const EMPTY_RECORD_STATES: RecordStates = {
  squat: EMPTY_RECORD_STATE,
  bench: EMPTY_RECORD_STATE,
  deadlift: EMPTY_RECORD_STATE,
  total: EMPTY_RECORD_STATE,
};

/**
 * Whether nobody has answered anything about this record.
 *
 * Structural rather than an identity check against {@link EMPTY_RECORD_STATE},
 * because the one caller is the restore path and a state that arrived through
 * `JSON.parse` is a fresh object however empty it is. That is the opposite of the
 * call `#savedRecords` makes on the way out, where identity is the point and a
 * deep walk on every keystroke is the thing being avoided -- here it runs once
 * per restore, over five scalars.
 *
 * `levelRelation` is compared against `'not-sure'` rather than being skipped: it
 * is the one field with a non-empty default, and a lifter who answered only that
 * one has told the fold something worth flagging as saved.
 */
export function isBlankRecord(state: MeetRecordState): boolean {
  return (
    state.kilograms === '' &&
    state.levelLabel === '' &&
    !state.unclaimed &&
    state.levelRelation === 'not-sure' &&
    state.totalFromOtherLifts === ''
  );
}

/** Writes one subject's answers, leaving the other three exactly as they were. */
export function withRecordFor(
  states: RecordStates,
  subject: RecordSubject,
  state: MeetRecordState,
): RecordStates {
  return {
    squat: subject === 'squat' ? state : states.squat,
    bench: subject === 'bench' ? state : states.bench,
    deadlift: subject === 'deadlift' ? state : states.deadlift,
    total: subject === 'total' ? state : states.total,
  };
}

/** One field's answer, replaced. */
export function withRecord(
  state: MeetRecordState,
  patch: Partial<MeetRecordState>,
): MeetRecordState {
  return { ...state, ...patch };
}

/**
 * §21's board, holding one whole {@link RecordStates} per lifter.
 *
 * A `Map` and not a `Record<string, RecordStates>`, for the trap `WarmupsByLifter`
 * documents at length: a lifter id can arrive from an imported meet file, and a
 * plain object inherits `Object.prototype`, so a lifter whose id is `constructor`
 * reads back a function typed as state.
 */
export type RecordsByLifter = ReadonlyMap<string, RecordStates>;

export const NO_RECORDS: RecordsByLifter = new Map<string, RecordStates>();

/** One lifter's four records, or four empty ones for a lifter nobody has typed about. */
export function recordsFor(all: RecordsByLifter, lifterId: string): RecordStates {
  return all.get(lifterId) ?? EMPTY_RECORD_STATES;
}

export function withRecordForLifter(
  all: RecordsByLifter,
  lifterId: string,
  subject: RecordSubject,
  state: MeetRecordState,
): RecordsByLifter {
  const next = new Map(all);
  next.set(lifterId, withRecordFor(recordsFor(all, lifterId), subject, state));
  return next;
}

/*
 * ---------------------------------------------------------------------------
 * The margins, out of the rule profile.
 * ---------------------------------------------------------------------------
 */

/**
 * What taking a record costs, derived from the meet's rule profile.
 *
 * `RecordMarginRules` is normally three fields off a `RecordBook`, and no record
 * book has been read on this device (§29). The rule profile has been, it is the
 * federation's own published document, and two of the three figures are in it --
 * so they are taken from there rather than assumed, and the third is answered in
 * the direction that costs an attempt rather than the record.
 *
 * `minimumIncrementKilograms` is the fourth attempt's `minimumExcessKilograms`:
 * the two are the same rule read from two published sources, which is the point
 * `meet-records.ts` opens on. Where a profile publishes no fourth-attempt block
 * at all there is no figure to read, and the fallback is the loading increment --
 * larger than any federation's record margin, so the lifter is asked for more
 * than the rules demand rather than less.
 *
 * `higherSanctionIncrementKilograms` is the bar multiple, because that is what
 * the rule below the meet's level asks for by name: the full loading increment,
 * on a load the bar can actually make. `records.ts` applies both halves of that
 * from this one field.
 *
 * `matchTakesUnclaimedLevelIds` is empty, and it is empty as an answer rather
 * than as a gap. Which levels may be matched into is published in the record
 * book and nowhere else; with no book, no level qualifies, and every unclaimed
 * record costs the ordinary margin. That is the safe direction and `records.ts`
 * says so: being asked for more than the rules demand costs an attempt, being
 * asked for less costs the record.
 */
export function marginRulesFrom(profile: MeetRuleProfile): RecordMarginRules {
  return {
    minimumIncrementKilograms:
      profile.fourthAttempt?.minimumExcessKilograms ?? profile.barMultipleKilograms,
    higherSanctionIncrementKilograms: profile.barMultipleKilograms,
    matchTakesUnclaimedLevelIds: [],
  };
}

/*
 * ---------------------------------------------------------------------------
 * The record itself.
 * ---------------------------------------------------------------------------
 */

/**
 * The typed record as the domain wants it, or `null` while the field will not read.
 *
 * `sourceDisagreement` is `null` because there is one figure and nothing for it
 * to disagree with. That is a fact and not a default: the field exists to carry a
 * publisher's own comparison of two printed columns, and a lifter typing one
 * number has made no such comparison to record.
 *
 * `levelId` is the empty string, and the typed {@link MeetRecordState.levelLabel}
 * is deliberately *not* used for it. The id is read in exactly one place --
 * against `matchTakesUnclaimedLevelIds`, to decide whether an unclaimed record
 * may be taken by matching it rather than exceeding it. A free-text label that
 * happened to collide with a federation's own identifier would turn a typo into
 * permission to load the record itself, which is the direction that costs the
 * record. An id that matches nothing always falls back to the ordinary margin.
 */
export function recordUnderAttemptFrom(
  state: MeetRecordState,
  subject: RecordSubject,
): RecordUnderAttempt | null {
  const reading = parseWeight(state.kilograms, 'kg');
  if (!reading.ok) return null;
  return {
    kilograms: reading.value,
    unclaimed: state.unclaimed,
    sourceDisagreement: null,
    scope: { lift: subject, levelId: '' },
  };
}

/*
 * ---------------------------------------------------------------------------
 * Building the thing.
 * ---------------------------------------------------------------------------
 */

/** The attempt a record would be taken on, which the caller knows and this file does not. */
export interface RecordAttemptSubject {
  /** The lift the attempt is taken on. See {@link liftForSubject}. */
  readonly lift: PlatformLift;

  readonly rules: MeetRules;

  /**
   * Every attempt already taken on that lift, in any order.
   *
   * Empty on the planning screen, which is honest rather than a stub: nothing has
   * been lifted, so the competition route is open and the fourth-attempt route
   * refuses with `no-third-attempt-yet`. That is the true state of a record
   * attempt on the Thursday before a meet.
   */
  readonly taken: readonly TakenAttempt[];
}

/** §19's whole answer for one record, plus the sentences the fields under it need. */
export interface MeetRecordView {
  readonly plan: RecordPlan;

  /** The reading for the record field, so the screen can show its sentence. */
  readonly kilogramsReading: FieldReading;

  /** The reading for the banked-total field. Only shown for a total record. */
  readonly totalSoFarReading: FieldReading;

  /**
   * What the screen would say instead if that record turned out to be from a
   * smaller meet, or `null` when the question changes nothing on screen.
   *
   * Non-null only when the relation was left unanswered **and** answering it
   * moves a weight the routes actually name. A caveat about a distinction that
   * does not bite here reads as a rule the lifter has failed to understand.
   *
   * **This compares the routes, not the targets, and the difference is the whole
   * value of the field.** The two are not the same question: the rule that
   * charges the full increment is the bar multiple by construction
   * (`recordTargets` says so), so a competition attempt -- which is rounded onto
   * that multiple anyway -- lands on the same weight under both conditions
   * almost every time. Compared as targets this was true on the planning screen
   * and named a figure already printed beside it, under a heading whose weight
   * the answer could not move.
   */
  readonly relationAlternative: number | null;

  /** Whether the subject is the total, which is the one that needs the banked figure. */
  readonly isTotalRecord: boolean;
}

/**
 * Everything §19 has to say about one record, at one instant.
 *
 * Never refuses. A record nobody has typed is a {@link RecordPlan} whose routes
 * both answer `no-record-supplied` and which still carries `verifyWithOfficials`,
 * because a screen saying "no record supplied" is a screen a lifter may act on by
 * typing one in. A separate failure branch here would have taken that sentence
 * off exactly the screen that needs it.
 */
export function buildMeetRecord(
  state: MeetRecordState,
  subject: RecordSubject,
  attempt: RecordAttemptSubject,
): MeetRecordView {
  const kilogramsReading = parseWeight(state.kilograms, 'kg');
  const totalSoFarReading = parseWeight(state.totalFromOtherLifts, 'kg');

  const request: RecordPlanRequest = {
    record: recordUnderAttemptFrom(state, subject),
    marginRules: marginRulesFrom(attempt.rules.profile),
    rules: attempt.rules,
    lift: attempt.lift,
    taken: attempt.taken,
    recordIsBelowMeetLevel: state.levelRelation === 'below-the-meet',
    totalFromOtherLiftsKilograms: totalSoFarReading.ok ? totalSoFarReading.value : null,
  };
  const plan = recordPlan(request);

  return {
    plan,
    kilogramsReading,
    totalSoFarReading,
    relationAlternative:
      state.levelRelation === 'not-sure'
        ? movedBy(plan, recordPlan({ ...request, recordIsBelowMeetLevel: true }))
        : null,
    isTotalRecord: subject === 'total',
  };
}

/**
 * The two routes a record plan answers, in the order the fold draws them.
 */
const RECORD_ROUTES = ['inCompetition', 'asFourthAttempt'] as const;

/**
 * The weight a route would name under the other condition, or `null` when it
 * would name the weight it already does.
 *
 * **At most one of the two routes can answer at all**, which is what lets this
 * return the first one it finds rather than fold over them. They are the same
 * counter read from opposite ends: `asFourthAttempt` is refused with
 * `no-third-attempt-yet` until the last competition attempt has been taken, and
 * `inCompetition` is refused with `no-competition-attempts-left` from the moment
 * it has, both against the profile's own `attemptsPerLift`.
 *
 * The first version of this built a parallel array of weights with `null` for a
 * shut route and took `Math.max` over whatever had moved, and two mutations
 * survived it -- `Math.max` to `Math.min`, and the `null` to `0`. Neither was a
 * missing test. A list that can never hold two entries cannot tell a maximum
 * from a minimum, and a sentinel that is never compared against a real weight
 * cannot tell `null` from `0`; both were generality the rules make unreachable,
 * and the honest fix was to stop writing it rather than to contrive an attempt
 * list no lifter can produce.
 *
 * A route is compared only where it answers under *both* conditions. One that
 * shuts under the heavier condition contributes nothing -- there is no weight to
 * name -- and that is deliberate rather than an oversight: "there would be no
 * attempt left that reaches it" is a different sentence, and printing it under
 * this caveat would put a figure on a route that has none.
 */
function movedBy(shown: RecordPlan, below: RecordPlan): number | null {
  for (const route of RECORD_ROUTES) {
    const before = shown[route];
    const after = below[route];
    if (!before.available || !after.available) continue;
    if (before.route.kilograms === after.route.kilograms) continue;
    return after.route.kilograms;
  }
  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Reading a control's value.
 *
 * The same crossing `session.ts`, `prep.ts` and `warmup.ts` document: a radio's
 * value is a string out of the DOM, both of these are total, and an
 * unrecognised value lands on an answer a control can show back.
 * ---------------------------------------------------------------------------
 */

function oneOf<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function recordSubjectFromValue(value: string): RecordSubject {
  return oneOf(RECORD_SUBJECTS, value, 'squat');
}

export function recordLevelRelationFromValue(value: string): RecordLevelRelation {
  return oneOf(RECORD_LEVEL_RELATIONS, value, 'not-sure');
}
