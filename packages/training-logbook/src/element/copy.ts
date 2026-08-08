// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Every sentence this tool says, in one file.
 *
 * The same construction as tool 9's `copy.ts`, and here it carries two rules that
 * are enforced by vocabulary or not at all.
 *
 * **The logbook does not coach.** Sections 15.3 and 16.1. A missed set is recorded
 * and not scored; nothing on any screen says a session was good, bad, easy, hard,
 * ahead, behind, or on track. Those words are how a record turns into advice, and
 * advice is a different tool with a different burden of proof. Collected here, the
 * whole vocabulary can be read in one pass and a test can assert against the words
 * that must never appear.
 *
 * **The lifter is told where their training lives.** Section 18.9 turns one phrase
 * into an acceptance test: a completed set that showed **Saved on this device** must
 * still be there after a refresh, a tab close, an app switch, a PWA restart, a
 * service-worker update and a route change. {@link SAVE_STATES} owns that phrase, and
 * it is exported rather than inlined so the browser test asserts on the same constant
 * the screen renders.
 *
 * Nothing here interpolates a weight or a rep count. Numbers are formatted where they
 * are rendered, so a sentence cannot silently acquire a rounding rule.
 */

import type { WarmupFamily, WeightUnit } from '@platform-toolkit/domain';

import type { FinishDisposition } from '../core/session.js';
import type {
  EffortScale,
  EffortSetting,
  LoadingModel,
  SetKind,
  SetStatus,
  WorkoutStatus,
} from '../types.js';

/**
 * How durable this device's storage turned out to be, and how the last write went.
 *
 * Four states rather than a boolean, because three of them are ordinary and only one
 * is a fault. `unsaved` is the second or two after a tap; `unavailable` is private
 * browsing or a partitioned frame, where the tool works and keeps nothing; `failed` is
 * the quota being full or the database being closed by another tab.
 */
export type SaveState = 'saved' | 'unsaved' | 'unavailable' | 'failed';

/**
 * What the status line says about the lifter's data.
 *
 * `saved` is section 18.9's phrase, exactly. Do not reword it without changing the
 * acceptance test with it -- and do not soften the other three, which are the states a
 * lifter has to be able to act on before they have lost a session rather than after.
 */
export const SAVE_STATES: Readonly<Record<SaveState, string>> = {
  saved: 'Saved on this device',
  unsaved: 'Saving',
  unavailable: 'Not saved on this device',
  failed: 'The last change could not be saved',
};

/**
 * The longer version of each, for the states where the short phrase is not enough.
 *
 * A lifter reading "Not saved on this device" needs to know what to do about it
 * inside the same breath, because the thing to do -- download a backup before closing
 * the tab -- stops being possible the moment they close the tab.
 */
export const SAVE_STATE_NOTES: Readonly<Partial<Record<SaveState, string>>> = {
  unavailable:
    'This browser is not giving the page any storage, so this session lives in this tab only. Download a backup before you close it.',
  failed:
    'Nothing above is lost from this tab yet. Download a backup now, before closing it, and the file will hold everything on this screen.',
};

/**
 * What the tool calls itself, and what three of its screens are called.
 *
 * The title is the element's own `<h1>`. It is there because the tool is shipped
 * framed as well as hosted: the embed route is a page with no site chrome on it, so
 * whatever heading a visitor lands on is the one this element drew. The page around
 * it may well draw the same words above the frame -- that page can be changed and a
 * document with no level-one heading in it cannot be navigated, so the duplicate is
 * the cheaper of the two faults.
 *
 * The screen names are the accessible name of the region a screen change moves focus
 * to, which is why only three are here: every other screen already has a heading in
 * {@link BUILDER_NOTES} and its neighbours, and naming a region with a second string
 * is how a region comes to disagree with the heading inside it. These three have no
 * heading of their own -- the home screen is a stack of sections, and the logging and
 * correcting screens are titled with the workout's own day.
 */
export const SCREEN_NOTES = {
  title: 'Training logbook',
  home: 'Training logbook',
  active: 'Logging a workout',
  edit: 'Correcting a workout',
} as const;

/**
 * What each loading model asks for, in the words it is filed under.
 *
 * These are the `optgroup` headings in the exercise picker, and grouping by loading
 * model rather than by muscle or by warm-up family is deliberate. A heading here
 * tells a lifter what the row they are about to add will ask them for -- a weight, a
 * weight added to a body, a counterweight, or nothing -- which is the one thing about
 * an unfamiliar movement that changes what they have to type. Warm-up family would
 * put the bench press under the same heading as the squat, which is true of the ramp
 * and false of everything a person browsing a list is thinking about.
 */
export const LOADING_LABELS: Readonly<Record<LoadingModel, string>> = {
  'barbell-total-weight': 'Barbell',
  bodyweight: 'Bodyweight',
  'bodyweight-plus-added-weight': 'Bodyweight plus added weight',
  'assisted-bodyweight': 'Assisted',
  'machine-or-cable-weight': 'Machine or cable',
  'repetitions-only': 'Reps only',
  'custom-weight-reps': 'Other',
};

/**
 * Which ramp a movement follows, said as movements rather than as family names.
 *
 * The identifiers are the calculator's vocabulary and two of them are wrong as
 * English: `pull` is rows and shrugs and not chin-ups, `assistance` is a jump
 * pattern and not a category of exercise. A lifter picking one is answering "what
 * does this warm up like?", so every label names lifts they can compare theirs to
 * -- which is the only way to answer it without reading section 8.2.
 */
export const WARMUP_FAMILY_LABELS: Readonly<Record<WarmupFamily, string>> = {
  'squat-press': 'Squat, bench or overhead press',
  deadlift: 'Deadlift',
  pull: 'Row or shrug',
  olympic: 'Clean, snatch or jerk',
  assistance: 'Curl, extension or good morning',
};

/** What a set is for. Section 7.3. */
export const SET_KINDS: Readonly<Record<SetKind, string>> = {
  warmup: 'Warm-up',
  working: 'Working',
  backoff: 'Back-off',
  amrap: 'AMRAP',
  accessory: 'Accessory',
};

/**
 * What became of a set, said as a fact and never as a judgement.
 *
 * "Skipped" rather than "missed", and "Not finished" rather than "failed". Section
 * 15.3 is that a set the lifter chose not to do is not a failure, and the difference
 * between those two pairs of words is the whole of it -- a history that calls a
 * deliberate omission a failure is a history somebody stops writing honestly.
 */
export const SET_STATUSES: Readonly<Record<SetStatus, string>> = {
  planned: 'To do',
  complete: 'Done',
  incomplete: 'Not finished',
  skipped: 'Skipped',
};

/** Where a workout sits in its own life. Section 7.1. */
export const WORKOUT_STATUSES: Readonly<Record<WorkoutStatus, string>> = {
  draft: 'Planned',
  active: 'In progress',
  completed: 'Finished',
  discarded: 'Discarded',
};

/** The unit weights are shown in. */
export const UNIT_LABELS: Readonly<Record<WeightUnit, string>> = {
  kg: 'Kilograms',
  lb: 'Pounds',
};

/**
 * How a recorded effort is named on the row it belongs to.
 *
 * The scale comes from the effort and never from the setting, which is why this
 * is keyed on {@link EffortScale} rather than on {@link EffortSetting} below.
 * Somebody who logs a month in RPE and then switches to RIR has a month of rows
 * that still mean RPE, and a label read off today's setting would relabel all of
 * them -- silently, and in the direction that makes an easy set look like a
 * brutal one.
 */
export const EFFORT_LABELS: Readonly<Record<EffortScale, string>> = {
  rpe: 'RPE',
  rir: 'RIR',
};

