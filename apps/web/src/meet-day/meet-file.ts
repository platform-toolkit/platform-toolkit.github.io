// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §24.4: the boundary between a run of characters and a saved meet.
 *
 * Everything that has been through this file is a `SavedMeet` and nothing that
 * has not is. Two callers cross it -- the export and import controls, which move
 * a meet between devices, and `meet-store.ts`, which reads back what a previous
 * build of this application wrote into browser storage. Both are the same
 * problem: text of unknown provenance that will be handed to a screen a lifter
 * is about to run a meet from.
 *
 * WHY BROWSER STORAGE IS TREATED AS UNTRUSTED INPUT
 *
 * It is the same origin and nobody else wrote it, which is the argument for
 * trusting it, and it is wrong twice over. `localStorage` is editable from the
 * console and shared with every script the page ever loads; and, far more
 * likely, the thing that wrote it was *this application six versions ago*. A
 * field that has since gained a variant, a number that used to be a string, an
 * object that used to be absent: each of those restores into a screen that
 * renders `undefined` at an expeditor's table. Parsing on the way out is what
 * turns those into a refusal a person can read.
 *
 * WHY THE SCHEMA IS SPELLED OUT INSTEAD OF INFERRED
 *
 * A schema derived from the types would move whenever the types moved, which is
 * exactly what a stored format must not do -- the whole job here is to notice
 * when the two have parted company. Writing it out means adding a required field
 * to `PlannerSession` breaks this file's compilation, at which point somebody
 * has to decide what an old saved meet without that field should do. That
 * decision is the version bump in `saved-meet.ts`. `ParsesToSavedMeet` at the
 * foot of the file is what makes the break happen at build time rather than in a
 * gym.
 *
 * WHAT IS DELIBERATELY NOT CHECKED
 *
 * Nothing here asks whether the meet makes sense: whether the attempts ascend,
 * whether a weight is loadable, whether the status of the third squat is
 * possible given the second. Those are rules, they belong to
 * `packages/domain`'s document layer, and they move between releases. A file
 * that enforced them would refuse a meet recorded correctly under last year's
 * rulebook. This checks shape, bounds on free text, and that a number is a
 * number -- and then the document layer refuses actions on it as it always does.
 */
import { HANDLER_RESPONSIBILITIES } from '@platform-toolkit/domain';
import * as v from 'valibot';

import { CUSTOM_ITEM_MAX, PREP_NOTES_MAX, SETUP_LABEL_MAX, SETUP_NOTE_MAX } from './prep.js';
import {
  MEET_NAME_MAX,
  SAVED_MEET_VERSION,
  type SavedMeet,
  type SavedMeetState,
} from './saved-meet.js';

/*
 * ---------------------------------------------------------------------------
 * Pieces.
 * ---------------------------------------------------------------------------
 */

/**
 * A free-text field, capped.
 *
 * Every string a person typed goes through this. The cap is not tidiness: an
 * import is the one path by which a megabyte of text reaches a field that was
 * built for a rack height, and the place it surfaces is a phone that stops
 * responding while laying out a paragraph inside a 44-pixel row.
 */
function text(maximum: number): v.GenericSchema<string, string> {
  return v.pipe(v.string(), v.maxLength(maximum));
}

/** An identifier the application minted. Non-empty; never shown to anybody. */
const Identifier = v.pipe(v.string(), v.minLength(1), v.maxLength(120));

/** A moment, as milliseconds since the epoch. Finite, so arithmetic on it holds. */
const Instant = v.pipe(v.number(), v.finite());

/** A count that indexes or ordinals something. Whole and not negative. */
const Ordinal = v.pipe(v.number(), v.integer(), v.minValue(0));

/**
 * A weight in kilograms.
 *
 * Bounded above, unlike the published rule contract, which deliberately is not.
 * The two are different questions: a contract must never refuse a real world
 * record, while this one is asked about a number that arrived in a file and is
 * about to be drawn on a board. Ten tonnes is past every record by two orders of
 * magnitude and short of the values that make a layout unreadable.
 */
const Kilograms = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(10_000));

