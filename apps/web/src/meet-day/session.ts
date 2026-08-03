// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What the lifter has told the planner: the one-minute setup, whichever of §7's
 * five methods they chose, and anything they added behind Improve My Plan.
 *
 * Pure, like tool 2's `session.ts`, and for the same reason -- every interesting
 * rule here is about what happens when a lifter changes their mind halfway
 * through, and none of them need a browser to state. Nothing in this file talks
 * to the domain's planner; that is `view.ts`, which turns this plus a rule book
 * into something renderable.
 *
 * A CONFIRMATION IS PINNED TO THE FIGURE IT CONFIRMED
 *
 * §7.1, §7.2 and §7.5 each require the lifter to confirm a planning maximum
 * before a plan is produced, and it is the same confirmation in three places:
 * "yes, `M` is what I will really do on the day". So the tick is stored once per
 * lift and is discarded the moment anything it was a statement *about* changes.
 *
 * Getting that wrong is silent in both directions. Too lax, and a lifter who
 * confirms 200, thinks better of it and types 230 gets a plan built on a figure
 * they never agreed to, with a tick on screen saying they did -- which is
 * precisely the "number the lifter merely hopes to achieve" §7.1 exists to
 * refuse. Too eager, and fixing a typo in a field the maximum does not depend on
 * throws away a confirmation and the plan vanishes from under a thumb. Which
 * fields count is therefore decided per method by `voidsConfirmation` below, and
 * the goal deliberately is not one of them: a goal changes the percentages, not
 * the maximum they are percentages of.
 *
 * EVERY METHOD'S FIELDS ARE HELD FOR EVERY LIFT, ALL THE TIME
 *
 * `LiftFigures` is one flat record carrying the inputs of all five methods rather
 * than a union tagged by the current one. §7's whole premise is that a lifter
 * begins "from whichever information they trust most", and the way that is
 * actually used is by trying one and then another. A union would mean a lifter
 * who types three attempts by hand, switches to Expected Max to see what it says
 * and switches back has lost the three attempts -- and would have lost them
 * silently, since the fields are simply empty again.
 *
 * THE SETUP CHOICES ARE REMEMBERED; THE LIFTER'S NUMBERS ARE NOT
 *
 * §6.3 needs "unless a previous preference has been saved" to mean something, so
 * the goal has to survive a reload, and the unit, meet format and comparison
 * group are the same kind of answer. None of the figures are stored. A bodyweight,
 * an age and a competition maximum are facts about a person rather than settings
 * on a device, §2.3 keeps that class of thing off the disk by default, and saving
 * a whole plan is its own piece of work with its own consent question (§24.1).
 */