/**
 * The three answers to how effort is entered, if at all. Section 7.10.
 *
 * Not derived from {@link EFFORT_LABELS} with an extra entry, though the two
 * agree today. One names a scale a number was recorded on and the other names a
 * preference, and folding them together is how "off" would eventually acquire a
 * meaning on a stored set.
 */
export const EFFORT_SETTING_LABELS: Readonly<Record<EffortSetting, string>> = {
  none: 'Off',
  rpe: 'RPE',
  rir: 'RIR',
};

/**
 * What each scale means, said once where the choice is made.
 *
 * Section 17 asks that RPE and RIR be explained rather than assumed, and this is
 * the only screen where somebody picks between them. Both sentences describe the
 * scale and neither says which to use.
 *
 * Both end "closer to your limit" rather than "is harder", and that is deliberate
 * twice over. `hard` is on the vocabulary list the browser test refuses to find on
 * any screen -- sections 15.3 and 16.1, the words that turn a record into advice --
 * and while an exemption would be arguable here, since defining a scale is not
 * grading a session, not needing one is better. It is also simply more accurate:
 * RPE 10 and RIR 0 are both the point where nothing is left, which is what the two
 * scales actually measure from opposite ends.
 */
export const EFFORT_SETTING_NOTES: Readonly<Record<EffortSetting, string>> = {
  none: 'No effort box. Sets record weight and reps only.',
  rpe: 'Rate of perceived exertion, usually 6 to 10. Higher means closer to your limit.',
  rir: 'Reps in reserve: how many more you could have done. Lower means closer to your limit.',
};

/** What the editor's effort box is called, in whichever scale the setting names. */
export const EFFORT_FIELD_LABELS: Readonly<Record<EffortScale, string>> = {
  rpe: 'Effort (RPE)',
  rir: 'Effort (RIR)',
};

/**
 * The usual range, as a hint and not a limit.
 *
 * Nothing refuses a number outside it. Section 15.3: an RPE of 11 is a lifter's
 * own account of a set, and a tool that rejected it would be grading the entry
 * rather than recording it.
 */
export const EFFORT_FIELD_HINTS: Readonly<Record<EffortScale, string>> = {
  rpe: 'Usually 6 to 10. Leave it blank for none.',
  rir: 'Usually 0 to 5. Leave it blank for none.',
};

/**
 * The two answers to "you left some sets undone". Section 7.12 step 2.
 *
 * Both are offered and neither is preselected, because they record different things
 * and the tool cannot know which happened. Defaulting to `skip` would write a decision
 * into a lifter's history that they did not make.
 */
export const FINISH_DISPOSITIONS: Readonly<Record<FinishDisposition, string>> = {
  skip: 'Mark them skipped',
  leave: 'Leave them as planned',
};

/** What each disposition will actually do to the record. */
export const FINISH_DISPOSITION_NOTES: Readonly<Record<FinishDisposition, string>> = {
  skip: 'They will read as work you decided not to do.',
  leave: 'They will read as work you wrote down and did not get to.',
};

/**
 * The sentences the home screen says in its own voice.
 *
 * Each is here because a reader would otherwise draw a wrong conclusion from a true
 * screen, and the wrong conclusion is named above it.
 */
export const HOME_NOTES = {
  intro:
    'Plan a session, tick sets off as you do them, and keep the record on this device. There is no account and nothing is uploaded.',

  /**
   * The whole of section 10.1 in one sentence, said before a lifter has anything to
   * lose rather than after. A tool whose only copy of a year of training is one
   * browser profile has to say so where somebody reads it on day one.
   */
  localOnly:
    'Everything here is stored in this browser. Clearing site data, or losing this device, loses it. Download a backup now and then.',

  start: 'Start a workout',
  resume: 'Carry on with your workout',

  /** A resumed session with no framing reads as one the lifter has already finished. */
  resumeNote: 'You have a workout in progress. It picks up exactly where you left it.',

  historyHeading: 'Recent workouts',

  /** An empty list reads as a failed read rather than as a beginning. */
  historyEmpty: 'Nothing logged yet. Your finished workouts will be listed here.',

  /**
   * The other reason the list can be empty, and the two libraries' sentence again.
   *
   * The distinction is the sharp one the records screen draws: `historyEmpty` promises
   * a lifter that their finished workouts will be listed here, which is a lie to
   * somebody whose year of training is in a database this build cannot walk. What it
   * must not do instead is guess the other way -- a failed walk says nothing about
   * whether the records are still there, and this tool has no second copy to check
   * against. So it says what it knows and points at the one control that answers the
   * question, which is the backup below: it reads the workouts by key rather than by
   * the walk that just failed, so it can still take out whatever is readable.
   */
  historyUnreadable:
    'Your recent workouts could not be read on this device. There is no way from here to tell whether they are still in the database. The rest of the tool still works, and the backup below will hold whatever can be read.',

  /**
   * A Repeat that read nothing back.
   *
   * Said rather than swallowed, because the row is still on screen and the press
   * plainly did something -- section 2.4's "do not silently ignore" at the one place a
   * lifter would otherwise press it again and again. It also says the record is intact,
   * since the fear a failed read raises is that the workout has gone.
   */
  repeatFailed: 'That workout could not be read back, so nothing was started. It is still saved.',

  settingsHeading: 'Settings',
  unitLabel: 'Show weights in',

  /** Without this, changing the unit looks like it will rewrite what is recorded. */
  unitNote:
    'This changes what new entries are typed in. Weights already recorded keep the unit they were typed in.',

  effortLabel: 'Record effort as',

  /**
   * Turning effort off hides the box; it does not delete anything.
   *
   * Said because the control reads like a switch on the data rather than on the
   * form, and somebody with a year of RPE behind them would reasonably not touch
   * it. The scale a set was recorded on stays on that set either way.
   */
  effortNote:
    'Off hides the box. Efforts already recorded stay on their sets and keep their scale.',

  backupHeading: 'Backup',
  backup: 'Download a backup',
  backupNote:
    'A JSON file holding every workout, setting and exercise on this device. Keep it somewhere that is not this browser.',

  /** A download that produced a file needs to say so, or somebody presses it twice. */
  backupDone: 'Backup downloaded.',

  markdown: 'Download a readable copy',

  /**
   * Said under both buttons, because the choice between them is the whole of what a
   * lifter has to understand here. Section 10.5: one file restores and one file reads,
   * and somebody who keeps only the second has kept a diary and thinks they have a
   * backup. Naming the format in each sentence is what makes the pair legible at a
   * glance -- "JSON" above, "Markdown" here.
   */
  markdownNote:
    'A Markdown file to read, print or keep elsewhere. It holds the same training, and it cannot be restored from.',

  /** Its own sentence and not a shared one: two buttons, two things that may have happened. */
  markdownDone: 'Readable copy downloaded.',

  restore: 'Restore from a backup',

  /**
   * Said next to the button rather than only on the confirmation behind it.
   *
   * Section 10.7 makes a restore a replacement and not a merge, and that is the one
   * fact about it a lifter has to know *before* they go looking for a file. The
   * suggestion to take a backup first is in the same sentence for the same reason:
   * it is only useful while there is still something to back up.
   */
  restoreNote:
    'Reads one of those files back in. Everything on this device is replaced by what the file holds, so download a backup of what is here first if you want to keep it.',
} as const;

