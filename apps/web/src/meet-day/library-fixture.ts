// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One shelf of saved meets, shared by the library element's stories and tests.
 *
 * Built by walking `createMeet` and the other transitions rather than by writing
 * `SavedMeet` literals, for the reason `live-fixture.ts` builds a timeline
 * through `applyMeetAction`: a literal can hold a shelf the transitions cannot
 * produce -- an archived meet that is also the open one, two meets with the same
 * id, a counter behind the ids it has already issued -- and a screen tested
 * against one of those is a screen proved to cope with something that will never
 * arrive.
 *
 * The instants are fixed constants and nothing here reads a clock. A fixture
 * stamped with `Date.now()` documents a different shelf every time it is opened,
 * and the story snapshot changes on a schedule nobody chose.
 */
import type { HistoricLift, HistoryEquipment } from '@platform-toolkit/domain';

import { liftsOfAMeet, liftsOfAWrappedMeet } from './calibration-fixture.js';
import {
  EMPTY_LIBRARY,
  EMPTY_SAVED_STATE,
  archiveMeet,
  createMeet,
  type MeetLibrary,
  type SavedMeet,
  type SavedMeetState,
} from './saved-meet.js';

/**
 * The instant the oldest meet on the shelf was created.
 *
 * An invented figure, like every other number in a fixture here (§5.1), and far
 * enough in the past that the four meets below can be a fortnight apart without
 * any of them landing in the future.
 */
export const FIRST_INSTANT = 1_770_000_000_000;

const DAY = 86_400_000;

/** The rule book every meet on this shelf was planned under. */
const PROFILE_ID = 'fixture-federation-2026';
const REVISION = 'fixture-2026-01';

/**
 * Adds one meet, or throws.
 *
 * The transitions report a refusal rather than throwing, which is right for the
 * screen and wrong for a fixture: a shelf that quietly came out one meet short
 * would leave every assertion below measuring a screen nobody meant to build.
 */
function add(library: MeetLibrary, name: string, now: number, state?: SavedMeetState): MeetLibrary {
  const change = createMeet(library, {
    name,
    now,
    rulesProfileId: PROFILE_ID,
    rulebookRevision: REVISION,
    state: state ?? EMPTY_SAVED_STATE,
  });
  if (!change.ok) throw new Error(`The fixture could not add "${name}": ${change.reason}.`);
  return change.library;
}

function archive(library: MeetLibrary, meetId: string): MeetLibrary {
  const change = archiveMeet(library, meetId, true);
  if (!change.ok) throw new Error(`The fixture could not archive "${meetId}": ${change.reason}.`);
  return change.library;
}

/**
 * Four meets: two to come back to, two already run.
 *
 * The names are venues and dates rather than people, which is what a lifter
 * actually types and also what keeps the fixture clear of anything that reads
 * like an athlete's identity (§2.3).
 */
export function aShelf(): MeetLibrary {
  let library = EMPTY_LIBRARY;
  library = add(library, 'Winter Open', FIRST_INSTANT);
  library = add(library, 'Spring Classic', FIRST_INSTANT + 14 * DAY);
  library = add(library, 'Summer Nationals', FIRST_INSTANT + 28 * DAY);
  library = add(library, 'Autumn Qualifier', FIRST_INSTANT + 42 * DAY);
  // The two oldest are done. Neither was the open one -- `createMeet` opens what
  // it adds, so the newest is -- which is why nothing here has to reopen it: an
  // archive that closed the shelf would leave a lifter looking at a screen with
  // no meet behind it, and that state belongs in a test rather than in the
  // fixture every other assertion starts from.
  library = archive(library, 'meet-1');
  library = archive(library, 'meet-2');
  return library;
}

/** One meet, which is the shelf a lifter has after their first visit. */
export function oneMeet(): MeetLibrary {
  return add(EMPTY_LIBRARY, 'Winter Open', FIRST_INSTANT);
}

function withHistory(equipment: HistoryEquipment, lifts: readonly HistoricLift[]): SavedMeetState {
  return { ...EMPTY_SAVED_STATE, history: { equipment, lifts } };
}

/**
 * Three finished meets and nothing open: a shelf as §9.4 reads one.
 *
 * **Every meet is archived, and that is load-bearing rather than tidy.** The
 * planner adopts whatever meet a shelf has open and assigns that meet's saved
 * session over the answers on screen, so a shelf seeded purely as history with
 * one meet still open would silently replace the federation and the equipment a
 * caller had just pressed -- and every assertion afterwards would be measuring a
 * screen nobody built. Archiving hides nothing from a calibration: `history.ts`
 * is explicit that an archived meet still counts, because §24.2's archive is how
 * a lifter tidies a shelf rather than how they disown a season.
 *
 * Two raw and one under wraps, so a raw scope reads two and reports one left
 * out. The lifts come from `calibration-fixture.ts` rather than being written
 * here, so a figure on the panel is one that fixture's own suite already reads
 * -- a second history built by hand would be a fixture nothing checks against
 * the domain, producing figures that could not be compared with anything.
 */
export function aShelfOfHistory(): MeetLibrary {
  let library = EMPTY_LIBRARY;
  library = add(library, 'Winter Open', FIRST_INSTANT, withHistory('raw', liftsOfAMeet()));
  library = add(
    library,
    'Spring Classic',
    FIRST_INSTANT + 14 * DAY,
    withHistory('raw', liftsOfAMeet()),
  );
  library = add(
    library,
    'Summer in Wraps',
    FIRST_INSTANT + 28 * DAY,
    withHistory('wraps', liftsOfAWrappedMeet()),
  );
  // Read before the loop rather than iterated live: `archive` answers a new
  // library each time, and walking the array off the one being replaced is the
  // kind of correct-by-accident that stops being correct the day a transition
  // reorders the shelf.
  const ids = library.meets.map((meet) => meet.id);
  for (const id of ids) library = archive(library, id);
  return library;
}

/** The meet with that id, or a thrown sentence naming the shelf's ids. */
export function meetOn(library: MeetLibrary, meetId: string): SavedMeet {
  const found = library.meets.find((meet) => meet.id === meetId);
  if (found === undefined) {
    throw new Error(
      `No meet "${meetId}" on this shelf. It holds: ${library.meets
        .map((meet) => meet.id)
        .join(', ')}.`,
    );
  }
  return found;
}
