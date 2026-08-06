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

import type { WeightUnit } from '@platform-toolkit/domain';

import type { FinishDisposition } from '../core/session.js';
import type { LoadingModel, SetKind, SetStatus, WorkoutStatus } from '../types.js';

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

  settingsHeading: 'Units',
  unitLabel: 'Show weights in',

  /** Without this, changing the unit looks like it will rewrite what is recorded. */
  unitNote:
    'This changes what new entries are typed in. Weights already recorded keep the unit they were typed in.',

  backupHeading: 'Backup',
  backup: 'Download a backup',
  backupNote:
    'A JSON file holding every workout, setting and exercise on this device. Keep it somewhere that is not this browser.',

  /** A download that produced a file needs to say so, or somebody presses it twice. */
  backupDone: 'Backup downloaded.',

  /** Reading the file back in is not built yet, and a lifter will look for it. */
  restoreNotYet:
    'Reading a backup file back in is not built yet. Keep the files you download: they are the format the restore will read.',
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

  progressHeading: 'Progress',
  /** A count with no unit reads as a percentage. */
  setsDone: 'sets done',

  finish: 'Finish the workout',
  finishHeading: 'Finish the workout',
  /** The question section 7.12 makes a step rather than a preference. */
  outstandingHeading: 'Some sets are still to do',
  finishConfirm: 'Finish',
  finishCancel: 'Keep going',

  /** Finishing with everything ticked still needs a confirmation to be undoable. */
  finishAllDone: 'Everything is ticked off.',

  /** A finished workout cannot be reopened yet, and that is worth saying first. */
  finishFinal: 'A finished workout cannot be reopened in this version.',
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

/** What a history row says about a workout with nothing recorded in it. */
export const HISTORY_NOTES = {
  unnamed: 'Workout',
  noExercises: 'No exercises',
  setsLabel: 'working sets',
  hasNotes: 'Has notes',
} as const;

/** A duration in the words a session is talked about in. */
export function formatDuration(millis: number): string {
  const minutes = Math.round(millis / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}