import {
  convertWeight,
  liftsInFormat,
  roundForDisplay,
  type EvidenceAge,
  type MaximumSource,
  type MeetGoal,
  type Readiness,
  type RepsInReserve,
  type ResearchComparison,
  type WeightUnit,
} from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';
import {
  PreferenceValue,
  definePreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

/*
 * ---------------------------------------------------------------------------
 * Vocabulary.
 * ---------------------------------------------------------------------------
 */

/** §7's five ways in. */
export type PlanMethod =
  'expected-max' | 'guided-estimate' | 'known-opener' | 'manual' | 'target-total';

export const PLAN_METHODS: readonly PlanMethod[] = [
  'expected-max',
  'guided-estimate',
  'known-opener',
  'manual',
  'target-total',
];

/**
 * §8.1's equipment categories.
 *
 * Not `JumpPopulation['equipment']`, which is the two-word answer §9.3's research
 * warnings need. This is the question the lifter is actually asked, and the
 * collapse to two words happens in `researchEquipmentFor` so that it happens in
 * one place with its reasoning attached.
 */
export type EquipmentCategory = 'raw' | 'wraps' | 'single-ply' | 'multi-ply' | 'other' | 'unstated';

export const EQUIPMENT_CATEGORIES: readonly EquipmentCategory[] = [
  'raw',
  'wraps',
  'single-ply',
  'multi-ply',
  'other',
  'unstated',
];

/**
 * A yes/no question that has not necessarily been answered.
 *
 * A third state rather than a boolean, because the domain's `ConfidenceEvidence`
 * takes `boolean | null` for exactly these and grades a declined answer
 * differently from a "no". A checkbox cannot express that: unticked would arrive
 * as `false`, and the lifter who never saw the question would be recorded as
 * having said their opener has *not* been tested.
 */
export type Answer = 'yes' | 'no' | 'unstated';

export function asBoolean(answer: Answer): boolean | null {
  switch (answer) {
    case 'yes':
      return true;
    case 'no':
      return false;
    case 'unstated':
      return null;
  }
}

/**
 * §8.1's category as the research warnings see it.
 *
 * An unstated category is treated as equipped, which is the direction that
 * *lowers* the evidence label rather than raising it. The alternative reads
 * better and is worse: calling silence "raw" hands a lifter who declined to
 * answer the population-matched label §9.3 reserves for the population the
 * research actually measured, which is false precision arrived at by omission.
 * Wraps are not raw for this purpose either -- the research measured raw.
 */
export function researchEquipmentFor(category: EquipmentCategory): 'raw' | 'equipped' {
  return category === 'raw' ? 'raw' : 'equipped';
}

/**
 * Whether a method ends in the lifter agreeing to a figure.
 *
 * Three of the five do. Known Opener does not, because the opener is a weight the
 * lifter has already chosen and the implied maximum is something the tool derives
 * *from* it -- asking them to confirm a number they did not supply would be asking
 * them to underwrite the tool's arithmetic. Manual does not, because there is no
 * maximum in it at all; the lifter typed the attempts.
 */
export function methodNeedsConfirmation(method: PlanMethod): boolean {
  return method === 'expected-max' || method === 'guided-estimate' || method === 'target-total';
}

/*
 * ---------------------------------------------------------------------------
 * The state.
 * ---------------------------------------------------------------------------
 */

/** §7.2's recent set, exactly as it was typed. */
export interface GuidedSet {
  readonly weight: string;
  readonly reps: string;
  readonly repsInReserve: RepsInReserve;
  /** Depth, pause and commands as the meet will judge them. */
  readonly competitionStandard: Answer;
  /** §7.2 asks for a date; §10.1 grades it in bands, so the bands are what is asked. */
  readonly age: EvidenceAge;
  /** Whether the set was done in the equipment category the meet is under. */
  readonly sameEquipment: Answer;
}

const EMPTY_GUIDED_SET: GuidedSet = {
  weight: '',
  reps: '',
  repsInReserve: 'unknown',
  competitionStandard: 'unstated',
  age: 'unstated',
  sameEquipment: 'unstated',
};

/** Everything typed against one lift, whichever method it belongs to. */
export interface LiftFigures {
  /** §7.1. */
  readonly expectedMaximum: string;
  /** §7.2. */
  readonly guided: GuidedSet;
  /** §7.3. */
  readonly opener: string;
  /** §7.4, in order. */
  readonly attempts: readonly [string, string, string];
  /** §8.1's hard ceiling for this lift. Also §7.3's realistic ceiling; one figure. */
  readonly ceiling: string;
  /** §8.1: has this opener been performed successfully in training? */
  readonly openerTested: Answer;
  /** §8.3's personal record for this lift. */
  readonly personalRecord: string;
  /** §7's confirmation. See the note at the top about what discards it. */
  readonly confirmed: boolean;
}

const EMPTY_FIGURES: LiftFigures = {
  expectedMaximum: '',
  guided: EMPTY_GUIDED_SET,
  opener: '',
  attempts: ['', '', ''],
  ceiling: '',
  openerTested: 'unstated',
  personalRecord: '',
  confirmed: false,
};

/** §6.2's one-minute questions, plus which of §7's methods is open. */
export interface PlannerSetup {
  /** A federation rule profile identifier, or `''` before one is chosen. */
  readonly federationId: string;
  readonly format: MeetFormat;
  readonly unit: WeightUnit;
  /** §6.2. `null` until answered, because it drives §6.3's default. */
  readonly firstMeet: boolean | null;
  readonly goal: MeetGoal;
  /**
   * Whether the goal on screen is the lifter's own choice.
   *
   * §6.3's default rule is conditional on this and cannot be written without it:
   * answering "yes, first meet" has to move an untouched goal to First Meet, and
   * has to leave alone a goal the lifter picked or one restored from a previous
   * session. Without the flag the two cases are indistinguishable -- both are
   * just a goal sitting in a field -- and whichever behaviour is chosen is wrong
   * half the time.
   */
  readonly goalChosen: boolean;
  readonly method: PlanMethod;
}

/** §8's Improve My Plan disclosure: everything optional that is not per lift. */
export interface PlannerExtras {
  readonly bodyweight: string;
  readonly age: string;
  readonly priorMeets: string;
  readonly equipment: EquipmentCategory;
  readonly readiness: Readiness;
  /**
   * §8.1's weight cut or difficult recovery.
   *
   * Its own answer rather than a fourth `Readiness` value, because it is a
   * different question -- a lifter can be cutting hard and still expect a normal
   * day, and the requirements list the two separately. `plan.ts` is where the two
   * are folded together for the confidence grade (`readinessWith`), and that fold
   * is a judgement with a comment on it rather than a shape forced by this type.
   */
  readonly hardCut: Answer;
  /** §8.1's custom jump limits, in the display unit. */
  readonly minimumJump: string;
  readonly maximumJump: string;
  /** §8.2, opt-in and deliberately separate from any competition category. */
  readonly comparison: ResearchComparison;
  /**
   * §10.1's evidence question, asked directly.
   *
   * Offered as well as derived: `maximumSourceFor` can read the Guided Estimate
   * fields and say what kind of evidence they are, but under Expected Max there
   * is nothing to read, and a lifter whose figure came off a platform last month
   * should not be graded as though they declined to say.
   */
  readonly maximumSource: MaximumSource;
  readonly evidenceAge: EvidenceAge;
}

const EMPTY_EXTRAS: PlannerExtras = {
  bodyweight: '',
  age: '',
  priorMeets: '',
  equipment: 'unstated',
  readiness: 'unstated',
  hardCut: 'unstated',
  minimumJump: '',
  maximumJump: '',
  comparison: 'none',
  maximumSource: 'unstated',
  evidenceAge: 'unstated',
};

/** §8.3's totals. Per-lift records live on `LiftFigures`. */
export interface PlannerTargets {
  readonly personalRecordTotal: string;
  readonly qualifyingTotal: string;
  readonly minimumAcceptableTotal: string;
  readonly stretchTotal: string;
}

const EMPTY_TARGETS: PlannerTargets = {
  personalRecordTotal: '',
  qualifyingTotal: '',
  minimumAcceptableTotal: '',
  stretchTotal: '',
};

/** Everything the planner knows before it plans anything. */
export interface PlannerSession {
  readonly setup: PlannerSetup;
  /** §7.5's figure. One per session rather than per lift -- it is the total. */
  readonly targetTotal: string;
  readonly extras: PlannerExtras;
  readonly targets: PlannerTargets;
  /**
   * Keyed by every platform lift, not only the contested ones.
   *
   * A lifter who sets up a full-power meet, types three maximums and then
   * corrects the format to push/pull must not lose the squat figure -- they may
   * be correcting the format the wrong way round, and either way the squat is
   * still true. `liftsInFormat` selects what is on screen; nothing deletes.
   */
  readonly figures: Readonly<Record<PlatformLift, LiftFigures>>;
}

export const EMPTY_SESSION: PlannerSession = {
  setup: {
    federationId: '',
    format: 'full-power',
    unit: 'kg',
    firstMeet: null,
    // Not a guess at the lifter: it is what §6.3 asks for before the first-meet
    // question has been answered, and answering that question moves it.
    goal: 'balanced',
    goalChosen: false,
    method: 'expected-max',
  },
  targetTotal: '',
  extras: EMPTY_EXTRAS,
  targets: EMPTY_TARGETS,
  figures: {
    squat: EMPTY_FIGURES,
    bench: EMPTY_FIGURES,
    deadlift: EMPTY_FIGURES,
  },
};

/** The lifts this session's format contests, in platform order. */
export function sessionLifts(session: PlannerSession): readonly PlatformLift[] {
  return liftsInFormat(session.setup.format);
}

/*
 * ---------------------------------------------------------------------------
 * Transitions.
 * ---------------------------------------------------------------------------
 */

/** §6.3's default, which only applies while the lifter has not chosen one. */
function defaultGoalFor(firstMeet: boolean | null): MeetGoal {
  return firstMeet === true ? 'first-meet' : 'balanced';
}

function clearConfirmations(
  figures: PlannerSession['figures'],
): Readonly<Record<PlatformLift, LiftFigures>> {
  return {
    squat: { ...figures.squat, confirmed: false },
    bench: { ...figures.bench, confirmed: false },
    deadlift: { ...figures.deadlift, confirmed: false },
  };
}

/**
 * Changes one or more setup answers.
 *
 * Three rules ride along, and each of them is the reason this is a function
 * rather than a spread at the call site:
 *
 * - Naming the goal *is* choosing it, so §6.3 stops overriding it afterwards.
 * - Answering the first-meet question re-derives an unchosen goal.
 * - Changing the method discards every confirmation, because the methods produce
 *   different maximums from the same fields and a tick made under one of them
 *   says nothing about another.
 *
 * A unit change deliberately does none of this and does not touch the figures
 * either; see `convertFigures`.
 */
export function withSetup(
  session: PlannerSession,
  patch: Partial<Omit<PlannerSetup, 'goalChosen'>>,
): PlannerSession {
  const goalChosen = patch.goal === undefined ? session.setup.goalChosen : true;
  const merged = { ...session.setup, ...patch, goalChosen };
  const setup: PlannerSetup = goalChosen
    ? merged
    : { ...merged, goal: defaultGoalFor(merged.firstMeet) };

  const methodChanged = patch.method !== undefined && patch.method !== session.setup.method;
  return {
    ...session,
    setup,
    figures: methodChanged ? clearConfirmations(session.figures) : session.figures,
  };
}

/**
 * §7.5's target, and every confirmation with it.
 *
 * The whole split moves when the target does -- that is what
 * `distributeTargetTotal` is -- so every lift's approved share is stale, not just
 * one. Confirmations are cleared regardless of the current method, because the
 * lifter may be typing this before switching to it.
 */
export function withTargetTotal(session: PlannerSession, text: string): PlannerSession {
  if (text === session.targetTotal) return session;
  return { ...session, targetTotal: text, figures: clearConfirmations(session.figures) };
}

export function withExtras(session: PlannerSession, patch: Partial<PlannerExtras>): PlannerSession {
  return { ...session, extras: { ...session.extras, ...patch } };
}

export function withTargets(
  session: PlannerSession,
  patch: Partial<PlannerTargets>,
): PlannerSession {
  return { ...session, targets: { ...session.targets, ...patch } };
}

/**
 * Whether a change to these fields invalidates a confirmation under this method.
 *
 * Read as: which of the lifter's answers does the planning maximum this method
 * produces actually depend on? Anything else -- a personal record typed into
 * §8.3, a ceiling under Expected Max, an opener under Guided Estimate -- leaves
 * the maximum exactly where it was, and revoking the tick for it would make the
 * plan flicker away every time the lifter filled in one more optional box.
 */
function voidsConfirmation(method: PlanMethod, patch: Partial<LiftFigures>): boolean {
  switch (method) {
    case 'expected-max':
      return patch.expectedMaximum !== undefined;
    case 'guided-estimate':
      return patch.guided !== undefined;
    case 'target-total':
      // The split is proportional to the expectations and pinned by the
      // ceilings, so both of them move every share, not only this lift's.
      return patch.expectedMaximum !== undefined || patch.ceiling !== undefined;
    case 'known-opener':
    case 'manual':
      return false;
  }
}

/**
 * Changes one lift's figures.
 *
 * Under Target Total a change here clears *every* lift's confirmation rather than
 * this one's: a proposal is a division of one total between the lifts, so moving
 * one lift's expectation moves what the others are being asked for. Approving the
 * squat share and then raising the bench expectation would otherwise leave a tick
 * beside a squat figure that has since changed underneath it.
 */
export function withFigures(
  session: PlannerSession,
  lift: PlatformLift,
  patch: Partial<Omit<LiftFigures, 'confirmed'>>,
): PlannerSession {
  const current = session.figures[lift];
  const voided = voidsConfirmation(session.setup.method, patch);
  const updated: LiftFigures = {
    ...current,
    ...patch,
    confirmed: voided ? false : current.confirmed,
  };

  const figures =
    voided && session.setup.method === 'target-total'
      ? { ...clearConfirmations(session.figures), [lift]: updated }
      : { ...session.figures, [lift]: updated };
  return { ...session, figures };
}

/** Records, or withdraws, the lifter's agreement to one lift's planning maximum. */
export function confirmMaximum(
  session: PlannerSession,
  lift: PlatformLift,
  confirmed: boolean,
): PlannerSession {
  return {
    ...session,
    figures: { ...session.figures, [lift]: { ...session.figures[lift], confirmed } },
  };
}

/**
 * Whether every contested lift has been agreed to, where the method asks.
 *
 * The gate §7.1 and §7.5 describe, in one place, so that a screen cannot draw a
 * plan the lifter has not underwritten by forgetting to check one lift.
 */
export function allConfirmed(session: PlannerSession): boolean {
  if (!methodNeedsConfirmation(session.setup.method)) return true;
  return sessionLifts(session).every((lift) => session.figures[lift].confirmed);
}

/*
 * ---------------------------------------------------------------------------
 * Reading what was typed.
 * ---------------------------------------------------------------------------
 */

/** A parsed field, or the sentence to show under it. */
export type FieldReading =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string }
  /** Nothing typed yet. Not an error: an empty field is where every plan starts. */
  | { readonly ok: false; readonly message: null };

