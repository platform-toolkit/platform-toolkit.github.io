// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §24: what a saved meet is, and what a shelf of them does.
 *
 * Pure, like every other module in this directory that is not an element. It
 * decides what a library looks like after a create, a rename, a duplicate, an
 * archive, a delete and an import, and it touches no storage -- `meet-store.ts`
 * is the seam, and `meet-file.ts` is the trust boundary between a run of bytes
 * and one of these.
 *
 * WHY THE SAVED SHAPE IS WRITTEN OUT AGAIN INSTEAD OF REUSING THE LIVE TYPES
 *
 * Most of it is the live types, and where it is, it says so. Four places it is
 * not, and each of them is the reason the split exists at all:
 *
 * - `MeetPrep.done` is a `ReadonlySet`, which `JSON.stringify` writes as `{}`.
 *   A set saved that way is not corrupt and does not throw: it comes back empty,
 *   so a lifter reopens the tool to a checklist with every tick gone and no
 *   evidence that anything failed.
 * - `WarmupsByLifter` is a `ReadonlyMap` and stringifies to the same `{}`, with
 *   the same silence. See {@link SavedWarmup}, which also has a reason of its
 *   own for not going back through a plain object.
 * - `MeetRules` is a smart-constructed object built from a published profile. It
 *   is not saved; it is rebuilt on the way back in, which is also the only way a
 *   restored meet is guaranteed to be running under rules this build agrees
 *   with. See `restorable` below for what happens when the profile has gone.
 * - The undo history is deliberately dropped. See `SavedMeetState`.
 *
 * WHY §30 IS A CONSTRAINT ON THIS FILE IN PARTICULAR
 *
 * §30 asks that a locally saved meet carry enough to become an account-backed
 * entry later: the meet, the lifter, the attempts, the recommendations, the
 * results, the rule profile and the methodology. The first five are the meet
 * document and the planner session. The last two are not derivable from either
 * -- a rule profile can be republished and a methodology version moves with a
 * release of this repository -- so both are stamped on the meet at the moment it
 * is created and never recomputed. A meet that was planned under one reading of
 * §9.3 says so for ever, which is the whole point of stamping it.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import {
  ATTEMPT_PLAN_METHODOLOGY_VERSION,
  type CoachBoardEntry,
  type HistoricLift,
  type HistoryEquipment,
  type MeetDocument,
} from '@platform-toolkit/domain';

import { EMPTY_PREP, type CustomChecklistItem, type LifterSetup, type MeetPrep } from './prep.js';
import {
  EMPTY_RECORD_STATES,
  NO_RECORDS,
  type RecordStates,
  type RecordSubject,
  type RecordsByLifter,
} from './records.js';
import { EMPTY_SESSION, type PlannerSession } from './session.js';
import {
  EMPTY_WARMUP_STATES,
  NO_WARMUPS,
  type WarmupStates,
  type WarmupsByLifter,
} from './warmup.js';

/*
 * ---------------------------------------------------------------------------
 * Versions and bounds.
 * ---------------------------------------------------------------------------
 */

/**
 * The shape number written on every saved meet and every exported file.
 *
 * Bumped when a build can no longer read what an older one wrote, or the other
 * way round. A reader that meets a higher number says so and stops (§24.4's
 * "report any unsupported or older data clearly") rather than guessing at the
 * fields it recognises -- a half-understood meet restored silently is a plan
 * with attempts missing, and the lifter finds out on the platform.
 */
export const SAVED_MEET_VERSION = 1;

/** §30's methodology stamp, taken from the domain so the two cannot drift. */
export const SAVED_MEET_METHODOLOGY_VERSION = ATTEMPT_PLAN_METHODOLOGY_VERSION;

/**
 * How many meets one device keeps.
 *
 * A bound rather than none, because the backing is a few hundred kilobytes of
 * browser storage shared with everything else on the origin, and the failure
 * when it runs out is a write that silently does not happen. Twenty is far more
 * than the two or three a lifter has on the go and short of a career archive --
 * which is tool 8's job and has a database behind it.
 */
export const MEET_LIBRARY_MAX = 20;

/** Long enough for "Nationals -- Saturday 74kg", short of a pasted paragraph. */
export const MEET_NAME_MAX = 60;

