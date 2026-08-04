// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The join between the plan and the platform.
 *
 * `plan.ts` turns what the lifter typed into a plan; `live.ts` turns a meet
 * document into the screen they hold at the platform. Nothing joined the two,
 * and the join is the part with the interesting mistakes in it: it has to carry
 * the planned weights into a document without re-deriving them, carry §8.3's
 * targets across without re-parsing what was typed, and start the meet in a
 * state where undo does not offer to take back the setup.
 *
 * Pure, like both its neighbours. No DOM, no clock, no storage -- `at` is passed
 * in the way every other instant in this tool is, so a test can seed a meet and
 * assert the whole timeline without a browser.
 *
 * WHY THE WEIGHTS ARE READ OFF THE VIEW AND NOT OFF THE SESSION
 *
 * Every attempt in `PlannerView` has already been rounded onto the federation's
 * grid (§9.1), clamped to §8.1's ceiling and checked for legality. Reading the
 * typed figures again here would produce a second plan from the same inputs, and
 * a second plan is free to disagree with the first -- so the lifter would see one
 * set of attempts on the plan screen and a different set the moment live mode
 * opened, with nothing on either screen explaining which one the day is being
 * run on.
 *
 * WHAT A REFUSAL MEANS WHILE SEEDING
 *
 * `set-attempt-weight` runs the same `MeetRules` the plan was drawn against, so
 * a planned weight it refuses is a defect rather than a lifter error. The
 * exception is Manual entry, where the lifter typed three weights and `plan.ts`
 * already recorded the refusals on the attempt -- those are skipped, because the
 * plan screen has already said so and pushing them in would collect the same
 * sentence twice.
 *
 * A refusal is reported and never fatal. Live mode handles an attempt with no
 * weight perfectly well -- that is what a lifter who has not chosen yet looks
 * like, and the screen asks them to choose -- whereas refusing to open live mode
 * at all strands somebody at the expeditor's table over a weight they can simply
 * type. The one thing that *is* fatal is having no lifter, because a meet
 * document with nobody in it has no attempts, no totals and nothing to show.
 */
import {
  applyMeetAction,
  attemptsOn,
  createMeetDocument,
  liftsInFormat,
  startTimeline,
  type LiveTarget,
  type MeetActionProblem,
  type MeetRules,
  type MeetTimeline,
} from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import { targetLabel } from './copy.js';
import { NO_PLANNING, type LiftPlanning, type LivePlanning } from './live.js';
import { kilogramsTyped, type PlannerView } from './plan.js';
import type { PlannerSession } from './session.js';

/*
 * ---------------------------------------------------------------------------
 * What the planner worked out, in the shape live mode wants it.
 * ---------------------------------------------------------------------------
 */

/**
 * `LiveContext.planning`, straight off the plan.
 *
 * Every field is already on `LiftPlanView` and nothing is computed here, which
 * is the point: the three figures `liveChoicesFor` wants are the three the plan
 * screen drew, so the choices at the platform are anchored to the plan the
 * lifter agreed to rather than to a rebuild of it.
 *
 * Lifts the format does not contest get `NO_PLANNING` rather than being left
 * out. `LivePlanning` is total over `PlatformLift` for the reason `session.ts`
 * keeps figures for every lift -- a format corrected mid-session must not delete
 * what was said about a lift that is briefly off screen -- and a total record
 * means no branch downstream has to decide what a missing key means.
 */
export function livePlanningFrom(view: PlannerView): LivePlanning {
  const planning: Record<PlatformLift, LiftPlanning> = {
    squat: NO_PLANNING,
    bench: NO_PLANNING,
    deadlift: NO_PLANNING,
  };
  for (const lift of view.lifts) {
    planning[lift.lift] = {
      plan: lift.plan,
      meetDayMaximumKilograms: lift.maximumKilograms,
      ceilingKilograms: lift.ceilingKilograms,
    };
  }
  return planning;
}

/*
 * ---------------------------------------------------------------------------
 * §8.3's targets.
 * ---------------------------------------------------------------------------
 */

/**
 * The targets the planner collected, resolved to kilograms.
 *
 * §8.3 lists ten. This reads the five the session has fields for -- the four
 * totals in `PlannerTargets` and one personal record per lift in `LiftFigures`
 * -- and the other five (classification, record, placing, best-lifter and the
 * competitors' figures) are not omissions here: nothing has asked for them yet,
 * and each needs a source rather than a field, which is why `LiveTarget` is an
 * input to the domain rather than something it computes.
 *
 * `kilogramsTyped` is the single reader for all five, so a lifter working in
 * pounds cannot have their targets read in one unit and their attempts in
 * another. A second parse-and-convert written here would fail silently, because
 * 200 lb is a perfectly plausible squat in kilograms.
 *
 * Per-lift records come first, then the totals. A lift target can be reached by
 * the attempt on the screen the lifter is looking at; a total cannot be reached
 * before the last attempt of the day, and `reachesText` prints the list in the
 * order it is given.
 */