const Answer = v.picklist(['yes', 'no', 'unstated'] as const);
const PlatformLift = v.picklist(['squat', 'bench', 'deadlift'] as const);
const EvidenceAge = v.picklist([
  'within-eight-weeks',
  'within-six-months',
  'older',
  'unstated',
] as const);

/*
 * ---------------------------------------------------------------------------
 * The planner session (§6 to §8).
 * ---------------------------------------------------------------------------
 */

/** A typed figure, held as the lifter typed it. See `session.ts` on why strings. */
const Figure = text(24);

const PlannerSetupSchema = v.object({
  /** May be blank: a meet can be saved before a federation has been chosen. */
  federationId: text(120),
  format: v.picklist(['full-power', 'push-pull', 'bench-only', 'deadlift-only'] as const),
  unit: v.picklist(['kg', 'lb'] as const),
  firstMeet: v.nullable(v.boolean()),
  goal: v.picklist([
    'first-meet',
    'conservative',
    'balanced',
    'personal-record',
    'qualification',
    'place-or-win',
    'record-attempt',
    'custom',
  ] as const),
  goalChosen: v.boolean(),
  method: v.picklist([
    'expected-max',
    'guided-estimate',
    'known-opener',
    'manual',
    'target-total',
  ] as const),
});

const GuidedSetSchema = v.object({
  weight: Figure,
  reps: Figure,
  repsInReserve: v.picklist([0, 1, 2, 3, 'four-or-more', 'unknown'] as const),
  competitionStandard: Answer,
  age: EvidenceAge,
  sameEquipment: Answer,
});

const LiftFiguresSchema = v.object({
  expectedMaximum: Figure,
  guided: GuidedSetSchema,
  opener: Figure,
  attempts: v.tuple([Figure, Figure, Figure]),
  ceiling: Figure,
  openerTested: Answer,
  personalRecord: Figure,
  confirmed: v.boolean(),
});

const PlannerExtrasSchema = v.object({
  bodyweight: Figure,
  age: Figure,
  priorMeets: Figure,
  equipment: v.picklist(['raw', 'wraps', 'single-ply', 'multi-ply', 'other', 'unstated'] as const),
  readiness: v.picklist(['normal', 'uncertain', 'reduced', 'unstated'] as const),
  hardCut: Answer,
  minimumJump: Figure,
  maximumJump: Figure,
  comparison: v.picklist(['male', 'female', 'none'] as const),
  maximumSource: v.picklist([
    'competition-single',
    'competition-standard-single',
    'low-repetition-estimate',
    'high-repetition-estimate',
    'lifetime-best',
    'unstated',
  ] as const),
  evidenceAge: EvidenceAge,
});

const PlannerTargetsSchema = v.object({
  personalRecordTotal: Figure,
  qualifyingTotal: Figure,
  minimumAcceptableTotal: Figure,
  stretchTotal: Figure,
});

const PlannerSessionSchema = v.object({
  setup: PlannerSetupSchema,
  targetTotal: Figure,
  extras: PlannerExtrasSchema,
  targets: PlannerTargetsSchema,
  /**
   * Written out lift by lift rather than as a record over the picklist.
   *
   * `v.record` produces a partial type -- every key optional -- and `LivePlanning`
   * and `PlannerSession.figures` are total on purpose, so a parsed record would
   * not be assignable and the compile-time check below would be the thing that
   * caught it. Three named keys are also what makes a saved meet missing the
   * bench figures a refusal rather than a screen with one lift silently absent.
   */
  figures: v.object({
    squat: LiftFiguresSchema,
    bench: LiftFiguresSchema,
    deadlift: LiftFiguresSchema,
  }),
});

/*
 * ---------------------------------------------------------------------------
 * §22's preparation.
 * ---------------------------------------------------------------------------
 */