/**
 * The sentences the persistence offer says. Section 10.3.
 *
 * A different question from the storage line above the screen, and the copy has to keep
 * them apart or it makes the tool sound like it is saying the same thing twice. The save
 * line answers "did that write land somewhere that survives the tab closing". This
 * answers "will the browser throw the lot away when the phone runs short of room" -- and
 * the second is worse, because it happens to a device that has been working correctly
 * for a year and gives no warning when it does.
 *
 * WHY THE ASK IS A BUTTON AND NOT SOMETHING THAT HAPPENS ON LOAD
 *
 * Because section 10.3 says so, and because the browsers make it the difference between
 * being kept and being refused for good. Firefox puts a permission prompt behind the
 * request; Chromium decides from its own engagement heuristics. Asking a first-time
 * visitor who has logged nothing is the surest way to collect a no from somebody who
 * would have said yes in a month. So the offer does not appear until the device holds
 * something, and then it waits to be pressed.
 *
 * WHY EVERY BRANCH ENDS IN THE SAME SENTENCE
 *
 * Section 10.3's second half: whatever the browser answered, browser data can still be
 * cleared and the JSON backup is the copy that survives it. That is most necessary in the
 * branch it reads least naturally -- the one where the browser agreed -- because a lifter
 * who has just been told their training is being kept is the one most likely to stop
 * taking backups. So it is not conditional.
 */
export const PERSIST_NOTES = {
  heading: 'Keeping this on the device',

  /**
   * What "best-effort" means, in the words of the thing that actually happens.
   *
   * Not "your storage is not persisted". Eviction under storage pressure is invisible
   * and has no error attached, so the only way a lifter finds out is by opening an empty
   * logbook, and a sentence that named the mechanism would be true and useless.
   */
  atRisk:
    'Your browser is allowed to clear this to make room when the device runs short. You can ask it not to.',

  action: 'Ask the browser to keep this',

  /** The browser agreed -- on this visit or on one before it; the sentence reads the same either way. */
  persisted: 'Your browser has agreed to keep this until you remove it yourself.',

  /**
   * The browser said no.
   *
   * "Did not agree" and not a word from the vocabulary list. A refusal here is a decision
   * the browser makes about how much the lifter uses the site, so it is worth saying that
   * asking again later is a real option rather than a polite one.
   */
  declined:
    'Your browser did not agree this time. It decides on its own, and asking again after you have used this a while may go differently.',

  /** The request went nowhere -- no answer to report, and nothing changed. */
  noAnswer: 'Your browser gave no answer, so nothing has changed.',

  /** Section 10.3's second requirement, said under every branch. */
  stillClearable:
    'Either way, clearing site data removes it, and so does losing this device. A downloaded backup is the only copy that does not depend on this browser.',
} as const;

/**
 * The sentences the deletion confirmation says. Section 10.8.
 *
 * Every one of them is written for somebody who means it, and none of them is written
 * to talk them out of it. A tool that hedges a deletion into three warnings is a tool
 * that has decided it knows better than the person who owns the data; the honest shape
 * is one plain statement of what goes, one offer of the thing that makes it
 * recoverable, and a button that says what it does.
 *
 * The counts are the same ones the restore preview shows, and deliberately so: what a
 * lifter is destroying here is exactly what a backup taken now would hold. There is no
 * list of sessions -- the restore screen lists them because a lifter is identifying an
 * unfamiliar *file*, and here they are looking at their own device, which they do not
 * need described back to them.
 *
 * WHY NOTHING HERE MENTIONS THE OFFLINE CACHE
 *
 * Section 10.8 asks for cached application data to go *where appropriate*, and this is
 * where that qualifier lands. The cache on this origin holds the application -- HTML,
 * scripts, styles -- and none of a lifter's training, which lives in IndexedDB and is
 * what `clearAll` empties. Clearing it would delete nothing personal and would break
 * the tool for a lifter who installed it to use in a gym with no signal. So it stays,
 * and the screen says nothing about it: a sentence about caches is a sentence that
 * invites somebody to worry about the one thing here that is not their data.
 */
export const DELETE_NOTES = {
  /** On the home screen, under the backup section, because the offer above it is the recovery. */
  action: 'Delete everything on this device',

  heading: 'Delete everything on this device?',

  /**
   * The whole of section 10.8 in one sentence.
   *
   * "There is no copy anywhere else" is not padding. This tool has never had an
   * account, so the lifter has no server-side fallback to half-remember -- and the
   * absence of one is exactly the thing a person who has used other apps will assume
   * wrongly.
   */
  warning:
    'Your workouts, your settings, your own exercises and your saved gyms are all removed. There is no copy anywhere else, and this cannot be undone.',

  /** The one thing being deleted that a lifter may not have counted. */
  activeWarning: 'The workout you have in progress goes with it.',

  workoutsLabel: 'Workouts',
  exercisesLabel: 'Your own exercises',
  racksLabel: 'Saved gyms',
  spanLabel: 'Covering',

  /** One day where the device holds a single day of training. Same rule as the restore span. */
  span: (earliest: string, latest: string): string =>
    earliest === latest ? earliest : `${earliest} to ${latest}`,

  /** An empty device can still be deleted, and a screen that counted zero and said nothing would read as broken. */
  nothingHere: 'There is nothing recorded on this device yet.',

  confirm: 'Delete everything',
  cancel: 'Keep it',
  backupFirst: 'Download a backup first',

  done: 'Everything has been deleted. This device is back to how it started.',

  /** The write did not land, so nothing went. The reassurance is the point of the sentence. */
  problem: 'Nothing could be deleted, so everything is still here.',

  /**
   * The delete ran and the read-back still found something.
   *
   * Separate from {@link DELETE_NOTES.problem} because the two leave the device in
   * different states and only one of them is safe to shrug at. This is the sentence
   * that must never be replaced by *deleted*: telling somebody their training is off
   * the device while it is still on it is the one lie this screen could tell that
   * matters.
   */
  verifyProblem:
    'Some of it could not be deleted and is still on this device. Nothing here can say how much.',
} as const;

/**
 * The sentences the restore confirmation says.
 *
 * All of them are about loss. Section 10.7's sixth step is a preview, and the only
 * reason to draw one is that the press after it cannot be taken back -- so the screen
 * describes the file well enough for a lifter to tell it apart from the backup they
 * took a year ago and forgot about, and names what is going as plainly as what is
 * arriving.
 *
 * The span matters more than the counts, which is why it is here at all. "Forty-one
 * workouts" describes a great many files; "March to August" describes one.
 *
 * There is nothing here about *when* the file was written, and the omission is
 * deliberate. `exportedAt` is an instant, and an instant rendered as a day is a
 * different day either side of midnight in the reader's own zone -- so the tool would
 * be printing a date that disagrees with the lifter's memory of taking it. The span of
 * training inside the file is already the thing a person recognises, and it is stored
 * as calendar days that mean the same everywhere.
 */