/*
 * ---------------------------------------------------------------------------
 * The saved shape.
 * ---------------------------------------------------------------------------
 */

/** §22's preparation document with the one field JSON cannot carry made a list. */
export interface SavedPrep {
  readonly setup: LifterSetup;
  /** `MeetPrep.done`, which is a set in memory. Order is not meaningful. */
  readonly done: readonly string[];
  readonly custom: readonly CustomChecklistItem[];
  readonly notes: string;
  readonly nextCustomOrdinal: number;
}

export function toSavedPrep(prep: MeetPrep): SavedPrep {
  return {
    setup: prep.setup,
    done: [...prep.done],
    custom: prep.custom,
    notes: prep.notes,
    nextCustomOrdinal: prep.nextCustomOrdinal,
  };
}

export function fromSavedPrep(saved: SavedPrep): MeetPrep {
  return {
    setup: saved.setup,
    done: new Set(saved.done),
    custom: saved.custom,
    notes: saved.notes,
    nextCustomOrdinal: saved.nextCustomOrdinal,
  };
}

/*
 * ---------------------------------------------------------------------------
 * §20's warm-up answers.
 * ---------------------------------------------------------------------------
 */

/** One lifter's three ramps on the coach path. */
export interface SavedLifterWarmup {
  readonly lifterId: string;
  readonly states: WarmupStates;
}

/**
 * §20's answers, and none of what §20 worked out from them.
 *
 * THE ANSWERS, NEVER THE SCHEDULE
 *
 * The rule `warmup.ts` states for a paint, arriving here as the reason this type
 * holds what it holds. A `MeetWarmupSchedule` is counted backward from a platform
 * estimate at one instant and `WarmupTimeline` stamps that instant on it, so a
 * saved one is wrong by however long the file sat on the shelf -- and wrong in
 * the direction §5.5 forbids everywhere on this screen, telling a lifter they
 * have twenty minutes when the flight ahead finished last night. The answers have
 * no instant in them: they are what somebody typed, they are small, and
 * `buildMeetWarmup` turns them back into a schedule counted from now.
 *
 * `SavedCoachEntry` makes the same call about the same field from the other end.
 *
 * WHY THE BOARD IS A LIST AND COMES BACK A `Map`
 *
 * `WarmupsByLifter` is a `ReadonlyMap`, and `JSON.stringify` writes one as `{}` --
 * the `MeetPrep.done` failure exactly, silent in the same way. A list of entries
 * is the shape that survives.
 *
 * It must not come back as a plain object, and that is a separate point.
 * `warmup.ts` chose a `Map` because a lifter id can arrive from an imported meet
 * file, and a record inherits `Object.prototype` -- so an athlete filed under
 * `constructor` reads back as a function typed as a `WarmupStates`. Rebuilding
 * through `new Map(...)` in {@link fromSavedWarmup} keeps that hole shut on the
 * one path that actually takes a foreign file.
 *
 * WHY THIS WHOLE FIELD IS NULLABLE RATHER THAN AN EMPTY ONE
 *
 * A `MeetWarmupState` carries an `Equipment`, which is two plate inventories --
 * about a kilobyte -- and there are three of them per lifter. An always-present
 * empty answer would therefore put five kilobytes on every saved meet whose fold
 * was never opened, times `MEET_LIBRARY_MAX`, in a store measured in hundreds of
 * kilobytes and shared with everything else on the origin. `null` is the state
 * most saved meets are in and it costs nothing to write down.
 *
 * `byLifter` is sparse for the same reason and gets it for free: the map gains a
 * key only when somebody types. A lifter who typed and then cleared every field
 * keeps their entry, since comparing two of these for emptiness would be a deep
 * walk on every keystroke to save a kilobyte.
 */
export interface SavedWarmup {
  /** The solo path's three ramps, total over `PlatformLift`. */
  readonly states: WarmupStates;
  /** Which lift the fold was showing. A choice, so it is restored rather than reset. */
  readonly lift: PlatformLift;
  /** §21's board, only for the lifters somebody has answered for. */
  readonly byLifter: readonly SavedLifterWarmup[];
}

/**
 * The same three as the planner holds them, travelling together.
 *
 * The planner keeps them as three separate `@state` fields, because they move
 * independently and Lit compares them one at a time. They are one object at this
 * seam because the save and the restore have to agree about all three at once:
 * two of the three restored is a fold showing the squat ramp with the bench
 * answers in it.
 */