const EMPTY_READING: FieldReading = { ok: false, message: null };

/**
 * The heaviest figure any field here will take, in either unit.
 *
 * Tool 2's bound and tool 2's reasoning: the point past which a typo has plainly
 * happened, since a missed decimal point turns 102.5 into 1025. Deliberately not
 * the domain's `MAX_WEIGHT_INPUT`, which is a hundred thousand because a
 * converter has no business imposing a barbell-sized ceiling on somebody
 * converting a shipment. Every field on this screen is a weight on a competition
 * bar or a total of three of them, so the barbell-sized ceiling is the right one
 * -- and it comfortably clears the heaviest total anybody has made.
 */
const MAX_WEIGHT = 2000;

/**
 * Reads a typed weight, in whichever unit the setup is showing.
 *
 * Strict about what a number looks like for tool 2's reasons: `Number('')` is
 * zero and `Number(' 12 ')` is twelve, so a field a lifter cleared mid-thought
 * would otherwise parse as a plan for an empty bar, and `parseFloat` reads `1o5`
 * as one. A third copy of that wrapper rather than a shared one, matching tools 2
 * and 4 -- what differs between them is the sentences, and the sentences are the
 * part worth keeping local to the screen that shows them.
 */
export function parseWeight(text: string, unit: WeightUnit): FieldReading {
  const trimmed = text.trim();
  if (trimmed === '') return EMPTY_READING;
  if (!/^\d*\.?\d+$/.test(trimmed)) {
    return { ok: false, message: 'Enter a weight using digits, for example 102.5.' };
  }
  const value = Number(trimmed);
  if (value <= 0) {
    return { ok: false, message: 'Enter a weight above zero.' };
  }
  if (value > MAX_WEIGHT) {
    return { ok: false, message: `Enter a weight of ${String(MAX_WEIGHT)} ${unit} or less.` };
  }
  return { ok: true, value };
}