const LifterSetupSchema = v.object({
  squatRackHeight: text(SETUP_LABEL_MAX),
  squatSafetyHeight: text(SETUP_LABEL_MAX),
  monoliftSetting: text(SETUP_LABEL_MAX),
  squatStart: v.picklist(['walkout', 'monolift', 'unstated'] as const),
  benchRackHeight: text(SETUP_LABEL_MAX),
  benchSafetyHeight: text(SETUP_LABEL_MAX),
  footBlocks: Answer,
  handoff: v.picklist(['own-handler', 'meet-spotter', 'no-handoff', 'unstated'] as const),
  deadliftNotes: text(SETUP_NOTE_MAX),
  commands: text(SETUP_NOTE_MAX),
  flight: text(SETUP_LABEL_MAX),
  lot: text(SETUP_LABEL_MAX),
  platform: text(SETUP_LABEL_MAX),
  session: text(SETUP_LABEL_MAX),
  weighInTime: text(SETUP_LABEL_MAX),
  liftingStartTime: text(SETUP_LABEL_MAX),
});

const SavedPrepSchema = v.object({
  setup: LifterSetupSchema,
  /**
   * The ticks, as a list.
   *
   * Bounded by the same cap as an id rather than by the number of rows: the rows
   * are derived and a custom one can be added, so there is no fixed count to
   * check against, and a tick whose row no longer exists is dropped harmlessly
   * by the checklist itself.
   */
  done: v.array(Identifier),
  custom: v.array(v.object({ itemId: Identifier, text: text(CUSTOM_ITEM_MAX) })),
  notes: text(PREP_NOTES_MAX),
  nextCustomOrdinal: Ordinal,
});

/*
 * ---------------------------------------------------------------------------
 * The meet document (§12 to §14).
 * ---------------------------------------------------------------------------
 */

const RefereeLight = v.picklist(['white', 'red'] as const);

/**
 * Shared, because §9.4's history records the same reason off the same attempt.
 *
 * Written once rather than twice for the ordinary reason -- two lists that must
 * agree will not -- and the failure has a shape worth naming: a reason accepted
 * on an attempt and refused in the history entry beside it makes a whole saved
 * meet unreadable, and the sentence the lifter sees is "this build cannot open
 * that meet" rather than anything about a miss reason.
 */
const MissReason = v.picklist([
  'command',
  'strength',
  'pain',
  'platform-error',
  'administrative',
  'unsure',
] as const);

const LiveAttemptSchema = v.object({
  id: Identifier,
  lift: PlatformLift,
  attemptNumber: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)),
  kind: v.picklist(['competition', 'extra', 'record'] as const),
  kilograms: v.nullable(Kilograms),
  status: v.picklist([
    'planned',
    'proposed',
    'selected',
    'submitted',
    'confirmed',
    'locked',
    'good',
    'no-lift',
    'passed',
    'extra-attempt-granted',
  ] as const),
  effort: v.nullable(v.picklist(['flew', 'solid', 'slow', 'grind', 'pain', 'unsure'] as const)),
  /**
   * Not bounded to the RPE scale here, and that is on purpose.
   *
   * `RPE_BOUNDS` is what `recordResult` enforces when a person enters one, and
   * it is a judgement that could be widened in a later release. A file check
   * that repeated it would turn a change to that judgement into a refusal to
   * open meets recorded under the old one. Finite and non-negative is the shape;
   * the scale is the document layer's.
   */
  rpe: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(100))),
  missReason: v.nullable(MissReason),
  lights: v.nullable(v.tuple([RefereeLight, RefereeLight, RefereeLight])),
  note: v.nullable(text(500)),
  changesUsed: Ordinal,
  submittedAt: v.nullable(Instant),
  grantedFor: v.nullable(Identifier),
});

const LiveLifterSchema = v.object({
  id: Identifier,
  /** A person's name. Capped, never logged, never sent to an embedding page. */
  name: text(120),
  attempts: v.array(LiveAttemptSchema),
  countdown: v.nullable(
    v.object({
      attemptId: Identifier,
      startedAt: Instant,
      seconds: v.pipe(v.number(), v.finite(), v.minValue(0)),
    }),
  ),
  nextAttemptOrdinal: Ordinal,
});

const MeetDocumentSchema = v.object({
  rulesProfileId: text(120),
  rulebookRevision: text(120),
  format: v.picklist(['full-power', 'push-pull', 'bench-only', 'deadlift-only'] as const),
  lifters: v.array(LiveLifterSchema),
  focusedLifterId: v.nullable(Identifier),
  nextLifterOrdinal: Ordinal,
});

