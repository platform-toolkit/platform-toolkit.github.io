// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The logbook as a document somebody can read without this tool. Section 10.5.
 *
 * WRITTEN AND NEVER READ
 *
 * Section 10.5's first line is that Markdown is a readable record and not an import
 * format, and that is a rule about this file rather than a note about it: there is no
 * parser here and there is not going to be one. The JSON backup is the file that
 * restores, and it is validated at a trust boundary before a single field of it is
 * believed. A Markdown reader would be a second boundary with none of that behind it,
 * built to read a format that has no version stamp and no envelope -- which is why the
 * document says so at the top, where somebody deciding which file to keep will see it.
 *
 * WHY THIS IS NOT IN `core/`
 *
 * Because it is a rendering, and the two things it renders with already live here. It
 * reads its words from `copy.ts` and its set shorthand from `format.ts`, and a copy of
 * either under `core/` would be a second definition of what an assisted set looks like
 * -- exactly the drift `format.ts`'s own header exists to prevent, and worse here,
 * because the two would be a screen and a file disagreeing about the same lift. Nothing
 * below touches the DOM; the element hands the string to the browser.
 *
 * WHAT THE DOCUMENT PROMISES
 *
 * That it holds what was recorded. Three consequences, each of which is a decision:
 *
 * - **Every workout prints, and one that is not finished says so in its heading.**
 *   Section 10.5 asks for the active workout to be labelled; a draft and a discarded
 *   session need the same label for the same reason, and `WORKOUT_STATUSES` already has
 *   all four words. Dropping them instead would be a readable record quietly missing
 *   the sessions a lifter planned and the ones they threw away.
 * - **Weights print as recorded and are never converted**, which `formatLoad` enforces
 *   and section 11.4 requires. The display unit is stated in the header as a fact about
 *   the device, not applied to the numbers below it.
 * - **A note is never truncated or reflowed.** A one-line note goes inline the way
 *   section 10.5's example writes it, and a longer one becomes a blockquote so its own
 *   line breaks survive. A record that silently discarded half a note would be worse
 *   than one that never carried notes at all.
 *
 * Dates are the lifter's own `localDate`, printed as the ISO day it is stored as. Every
 * screen in this tool prints an ISO day and there is no month-name formatter anywhere in
 * the package; inventing one here would make the file disagree with the tool that wrote
 * it, in a document whose whole job is to be checked against memory.
 */

import { describeRack } from '@platform-toolkit/domain';