export interface WarmupAnswers {
  readonly states: WarmupStates;
  readonly lift: PlatformLift;
  readonly byLifter: WarmupsByLifter;
}

/**
 * Nothing typed, which is what a restored meet with no warm-up in it becomes.
 *
 * `'squat'` is the planner's own default for the picker and is repeated here
 * rather than imported from it, because this module is pure and the planner is an
 * element. The two are held together by `#restore` assigning all three fields
 * from here, so a drift would show up as the fold opening on the wrong lift for
 * every restored meet rather than as a subtle one.
 */
export const NO_WARMUP_ANSWERS: WarmupAnswers = {
  states: EMPTY_WARMUP_STATES,
  lift: 'squat',
  byLifter: NO_WARMUPS,
};

export function toSavedWarmup(answers: WarmupAnswers): SavedWarmup {
  return {
    states: answers.states,
    lift: answers.lift,
    byLifter: [...answers.byLifter].map(([lifterId, states]) => ({ lifterId, states })),
  };
}

export function fromSavedWarmup(saved: SavedWarmup | null): WarmupAnswers {
  if (saved === null) return NO_WARMUP_ANSWERS;
  return {
    states: saved.states,
    lift: saved.lift,
    byLifter: new Map(saved.byLifter.map((entry) => [entry.lifterId, entry.states])),
  };
}

/*
 * ---------------------------------------------------------------------------
 * §19's record answers.
 * ---------------------------------------------------------------------------
 */

/** One lifter's four records on the coach path. */
export interface SavedLifterRecords {
  readonly lifterId: string;
  readonly states: RecordStates;
}

/**
 * §19's answers, and the reversal of the decision that shipped beside them.
 *
 * WHY THIS IS SAVED, HAVING BEEN DOCUMENTED AS DELIBERATELY NOT SAVED
 *
 * The field's own comment in the planner said the opposite for one release, and
 * the argument it made is still true as far as it goes: this fold is a scratch
 * pad in front of a federation's published list, the list is the source, and a
 * figure restored six weeks later is worse than an empty box **because it looks
 * answered**. What that argument got wrong was treating "looks answered" as a
 * property of saving rather than as a property of saying nothing about it. A
 * saved figure the screen flags as saved does not look answered; it looks like
 * what it is.
 *
 * Against it stands the case {@link SavedWarmup} already settled one fold up.
 * These answers are filled in on the Thursday evening with the record list open
 * in another tab, and they are read at the rack on the Saturday -- across a
 * reload, a phone restart, and in a gym with one bar of signal, which is
 * precisely when the list cannot be opened again. A coach is worse off still:
 * four athletes, four subjects each, retyped on the morning of the meet from a
 * list they must now find twice.
 *
 * WHAT THE FLAG IS AND WHY IT IS NOT A DATE
 *
 * The staleness caveat is carried by the fold, next to the figure, for as long
 * as the restored answer is still the restored answer -- see the planner's
 * `#restoredRecords`. It carries no date. There is no date formatter anywhere in
 * this tool and adding one for a caveat would bring a locale and a time zone into
 * a screen that has neither; `SavedMeet.updatedAt` was the other candidate and is
 * worse than none, because it moves when any part of the meet is edited and so
 * reports a record as fresher than it is. Under §5.5's rounding instinct, an
 * unqualified "saved earlier" is the safe direction and a reassuring timestamp is
 * not.
 *
 * It is also **not** carried through `#restoreReport`. That method returns
 * exactly one of three sentences by design, so a record caveat added to it would
 * be suppressed by any rule-book drift -- and a rule book that moved is the case
 * where a record is most likely to have moved too.
 *
 * WHY THE FIELD IS NULLABLE
 *
 * Not for {@link SavedWarmup}'s size reason, which does not apply: a
 * `MeetRecordState` is five short strings and a boolean, so four of them are
 * bytes rather than kilobytes. `null` is here because it is the difference
 * between "nobody has typed a record" and "somebody typed one and it is
 * however old this file is", and the caveat above is the thing that reads it. An
 * always-present empty answer would collapse those two into one.
 *
 * `byLifter` is sparse for {@link SavedWarmup}'s reason and comes back through
 * `new Map(...)` in {@link fromSavedRecords} for its `Object.prototype` reason.
 */