/*
 * ---------------------------------------------------------------------------
 * §21's board context.
 * ---------------------------------------------------------------------------
 */

const SavedCoachEntrySchema = v.object({
  lifterId: Identifier,
  identifier: v.optional(text(40)),
  /**
   * A CSS colour, and the only value in this file that reaches a stylesheet.
   *
   * Restricted to a hex triple rather than accepting what CSS accepts. The board
   * writes this into a custom property, and CSS colour syntax includes functions
   * -- an imported entry naming `var(--something)` or an `image-set()` would be a
   * value from a file steering how the page paints. Six or three hex digits is
   * every colour a picker produces and nothing else.
   */
  colour: v.nullish(v.pipe(v.string(), v.regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u))),
  platformCall: v.nullish(v.picklist(['called', 'on-deck', 'in-the-hole'] as const)),
  handlers: v.optional(
    v.array(
      v.object({
        name: text(80),
        /*
         * The domain's own tuple rather than the seven strings written out
         * again. This file used to spell them, and a list spelled twice is a
         * control offering an option the importer rejects the day an eighth
         * arrives -- with the rejected file being somebody else's export of the
         * same meet.
         */
        responsibilities: v.array(v.picklist(HANDLER_RESPONSIBILITIES)),
      }),
    ),
  ),
  rackId: v.optional(text(40)),
  pinned: v.optional(v.boolean()),
});

/*
 * ---------------------------------------------------------------------------
 * §9.4's history entry.
 * ---------------------------------------------------------------------------
 */

const HistoricAttemptSchema = v.object({
  /**
   * Bounded at three, unlike `LiveAttemptSchema`'s four.
   *
   * A fourth attempt is a record try and is not a competition attempt, so it is
   * never in a history entry -- `summariseMeet` filters on `kind` and this says
   * the same thing about a file somebody else wrote. Reading a record attempt as
   * a third would put an exempted weight into the jump the calibration measures.
   */
  attemptNumber: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(3)),
  kilograms: Kilograms,
  outcome: v.picklist(['good', 'no-lift', 'passed'] as const),
  missReason: v.nullable(MissReason),
});

const HistoricLiftSchema = v.object({
  lift: PlatformLift,
  attempts: v.array(HistoricAttemptSchema),
  plannedMaximumKilograms: v.nullable(Kilograms),
});

const SavedHistorySchema = v.object({
  equipment: v.picklist(['raw', 'wraps', 'equipped', 'unstated'] as const),
  lifts: v.array(HistoricLiftSchema),
});

/*
 * ---------------------------------------------------------------------------
 * §20's warm-up answers.
 *
 * Every figure below is a capped string, which is `warmup.ts`'s rule rather
 * than a choice made here: a field a lifter cleared mid-thought is not a zero,
 * so the answers are held as typed and read through `FieldReading` at the point
 * something needs a number. That makes this half of the schema uncommonly dull,
 * and the interesting half is the room -- the only place in a saved meet where a
 * number reaches arithmetic without a parse in front of it.
 * ---------------------------------------------------------------------------
 */

/**
 * A bar or a pair of collars, bounded because nothing downstream bounds it.
 *
 * `equipment.ts` makes this argument about its own preference bounds and it is
 * the stronger reason of the two here: a ramp built on a bar of 1e308 is a ramp
 * of `Infinity`, computed without an error, drawn on a screen. A tonne is past
 * every implement anybody has stood under and short of the values that break the
 * arithmetic.
 */
const Implement = v.object({
  amount: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000)),
  unit: v.picklist(['kg', 'lb'] as const),
});

/**
 * One denomination on the rack. `pairs: null` is the domain's "enough of these".
 *
 * Note that this is *not* the encoding `equipment.ts` stores a preference in,
 * where the same null is written as a zero because the preferences package has
 * no nullable builder (§5.12). JSON has one, so the honest shape is used here --
 * and reusing the preference encoding would mean a saved meet whose plate counts
 * only make sense to a reader that knows about a constraint from another package.
 */
