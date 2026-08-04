// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §23's Meet Pack: everything this tool knows, on paper, before the day starts.
 *
 * The fourth pure builder in this directory, and the same kind of thing as
 * `plan.ts`, `live.ts` and `board.ts` -- state plus a rule book in, something
 * renderable out, no DOM, no clock, nothing kept between calls. The transport
 * stays in `view.ts` and the wording stays in `copy.ts`.
 *
 * WHAT IT IS FOR, WHICH DECIDES WHAT GOES ON IT
 *
 * §23 calls the printed version "an intentional battery, browser, and
 * connectivity fallback". So the reader of this sheet is somebody whose phone
 * is dead, in a warm-up room, with a minute to declare. That is not the same
 * reader as the one holding the live screen, and the difference shows up in one
 * place: the live screen can ask what just happened and then answer, whereas the
 * sheet has to answer every question it might be asked *before* it is printed.
 *
 * Hence {@link PackContingency}, which is the only part of this module that is
 * more than a projection. For each attempt after the opener it prints §13's
 * three branches under each outcome the lifter can classify without help --
 * flew, solid, slow, a grind, a technical miss, a strength miss. Six rows per
 * decision, two decisions per lift.
 *
 * THE BRANCHES ARE §13's OWN ANSWERS, NOT A SECOND IMPLEMENTATION OF §13
 *
 * The obvious way to fill that table is to read the planned percentage bands and
 * work out what a smaller jump would be. That would be a fork of `live-choices.ts`
 * living on a page nobody can diff against the screen, and the two would disagree
 * the first time §13 was touched -- silently, because both would print plausible
 * weights.
 *
 * So instead each row is produced by *actually recording that outcome* on a
 * scratch meet document seeded from the plan, and asking `liveChoicesFor` what it
 * would offer. Nothing here decides a weight. `seedLiveMeet` already builds the
 * document, `applyMeetAction` already records a result, and the answer that comes
 * back is the same object the live screen renders. When §13 changes, this table
 * changes with it and no line in this file moves.
 *
 * THE ROWS ABOVE THE ONE BEING DECIDED ARE ASSUMED GOOD, AND THAT IS PRINTED
 *
 * The table for the third attempt needs the second recorded, and the second's
 * outcome is the thing the row is varying -- but it also needs the *opener*
 * recorded, and there is no honest way to vary that too without printing
 * thirty-six rows per lift. So every attempt before the one a row is about is
 * recorded as good and solid, which is the path the plan was drawn for.
 * {@link PackContingency.assumesEarlierAttemptsMade} carries it so the sheet can
 * say so; a table that quietly assumed it would be wrong in exactly the case a
 * lifter reaches for paper, which is the day that is not going to plan.
 *
 * THE SCRATCH LIFTER IS NOT THE LIFTER
 *
 * `add-lifter` refuses an empty name, and a pack is printed the night before,
 * when the name field may well be empty -- so the hypothetical documents carry
 * {@link SCRATCH_LIFTER_NAME} and never the real one. It is never rendered. The
 * name on the sheet comes from {@link PackHeading}, which is the only place it
 * appears, and the substitution means the contingency table exists for a lifter
 * who has not typed their name yet rather than being silently empty for them.
 *
 * WHAT §23 ASKS FOR THAT THIS TOOL CANNOT PRODUCE YET
 *
 * Warm-ups, records and qualifying standards, and each is a missing *source*
 * rather than missing work here:
 *
 * - A warm-up ramp needs the warm-up room's bar and plates, and no screen in
 *   this tool asks for them. Printing a ramp against an invented plate set puts
 *   weights on paper that the room may not be able to load, which is the failure
 *   `findLoading` returns `null` to prevent. §20's warm-up screen is the fix and
 *   does not exist; the coach board records the same gap.
 * - Records and qualifying standards are ingested for other tools but nothing in
 *   the planner reads them. What the planner does hold is §8.3's targets, which
 *   are the lifter's own figures for the same questions, and those *are* printed.
 *
 * All three are declared in {@link MeetPack.omissions} rather than left out
 * silently. A sheet that is missing a section it was promised reads as a lost
 * page, and a lifter who thinks they have lost a page goes looking for it during
 * their warm-up.
 */