/**
 * Reads a typed count. Whole numbers only.
 *
 * `min` is an argument and defaults to one because the two counts on this screen
 * disagree about zero: a set of no repetitions is not a set, and a lifter at
 * their first meet has genuinely done none. A shared parser with the wrong floor
 * would reject the true answer to §8.1's question about prior meets.
 */
export function parseCount(
  text: string,
  what: string,
  bounds: { readonly min?: number; readonly max: number },
): FieldReading {
  const min = bounds.min ?? 1;
  const trimmed = text.trim();
  if (trimmed === '') return EMPTY_READING;
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: `Enter how many ${what} as a whole number.` };
  }
  const value = Number(trimmed);
  if (value < min) {
    return { ok: false, message: `Enter ${String(min)} ${what} or more.` };
  }
  if (value > bounds.max) {
    return { ok: false, message: `Enter ${String(bounds.max)} ${what} or fewer.` };
  }
  return { ok: true, value };
}

/** The oldest and youngest ages worth planning a platform appearance around. */
export const AGE_BOUNDS = { min: 5, max: 100 } as const;
/** Well past anybody's career, and short of a figure that reads as a typo. */
export const PRIOR_MEETS_MAX = 300;
/** §7.2's set. Beyond this the equations are not estimating anything (tool 3). */
export const GUIDED_REPS_MAX = 20;