const PlateDenominationSchema = v.object({
  weight: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000)),
  pairs: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000))),
  fullDiameter: v.boolean(),
});

/**
 * The warm-up room, which is tool 2's `Equipment` and not a second model.
 *
 * `barId` and `collarId` are free text rather than the two picklists the presets
 * would make, and that is deliberate on the same grounds the responsibilities
 * tuple above is *not*. A responsibility is a closed vocabulary the domain owns,
 * so a spelling of it here can be wrong. A preset id is a catalogue this build
 * happens to ship: a file exported by a build with one more bar in it would be
 * refused whole, over a field whose own reader already falls back to the custom
 * bar when it meets an id it does not know.
 */
const EquipmentSchema = v.object({
  plateUnit: v.picklist(['kg', 'lb'] as const),
  barId: text(60),
  customBar: Implement,
  collarId: text(60),
  customCollars: Implement,
  /**
   * Both units written out, for `PlannerSessionSchema.figures`' reason: `v.record`
   * infers every key optional and `Equipment.inventory` is total, so a parsed
   * record would not be assignable and the compile-time check at the foot of the
   * file would be what caught it.
   *
   * Capped at twice the longest catalogue. `toggleDenomination` can only ever
   * insert a weight the interface offered, so a longer list is a file that was
   * written by something else -- and the cost of accepting it is a plate search
   * over a list somebody chose the length of.
   */
  inventory: v.object({
    kg: v.pipe(v.array(PlateDenominationSchema), v.maxLength(32)),
    lb: v.pipe(v.array(PlateDenominationSchema), v.maxLength(32)),
  }),
});

const PrepAnswerSchema = v.object({
  minutes: Figure,
  when: v.picklist(['before-the-ramp', 'after-the-final-warm-up'] as const),
});

/**
 * One answer per preparation, written out rather than recorded.
 *
 * Total over `PrepKind`, so the five keys are spelled. Which of them a meet
 * *offers* is `prepKindsFor`'s question and depends on the format, so a
 * bench-only meet holds four rows nobody will see -- that is what `warmup.ts`
 * chose when it made the state total rather than partial, and a schema that
 * agreed with the screen instead of with the type would refuse a full-power meet
 * whose format was corrected to bench-only after the wraps were answered for.
 */
const PrepAnswersSchema = v.object({
  'knee-wraps': PrepAnswerSchema,
  'bench-shirt': PrepAnswerSchema,
  'squat-suit': PrepAnswerSchema,
  'deadlift-suit': PrepAnswerSchema,
  other: PrepAnswerSchema,
});

const WarmupPreferencesSchema = v.object({
  leadMinimumMinutes: Figure,
  leadMaximumMinutes: Figure,
  restSeconds: Figure,
  setSeconds: Figure,
  maximumSets: Figure,
  sharedRackLifters: Figure,
  delayPreference: v.picklist(['wait', 'repeat-a-light-movement', 'continue'] as const),
  prep: PrepAnswersSchema,
});

const MeetProgressSchema = v.object({
  place: v.picklist(['earlier-flight-running', 'own-flight-running'] as const),
  currentRound: Figure,
  currentPosition: Figure,
  attemptsLeftInTheRunningFlight: Figure,
  wholeFlightsBetween: Figure,
  flightSize: Figure,
  attemptsCompleted: Figure,
  minutesSinceSessionStart: Figure,
  breakMinutes: Figure,
  delayMinutes: Figure,
  targetRound: Figure,
  targetPosition: Figure,
});

/**
 * The per-set overrides, held by index into a ramp that no longer exists.
 *
 * Bounded at `SETS_BOUNDS.max`, which is the field's ceiling and not the ramp's:
 * `MAX_RAMP_SETS` is seven, so twenty is already more entries than any reachable
 * ramp has rows. The cap is about the size of a file rather than about the shape
 * of a warm-up -- an answer naming a set the rebuilt ramp does not have is
 * dropped by `warmup.ts` without a word, which is the right behaviour there and
 * is why an unbounded list here would simply be carried around for ever.
 */
const SetAnswersSchema = v.pipe(
  v.array(v.object({ index: Ordinal, text: Figure })),
  v.maxLength(20),
);

