// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §20's warm-up on the meet's clock: the answers, and the two engines behind them.
 *
 * NOTHING HERE CALCULATES A RAMP
 *
 * `packages/domain/src/meet-warmup.ts` builds the schedule and
 * `platform-timing.ts` estimates when the lifter is up. This file is the seam
 * between those two and a screen: it holds what somebody typed, reads it, and
 * hands the readings over. §20 opens with "reuse the existing warm-up calculator
 * with a meet-day preset", and the way to obey that instruction is for this file
 * to contain no arithmetic about barbells at all -- a second spacing rule written
 * here would be the §5.8 fork the collection exists to avoid, and it would be
 * discovered by a lifter finding two different warm-ups for one opener.
 *
 * THE ROOM IS TOOL 2'S `Equipment`, NOT A SECOND INVENTORY MODEL
 *
 * §20 asks for "a meet-specific plate inventory that differs from the user's
 * normal gym". Two words of that are the requirement -- *meet-specific* and
 * *differs* -- and neither of them is a reason to describe a rack twice. So the
 * warm-up room is an `Equipment`, the same shape `ptk-equipment-setup` already
 * edits, held separately from the one tool 2 remembers. The defaults differ and
 * only the defaults: tool 2 opens on a pound gym because that is where somebody
 * meeting a barbell calculator is standing, and a warm-up room behind a platform
 * is kilogram plates, a 20 kg bar and competition collars, which weigh five
 * kilograms and change every reachable weight.
 *
 * THE SCHEDULE IS DERIVED, AND ONLY THE ANSWERS ARE HELD
 *
 * The same rule `prep.ts` states about its checklist, and here it is §20.1's
 * requirement rather than a preference: "update the estimate when attempt
 * selections and current meet position change". A stored schedule is a schedule
 * that goes on saying the final warm-up is in nine minutes after the flight ahead
 * ran twenty minutes long. So {@link buildMeetWarmup} is called for the paint,
 * every time, and `WarmupTimeline` carries the instant it was counted from so
 * that `warmup-timeline.ts` can age it between paints.
 *
 * EVERY FIGURE IS TYPED TEXT UNTIL SOMETHING READS IT
 *
 * `session.ts`'s rule, for `session.ts`'s reasons. A field a lifter has cleared
 * mid-thought is not a zero, and `Number('')` is. Every answer below is a string
 * and every reading is a {@link FieldReading}, which distinguishes *nothing
 * typed* from *typed wrong* -- and on this screen almost everything is optional,
 * so *nothing typed* is the common case and must not draw a sentence.
 *
 * WHAT IS ASKED RATHER THAN DERIVED, AND WHY
 *
 * §20.1 lists ten inputs and this application can see none of them. The meet
 * document on this device is one coach's record of the lifters they came with;
 * it does not know how big the flight is, which flight is on the platform, or
 * how far into it the expeditor has got. Deriving those from the document would
 * produce a confident figure about a room the tool cannot see. So they are
 * questions, and the two that can be measured -- the pace, from attempts and
 * elapsed time -- are measured and labelled as measured.
 */