/**
 * What kind of evidence the confirmed maximum rests on.
 *
 * Under Guided Estimate this is derived rather than asked, because the lifter has
 * already described the set and asking a second time invites two answers that
 * disagree. Everywhere else it is whatever they said in §8, which is `unstated`
 * unless they opened the disclosure -- and `unstated` is a real answer that
 * `assessDataConfidence` grades on its own terms rather than a missing one.
 *
 * A set that was not to competition standard is not competition-standard
 * evidence however few repetitions it had, which is the one case where reading
 * the reps alone gets the grade wrong in the generous direction.
 */
export function maximumSourceFor(session: PlannerSession, lift: PlatformLift): MaximumSource {
  if (session.setup.method !== 'guided-estimate') return session.extras.maximumSource;

  const guided = session.figures[lift].guided;
  const reps = parseCount(guided.reps, 'repetitions', { max: GUIDED_REPS_MAX });
  if (!reps.ok) return 'unstated';
  if (reps.value === 1) {
    return guided.competitionStandard === 'yes' ? 'competition-standard-single' : 'lifetime-best';
  }
  return reps.value <= 5 ? 'low-repetition-estimate' : 'high-repetition-estimate';
}

/**
 * How old the evidence is, from wherever the lifter happened to say it.
 *
 * Guided Estimate asks per set, §8 asks once for everything, and a lifter may
 * have answered either. The per-set answer wins where it exists because it is the
 * more specific claim; `unstated` there is not an answer, so it falls through
 * rather than overriding one already given.
 */