export interface SavedRecords {
  /** The solo path's four records, total over `RecordSubject`. */
  readonly states: RecordStates;
  /** Which record the fold was showing. A choice, so it is restored rather than reset. */
  readonly subject: RecordSubject;
  /** §21's board, only for the lifters somebody has answered for. */
  readonly byLifter: readonly SavedLifterRecords[];
}

/** The same three as the planner holds them, for {@link WarmupAnswers}' reason. */
export interface RecordAnswers {
  readonly states: RecordStates;
  readonly subject: RecordSubject;
  readonly byLifter: RecordsByLifter;
}

/**
 * Nothing typed, which is what a restored meet with no records in it becomes.
 *
 * `'squat'` repeats the planner's own picker default for {@link
 * NO_WARMUP_ANSWERS}' reason, and drifting from it would show up the same way:
 * every restored meet opening the fold on the wrong record.
 */
export const NO_RECORD_ANSWERS: RecordAnswers = {
  states: EMPTY_RECORD_STATES,
  subject: 'squat',
  byLifter: NO_RECORDS,
};

export function toSavedRecords(answers: RecordAnswers): SavedRecords {
  return {
    states: answers.states,
    subject: answers.subject,
    byLifter: [...answers.byLifter].map(([lifterId, states]) => ({ lifterId, states })),
  };
}

export function fromSavedRecords(saved: SavedRecords | null): RecordAnswers {
  if (saved === null) return NO_RECORD_ANSWERS;
  return {
    states: saved.states,
    subject: saved.subject,
    byLifter: new Map(saved.byLifter.map((entry) => [entry.lifterId, entry.states])),
  };
}

/** Which of §6.1's two screens the meet was being run from. */
export type SavedMode = 'solo' | 'coach';

/**
 * §21's per-lifter context, less the one field that is a cache.
 *
 * `CoachBoardEntry.warmup` is a `WarmupTimeline`, which its own header describes
 * as a schedule kept so the ramp is not recomputed four times a second -- and it
 * carries the instant it was counted from. Saving it stores a stopwatch: a meet
 * reopened tomorrow would restore a schedule whose every window is a day past,
 * and the board would age it against `now` and announce that the third warm-up
 * was due nineteen hours ago.
 *
 * There is no rebuild to perform, and §20 shipping has not changed that. Nothing
 * ever sets the field on the list this type is taken from: the planner attaches a
 * schedule in `#boardEntries`, at paint time, to a copy handed straight to the
 * board and thrown away afterwards. So a restored board has no schedule for the
 * same reason a fresh one has none, and it gets one on its first paint.
 *
 * What §20 did add is the *answers* behind that schedule, and those are saved --
 * see {@link SavedWarmup}, which is where the same argument decides the opposite
 * way. A ramp is counted from the platform estimate at the instant it is asked
 * for and is the one thing a saved document cannot hold; the questions it was
 * counted from are the one thing worth holding.
 */
export type SavedCoachEntry = Omit<CoachBoardEntry, 'warmup'>;

/**
 * §9.4's reading of one finished meet, stamped when it finished.
 *
 * WHY IT IS STORED RATHER THAN DERIVED ON THE WAY OUT
 *
 * Everything in it is already here: `document` holds every attempt and the
 * session holds the plan, so `summariseMeet` could rebuild it from a saved meet
 * whenever calibration is asked for. Two things make that the wrong call, and
 * they are the two this file already makes for `methodologyVersion` above.
 *
 * The first is that the rebuild is not free of the rules. `summariseMeet` needs
 * a `MeetRules`, which is reconstructed from a published profile that may have
 * been republished or withdrawn -- so a history entry recomputed next season is
 * graded against a rounding the lifter never lifted under, and a meet whose
 * federation profile has gone produces no entry at all. That is the same drift
 * `#restoreReport` exists to *report*, arriving somewhere it would instead be
 * silent: the calibration would simply be built on fewer meets.
 *
 * The second is cost. A shelf holds up to `MEET_LIBRARY_MAX` meets, and a
 * derived reading would rebuild rules and a `PlannerView` for every one of them
 * on every calibration.
 *
 * WHY THERE IS NO MEET ID ON IT
 *
 * `HistoricMeet` carries one, and it is supplied by the caller assembling the
 * history rather than stored here: the saved meet's own `id` is the meet id, and
 * two identifiers that can disagree is one too many. This also sidesteps the
 * shape `summariseMeet` produces on its own, which is the rule profile and the
 * lifter joined together -- the same string for every meet one lifter runs under
 * one federation, which is a collision rather than an identifier.
 */