export function liveTargetsFrom(session: PlannerSession): readonly LiveTarget[] {
  const targets: LiveTarget[] = [];
  const unit = session.setup.unit;

  for (const lift of liftsInFormat(session.setup.format)) {
    // Only the contested lifts. A personal record on a lift this meet does not
    // run cannot be reached today, and a target that no attempt can move reads
    // on the live screen as one the lifter is failing to reach.
    const kilograms = kilogramsTyped(session.figures[lift].personalRecord, unit);
    if (kilograms !== null) {
      targets.push({
        kind: 'personal-record',
        measure: 'lift',
        lift,
        kilograms,
        label: targetLabel('personal-record', lift),
      });
    }
  }

  const totals: readonly (readonly [string, LiveTarget['kind']])[] = [
    [session.targets.personalRecordTotal, 'personal-record'],
    [session.targets.qualifyingTotal, 'qualification'],
    [session.targets.minimumAcceptableTotal, 'minimum-acceptable'],
    [session.targets.stretchTotal, 'stretch'],
  ];
  for (const [text, kind] of totals) {
    const kilograms = kilogramsTyped(text, unit);
    if (kilograms === null) continue;
    targets.push({
      kind,
      measure: 'total',
      lift: null,
      kilograms,
      label: targetLabel(kind, null),
    });
  }

  return targets;
}

/*
 * ---------------------------------------------------------------------------
 * Starting the meet.
 * ---------------------------------------------------------------------------
 */

/** Everything `seedLiveMeet` needs, none of which it can read for itself. */
export interface LiveSeed {
  readonly rules: MeetRules;
  readonly session: PlannerSession;
  readonly view: PlannerView;
  /** §14's named failure is the right weight submitted for the wrong athlete. */
  readonly lifterName: string;
  /** From `apps/web/src/clock.ts`. Stamped on the one action that survives. */
  readonly at: number;
}

export type LiveSeedResult =
  | {
      readonly ok: true;
      readonly timeline: MeetTimeline;
      readonly lifterId: string;
      /**
       * Every planned weight that did not go into the document, and why.
       *
       * Empty is the normal case and anything in it is a defect worth logging
       * (§2.3: the codes are the part that helps and the only part safe to
       * keep). The attempts it names are simply unset, which is a state the live
       * screen already asks the lifter to resolve.
       */
      readonly unplaced: readonly MeetActionProblem[];
    }
  | { readonly ok: false; readonly problems: readonly MeetActionProblem[] };

/**
 * A meet with one lifter in it and the plan already on the board.
 *
 * The setup is applied through `applyMeetAction` like everything else -- there is
 * no second way to build a document, and a hand-built one can hold a state the
 * actions cannot produce -- and then the timeline is restarted from the result.
 *
 * WHY THE HISTORY IS DISCARDED
 *
 * Every action is undoable (§13.9), including the ten that put the plan on the
 * board. Without the restart the first thing undo offers a lifter at their first
 * attempt is "Undo choosing 180 kg" -- an action they did not take, on a screen
 * whose undo control exists for correcting a result recorded against the wrong
 * outcome. Ten presses would walk the plan back off the board one weight at a
 * time. The document is the same either way; only the past is dropped.
 */
export function seedLiveMeet(seed: LiveSeed): LiveSeedResult {
  const { rules, session, view, lifterName, at } = seed;

  const empty = startTimeline(createMeetDocument(rules, session.setup.format));
  const added = applyMeetAction(rules, empty, { kind: 'add-lifter', name: lifterName }, at);
  if (!added.ok) return { ok: false, problems: added.problems };

  const lifter = added.timeline.present.lifters.at(-1);
  if (lifter === undefined) {
    // Unreachable through `addLifter`, which appends before it commits. Kept
    // because `.at(-1)` is typed as possibly absent and the alternative is an
    // assertion, which §2.4 rules out -- and because "the action succeeded and
    // added nobody" is a sentence worth having on screen if it ever becomes true.
    return {
      ok: false,
      problems: [{ code: 'unknown-lifter', message: 'The meet was started with nobody in it.' }],
    };
  }

  let timeline = added.timeline;
  const unplaced: MeetActionProblem[] = [];
  for (const plan of view.lifts) {
    // Positional: `attemptsOn` returns the lifter's attempts on this lift in
    // attempt order, and `LiftPlanView.attempts` is three attempts in the same
    // order or none at all. Matching on `attemptNumber` instead would look
    // safer and would quietly place nothing the day the two orders diverge,
    // because a lookup that finds no attempt is indistinguishable from a plan
    // that had none.
    const attempts = attemptsOn(lifter, plan.lift);
    for (const [index, planned] of plan.attempts.entries()) {
      // Manual entry's own refusals, already reported on the plan screen.
      if (planned.refusals.length > 0) continue;
      const attempt = attempts[index];
      if (attempt === undefined) continue;
      const applied = applyMeetAction(
        rules,
        timeline,
        { kind: 'set-attempt-weight', attemptId: attempt.id, kilograms: planned.weight.kilograms },
        at,
      );
      if (applied.ok) {
        timeline = applied.timeline;
      } else {
        unplaced.push(...applied.problems);
      }
    }
  }

  return { ok: true, timeline: startTimeline(timeline.present), lifterId: lifter.id, unplaced };
}