import {
  applyMeetAction,
  attemptsOn,
  attemptWeightFor,
  findLifter,
  liftsInFormat,
  liveChoicesFor,
  type AttemptWeight,
  type ConversionChart,
  type LiveAttempt,
  type LiveChoiceReason,
  type LiveChoiceSlot,
  type LiveLifter,
  type LiveTarget,
  type LiveTrigger,
  type MeetDocument,
  type MeetRules,
  type MeetTimeline,
  type RecordedResult,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';

import { type BoardRowConflict, type BoardView } from './board.js';
import { liveTargetsFrom, seedLiveMeet } from './live-session.js';
import { type AttemptView, type LiftPlanView, type PlannerView } from './plan.js';
import {
  checklistFor,
  checklistProgress,
  type ChecklistContext,
  type ChecklistProgress,
  type ChecklistRow,
  type LifterSetup,
  type MeetPrep,
} from './prep.js';
import type { PlannerSession } from './session.js';

/*
 * ---------------------------------------------------------------------------
 * What the caller supplies.
 * ---------------------------------------------------------------------------
 */

export interface PackRequest {
  readonly rules: MeetRules;
  /**
   * §16's published chart, or `null`.
   *
   * A pound figure on this sheet is read off the chart and never computed, the
   * same rule the plan screen and the board follow. It matters more here than
   * anywhere else: paper cannot be corrected once it is in a gym bag.
   */
  readonly chart: ConversionChart | null;
  readonly session: PlannerSession;
  readonly view: PlannerView;
  readonly prep: MeetPrep;
  readonly checklistContext: ChecklistContext;
  /** As typed on the start control. May be blank; see the module header. */
  readonly lifterName: string;
  /** From `apps/web/src/clock.ts`. Stamped on the scratch actions and never printed. */
  readonly at: number;
}

/*
 * ---------------------------------------------------------------------------
 * What it produces.
 * ---------------------------------------------------------------------------
 */

/** A section §23 asks for that this tool has no source of truth for. */
export type PackOmissionCode = 'warm-up-ramp' | 'records' | 'qualifying-standards';

/** The top of the sheet: which meet, under which rules, read on which day. */
export interface PackHeading {
  /** May be blank. Nothing here invents one. */
  readonly lifterName: string;
  readonly format: MeetFormat;
  /** The unit the lifter typed in, which is not the unit the bar is loaded in. */
  readonly unit: WeightUnit;
  /** The profile's own label, never a federation name written in source (§5.1). */
  readonly rulesLabel: string;
  /** How the rulebook names itself, its revision, and the day somebody read it. */
  readonly rulebookLabel: string;
  readonly rulebookRevision: string;
  readonly rulesVerifiedOn: string;
}

/**
 * One §22.1 answer, and whether it was given.
 *
 * `answered` rather than testing the string, because the two prose answers can
 * legitimately be long and the enum answers are never empty -- `'unstated'` is
 * an answer-shaped absence that a `!== ''` test would print as a value.
 */
export interface PackSetupFact {
  readonly field: keyof LifterSetup;
  /** The lifter's own words, or the enum's code. `''` where nothing was given. */
  readonly value: string;
  readonly answered: boolean;
}

/**
 * The outcomes a lifter can classify with no phone in their hand.
 *
 * Six of §13's fourteen triggers. What is left out is left out for one of two
 * reasons, and neither is that the branch does not matter:
 *
 * - `pain` and `pain-miss` (§13.5) do not resolve to a weight. Their answer is
 *   about stopping, and printing it as a row in a table of numbers is the one
 *   presentation that would make it look like a lighter attempt.
 * - `platform-error`, `administrative-miss` and `attempt-set-aside` (§13.8) are
 *   decided by the officials, not by the lifter, and the sheet cannot know what
 *   they ruled. `effort-not-recorded`, `miss-reason-not-recorded` and
 *   `nothing-recorded-yet` describe a lifter who did not answer a question the
 *   sheet is not asking.
 *
 * A lifter in one of those cases reads the nearest row and is no worse off than
 * with a phone that has no battery, which is the comparison this sheet is
 * against.
 */
export const PACK_TRIGGERS = [
  'flew',
  'solid',
  'slow',
  'grind',
  'command-miss',
  'strength-miss',
] as const satisfies readonly LiveTrigger[];

export type PackTrigger = (typeof PACK_TRIGGERS)[number];

/** One of §13's three offers, as it would appear on the live screen. */
export interface PackBranch {
  readonly slot: LiveChoiceSlot;
  /** `null` is Pass or Stop This Lift, which is a real answer and not a gap. */
  readonly weight: AttemptWeight | null;
  readonly reason: LiveChoiceReason;
  /** The one §13 puts forward. At most one branch in a row carries it. */
  readonly highlighted: boolean;
}

/** What to take next, given what just happened. */
export interface PackContingency {
  /** The attempt this row decides: 2 after the opener, 3 after the second. */
  readonly attemptNumber: number;
  /**
   * The reading of the attempt before, as the domain reported it back.
   *
   * Taken from `LiveChoices.trigger` rather than from the outcome that was
   * recorded to provoke it, so the sheet cannot claim a branch the domain did
   * not take. A test asserts the six requested outcomes come back as the six
   * distinct triggers; if that ever stops being true, the sheet stays honest and
   * the test says so.
   */
  readonly trigger: LiveTrigger;
  /** Secure, then Recommended, then Push, minus any that collapsed onto another. */
  readonly branches: readonly PackBranch[];
  /** See the module header. Always true for the third attempt's rows. */
  readonly assumesEarlierAttemptsMade: boolean;
}

export interface PackLift {
  readonly lift: PlatformLift;
  /** The plan, exactly as the plan screen drew it. Never re-derived here. */
  readonly attempts: readonly AttemptView[];
  readonly subtotalKilograms: number | null;
  /**
   * §13's branches for every attempt after the opener.
   *
   * Empty where the lift has no complete plan -- there is nothing to branch from
   * -- and that is the same lift the attempts list is empty for, so a sheet that
   * prints both never shows a table with no plan above it.
   */
  readonly contingencies: readonly PackContingency[];
}

/** §8.3's figures, in both units, in the order live mode reports reaching them. */
export interface PackTarget {
  readonly kind: LiveTarget['kind'];
  readonly measure: LiveTarget['measure'];
  readonly lift: PlatformLift | null;
  readonly weight: AttemptWeight;
  /** The tool's own wording, already resolved. Never logged (§2.3). */
  readonly label: string;
}

export interface MeetPack {
  readonly heading: PackHeading;
  /**
   * §22.1's rack and safety heights, whether or not they were filled in.
   *
   * A blank rack height prints as a line to write on, which is worth more on
   * paper than the row costs: a lifter who has not measured theirs yet finds out
   * at the rack, and the sheet is what they have in their hand there.
   */
  readonly platformSetup: readonly PackSetupFact[];
  /** Everything else §22.1 asks, and only where it was answered. */
  readonly otherSetup: readonly PackSetupFact[];
  readonly lifts: readonly PackLift[];
  readonly plannedTotalKilograms: number | null;
  readonly targets: readonly PackTarget[];
  readonly checklist: readonly ChecklistRow[];
  readonly checklistProgress: ChecklistProgress;
  /** §22's reminders, in the lifter's own words. Empty is the common case. */
  readonly notes: string;
  readonly omissions: readonly PackOmissionCode[];
}

/**
 * A pack with nothing in it.
 *
 * Exported for the lit-html hazard this directory keeps rediscovering: a
 * property binding *assigns* the bound value over the child's class-field
 * default, so binding a nullable pack into an element that declares a non-null
 * one puts the null on the property and the first render throws. Nothing
 * type-checks a lit-html binding. Bind `.pack=${pack ?? EMPTY_PACK}`.
 */
export const EMPTY_PACK: MeetPack = {
  heading: {
    lifterName: '',
    format: 'full-power',
    unit: 'kg',
    rulesLabel: '',
    rulebookLabel: '',
    rulebookRevision: '',
    rulesVerifiedOn: '',
  },
  platformSetup: [],
  otherSetup: [],
  lifts: [],
  plannedTotalKilograms: null,
  targets: [],
  checklist: [],
  checklistProgress: { total: 0, done: 0, remaining: 0 },
  notes: '',
  omissions: [],
};

/*
 * ---------------------------------------------------------------------------
 * §22.1, split by what a blank line is worth.
 * ---------------------------------------------------------------------------
 */

/**
 * The answers that print blank, because a blank one is a line to write on.
 *
 * Rack and safety heights only, which is what §23.1 lists by name. Everything
 * else on §22.1 is either a fact the venue tells the lifter on the day (the lot,
 * the flight, the platform) or a preference that has no meaning unstated -- and a
 * sheet with sixteen empty rows on it is a sheet nobody reads the filled ones on.
 */
const PLATFORM_SETUP_FIELDS: readonly (keyof LifterSetup)[] = [
  'squatRackHeight',
  'squatSafetyHeight',
  'monoliftSetting',
  'squatStart',
  'benchRackHeight',
  'benchSafetyHeight',
  'footBlocks',
  'handoff',
];

/** The rest of §22.1, in the order the form asks it. */
const OTHER_SETUP_FIELDS: readonly (keyof LifterSetup)[] = [
  'deadliftNotes',
  'commands',
  'flight',
  'lot',
  'platform',
  'session',
  'weighInTime',
  'liftingStartTime',
];

/**
 * Whether an answer was given, across the three shapes §22.1's answers take.
 *
 * The two enum fields say `'unstated'` and the fourteen others say `''`, so one
 * test cannot cover both -- and the failure of a `!== ''` test is not an empty
 * row but a printed one reading "unstated", which looks like a setting the
 * lifter chose.
 */
function setupAnswered(value: string): boolean {
  return value !== '' && value !== 'unstated';
}

function setupFactsFor(
  setup: LifterSetup,
  fields: readonly (keyof LifterSetup)[],
  keepBlank: boolean,
): readonly PackSetupFact[] {
  const facts: PackSetupFact[] = [];
  for (const field of fields) {
    const value = setup[field];
    const answered = setupAnswered(value);
    if (!answered && !keepBlank) continue;
    facts.push({ field, value: answered ? value : '', answered });
  }
  return facts;
}

/*
 * ---------------------------------------------------------------------------
 * §13's branches, from §13.
 * ---------------------------------------------------------------------------
 */

/**
 * The name on the scratch lifter in every hypothetical document.
 *
 * Never rendered, and deliberately not the lifter's own name: `add-lifter`
 * refuses an empty one, so something has to be supplied, and the real name would
 * then sit in a value that has no reason to hold it (§2.3). See the module
 * header.
 */
const SCRATCH_LIFTER_NAME = 'Lifter';

/**
 * The result recorded to provoke each branch.
 *
 * A table rather than a switch so that the six rows of the printed contingency
 * table are visibly the six entries here -- and so that adding a trigger to
 * {@link PACK_TRIGGERS} without saying how to provoke it is a compile error
 * rather than a row that quietly never appears.
 */
const TRIGGER_RESULTS: Readonly<Record<PackTrigger, RecordedResult>> = {
  flew: { outcome: 'good', effort: 'flew' },
  solid: { outcome: 'good', effort: 'solid' },
  slow: { outcome: 'good', effort: 'slow' },
  grind: { outcome: 'good', effort: 'grind' },
  'command-miss': { outcome: 'no-lift', reason: 'command' },
  'strength-miss': { outcome: 'no-lift', reason: 'strength' },
};

/** What the attempts before the one being varied are assumed to have been. */
const EARLIER_ATTEMPT_RESULT: RecordedResult = { outcome: 'good', effort: 'solid' };

/**
 * The competition attempts on one lift, in attempt order.
 *
 * Filtered to `competition` because a record attempt is appended past the last
 * one and an extra shares a number with the attempt it replaces (§13.8) --
 * neither is a step in the sequence this table walks, and a scratch document
 * built from a plan has neither, so the filter is a statement about what the
 * indices mean rather than a defence against a state that occurs.
 */
function competitionAttemptsOn(lifter: LiveLifter, lift: PlatformLift): readonly LiveAttempt[] {
  return attemptsOn(lifter, lift).filter((attempt) => attempt.kind === 'competition');
}

/**
 * One hypothetical: attempts before `attemptNumber` made, that one as given.
 *
 * Returns `null` when the document cannot be walked that far, which is a plan
 * with fewer attempts on the board than the table wants rather than a failure --
 * `seedLiveMeet` reports a planned weight it could not place, and an attempt with
 * no weight is a state live mode handles by asking. Either way there is nothing
 * to branch from and the row is dropped.
 */
function hypothetical(
  rules: MeetRules,
  seeded: MeetTimeline,
  lifterId: string,
  lift: PlatformLift,
  attemptNumber: number,
  result: RecordedResult,
  at: number,
): MeetDocument | null {
  let timeline = seeded;
  for (let number = 1; number <= attemptNumber; number += 1) {
    const lifter = findLifter(timeline.present, lifterId);
    if (lifter === null) return null;
    // Read back from the *current* document each time round rather than from
    // one list taken before the loop: `applyMeetAction` returns a new document
    // and every attempt in it is a new object, so an id captured up front stays
    // valid but a captured attempt does not.
    const attempt = competitionAttemptsOn(lifter, lift).at(number - 1);
    if (attempt === undefined) return null;
    if (attempt.kilograms === null) return null;
    const applied = applyMeetAction(
      rules,
      timeline,
      {
        kind: 'record-result',
        attemptId: attempt.id,
        result: number === attemptNumber ? result : EARLIER_ATTEMPT_RESULT,
      },
      at,
    );
    if (!applied.ok) return null;
    timeline = applied.timeline;
  }
  return timeline.present;
}

/** Every row of one lift's table, in attempt order and then trigger order. */
function contingenciesFor(
  request: PackRequest,
  seeded: MeetTimeline,
  lifterId: string,
  plan: LiftPlanView,
  targets: readonly LiveTarget[],
): readonly PackContingency[] {
  // Nothing to branch from. A partial plan is not a partial table: the second
  // attempt's rows are computed from the opener and would print perfectly well
  // beside a lift with no third, which reads as a plan that is more finished
  // than it is.
  if (plan.attempts.length < 3) return [];

  const rows: PackContingency[] = [];
  for (const decidedAfter of [1, 2]) {
    for (const trigger of PACK_TRIGGERS) {
      const document = hypothetical(
        request.rules,
        seeded,
        lifterId,
        plan.lift,
        decidedAfter,
        TRIGGER_RESULTS[trigger],
        request.at,
      );
      if (document === null) continue;
      const lifter = findLifter(document, lifterId);
      if (lifter === null) continue;

      const choices = liveChoicesFor(request.rules, {
        document,
        lifter,
        lift: plan.lift,
        meetDayMaximumKilograms: plan.maximumKilograms,
        plan: plan.plan,
        ceilingKilograms: plan.ceilingKilograms,
        targets,
      });
      // A lift that is over offers nothing, which is what a missed opener on a
      // one-attempt plan looks like. There is no row to print for it.
      if (choices.attemptNumber === null) continue;

      rows.push({
        attemptNumber: choices.attemptNumber,
        trigger: choices.trigger,
        branches: choices.choices.map((choice) => ({
          slot: choice.slot,
          weight:
            choice.kilograms === null ? null : attemptWeightFor(choice.kilograms, request.chart),
          reason: choice.reason,
          highlighted: choice.slot === choices.highlightedSlot,
        })),
        assumesEarlierAttemptsMade: decidedAfter > 1,
      });
    }
  }
  return rows;
}

/*
 * ---------------------------------------------------------------------------
 * Building it.
 * ---------------------------------------------------------------------------
 */

/**
 * §23.1, from everything the planner holds.
 *
 * Total: a session nobody has answered anything in produces a sheet with the
 * checklist and the blank rack heights on it and no plan, which is exactly what
 * a lifter who opened the tool the night before and filled in half of it should
 * be able to print.
 */
export function buildMeetPack(request: PackRequest): MeetPack {
  const { rules, session, view, prep } = request;
  const profile = rules.profile;

  const targets = liveTargetsFrom(session);
  const seeded = seedLiveMeet({
    rules,
    session,
    view,
    lifterName: SCRATCH_LIFTER_NAME,
    at: request.at,
  });

  const lifts: PackLift[] = view.lifts.map((plan) => ({
    lift: plan.lift,
    attempts: plan.attempts,
    subtotalKilograms: plan.subtotalKilograms,
    contingencies: seeded.ok
      ? contingenciesFor(request, seeded.timeline, seeded.lifterId, plan, targets)
      : [],
  }));

  const checklist = checklistFor(prep, request.checklistContext);

  return {
    heading: {
      lifterName: request.lifterName,
      format: session.setup.format,
      unit: session.setup.unit,
      rulesLabel: profile.label,
      rulebookLabel: profile.source.label,
      rulebookRevision: profile.source.revision,
      rulesVerifiedOn: profile.source.verifiedOn,
    },
    platformSetup: setupFactsFor(prep.setup, PLATFORM_SETUP_FIELDS, true),
    otherSetup: setupFactsFor(prep.setup, OTHER_SETUP_FIELDS, false),
    lifts,
    plannedTotalKilograms: view.plannedTotalKilograms,
    targets: targets.map((target) => ({
      kind: target.kind,
      measure: target.measure,
      lift: target.lift ?? null,
      weight: attemptWeightFor(target.kilograms, request.chart),
      label: target.label,
    })),
    checklist,
    checklistProgress: checklistProgress(checklist),
    notes: prep.notes,
    omissions: ['warm-up-ramp', 'records', 'qualifying-standards'],
  };
}

/*
 * ---------------------------------------------------------------------------
 * §23.2 -- the handler's version.
 * ---------------------------------------------------------------------------
 */

/**
 * What a handler running a flight has on paper for one lifter.
 *
 * Deliberately not one {@link MeetPack} per lifter. §23.2 asks for a roster --
 * one row per lifter that a handler reads across while standing up -- and six
 * contingency rows per lift per lifter is a document nobody can find a name in.
 * The branches a handler needs at the platform are on the live screen; what
 * paper is for here is knowing who is next and what they asked for.
 */
export interface HandlerPackLifter {
  readonly lifterId: string;
  readonly name: string;
  /** §21's distinctive identifier. Never blank -- `coachBoard` guarantees it. */
  readonly identifier: string;
  readonly colour: string | null;
  /** Who is on them, as the board was told. Empty where nobody was assigned. */
  readonly handlers: readonly string[];
  /** One entry per contested lift, in platform order. */
  readonly lifts: readonly HandlerPackLift[];
  /**
   * §21.2's warnings, as codes.
   *
   * Codes rather than the board's own sentences, and typed as the union rather
   * than as `string`, so the sheet's wording is total over it: a code with no
   * label would print an empty bullet under "Clashes", which on paper reads as a
   * warning somebody tore off. The board's sentence names the other lifters and
   * this one does not -- the printed roster is a reference sheet and the names
   * are the rows either side of it, whereas the live board is read one row at a
   * time and has to carry them.
   */
  readonly conflicts: readonly BoardRowConflict['code'][];
}

export interface HandlerPackLift {
  readonly lift: PlatformLift;
  /**
   * The three declared weights, or `null` for one not yet chosen.
   *
   * Read off the meet document rather than off any plan: by the time a handler
   * prints this the weights on the board are what the expeditor has, and a
   * planned weight that was never declared is not what the lifter is taking.
   */
  readonly attempts: readonly (AttemptWeight | null)[];
}

export interface HandlerPack {
  readonly format: MeetFormat;
  readonly rulesLabel: string;
  readonly rulebookRevision: string;
  readonly lifters: readonly HandlerPackLifter[];
  /**
   * Sections §23.2 asks for that nothing in this tool holds per lifter.
   *
   * Flights, platforms and rack settings are all §22.1 answers, and §22.1 is
   * filled in by *the lifter* on their own device -- a handler's board has a
   * roster and a meet document and no way to ask twelve people for their rack
   * height. Declared rather than dropped, so the printed sheet can leave a column
   * to write them in instead of implying the tool never asked.
   */
  readonly writeIn: readonly HandlerWriteInCode[];
}

export type HandlerWriteInCode = 'flight' | 'platform' | 'rack-settings' | 'results';

/** See {@link EMPTY_PACK}: the same lit-html hazard, the same answer. */
export const EMPTY_HANDLER_PACK: HandlerPack = {
  format: 'full-power',
  rulesLabel: '',
  rulebookRevision: '',
  lifters: [],
  writeIn: [],
};

/**
 * §23.2, from the board a handler is already running the flight on.
 *
 * The document is passed alongside the board rather than read out of it because
 * the board is a *triage* projection: it carries the attempt each lifter is
 * working towards and deliberately not the other five, since a screen showing
 * fifteen weights per row is the screen §21 exists to replace. Paper has room.
 */
export function buildHandlerPack(
  document: MeetDocument,
  board: BoardView,
  chart: ConversionChart | null,
  rules: MeetRules,
): HandlerPack {
  const lifts = liftsInFormat(document.format);

  return {
    format: document.format,
    rulesLabel: rules.profile.label,
    rulebookRevision: rules.profile.source.revision,
    lifters: board.rows.map((view) => {
      const lifter = findLifter(document, view.row.lifterId);
      return {
        lifterId: view.row.lifterId,
        name: view.row.name,
        identifier: view.row.identifier,
        colour: view.row.colour,
        handlers: view.row.handlers.map((handler) => handler.name),
        lifts: lifts.map((lift) => ({
          lift,
          attempts:
            lifter === null
              ? []
              : competitionAttemptsOn(lifter, lift).map((attempt) =>
                  attempt.kilograms === null ? null : attemptWeightFor(attempt.kilograms, chart),
                ),
        })),
        conflicts: view.conflicts.map((conflict) => conflict.code),
      };
    }),
    writeIn: ['flight', 'platform', 'rack-settings', 'results'],
  };
}