export interface SavedHistory {
  readonly equipment: HistoryEquipment;
  readonly lifts: readonly HistoricLift[];
}

/**
 * Everything the planner would have to be told to be where it was.
 *
 * `document` is `null` for a meet that has been planned and not started, which
 * is the state most saved meets sit in for the week before the meet -- and the
 * state §24.1 is mostly about, since it lists setup changes and attempt edits
 * before it lists anything that happens on a platform.
 *
 * WHAT IS NOT HERE
 *
 * **The undo history.** `MeetTimeline.past` holds a whole document per step, so
 * saving it would multiply the size of a meet by the number of taps taken during
 * it, on a store that is measured in hundreds of kilobytes -- and the value is
 * near nil, because an undo in live mode happens within seconds of the mistake
 * (`meet-document.ts` says so, and it is why there is no redo). A reload starts
 * a fresh timeline. §24.2's "restore the most recent state after an accidental
 * action" is the in-session undo that already exists; it is not a promise that
 * yesterday's taps can be walked back today.
 *
 * **The rules.** Rebuilt from `rulesProfileId` against the published profiles.
 *
 * **The plan and the targets.** `livePlanningFrom` and `liveTargetsFrom` are
 * pure functions of the session and the rule profile, both of which are here, so
 * saving their output would be storing a second copy of an answer this build can
 * derive -- and a second copy is a second thing that can disagree. What makes
 * that safe is not the purity on its own but `rulebookRevision` and
 * `methodologyVersion` beside it: a restore compares both against what is
 * published and what this build computes with, and says so when either has moved
 * rather than quietly handing back a plan that is no longer the one the lifter
 * agreed to. Saving the plan instead would hide the same drift, since the meet
 * would then be *running* on figures the current rules disagree with.
 *
 * **The clock.** `SubmissionCountdown` stores the instant it started, so a
 * countdown restored an hour later reports the truth -- that the minute is long
 * gone -- rather than resuming with fifty seconds left. That is a property of
 * the document and needs nothing here.
 *
 * **§20's warm-up schedule**, whose answers *are* here. The same distinction the
 * plan draws one bullet up, with a sharper edge on it: a restored plan computed
 * from stale rules is at least reported, and a restored schedule would simply be
 * a countdown that started yesterday. {@link SavedWarmup}.
 */
export interface SavedMeetState {
  readonly mode: SavedMode;
  readonly session: PlannerSession;
  readonly prep: SavedPrep;
  readonly document: MeetDocument | null;
  /** Solo mode's lifter within the document. `null` on a coach meet. */
  readonly lifterId: string | null;
  /** §21's per-device context. Saved with the meet now that the meet is saved. */
  readonly entries: readonly SavedCoachEntry[];
  readonly openLifterId: string | null;
  /**
   * §9.4's entry, once the day is over. `null` until then, and `null` for ever
   * on a coach meet -- those attempts belong to other people, and a phone that
   * folded three athletes into one "your history" would be a worse version of
   * the equipment mixture §9.4 exists to separate.
   */
  readonly history: SavedHistory | null;
  /**
   * §20's answers, or `null` where nobody has opened the fold. See
   * {@link SavedWarmup} for why the answers are here and the schedule is not.
   */
  readonly warmup: SavedWarmup | null;
  /**
   * §19's answers, or `null` where nobody has typed a record. See
   * {@link SavedRecords}, which reverses a decision shipped one release earlier
   * and says what the screen now owes a lifter in exchange.
   */
  readonly records: SavedRecords | null;
}

export const EMPTY_SAVED_STATE: SavedMeetState = {
  mode: 'solo',
  session: EMPTY_SESSION,
  prep: toSavedPrep(EMPTY_PREP),
  document: null,
  lifterId: null,
  entries: [],
  openLifterId: null,
  history: null,
  warmup: null,
  records: null,
};