export const RESTORE_NOTES = {
  heading: 'Restore this backup?',

  /** The whole of section 10.7 in one sentence, before the button that does it. */
  warning:
    'Everything now on this device is replaced by what this file holds. This cannot be undone.',

  /** The one thing a lifter can lose here that they cannot get back from a file. */
  activeWarning: 'The workout you have in progress is part of what gets replaced.',

  workoutsLabel: 'Workouts',
  finishedLabel: 'Finished',
  exercisesLabel: 'Your own exercises',
  racksLabel: 'Saved gyms',
  spanLabel: 'Covering',
  versionLabel: 'Written by',

  /** One day where the file holds a single day of training, not "the 5th to the 5th". */
  span: (earliest: string, latest: string): string =>
    earliest === latest ? earliest : `${earliest} to ${latest}`,

  /** An empty file is a real backup and reads as a broken one without this. */
  noWorkouts: 'This file holds no workouts. Restoring it leaves this device with none.',

  fileHasActive: 'It has a workout in progress in it, which is the one you would carry on with.',

  newestHeading: 'The newest sessions in it',
  untitled: 'Untitled',
  more: (count: number): string => (count === 1 ? 'and 1 more' : `and ${count} more`),

  confirm: 'Replace everything',
  cancel: 'Keep what is here',
  backupFirst: 'Download a backup of what is here first',

  /** Where the reading stopped, as a path. Never the value found there -- section 2.3. */
  path: (path: string): string => `The part it stopped on: ${path}.`,

  done: 'Backup restored. Everything on this device is now what was in the file.',

  /**
   * The write did not land. Nothing is lost, and saying so is the point of the sentence.
   */
  writeProblem: 'That backup could not be written, so nothing on this device was changed.',

  /**
   * The write landed and the read-back did not agree with it. Section 10.7's ninth step.
   *
   * The bluntest sentence in the tool, because it describes the one state where the
   * database holds neither the old logbook nor the new one whole. Downloading a backup
   * is the only thing that makes the next step recoverable, so it is the only thing
   * suggested.
   */
  verifyProblem:
    'That backup was written and reading it back did not match the file. Download a backup now, before doing anything else here.',
} as const;

/**
 * Why a chosen file was not read, one sentence per kind.
 *
 * Each one says what the tool concluded and, where it is not obvious, that nothing was
 * changed. None of them quotes the file: a refusal is the kind of string that gets
 * pasted into a message to somebody else, and section 2.3 is easier to keep when the
 * diagnostic has nowhere to put a lifter's training in it.
 */
export const RESTORE_REFUSALS = {
  /** The platform never produced any text. `readBackup` cannot report this one. */
  unreadable: 'That file could not be read off the disk, so nothing was changed.',

  'too-large':
    'That file is larger than this tool will read. A backup it writes is far smaller than the limit, so this is very likely not one.',
  'not-json': 'That file is not JSON, so it is not a backup this tool wrote.',
  'not-a-backup': 'That is JSON, and it is not a training logbook backup.',
  'newer-schema-version':
    'That backup was written by a newer version of this tool than the one you are running, so nothing here can tell what its fields mean. It was not read.',
  'invalid-data':
    'That is a logbook backup and part of it does not match the format this version reads. Nothing was changed.',
} as const;

/**
 * The sentences the builder says.
 *
 * The builder is the screen section 4.1 walks through, and its job is to be finished
 * quickly. Every sentence here is either a label or a warning about a control that
 * would otherwise be misread; there is no encouragement, and there is no advice about
 * what to train.
 */
export const BUILDER_NOTES = {
  heading: 'Plan the session',

  dateLabel: 'Date',
  /** A date field defaulted to today, with no note, reads as unchangeable. */
  dateNote: 'The day you trained. Change it to log a session you did earlier.',

  titleLabel: 'Name (optional)',
  titlePlaceholder: 'Squat day',

  exercisesHeading: 'Exercises',
  /** Four tiles with no framing read as the only four the tool knows. */
  primaryNote: 'The four competition lifts are here. Everything else is in the list below.',
  addLabel: 'Add another exercise',
  addPlaceholder: 'Choose an exercise',

  /** An empty plan with a start button beside it reads as a broken screen. */
  empty: 'No exercises yet. Add one above.',

  setsLabel: 'Sets',
  repsLabel: 'Reps',
  weightLabel: 'Weight',

  /** A weight box on a chin-up would record something that is not a weight. */
  noWeightNote: 'This one records reps only.',

  /** A blank weight is allowed and somebody will assume it is not. */
  weightNote: 'Leave the weight blank to fill it in as you go.',

  remove: 'Remove',
  start: 'Start the workout',

  /**
   * The one thing this screen refuses, said as a fact about the button.
   *
   * A workout with no exercises in it is a session with nothing to tick, and a start
   * button that produced one would leave a lifter on an empty logging screen with no
   * way back except finishing a workout they never did.
   */
  startNeedsExercise: 'Add at least one exercise to start.',

  /**
   * The tick on a row that can have a ramp, and what it promises.
   *
   * The legend names the subject and the option names the action, because a fieldset
   * of one still has to say what the tick is about when it is read out on its own.
   * The description says where the numbers come from: a lifter with the calculator
   * open in another tab is going to compare the two, and "the same rules" is the
   * claim section 8.1 actually makes -- not "the same as last time" and not "what you
   * should lift".
   */
  warmupLegend: 'Warm-up',
  warmupLabel: 'Work up to this weight',
  warmupNote:
    'Warm-up sets worked out from your rack, by the same rules as the warm-up calculator.',

  /**
   * Why the tick is not on the screen at all.
   *
   * A rack is the one input the lifter has to supply and the tool cannot guess, so
   * without one there is nothing to disable -- there is a question that has not been
   * answered yet, and this says which screen answers it. Drawing a ticked-out control
   * instead would be a dead control on a primary journey (root section 0.4).
   */
  warmupNeedsRack:
    'Warm-ups are worked out from your bar and plates. Set those up under Equipment on the previous screen and they will be offered here.',

  /**
   * Said once under the rows, for the exercises that will never have the tick.
   *
   * Only where at least one row is in that position, and never as a note on the row
   * itself: a chin-up is not missing a feature, and a line under every one of them
   * saying so is how a screen fills up with sentences nobody needs to read.
   */
  warmupNotEveryLift: 'Warm-ups are only worked out for barbell lifts the calculator knows.',
} as const;

/**
 * The sentences the offer from the warm-up calculator says. Section 4.3.
 *
 * The offer has to answer three questions before a lifter presses anything: where
 * this came from, what it will log, and what it will not. The third is the one a
 * card like this usually leaves out -- a record names lifts by identifier, and an
 * identifier this build's catalogue does not know lands nothing -- so the list under
 * the heading is built from what would actually land rather than from what the record
 * says, and the copy around it makes no claim the list does not support.
 *
 * Nothing here says the session is a good one, or that the ramp is the right one.
 * Section 15.3 applies to a session that arrived from another tool exactly as it
 * applies to one typed in here.
 */
export const HANDOFF_NOTES = {
  heading: 'From the warm-up calculator',

  /**
   * Says where it came from and that the ramp is worked out here.
   *
   * The second half matters more than it reads: the record carries what the lifter
   * chose and not the ramp the other tool drew, so the warm-up sets on the logging
   * screen are this build's answer. A lifter who saw a different set count here than
   * in the calculator tab still open beside them would otherwise have found a bug.
   */
  intro:
    'A session you set up in the warm-up calculator is waiting. The warm-ups are worked out again here, from the same rules.',

  start: 'Log this session',
  discard: 'Discard it',

  /**
   * Why Start is not offered while something is already open.
   *
   * Landing a handed-over session over a workout in progress would replace training
   * a lifter has done with training they have not, and no amount of confirmation
   * makes that a thing worth offering at a rack. Discard stays, because the record
   * expiring on its own an hour later is not an answer to somebody looking at it now.
   */
  busy: 'You have a workout in progress, so this one cannot be started. Finish that one first, and it will still be here.',

  /** A lift on the logging screen with no ramp under it reads as a fault. */
  unrampedLead: 'No warm-up was worked out for',
  unrampedNote:
    'Their working sets are logged as you set them. The rest of the session is unaffected.',
} as const;

/**
 * The noun the warm-up offer counts in, so its two sentences agree on it.
 *
 * A count of rows and never of anything a lifter did, which is why it is here rather
 * than in `format.ts` beside the weights: this is a sentence about the tool.
 */
const warmupSetWord = (count: number): string => (count === 1 ? 'warm-up set' : 'warm-up sets');