import type { TrainingLogbookBackup } from '../core/backup.js';
import {
  searchExerciseHistory,
  type ExerciseHistorySearch,
  type ExerciseMarker,
} from '../core/records.js';
import { byMostRecent, summarize, type WorkoutSummary } from '../core/summary.js';
import type {
  EquipmentSnapshot,
  SetPerformance,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from '../types.js';

import {
  MARKDOWN_NOTES,
  RECORDS_NOTES,
  SET_KINDS,
  SET_STATUSES,
  UNIT_LABELS,
  WORKOUT_STATUSES,
  formatDuration,
} from './copy.js';
import { formatEffort, formatPerformance } from './format.js';

/**
 * The document's own name, declared here rather than derived from `BACKUP_FORMAT`.
 *
 * The two strings share a stem and are not the same kind of thing. `BACKUP_FORMAT` is a
 * format identifier written inside the JSON file and checked by `v.literal` on the way
 * back in; this is a suggested filename and nothing reads it. Deriving one from the
 * other -- by trimming a `-backup` suffix, say -- would tie a wire constant to a
 * cosmetic one and make renaming the file rename the format.
 */
const DOCUMENT_NAME = 'platform-toolkit-training-logbook';

/** The suggested filename for a document written on a given calendar day. */
export function markdownFilename(localDate: string): string {
  return `${DOCUMENT_NAME}-${localDate}.md`;
}

/** One row of a Markdown table. */
function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

const HEADER = row([
  MARKDOWN_NOTES.columns.kind,
  MARKDOWN_NOTES.columns.planned,
  MARKDOWN_NOTES.columns.performed,
  MARKDOWN_NOTES.columns.effort,
  MARKDOWN_NOTES.columns.status,
]);

/** The three numeric columns right-aligned, as section 10.5's example has them. */
const DELIMITER = row(['---', '---:', '---:', '---:', '---']);

/**
 * A heading's worth of a string the lifter typed.
 *
 * Collapsed to one line because a heading is one line: a newline inside a workout title
 * would end the heading and leave the rest of the title as body text. Only headings go
 * through this. Notes do not, and that difference is the point of {@link noteLines}.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * A note, in whichever of two shapes fits what was written.
 *
 * Inline while it is one line, which is how section 10.5's example writes it and how
 * nearly every note in a logbook is written. A note with a line break in it becomes a
 * blockquote instead, one prefix per line and blank lines kept as bare `>`, so its
 * paragraphs survive. Collapsing it to a single line would be readable and lossy, and
 * this file's whole claim is that it holds what was recorded.
 */
function noteLines(label: string, note: string): readonly string[] {
  const lines = note.split('\n').map((line) => line.trimEnd());
  while (lines.length > 0 && lines[0] === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const [only] = lines;
  if (only === undefined) return [];
  if (lines.length === 1) return [`**${label}:** ${only}`];
  return [`**${label}:**`, '', ...lines.map((line) => (line === '' ? '>' : `> ${line}`))];
}

/** A cell with nothing to say in it. */
function cell(value: string | null): string {
  return value ?? MARKDOWN_NOTES.blank;
}

/**
 * A planned or performed set, or a dash.
 *
 * Not {@link formatPerformance} straight, because its answer for `null` is "Not set" --
 * a screen's way of telling a lifter they have not typed something yet, which is a
 * different sentence from a finished record having nothing under a column.
 */
function performanceCell(performance: SetPerformance | null): string {
  return performance === null ? MARKDOWN_NOTES.blank : formatPerformance(performance);
}

/**
 * What became of a set, with any marks it earned.
 *
 * The marks go on the status rather than in a column of their own. A sixth column would
 * be empty on all but a handful of rows in a whole logbook, and section 10.5 asks for
 * best markers *only when meaningful* -- which is a statement about how often they
 * appear, and therefore about how much of the table they should cost.
 */
function statusCell(set: WorkoutSet, markers: readonly ExerciseMarker[]): string {
  const status = SET_STATUSES[set.status];
  if (markers.length === 0) return status;
  return `${status} (${markers.map((marker) => RECORDS_NOTES.markers[marker]).join(', ')})`;
}

function setRow(set: WorkoutSet, markers: readonly ExerciseMarker[]): string {
  return row([
    SET_KINDS[set.kind],
    performanceCell(set.planned),
    performanceCell(set.performed),
    cell(set.performed === null ? null : formatEffort(set.performed.effort)),
    statusCell(set, markers),
  ]);
}

function exerciseLines(
  exercise: WorkoutExercise,
  marked: ReadonlyMap<string, readonly ExerciseMarker[]>,
): readonly string[] {
  const lines: string[] = [`### ${oneLine(exercise.displayName)}`, ''];

  if (exercise.note !== null) lines.push(...noteLines(MARKDOWN_NOTES.note, exercise.note), '');

  lines.push(HEADER, DELIMITER);
  for (const set of exercise.sets) lines.push(setRow(set, marked.get(set.id) ?? []));
  lines.push('');

  // Under the table rather than in it. A note is a sentence and the cells are numbers,
  // and a sentence in a cell either wraps the column to uselessness or gets cut.
  for (const [index, set] of exercise.sets.entries()) {
    if (set.note === null) continue;
    lines.push(...noteLines(MARKDOWN_NOTES.setLabel(index + 1), set.note), '');
  }

  return lines;
}

/** The day, what the lifter called it, and -- unless it is finished -- what it is. */
function workoutHeading(session: WorkoutSession): string {
  const title = session.title === null ? null : oneLine(session.title);
  const named =
    title === null || title === '' ? session.localDate : `${session.localDate} -- ${title}`;
  return session.status === 'completed'
    ? `## ${named}`
    : `## ${named} (${WORKOUT_STATUSES[session.status]})`;
}

function workoutLines(
  session: WorkoutSession,
  summary: WorkoutSummary,
  marked: ReadonlyMap<string, readonly ExerciseMarker[]>,
): readonly string[] {
  const lines: string[] = [workoutHeading(session), ''];

  const duration = summary.durationMillis;
  if (duration !== null) {
    lines.push(`**${MARKDOWN_NOTES.duration}:** ${formatDuration(duration)}`, '');
  }
  if (session.note !== null) lines.push(...noteLines(MARKDOWN_NOTES.note, session.note), '');

  for (const exercise of session.exercises) lines.push(...exerciseLines(exercise, marked));

  return lines;
}

/**
 * Every marked set in the document, by set id.
 *
 * The same walk the history screen makes, run once per exercise the file mentions, so
 * the marks in the document are the marks the tool shows -- section 9.2's five
 * exclusions, its tie-goes-to-the-older-set rule and its `MIN_GROUP` of two, none of
 * which are restated here. Between them they are what makes section 10.5's *only when
 * meaningful* true without a judgement call being made in this file: one heaviest set
 * per load kind per exercise across a whole history, and nothing at all for a group of
 * one, so a marked row is rare by construction rather than by a rule invented here.
 *
 * `limit` is the whole feed because the document is the whole history. The default of
 * twenty is a screen's budget, and a marker stitched onto a set that fell off the end of
 * that list would be one this walk never returns.
 *
 * **A session goes only to the searches for the lifts it contains.** Offering every
 * session to every search is what the shape suggests, and it costs one call per exercise
 * in the file per session -- three years and sixty movements is tens of thousands of
 * them, to reach a `take` that discards all but a handful on its first line. Routing is
 * safe rather than merely cheaper: `take` opens by discarding a session with no block for
 * its exercise, so a session withheld from a search is one that search would have thrown
 * away, and the day buffering is unaffected because a discarded session contributes
 * nothing to the day it was buffered in.
 *
 * Sessions must arrive newest day first, which is what `consider` buffers on. That is
 * the order they are printed in too, except for the active workout -- see the caller.
 */
function markersBySet(
  sessions: readonly WorkoutSession[],
): ReadonlyMap<string, readonly ExerciseMarker[]> {
  const searches = new Map<string, ExerciseHistorySearch>();

  for (const session of sessions) {
    const routed = new Set<string>();
    for (const exercise of session.exercises) {
      const id = exercise.exerciseId;
      // Squats at the front and back-offs at the end are two blocks and one session.
      // `take` already reads every block it finds, so a second `consider` would keep
      // the day twice and print the same sets under two entries.
      if (routed.has(id)) continue;
      routed.add(id);

      let search = searches.get(id);
      if (search === undefined) {
        // Built where the lift is first met rather than up front, which is the same
        // list of searches: the feed is newest first, so nothing older is missed.
        search = searchExerciseHistory(id, { limit: sessions.length });
        searches.set(id, search);
      }
      search.consider(session);
    }
  }

  const marked = new Map<string, readonly ExerciseMarker[]>();
  for (const search of searches.values()) {
    for (const session of search.history().sessions) {
      for (const set of session.sets) {
        if (set.markers.length > 0) marked.set(set.id, set.markers);
      }
    }
  }
  return marked;
}

function equipmentLine(equipment: EquipmentSnapshot | null): string {
  if (equipment === null) return MARKDOWN_NOTES.noEquipment;
  return describeRack(equipment.plateUnit, equipment.barWeight, equipment.collarWeight);
}

/** A session and its summary, kept together so neither is looked up by id twice. */
interface Entry {
  readonly session: WorkoutSession;
  readonly summary: WorkoutSummary;
}

/**
 * The whole logbook as one Markdown document.
 *
 * Takes the backup rather than the repository: the snapshot is already the shape that
 * holds everything on the device, it is already what the JSON download is built from,
 * and reading the database twice for two files taken in one press would let them
 * disagree about a workout finished in between.
 */
export function markdownExport(backup: TrainingLogbookBackup): string {
  const { data } = backup;
  const active = data.activeWorkout;

  // The snapshot keeps the unfinished workout in its own field, so it is added here --
  // guarded, because a file that carried it in both places would otherwise print it
  // twice and count it twice.
  const all =
    active === null || data.workouts.some((workout) => workout.id === active.id)
      ? data.workouts
      : [active, ...data.workouts];

  const dated: Entry[] = all.map((session) => ({ session, summary: summarize(session) }));
  dated.sort((left, right) => byMostRecent(left.summary, right.summary));

  // Printed first, because "what I am in the middle of" is the one thing a lifter opens
  // this file for that is not history. Almost always today's session and therefore
  // already first; the hoist is for the evening after midnight, where it is not.
  const printed =
    active === null
      ? dated
      : [
          ...dated.filter((entry) => entry.session.id === active.id),
          ...dated.filter((entry) => entry.session.id !== active.id),
        ];

  // Date order rather than the printed one, though today the two fold identically: the
  // only session the hoist moves is the active one, and section 9.2's first exclusion
  // means `consider` discards it unread. Handing over the date order anyway costs a
  // `map` and keeps this correct on the day that exclusion changes -- `consider` buffers
  // by day to settle ties, and a session arriving out of order is one whose day it has
  // already closed.
  const marked = markersBySet(dated.map((entry) => entry.session));

  const lines: string[] = [
    `# ${MARKDOWN_NOTES.title}`,
    '',
    MARKDOWN_NOTES.preamble,
    '',
    `- **${MARKDOWN_NOTES.exported}:** ${backup.exportedAt}`,
    `- **${MARKDOWN_NOTES.unit}:** ${UNIT_LABELS[data.settings.displayUnit]}`,
    `- **${MARKDOWN_NOTES.equipment}:** ${equipmentLine(data.settings.equipment)}`,
    `- **${MARKDOWN_NOTES.workouts}:** ${String(printed.length)}`,
    `- **${MARKDOWN_NOTES.writtenBy}:** ${backup.applicationVersion}`,
    '',
  ];

  if (printed.length === 0) lines.push(MARKDOWN_NOTES.empty, '');
  for (const entry of printed) lines.push(...workoutLines(entry.session, entry.summary, marked));

  return `${lines.join('\n').trimEnd()}\n`;
}