export interface SavedMeet {
  readonly id: string;
  /** What the lifter calls it. Never blank -- every transition here refuses one. */
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** §24.2's archive: still here, off the resume list, never auto-saved into. */
  readonly archived: boolean;
  /** §30. The profile the meet was planned under, whatever is published today. */
  readonly rulesProfileId: string;
  readonly rulebookRevision: string;
  readonly methodologyVersion: string;
  readonly state: SavedMeetState;
}

/**
 * Every meet this device holds, and which one is open.
 *
 * `meets` is newest first and is never re-sorted afterwards. Most-recently-used
 * order is the tempting one and is wrong for the same reason a self-sorting
 * inbox is: auto-save runs on every keystroke, so the list the lifter is reading
 * would reorder under their thumb between one letter and the next.
 */
export interface MeetLibrary {
  readonly meets: readonly SavedMeet[];
  readonly activeMeetId: string | null;
  /** Behind ids and default names. Never decremented, so a deleted id is retired. */
  readonly nextOrdinal: number;
}

export const EMPTY_LIBRARY: MeetLibrary = { meets: [], activeMeetId: null, nextOrdinal: 1 };

/*
 * ---------------------------------------------------------------------------
 * Reading a library.
 * ---------------------------------------------------------------------------
 */

export function findMeet(library: MeetLibrary, id: string): SavedMeet | null {
  return library.meets.find((meet) => meet.id === id) ?? null;
}

/** The open meet, or `null`. An archived meet is never the open one. */
export function activeMeet(library: MeetLibrary): SavedMeet | null {
  if (library.activeMeetId === null) return null;
  const meet = findMeet(library, library.activeMeetId);
  if (meet === null || meet.archived) return null;
  return meet;
}

export function resumableMeets(library: MeetLibrary): readonly SavedMeet[] {
  return library.meets.filter((meet) => !meet.archived);
}

export function archivedMeets(library: MeetLibrary): readonly SavedMeet[] {
  return library.meets.filter((meet) => meet.archived);
}

/*
 * ---------------------------------------------------------------------------
 * Changing one.
 * ---------------------------------------------------------------------------
 */

export type LibraryRefusal =
  | 'unknown-meet'
  | 'name-required'
  | 'name-too-long'
  | 'library-full'
  /** The meet being written to has been archived, and an archive is read-only. */
  | 'meet-archived';

export type LibraryChange =
  | { readonly ok: true; readonly library: MeetLibrary }
  | { readonly ok: false; readonly reason: LibraryRefusal };

/** A name as it will be stored, or why it cannot be. */
export type NameReading =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: 'name-required' | 'name-too-long' };

/**
 * Trims, and refuses blank or overlong.
 *
 * Blank is refused rather than defaulted because a meet with no name is a row in
 * a list with nothing to tap, and every path that could produce one -- create,
 * rename, import -- has something better to fall back to that the caller knows
 * and this function does not.
 */
export function readMeetName(text: string): NameReading {
  const name = text.trim();
  if (name === '') return { ok: false, reason: 'name-required' };
  if (name.length > MEET_NAME_MAX) return { ok: false, reason: 'name-too-long' };
  return { ok: true, name };
}

export interface NewMeet {
  readonly name: string;
  readonly now: number;
  readonly rulesProfileId: string;
  readonly rulebookRevision: string;
  readonly state: SavedMeetState;
}

/**
 * Adds a meet and opens it.
 *
 * The id is `meet-<n>` from the library's own counter rather than anything drawn
 * from a clock or a random source: this module is pure, both of those would make
 * it not, and an ordinal is what every other id in this tool already is
 * (`meet-document.ts`, `prep.ts`). It is unique within a library, which is the
 * only place it has to be -- an import from another device is renumbered on the
 * way in, and `importMeets` below is where that happens.
 */
export function createMeet(library: MeetLibrary, meet: NewMeet): LibraryChange {
  if (library.meets.length >= MEET_LIBRARY_MAX) return { ok: false, reason: 'library-full' };
  const name = readMeetName(meet.name);
  if (!name.ok) return { ok: false, reason: name.reason };

  const id = `meet-${String(library.nextOrdinal)}`;
  const saved: SavedMeet = {
    id,
    name: name.name,
    createdAt: meet.now,
    updatedAt: meet.now,
    archived: false,
    rulesProfileId: meet.rulesProfileId,
    rulebookRevision: meet.rulebookRevision,
    methodologyVersion: SAVED_MEET_METHODOLOGY_VERSION,
    state: meet.state,
  };
  return {
    ok: true,
    library: {
      meets: [saved, ...library.meets],
      activeMeetId: id,
      nextOrdinal: library.nextOrdinal + 1,
    },
  };
}