/**
 * The sentences the logging screen says.
 *
 * This is the screen somebody reads between sets with a belt on, and the copy is
 * shorter here for that reason rather than by accident. Section 14.3.
 */
export const ACTIVE_NOTES = {
  /** The one-tap control. Section 7.5 and section 21: this is the whole tool. */
  complete: 'Done',
  /** A tap that cannot be taken back is a tap nobody makes confidently. */
  undo: 'Undo',
  edit: 'Change what you did',

  /** Without this the editor reads as changing the plan rather than the result. */
  editNote: 'What you actually lifted. The plan above is kept as it was.',
  editWeightLabel: 'Weight lifted',
  editRepsLabel: 'Reps done',
  save: 'Save',

  /** A row whose numbers differ from the plan looks like an error unless labelled. */
  edited: 'Different from the plan',

  /**
   * Section 7.7's three structural changes, and the one that adds a row.
   *
   * All four are verbs about the set and not about the record of it, which is the
   * distinction the screen has to keep: `edit` above says "change what you did",
   * these say what happens to the row. A lifter who has one more in them presses
   * Add; a lifter who is done with a lift presses Skip; a lifter who planned five
   * and wants four presses Remove. Nothing here scores any of it (section 15.3).
   */
  /**
   * Appended, and planned like the row it lands after -- another back-off after a
   * back-off rather than a top set. There is deliberately no sentence on screen
   * saying so: it would be one line under every lift, which is how a note stops
   * being read, and the new row arrives with its numbers already in it.
   */
  addSet: 'Add a set',
  duplicateSet: 'Add one more like this',
  skipSet: 'Skip this set',
  removeSet: 'Remove this set',

  /**
   * A skipped set is a fact and not a failure, and the row has to say which.
   *
   * Without it a skipped row and a ticked one are the same row: both are `done`,
   * both carry Undo, and only the numbers beside them differ -- and a skip clears
   * the performance, so the numbers are the plan either way. Section 15.3 is why
   * the word is the flat one and why nothing is coloured.
   */
  skipped: 'Skipped',

  /**
   * Why the three destructive-looking controls are behind Change rather than on
   * every row.
   *
   * A session with eight lifts draws forty rows, and five buttons on each is
   * forty of them next to the one that matters -- section 14.3's sweaty tap
   * landing on Remove instead of Done. Opening a row is the deliberate act that
   * makes the rest safe, so the sentence explains what a lifter has just found
   * rather than apologising for where it was.
   */
  editStructure: 'What happens to this row:',

  /**
   * Section 8.5's mid-session recalculation, as an offer rather than a rewrite.
   *
   * The lead says which input moved, because the two are answered differently: a
   * lifter who dropped their top set already knows why, and a lifter whose rack
   * changed under a session they resumed at another gym does not. Neither says the
   * warm-up on screen is wrong. It is a true record of the weight it was worked out
   * for, which is why nothing here happens without a press.
   */
  warmupStaleWeight: 'This warm-up was worked out for a different weight.',
  warmupStaleRack: 'This warm-up was worked out for a different rack.',
  warmupStaleBoth: 'This warm-up was worked out for a different weight, on a different rack.',

  /**
   * What the press costs, in rows, before it is pressed.
   *
   * Section 8.5 asks for the warning to name what is about to be thrown away, and a
   * count is the only honest form of that on a screen this small. The rows a lifter
   * has already ticked are counted separately and in the other direction -- they are
   * what the press does *not* touch, and it is the thing somebody mid-ramp wants to
   * know first.
   *
   * Neither sentence is drawn when the new ladder is the one already on the card. See
   * `warmupStanding` in `../core/warmup.ts`: an offer that replaced three sets with
   * the same three would teach lifters to dismiss the offer that matters.
   */
  warmupAdds: (generated: number): string =>
    `Working it out again adds ${String(generated)} ${warmupSetWord(generated)}.`,
  warmupReplaces: (replaced: number, generated: number): string =>
    `Working it out again replaces ${String(replaced)} ${warmupSetWord(replaced)} with ${String(generated)}.`,
  warmupKeeps: (kept: number): string =>
    kept === 1
      ? 'The one you have already done stays.'
      : `The ${String(kept)} you have already done stay.`,

  warmupRebuild: 'Work it out again',

  /**
   * The other face of the same control: a ramp that cannot be produced again.
   *
   * Reachable by removing the working sets it was worked up to, and by an exercise
   * the catalogue no longer has a family for. There is nothing to offer but taking it
   * off, and the sentence says what taking it off leaves behind -- the record of what
   * was lifted, which is not the tool's to withdraw.
   */
  warmupGone: 'This warm-up cannot be worked out again from the sets that are here now.',
  warmupClear: 'Take the warm-up off',
  warmupClearNote: 'The warm-up sets you have not done are removed. What you have done stays.',

  /**
   * Section 7.9's control, on a lift and on the session.
   *
   * One word. It is a quiet button on a screen that is mostly buttons, and what
   * it belongs to is said in its accessible name rather than on it -- "Note,
   * Back squat" printed under a heading reading "Back squat" is the heading
   * twice.
   */
  note: 'Note',

  /**
   * The session's own note, which has to be told apart from the eight above it.
   *
   * "Note" alone at the top of the screen reads as a note about the workout's
   * first lift, which is what it sits directly above.
   */
  workoutNote: 'Note for the workout',

  progressHeading: 'Progress',
  /** A count with no unit reads as a percentage. */
  setsDone: 'sets done',

  /**
   * Section 7.8's line, and the day it happened is part of it rather than a detail.
   *
   * "Last time" with no date is a claim the lifter cannot check. Last time could be
   * Tuesday or it could be March, and those two are the same three numbers on screen
   * with opposite meanings. The date follows this word, so the fragment ends without
   * punctuation.
   *
   * No word for how it went. Section 15.3: this tool records and does not score, and
   * the forbidden vocabulary list exists because "up on last time" is one small step
   * from a tool that has an opinion about a lifter's Tuesday.
   */
  lastTime: 'Last time,',

  finish: 'Finish the workout',
  finishHeading: 'Finish the workout',
  /** The question section 7.12 makes a step rather than a preference. */
  outstandingHeading: 'Some sets are still to do',
  finishConfirm: 'Finish',
  finishCancel: 'Keep going',

  /** Finishing with everything ticked still needs a confirmation to be undoable. */
  finishAllDone: 'Everything is ticked off.',

  /**
   * What finishing actually does, said before the button that does it.
   *
   * This line used to say a finished workout could not be reopened. That was true
   * when it was written and is not true now that a session in the history can be
   * corrected, and a confirmation screen making a false promise about what it is
   * about to do is worse than no line at all.
   */
  finishFinal: 'It moves to your history, where you can still correct it.',
} as const;

/**
 * What the plate diagram under a set says in words.
 *
 * Three fragments and no whole sentence, because two of the three are completed by a
 * weight and this file formats nothing. `element/loading-view.ts` joins them.
 *
 * `notLoadable` is a fact about the rack and never about the lifter, and it is not an
 * error: section 8.3 warns about an unbuildable weight and does not block it. A lifter
 * five kilograms off a number their plates make easily has a working session, and
 * colouring this red would say otherwise.
 */
export const LOADING_NOTES = {
  /** Shown in place of a diagram. The bar on its own is a real answer, not a blank. */
  barOnly: 'Bar only',

  notLoadable: 'These plates cannot build that weight.',

  /**
   * Two leads rather than one with a plural in brackets. Only one neighbour exists at
   * the top of what the plates reach and under an empty bar, and "the nearest are 100
   * kg" is the kind of small wrongness that makes a lifter stop trusting the number
   * beside it.
   */
  nearestOne: 'The nearest is',
  nearestTwo: 'The nearest are',
} as const;