const MeetWarmupStateSchema = v.object({
  room: EquipmentSchema,
  preferences: WarmupPreferencesSchema,
  progress: MeetProgressSchema,
  weights: SetAnswersSchema,
  reps: SetAnswersSchema,
});

/** Three states, written out for `WarmupStates`' own totality reason. */
const WarmupStatesSchema = v.object({
  squat: MeetWarmupStateSchema,
  bench: MeetWarmupStateSchema,
  deadlift: MeetWarmupStateSchema,
});

const SavedWarmupSchema = v.object({
  states: WarmupStatesSchema,
  lift: PlatformLift,
  byLifter: v.array(v.object({ lifterId: Identifier, states: WarmupStatesSchema })),
});

/*
 * ---------------------------------------------------------------------------
 * A saved meet, and a file of them.
 * ---------------------------------------------------------------------------
 */

const SavedMeetStateSchema = v.object({
  mode: v.picklist(['solo', 'coach'] as const),
  session: PlannerSessionSchema,
  prep: SavedPrepSchema,
  document: v.nullable(MeetDocumentSchema),
  lifterId: v.nullable(Identifier),
  entries: v.array(SavedCoachEntrySchema),
  openLifterId: v.nullable(Identifier),
  /**
   * Optional with a default, and therefore no `SAVED_MEET_VERSION` bump.
   *
   * Every meet already on a shelf was written without this key. A required field
   * would fail all of them at the parser, which `#restoreReport` counts as
   * unreadable -- so the release that added a history entry would blank the
   * shelf of every lifter who had one. The version number is bumped "when a
   * build can no longer read what an older one wrote, or the other way round",
   * and an additive optional field is readable in both directions: an older
   * build meets a key it does not know and drops it, which costs the calibration
   * a meet and nothing else.
   */
  history: v.optional(v.nullable(SavedHistorySchema), null),
  /**
   * Optional with a default for `history`'s reason, one release later.
   *
   * The same claim, and it has to be true for the same meets: every shelf written
   * before §20 shipped has no such key, a required field would fail all of them
   * at the parser, and `#restoreReport` counts a parse failure as unreadable. So
   * the release that started saving a warm-up would blank the shelf of every
   * lifter who had planned a meet without one.
   */
  warmup: v.optional(v.nullable(SavedWarmupSchema), null),
});

export const SavedMeetSchema = v.object({
  id: Identifier,
  name: text(MEET_NAME_MAX),
  createdAt: Instant,
  updatedAt: Instant,
  archived: v.boolean(),
  rulesProfileId: text(120),
  rulebookRevision: text(120),
  methodologyVersion: text(120),
  state: SavedMeetStateSchema,
});

/**
 * What every exported file says on its first line.
 *
 * A named kind rather than trusting the extension, because the file arrives
 * through a picker that will happily hand over anything -- and because the
 * failure worth distinguishing is "this is somebody's tax return" from "this is
 * a meet file this build is too old for". Those get different sentences.
 */
export const MEET_FILE_KIND = 'platform-toolkit.meet-day';

export const MeetFileSchema = v.object({
  kind: v.literal(MEET_FILE_KIND),
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** When it was written. Read only to be shown; nothing branches on it. */
  exportedAt: Instant,
  meets: v.array(SavedMeetSchema),
});

export type MeetFile = v.InferOutput<typeof MeetFileSchema>;

/*
 * ---------------------------------------------------------------------------
 * The compile-time half.
 * ---------------------------------------------------------------------------
 */

/**
 * Proof that what comes out of the parser is what the application expects.
 *
 * This is the whole reason the schema may be written by hand. Adding a required
 * field to `PlannerSession`, `MeetDocument` or any of their parts makes the
 * parsed type stop satisfying `SavedMeet` and fails the build here, naming this
 * line -- rather than shipping a version that reads a saved meet, drops the new
 * field on the floor and restores a plan with something missing from it.
 *
 * It is deliberately one-directional. The parsed type must be *assignable to*
 * the live one, not equal to it: a saved shape is allowed to be narrower (the
 * colour regex above is narrower than `string`, and should be).
 */
