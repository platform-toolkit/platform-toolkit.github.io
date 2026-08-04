// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The shelf, read as §9.4's history.
 *
 * `summary.ts` files one meet's entry and `saved-meet.ts` stores it; the domain's
 * `calibrateFrom` reads a list of them. This module is the join: it turns the meets
 * on a device into that list and asks the question. Pure, like the other six
 * builders in this directory -- no DOM, no clock, no storage, nothing kept between
 * calls.
 *
 * WHY IT TAKES MEETS AND NOT A LIBRARY, AND THEN A LIBRARY AS WELL
 *
 * {@link historicMeetsIn} takes an array so a caller can decide what is in the
 * comparison before asking -- which is the whole of {@link calibrateLibrary}'s
 * `exceptMeetId`, and would otherwise be a filter written again at each call site
 * against a shape (`MeetLibrary`) that also carries which meet is open.
 *
 * WHY THE MEET BEING LOOKED AT IS EXCLUDED
 *
 * §26's summary screen is where this is first rendered, directly under the reading
 * of the meet that has just finished -- and that meet's entry is on the shelf by
 * then, because `#savedState()` files it the moment the day is over. Left in, the
 * calibration beside the summary would be partly a reading of the summary above it:
 * a lifter's first meet would produce a full set of figures with `MEETS_BEFORE_A_TREND`
 * satisfied by the meet they are looking at, and every figure in it would be that
 * meet's own numbers handed back as though they were a pattern. Excluding it makes
 * the panel answer the question it appears to answer -- what the meets *before* this
 * one say -- and makes an empty answer the honest one for a first meet.
 *
 * WHAT IS NOT FILTERED
 *
 * **Archived meets count.** §24.2's archive is how a lifter tidies a shelf, not how
 * they disown a meet: a season put away in March is exactly the history §9.4 wants
 * read in June, and a calibration that silently shrank when somebody tidied up would
 * be a figure moving for a reason nobody could see.
 *
 * **Meets under other federations count.** `#restoreReport` cares which rule book a
 * meet was run under because it is about restoring a plan; §9.4's scope axis is
 * equipment and nothing else, and dropping a lifter's meets under a second
 * federation would answer "your typical jump" from half their record without saying
 * so. Where the rules genuinely differ, the figure it moves is the jump -- which is
 * a fact about the lifter, measured in kilograms, not a fact about the rounding.
 */
import {
  calibrateFrom,
  type CalibrationReport,
  type HistoricMeet,
  type HistoryScope,
} from '@platform-toolkit/domain';

import type { MeetLibrary, SavedMeet } from './saved-meet.js';

/**
 * The meets on a shelf that have a §9.4 entry, oldest first.
 *
 * A meet with no entry is absent rather than present and empty: `calibrateFrom`
 * counts what it is given as meets read, so a planned-but-never-contested meet
 * would push a history over `MEETS_BEFORE_A_TREND` while contributing no
 * observation to any figure in it.
 *
 * **`meetId` is the saved meet's own id**, which is the reason `SavedHistory` does
 * not carry one -- `saved-meet.ts` says so at length. Supplying it here is what
 * keeps the two from being able to disagree.
 *
 * **Oldest first, by `createdAt` rather than by shelf position.** The shelf is
 * newest-first and never re-sorted, so reversing it would be enough for meets made
 * on this device -- but an imported meet lands where the import put it, which is
 * when the file was read and not when the meet was contested. The order is not
 * cosmetic: `calibrateFrom` reports lifts in the order it first sees them, so a
 * report built from shelf order reads in the order of the lifter's most recent
 * meet's lifts, which for a bench-only meet is a report that opens on the bench.
 */
export function historicMeetsIn(meets: readonly SavedMeet[]): readonly HistoricMeet[] {
  // Copied before sorting: `sort` is in place, and the shelf is the store's own
  // array -- reordering it here would change what `ptk-meet-library` lists.
  const ordered = [...meets].sort((left, right) => left.createdAt - right.createdAt);

  const history: HistoricMeet[] = [];
  for (const meet of ordered) {
    const entry = meet.state.history;
    if (entry === null) continue;
    history.push({ meetId: meet.id, equipment: entry.equipment, lifts: entry.lifts });
  }
  return history;
}

export interface CalibrationRequest {
  /**
   * The meet the screen is about, left out of its own comparison. `null` for a
   * caller with no meet on screen -- a shelf being reviewed, rather than a day
   * being read.
   */
  readonly exceptMeetId: string | null;
  readonly scope: HistoryScope;
}

/**
 * §9.4 across a device's whole shelf.
 *
 * Answers `NO_CALIBRATION`'s shape through `calibrateFrom` for an empty history
 * rather than short-circuiting, so `scope` on the report is the scope that was
 * asked about in every case -- a screen printing "raw meets only" off the report
 * would otherwise print `unstated` for the lifter with no history, which is the one
 * lifter most likely to wonder why there is nothing there.
 */
export function calibrateLibrary(
  library: MeetLibrary,
  request: CalibrationRequest,
): CalibrationReport {
  const meets =
    request.exceptMeetId === null
      ? library.meets
      : library.meets.filter((meet) => meet.id !== request.exceptMeetId);
  return calibrateFrom(historicMeetsIn(meets), request.scope);
}