/** The sentences on the screen a lifter lands on after finishing. */
export const DONE_NOTES = {
  heading: 'Workout finished',

  /**
   * Deliberately flat. "Great session" is a judgement about work this tool did not
   * see, and a logbook that congratulates a session it cannot assess is a logbook a
   * lifter learns to disbelieve.
   */
  note: 'It is saved with the rest of your training.',

  backup: 'Download a backup',
  home: 'Back to the logbook',
  durationLabel: 'Took',
} as const;

/**
 * The sentences on a workout that has already been done. Section 5.4.
 *
 * The screen says what happened and stops. There is no summary line grading the
 * session, no total tonnage, no comparison with the session before it -- section 9.1
 * draws the line at "what did I do", and everything past it is the analytics this
 * package is explicitly not. The one derived word here is "Edited", and it is derived
 * from two numbers that are both on the row already.
 */
export const DETAIL_NOTES = {
  /** Read from the workout where it has a name, so this is the fallback. */
  heading: 'Workout',

  /**
   * What a finished workout with nothing in it says.
   *
   * It is reachable: plan a session, start it, finish it without ticking anything.
   * A screen that drew an empty list under a heading would read as a failed load.
   */
  empty: 'Nothing was recorded in this workout.',

  /** The workout could not be read back at all, which is not an empty workout. */
  unreadable: 'That workout could not be read.',

  /**
   * The line under a set whose result differs from what was written down.
   *
   * Said as a fact and not as a shortfall. Section 15.3: a lifter who planned five
   * and did three has recorded three, and a screen that framed the difference as a
   * miss would be scoring the session. `setWasEdited` deliberately ignores effort,
   * for the reason written where it is defined.
   */
  plannedLabel: 'Planned',

  back: 'Back to the logbook',

  /**
   * The way into section 5.4's edit, and the only control the root draws here that
   * changes the record rather than the screen.
   *
   * "Change" rather than "Edit" to match the word the logging screen already uses on
   * a set, since the screen it opens is that screen.
   */
  edit: 'Change this workout',
} as const;

/**
 * The two sentences correcting a finished workout adds.
 *
 * Two, because the screen underneath them is the logging screen and it already says
 * everything about a set, a note and the shape of a lift. A separate voice for editing
 * would be the same words a second time in a register a lifter would have to notice.
 *
 * Nothing here is called "Done". That word is on every set row on this screen (section
 * 7.5), and a control at the foot sharing it would read as ticking the last one.
 */
export const EDIT_NOTES = {
  /**
   * Said above the session rather than beside a Save button, because there is no Save
   * button: every change writes as it is made, exactly as it does mid-workout. A
   * lifter correcting a session from March needs to be told that once, and told as
   * well that doing so does not move it -- the fear this line exists to answer is that
   * an edit re-dates the workout to today.
   */
  note: 'Changes are saved as you make them, and the workout stays on its own day in your history.',

  back: 'Back to the workout',
} as const;

/**
 * The sentences the equipment library says.
 *
 * Two things are being said at once on that screen and the copy has to keep them
 * apart, because they are stored in two different places and behave differently. The
 * editor is **the rack you are on now** -- one snapshot, in `settings.equipment`,
 * overwritten as the lifter changes it. A profile is **a gym you saved** -- one row of
 * a library, changed only when the lifter says so. A single word like "save" spanning
 * both would make the first look like it needed pressing and the second look like it
 * had happened already.
 *
 * Nothing here says a rack is right, complete or well equipped. A lifter with one bar
 * and two plates is not being graded, and section 15.3 applies to equipment exactly as
 * it applies to a session.
 */
export const EQUIPMENT_NOTES = {
  heading: 'Equipment',

  /**
   * Says what the rack is *for* before a lifter spends taps on it.
   *
   * Without it the section reads as bookkeeping. The plates only matter because
   * something downstream is going to work out what to put on the bar, and a lifter who
   * does not know that has no reason to correct the default.
   */
  intro: 'The bar and plates you train with. Warm-ups and plate loading are worked out from this.',

  /** The fold's own label, which is all a lifter sees until they open it. */
  editorSummary: 'The rack you are on now',

  /**
   * Said where the editor and the library meet, because the boundary is the one thing
   * about this screen that is not self-evident: editing here does not touch a saved
   * gym, and choosing a saved gym does replace what is here.
   */
  editorNote: 'Changes here apply straight away. Saving is only for keeping a gym to come back to.',

  libraryHeading: 'Saved gyms',

  /** An empty library reads as a failed read rather than as a thing not done yet. */
  libraryEmpty: 'No saved gyms yet. Save the rack above to come back to it.',

  /**
   * The other reason the list is empty, said rather than drawn as the first one.
   *
   * A read that failed and a library nobody has written to look identical, and the
   * difference is whether saving under the same name again is safe. It is not: the
   * gym is still in the database, so the save will replace something the lifter
   * cannot see. Nothing else on this screen is disabled by it -- the rack above still
   * works, and a lifter with a failed read still has a bar to load.
   */
  libraryUnreadable:
    'The saved gyms could not be read on this device. The rack above still works. Anything you save now may replace a gym you cannot see.',

  nameLabel: 'Name this gym',
  namePlaceholder: 'The garage',

  /** Two gyms is the case this exists for, and it is worth naming. */
  nameHint: 'Somewhere you train. Save one for each, and switch between them here.',

  save: 'Save this gym',

  /** Pressing save with an empty box has to say why nothing happened. */
  nameRequired: 'Give the gym a name first.',

  /**
   * The one bound on a name, stated as the rule rather than as the number.
   *
   * A row in a list has to stay a row. Two hundred characters is past anything a person
   * types on purpose and well short of anything that would trouble storage, so the
   * message names the fault and not the limit -- a lifter who has pasted a paragraph
   * knows which end to cut.
   */
  nameTooLong: 'That is too long for a name. A word or two is enough.',

  /** Saving over a gym that already has that name is the ordinary case, not an error. */
  saveOverwrites: 'Saving under a name you have used replaces that gym.',

  /** A row for a gym the lifter is standing in reads as selectable unless marked. */
  inUse: 'In use',

  use: 'Use this gym',
  remove: 'Remove',

  /**
   * Deleting a gym is the only destructive control on this screen, and it needs to say
   * what survives. Nothing about a finished workout moves: section 8.4 froze the rack
   * into each session at the time, which is exactly so that this button cannot reach it.
   */
  removeNote: 'Removing a gym leaves every workout you did there exactly as it is.',
} as const;

/**
 * The lifter's own movements. Section 6.4.
 *
 * The section that has to explain the most for the fewest controls, because two of
 * the four questions it asks are questions no other screen asks. A loading model is
 * jargon by any name -- "what does this exercise weigh?" has no good short answer for
 * an assisted chin-up -- and warm-up generation is offered as a tick precisely
 * because it must never be inferred, which is the opposite of how every other tool
 * behaves and therefore needs saying.
 */
