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
   * Why no row offers to be repeated while a session is open.
   *
   * One sentence for the whole list rather than one per row. The reason is never
   * about the row, and twenty copies of it is how a note stops being read -- the
   * same rule the builder's warm-up note is written under.
   */
  repeatBusy: 'You have a workout in progress, so none of these can be started again yet.',
} as const;

/** A duration in the words a session is talked about in. */
export function formatDuration(millis: number): string {
  const minutes = Math.round(millis / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}