export function evidenceAgeFor(session: PlannerSession, lift: PlatformLift): EvidenceAge {
  if (session.setup.method === 'guided-estimate') {
    const age = session.figures[lift].guided.age;
    if (age !== 'unstated') return age;
  }
  return session.extras.evidenceAge;
}

/*
 * ---------------------------------------------------------------------------
 * Changing unit.
 * ---------------------------------------------------------------------------
 */

/**
 * Every typed figure reinterpreted as the same weight in another unit.
 *
 * Exported separately from `withSetup` rather than folded into it, because "I
 * switched to pounds" reads two ways -- *convert my 200 kg* and *I meant 200 lb*
 * -- and the two are a hundred kilograms apart on a squat. Tool 2 learned this
 * the same way and answers it the same way: the session offers both moves and the
 * element asks, but only when there is something typed to reinterpret. Asking on
 * an empty screen is a dialogue over a form nobody has filled in.
 *
 * Rounded through `roundForDisplay` because these are fields a lifter reads and
 * edits, and 200 kg arriving as 440.92452436975694 lb is not a weight anybody
 * typed. The cost is that flicking back and forth drifts; the alternative is a
 * field nobody can read, and the plan itself is computed from the parsed figure
 * rather than from these strings.
 *
 * A field holding something unparseable is carried across untouched. It is what
 * the lifter typed, they are mid-thought in it, and replacing `1o` with nothing
 * would delete a keystroke they are about to finish.
 */
export function convertFigures(
  session: PlannerSession,
  from: WeightUnit,
  to: WeightUnit,
): PlannerSession {
  if (from === to) return session;

  const convert = (text: string): string => {
    const reading = parseWeight(text, from);
    if (!reading.ok) return text;
    return String(roundForDisplay(convertWeight({ amount: reading.value, unit: from }, to).amount));
  };
  const convertFigure = (figures: LiftFigures): LiftFigures => ({
    ...figures,
    expectedMaximum: convert(figures.expectedMaximum),
    guided: { ...figures.guided, weight: convert(figures.guided.weight) },
    opener: convert(figures.opener),
    attempts: [
      convert(figures.attempts[0]),
      convert(figures.attempts[1]),
      convert(figures.attempts[2]),
    ],
    ceiling: convert(figures.ceiling),
    personalRecord: convert(figures.personalRecord),
  });

  return {
    ...session,
    targetTotal: convert(session.targetTotal),
    extras: {
      ...session.extras,
      // Not the bodyweight: it is a weight in the unit the federation weighs in,
      // and it is never put on a bar. Not the age or the meet count either.
      minimumJump: convert(session.extras.minimumJump),
      maximumJump: convert(session.extras.maximumJump),
    },
    targets: {
      personalRecordTotal: convert(session.targets.personalRecordTotal),
      qualifyingTotal: convert(session.targets.qualifyingTotal),
      minimumAcceptableTotal: convert(session.targets.minimumAcceptableTotal),
      stretchTotal: convert(session.targets.stretchTotal),
    },
    figures: {
      squat: convertFigure(session.figures.squat),
      bench: convertFigure(session.figures.bench),
      deadlift: convertFigure(session.figures.deadlift),
    },
  };
}