export const EXERCISE_NOTES = {
  heading: 'Your exercises',

  /**
   * Says what this is for before the form, because the catalogue is not obviously
   * incomplete until a lifter goes looking for something specific.
   */
  intro: 'Anything the list does not already have. Yours appear alongside the built-in ones.',

  libraryHeading: 'Saved exercises',

  /** An empty library reads as a failed read rather than a thing not done yet. */
  libraryEmpty: 'Nothing added yet. The built-in list is still there either way.',

  /**
   * The other reason the list can be empty, said rather than drawn as the first one.
   *
   * Identical on screen and different in what it means for the next press: a name
   * already taken is invisible, so adding one may quietly replace a movement that is
   * still attached to old sessions.
   */
  libraryUnreadable:
    'Your exercises could not be read on this device. The built-in list still works. Anything you add now may replace one you cannot see.',

  nameLabel: 'Name',
  namePlaceholder: 'Belt squat',

  /** Named for what it is, because a picker is the only place it will ever be read. */
  nameHint: 'What you would look for in the list.',

  /**
   * The loading model, asked as what gets typed in rather than as a category.
   *
   * Section 6.3 requires it declared and never guessed, so this is the one answer
   * with no sensible default beyond the commonest case. The label asks the question
   * from the entry box's side -- that is what the answer actually decides.
   */
  loadingLabel: 'What gets recorded',
  loadingHint:
    'This decides the boxes you fill in when you log a set. It cannot be guessed from the name.',

  unitLabel: 'Weights typed in',

  /** The third option, which is the default and is not a unit. */
  unitFollows: 'Follow the setting',
  unitHint: 'Leave it following the setting unless this one exercise is always in the other unit.',

  /** The group the tick sits in, so it is not read out as a question with no subject. */
  warmupLegend: 'Warm-ups',

  warmupLabel: 'Build warm-ups for this',

  /**
   * Why the tick exists at all, which is section 6.4's rule turned outward.
   *
   * A lifter reasonably expects a tool to work this out. It will not, and the
   * sentence says so plainly rather than leaving the tick looking like a shortcut
   * somebody forgot to automate.
   */
  warmupNote:
    'Off unless you say otherwise. Nothing is worked out from the name, so pick the movement it ramps like.',

  familyLabel: 'Ramps like',

  /** Only barbell movements can be ramped, and the tick has to say why it went. */
  warmupBarbellOnly:
    'Warm-ups are built on a barbell, so this is offered for barbell exercises only.',

  add: 'Add this exercise',
  saveEdit: 'Save changes',
  cancelEdit: 'Cancel',
  edit: 'Edit',
  remove: 'Remove',

  /** Pressing add with an empty box has to say why nothing happened. */
  nameRequired: 'Give the exercise a name first.',

  /** The same bound, and the same reasoning, as a gym name. */
  nameTooLong: 'That is too long for a name. A word or two is enough.',

  /** Adding under a name already used is the ordinary case, not an error. */
  addOverwrites: 'Adding one under a name you have used replaces that exercise.',

  /**
   * Removing is the destructive control here and it reaches further than the gym one.
   *
   * A session snapshots the movement's name onto itself when it is planned, so old
   * workouts keep reading correctly. What does go is the ability to plan it again --
   * worth saying, because "Remove" beside a list of movements reads as tidying.
   */
  removeNote:
    'Removing one leaves every workout that used it exactly as it is. You just cannot plan it again.',
} as const;

/** What a history row says about a workout with nothing recorded in it. */
export const HISTORY_NOTES = {
  unnamed: 'Workout',
  noExercises: 'No exercises',
  setsLabel: 'working sets',

  /**
   * The same fact about one set.
   *
   * Two keys and a choice at the call site rather than an `s` appended to a number,
   * which is how `describeGap` in tool 2 does it and for the same reason: a rule that
   * lives in the template cannot be read alongside the words it changes. "1 working
   * sets" on a row somebody looks at every session is the kind of small wrongness that
   * makes a tool feel unfinished.
   */
  setsLabelOne: 'working set',
  hasNotes: 'Has notes',

  /** Section 4.4. On a row, so it says which workout without repeating its name. */
  repeat: 'Repeat',

  /**
   * Section 5.4's first history action.
   *
   * Offered while a session is open, unlike Repeat. Reading last week's numbers is
   * one of the reasons to have the logbook out at the rack at all, and nothing about
   * looking at a finished workout can disturb the one in progress.
   */
  open: 'Open',

  /**
   * Why no row offers to be repeated while a session is open.
   *
   * One sentence for the whole list rather than one per row. The reason is never
   * about the row, and twenty copies of it is how a note stops being read -- the
   * same rule the builder's warm-up note is written under.
   */
  repeatBusy: 'You have a workout in progress, so none of these can be started again yet.',
} as const;

/**
 * One exercise read back across its whole history. Sections 5.5 and 9.2.
 *
 * WHY THE THREE MARKERS ARE WORDED THE WAY THEY ARE
 *
 * Each one says what it is and stops. Section 15.3 rules out the tool having an
 * opinion, and a marker is the place that rule is hardest to keep: "Personal best"
 * is a congratulation, "PR" is the same congratulation abbreviated, and both invite
 * the next sentence, which is advice. What is written below is a measurement -- the
 * heaviest, the most, at a stated weight or for a stated number -- and a lifter who
 * wants to feel something about it is welcome to, in their own words.
 *
 * "Most weight for these reps" and not "rep record" for the reason `records.ts`
 * gives where the marker is defined: the shorter phrase invites an extrapolation to
 * a one-rep max, and this tool does not make one.
 */
export const RECORDS_NOTES = {
  /** Read from the newest session that recorded the lift, so this is the fallback. */
  heading: 'Exercise',

  /** What a lift that has never been done says. Reachable the moment one is added. */
  empty: 'Nothing has been logged for this exercise yet.',

  /** The history could not be read at all, which is not a history with nothing in it. */
  unreadable: 'That history could not be read.',

  /**
   * Said under the list rather than above it.
   *
   * The sessions are the answer and this is a footnote about the answer's edge. Put
   * at the top it reads as a warning about the whole screen, which it is not: the
   * markers were worked out over every session the lifter has, including the ones
   * below the line.
   */
  truncated: 'Older sessions are not listed. The marks above cover all of them.',

  /** The heading over the marker summary, which is a fact and not a trophy shelf. */
  heaviestLabel: 'Heaviest',

  /** The three marks section 9.2 allows, on the set that holds each. */
  markers: {
    heaviest: 'Heaviest',
    'most-reps-at-load': 'Most reps at this weight',
    'most-load-for-reps': 'Most weight for these reps',
  },

  /**
   * The control on a lift heading that opens this screen. Section 5.5.
   *
   * On the logging screen as well as on a finished workout, because looking up what a
   * lift was done for last month is a thing done at the rack, mid-session.
   */
  open: 'History',

  /**
   * The way back.
   *
   * One sentence for both places this screen is reached from, because both of them
   * are a workout -- the one in progress, or the one being read. A pair of strings
   * chosen by origin would say the same thing twice.
   */
  back: 'Back to the workout',
} as const;

/**
 * The sentences the rest timer says. Section 7.11.
 *
 * Short, because every one of them is read between sets by somebody who is about to
 * lift again. There is no encouragement here and no instruction about how long to rest:
 * the number is the lifter's, the tool only counts it.
 */
