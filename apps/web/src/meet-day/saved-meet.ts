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
 * Most of it is the live types, and where it is, it says so. Three places it is
 * not, and each of them is the reason the split exists at all:
 *
 * - `MeetPrep.done` is a `ReadonlySet`, which `JSON.stringify` writes as `{}`.
 *   A set saved that way is not corrupt and does not throw: it comes back empty,
 *   so a lifter reopens the tool to a checklist with every tick gone and no
 *   evidence that anything failed.
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
import {
  ATTEMPT_PLAN_METHODOLOGY_VERSION,
  type CoachBoardEntry,
  type MeetDocument,
} from '@platform-toolkit/domain';

import { EMPTY_PREP, type CustomChecklistItem, type LifterSetup, type MeetPrep } from './prep.js';
import { EMPTY_SESSION, type PlannerSession } from './session.js';

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
 * There is no rebuild to perform. Nothing in this tool sets the field today --
 * §20's warm-up screen is the follow-up that will -- so a restored board has no
 * schedule for the same reason a fresh one has none, and the omission costs
 * nothing that reopening a meet does not already cost. When that screen lands,
 * this stays an omission: a ramp is counted from the platform estimate at the
 * instant it is asked for, which is the one thing a saved document cannot hold.
 */
export type SavedCoachEntry = Omit<CoachBoardEntry, 'warmup'>;

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
}

export const EMPTY_SAVED_STATE: SavedMeetState = {
  mode: 'solo',
  session: EMPTY_SESSION,
  prep: toSavedPrep(EMPTY_PREP),
  document: null,
  lifterId: null,
  entries: [],
  openLifterId: null,
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