/** Whether there is any typed weight for a unit change to reinterpret. */
export function hasTypedWeights(session: PlannerSession): boolean {
  if (session.targetTotal.trim() !== '') return true;
  return (['squat', 'bench', 'deadlift'] as const).some((lift) => {
    const figures = session.figures[lift];
    return (
      figures.expectedMaximum.trim() !== '' ||
      figures.guided.weight.trim() !== '' ||
      figures.opener.trim() !== '' ||
      figures.ceiling.trim() !== '' ||
      figures.attempts.some((attempt) => attempt.trim() !== '')
    );
  });
}

/*
 * ---------------------------------------------------------------------------
 * Remembered settings.
 * ---------------------------------------------------------------------------
 */

export const MEET_DAY_PREFERENCES = {
  format: definePreference<MeetFormat>({
    name: 'meet-day.format',
    value: PreferenceValue.choice(['full-power', 'push-pull', 'bench-only', 'deadlift-only']),
    fallback: 'full-power',
  }),
  unit: definePreference<WeightUnit>({
    name: 'meet-day.unit',
    // Kilograms, unlike tool 2's pound default. This screen exists because there
    // is a meet: attempt cards are written in kilograms under every federation
    // this planner has a rule profile for, and a lifter reading pounds here would
    // be reading a figure they then have to convert before declaring it.
    value: PreferenceValue.choice(['kg', 'lb']),
    fallback: 'kg',
  }),
  goal: definePreference<MeetGoal>({
    name: 'meet-day.goal',
    value: PreferenceValue.choice([
      'first-meet',
      'conservative',
      'balanced',
      'personal-record',
      'qualification',
      'place-or-win',
      'record-attempt',
      'custom',
    ]),
    fallback: 'balanced',
  }),
  goalChosen: definePreference<boolean>({
    name: 'meet-day.goal-chosen',
    // Stored beside the goal because §6.3's rule is about the goal *and* about
    // whether it was chosen, and a restored goal with the flag lost would be
    // silently overwritten the moment the first-meet question was answered --
    // which is exactly the "unless a previous preference has been saved" clause
    // failing to do the one thing it says.
    value: PreferenceValue.flag(),
    fallback: false,
  }),
  comparison: definePreference<ResearchComparison>({
    name: 'meet-day.research-comparison',
    value: PreferenceValue.choice(['male', 'female', 'none']),
    fallback: 'none',
  }),
  equipment: definePreference<EquipmentCategory>({
    name: 'meet-day.equipment',
    value: PreferenceValue.choice(['raw', 'wraps', 'single-ply', 'multi-ply', 'other', 'unstated']),
    fallback: 'unstated',
  }),
};

/**
 * A session with the remembered answers in it, and nothing else.
 *
 * The figures are deliberately absent: see the note at the top. A returning
 * lifter finds their goal, unit, format, equipment category and comparison group
 * where they left them, and an empty set of fields.
 */
export function loadSession(store: PreferenceStore): PlannerSession {
  return {
    ...EMPTY_SESSION,
    setup: {
      ...EMPTY_SESSION.setup,
      format: store.read(MEET_DAY_PREFERENCES.format),
      unit: store.read(MEET_DAY_PREFERENCES.unit),
      goal: store.read(MEET_DAY_PREFERENCES.goal),
      goalChosen: store.read(MEET_DAY_PREFERENCES.goalChosen),
    },
    extras: {
      ...EMPTY_EXTRAS,
      comparison: store.read(MEET_DAY_PREFERENCES.comparison),
      equipment: store.read(MEET_DAY_PREFERENCES.equipment),
    },
  };
}

/** Writes back the answers that are settings rather than facts about a person. */
export function saveSession(store: PreferenceStore, session: PlannerSession): void {
  store.write(MEET_DAY_PREFERENCES.format, session.setup.format);
  store.write(MEET_DAY_PREFERENCES.unit, session.setup.unit);
  store.write(MEET_DAY_PREFERENCES.goal, session.setup.goal);
  store.write(MEET_DAY_PREFERENCES.goalChosen, session.setup.goalChosen);
  store.write(MEET_DAY_PREFERENCES.comparison, session.extras.comparison);
  store.write(MEET_DAY_PREFERENCES.equipment, session.extras.equipment);
}