import {
  assumedPace,
  meetWarmup,
  observedPace,
  platformEstimate,
  type DelayPreference,
  type EquipmentPrep,
  type FlightPosition,
  type MeetPace,
  type MeetWarmupSchedule,
  type PlatformEstimate,
  type Weight,
  type WarmupAdjustment,
  type WarmupProblem,
  type WarmupReps,
  type WarmupTimeline,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';
import { liftsInFormat } from '@platform-toolkit/domain';

import { DEFAULT_EQUIPMENT, toBarbellSetup, type Equipment } from '../warm-up/equipment.js';
import { parseCount, parseWeight, type FieldReading } from './session.js';

const SECONDS_PER_MINUTE = 60;

/*
 * ---------------------------------------------------------------------------
 * The room.
 * ---------------------------------------------------------------------------
 */

/**
 * The warm-up room behind a platform, before anybody corrects it.
 *
 * Tool 2's `DEFAULT_EQUIPMENT` with three answers changed, rather than a fresh
 * object: the inventory is the part with nine denominations in it and copying
 * that here is how the two lists come to disagree the day one of them gains a
 * plate size. What changes is what a meet changes -- the sport is scored in
 * kilograms, the bar behind the platform is a 20 kg Olympic bar, and the collars
 * are the competition pair. That last one is not a detail: five kilograms of
 * collar moves every single weight the calculator can reach, so defaulting it to
 * "none" here would produce a ramp that is right about the plates and wrong
 * about every total.
 */
export const DEFAULT_WARM_UP_ROOM: Equipment = {
  ...DEFAULT_EQUIPMENT,
  plateUnit: 'kg',
  barId: 'olympic-20',
  collarId: 'competition',
};

/*
 * ---------------------------------------------------------------------------
 * §20's preparation times.
 * ---------------------------------------------------------------------------
 */

/**
 * The preparations §20 names, in the order it names them.
 *
 * A closed list rather than rows somebody adds, because every one of these is a
 * garment or a wrap with a fixed place in the routine, and the useful control
 * over them is a time each rather than a builder. `other` is the requirement's
 * own escape hatch and carries no opinion about when it happens.
 *
 * The kind is also the {@link EquipmentPrep.id}, which is what lets a scheduled
 * item be named on screen without a lookup table between the two. That works
 * only because there is at most one row per kind; a second `other` would need a
 * minted id and a counter to mint it, and nothing in §20 asks for two.
 */
export type PrepKind = 'knee-wraps' | 'bench-shirt' | 'squat-suit' | 'deadlift-suit' | 'other';

export const PREP_KINDS: readonly PrepKind[] = [
  'knee-wraps',
  'bench-shirt',
  'squat-suit',
  'deadlift-suit',
  'other',
];

/** Which side of the ramp a preparation falls on. The engine refuses to guess. */
export type PrepWhen = EquipmentPrep['when'];

export const PREP_WHENS: readonly PrepWhen[] = ['before-the-ramp', 'after-the-final-warm-up'];

/**
 * Where each preparation goes unless the lifter says otherwise.
 *
 * Proposed, not decided -- `when` is an answer on every row, because routines
 * differ and the cost of being wrong is a schedule that has somebody wrapping
 * their knees while they are being called to the bar. What the table encodes is
 * the common case for each: knee wraps go on last because they are painful and
 * cut off circulation, and gear goes on first because the top warm-ups are taken
 * in it -- a lifter who has never squatted a heavy single in the suit they are
 * about to open in has not warmed up.
 *
 * `other` defaults to the front for the reason the two are not symmetric:
 * preparation before the ramp moves the whole timeline earlier and costs
 * nothing, and preparation inside the lead widens the lead and draws a caution
 * when it will not fit. An unnamed preparation should not do the second by
 * default.
 */
const PREP_WHEN_BY_DEFAULT: Readonly<Record<PrepKind, PrepWhen>> = {
  'knee-wraps': 'after-the-final-warm-up',
  'bench-shirt': 'before-the-ramp',
  'squat-suit': 'before-the-ramp',
  'deadlift-suit': 'before-the-ramp',
  other: 'before-the-ramp',
};

/** One preparation, as typed. Blank minutes means it is not on the schedule. */
export interface PrepAnswer {
  readonly minutes: string;
  readonly when: PrepWhen;
}

export type PrepAnswers = Readonly<Record<PrepKind, PrepAnswer>>;

const EMPTY_PREP_ANSWERS: PrepAnswers = {
  'knee-wraps': { minutes: '', when: PREP_WHEN_BY_DEFAULT['knee-wraps'] },
  'bench-shirt': { minutes: '', when: PREP_WHEN_BY_DEFAULT['bench-shirt'] },
  'squat-suit': { minutes: '', when: PREP_WHEN_BY_DEFAULT['squat-suit'] },
  'deadlift-suit': { minutes: '', when: PREP_WHEN_BY_DEFAULT['deadlift-suit'] },
  other: { minutes: '', when: PREP_WHEN_BY_DEFAULT.other },
};

/**
 * Which lift a preparation is put on for.
 *
 * The single table both readings below are taken from. Two tables -- one saying
 * which rows a meet offers, one saying which items a ramp is charged for --
 * would be the same fact written twice, and the day they disagree the screen
 * offers a row that changes nothing on any timeline the lifter can reach.
 *
 * `other` is on every lift, which is the honest answer for a catch-all: the tool
 * does not know what the gear is, so it cannot know which lift it is for, and
 * the lifter is looking at one ramp when they fill the row in.
 */
export function prepAppliesTo(kind: PrepKind, lift: PlatformLift): boolean {
  switch (kind) {
    case 'knee-wraps':
    case 'squat-suit':
      return lift === 'squat';
    case 'bench-shirt':
      return lift === 'bench';
    case 'deadlift-suit':
      return lift === 'deadlift';
    case 'other':
      return true;
  }
}

/**
 * Which preparations are worth a row at this meet.
 *
 * The lifts contested, and nothing else. Gating on the equipment category as
 * well was tried and is wrong in the direction that matters: a raw lifter with a
 * blank knee-wrap field has lost nothing, and a lifter whose category is
 * `unstated` -- the default, and what most sessions carry -- would be offered no
 * row for the gear they are about to put on. Over-offering costs a field nobody
 * fills; under-offering costs the one figure that decides when they start.
 *
 * Note that this is the *meet's* list and not one lift's: a full-power lifter
 * answers for their wraps and their shirt in one place, on one screen, the night
 * before. Which of those answers reaches a given ramp is {@link prepFor}'s
 * question, and it is a different one.
 */
export function prepKindsFor(format: MeetFormat): readonly PrepKind[] {
  const lifts = liftsInFormat(format);
  return PREP_KINDS.filter((kind) => lifts.some((lift) => prepAppliesTo(kind, lift)));
}

/*
 * ---------------------------------------------------------------------------
 * §20's customisation, and §20.1's answers.
 * ---------------------------------------------------------------------------
 */

/** Everything §20 lets a lifter change about the ramp, as typed. */
export interface WarmupPreferences {
  /** §20's ten-to-twelve-minute window, both ends adjustable. */
  readonly leadMinimumMinutes: string;
  readonly leadMaximumMinutes: string;
  /** Between warm-up sets. Seconds, because ninety of them is a normal answer. */
  readonly restSeconds: string;
  /** How long one warm-up set takes, bar loaded to bar cleared. */
  readonly setSeconds: string;
  /** §20's "number of warm-ups". Blank means however many the ramp produced. */
  readonly maximumSets: string;
  /** Lifters on the warm-up bar including this one. Blank means alone. */
  readonly sharedRackLifters: string;
  readonly delayPreference: DelayPreference;
  readonly prep: PrepAnswers;
}

/**
 * §20's default lead, restated here as text rather than read off the domain.
 *
 * The domain's `DEFAULT_FINAL_WARMUP_LEAD` is in seconds and is what applies
 * when these fields are blank; these two are what the fields are *pre-filled*
 * with, and pre-filling them is deliberate. A blank pair would leave the most
 * important figure on the screen invisible -- §20's whole default is "the final
 * warm-up about ten to twelve minutes before the attempt" -- and a lifter who
 * wants eight cannot ask for it if they cannot see what they are changing.
 */
export const DEFAULT_LEAD_MINUTES = { minimum: '10', maximum: '12' } as const;

export const EMPTY_PREFERENCES: WarmupPreferences = {
  leadMinimumMinutes: DEFAULT_LEAD_MINUTES.minimum,
  leadMaximumMinutes: DEFAULT_LEAD_MINUTES.maximum,
  restSeconds: '',
  setSeconds: '',
  maximumSets: '',
  sharedRackLifters: '',
  delayPreference: 'wait',
  prep: EMPTY_PREP_ANSWERS,
};

/**
 * Whether the lifter's own flight is the one on the platform.
 *
 * Two answers because `FlightPosition` has two cases, and they are two cases
 * because a handler reads two different things off the board depending on which
 * holds. Stored as the discriminant rather than as the whole union so that
 * switching between them does not throw away the numbers typed under the other
 * -- a flight that has just been called is somebody flipping this control, and
 * losing what they typed a minute ago is the cost of modelling it as a union
 * here.
 */
export type MeetPlace = FlightPosition['kind'];

export const MEET_PLACES: readonly MeetPlace[] = ['earlier-flight-running', 'own-flight-running'];

/** §20.1's ten inputs, as typed. All optional; the estimate degrades honestly. */
export interface MeetProgress {
  readonly place: MeetPlace;
  /** Where the lifter's own flight has got to. `place: 'own-flight-running'`. */
  readonly currentRound: string;
  readonly currentPosition: string;
  /** How much is left in front of it. `place: 'earlier-flight-running'`. */
  readonly attemptsLeftInTheRunningFlight: string;
  readonly wholeFlightsBetween: string;
  /** Lifters in the user's own flight. */
  readonly flightSize: string;
  /** The two figures behind an observed pace: attempts run, and how long over. */
  readonly attemptsCompleted: string;
  readonly minutesSinceSessionStart: string;
  /** Scheduled breaks between now and the attempt. A published figure, not a guess. */
  readonly breakMinutes: string;
  /** Delay already accumulated. Moves the timeline and widens nothing. */
  readonly delayMinutes: string;
  /** The round the lifter is asking about, and where they expect to be in it. */
  readonly targetRound: string;
  readonly targetPosition: string;
}

export const EMPTY_PROGRESS: MeetProgress = {
  place: 'earlier-flight-running',
  currentRound: '',
  currentPosition: '',
  attemptsLeftInTheRunningFlight: '',
  wholeFlightsBetween: '',
  flightSize: '',
  attemptsCompleted: '',
  minutesSinceSessionStart: '',
  breakMinutes: '',
  delayMinutes: '',
  targetRound: '',
  targetPosition: '',
};

/**
 * One set the lifter gave their own figure for.
 *
 * Held by index into the ramp, which is what `warmup-adjust.ts` takes, and
 * therefore inherits its behaviour when the ramp changes shape: an entry naming
 * a set that is no longer there is dropped rather than reported. That is the
 * right answer here for the same reason it is right there -- the ramp shortens
 * when the flight speeds up, and a warning about a set the lifter can no longer
 * see is a warning about nothing.
 */
export interface SetAnswer {
  readonly index: number;
  readonly text: string;
}

/** Everything one lifter has typed about one meet's warm-up. */
export interface MeetWarmupState {
  readonly room: Equipment;
  readonly preferences: WarmupPreferences;
  readonly progress: MeetProgress;
  /** §20's per-set weights, in the room's plate unit. */
  readonly weights: readonly SetAnswer[];
  /** §20's per-set repetitions. */
  readonly reps: readonly SetAnswer[];
}

export const EMPTY_WARMUP_STATE: MeetWarmupState = {
  room: DEFAULT_WARM_UP_ROOM,
  preferences: EMPTY_PREFERENCES,
  progress: EMPTY_PROGRESS,
  weights: [],
  reps: [],
};

/**
 * One lifter's warm-up answers, per lift.
 *
 * **Total over `PlatformLift` rather than partial**, for the reason §13.10's
 * `LivePlanning` is: a lift the format does not contest is one nobody will ask
 * about, and a missing key is a question every reader downstream has to decide
 * the meaning of. A format corrected mid-session also has to be able to change
 * its mind without deleting what was typed about a lift that is briefly off
 * screen.
 *
 * Three states rather than one because {@link SetAnswer} is held by index *into
 * one ramp*, so a squat override at index three names a bench set at index three
 * the moment the picker moves. Everything else the lifter types is a fact about
 * the meet or the room and belongs to all three; {@link withWarmupFor} is what
 * keeps those two halves apart.
 */
export type WarmupStates = Readonly<Record<PlatformLift, MeetWarmupState>>;

export const EMPTY_WARMUP_STATES: WarmupStates = {
  squat: EMPTY_WARMUP_STATE,
  bench: EMPTY_WARMUP_STATE,
  deadlift: EMPTY_WARMUP_STATE,
};

/*
 * ---------------------------------------------------------------------------
 * Bounds.
 *
 * Every one of these is the point past which a typo has plainly happened
 * rather than a rule about the sport. They exist because `parseCount` needs a
 * ceiling and because §5.12's preference writes throw on a value that violates
 * their own definition, so a figure that cannot be stored must not be typeable.
 * ---------------------------------------------------------------------------
 */

/** Rounds, positions and flights. A flight of a hundred is two flights. */
export const FLIGHT_BOUNDS = { min: 1, max: 100 } as const;
/** Rounds. Four, because a fourth attempt is a record try and is still a round. */
export const ROUND_BOUNDS = { min: 1, max: 4 } as const;
/** A round is not started yet at zero, which is a real answer and not a blank. */
export const POSITION_BOUNDS = { min: 0, max: 100 } as const;
/** Attempts run in a session. Three lifts, four rounds, a hundred lifters. */
export const ATTEMPTS_BOUNDS = { min: 0, max: 2000 } as const;
/** Minutes into a session, or of break, or of delay. A very long day is twelve hours. */
export const MINUTES_BOUNDS = { min: 0, max: 720 } as const;
/** The lead between the final warm-up and the bar. An hour is not a lead. */
export const LEAD_BOUNDS = { min: 0, max: 60 } as const;
/** Seconds of rest, or of one set. Ten minutes between warm-ups is a different plan. */
export const SECONDS_BOUNDS = { min: 0, max: 600 } as const;
/** Warm-up sets. `MAX_RAMP_SETS` is seven; this is the field's ceiling, not the ramp's. */
export const SETS_BOUNDS = { min: 1, max: 20 } as const;
/** Lifters queueing for one warm-up bar. Past this it is not a shared bar. */
export const RACK_BOUNDS = { min: 1, max: 10 } as const;
/** Repetitions in one warm-up set. */
export const REPS_BOUNDS = { min: 1, max: 20 } as const;

/*
 * ---------------------------------------------------------------------------
 * Reading what was typed.
 * ---------------------------------------------------------------------------
 */

function minutes(text: string, what: string): FieldReading {
  return parseCount(text, what, MINUTES_BOUNDS);
}

/** A count, or `null` where nothing was typed or what was typed will not read. */
function countOrNull(reading: FieldReading): number | null {
  return reading.ok ? reading.value : null;
}

/**
 * The pace this session has actually run at, or the assumption, labelled.
 *
 * `observedPace` returns `null` rather than falling back, and this is the one
 * place in the application that has to decide what to do about that. It falls
 * back to `assumedPace`, which carries `source: 'assumed'` and therefore the
 * widest spread -- so the estimate visibly loses confidence rather than quietly
 * keeping it.
 *
 * Half a measurement is a guess, and a blank becomes a zero here rather than an
 * early return because `observedPace` already refuses both of the shapes that
 * produces: no elapsed time is not a positive duration, and no attempt count is
 * below `MIN_ATTEMPTS_FOR_OBSERVED_PACE`. Guarding it a second time here was
 * written first and then removed -- it read as a rule about half-filled fields
 * and was in fact a branch nothing could reach, which is the kind of line a
 * later reader trusts and reasons from.
 */
export function paceFor(progress: MeetProgress): MeetPace {
  const attempts = countOrNull(parseCount(progress.attemptsCompleted, 'attempts', ATTEMPTS_BOUNDS));
  const elapsed = countOrNull(minutes(progress.minutesSinceSessionStart, 'minutes'));
  return observedPace(attempts ?? 0, (elapsed ?? 0) * SECONDS_PER_MINUTE) ?? assumedPace();
}

/**
 * §20.1's position, in whichever of its two shapes the answer is in.
 *
 * The blanks fall to the answer that claims least. A missing "attempts left in
 * the running flight" becomes zero, which says the flight ahead is finishing
 * now; a missing round or position becomes the start of the round. Both of those
 * make the estimate *earlier* than the truth, which is the direction §5.5 makes
 * everything on this screen point: being ready early costs a few minutes
 * standing about, and being ready late costs the attempt.
 */
export function positionFor(progress: MeetProgress): FlightPosition {
  if (progress.place === 'own-flight-running') {
    return {
      kind: 'own-flight-running',
      currentRound: countOrNull(parseCount(progress.currentRound, 'rounds', ROUND_BOUNDS)) ?? 1,
      currentPosition:
        countOrNull(parseCount(progress.currentPosition, 'lifters', POSITION_BOUNDS)) ?? 0,
    };
  }
  return {
    kind: 'earlier-flight-running',
    attemptsLeftInTheRunningFlight:
      countOrNull(
        parseCount(progress.attemptsLeftInTheRunningFlight, 'attempts', ATTEMPTS_BOUNDS),
      ) ?? 0,
    wholeFlightsBetween:
      countOrNull(parseCount(progress.wholeFlightsBetween, 'flights', FLIGHT_BOUNDS)) ?? 0,
  };
}

/** What the caller knows and the answers do not: which lift, and off what weight. */
export interface WarmupSubject {
  readonly lift: PlatformLift;
  /** The selected opener, in whatever unit it was declared in. */
  readonly opener: Weight;
  /** Attempts each lifter takes on this lift, from the rule profile. */
  readonly attemptsPerLift: number;
}

/**
 * §20.1's estimate for one lifter, built from the answers.
 *
 * Exported separately from {@link buildMeetWarmup} because a screen shows the
 * estimate before it shows a ramp -- "Estimated platform time: 18-24 minutes" is
 * §20.1's own example and it is useful with no opener typed at all -- and
 * because the warm-up refuses where the opener will not read while the estimate
 * never refuses at all.
 */
export function estimateFor(state: MeetWarmupState, attemptsPerLift: number): PlatformEstimate {
  const progress = state.progress;
  return platformEstimate({
    position: positionFor(progress),
    // One is the honest floor rather than a convenient one: a flight of nobody
    // has no lifting order to be in, and `attemptsBeforeTarget` multiplies by
    // this figure, so a zero would report every later round as happening now.
    flightSize: countOrNull(parseCount(progress.flightSize, 'lifters', FLIGHT_BOUNDS)) ?? 1,
    attemptsPerLift,
    targetRound: countOrNull(parseCount(progress.targetRound, 'rounds', ROUND_BOUNDS)) ?? 1,
    targetPosition:
      countOrNull(parseCount(progress.targetPosition, 'lifters', POSITION_BOUNDS)) ?? 1,
    pace: paceFor(progress),
    plannedBreakSeconds:
      (countOrNull(minutes(progress.breakMinutes, 'minutes')) ?? 0) * SECONDS_PER_MINUTE,
    delaySeconds:
      (countOrNull(minutes(progress.delayMinutes, 'minutes')) ?? 0) * SECONDS_PER_MINUTE,
  });
}

/**
 * The preparations with a time on them, as the engine wants them.
 *
 * A row with nothing typed is absent rather than zero-length. A zero-second item
 * would be scheduled, drawn on the timeline and read as "put your wraps on now",
 * which is the tool inventing a step out of a field nobody filled in.
 *
 * **Filtered by the lift and not only by the format**, which is the whole reason
 * this takes both. The rows on the screen are the meet's (see
 * {@link prepKindsFor}), so a full-power lifter has a bench shirt on record while
 * looking at their squat ramp -- and charging ten minutes of shirt to the squat
 * would move the first warm-up set a quarter of an hour earlier for gear that
 * goes on two lifts later. The lifter would be standing at the rack while an
 * earlier flight was still squatting, which is exactly the failure §20.1's
 * timeline exists to prevent, arriving from the tool rather than from the meet.
 */
export function prepFor(
  preferences: WarmupPreferences,
  format: MeetFormat,
  lift: PlatformLift,
): readonly EquipmentPrep[] {
  const items: EquipmentPrep[] = [];
  for (const kind of prepKindsFor(format).filter((kind) => prepAppliesTo(kind, lift))) {
    const answer = preferences.prep[kind];
    const reading = minutes(answer.minutes, 'minutes');
    if (!reading.ok || reading.value === 0) continue;
    items.push({ id: kind, seconds: reading.value * SECONDS_PER_MINUTE, when: answer.when });
  }
  return items;
}

/**
 * The per-set answers, read and dropped where they will not read.
 *
 * Dropped rather than reported for `warmup-adjust.ts`'s reason, restated one
 * layer up: a set answer is written against the ramp on screen, the ramp is
 * rebuilt whenever anything above it moves, and an answer left over from a
 * longer ramp names a row the lifter cannot see. The parse is the same one the
 * field under it uses, so a half-typed figure shows its own sentence there and
 * changes nothing here -- the ramp does not flicker while somebody types.
 */
function weightAnswers(
  answers: readonly SetAnswer[],
  room: Equipment,
): readonly WarmupAdjustment[] {
  const adjustments: WarmupAdjustment[] = [];
  for (const answer of answers) {
    const reading = parseWeight(answer.text, room.plateUnit);
    if (reading.ok) adjustments.push({ index: answer.index, total: reading.value });
  }
  return adjustments;
}

function repAnswers(answers: readonly SetAnswer[]): readonly WarmupReps[] {
  const counts: WarmupReps[] = [];
  for (const answer of answers) {
    const reading = parseCount(answer.text, 'repetitions', REPS_BOUNDS);
    if (reading.ok) counts.push({ index: answer.index, reps: reading.value });
  }
  return counts;
}

/** The answer to one set's field, so a screen can show a sentence under it. */
export function setAnswerFor(answers: readonly SetAnswer[], index: number): string {
  return answers.find((answer) => answer.index === index)?.text ?? '';
}

/*
 * ---------------------------------------------------------------------------
 * Building the thing.
 * ---------------------------------------------------------------------------
 */

/**
 * A schedule and the estimate it was built backward from, or why there is none.
 *
 * The estimate is on both branches. §20.1's range is the figure a handler acts
 * on and it is available whether or not an opener has been typed, so a refusal
 * that took it off the screen would remove the useful half of the answer to
 * report the missing half.
 */
export type MeetWarmupResultView =
  | {
      readonly ok: true;
      readonly estimate: PlatformEstimate;
      readonly timeline: WarmupTimeline;
    }
  | {
      readonly ok: false;
      readonly estimate: PlatformEstimate;
      readonly problems: readonly WarmupProblem[];
    };

/**
 * §20's whole answer for one lifter on one lift, at one instant.
 *
 * `now` is a parameter and is the only thing in this file that is not an answer
 * somebody typed. It is stamped onto the `WarmupTimeline` rather than used to
 * compute anything: every figure the engines produce is a duration, and the
 * instant is what lets `timelineWindows` age those durations on a later paint
 * without rebuilding the ramp four times a second for every lifter on the board.
 * Read it once, at the top of a paint, and pass it down (`clock.ts`).
 */
export function buildMeetWarmup(
  state: MeetWarmupState,
  subject: WarmupSubject,
  format: MeetFormat,
  now: number,
): MeetWarmupResultView {
  const estimate = estimateFor(state, subject.attemptsPerLift);
  const preferences = state.preferences;

  const leadMinimum = countOrNull(
    parseCount(preferences.leadMinimumMinutes, 'minutes', LEAD_BOUNDS),
  );
  const leadMaximum = countOrNull(
    parseCount(preferences.leadMaximumMinutes, 'minutes', LEAD_BOUNDS),
  );
  const restSeconds = countOrNull(parseCount(preferences.restSeconds, 'seconds', SECONDS_BOUNDS));
  const setSeconds = countOrNull(parseCount(preferences.setSeconds, 'seconds', SECONDS_BOUNDS));
  const maximumSets = countOrNull(parseCount(preferences.maximumSets, 'sets', SETS_BOUNDS));
  const rackLifters = countOrNull(
    parseCount(preferences.sharedRackLifters, 'lifters', RACK_BOUNDS),
  );

  const built = meetWarmup({
    lift: subject.lift,
    opener: subject.opener,
    setup: toBarbellSetup(state.room),
    estimate,
    // Both ends or neither. One end supplied against the domain's default for
    // the other is how a minimum of fifteen silently produces a maximum of
    // twelve -- a window whose late end is before its early one -- and
    // `meetWarmup` would resolve that by widening the minimum back out, so the
    // figure the lifter typed would vanish without a word.
    lead:
      leadMinimum === null || leadMaximum === null
        ? undefined
        : {
            minimumSeconds: Math.min(leadMinimum, leadMaximum) * SECONDS_PER_MINUTE,
            maximumSeconds: Math.max(leadMinimum, leadMaximum) * SECONDS_PER_MINUTE,
          },
    restSeconds: restSeconds ?? undefined,
    setSeconds: setSeconds ?? undefined,
    equipment: prepFor(preferences, format, subject.lift),
    // One lifter on a bar is not a shared bar, and the engine already knows
    // that -- it widens no gap and raises no advisory for a rack of one. So the
    // rule is not restated here. Collapsing it to `null` at this layer as well
    // was tried, survived its own mutation, and is the §5.8 mistake in
    // miniature: a second copy of a domain rule that only looks like a
    // safeguard until the day the two copies disagree.
    sharedRack: rackLifters === null ? null : { lifters: rackLifters },
    customisation: {
      weights: weightAnswers(state.weights, state.room),
      reps: repAnswers(state.reps),
      maximumSets: maximumSets ?? undefined,
    },
    delayPreference: preferences.delayPreference,
  });

  if (!built.ok) return { ok: false, estimate, problems: built.problems };
  return { ok: true, estimate, timeline: { schedule: built.schedule, builtAt: now } };
}

/** The schedule alone, for a caller that has already refused the failure case. */
export function scheduleOf(result: MeetWarmupResultView): MeetWarmupSchedule | null {
  return result.ok ? result.timeline.schedule : null;
}

/*
 * ---------------------------------------------------------------------------
 * Transitions.
 * ---------------------------------------------------------------------------
 */

export function withRoom(state: MeetWarmupState, room: Equipment): MeetWarmupState {
  return { ...state, room };
}

export function withPreferences(
  state: MeetWarmupState,
  patch: Partial<WarmupPreferences>,
): MeetWarmupState {
  return { ...state, preferences: { ...state.preferences, ...patch } };
}

export function withProgress(
  state: MeetWarmupState,
  patch: Partial<MeetProgress>,
): MeetWarmupState {
  return { ...state, progress: { ...state.progress, ...patch } };
}

export function withPrep(
  state: MeetWarmupState,
  kind: PrepKind,
  patch: Partial<PrepAnswer>,
): MeetWarmupState {
  return withPreferences(state, {
    prep: { ...state.preferences.prep, [kind]: { ...state.preferences.prep[kind], ...patch } },
  });
}

/**
 * Writes one per-set answer, or clears it.
 *
 * Cleared rather than stored as an empty string, because an entry with nothing
 * in it is indistinguishable downstream from one that never existed and would
 * accumulate one row per set the lifter ever touched. The list is kept in index
 * order so that two states reached by different routes compare equal -- §24
 * saves this, and a list whose order depends on the order somebody typed would
 * make every save look like a change.
 */
function withSetAnswer(
  answers: readonly SetAnswer[],
  index: number,
  text: string,
): readonly SetAnswer[] {
  const kept = answers.filter((answer) => answer.index !== index);
  if (text.trim() === '') return kept;
  return [...kept, { index, text }].sort((left, right) => left.index - right.index);
}

export function withSetWeight(
  state: MeetWarmupState,
  index: number,
  text: string,
): MeetWarmupState {
  return { ...state, weights: withSetAnswer(state.weights, index, text) };
}

export function withSetReps(state: MeetWarmupState, index: number, text: string): MeetWarmupState {
  return { ...state, reps: withSetAnswer(state.reps, index, text) };
}

/**
 * Forgets every per-set answer, which is what "back to the calculated ramp" is.
 *
 * One reset for the lot, matching tool 2's fold: a revert per row is a third tap
 * target on a row that already has two, and undoing one set of five is a thing
 * nobody has wanted.
 */
export function withCalculatedSets(state: MeetWarmupState): MeetWarmupState {
  return { ...state, weights: [], reps: [] };
}

/** Whether anything on the ramp is the lifter's figure rather than the ramp's. */
export function hasSetAnswers(state: MeetWarmupState): boolean {
  return state.weights.length > 0 || state.reps.length > 0;
}

/**
 * Records one lift's answers, carrying everything but the per-set ones across.
 *
 * The room, the preferences and the platform's progress are one meet's facts and
 * fan out to all three lifts. There is one bar in the warm-up room, one flight
 * running on the platform, and one lifter's mind about how long they want between
 * sets -- so a screen that made them say it three times would be asking the same
 * question again with the answer already on record two taps away, and the second
 * and third answers would drift.
 *
 * The per-set answers do not fan out, and that asymmetry is the whole point of
 * the function. A {@link SetAnswer} is an index into the ramp on screen; the
 * squat ramp and the bench ramp are different lengths off different openers, so
 * copying "index 3 reads 112.5" onto bench writes a weight the lifter never typed
 * onto a set they have not seen -- and it would arrive already applied, on the
 * timeline, at whatever the ramp's third rung happens to be.
 *
 * The alternative of clearing the per-set answers on every lift change was
 * rejected: it loses work silently, and a lifter comparing two ramps before the
 * session starts is exactly who would lose it.
 */
export function withWarmupFor(
  states: WarmupStates,
  lift: PlatformLift,
  state: MeetWarmupState,
): WarmupStates {
  const shared = { room: state.room, preferences: state.preferences, progress: state.progress };
  return {
    squat: lift === 'squat' ? state : { ...states.squat, ...shared },
    bench: lift === 'bench' ? state : { ...states.bench, ...shared },
    deadlift: lift === 'deadlift' ? state : { ...states.deadlift, ...shared },
  };
}

/*
 * ---------------------------------------------------------------------------
 * Reading a control's value.
 *
 * The same crossing `session.ts` and `prep.ts` document: a radio's value is a
 * string out of the DOM, both of these are total, and an unrecognised value
 * lands on the answer a control can show back rather than on one it cannot.
 * ---------------------------------------------------------------------------
 */

export const DELAY_PREFERENCES: readonly DelayPreference[] = [
  'wait',
  'repeat-a-light-movement',
  'continue',
];

function oneOf<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function delayPreferenceFromValue(value: string): DelayPreference {
  return oneOf(DELAY_PREFERENCES, value, 'wait');
}

export function meetPlaceFromValue(value: string): MeetPlace {
  return oneOf(MEET_PLACES, value, 'earlier-flight-running');
}

export function prepWhenFromValue(value: string): PrepWhen {
  return oneOf(PREP_WHENS, value, 'before-the-ramp');
}