function replace(library: MeetLibrary, id: string, next: SavedMeet): MeetLibrary {
  return {
    ...library,
    meets: library.meets.map((meet) => (meet.id === id ? next : meet)),
  };
}

/**
 * §24.1's auto-save: the open meet's state, and the instant it changed.
 *
 * Refuses an archived meet rather than quietly un-archiving it or writing
 * through. An archive is the lifter's statement that the meet is over, and the
 * screen behind an archived meet is still live -- so without the refusal, one
 * stray keystroke on a screen nobody meant to be editing rewrites a completed
 * meet's record of itself.
 *
 * The rules profile and the methodology are deliberately not touched. See the
 * module header: they are what the meet was planned under, not what this build
 * happens to be running.
 */
export function saveMeetState(
  library: MeetLibrary,
  id: string,
  state: SavedMeetState,
  now: number,
): LibraryChange {
  const meet = findMeet(library, id);
  if (meet === null) return { ok: false, reason: 'unknown-meet' };
  if (meet.archived) return { ok: false, reason: 'meet-archived' };
  return { ok: true, library: replace(library, id, { ...meet, state, updatedAt: now }) };
}

export function renameMeet(library: MeetLibrary, id: string, text: string): LibraryChange {
  const meet = findMeet(library, id);
  if (meet === null) return { ok: false, reason: 'unknown-meet' };
  const name = readMeetName(text);
  if (!name.ok) return { ok: false, reason: name.reason };
  return { ok: true, library: replace(library, id, { ...meet, name: name.name }) };
}

/**
 * §24.2's duplicate, which opens the copy rather than the original.
 *
 * The copy is created now and has never been changed, so both stamps are `now`;
 * keeping the original's `createdAt` would put a meet at the bottom of a
 * date-ordered list on the day it was made. Its methodology stamp is the
 * *original's*, not this build's -- a duplicate is a copy of a plan, and
 * relabelling it as having been made under today's reading would be the one
 * claim §30 asks this file to keep straight.
 *
 * The copy is never archived even when the original is, which is most of why
 * anybody duplicates one: last meet's setup and checklist as the starting point
 * for the next.
 */