type ParsesToSavedMeet = v.InferOutput<typeof SavedMeetSchema> extends SavedMeet ? true : never;
type ParsesToSavedState =
  v.InferOutput<typeof SavedMeetStateSchema> extends SavedMeetState ? true : never;

/**
 * Referenced so the checks above are not dead code an editor offers to remove.
 *
 * A tuple rather than an intersection, which was the first spelling: both
 * conditionals resolve to `true` when they hold, so `A & B` is `true & true`
 * and the linter reports a duplicated constituent -- correctly, and the
 * suppression would have been the wrong answer. A tuple keeps the two checks
 * separate, so the one that fails is the one named in the error.
 */
export const SAVED_MEET_SHAPE_AGREES: [ParsesToSavedMeet, ParsesToSavedState] = [true, true];

/*
 * ---------------------------------------------------------------------------
 * Reading and writing.
 * ---------------------------------------------------------------------------
 */

export type MeetFileRefusal =
  /** Not JSON at all. */
  | 'unreadable'
  /** JSON, but not one of these. */
  | 'not-a-meet-file'
  /** A meet file a later release wrote. This build cannot be sure what it means. */
  | 'newer-version'
  /** A meet file an earlier release wrote, from before a shape change. */
  | 'older-version'
  /** The right kind and the right version, and some part of it does not fit. */
  | 'damaged';

export type MeetFileReading =
  | { readonly ok: true; readonly file: MeetFile }
  | {
      readonly ok: false;
      readonly reason: MeetFileRefusal;
      /** The version found, when there was one. Shown so the sentence can say it. */
      readonly foundVersion?: number;
    };

/**
 * Turns text into meets, or says why it will not.
 *
 * The version is read before the body is validated, which is the order that
 * makes §24.4's "report any unsupported or older data clearly" possible: a file
 * from a later release will fail the body check too, and reporting *that* would
 * tell a lifter their backup is damaged when it is merely from a newer phone.
 */
export function readMeetFile(source: string): MeetFileReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    // The exception carries an offset into a file that may hold a lifter's
    // name. Nothing about it is shown or logged; the refusal is the report.
    return { ok: false, reason: 'unreadable' };
  }

  const envelope = v.safeParse(
    v.object({ kind: v.literal(MEET_FILE_KIND), version: v.number() }),
    parsed,
  );
  if (!envelope.success) return { ok: false, reason: 'not-a-meet-file' };
  if (envelope.output.version > SAVED_MEET_VERSION) {
    return { ok: false, reason: 'newer-version', foundVersion: envelope.output.version };
  }
  if (envelope.output.version < SAVED_MEET_VERSION) {
    // There is no older version yet, so there is nothing to migrate from. When
    // there is, this is where the migration goes -- and until then saying so is
    // better than a validation failure that reads as corruption.
    return { ok: false, reason: 'older-version', foundVersion: envelope.output.version };
  }

  const file = v.safeParse(MeetFileSchema, parsed);
  if (!file.success) return { ok: false, reason: 'damaged', foundVersion: envelope.output.version };
  return { ok: true, file: file.output };
}

/**
 * The text of an export.
 *
 * Written through the schema rather than straight from the objects, so anything
 * this build could not read back is refused at the moment it is written instead
 * of at the moment somebody needs it. Two spaces of indentation because a person
 * who opens their own backup in a text editor should be able to see their meet
 * in it; the size difference is a few kilobytes on a file that is already local.
 */
export function writeMeetFile(meets: readonly SavedMeet[], now: number): string {
  const file: MeetFile = {
    kind: MEET_FILE_KIND,
    version: SAVED_MEET_VERSION,
    exportedAt: now,
    meets: v.parse(v.array(SavedMeetSchema), meets),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Reads one saved meet, for the store rather than for a file.
 *
 * Same validation, no envelope: browser storage holds the meets under a key this
 * application chose, so there is no question of what kind of thing it is -- only
 * of whether it still fits.
 */
export function readSavedMeet(value: unknown): SavedMeet | null {
  const parsed = v.safeParse(SavedMeetSchema, value);
  return parsed.success ? parsed.output : null;
}