export const REST_NOTES = {
  heading: 'Rest',

  /** Named, because a bare countdown on a training screen could be several things. */
  label: 'Rest timer',

  pause: 'Pause',
  resume: 'Resume',
  reset: 'Start again',
  dismiss: 'Done resting',

  /**
   * Signed rather than named, so the pair reads as one control with two directions.
   * The number comes from `REST_STEP_SECONDS` and is written into the label at render,
   * because two constants for one step is how they drift apart.
   */
  extend: (seconds: number): string => `+${String(seconds)}s`,
  shorten: (seconds: number): string => `-${String(seconds)}s`,

  extendName: (seconds: number): string => `Add ${String(seconds)} seconds`,
  shortenName: (seconds: number): string => `Take off ${String(seconds)} seconds`,

  /** The one thing worth interrupting a screen reader for, and the only live region. */
  up: 'Rest is up.',

  paused: 'Paused.',

  settingLabel: 'Rest timer',
  settingOn: 'On',
  settingOff: 'Off',

  /**
   * What the switch does, and where the rest of it is.
   *
   * The alerts are on the band rather than here, for the reason the duration picker is:
   * they are decided by a lifter who has just found out the timer is not loud enough,
   * standing at a rack. This sentence exists so that the one place the timer is turned
   * on does not read as the only place it can be configured.
   */
  settingNote:
    'Starts counting after each set you tick off. Sound, buzz and notifications are switched on from the timer itself.',

  /**
   * The alerts, folded away.
   *
   * Behind a disclosure because they are set once and then never again, while the band
   * they sit on is on screen for three minutes after every set. Three checkboxes in the
   * open would be three controls a lifter reads past forty times a session.
   */
  alertsLabel: 'Alerts',
  alertsLegend: 'When the rest is up',

  /**
   * One line each, and each line admits what its channel cannot promise.
   *
   * None of the three is reliable in the way a lifter would assume. A phone on silent
   * makes no sound and the page cannot read the switch; vibration needs the screen on
   * and a motor to do it with; a notification needs a permission that can be taken back
   * later from the address bar. Saying so here costs three lines and saves a lifter
   * trusting the tool to interrupt them.
   */
  alertOption: {
    vibrate: {
      label: 'Buzz',
      description: 'Only while this screen is showing, and only if the phone can.',
    },
    sound: {
      label: 'Sound',
      description: 'Two short tones. A phone on silent stays silent.',
    },
    notify: {
      label: 'Notification',
      description: 'From this page, on this device. Asks permission the first time.',
    },
  },

  /** What the demonstration says. Shown once, from the press that switched it on. */
  alertTestTitle: 'Rest alerts are on',

  /**
   * What a channel that did not work says, per channel and per kind of failure.
   *
   * Every one of them names something the lifter can do, or says plainly that there is
   * nothing. A refusal reported without a remedy is a switch that flicks back off for
   * no stated reason, which reads as the tool being broken -- and half the time it is
   * a setting two taps away.
   *
   * `refused` is the device saying no and `unknown` is the device not saying; the pair
   * is kept distinct here for the same reason it is kept distinct in `rest-alert.ts`.
   */
  alertTrouble: {
    vibrate: {
      refused: 'This device would not buzz. Check whether vibration is switched off.',
      unknown: 'This device has no buzz to give.',
    },
    sound: {
      refused:
        'The browser is holding sound until the page is tapped. Tap anywhere, then try again.',
      unknown: 'This device would not play the tone.',
    },
    notify: {
      refused:
        'Notifications are blocked for this site. Allow them in the browser settings, then switch this on again.',
      unknown:
        'No answer to the permission prompt, so notifications stay off. Some browsers only show them for an installed app.',
    },
  },

  durationLabel: 'Rest for',

  /**
   * The same picker again, on the band, naming the lift it is about.
   *
   * The lift is in the visible label rather than only in an accessible name, because
   * the two pickers are worded identically otherwise and the one on the band is the
   * one that changes a single movement. A lifter who read "Rest for" on a countdown
   * would reasonably take it for the setting they last saw on the home screen.
   */
  liftDurationLabel: (name: string): string => `Rest for ${name}`,

  /**
   * Said under it, because storing a preference is not what a countdown looks like it
   * does. Section 7.11 wants the exercise-specific duration optional, so the sentence
   * has to make clear that choosing one is a decision about every future session and
   * not about the three minutes on screen.
   */
  liftDurationNote: 'Kept for this lift from now on.',

  /** A duration as an option label: "3 min", "2 min 30 s". */
  duration: (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes === 0) return `${String(rest)} s`;
    if (rest === 0) return `${String(minutes)} min`;
    return `${String(minutes)} min ${String(rest)} s`;
  },
} as const;

/**
 * The Markdown document, which is the one thing this tool writes and will never read.
 * Section 10.5.
 *
 * Here rather than beside the loop that emits it, for the reason this file exists at
 * all: a document a lifter opens in a text editor is the tool talking, and words kept
 * next to the code that concatenates them are words nobody reads again. The rendering
 * rules -- which order, which table, which weight -- are in `markdown.ts`.
 *
 * Sections 15.3 and 16.1 apply to a file exactly as they apply to a screen, and
 * `markdown.test.ts` asserts the vocabulary against a generated document rather than
 * against this object -- the same reason the browser test asserts against rendered
 * screens, since a heading composed at write time counts too.
 */
export const MARKDOWN_NOTES = {
  title: 'Training logbook',

  /**
   * Said at the top, because the file it is about is the one sitting next to it.
   *
   * Somebody who kept the Markdown and deleted the JSON has kept a record and not a
   * backup, and the moment to find that out is before the browser is cleared, not
   * after. Section 10.5's first line as a sentence a person will actually meet.
   */
  preamble:
    'A readable copy of this device. The logbook cannot read it back in -- restoring needs the JSON backup.',

  exported: 'Exported',
  unit: 'Unit',
  equipment: 'Equipment',
  workouts: 'Workouts',

  /** Provenance for a human, the same fact the backup carries in `applicationVersion`. */
  writtenBy: 'Written by',

  /** What stands in for the summary on a logbook that has no default equipment. */
  noEquipment: 'None set',

  duration: 'Duration',
  note: 'Note',

  /**
   * Numbers a set note so it can be matched to its row without repeating the row.
   *
   * A position within the exercise and not a set id: the id is in the file the restore
   * reads, and a reader of this one is counting down the table with a finger.
   */
  setLabel: (position: number): string => `Set ${String(position)}`,

  /** The five columns section 10.5 asks for. */
  columns: {
    kind: 'Type',
    planned: 'Planned',
    performed: 'Performed',
    effort: 'Effort',
    status: 'Status',
  },

  /**
   * A cell with no answer in it.
   *
   * A dash rather than an empty cell: a row of blanks reads as a table that lost a
   * column somewhere, and this way an unrecorded effort looks the same as every other
   * unrecorded thing in the document.
   */
  blank: '-',

  /** A logbook with nothing in it still exports, and says so rather than trailing off. */
  empty: 'No workouts recorded.',
} as const;

/** A duration in the words a session is talked about in. */
export function formatDuration(millis: number): string {
  const minutes = Math.round(millis / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * A rest as `m:ss`, which is the only place in this tool a colon means a duration.
 *
 * Rounded up rather than down, so a rest of three minutes reads 3:00 for its first
 * second instead of 2:59, and 0:00 means the rest is actually over rather than under a
 * second from it. The alternative puts a lifter back at the bar a second early every
 * time and makes the last second of every rest invisible.
 *
 * Not {@link formatDuration}, which rounds to whole minutes: "3 min" is how a session
 * is talked about afterwards and is useless to somebody watching one run out.
 */
export function formatRest(millis: number): string {
  const total = Math.max(0, Math.ceil(millis / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The same rest in words, for the reader that cannot see the colon.
 *
 * "0:45" is announced as zero, colon, forty-five by some engines and as forty-five by
 * others, and neither is a length of time. This is rendered beside the digits and
 * hidden from sight -- **not** in a live region, so it is read when somebody navigates
 * to the timer and never announced on its own. A countdown that announced itself would
 * talk over everything else on the device once a second.
 */
export function formatRestSpoken(millis: number): string {
  const total = Math.max(0, Math.ceil(millis / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const minutePart = minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
  const secondPart = seconds === 1 ? '1 second' : `${String(seconds)} seconds`;
  if (minutes === 0) return `${secondPart} left`;
  if (seconds === 0) return `${minutePart} left`;
  return `${minutePart} ${secondPart} left`;
}