export function duplicateMeet(
  library: MeetLibrary,
  id: string,
  name: string,
  now: number,
): LibraryChange {
  const meet = findMeet(library, id);
  if (meet === null) return { ok: false, reason: 'unknown-meet' };
  if (library.meets.length >= MEET_LIBRARY_MAX) return { ok: false, reason: 'library-full' };
  const reading = readMeetName(name);
  if (!reading.ok) return { ok: false, reason: reading.reason };

  const copyId = `meet-${String(library.nextOrdinal)}`;
  const copy: SavedMeet = {
    ...meet,
    id: copyId,
    name: reading.name,
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
  return {
    ok: true,
    library: {
      meets: [copy, ...library.meets],
      activeMeetId: copyId,
      nextOrdinal: library.nextOrdinal + 1,
    },
  };
}

/**
 * Archives or unarchives, and closes the meet if it was the open one.
 *
 * Closing is not tidiness: `saveMeetState` refuses an archived meet, so a
 * library that archived the open meet and left it open would drop every
 * subsequent auto-save on the floor while the screen carried on as normal.
 */
export function archiveMeet(library: MeetLibrary, id: string, archived: boolean): LibraryChange {
  const meet = findMeet(library, id);
  if (meet === null) return { ok: false, reason: 'unknown-meet' };
  const moved = replace(library, id, { ...meet, archived });
  const closing = archived && library.activeMeetId === id;
  return { ok: true, library: closing ? { ...moved, activeMeetId: null } : moved };
}

/** §24.2's delete. The confirmation is the screen's job; this is the deletion. */
export function deleteMeet(library: MeetLibrary, id: string): LibraryChange {
  if (findMeet(library, id) === null) return { ok: false, reason: 'unknown-meet' };
  return {
    ok: true,
    library: {
      ...library,
      meets: library.meets.filter((meet) => meet.id !== id),
      activeMeetId: library.activeMeetId === id ? null : library.activeMeetId,
    },
  };
}

/** §24.2's resume. An archived meet is unarchived by being resumed, not opened shut. */
export function openMeet(library: MeetLibrary, id: string): LibraryChange {
  const meet = findMeet(library, id);
  if (meet === null) return { ok: false, reason: 'unknown-meet' };
  const opened = meet.archived ? replace(library, id, { ...meet, archived: false }) : library;
  return { ok: true, library: { ...opened, activeMeetId: id } };
}

/** Leaves every meet where it is and opens none of them. */
export function closeMeet(library: MeetLibrary): MeetLibrary {
  return { ...library, activeMeetId: null };
}

/*
 * ---------------------------------------------------------------------------
 * §24.4: taking meets in from somewhere else.
 * ---------------------------------------------------------------------------
 */

/**
 * What one incoming meet would do, decided before anything is changed.
 *
 * §24.4 asks for a preview and for no silent overwriting, and those are one
 * requirement: the preview is what makes the absence of an overwrite visible.
 * A meet whose id is already here is `'conflict'`, and a conflict is added as a
 * copy under a fresh id -- never merged, never written over. Two devices that
 * both numbered their first meet `meet-1` is the ordinary case, not the
 * adversarial one, so a conflict says almost nothing about whether the two are
 * the same meet and the tool must not pretend otherwise.
 */
export type ImportDisposition = 'new' | 'conflict';

export interface ImportEntry {
  readonly meet: SavedMeet;
  readonly disposition: ImportDisposition;
  /** The name it would be filed under, which is the incoming one either way. */
  readonly name: string;
}

export interface ImportPreview {
  readonly entries: readonly ImportEntry[];
  /** How many of them there is no room for. Zero unless the library is nearly full. */
  readonly overflow: number;
}

/** What an import would do, without doing any of it. */
export function previewImport(library: MeetLibrary, incoming: readonly SavedMeet[]): ImportPreview {
  const entries = incoming.map((meet) => ({
    meet,
    disposition: findMeet(library, meet.id) === null ? ('new' as const) : ('conflict' as const),
    name: meet.name,
  }));
  const room = Math.max(0, MEET_LIBRARY_MAX - library.meets.length);
  return { entries, overflow: Math.max(0, entries.length - room) };
}

export interface ImportOutcome {
  readonly library: MeetLibrary;
  /** How many were filed. */
  readonly added: number;
  /** How many were filed under a new id because theirs was taken. */
  readonly renumbered: number;
  /** How many did not fit. Never silently: the screen says so. */
  readonly skipped: number;
}

/**
 * Files the previewed meets, renumbering every one of them.
 *
 * *Every* one, not only the conflicts. An incoming id is a counter from another
 * device and this library's `nextOrdinal` has to stay ahead of everything in it;
 * accepting a foreign `meet-9` into a library whose counter is at 3 makes the
 * next six meets created here collide with it. Renumbering unconditionally means
 * the counter is the only thing that ever issues an id, which is the invariant
 * that makes `createMeet` correct.
 *
 * `renumbered` counts only the conflicts, because that is the number worth
 * reporting: it is how many incoming meets found a namesake here, and §24.4's
 * "offer to create a duplicate when identifiers conflict" is what the screen
 * does with it.
 *
 * Nothing is opened. An import is filing, not resuming -- a lifter importing a
 * backup at a meet must not have the screen they are working on replaced.
 */
export function importMeets(library: MeetLibrary, preview: ImportPreview): ImportOutcome {
  let next = library;
  let added = 0;
  let renumbered = 0;
  let skipped = 0;

  for (const entry of preview.entries) {
    if (next.meets.length >= MEET_LIBRARY_MAX) {
      skipped += 1;
      continue;
    }
    const id = `meet-${String(next.nextOrdinal)}`;
    const filed: SavedMeet = { ...entry.meet, id, name: entry.name, archived: entry.meet.archived };
    next = {
      ...next,
      meets: [filed, ...next.meets],
      nextOrdinal: next.nextOrdinal + 1,
    };
    added += 1;
    if (entry.disposition === 'conflict') renumbered += 1;
  }

  return { library: next, added, renumbered, skipped };
}
