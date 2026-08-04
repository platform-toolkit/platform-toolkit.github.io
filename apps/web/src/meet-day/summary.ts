// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §26's completed meet summary: what the tool has to say once the last bar is down.
 *
 * The fifth pure builder in this directory, and the same kind of thing as
 * `plan.ts`, `live.ts`, `board.ts` and `pack.ts` -- state plus a rule book in,
 * something renderable out, no DOM, no clock, nothing kept between calls. The
 * transport stays in `view.ts` and the wording stays in `copy.ts`; this module
 * emits codes.
 *
 * WHAT MAKES THIS ONE DIFFERENT FROM THE OTHER FOUR
 *
 * Every other builder here is read while there is still something to decide, so a
 * figure it cannot produce can be left for the next screen. This one is read once,
 * afterwards, by somebody who is about to close the tool. Whatever is not on it is
 * not recoverable later -- the document lives on the shelf, but the reading of it
 * does not, and nobody reopens a finished meet to check whether the summary was
 * complete. So the rule here is the opposite of the live screen's: **say what is
 * missing rather than omitting it**, which is why {@link MeetSummary.omissions}
 * exists and why every figure that could not be computed comes back as a value
 * with a reason attached rather than as an absent field.
 *
 * §26 ASKS FOR TWO THINGS THIS TOOL HAS NO SOURCE FOR, AND THEY ARE THE SAME TWO
 *
 * Personal records and "qualification or classification achieved". Both need a
 * published corpus that the planner does not read -- the same gap `pack.ts` records
 * against §23, from the same cause. What the planner *does* hold is §8.3's targets,
 * which are the lifter's own figures for those questions, and those are reported in
 * {@link MeetSummary.targets}. A target reached is not a qualification achieved and
 * this module must never let the two read as the same thing, so they are separate
 * fields and the missing one is named in `omissions`.
 *
 * RECOMMENDATION VERSUS ACTUAL CHOICE IS RECOVERED, NOT RE-DERIVED
 *
 * §26 asks what the tool suggested against what the lifter did. The tempting
 * implementation is to ask `liveChoicesFor` now, from the finished document -- and
 * it would answer confidently and wrongly, because the choices offered depend on
 * what had happened *at that moment*, and by the end everything has happened.
 *
 * So the comparison is recovered from `MeetTimeline.past`, which holds the document
 * as it stood before each action. The step that set a weight is found, the document
 * from *before* it is handed to `liveChoicesFor`, and what comes back is literally
 * what the tool put on screen at the time. Nothing here re-implements §13.
 *
 * **`UNDO_HISTORY_LIMIT` truncates that history**, so an early attempt at a long
 * meet genuinely has no recoverable recommendation. That case returns
 * `'history-truncated'` rather than nothing: a comparison that is silently absent
 * for the first half of the meet reads as a tool that made no suggestions, which is
 * the opposite of what happened. The same limit bounds
 * {@link MeetSummary.timing}, and for the same reason it is reported the same way.
 *
 * LESSONS ARE OBSERVATIONS WITH A STATED DERIVATION, NOT ADVICE
 *
 * §26's last line asks for "lessons for the next meet", which is the one item on
 * the list that is not a fact about the meet. Every {@link SummaryLessonCode} here
 * is therefore a statement about what the record shows, each with its rule written
 * beside it, and each carrying the evidence it was drawn from so a screen can print
 * the working. None of them tells the lifter what to do next: this module has one
 * meet, and §9.4 is explicit that one meet is not a trend. The route from here to
 * an actual recommendation runs through `meet-history.ts`, which needs several
 * meets before it will say anything, and {@link MeetSummary.historyEntry} is what
 * this meet contributes to it.
 */
import {
  attemptWeightFor,
  attemptsOn,
  findLifter,
  liftsInFormat,
  liveChoicesFor,
  meetTotals,
  type AttemptEffort,
  type AttemptKind,
  type AttemptLights,
  type AttemptWeight,
  type ConversionChart,
  type HistoricAttempt,
  type HistoricLift,
  type HistoricMeet,
  type HistoryEquipment,
  type LiveAttempt,
  type LiveChoiceReason,
  type LiveChoiceSlot,
  type LiveLifter,
  type LiveTarget,
  type MeetDocument,
  type MeetRules,
  type MeetTimeline,
  type MissReason,
  type RunningTotal,
  type TargetProgress,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';

import type { PlannerView } from './plan.js';

/*
 * ---------------------------------------------------------------------------
 * What the caller supplies.
 * ---------------------------------------------------------------------------
 */

export interface SummaryRequest {
  readonly rules: MeetRules;
  /** §16's published chart, or `null`. A pound figure is read off it, never computed. */
  readonly chart: ConversionChart | null;
  /** The finished meet, history and all. The history is what makes §26 answerable. */
  readonly timeline: MeetTimeline;
  /** Which lifter the summary is about. */
  readonly lifterId: string;
  /** The plan the lifter arrived with, for §26's planned-versus-selected line. */
  readonly view: PlannerView;
  /** §8.3's targets, in the order the lifter set them. */
  readonly targets: readonly LiveTarget[];
  /**
   * Which of §9.4's histories this meet belongs to.
   *
   * Supplied rather than inferred: nothing in the meet document records whether
   * the lifter wore wraps, and guessing would file an equipped total under raw --
   * the one mixture §9.4 names. `'unstated'` is the honest default and keeps the
   * meet out of every scoped comparison until somebody says.
   */
  readonly equipment: HistoryEquipment;
}

/*
 * ---------------------------------------------------------------------------
 * What it produces.
 * ---------------------------------------------------------------------------
 */

/** A section §26 asks for that this tool has no source of truth for. */
export type SummaryOmissionCode = 'personal-records' | 'qualifying-standards';

/** Why a figure that §26 asks for could not be recovered. */
export type SummaryGapCode =
  /** The step that set this weight fell off the end of the undo history. */
  | 'history-truncated'
  /** The weight was never set through the live screen, so no choice was ever offered. */
  | 'no-choice-was-offered';

/** How an attempt ended, from the summary's point of view. */
export type SummaryOutcome =
  | 'good'
  | 'no-lift'
  | 'passed'
  | 'extra-attempt-granted'
  /** The meet ended before it was taken. Not the same as a pass, which is a decision. */
  | 'not-taken';

/** What the tool put on screen for this attempt, recovered from the history. */
export interface SummaryRecommendation {
  /**
   * Which card the tool pointed at: §13's Secure, Recommended or Push.
   *
   * Carried because the same weight reads differently under each heading, and a
   * screen saying "the tool suggested 183 kg" without it cannot distinguish the
   * cautious answer after a grind from the confident one after a lift that flew.
   */
  readonly slot: LiveChoiceSlot;
  /** The highlighted card's weight, or `null` where the tool pointed at a pass. */
  readonly kilograms: number | null;
  readonly reason: LiveChoiceReason;
  /** Whether the weight the lifter declared is the one that was pointed at. */
  readonly followed: boolean;
}

export interface SummaryAttempt {
  readonly attemptNumber: number;
  readonly kind: AttemptKind;
  /** `null` where no weight was ever set. */
  readonly weight: AttemptWeight | null;
  readonly outcome: SummaryOutcome;
  readonly effort: AttemptEffort | null;
  readonly rpe: number | null;
  readonly missReason: MissReason | null;
  /** §26: white and red lights, where the lifter entered them. */
  readonly lights: AttemptLights | null;
  /** §12.1's free text. Never logged, never sent anywhere (see `LiveAttempt.note`). */
  readonly note: string | null;
  /** §26's jump size: up from the previous attempt taken. `null` on the first. */
  readonly jumpKilograms: number | null;
  /** §26's planned weight, from the plan the lifter arrived with. */
  readonly plannedKilograms: number | null;
  /** Declared minus planned. `null` where either is missing. */
  readonly againstPlanKilograms: number | null;
  /** §26's recommendation-versus-choice, or `null` with `recommendationGap` set. */
  readonly recommendation: SummaryRecommendation | null;
  readonly recommendationGap: SummaryGapCode | null;
}

export interface SummaryLift {
  readonly lift: PlatformLift;
  /** §26's best squat, bench and deadlift. `null` where nothing was made. */
  readonly best: AttemptWeight | null;
  readonly attempts: readonly SummaryAttempt[];
  /** Competition attempts that were contested, and how many went up. */
  readonly taken: number;
  readonly made: number;
}

/** §26's timing notes: how long the lifter had between one result and the next. */
export interface SummaryInterval {
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  /** Seconds from the preceding recorded result. `null` for the first one recorded. */
  readonly sincePreviousSeconds: number | null;
}

/**
 * What the record shows, in a code an interface can route on.
 *
 * Each is a statement about this meet and nothing beyond it. The derivations are
 * written on {@link lessonsFrom}, where they can be read next to the code that
 * applies them rather than restated here and drifting from it.
 */
export type SummaryLessonCode =
  | 'bombed-out'
  | 'opener-was-missed'
  | 'every-third-was-missed'
  | 'nothing-was-hard'
  | 'misses-were-technical'
  | 'misses-were-strength'
  | 'went-above-the-plan'
  | 'stayed-below-the-plan';

export interface SummaryLesson {
  readonly code: SummaryLessonCode;
  /** The lifts the observation was drawn from, so a screen can print the working. */
  readonly lifts: readonly PlatformLift[];
  /** How many attempts stand behind it. Never presented as a trend; see the header. */
  readonly attempts: number;
}

/** One note the lifter wrote, with enough context to say which attempt it was on. */
export interface SummaryNote {
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  readonly note: string;
}

export interface MeetSummary {
  readonly lifterName: string;
  readonly format: MeetFormat;
  /** §26's successful total, and whether it is one. A bomb-out is not. */
  readonly total: RunningTotal;
  readonly lifts: readonly SummaryLift[];
  /** §26's white and red lights, counted across every attempt that carries them. */
  readonly whiteLights: number;
  readonly redLights: number;
  /** How many resolved attempts had no lights entered, so a count is not read as complete. */
  readonly attemptsWithoutLights: number;
  /**
   * §8.3's targets and where the meet left them, in the order they were supplied.
   *
   * `TargetProgress` carries its own `target`, so this is the domain's answer
   * unwrapped rather than re-paired here -- a second pairing would be a second
   * chance to line the wrong progress up against the wrong target.
   */
  readonly targets: readonly TargetProgress[];
  readonly intervals: readonly SummaryInterval[];
  /** Whether the undo history ran out before the meet's first action. */
  readonly historyTruncated: boolean;
  readonly notes: readonly SummaryNote[];
  readonly lessons: readonly SummaryLesson[];
  readonly omissions: readonly SummaryOmissionCode[];
  /** What this meet contributes to §9.4. See the module header. */
  readonly historyEntry: HistoricMeet;
}

/**
 * The summary of a meet nobody has lifted in.
 *
 * Exported for the same reason as `EMPTY_VIEW`, `EMPTY_LIVE_VIEW` and `EMPTY_PACK`:
 * nothing type-checks a lit-html property binding, so an element defaulting this to
 * `null` puts an unreachable branch in every template that reads it.
 */
export const EMPTY_SUMMARY: MeetSummary = {
  lifterName: '',
  format: 'full-power',
  total: { kilograms: 0, isTotal: false, liftsOutstanding: [] },
  lifts: [],
  whiteLights: 0,
  redLights: 0,
  attemptsWithoutLights: 0,
  targets: [],
  intervals: [],
  historyTruncated: false,
  notes: [],
  lessons: [],
  omissions: ['personal-records', 'qualifying-standards'],
  historyEntry: { meetId: '', equipment: 'unstated', lifts: [] },
};

/*
 * ---------------------------------------------------------------------------
 * Reading the history back.
 * ---------------------------------------------------------------------------
 */

/**
 * The document as it stood before the weight on this attempt was last set.
 *
 * Searched from the end, so a weight that was changed after being submitted is
 * compared against the choices offered for the change rather than for the original
 * -- the change is what the lifter actually declared, and §26's question is about
 * what they chose.
 *
 * `null` means the step is not in the history at all, which after
 * `UNDO_HISTORY_LIMIT` steps is the ordinary case rather than an error.
 */
function documentBeforeWeightWasSet(
  timeline: MeetTimeline,
  attemptId: string,
): MeetDocument | null {
  for (let step = timeline.past.length - 1; step >= 0; step -= 1) {
    const entry = timeline.past[step];
    if (entry === undefined) continue;
    const { action } = entry;
    if (action.kind !== 'set-attempt-weight') continue;
    if (action.attemptId !== attemptId) continue;
    return entry.document;
  }
  return null;
}

/**
 * Whether two declarations name the same weight.
 *
 * A tolerance rather than `===` because the two figures arrive by different routes
 * -- one off §13's arithmetic, the other off whatever the lifter declared -- and
 * `MeetRules` accepts a weight that sits on the grid to within its own slack rather
 * than exactly on it. Reporting somebody as having ignored the card they pressed,
 * because two doubles differ in the fourteenth place, is a wrong fact about their
 * meet printed on the one screen that is read after everything is settled.
 *
 * Deliberately not `meet-rules.ts`'s repeat test, which answers a different question
 * -- may this weight be taken again -- and may be loosened for reasons that have
 * nothing to do with this comparison.
 *
 * The null guard is a **documented mutation survivor**: replacing it with `false`
 * changes no answer this module can produce. The right operand is the weight that
 * was declared, and `recommendationAt` only runs where `documentBeforeWeightWasSet`
 * found a `set-attempt-weight` step for the attempt -- whose `kilograms` is a
 * `number`, and which nothing in `meet-document.ts` ever undoes back to `null`. So
 * `right` is never null here, `left === right` can only be reached with a left-hand
 * pass against a right-hand number, and both spellings answer `false`. The line is
 * kept because the function is written against its signature rather than against
 * its one caller: a pass is `null` on both sides the day a summary compares two
 * recovered cards, and `false` would then say two passes are different decisions.
 */
const SAME_DECLARATION_SLACK = 1e-9;

function sameDeclaration(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < SAME_DECLARATION_SLACK;
}

/**
 * What the tool pointed at when this weight was declared, and whether it was taken.
 *
 * The **highlighted** choice, not the card sitting in the Recommended slot. Keying
 * on the slot is the obvious reading and it loses most of a real meet in silence:
 * `collapseDuplicates` in `live-choices.ts` drops a card whose weight matches an
 * earlier one and carries only the highlight onto the survivor, so wherever the
 * minimum progression is small the Recommended weight and the Secure weight are the
 * same figure and only Secure is emitted. Measured against this directory's fixture,
 * a solid opener offers exactly Secure and Push and no Recommended slot at all --
 * which filed every ordinary attempt as `'no-choice-was-offered'`, the silently
 * absent comparison this module's header says it exists to prevent.
 *
 * The highlight is also the honest answer to §26's question. §13.5: the flag is
 * which card the tool points at, and after a grind it points at the pass sitting in
 * the secure slot. A lifter who passed there did what the tool suggested, and
 * grading them against a Recommended increase they were never shown would be the
 * summary inventing a decision.
 */
function recommendationAt(
  rules: MeetRules,
  before: MeetDocument,
  lifterId: string,
  lift: PlatformLift,
  declaredKilograms: number | null,
): SummaryRecommendation | null {
  const lifter = findLifter(before, lifterId);
  if (lifter === null) return null;
  const offered = liveChoicesFor(rules, { document: before, lifter, lift });
  const pointedAt = offered.choices.find((choice) => choice.highlighted);
  if (pointedAt === undefined) return null;
  return {
    slot: pointedAt.slot,
    kilograms: pointedAt.kilograms,
    reason: pointedAt.reason,
    followed: sameDeclaration(pointedAt.kilograms, declaredKilograms),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Reading one lift.
 * ---------------------------------------------------------------------------
 */

function outcomeOf(attempt: LiveAttempt): SummaryOutcome {
  switch (attempt.status) {
    case 'good':
    case 'no-lift':
    case 'passed':
    case 'extra-attempt-granted':
      return attempt.status;
    default:
      return 'not-taken';
  }
}

/** The plan's weight for this attempt number on this lift, where there is a plan. */
function plannedKilogramsFor(
  view: PlannerView,
  lift: PlatformLift,
  attemptNumber: number,
): number | null {
  const planned = view.lifts.find((entry) => entry.lift === lift);
  if (planned === undefined) return null;
  const attempt = planned.attempts.find((entry) => entry.attemptNumber === attemptNumber);
  if (attempt === undefined) return null;
  return attempt.weight.kilograms;
}

interface LiftReading {
  readonly summary: SummaryLift;
  readonly history: HistoricLift;
  readonly notes: readonly SummaryNote[];
  readonly whiteLights: number;
  readonly redLights: number;
  readonly attemptsWithoutLights: number;
  readonly truncated: boolean;
}

function readLift(request: SummaryRequest, lifter: LiveLifter, lift: PlatformLift): LiftReading {
  const { chart, rules, timeline, view } = request;
  const attempts: SummaryAttempt[] = [];
  const historic: HistoricAttempt[] = [];
  const notes: SummaryNote[] = [];

  let best: number | null = null;
  let taken = 0;
  let made = 0;
  let whiteLights = 0;
  let redLights = 0;
  let attemptsWithoutLights = 0;
  let truncated = false;
  // The weight the previous *taken* attempt was at, which is what a jump is from.
  // A pass declares no weight, so it is not a floor -- the same rule `meet-history.ts`
  // applies, and the two would disagree about a lifter's jumps if either broke it.
  let previousTaken: number | null = null;

  for (const attempt of attemptsOn(lifter, lift)) {
    const outcome = outcomeOf(attempt);
    const kilograms = attempt.kilograms;
    const planned = plannedKilogramsFor(view, lift, attempt.attemptNumber);

    let jumpKilograms: number | null = null;
    if (kilograms !== null && previousTaken !== null && outcome !== 'passed') {
      jumpKilograms = kilograms - previousTaken;
    }

    let recommendation: SummaryRecommendation | null = null;
    let recommendationGap: SummaryGapCode | null = null;
    const before = documentBeforeWeightWasSet(timeline, attempt.id);
    if (before === null) {
      recommendationGap = kilograms === null ? 'no-choice-was-offered' : 'history-truncated';
      if (kilograms !== null) truncated = true;
    } else {
      recommendation = recommendationAt(rules, before, lifter.id, lift, kilograms);
      if (recommendation === null) recommendationGap = 'no-choice-was-offered';
    }

    attempts.push({
      attemptNumber: attempt.attemptNumber,
      kind: attempt.kind,
      weight: kilograms === null ? null : attemptWeightFor(kilograms, chart),
      outcome,
      effort: attempt.effort,
      rpe: attempt.rpe,
      missReason: attempt.missReason,
      lights: attempt.lights,
      note: attempt.note,
      jumpKilograms,
      plannedKilograms: planned,
      againstPlanKilograms: kilograms === null || planned === null ? null : kilograms - planned,
      recommendation,
      recommendationGap,
    });

    if (attempt.note !== null && attempt.note !== '') {
      notes.push({ lift, attemptNumber: attempt.attemptNumber, note: attempt.note });
    }

    if (attempt.lights === null) {
      if (outcome !== 'not-taken') attemptsWithoutLights += 1;
    } else {
      // `RefereeLight` has exactly two values, so the second branch is the
      // complement rather than a second test -- writing `=== 'red'` is a lint
      // error today and would silently drop a third colour if one ever arrived.
      for (const light of attempt.lights) {
        if (light === 'white') whiteLights += 1;
        else redLights += 1;
      }
    }

    if (outcome === 'good' && kilograms !== null && (best === null || kilograms > best)) {
      best = kilograms;
    }
    if (attempt.kind === 'competition' && (outcome === 'good' || outcome === 'no-lift')) {
      taken += 1;
      if (outcome === 'good') made += 1;
    }
    if (kilograms !== null && outcome !== 'passed' && outcome !== 'not-taken') {
      previousTaken = kilograms;
    }

    // The §9.4 entry holds only what calibration reads, and only the numbered
    // competition attempts: an extra granted for a platform error says nothing
    // about how this lifter jumps, and a record attempt is not part of the meet.
    if (attempt.kind === 'competition' && kilograms !== null) {
      if (outcome === 'good' || outcome === 'no-lift' || outcome === 'passed') {
        historic.push({
          attemptNumber: attempt.attemptNumber,
          kilograms,
          outcome,
          missReason: attempt.missReason,
        });
      }
    }
  }

  return {
    summary: {
      lift,
      best: best === null ? null : attemptWeightFor(best, chart),
      attempts,
      taken,
      made,
    },
    history: {
      lift,
      attempts: historic,
      plannedMaximumKilograms:
        view.lifts.find((entry) => entry.lift === lift)?.maximumKilograms ?? null,
    },
    notes,
    whiteLights,
    redLights,
    attemptsWithoutLights,
    truncated,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Timing.
 * ---------------------------------------------------------------------------
 */

/**
 * §26's timing notes, from the instants the results were recorded.
 *
 * These are not the officials' clock and must never be shown as though they were.
 * They are when *this tool* was told, which is the same caveat §14.1 puts on the
 * countdown -- a lifter who recorded three attempts on the walk back to their bag
 * produces three intervals of four seconds, and that is a true statement about the
 * tool and a false one about the meet.
 *
 * Only `record-result` steps count. `set-attempt-weight` is stamped too, but it is
 * a declaration rather than a lift, and mixing the two would put a gap between two
 * keystrokes into a list a reader takes as the rhythm of the platform.
 */
function intervalsFrom(timeline: MeetTimeline, lifterId: string): readonly SummaryInterval[] {
  const intervals: SummaryInterval[] = [];
  let previousAt: number | null = null;

  for (const step of timeline.past) {
    if (step.action.kind !== 'record-result') continue;
    const found = findAttemptIn(step.document, step.action.attemptId, lifterId);
    if (found === null) continue;
    intervals.push({
      lift: found.lift,
      attemptNumber: found.attemptNumber,
      sincePreviousSeconds: previousAt === null ? null : Math.round((step.at - previousAt) / 1000),
    });
    previousAt = step.at;
  }
  return intervals;
}

function findAttemptIn(
  document: MeetDocument,
  attemptId: string,
  lifterId: string,
): LiveAttempt | null {
  const lifter = findLifter(document, lifterId);
  if (lifter === null) return null;
  return lifter.attempts.find((attempt) => attempt.id === attemptId) ?? null;
}

/*
 * ---------------------------------------------------------------------------
 * Lessons.
 * ---------------------------------------------------------------------------
 */

/** How far past the plan counts as having gone above it, in kilograms. */
const PLAN_DEVIATION_KILOGRAMS = 2.5;

/**
 * What the record shows. Every rule is written here beside the code it produces.
 *
 * None of these is advice and none of them is a trend -- one meet cannot support
 * either (§9.4). A screen printing them has to say so; this module cannot.
 */
function lessonsFrom(lifts: readonly SummaryLift[], total: RunningTotal): readonly SummaryLesson[] {
  const lessons: SummaryLesson[] = [];
  const contested = lifts.filter((lift) => lift.taken > 0);
  if (contested.length === 0) return lessons;

  // No total: three misses on some lift, which is the outcome §11 exists to warn
  // about and the single most important thing on this screen.
  if (!total.isTotal) {
    lessons.push({ code: 'bombed-out', lifts: total.liftsOutstanding, attempts: 0 });
  }

  // §7.3: the opener is meant to be certain. One missed opener is worth naming.
  const missedOpeners = contested.filter((lift) =>
    lift.attempts.some(
      (attempt) =>
        attempt.attemptNumber === 1 &&
        attempt.kind === 'competition' &&
        attempt.outcome === 'no-lift',
    ),
  );
  if (missedOpeners.length > 0) {
    lessons.push({
      code: 'opener-was-missed',
      lifts: missedOpeners.map((lift) => lift.lift),
      attempts: missedOpeners.length,
    });
  }

  // Every third attempted, and none made. Reaching too far on the last attempt is
  // a different meet from reaching too far throughout, so this is asked of thirds
  // alone rather than of the miss count.
  const thirds = contested.flatMap((lift) =>
    lift.attempts.filter(
      (attempt) => attempt.attemptNumber === 3 && attempt.kind === 'competition',
    ),
  );
  const thirdsTaken = thirds.filter(
    (attempt) => attempt.outcome === 'good' || attempt.outcome === 'no-lift',
  );
  if (thirdsTaken.length > 1 && thirdsTaken.every((attempt) => attempt.outcome === 'no-lift')) {
    lessons.push({
      code: 'every-third-was-missed',
      lifts: contested.map((lift) => lift.lift),
      attempts: thirdsTaken.length,
    });
  }

  // Every good lift flew and nothing was missed: the plan was under the lifter.
  // Asked of the effort the lifter recorded rather than of the weights, because
  // "there was more in the tank" is a thing only they can report.
  const good = contested.flatMap((lift) =>
    lift.attempts.filter((attempt) => attempt.outcome === 'good'),
  );
  const missed = contested.flatMap((lift) =>
    lift.attempts.filter((attempt) => attempt.outcome === 'no-lift'),
  );
  if (
    missed.length === 0 &&
    good.length > 1 &&
    good.every((attempt) => attempt.effort === 'flew')
  ) {
    lessons.push({
      code: 'nothing-was-hard',
      lifts: contested.map((lift) => lift.lift),
      attempts: good.length,
    });
  }

  // Where the misses came from, when they all came from the same place. §12.3 is
  // explicit that the distinction changes the next recommendation, and a meet lost
  // to commands is a coaching problem while one lost to strength is a plan problem.
  if (missed.length > 0) {
    const strength = missed.filter((attempt) => attempt.missReason === 'strength');
    const technical = missed.filter(
      (attempt) => attempt.missReason === 'command' || attempt.missReason === 'platform-error',
    );
    if (strength.length === missed.length) {
      lessons.push({
        code: 'misses-were-strength',
        lifts: contested.filter((lift) => lift.made < lift.taken).map((lift) => lift.lift),
        attempts: missed.length,
      });
    } else if (technical.length === missed.length) {
      lessons.push({
        code: 'misses-were-technical',
        lifts: contested.filter((lift) => lift.made < lift.taken).map((lift) => lift.lift),
        attempts: missed.length,
      });
    }
  }

  // Where the day went against the plan, counted in attempts rather than judged in
  // kilograms: one attempt taken 5 kg over is a decision, and six of them is a plan
  // the lifter had already left behind by the second round.
  const deviations = contested.flatMap((lift) =>
    lift.attempts.filter((attempt) => attempt.againstPlanKilograms !== null),
  );
  const above = deviations.filter(
    (attempt) => (attempt.againstPlanKilograms ?? 0) >= PLAN_DEVIATION_KILOGRAMS,
  );
  const below = deviations.filter(
    (attempt) => (attempt.againstPlanKilograms ?? 0) <= -PLAN_DEVIATION_KILOGRAMS,
  );
  if (above.length > below.length && above.length > 1) {
    lessons.push({
      code: 'went-above-the-plan',
      lifts: contested.map((lift) => lift.lift),
      attempts: above.length,
    });
  } else if (below.length > above.length && below.length > 1) {
    lessons.push({
      code: 'stayed-below-the-plan',
      lifts: contested.map((lift) => lift.lift),
      attempts: below.length,
    });
  }

  return lessons;
}

/*
 * ---------------------------------------------------------------------------
 * Building it.
 * ---------------------------------------------------------------------------
 */

/**
 * Everything §26 asks for about a finished meet, plus what it owes §9.4.
 *
 * Returns {@link EMPTY_SUMMARY} for a lifter who is not in the document. That is a
 * wiring mistake rather than a state a lifter can reach, and the alternative -- a
 * nullable return -- would put a branch in the template for it.
 */
export function summariseMeet(request: SummaryRequest): MeetSummary {
  const document = request.timeline.present;
  const lifter = findLifter(document, request.lifterId);
  if (lifter === null) return EMPTY_SUMMARY;

  const readings = liftsInFormat(document.format).map((lift) => readLift(request, lifter, lift));
  const totals = meetTotals(request.rules, {
    document,
    lifter,
    targets: request.targets,
  });

  const lifts = readings.map((reading) => reading.summary);
  return {
    lifterName: lifter.name,
    format: document.format,
    total: totals.guaranteed,
    lifts,
    whiteLights: readings.reduce((sum, reading) => sum + reading.whiteLights, 0),
    redLights: readings.reduce((sum, reading) => sum + reading.redLights, 0),
    attemptsWithoutLights: readings.reduce(
      (sum, reading) => sum + reading.attemptsWithoutLights,
      0,
    ),
    targets: totals.targets,
    intervals: intervalsFrom(request.timeline, request.lifterId),
    historyTruncated: readings.some((reading) => reading.truncated),
    notes: readings.flatMap((reading) => reading.notes),
    lessons: lessonsFrom(lifts, totals.guaranteed),
    omissions: ['personal-records', 'qualifying-standards'],
    historyEntry: {
      meetId: `${document.rulesProfileId}:${lifter.id}`,
      equipment: request.equipment,
      lifts: readings.map((reading) => reading.history),
    },
  };
}
