// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The tool. It owns the session; the four elements below it own none of it.
 *
 * Tools 2, 3 and 4 all landed on this shape and it is what makes a planner this
 * large testable at all: every state -- a half-typed maximum, a federation whose
 * published profile is illegal, a plan nobody has agreed to, a unit changed with
 * three hundred kilograms already on screen -- is reachable from a story and a
 * browser test by handing in a session, with no network and no storage behind it.
 *
 * WHAT THIS ROOT KNOWS THAT THE OTHERS DID NOT
 *
 * Two of its inputs are published data, and they arrive at different times and
 * for different reasons. The rule profiles are read once (`getMeetRuleProfiles`)
 * and decide what a legal weight is. The conversion chart is read *per
 * federation*, because §16 gives the pound column to the federation's own
 * printing -- and the federation here is a question the lifter answers rather
 * than something the page declares, so the chart has to be reloaded when the
 * answer changes. That is what `FEDERATION_CHANGE_EVENT` is for: this element
 * says which federation is now chosen, and `view.ts` -- the only file in the tool
 * that knows a transport exists (§5.8) -- decides what to do about it.
 *
 * EVERY ANSWER GOES THROUGH ONE PATH, AND MOST OF THEM CARRY TWO KEYS
 *
 * Controls report through the shared components' own composed events and are
 * identified by `data-field` read off `event.composedPath()` -- never
 * `event.target`, which is retargeted to this host for anything fired inside a
 * child's shadow tree and would leave every answer silently dropped (§5.8).
 * Almost every field in this tool exists once per contested lift, so the path is
 * read for `data-lift` as well, and an answer that names a lift the format does
 * not contest is dropped rather than written to a figure no control can show
 * back.
 *
 * THE PLAN IS RECOMPUTED, NEVER CACHED
 *
 * `buildPlan` is pure arithmetic over answers already in hand, and a cache would
 * introduce the one bug this shape cannot otherwise have: attempts on screen
 * belonging to a session the lifter has since changed. The one thing that *is*
 * cached is `MeetRules.from`, keyed on the profile object -- not to save the
 * work, but because a refused profile logs, and logging it on every keystroke
 * would bury the read that failed under a thousand copies of itself.
 *
 * A RUNNING MEET IS A SECOND SCREEN, NOT A SECOND ROOT
 *
 * `LiveRun` below is everything live mode needs, taken once when the meet starts
 * and then never re-read from the session. That is not caching either -- it is
 * the sentence `MEET_IS_RUNNING_NOTE` promises the lifter, that changing an
 * answer on the planning screens does not move a weight already on the board.
 * Recomputing the rules from the currently chosen federation would break it in
 * the worst available way: a lifter who taps a different federation while
 * standing at the expeditor's table would have the rest of their meet checked
 * against a rule book the first four attempts were never checked against.
 *
 * The one thing live mode still reads live is the conversion chart, because a
 * pound figure is a reading of a kilogram attempt (§16) and not a decision.
 *
 * §6.1'S TWO BRANCHES ARE TWO RUN OBJECTS, NOT ONE WIDENED ONE
 *
 * A coach running eight people has no plan for any of them -- no maximum was
 * agreed here, no §7 was walked through -- so three of `LiveRun`'s five fields
 * have nothing to hold. Widening it would make `lifterId`, `planning` and
 * `targets` optional and break the sentence its own header rests on, that the
 * fields are set at one instant and are meaningless apart. `CoachRun` sits
 * beside it instead, and the two are mutually exclusive by construction: the
 * §6.1 choice comes off the screen the moment either meet exists, so there is
 * never a device with both.
 *
 * What the two share is a document and a rule book, which is exactly what an
 * action needs. `#current` and `#commit` are that shared pair, so every §12 and
 * §13 handler below works in both modes without a second copy -- and a second
 * copy is precisely how one of the two would end up applying an action against
 * a stale timeline.
 */
import type { MeetFormat, MeetRuleProfile, PlatformLift } from '@platform-toolkit/data-contracts';
import type {
  AttemptRefusalCode,
  CalibrationReport,
  CoachBoardEntry,
  ConversionChart,
  HandlerAssignment,
  HandlerResponsibility,
  LiveLifter,
  LiveTarget,
  MeetAction,
  MeetActionProblem,
  MeetActionProblemCode,
  MeetTimeline,
  WarmupTimeline,
  WeightUnit,
} from '@platform-toolkit/domain';
import {
  HANDLER_RESPONSIBILITIES,
  MeetRules,
  applyMeetAction,
  createMeetDocument,
  findAttempt,
  liftsInFormat,
  startTimeline,
  takenOn,
  undo,
  undoableAction,
} from '@platform-toolkit/domain';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-notice';
import '@platform-toolkit/ui/ptk-text-field';
import {
  CHOICE_CHANGE_EVENT,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import { type NoticeTone } from '@platform-toolkit/ui/ptk-notice';
import {
  NUMBER_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-number-field';
import {
  TEXT_AREA_CHANGE_EVENT,
  type TextAreaChangeDetail,
} from '@platform-toolkit/ui/ptk-text-area';
import {
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-text-field';
import {
  TOGGLE_GROUP_CHANGE_EVENT,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui/ptk-toggle-group';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { systemClock, type Clock } from '../clock.js';

import './ptk-coach-board.js';
import './ptk-coach-roster.js';
import './ptk-handler-pack.js';
import './ptk-live-screen.js';
import './ptk-meet-calibration.js';
import './ptk-meet-checklist.js';
import './ptk-meet-library.js';
import './ptk-meet-pack.js';
import './ptk-meet-prep.js';
import './ptk-meet-record.js';
import './ptk-meet-summary.js';
import './ptk-meet-warmup.js';
import './ptk-plan-extras.js';
import './ptk-plan-method.js';
import './ptk-plan-screen.js';
import './ptk-planner-setup.js';

import { buildBoardView } from './board.js';
import {
  BACK_TO_BOARD_LABEL,
  BACK_TO_PLAN_LABEL,
  COACH_MODE,
  CONVERSION_CONFIRMATION_NOTE,
  CONVERT_ANSWER,
  HANDLER_PACK_HEADING,
  HANDLER_PACK_HIDE_LABEL,
  HANDLER_PACK_SHOW_LABEL,
  HANDLER_PACK_SUMMARY,
  LIFTER_NAME_HINT,
  LIFTER_NAME_LABEL,
  MEET_CREATE_LABEL,
  MEET_IMPORT_CANCEL_LABEL,
  MEET_IMPORT_CONFIRM_LABEL,
  MEET_IS_RUNNING_NOTE,
  MEET_NAME_HINT,
  MEET_NAME_LABEL,
  MEET_NAMING_HEADING,
  MODE_CHOICES,
  MODE_LABEL,
  NOTHING_TO_UNDO,
  NO_COLOUR,
  PACK_HEADING,
  PACK_HIDE_LABEL,
  PACK_PRINT_NOTE,
  PACK_SHOW_LABEL,
  PACK_SUMMARY,
  PREP_HEADING,
  PREP_SUMMARY,
  RECORD_FOLD_LABEL,
  RECORD_FOLD_SUMMARY,
  RECORD_SUBJECT_LABEL,
  RESTORE_METHODOLOGY_MOVED,
  RESTORE_PROFILE_MISSING,
  RESTORE_RULEBOOK_MOVED,
  RETURN_TO_MEET_LABEL,
  START_MEET_HEADING,
  START_MEET_LABEL,
  START_MEET_NEEDS_A_PLAN,
  START_MEET_NOTE,
  UNIT_CHOICES,
  UNIT_LABEL,
  WARMUP_FOLD_LABEL,
  WARMUP_FOLD_SUMMARY,
  WARMUP_LIFT_LABEL,
  conversionChoices,
  conversionQuestion,
  importOutcomeSentence,
  importPreviewSentence,
  libraryRefusalSentence,
  meetExportFilename,
  meetFileRefusalSentence,
  meetProblemSentence,
  meetSavedSentence,
  openMeetSentence,
  recordSubjectChoices,
  undoLabel,
  warmupLiftChoices,
} from './copy.js';
import {
  AGE_FIELD,
  ATTEMPT_FIELDS,
  BOARD_LIFTER_FIELD,
  BODYWEIGHT_FIELD,
  CEILING_FIELD,
  CHECKLIST_GROUP_FIELD,
  COMPARISON_FIELD,
  CONFIRM_FIELD,
  CONVERT_FIELD,
  CUSTOM_ITEM_FIELD,
  EQUIPMENT_FIELD,
  EVIDENCE_AGE_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  FEDERATION_FIELD,
  FIRST_MEET_FIELD,
  FORMAT_FIELD,
  GOAL_FIELD,
  GUIDED_AGE_FIELD,
  GUIDED_EQUIPMENT_FIELD,
  GUIDED_REPS_FIELD,
  GUIDED_RESERVE_FIELD,
  GUIDED_STANDARD_FIELD,
  GUIDED_WEIGHT_FIELD,
  HARD_CUT_FIELD,
  LIFTER_NAME_FIELD,
  MAXIMUM_JUMP_FIELD,
  MAXIMUM_SOURCE_FIELD,
  MEET_NAME_FIELD,
  METHOD_FIELD,
  MINIMUM_JUMP_FIELD,
  MINIMUM_TOTAL_FIELD,
  MODE_FIELD,
  OPENER_FIELD,
  OPENER_TESTED_FIELD,
  PERSONAL_RECORD_FIELD,
  PERSONAL_RECORD_TOTAL_FIELD,
  PREP_NOTES_FIELD,
  PRIOR_MEETS_FIELD,
  QUALIFYING_TOTAL_FIELD,
  READINESS_FIELD,
  RECORD_SUBJECT_ATTRIBUTE,
  RECORD_SUBJECT_FIELD,
  ROSTER_COLOUR_FIELD,
  ROSTER_HANDLER_DUTIES_FIELD,
  ROSTER_HANDLER_INDEX_FIELD,
  ROSTER_HANDLER_NAME_FIELD,
  ROSTER_IDENTIFIER_FIELD,
  ROSTER_NAME_FIELD,
  ROSTER_RACK_FIELD,
  STRETCH_TOTAL_FIELD,
  TARGET_TOTAL_FIELD,
  UNIT_FIELD,
  WARMUP_LIFT_FIELD,
  WARMUP_SUBJECT_FIELD,
  isSetupField,
} from './fields.js';
import { calibrateLibrary } from './history.js';
import {
  EMPTY_LIVE_VIEW,
  NOTHING_OBSERVED,
  NO_PLANNING_AT_ALL,
  buildLiveView,
  positionOf,
  type LivePlanning,
} from './live.js';
import { livePlanningFrom, liveTargetsFrom, seedLiveMeet } from './live-session.js';
import { readMeetFile, writeMeetFile } from './meet-file.js';
import { noMeetStore, type MeetStore, type SaveOutcome } from './meet-store.js';
import {
  EMPTY_PREP,
  addCustomItem,
  checklistFor,
  removeCustomItem,
  withCheckedRows,
  withPrepNotes,
  withSetupAnswer,
  type ChecklistContext,
  type CustomItemRefusal,
  type MeetPrep,
} from './prep.js';
import { ATTEMPT_RESULT_EVENT, type AttemptResultDetail } from './ptk-attempt-result.js';
import {
  BOARD_OPEN_EVENT,
  BOARD_PIN_EVENT,
  type BoardOpenDetail,
  type BoardPinDetail,
} from './ptk-coach-board.js';
import {
  ROSTER_ADD_EVENT,
  ROSTER_HANDLER_ADD_EVENT,
  ROSTER_HANDLER_REMOVE_EVENT,
  type RosterAddDetail,
  type RosterHandlerAddDetail,
  type RosterHandlerRemoveDetail,
  type RosterLifter,
} from './ptk-coach-roster.js';
import { LIVE_CHOICE_EVENT, type LiveChoiceDetail } from './ptk-live-choices.js';
import { UNDO_REQUEST_EVENT, type UndoRequestDetail } from './ptk-live-screen.js';
import {
  PREP_ADD_ITEM_EVENT,
  PREP_REMOVE_ITEM_EVENT,
  type PrepAddItemDetail,
  type PrepRemoveItemDetail,
} from './ptk-meet-checklist.js';
import {
  MEET_COMMAND_EVENT,
  MEET_DELETE_ALL_EVENT,
  MEET_EXPORT_EVENT,
  MEET_IMPORT_EVENT,
  type MeetCommandDetail,
  type MeetImportDetail,
} from './ptk-meet-library.js';
import { MEET_RECORD_CHANGE_EVENT, type MeetRecordChangeDetail } from './ptk-meet-record.js';
import { MEET_WARMUP_CHANGE_EVENT, type MeetWarmupChangeDetail } from './ptk-meet-warmup.js';
import { CONFIRM_VALUE } from './ptk-plan-method.js';
import type { ProfilesStatus } from './ptk-planner-setup.js';
import {
  SUBMISSION_MARKED_EVENT,
  type SubmissionMarkedDetail,
} from './ptk-submission-countdown.js';
import { buildHandlerPack, buildMeetPack, type HandlerPack, type MeetPack } from './pack.js';
import { EMPTY_VIEW, buildPlan, type PlanContext, type PlannerView } from './plan.js';
import {
  EMPTY_RECORD_STATES,
  NO_RECORDS,
  RECORD_SUBJECTS,
  isBlankRecord,
  liftForSubject,
  recordSubjectIn,
  recordSubjectsIn,
  recordsFor,
  withRecordFor,
  withRecordForLifter,
  type MeetRecordState,
  type RecordAttemptSubject,
  type RecordStates,
  type RecordSubject,
  type RecordsByLifter,
} from './records.js';
import {
  EMPTY_LIBRARY,
  NO_WARMUP_ANSWERS,
  SAVED_MEET_METHODOLOGY_VERSION,
  activeMeet,
  archiveMeet,
  createMeet,
  deleteMeet,
  duplicateMeet,
  fromSavedPrep,
  fromSavedRecords,
  fromSavedWarmup,
  importMeets,
  openMeet,
  previewImport,
  readMeetName,
  renameMeet,
  saveMeetState,
  toSavedPrep,
  toSavedRecords,
  toSavedWarmup,
  type ImportPreview,
  type LibraryChange,
  type MeetLibrary,
  type RecordAnswers,
  type SavedCoachEntry,
  type SavedHistory,
  type SavedMeet,
  type SavedMeetState,
  type SavedRecords,
  type SavedWarmup,
} from './saved-meet.js';
import {
  EMPTY_SESSION,
  answerFromValue,
  comparisonFromValue,
  confirmMaximum,
  convertFigures,
  equipmentFromValue,
  evidenceAgeFromValue,
  firstMeetFromValue,
  formatFromValue,
  goalFromValue,
  hasTypedWeights,
  historyEquipmentFor,
  loadSession,
  maximumSourceFromValue,
  methodFromValue,
  readinessFromValue,
  reserveFromValue,
  saveSession,
  sessionLifts,
  unitFromValue,
  withExtras,
  withFigures,
  withSetup,
  withTargetTotal,
  withTargets,
  withUnit,
  type PlannerSession,
} from './session.js';
import { summariseMeet, type MeetSummary } from './summary.js';
import {
  EMPTY_WARMUP_STATES,
  NO_WARMUPS,
  buildMeetWarmup,
  warmupsFor,
  withWarmupFor,
  withWarmupForLifter,
  type MeetWarmupState,
  type WarmupStates,
  type WarmupSubject,
  type WarmupsByLifter,
} from './warmup.js';

/** Fired when the lifter picks a federation, so the transport can follow it. */
export const FEDERATION_CHANGE_EVENT = 'ptk-meet-day-federation-change';

export interface FederationChangeDetail {
  /** The chosen profile's identifier. Never the empty string. */
  readonly federationId: string;
}

/** §6.1's opening choice, which decides which of the two runs below can exist. */
type PlannerMode = 'solo' | 'coach';

/**
 * What every §12 and §13 action needs, whichever branch produced the meet.
 *
 * The rule book is part of it rather than read from the session, and that is the
 * whole point of the pair: an action is checked against the rules the meet was
 * created under, not against whatever federation is currently selected.
 */
interface RunningMeet {
  readonly rules: MeetRules;
  readonly timeline: MeetTimeline;
}

/**
 * A meet in progress: the document, and everything it is being run against.
 *
 * One object rather than five state fields, because all five are set at the same
 * instant and are meaningless apart. A separate `rules` field would sooner or
 * later be updated by something that had a fresher one, and the failure -- a meet
 * half-run under two rule books -- looks like nothing at all on screen.
 *
 * `rules`, `view`, `planning` and `targets` are the answers as they stood when
 * the meet started and are never refreshed. See the header: the planning screens
 * remain open behind live mode, and a weight already on the board does not move
 * because somebody corrected a figure that produced it.
 */
interface LiveRun extends RunningMeet {
  readonly lifterId: string;
  /**
   * The plan the meet was started from, for §26's planned-versus-selected line.
   *
   * Frozen here rather than re-read through `#view()` for the reason `planning`
   * is, and the summary is where it would show worst: a lifter who edited the
   * plan behind live mode would be shown, after the meet, a comparison against
   * attempts they never walked out with -- and every "you went above the plan"
   * line on the page would be measuring an edit rather than a decision. It comes
   * off the same object at the same instant as `planning`, which is built from
   * it, so the two cannot disagree.
   */
  readonly view: PlannerView;
  readonly planning: LivePlanning;
  readonly targets: readonly LiveTarget[];
}

/**
 * §6.1's other branch: a room, rather than a lifter.
 *
 * `entries` is the per-device context §21 asks for -- what this phone calls each
 * lifter, and which of them are pinned. It is deliberately *not* in the meet
 * document: none of it is a fact about the meet, and after §24 the document is
 * something two phones share while the entries are not.
 *
 * The entries are saved with the meet as of §24, less `warmup` -- which is a
 * schedule counted from an instant, so storing it stores a stopwatch and a meet
 * reopened tomorrow would announce a warm-up that was due nineteen hours ago.
 * `saved-meet.ts` carries the argument in full. **Nothing ever sets that field
 * on this list**, which is what makes the omission structural rather than a rule
 * `savedEntry` has to keep remembering: §20's schedule is attached in
 * `#boardEntries`, at paint time, to a copy handed straight to the board and
 * thrown away afterwards. So a restored board has none for the same reason a
 * fresh one has none, and there is no rebuild to perform.
 *
 * That this list is saved at all is a change of position and worth saying so:
 * §2.3 keeps a lifter's own figures off the disk by default, and the entries are
 * keyed to a list of athletes' names. What makes it right here is that §24
 * saves the meet *document* -- which holds those names -- and only ever under a
 * name the lifter typed into a box that says what naming it does. The entries
 * are not a second disclosure; leaving them out would mean a restored board came
 * back with every lot number and colour blank beside the names they belong to.
 *
 * `openLifterId` is which screen is up rather than which lifter matters. The
 * board's own focus row is computed by the domain and changes as clocks run
 * down; this only moves when a coach taps §21.1's switch.
 */
interface CoachRun extends RunningMeet {
  readonly entries: readonly CoachBoardEntry[];
  readonly openLifterId: string | null;
}

/**
 * The fields a `SavedMeetState` is assembled from, held for comparison.
 *
 * §24.1 lists ten material actions to save after, and the alternative to this is
 * a save call at each of them -- ten call sites, growing by one every time an
 * action is added, and silently one short the first time somebody forgets. Every
 * one of those actions writes one of the fields below, every one of them is
 * replaced wholesale rather than mutated, and `@state` already compares them by
 * identity to decide whether to repaint. So an identity check per field in
 * `updated` is exact, costs nothing, and cannot be forgotten by a handler that
 * has not been written yet.
 *
 * Costing nothing matters: the live screen repaints four times a second off the
 * clock seam, so this runs four times a second for the whole of a meet.
 * `meet-store.ts` makes the same argument for the map it compares by reference.
 *
 * The three warm-up fields are held separately rather than folded into `live`
 * and `coach`, because they are answered from the *planning* screen as well --
 * §20's fold is open the night before, with no run of either kind. Reading them
 * off a run would mean an evening's worth of answers that auto-save records as
 * no change at all. §19's three are here for exactly that reason and are the
 * case that proves it: the record fold is answerable from the moment a
 * federation is chosen, which is earlier than either run exists.
 */
interface StateSnapshot {
  readonly mode: PlannerMode;
  readonly session: PlannerSession;
  readonly prep: MeetPrep;
  readonly live: LiveRun | null;
  readonly coach: CoachRun | null;
  readonly warmups: WarmupStates;
  readonly warmupLift: PlatformLift;
  readonly coachWarmups: WarmupsByLifter;
  readonly records: RecordStates;
  readonly recordSubject: RecordSubject;
  readonly coachRecords: RecordsByLifter;
}

@customElement('ptk-meet-day-planner')
export class PtkMeetDayPlanner extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-xl);
      container-type: inline-size;
    }

    /*
     * The question a unit change asks, marked out from the setup above it. It
     * appears between two controls the lifter is already using, so without a
     * border it reads as a third setup question rather than as something waiting
     * on an answer.
     */
    .convert {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .convert p {
      margin: 0;
    }

    .note {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .start,
    .running {
      display: grid;
      gap: var(--ptk-space-sm);
      justify-items: start;
    }

    .start h2 {
      margin: 0;
    }

    .start p,
    .running p {
      margin: 0;
    }

    /*
     * The name field and the two navigation buttons stretch, because a control
     * sized to its own label lands wherever the label happens to end -- which on
     * a 320px column is a 90px "Start the meet" floating in the middle of a row
     * a thumb is aiming at (§5.7).
     */
    .start ptk-text-field,
    .start ptk-button,
    .running ptk-button {
      width: 100%;
    }

    /*
     * §24's naming block, and the sentence that replaces it once there is a
     * meet. The same shape as the Start block above because it is the same kind
     * of thing -- a heading, a box, a sentence saying what the press does -- and
     * two visually different treatments for two name fields on one screen would
     * read as one of them being the more important.
     */
    .naming {
      display: grid;
      gap: var(--ptk-space-sm);
      justify-items: start;
    }

    .naming h2 {
      margin: 0;
    }

    .naming p {
      margin: 0;
    }

    .naming ptk-text-field,
    .naming ptk-button {
      width: 100%;
    }

    /*
     * §24.4's preview, bordered for the reason the convert panel is: it appears between
     * controls the lifter is already using and is waiting on an answer, so
     * without the border it reads as another part of the shelf rather than as a
     * question.
     */
    .importing {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .importing p {
      margin: 0;
    }

    /*
     * An auto-fit grid over the element's own width (§5.7), so the two answers
     * sit side by side where there is room and stack on a phone with no media
     * query. The min(100%, ...) is what collapses the row instead of overflowing
     * it.
     */
    .importing .answers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
      gap: var(--ptk-space-xs);
    }

    .problems,
    .live-problems {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /*
     * Everything on this element except §23's sheet, in one box that is not a
     * box.
     *
     * display: contents means the wrapper draws nothing and its children are
     * the host grid's own items, so the screen lays out exactly as it did
     * before it existed. What it buys is the print rule below: one selector
     * takes the whole interactive screen off the paper, instead of a list of
     * controls that goes stale the next time one is added. A div with no role
     * is also the one element display: contents is uncontroversial on -- it
     * contributes nothing to the accessibility tree either way.
     *
     * It is rendered only where a sheet is rendered beside it. Otherwise the
     * print rule would empty a page and put nothing in its place, which on the
     * platform screen is a lifter pressing Print and getting a blank sheet.
     */
    .screen {
      display: contents;
    }

    .pack {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .pack h2 {
      margin: 0;
    }

    /*
     * Full width for the reason the Start control is (above): a control sized
     * to its own label lands wherever the label happens to end.
     */
    .pack ptk-button {
      width: 100%;
    }

    /*
     * Shut on screen, and note that this is the *only* thing that shuts it. The
     * sheet is in the DOM from the first paint whatever the toggle says, which
     * is what makes PACK_PRINT_NOTE true: a template branch would give a blank
     * page to every lifter who never pressed Show, with nothing on screen
     * saying why.
     *
     * data-shut rather than the hidden attribute because tokens.css writes
     * hidden as display: none !important, and no print rule can outrank that.
     */
    ptk-meet-pack[data-shut],
    ptk-handler-pack[data-shut] {
      display: none;
    }

    /*
     * Paper. One of the three files §23 has to be written across, and the only
     * one that can see this element's own children -- the page stylesheet
     * cannot reach in here and this block cannot reach out.
     */
    @media print {
      .screen {
        display: none;
      }

      /*
       * The heading, the summary, the toggle and the note are all about the
       * screen. The sheet carries its own title and the rulebook it was built
       * against, which is the part that has to survive a photocopy.
       */
      .pack h2,
      .pack .note,
      .pack ptk-button {
        display: none;
      }

      ptk-meet-pack[data-shut],
      ptk-handler-pack[data-shut] {
        display: block;
      }
    }
  `;

  /**
   * Where the remembered answers live.
   *
   * Defaulted to a store with no backing so the element stands up in a story or
   * a test with no branch anywhere -- and so the configuration these tools
   * actually ship into, an iframe whose embedder blocked storage, is the
   * supported path rather than the exceptional one (§5.12).
   */
  @property({ attribute: false }) settings: PreferenceStore = createPreferenceStore(null);

  /**
   * Where §24's saved meets live, defaulted to a store that keeps nothing.
   *
   * The same reasoning as `settings` above, and then the opposite conclusion,
   * which is the part worth reading. `settings` defaults to a working store over
   * no backing, because a preference that fails to stick costs a lifter one
   * re-tap. A saved meet is a document about a person, so this one defaults to
   * `noMeetStore` -- `persistence: 'none'` -- and §24 is then withdrawn from the
   * screen entirely rather than offered and refused. A story or a test that hands
   * in nothing therefore gets **no shelf**, not a shelf under a warning; pass
   * `sessionMeets()` for that screen. The fail-open version would keep a
   * bodyweight, an age and three maximums under an origin nobody chose.
   */
  @property({ attribute: false }) store: MeetStore = noMeetStore();

  /** The published rule profiles, or an empty list while there are none. */
  @property({ attribute: false }) profiles: readonly MeetRuleProfile[] = [];

  @property({ type: String }) status: ProfilesStatus = 'loading';

  /**
   * The chosen federation's published conversion chart, or `null` for none.
   *
   * `null` is the state the site opens in and is not a fault: §16 gives the
   * pound column to the federation's own printing, and a federation this project
   * has not transcribed a chart for gets a stated absence rather than a computed
   * figure.
   */
  @property({ attribute: false }) chart: ConversionChart | null = null;

  /**
   * Where "now" comes from, and what says when to draw §14.1's minute again.
   *
   * A property so a story and a browser test hand in `manualClock` and get a
   * photograph of one instant. The real clock is the default because the shipped
   * page has nothing to configure -- see `src/clock.ts` for why the seam exists
   * at all, and for why nothing below it reads the wall clock.
   */
  @property({ attribute: false }) clock: Clock = systemClock();

  @state() private session: PlannerSession = EMPTY_SESSION;

  /**
   * §6.1's answer, held here and written nowhere.
   *
   * Every other setup answer is a setting on a device (§13.4) and this one is
   * not, deliberately: a phone that opened straight onto a coach board because
   * it ran a flight last month would give a lifter a screen with no plan on it
   * and no obvious way back to one. It is a single tap at the top of the first
   * screen, which is cheaper than the state where the tool opens wrong.
   */
  @state() private mode: PlannerMode = 'solo';

  /** The meet, once one has started. `null` is the planning-only state. */
  @state() private live: LiveRun | null = null;

  /** §6.1's other meet. Never non-null at the same time as `live`. */
  @state() private coach: CoachRun | null = null;

  /**
   * Whether the lifter has stepped back to the planning screens mid-meet.
   *
   * Separate from `live` because going back must not end the meet: the whole
   * promise of `START_MEET_NOTE` is that the plan is still there and that
   * looking at it costs nothing.
   */
  @state() private viewingPlan = false;

  /**
   * §14's guard, and the one answer in this tool that is never written down.
   *
   * Not in `PlannerSession` and not in the preference store (§2.3, §13.4). It
   * exists between the lifter typing it and the meet document taking a copy, and
   * a reload before that loses it, which is the correct trade for not leaving an
   * athlete's name on a shared phone.
   */
  @state() private lifterName = '';

  /**
   * §21's roster box, held for the same reason and cleared the same way.
   *
   * A second field rather than reusing `lifterName`: both are a name in a text
   * box, they are on two different screens, and the root listens for both on the
   * same host. One field for the two means a coach's half-typed roster entry is
   * also the name a solo meet would start under.
   */
  @state() private rosterName = '';

  /**
   * Why the last weight was not accepted, in the rule set's own reason codes.
   *
   * Handed to the live screen, which renders them under the field they came
   * from. Kept apart from `problems` because these are answerable -- the lifter
   * types a different weight -- and the sentences below mostly are not.
   */
  @state() private refusals: readonly AttemptRefusalCode[] = [];

  /** What the document refused, as codes. Worded by `meetProblemSentence`. */
  @state() private problems: readonly MeetActionProblemCode[] = [];

  /**
   * §22's preparation document, held in memory and written to nothing.
   *
   * Deliberately not through `#setSession`, and this is the §13.4 line rather
   * than an oversight. The setup answers that *are* saved are settings on a
   * device -- a format, a unit, a goal -- and everything in here is a fact
   * about one specific meet: the rack height at that venue, the flight, the lot
   * number, and a bag packed for a Saturday. Saving them would mean a lifter
   * arriving at their second meet to last meet's rack heights presented as
   * theirs and half a checklist already ticked, which is worse than an empty
   * form because it is wrong rather than blank.
   *
   * §24 does write it down, and does not contradict any of that: it is saved
   * into one *named meet* alongside that meet's plan and board, rather than
   * carried forward into the next one as a device setting. A lifter who never
   * names a meet still has it held in memory and written to nothing.
   */
  @state() private prep: MeetPrep = EMPTY_PREP;

  /**
   * §22.2's add box, owned here so that an accepted row can empty it.
   *
   * The same shape as `rosterName` next door and for the same reason: the
   * element reports the text with the press, the root decides, and only the
   * root can clear the box. A box the element owned would keep the row that was
   * just added, and the next one typed over it would be refused as a duplicate.
   */
  @state() private customItemText = '';

  /** Why the last row was refused, or `null`. Cleared by retyping, not by time. */
  @state() private customItemRefusal: CustomItemRefusal | null = null;

  /**
   * Whether §23's sheet is on the screen. It is on the paper either way.
   *
   * Two things about this are decisions rather than details, and both were
   * arrived at from the same constraint -- that a print rule cannot cross a
   * shadow boundary in either direction:
   *
   * **Not a `ptk-disclosure`.** Every other long thing on this screen is behind
   * one, and this cannot be: a `<details>` inside the fold's own shadow root is
   * reachable by neither this element's `static styles` nor the page's
   * stylesheet, so nothing could force it open for printing. A shut fold prints
   * shut or prints open depending on the engine, and either way the choice was
   * made by whoever last tapped it. So the section is a heading, a button and
   * the sheet, all in *this* shadow root, where the `@media print` block above
   * can reach every one of them.
   *
   * **The sheet is always rendered and hidden with CSS, never dropped from the
   * template.** `PACK_PRINT_NOTE` promises that the browser's own Print command
   * produces the sheet whatever else is on the screen, and a template branch
   * would make that false for the state the screen opens in -- Print would give
   * a blank page and there would be nothing on screen saying why. The attribute
   * is `data-shut` rather than `hidden` because `tokens.css` writes
   * `[hidden] { display: none !important }`, which no print rule can outrank.
   */
  @state() private showingPack = false;

  /** §23.2's roster sheet on the coach board. Same reasoning as `showingPack`. */
  @state() private showingRoster = false;

  /**
   * The unit the figures on screen were typed in, while that differs from the
   * unit they are being read in.
   *
   * Holds the *original* unit rather than the previous one, so a lifter who
   * flicks kg to lb and back finds the question gone rather than reversed -- the
   * digits never moved, and by then they are being read in the unit they were
   * typed in again.
   */
  @state() private typedIn: WeightUnit | null = null;

  /*
   * ---------------------------------------------------------------------------
   * §20: the warm-up room.
   * ---------------------------------------------------------------------------
   */

  /**
   * Every answer the warm-up fold has taken, one record per platform lift.
   *
   * Total over `PlatformLift` rather than one state cleared when the picker
   * moves, for the reason `session.ts` holds every method's figures for every
   * lift: the way a lifter uses this is to set the squat ramp up in the morning,
   * walk away, and come back to it after the bench. A shared state would hand
   * them the bench room and the bench sets under a heading saying squat, and the
   * squat answers would be gone with nothing on screen saying they ever existed.
   *
   * The element never writes its own `state` property -- it reports a whole
   * `MeetWarmupState` and this is the only writer -- so a change here is the
   * only way the fold can move.
   */
  @state() private warmups: WarmupStates = EMPTY_WARMUP_STATES;

  /**
   * Which lift the fold is showing, as the picker last answered it.
   *
   * Held rather than derived because it is a choice, and clamped rather than
   * corrected because a format change must not silently rewrite one: a lifter
   * who fixes the format to bench-only after answering for the squat gets the
   * bench fold, and their squat answers are still in `warmups` for the day they
   * put the format back.
   */
  @state() private warmupLift: PlatformLift = 'squat';

  /**
   * The same answers on the coach path, one whole record per lifter.
   *
   * Separate from `warmups` above rather than a superset of it, because the two
   * are answers about different people: `warmups` is the coach's own ramp on
   * their own plan screen, and this is what they have typed about each athlete
   * they came with. Folding the solo state in under a synthetic id would make
   * every read of it a lookup that can miss.
   *
   * Saved with the meet, as `SavedWarmup.byLifter`, and sparse: the map gains a
   * key only when a coach types something about that athlete, so the file carries
   * an entry per lifter answered for rather than per lifter on the roster. That
   * matters here more than on the solo path -- three lifts of `Equipment` is
   * about five kilobytes, and a full flight of them would be most of what the
   * store has.
   */
  @state() private coachWarmups: WarmupsByLifter = NO_WARMUPS;

  /**
   * Last paint's warm-up schedule per lifter, and what it was built from.
   *
   * **This is a correctness requirement and not an optimisation**, which is the
   * opposite of how a cache in a render usually reads. `buildMeetWarmup` stamps
   * the instant it was called at onto `WarmupTimeline.builtAt` and computes
   * nothing else from it; `timelineWindows` and `nextWindow` then age the
   * schedule by `now - builtAt`. The board repaints four times a second, so a
   * rebuild per paint re-stamps `builtAt` to the instant it is being read at,
   * every countdown on §21's board sits forever at the figure it opened with,
   * and no lifter ever climbs the urgency ladder. The screen looks alive and is
   * frozen, which is the worst version of this failure.
   *
   * Keyed on everything `buildMeetWarmup` reads *apart from* `now`: the answers
   * by object identity -- `warmup.ts`'s writers replace the state wholesale, so
   * identity is exact here rather than approximate -- plus the lift, the opener,
   * the format and the rule book the attempt count comes off.
   *
   * A plain field and not `@state`, deliberately. Writing it must not schedule a
   * repaint: it is written *during* one.
   */
  readonly #warmupTimelines = new Map<
    string,
    {
      readonly state: MeetWarmupState;
      readonly lift: PlatformLift;
      readonly opener: number | undefined;
      readonly format: MeetFormat;
      readonly rules: MeetRules;
      readonly timeline: WarmupTimeline | null;
    }
  >();

  /*
   * ---------------------------------------------------------------------------
   * §19: the record attempt.
   * ---------------------------------------------------------------------------
   */

  /**
   * Every record the fold has been told about, one per subject.
   *
   * §20's shape, for §20's reason: a lifter chasing a total is chasing three
   * separate figures off the same published list, and a shared state would hand
   * them the squat record under a heading saying deadlift.
   *
   * **Saved with the meet, and flagged on the way back.** This field carried the
   * opposite comment for one release -- that a record is a scratch pad in front
   * of a federation's list and a stale figure restored six weeks later is worse
   * than an empty box because it looks answered. `SavedRecords` reverses it and
   * says why at length: the objection is to *silence* about a restored figure
   * rather than to keeping one, and the answers are filled in on the Thursday
   * with the list open and read at the rack on the Saturday with no signal. What
   * pays for the reversal is `#restoredRecords` below.
   */
  @state() private records: RecordStates = EMPTY_RECORD_STATES;

  /**
   * Which record the fold is showing, as the picker last answered it.
   *
   * Held and clamped exactly as `warmupLift` is, with one difference that
   * matters: the answer is a `RecordSubject`, so `total` is a legal value and
   * is not a lift. Narrowing it against the session's lifts would silently drop
   * the total -- the one subject a lifter is most likely to be chasing.
   */
  @state() private recordSubject: RecordSubject = 'squat';

  /**
   * The same answers on the coach path, one whole record per lifter.
   *
   * Separate from `records` for the reason `coachWarmups` is separate from
   * `warmups`: the coach's own plan screen and the athletes they came with are
   * answers about different people.
   */
  @state() private coachRecords: RecordsByLifter = NO_RECORDS;

  /**
   * Exactly the record answers that came off a saved meet, by object identity.
   *
   * The provenance behind `ptk-meet-record`'s `restored` flag, which is what §24
   * saving these answers at all is paid for with. It holds the state objects
   * `#restore` handed over and nothing else, so the fold's question -- "is the
   * thing I am about to draw still the thing that came off the disk?" -- is one
   * `has`.
   *
   * WHY IDENTITY AND NOT A BOOLEAN
   *
   * A single flag cleared on the first keystroke is the obvious version and is
   * wrong in the direction this whole feature exists to avoid. A coach holds four
   * lifters times four subjects; retyping one of them would drop the caveat off
   * the other fifteen, which then look freshly checked and are not. Identity
   * scopes it exactly, and for free: every writer in `records.ts` replaces the
   * state wholesale (`withRecordFor` builds a new object, `withRecord` spreads),
   * so an answer somebody has retyped is a different object and falls out of the
   * set by having never been in it. That is the same property `#snapshot` and
   * `#savedWarmup` already rely on, asked from the other end.
   *
   * WHY A `WeakSet`
   *
   * It is only ever asked `has`, never iterated or counted, and holding strong
   * references to four states per lifter for every meet ever opened in one
   * sitting is a retention nobody would notice going wrong. Blank states are
   * deliberately kept out of it -- see `#markRestored` -- because a fold nobody
   * typed into has no figure to be stale, and a caveat over an empty box is a
   * warning about nothing.
   */
  readonly #restoredRecords = new WeakSet<MeetRecordState>();

  /*
   * ---------------------------------------------------------------------------
   * §24: the shelf, the open meet, and what has been written down.
   * ---------------------------------------------------------------------------
   */

  /** Every saved meet on this device, plus which one is open. */
  @state() private library: MeetLibrary = EMPTY_LIBRARY;

  /** How many saved meets this build could not read. Handed to the shelf. */
  @state() private unreadable = 0;

  /** The one sentence the shelf shows about the last thing that was tried. */
  @state() private shelfMessage = '';

  /**
   * Whether that sentence is a refusal or a report.
   *
   * Defaulted to `error` for the reason the shelf's own property is: a refusal
   * shown as a quiet note is a lifter who believes their meet was saved.
   */
  @state() private shelfTone: NoticeTone = 'error';

  /** §24's naming box, cleared by the press that turns it into a meet. */
  @state() private meetName = '';

  /**
   * §24.4's "say before it does it", held between the file being read and the
   * lifter answering. `null` is every other moment.
   */
  @state() private importing: ImportPreview | null = null;

  /**
   * A meet read from the store before the rule profiles arrived.
   *
   * The store answers immediately and `profiles` is a network read, so on a
   * cold visit the meet to restore is known several hundred milliseconds before
   * the rule book it was planned under. Restoring the session anyway and the
   * document later would paint one screen, then a different one, and a lifter
   * typing into the first loses it. So the meet waits here until
   * `#restoreIfReady` can do the whole of it at once.
   */
  #pending: SavedMeet | null = null;

  /**
   * Which meet the screen currently belongs to, compared against the library.
   *
   * Not read off `library.activeMeetId` at the point of use: several commands
   * change which meet is open as a side effect of doing something else --
   * `duplicateMeet` opens the copy, `archiveMeet` closes the meet it archives --
   * so the screen has to notice the change rather than be told about it. Without
   * this, duplicating meet A while meet B is open leaves B's attempts on screen
   * and the next auto-save writes them over the copy of A.
   */
  #openMeetId: string | null = null;

  /**
   * The five fields as they were when the last save was started.
   *
   * Recorded *before* the write is awaited, deliberately. The state update that
   * carries the save's own result re-enters `updated`, and a snapshot taken
   * after the await would not be in place yet -- so the re-entry would find a
   * change, save again, and the two would take turns for as long as the screen
   * is open.
   */
  #lastSaved: StateSnapshot | null = null;

  /**
   * The writes, in the order they were started.
   *
   * A store write is asynchronous and the screen does not wait for it, so two
   * changes a keystroke apart are two overlapping writes -- and the store reads
   * the library, merges and writes it back, so the later one finishing first
   * loses the earlier one's meet. Chaining is enough because there is only ever
   * one writer.
   */
  #writing: Promise<void> = Promise.resolve();

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onText);
    this.addEventListener(TEXT_AREA_CHANGE_EVENT, this.#onTextArea);
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.addEventListener(PREP_ADD_ITEM_EVENT, this.#onPrepAddItem);
    this.addEventListener(PREP_REMOVE_ITEM_EVENT, this.#onPrepRemoveItem);
    this.addEventListener(MEET_WARMUP_CHANGE_EVENT, this.#onWarmupChange);
    this.addEventListener(MEET_RECORD_CHANGE_EVENT, this.#onRecordChange);
    this.addEventListener(LIVE_CHOICE_EVENT, this.#onLiveChoice);
    this.addEventListener(SUBMISSION_MARKED_EVENT, this.#onSubmissionMarked);
    this.addEventListener(ATTEMPT_RESULT_EVENT, this.#onAttemptResult);
    this.addEventListener(UNDO_REQUEST_EVENT, this.#onUndoRequest);
    this.addEventListener(ROSTER_ADD_EVENT, this.#onRosterAdd);
    this.addEventListener(ROSTER_HANDLER_ADD_EVENT, this.#onHandlerAdd);
    this.addEventListener(ROSTER_HANDLER_REMOVE_EVENT, this.#onHandlerRemove);
    this.addEventListener(BOARD_OPEN_EVENT, this.#onBoardOpen);
    this.addEventListener(BOARD_PIN_EVENT, this.#onBoardPin);
    this.addEventListener(MEET_COMMAND_EVENT, this.#onMeetCommand);
    this.addEventListener(MEET_EXPORT_EVENT, this.#onMeetExport);
    this.addEventListener(MEET_IMPORT_EVENT, this.#onMeetImport);
    this.addEventListener(MEET_DELETE_ALL_EVENT, this.#onDeleteEverything);
    this.#syncClock();
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.removeEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onText);
    this.removeEventListener(TEXT_AREA_CHANGE_EVENT, this.#onTextArea);
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.removeEventListener(PREP_ADD_ITEM_EVENT, this.#onPrepAddItem);
    this.removeEventListener(PREP_REMOVE_ITEM_EVENT, this.#onPrepRemoveItem);
    this.removeEventListener(MEET_WARMUP_CHANGE_EVENT, this.#onWarmupChange);
    this.removeEventListener(MEET_RECORD_CHANGE_EVENT, this.#onRecordChange);
    this.removeEventListener(LIVE_CHOICE_EVENT, this.#onLiveChoice);
    this.removeEventListener(SUBMISSION_MARKED_EVENT, this.#onSubmissionMarked);
    this.removeEventListener(ATTEMPT_RESULT_EVENT, this.#onAttemptResult);
    this.removeEventListener(UNDO_REQUEST_EVENT, this.#onUndoRequest);
    this.removeEventListener(ROSTER_ADD_EVENT, this.#onRosterAdd);
    this.removeEventListener(ROSTER_HANDLER_ADD_EVENT, this.#onHandlerAdd);
    this.removeEventListener(ROSTER_HANDLER_REMOVE_EVENT, this.#onHandlerRemove);
    this.removeEventListener(BOARD_OPEN_EVENT, this.#onBoardOpen);
    this.removeEventListener(BOARD_PIN_EVENT, this.#onBoardPin);
    this.removeEventListener(MEET_COMMAND_EVENT, this.#onMeetCommand);
    this.removeEventListener(MEET_EXPORT_EVENT, this.#onMeetExport);
    this.removeEventListener(MEET_IMPORT_EVENT, this.#onMeetImport);
    this.removeEventListener(MEET_DELETE_ALL_EVENT, this.#onDeleteEverything);
    // Dropped rather than left running. An interval outliving the element is a
    // repaint request against a detached tree four times a second, for as long
    // as the page is open.
    this.#stopWatching();
    super.disconnectedCallback();
  }

  /**
   * Restores from the store whenever it is handed in or swapped out.
   *
   * Not `connectedCallback`: Lit records the class-field default as changed on
   * the first update, so this runs once before the first render either way, and
   * it *also* runs when `view.ts` or a story replaces the store afterwards.
   * Restoring only on connect shows defaults over a device that remembers
   * something else, on some visits and not others.
   *
   * The clock is synced here rather than after the render because the two things
   * that decide whether it should tick -- `live` and `viewingPlan` -- are already
   * their new values by the time this runs.
   *
   * §24's shelf is loaded on exactly the same terms and for the same reasons.
   * `#restoreIfReady` runs *after* the settings branch and not before it: a
   * resumed meet carries the session it was planned with, and the device
   * defaults would otherwise be written over it on the same update that
   * restored it -- a lifter resuming a pound-unit meet on a phone set to
   * kilograms, with every figure re-read in the wrong unit.
   */
  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('settings')) {
      this.session = loadSession(this.settings);
    }
    if (changed.has('store')) {
      this.#loadLibrary();
    }
    this.#restoreIfReady();
    this.#syncClock();
  }

  /**
   * §24.1's ten material actions, answered once rather than ten times.
   *
   * The alternative is a `#save()` call at each of them: ten call sites today,
   * one more every time an action is added, and silently one short the first
   * time somebody forgets -- which is a lifter losing the attempt they just
   * recorded and nothing on screen saying so. Every one of those ten writes one
   * of `StateSnapshot`'s fields, every one is replaced wholesale rather than
   * mutated, so a field-by-field identity check here is exact and cannot be
   * forgotten by a handler nobody has written yet.
   *
   * `updated` rather than `willUpdate`, because a save is a consequence of a
   * change rather than part of deciding what to draw -- and because the state
   * update carrying the save's own outcome must not run inside the update that
   * provoked it.
   */
  override updated(): void {
    if (this.#openMeetId === null) return;
    const snapshot = this.#snapshot();
    if (this.#lastSaved !== null && sameState(this.#lastSaved, snapshot)) return;
    this.#lastSaved = snapshot;
    this.#save(this.#openMeetId);
  }

  /** One of four screens: the room, one of its lifters, the plan, or the platform. */
  override render(): TemplateResult {
    if (this.mode === 'coach') return this.#renderCoach(this.coach);
    const run = this.live;
    return run !== null && !this.viewingPlan ? this.#renderLive(run) : this.#renderPlanning();
  }

  /**
   * §6.1's opening choice, while there is still a choice to make.
   *
   * Off the screen the moment either meet exists. Switching branch abandons a
   * document -- a coach's whole flight, or a lifter's four recorded attempts --
   * and it would be one tap on the control a thumb reaches first. There is no
   * confirmation here instead, because the answer to "are you sure" on a phone
   * held in one hand at a meet is yes, always, and the meet is still gone.
   */
  #renderMode(): TemplateResult | typeof nothing {
    if (this.live !== null || this.coach !== null) return nothing;
    return html`
      <ptk-choice-group
        data-field=${MODE_FIELD}
        label=${MODE_LABEL}
        .choices=${MODE_CHOICES}
        .value=${this.mode}
      ></ptk-choice-group>
    `;
  }

  /**
   * §6.1's coach branch: the board, and who is on it.
   *
   * The setup questions are replaced by the unit question alone once the meet
   * exists, rather than left on screen doing nothing. `createMeetDocument` takes
   * the rules and the meet type once and they are fixed from then on -- which is
   * what `ROSTER_STARTS_THE_MEET` says before the first lifter is added -- and a
   * federation tile that still highlights while changing nothing is a promise
   * the tool would be breaking silently.
   *
   * The conversion question is rendered here as well as on the planning screens
   * because it is about the session's figures rather than about a screen: a
   * device that planned a solo meet and then switched to coach mode still has
   * typed weights, and a question raised with nowhere to appear would sit
   * unanswered until the lifter went back and found it waiting.
   */
  #renderCoach(run: CoachRun | null): TemplateResult {
    if (run !== null && run.openLifterId !== null) {
      return this.#renderCoachLifter(run, run.openLifterId);
    }
    // Read once, here, and shared with §23.2's sheet below. Twice in one paint
    // is two instants on one screen, and this screen is nothing but countdowns.
    const now = this.clock.now();
    // Read once as well, and for a stronger reason than `now`: the schedules on
    // the entries and the lift §23.2's sheet labels them with have to be the
    // same answer. Two calls are two sources of truth, and the failure is a
    // squat ramp printed under "Deadlift" on a sheet nobody can re-check.
    const warmupLift =
      run === null ? null : this.#warmupLiftIn(liftsInFormat(run.timeline.present.format));
    const board =
      run === null
        ? null
        : buildBoardView(run.timeline.present, {
            rules: run.rules,
            chart: this.chart,
            entries: this.#boardEntries(run, now, warmupLift),
            now,
            warmupLift: warmupLift ?? undefined,
          });
    const screen = html`
      ${this.#renderMode()}
      ${
        run === null
          ? html`
              <ptk-planner-setup
                .session=${this.session}
                .profiles=${this.profiles}
                status=${this.status}
                scope="coach"
              ></ptk-planner-setup>
            `
          : html`
              <ptk-choice-group
                data-field=${UNIT_FIELD}
                label=${UNIT_LABEL}
                .choices=${UNIT_CHOICES}
                .value=${this.session.setup.unit}
              ></ptk-choice-group>
            `
      }
      ${this.#renderConversion()} ${this.#renderProblems('problems')}
      ${
        board === null
          ? nothing
          : html`
              <ptk-coach-board .view=${board} .unit=${this.session.setup.unit}></ptk-coach-board>
            `
      }

      <ptk-coach-roster
        .lifters=${this.#rosterLifters(run)}
        name=${this.rosterName}
        ?ready=${this.#context() !== null}
      ></ptk-coach-roster>
      ${this.#renderShelf()}
    `;
    if (run === null || board === null) return screen;
    return html`
      <div class="screen">${screen}</div>
      ${this.#renderRoster(buildHandlerPack(run.timeline.present, board, this.chart, run.rules))}
    `;
  }

  /**
   * §21.1's one-tap switch: one lifter's own platform screen, off the board.
   *
   * The same element the solo path uses, with `NO_PLANNING_AT_ALL` and no
   * targets. That is not a stub -- a coach has agreed no maximum for this
   * athlete and set no goal for their day, so §13's cards carry the legal
   * choices and the rounding note and say nothing about a plan. Inventing a
   * planning context from the coach's own session would put the coach's targets
   * on somebody else's screen.
   *
   * `buildLiveView` answers `null` only for a lifter who is not in the document,
   * which `#onBoardOpen` has already checked against the same document. The
   * fallback is here because the return type says it can (§5.8: a property
   * binding assigns null over the child's own default).
   *
   * §26's summary is built with `EMPTY_VIEW`, no targets and `'unstated'`
   * equipment, for the reason the live view is built with `NO_PLANNING_AT_ALL`:
   * the plan, the targets and the equipment category on this device belong to the
   * coach's own session, and none of the three is a statement about the athlete on
   * the board. The cost is visible and correct -- the planned-versus-selected line
   * says there was no plan, and §9.4 will not file the meet into any scoped
   * history -- rather than a comparison against somebody else's numbers.
   *
   * §20's fold sits below the live screen and not above it, and not on the
   * finished branch at all. The attempt and its minute are what a coach opened
   * this screen for; the warm-up is what they set up once, in the morning, and
   * then read off §21's board for the rest of the day. A lifter whose meet is
   * over has nothing left to warm up for.
   */
  #renderCoachLifter(run: CoachRun, lifterId: string): TemplateResult {
    const view = buildLiveView(run.timeline, lifterId, {
      rules: run.rules,
      chart: this.chart,
      planning: NO_PLANNING_AT_ALL,
      targets: [],
      observed: NOTHING_OBSERVED,
      now: this.clock.now(),
    });
    return html`
      <ptk-button class="back" variant="secondary" @click=${this.#onBackToBoard}>
        ${BACK_TO_BOARD_LABEL}
      </ptk-button>

      ${this.#renderProblems('live-problems')}
      ${
        view?.position.meetOver === true
          ? this.#renderFinished(
              run,
              summariseMeet({
                rules: run.rules,
                chart: this.chart,
                timeline: run.timeline,
                lifterId,
                view: EMPTY_VIEW,
                targets: [],
                equipment: 'unstated',
              }),
              null,
            )
          : html`
              <ptk-live-screen
                .view=${view ?? EMPTY_LIVE_VIEW}
                .chart=${this.chart}
                .unit=${this.session.setup.unit}
                .refusals=${this.refusals}
              ></ptk-live-screen>
              ${this.#renderCoachWarmup(run, lifterId)} ${this.#renderCoachRecord(run, lifterId)}
            `
      }
    `;
  }

  /**
   * The meet's lifters, each with whatever this phone knows about them.
   *
   * Driven off the document rather than off the entries, so a lifter who has
   * been added and never set up still has a row to type an identifier into --
   * the entry is created by the first answer, which is what keeps an untouched
   * roster from carrying eight empty objects into §24's export.
   */
  #rosterLifters(run: CoachRun | null): readonly RosterLifter[] {
    if (run === null) return [];
    return run.timeline.present.lifters.map((lifter) => {
      const entry = run.entries.find((candidate) => candidate.lifterId === lifter.id);
      return {
        lifterId: lifter.id,
        name: lifter.name,
        identifier: entry?.identifier ?? '',
        colour: entry?.colour ?? null,
        // The entry's own list, unfiltered, unlike the board's. A handler is
        // added blank and named afterwards, so the screen the name is typed on
        // is the one screen that has to show a nameless row.
        handlers: entry?.handlers ?? [],
        rackId: entry?.rackId ?? '',
      };
    });
  }

  /**
   * The four children, over one session.
   *
   * `ptk-plan-method` is handed `EMPTY_VIEW` rather than the null, and the
   * fallback is load-bearing rather than defensive: a property binding *assigns*
   * null over a child's class-field default rather than leaving it alone, so the
   * child's own `view: PlannerView = EMPTY_VIEW` protects a case that never
   * arises and not this one. §7's questions have to be on screen before there is
   * a plan -- there is nothing to type a maximum into otherwise -- so the method
   * element takes the view of an unanswered session and the plan slot below
   * keeps the null, which is the only place the difference means anything.
   *
   * Getting this wrong threw on the first paint of every visit, and TypeScript
   * cannot see it: nothing type-checks a lit-html property binding.
   */
  #renderPlanning(): TemplateResult {
    const view = this.#view();
    const screen = html`
      ${this.#renderRunning()} ${this.#renderMode()}

      <ptk-planner-setup
        .session=${this.session}
        .profiles=${this.profiles}
        status=${this.status}
      ></ptk-planner-setup>

      ${this.#renderConversion()}

      <ptk-plan-method .session=${this.session} .view=${view ?? EMPTY_VIEW}></ptk-plan-method>

      <ptk-plan-extras .session=${this.session}></ptk-plan-extras>

      ${this.#renderPlan(view)} ${this.#renderStart(view)} ${this.#renderWarmup(view)}
      ${this.#renderRecord()} ${this.#renderPrep()} ${this.#renderShelf()}
    `;
    const pack = this.#meetPack(view);
    if (pack === null) return screen;
    return html`
      <div class="screen">${screen}</div>
      ${this.#renderPack(pack)}
    `;
  }

  /**
   * §23.1's sheet, or `null` before there is a rule book to build it against.
   *
   * Built on every paint of the planning screen and never memoised, for the
   * reason `liveChoicesFor` and `buildLiveView` are not (§13.1, §13.5): a
   * remembered sheet is free to disagree with the plan printed above it, and
   * the disagreement would be discovered on paper, in a gym bag, where it
   * cannot be corrected. It is not on the clock -- the solo planning screen
   * repaints on a keystroke and nothing else -- so the scratch timeline
   * `buildMeetPack` walks is built at the rate a lifter types.
   *
   * `at` is stamped on those scratch actions and never printed, which is what
   * makes reading the clock here safe where `apps/web/CLAUDE.md` says not to:
   * nothing on the sheet is a time, so two instants in one paint could not show
   * up as two.
   */
  #meetPack(view: PlannerView | null): MeetPack | null {
    const context = this.#context();
    if (context === null || view === null) return null;
    return buildMeetPack({
      rules: context.rules,
      chart: this.chart,
      session: this.session,
      view,
      prep: this.prep,
      checklistContext: this.#checklistContext(),
      lifterName: this.lifterName,
      at: this.clock.now(),
      // `this.warmups`, never `this.coachWarmups`: §23.1's sheet is printed by
      // the person who answered §20 on this device, and a handler has one set of
      // answers for twelve people. The roster's own warm-up figure stays the lead
      // `buildHandlerPack` already carries per lifter (§13.19).
      warmups: this.warmups,
    });
  }

  /**
   * §23.1 on the screen: a heading, a toggle, and the sheet under both.
   *
   * Deliberately not a `ptk-disclosure`, which is what everything else this
   * long on this screen is. A `<details>` lives inside the fold's own shadow
   * root, where neither this element's `static styles` nor the page stylesheet
   * can reach it -- so nothing could force it open for printing, and a fold
   * prints in whatever state the last tap left it in. The heading and the
   * button do the fold's job in a place the print rules can see.
   */
  #renderPack(pack: MeetPack): TemplateResult {
    return html`
      <section class="pack">
        <h2>${PACK_HEADING}</h2>
        <p class="note">${PACK_SUMMARY}</p>
        <ptk-button variant="secondary" @click=${this.#onTogglePack}>
          ${this.showingPack ? PACK_HIDE_LABEL : PACK_SHOW_LABEL}
        </ptk-button>
        <p class="note">${PACK_PRINT_NOTE}</p>
        <ptk-meet-pack .pack=${pack} ?data-shut=${!this.showingPack}></ptk-meet-pack>
      </section>
    `;
  }

  /** §23.2 on the coach board. The same arrangement, for the same reasons. */
  #renderRoster(pack: HandlerPack): TemplateResult {
    return html`
      <section class="pack">
        <h2>${HANDLER_PACK_HEADING}</h2>
        <p class="note">${HANDLER_PACK_SUMMARY}</p>
        <ptk-button variant="secondary" @click=${this.#onToggleRoster}>
          ${this.showingRoster ? HANDLER_PACK_HIDE_LABEL : HANDLER_PACK_SHOW_LABEL}
        </ptk-button>
        <p class="note">${PACK_PRINT_NOTE}</p>
        <ptk-handler-pack .pack=${pack} ?data-shut=${!this.showingRoster}></ptk-handler-pack>
      </section>
    `;
  }

  /**
   * §20, between the Start button and §22's fold.
   *
   * The ordering is the one `#renderPrep` below argues for, applied to a third
   * thing: the warm-up is more urgent than a packing list and less urgent than
   * the attempts it counts back from, so it sits between them. Folded, because
   * a lifter reading the plan at home has no use for it and a lifter in the
   * warm-up room has no use for anything else -- and the fold carries a `class`
   * for the reason §13.11's `back` and §13.14's `prep` do: `check:narrow` has to
   * open *this* one, and a bare `ptk-disclosure` selector opens whichever fold
   * happens to be first.
   *
   * Nothing is drawn without a rule book. `attemptsPerLift` comes off the
   * profile, and there is no honest source for it otherwise -- guessing three
   * would put a made-up figure into the estimate of how long a flight takes,
   * which is the one number on the screen a lifter acts on.
   *
   * `this.clock.now()` is read here, which `apps/web/CLAUDE.md` says not to do
   * in a render. The exemption is `#meetPack`'s exactly: `now` reaches
   * `buildMeetWarmup` and is stamped as `timeline.builtAt`, which no element
   * renders, and every figure on this screen is a relative range. Two instants
   * in one paint cannot show up as two.
   */
  #renderWarmup(view: PlannerView | null): TemplateResult | typeof nothing {
    const context = this.#context();
    if (context === null || view === null) return nothing;
    const lifts = view.lifts.map((entry) => entry.lift);
    const lift = this.#warmupLiftIn(lifts);
    if (lift === null) return nothing;
    // The opener rather than any other attempt, and off the view rather than
    // off the session, for the reason `live-session.ts` reads it there: the
    // figure on the view has been rounded onto the federation's grid and
    // clamped, so counting back from the typed one would ramp to a weight that
    // is not the one on the plan above it.
    const opener = view.lifts.find((entry) => entry.lift === lift)?.attempts[0]?.weight.kilograms;
    return this.#renderWarmupFold(
      lifts,
      lift,
      this.warmups[lift],
      warmupSubject(lift, opener, context.rules),
    );
  }

  /**
   * Which lift the fold is showing, clamped to the lifts on offer.
   *
   * Shared by both paths so the clamp cannot be spelled two ways. `null` means
   * there is no lift to show at all, which is a format contesting nothing --
   * unreachable through `MeetFormat` today and cheaper to answer than to argue
   * about at each call site.
   */
  #warmupLiftIn(lifts: readonly PlatformLift[]): PlatformLift | null {
    const first = lifts[0];
    if (first === undefined) return null;
    return lifts.includes(this.warmupLift) ? this.warmupLift : first;
  }

  /**
   * §20's fold itself, over whichever lifter's answers were handed in.
   *
   * One renderer for the plan screen and for a lifter opened off §21's board,
   * because the fold is the same fold: the same picker, the same element, the
   * same `data-warmup-subject` wrapper that `#warmupLiftOf` walks up to. What
   * differs between the two paths is only where the opener and the answers come
   * from, and both of those are arguments.
   *
   * The wrapper `<div>` carries the lift rather than `ptk-meet-warmup` itself,
   * and that is load-bearing: §13.14 records that an `attributeOf`-style walk up
   * the composed path is only exercised when the attribute sits *above* the
   * element the event was dispatched from, so putting it on the element would
   * leave the walk in `#warmupLiftOf` covered by nothing.
   */
  #renderWarmupFold(
    lifts: readonly PlatformLift[],
    lift: PlatformLift,
    state: MeetWarmupState,
    subject: WarmupSubject | null,
  ): TemplateResult {
    return html`
      <ptk-disclosure class="warmup" label=${WARMUP_FOLD_LABEL} summary=${WARMUP_FOLD_SUMMARY}>
        <ptk-choice-group
          data-field=${WARMUP_LIFT_FIELD}
          label=${WARMUP_LIFT_LABEL}
          .choices=${warmupLiftChoices(lifts)}
          .value=${lift}
        ></ptk-choice-group>
        <div data-warmup-subject=${lift}>
          <ptk-meet-warmup
            .state=${state}
            .subject=${subject}
            .format=${this.session.setup.format}
            .now=${this.clock.now()}
          ></ptk-meet-warmup>
        </div>
      </ptk-disclosure>
    `;
  }

  /**
   * §20's fold on one athlete's own screen, off §21's board.
   *
   * The opener comes off the document and not off a `PlannerView`, because a
   * lifter on the board has no plan behind them -- `#renderCoachLifter` builds
   * their live view with `NO_PLANNING_AT_ALL` for exactly that reason. Their
   * first competition attempt is the weight the ramp counts back from, and it is
   * `null` until somebody declares one, which is most of the morning. That is
   * `subject: null`, which the element already handles by drawing §20.1's
   * estimate and no ramp.
   */
  #renderCoachWarmup(run: CoachRun, lifterId: string): TemplateResult | typeof nothing {
    const lifter = run.timeline.present.lifters.find((candidate) => candidate.id === lifterId);
    if (lifter === undefined) return nothing;
    const lifts = liftsInFormat(run.timeline.present.format);
    const lift = this.#warmupLiftIn(lifts);
    if (lift === null) return nothing;
    return this.#renderWarmupFold(
      lifts,
      lift,
      warmupsFor(this.coachWarmups, lifterId)[lift],
      warmupSubject(lift, openerOn(lifter, lift), run.rules),
    );
  }

  /**
   * §19's fold on the planning screen, where nothing has been lifted yet.
   *
   * Gated on the rule book alone and not on a plan, unlike §20's fold above it.
   * Every margin here comes off the profile and none of them comes off the
   * lifter's own numbers, so a record is answerable the moment a federation is
   * chosen -- which is the Thursday before the meet, with the federation's list
   * open in another tab and no maximums agreed yet. Waiting for a plan would
   * hide the screen for exactly the session it is for.
   *
   * `taken` is `[]` here because nothing has been lifted on a planning screen.
   * That is a fact about this path and not a default: the coach path below
   * hands in the real attempts, and the difference between the two is a legal
   * weight on the bar.
   */
  #renderRecord(): TemplateResult | typeof nothing {
    const context = this.#context();
    if (context === null) return nothing;
    const format = this.session.setup.format;
    const subjects = recordSubjectsIn(format);
    const subject = recordSubjectIn(subjects, this.recordSubject);
    if (subject === null) return nothing;
    const lift = liftForSubject(subject, format);
    return this.#renderRecordFold(
      subjects,
      subject,
      this.records[subject],
      lift === null ? null : { lift, rules: context.rules, taken: [] },
    );
  }

  /**
   * §19's fold itself, over whichever lifter's answers were handed in.
   *
   * One renderer for both paths, for the reason `#renderWarmupFold` is one: the
   * fold is the same fold, and only where the answers and the attempts come
   * from differs. The wrapper `<div>` carries the subject rather than
   * `ptk-meet-record` itself, which is load-bearing for the same §13.14 reason
   * -- an attribute on the element the event was dispatched from leaves the walk
   * in `#recordSubjectOf` covered by nothing.
   *
   * `data-record-subject` and not `data-warmup-subject`, and no `data-lift`
   * anywhere above it. The fold holds two `ptk-number-field`s and a
   * `ptk-text-field` whose changes bubble to this element's own handlers, and
   * what keeps them out of the session is that `#applyLiftNumber` opens with
   * `if (lift === null) return;` and `#writeSetupAnswer` refuses a field that is
   * not a setup one. A `data-lift` here would turn the record box into a typed
   * maximum on whichever lift the attribute named.
   *
   * `restored` is asked here rather than passed in, and that is what keeps the
   * caveat honest on the coach path for free: the question is asked of the state
   * object the caller handed over, so opening the next athlete asks it again
   * about their answers. A boolean computed by either caller would have to
   * remember to be per lifter, and `#renderRecord` -- which has no lifter --
   * would have nothing to remember it with.
   */
  #renderRecordFold(
    subjects: readonly RecordSubject[],
    subject: RecordSubject,
    state: MeetRecordState,
    attempt: RecordAttemptSubject | null,
  ): TemplateResult {
    return html`
      <ptk-disclosure class="record" label=${RECORD_FOLD_LABEL} summary=${RECORD_FOLD_SUMMARY}>
        <ptk-choice-group
          data-field=${RECORD_SUBJECT_FIELD}
          label=${RECORD_SUBJECT_LABEL}
          .choices=${recordSubjectChoices(subjects)}
          .value=${subject}
        ></ptk-choice-group>
        <div data-record-subject=${subject}>
          <ptk-meet-record
            .state=${state}
            .subject=${subject}
            .attempt=${attempt}
            ?restored=${this.#restoredRecords.has(state)}
          ></ptk-meet-record>
        </div>
      </ptk-disclosure>
    `;
  }

  /**
   * §19's fold on one athlete's own screen, off §21's board.
   *
   * The one difference from the planning screen, and the whole reason this
   * method exists rather than the fold being drawn once: `takenOn` rather than
   * `[]`. A record is taken on a competition attempt the rules still allow, and
   * what the rules allow narrows with every weight the lifter has already put
   * on the bar -- so a board screen planning against an empty attempt list keeps
   * offering a weight that was legal at eight in the morning and is not legal
   * now. `takenOn` reports only *resolved* attempts, which is the right reading:
   * a declared opener can still be changed, and until it has a result it has not
   * used anything up.
   */
  #renderCoachRecord(run: CoachRun, lifterId: string): TemplateResult | typeof nothing {
    const lifter = run.timeline.present.lifters.find((candidate) => candidate.id === lifterId);
    if (lifter === undefined) return nothing;
    const format = run.timeline.present.format;
    const subjects = recordSubjectsIn(format);
    const subject = recordSubjectIn(subjects, this.recordSubject);
    if (subject === null) return nothing;
    const lift = liftForSubject(subject, format);
    return this.#renderRecordFold(
      subjects,
      subject,
      recordsFor(this.coachRecords, lifterId)[subject],
      lift === null ? null : { lift, rules: run.rules, taken: takenOn(lifter, lift) },
    );
  }

  /**
   * §21's entries with §20's schedule attached, one per lifter in the meet.
   *
   * **Derived from the document rather than from `run.entries`**, because
   * `coachBoard` looks an entry up by lifter id and falls back to an empty one:
   * a lifter whose warm-up has been answered and whose identifier has not would
   * otherwise never reach the urgency ladder, and the answers would sit in
   * `coachWarmups` changing nothing anybody can see. Meet order is also what
   * `rack-sequence.ts` breaks its ties in, and `document.lifters` is the only
   * list in that order.
   *
   * **The result is deliberately not written back into `run.entries`.** §24
   * saves that list and `SavedCoachEntry` is `Omit<CoachBoardEntry, 'warmup'>`;
   * building the schedule here at paint time is what makes that omission
   * structural rather than a rule `savedEntry` has to keep remembering. A
   * `WarmupTimeline` is a schedule counted from an instant, so storing one
   * stores a stopwatch, and a meet reopened tomorrow would announce a warm-up
   * that was due nineteen hours ago.
   *
   * One lift for the whole board, taken from the picker and **passed in** rather
   * than read here, so that this list and the lead §23.2 prints beside it cannot
   * name two different lifts. Deriving each lifter's
   * own current lift would mean forking `coach-board.ts`'s private
   * `currentAttemptOf`, which is the §5.8 mistake, and a meet runs one lift at a
   * time across the platform anyway. The case it does not cover is written down
   * in this directory's notes: two flights on different lifts at once, where the
   * lifters in the other flight get the ramp for this one.
   */
  #boardEntries(run: CoachRun, now: number, lift: PlatformLift | null): readonly CoachBoardEntry[] {
    const byLifter = new Map(run.entries.map((entry) => [entry.lifterId, entry]));
    return run.timeline.present.lifters.map((lifter) => {
      const entry = byLifter.get(lifter.id) ?? { lifterId: lifter.id };
      const timeline = lift === null ? null : this.#warmupTimelineFor(run, lifter, lift, now);
      return timeline === null ? entry : { ...entry, warmup: timeline };
    });
  }

  /**
   * One lifter's schedule, rebuilt only when something it was built from moved.
   *
   * The memo's justification is on `#warmupTimelines`: rebuilding per paint
   * re-stamps `builtAt` and freezes every countdown on the board. Everything
   * here is the key.
   */
  #warmupTimelineFor(
    run: CoachRun,
    lifter: LiveLifter,
    lift: PlatformLift,
    now: number,
  ): WarmupTimeline | null {
    const state = warmupsFor(this.coachWarmups, lifter.id)[lift];
    const opener = openerOn(lifter, lift);
    const format = run.timeline.present.format;
    const cached = this.#warmupTimelines.get(lifter.id);
    if (cached !== undefined) {
      // Every input by identity, including `rules`, which is taken once when the
      // meet starts (§13.11) and so is a stable object rather than a rebuilt one.
      if (
        cached.state === state &&
        cached.lift === lift &&
        cached.opener === opener &&
        cached.format === format &&
        cached.rules === run.rules
      ) {
        return cached.timeline;
      }
    }
    const subject = warmupSubject(lift, opener, run.rules);
    const built = subject === null ? null : buildMeetWarmup(state, subject, format, now);
    const timeline = built?.ok === true ? built.timeline : null;
    this.#warmupTimelines.set(lifter.id, {
      state,
      lift,
      opener,
      format,
      rules: run.rules,
      timeline,
    });
    return timeline;
  }

  /**
   * §22, below everything and folded shut.
   *
   * The placement is the requirement rather than a layout preference: §22 asks
   * for information that matters at the meet to be stored somewhere that keeps
   * it away from urgent decisions until it is relevant. Rack heights and a
   * packing list are the least urgent things on this screen and the plan is the
   * most, so they go under the Start button, behind a summary that says what is
   * inside.
   *
   * Only on the solo planning screen. Not on the coach board -- §22.1 is one
   * lifter's own equipment settings, and a board runs several people's meets,
   * so a single copy of it there would be one lifter's rack heights presented
   * as everybody's -- and not in live mode, where the whole point of folding it
   * away is that the lifter has something else to look at.
   */
  #renderPrep(): TemplateResult {
    return html`
      <ptk-disclosure class="prep" label=${PREP_HEADING} summary=${PREP_SUMMARY}>
        <ptk-meet-prep .prep=${this.prep}></ptk-meet-prep>
        <ptk-meet-checklist
          .prep=${this.prep}
          .context=${this.#checklistContext()}
          custom-item-text=${this.customItemText}
          .refusal=${this.customItemRefusal}
        ></ptk-meet-checklist>
      </ptk-disclosure>
    `;
  }

  /**
   * The whole of §24, or none of it.
   *
   * One guard in one place rather than three, because the three pieces below are
   * one feature and a screen offering two of them is worse than a screen
   * offering none: Import would take a file and add its meets to `this.library`,
   * where the next `save` discards them silently -- a shelf whose contents
   * vanish on the next visit.
   *
   * `persistence: 'none'` is the embed (§2.5), and there the withdrawal is the
   * point. Save, Export, Import and Delete everything would each refuse, and
   * `apps/web/CLAUDE.md` is explicit that a button which cannot do anything is
   * never on screen. `page` keeps the shelf and says plainly that it goes when
   * the tab does, because a lifter in a private window still has a meet to run.
   *
   * Nothing else guards a write. `#save` is reachable only with a meet open, and
   * a meet can only be opened from the naming control this returns -- so
   * withdrawing the shelf withdraws every path into storage as a consequence
   * rather than as a second check somebody has to remember to keep in step.
   */
  #renderShelf(): TemplateResult | typeof nothing {
    if (this.store.persistence === 'none') return nothing;
    return html`${this.#renderNaming()} ${this.#renderImporting()} ${this.#renderLibrary()}`;
  }

  /**
   * §24.1's naming block, shown only while nothing is being saved into.
   *
   * The screen is usable before it is named and stays usable if it is never
   * named -- naming is what starts *keeping* it, not what starts it. So this is
   * an invitation rather than a gate, and it withdraws the moment there is a
   * meet open, replaced by one line saying where the changes are going.
   *
   * Below §22 and above the shelf, which is where it belongs on both screens for
   * the reason §22 sits where it does: the plan is the urgent thing and the
   * filing is not. It is on the coach screen too, because a coach's board is
   * exactly the document worth not losing.
   */
  #renderNaming(): TemplateResult {
    const open = activeMeet(this.library);
    if (open !== null) {
      return html`<p class="naming muted">${openMeetSentence(open.name)}</p>`;
    }
    return html`
      <section class="naming">
        <h2>${MEET_NAMING_HEADING}</h2>
        <ptk-text-field
          data-field=${MEET_NAME_FIELD}
          label=${MEET_NAME_LABEL}
          hint=${MEET_NAME_HINT}
          .value=${this.meetName}
        ></ptk-text-field>
        <ptk-button @click=${this.#onCreateMeet}>${MEET_CREATE_LABEL}</ptk-button>
      </section>
    `;
  }

  /**
   * §24.4's preview, between the two presses of an import.
   *
   * Above the shelf rather than inside it: the sentence describes what the shelf
   * is about to become, and a panel rendered among the meets it is going to add
   * to reads as one of them.
   */
  #renderImporting(): TemplateResult {
    const preview = this.importing;
    if (preview === null) return html``;
    return html`
      <section class="importing">
        <ptk-notice tone="info" role="status"><p>${importPreviewSentence(preview)}</p></ptk-notice>
        <div class="answers">
          <ptk-button @click=${this.#onConfirmImport}>${MEET_IMPORT_CONFIRM_LABEL}</ptk-button>
          <ptk-button variant="secondary" @click=${this.#onCancelImport}
            >${MEET_IMPORT_CANCEL_LABEL}</ptk-button
          >
        </div>
      </section>
    `;
  }

  /**
   * §24.2's shelf.
   *
   * `durable` comes off the store rather than off the last write's outcome,
   * because the question the warning answers is what this browser *does* with a
   * write and not whether the last one worked. A shelf that only learned it was
   * not durable after a save would show the reassuring sentence until the first
   * keystroke.
   *
   * The element keeps a boolean where the store has three answers, and that is
   * not a lossy narrowing: `none` never reaches here, because `#renderShelf`
   * renders nothing at all for it. The two values left are the two sentences
   * §24.3 has.
   */
  #renderLibrary(): TemplateResult {
    return html`
      <ptk-meet-library
        .library=${this.library}
        unreadable=${this.unreadable}
        ?durable=${this.store.persistence === 'device'}
        message=${this.shelfMessage}
        messageTone=${this.shelfTone}
      ></ptk-meet-library>
    `;
  }

  /**
   * The platform, plus the way back and anything the document refused.
   *
   * The refusals go to the live screen and the problems are drawn here, and the
   * split is not cosmetic: a refused weight belongs under the field it was typed
   * into, where the lifter is already looking, and everything else is a sentence
   * about the meet rather than about a control.
   *
   * `buildLiveView` answers `null` only for a lifter who is not in the document,
   * which `seedLiveMeet` makes unreachable -- it returns the id of the lifter it
   * just added. The fallback is here because the return type says it can, and
   * `EMPTY_LIVE_VIEW` is a screen that says the meet is over rather than a blank
   * one (§5.8: a property binding assigns null over the child's own default).
   */
  #renderLive(run: LiveRun): TemplateResult {
    // Read once, here, and handed down. Twice in one paint is two instants on
    // one screen, which on a sixty-second countdown is a visible stutter.
    const view = buildLiveView(run.timeline, run.lifterId, {
      rules: run.rules,
      chart: this.chart,
      planning: run.planning,
      targets: run.targets,
      observed: NOTHING_OBSERVED,
      now: this.clock.now(),
    });
    return html`
      <ptk-button class="back" variant="secondary" @click=${this.#onBackToPlan}>
        ${BACK_TO_PLAN_LABEL}
      </ptk-button>

      ${this.#renderProblems('live-problems')}
      ${
        view?.position.meetOver === true
          ? this.#renderFinished(
              run,
              summariseMeet({
                rules: run.rules,
                chart: this.chart,
                timeline: run.timeline,
                lifterId: run.lifterId,
                view: run.view,
                targets: run.targets,
                equipment: historyEquipmentFor(this.session.extras.equipment),
              }),
              this.#shelfCalibration(),
            )
          : html`
              <ptk-live-screen
                .view=${view ?? EMPTY_LIVE_VIEW}
                .chart=${this.chart}
                .unit=${this.session.setup.unit}
                .refusals=${this.refusals}
              ></ptk-live-screen>
            `
      }
    `;
  }

  /**
   * §26's page, in place of the platform screen rather than beneath it.
   *
   * Replacing it is not a layout preference. `ptk-live-screen` prints the banked
   * and projected totals unconditionally -- `meetOver` silences only the called
   * attempt and the next-attempt line -- so a summary rendered beside it puts two
   * totals on one page, which is the specific failure §17 is written about: a
   * lifter reading one figure as the day's total when it is not. There is no
   * arrangement of the two that avoids it, because both are correct about their
   * own question and neither is labelled against the other.
   *
   * What that costs is `ptk-live-screen`'s own undo control, which goes with it,
   * so one is rendered here instead. §13.9 is not "the live screen has an undo
   * button", it is that every action stays undoable -- and the action most likely
   * to need it is the last one, recorded against the wrong outcome, by which time
   * the screen has already changed.
   */
  #renderFinished(
    run: RunningMeet,
    summary: MeetSummary,
    calibration: CalibrationReport | null,
  ): TemplateResult {
    return html`
      <ptk-meet-summary .summary=${summary} .unit=${this.session.setup.unit}></ptk-meet-summary>
      ${
        calibration === null
          ? nothing
          : html`
              <ptk-meet-calibration
                .report=${calibration}
                .unit=${this.session.setup.unit}
              ></ptk-meet-calibration>
            `
      }
      ${this.#renderFinishedUndo(run)}
    `;
  }

  /**
   * §9.4's reading of the shelf, for the lifter whose own device this is.
   *
   * **Beneath the summary, never above it.** The page is about the day that has
   * just been contested, and a panel of medians from earlier meets at the top of
   * it answers a question nobody asked yet. It is also the one section that can
   * be entirely empty -- a first meet has no history -- and an empty panel above
   * the day's total reads as a page that has not finished loading.
   *
   * **The meet on screen is left out of its own comparison**, which is the whole
   * of `exceptMeetId`: it is on the shelf by the time this renders, and left in it
   * would make the figures below partly a reading of the total above them.
   * `history.ts` argues that at length.
   *
   * **`combineEquipment` is false and there is no control for it.** §9.4 wants
   * combining to be a decision somebody made, and the panel names the scope it
   * read in every state so the decision is visible rather than assumed. A control
   * for it belongs with the panel and not with this wiring.
   *
   * The coach path passes `null` rather than calling this, for the reason its own
   * summary is built with `'unstated'` equipment: the shelf is this coach's
   * device, and reading it beside somebody else's finished meet would compare an
   * athlete against a history that is not theirs. That is worse than no panel,
   * because every figure in it would look like a fact about the lifter on screen.
   */
  #shelfCalibration(): CalibrationReport {
    return calibrateLibrary(this.library, {
      exceptMeetId: activeMeet(this.library)?.id ?? null,
      scope: {
        equipment: historyEquipmentFor(this.session.extras.equipment),
        combineEquipment: false,
      },
    });
  }

  /**
   * Undo, off the timeline rather than off a view.
   *
   * The action is read fresh at press time and not compared against anything,
   * which is the one way this differs from `#onUndoRequest`. That handler is
   * answering a child that named the action it was showing, and the check exists
   * because the live screen repaints four times a second -- a press can land on a
   * label the document has already moved past. Nothing repaints here: the summary
   * is a finished meet, so there is no clock behind it and no race to lose.
   *
   * `NOTHING_TO_UNDO` is unreachable here, exactly as §13.9 records it being on
   * the live screen, and for a reason worth writing down because the obvious
   * reading is the opposite. It looks reachable -- press undo enough times and
   * the past empties -- but the first press already ends the state this branch
   * renders in: the view is rebuilt from the new timeline in the same commit,
   * `meetOver` is false, and the platform screen is back. There is no paint in
   * between. The branch stays because `undoableAction` is nullable and the
   * alternative is a non-null assertion over an argument about reachability.
   */
  #renderFinishedUndo(run: RunningMeet): TemplateResult {
    const action = undoableAction(run.timeline);
    if (action === null) return html`<p class="note nothing-to-undo">${NOTHING_TO_UNDO}</p>`;
    return html`
      <ptk-button class="undo" variant="secondary" @click=${this.#onFinishedUndo}>
        ${undoLabel(action)}
      </ptk-button>
    `;
  }

  /** Said above the planning screens while a meet is running behind them. */
  #renderRunning(): TemplateResult | typeof nothing {
    if (this.live === null) return nothing;
    return html`
      <div class="running">
        <p class="note">${MEET_IS_RUNNING_NOTE}</p>
        <ptk-button @click=${this.#onReturnToMeet}>${RETURN_TO_MEET_LABEL}</ptk-button>
      </div>
    `;
  }

  /**
   * The one control that turns a plan into a meet, and the name it needs first.
   *
   * Gated on `view.complete` -- three attempts on every contested lift -- rather
   * than on there being any plan at all. A meet seeded from a half-answered
   * session opens on a screen whose next action is "choose a weight" for a lift
   * the lifter thought they had planned, and the reason is two screens back.
   *
   * The note is above the button rather than under it because it answers the
   * question that stops somebody pressing: whether this consumes the plan. Said
   * afterwards it is a reassurance about something already done.
   */
  #renderStart(view: PlannerView | null): TemplateResult | typeof nothing {
    if (this.live !== null) return nothing;
    return html`
      <section class="start">
        <h2>${START_MEET_HEADING}</h2>
        ${
          !view?.complete
            ? html`<p class="note">${START_MEET_NEEDS_A_PLAN}</p>`
            : html`
                <ptk-text-field
                  data-field=${LIFTER_NAME_FIELD}
                  label=${LIFTER_NAME_LABEL}
                  hint=${LIFTER_NAME_HINT}
                  capitalize="words"
                  autocomplete="off"
                  .value=${this.lifterName}
                ></ptk-text-field>
                <p class="note">${START_MEET_NOTE}</p>
                <ptk-button ?disabled=${this.lifterName.trim() === ''} @click=${this.#onStart}>
                  ${START_MEET_LABEL}
                </ptk-button>
              `
        }
        ${this.#renderProblems('problems')}
      </section>
    `;
  }

  /**
   * What the document refused, in this tool's words rather than the domain's.
   *
   * See `meetProblemSentence`: the messages on `MeetActionProblem` are written
   * for whoever is reading a failed action in a test, and half of them name a
   * field rather than something a lifter did.
   */
  #renderProblems(className: string): TemplateResult | typeof nothing {
    if (this.problems.length === 0) return nothing;
    return html`
      <ul class=${className}>
        ${this.problems.map(
          (code) =>
            html`<li><ptk-notice tone="error">${meetProblemSentence(code)}</ptk-notice></li>`,
        )}
      </ul>
    `;
  }

  /**
   * The plan, or the one sentence that says why there is not one yet.
   *
   * Five states and only one of them is a fault, so only one of them is an error
   * tone. A rule book still loading, a corpus with nothing published in it, and a
   * federation nobody has picked are all ordinary, and a screen that greeted the
   * first of them with a warning would open by reporting a problem that resolves
   * itself in a hundred milliseconds.
   */
  #renderPlan(view: PlannerView | null): TemplateResult {
    if (view !== null) {
      return html`<ptk-plan-screen .session=${this.session} .view=${view}></ptk-plan-screen>`;
    }
    if (this.status === 'loading') {
      return html`<p class="note">The plan appears here once the rule books have loaded.</p>`;
    }
    if (this.status === 'failed') {
      return html`<p class="note">
        Without a rule book there is nothing to check an attempt against, so no plan is drawn.
      </p>`;
    }
    if (this.profiles.length === 0) {
      return html`<p class="note">
        No federation rule books have been published yet, so no plan can be drawn.
      </p>`;
    }
    if (this.#profile() === null) {
      return html`<p class="note">Choose a federation above and the plan appears here.</p>`;
    }
    // The remaining case: a profile was chosen and `MeetRules.from` refused it.
    // Named as an error because it is one, and pointed at the only action that
    // helps -- the feed is not something a lifter can fix, and another federation
    // is a working plan rather than a workaround.
    return html`<ptk-notice tone="error">
      This federation's published rule book could not be read, so attempts cannot be checked against
      it. Choosing another federation above will draw a plan.
    </ptk-notice>`;
  }

  /**
   * The unit question, which appears only when there is something to reinterpret.
   *
   * Unconditional, this would be a box on the first tap of every session --
   * tool 2's finding (§10.2), and the reason `hasTypedWeights` exists.
   */
  #renderConversion(): TemplateResult | typeof nothing {
    const typedIn = this.typedIn;
    if (typedIn === null) return nothing;
    return html`
      <div class="convert">
        <p>${conversionQuestion(typedIn)}</p>
        <ptk-choice-group
          data-field=${CONVERT_FIELD}
          label="Figures already entered"
          .choices=${conversionChoices(typedIn, this.session.setup.unit)}
          .value=${null}
        ></ptk-choice-group>
        <p class="note">${CONVERSION_CONFIRMATION_NOTE}</p>
      </div>
    `;
  }

  /** The plan for the current session, or `null` while there are no rules. */
  #view(): PlannerView | null {
    const context = this.#context();
    return context === null ? null : buildPlan(this.session, context);
  }

  #context(): PlanContext | null {
    const profile = this.#profile();
    if (profile === null) return null;
    const rules = this.#rulesFor(profile);
    return rules === null ? null : { rules, chart: this.chart };
  }

  #profile(): MeetRuleProfile | null {
    const id = this.session.setup.federationId;
    if (id === '') return null;
    return this.profiles.find((profile) => profile.id === id) ?? null;
  }

  /**
   * The chosen profile as rules, computed once per profile.
   *
   * Keyed on the object rather than on the identifier, because a fresh read of
   * the same federation is a fresh profile and may not say the same thing. The
   * cache is here for the logging rather than for the arithmetic: `render` runs
   * on every keystroke, and a refusal reported a thousand times is a refusal
   * nobody can find.
   *
   * Problem *codes* only reach the console. The messages name the federation's
   * published content, and a browser console is not where this project explains
   * somebody else's rule book to a lifter who cannot act on it.
   */
  #rulesFor(profile: MeetRuleProfile): MeetRules | null {
    const cached = this.#rulesCache;
    if (cached !== null && cached.profile === profile) return cached.rules;

    const result = MeetRules.from(profile);
    if (!result.ok) {
      console.error(
        'meet-day: a published rule profile was refused',
        result.problems.map((problem) => problem.code),
      );
    }
    const rules = result.ok ? result.rules : null;
    this.#rulesCache = { profile, rules };
    return rules;
  }

  #rulesCache: { readonly profile: MeetRuleProfile; readonly rules: MeetRules | null } | null =
    null;

  #setSession(session: PlannerSession): void {
    this.session = session;
    saveSession(this.settings, session);
  }

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) return;
    // Both axes are read here rather than in the branch that wants one, because
    // a control carries at most one of them and reading is cheap; a branch that
    // reached back for the event would be the only one able to, and the next
    // per-lifter field would be written without it.
    this.#applyChoice(field, event.detail.value, this.#liftOf(event), this.#lifterOf(event));
  };

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) return;
    this.#applyNumber(field, event.detail.value, this.#liftOf(event));
  };

  /**
   * §7's confirmation, §22.2's checklist and §21.3's responsibilities.
   *
   * The confirmation is read as "is the one choice among the values" rather than
   * as "did the values change", because a toggle group reports its whole set and
   * an untick is an event carrying an empty one -- the state that withdraws an
   * agreement. The checklist works the same way for the same reason, over a
   * whole group of rows at once.
   *
   * The checklist is asked about first, and it is found by a different attribute
   * -- `data-group`, not `data-field`. That is not an inconsistency to tidy up:
   * a checklist group is not a field with one answer, and giving it a
   * `data-field` would put it in front of every `fieldOf` walk in this file,
   * where the nearest one wins and a group name is not a field name any of them
   * knows.
   */
  readonly #onToggle = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    const group = attributeOf(event, CHECKLIST_GROUP_FIELD);
    if (group !== null) {
      this.#tickChecklist(group, event.detail.values);
      return;
    }
    const field = fieldOf(event);
    if (field === ROSTER_HANDLER_DUTIES_FIELD) {
      // Narrowed rather than cast. The values come off a control this element
      // rendered from `HANDLER_RESPONSIBILITIES`, but they arrive as strings out
      // of the DOM, and a cast would write an unrecognised one into a
      // `HandlerAssignment` that §24 exports -- where the schema built from the
      // same tuple refuses it, on the next device rather than on this one.
      this.#patchHandler(event, { responsibilities: asResponsibilities(event.detail.values) });
      return;
    }
    if (field !== CONFIRM_FIELD) return;
    const lift = this.#liftOf(event);
    if (lift === null) return;
    this.#setSession(
      confirmMaximum(this.session, lift, event.detail.values.includes(CONFIRM_VALUE)),
    );
  };

  /**
   * Records one group's ticks, scoped to the rows that group actually holds.
   *
   * `withCheckedRows` takes the rows it is allowed to touch as well as the ones
   * that are ticked, and the scope is what makes an untick expressible: a group
   * reports its whole set, so "nothing in this group" and "nothing anywhere" are
   * the same array and only the scope tells them apart. Without it, unticking
   * the last row of one group would clear every tick on the list.
   *
   * The rows are re-derived from `checklistFor` rather than trusted from the
   * event, so a group name that no longer holds any rows -- a format corrected
   * while the fold is open -- writes nothing rather than clearing the document's
   * idea of a group it can no longer see.
   *
   * The empty-scope return is *not* what makes that safe, and the comment used
   * to claim it was: `withCheckedRows` iterates the scope, so an empty one
   * already writes nothing, and a mutation removing the line passed the whole
   * suite. What it buys is the repaint -- without it every stale or foreign
   * report replaces `prep` with an equal-but-new object, and `@state` compares
   * by identity, so a screen that repaints off the clock four times a second
   * would take a second render for each one.
   */
  #tickChecklist(group: string, checked: readonly string[]): void {
    const within = checklistFor(this.prep, this.#checklistContext())
      .filter((row) => row.group === group)
      .map((row) => row.itemId);
    if (within.length === 0) return;
    this.prep = withCheckedRows(this.prep, within, checked);
  }

  /**
   * The three answers §22.2 filters its rows by, read off the session.
   *
   * Rebuilt on demand rather than held, because all three are already state
   * somewhere else and a fourth copy is one more thing to keep in step -- the
   * failure being a checklist still asking about deadlift socks after the format
   * was corrected to bench-only.
   */
  #checklistContext(): ChecklistContext {
    return {
      format: this.session.setup.format,
      equipment: this.session.extras.equipment,
      goal: this.session.setup.goal,
    };
  }

  /**
   * Which lift a control belongs to, checked against the lifts on screen.
   *
   * A `data-lift` naming a lift this format does not contest cannot have come
   * from a control this tool rendered, and writing it would put a figure into a
   * lift with nothing to show it back -- visible only later, if the lifter
   * corrects the format and finds a number they never typed.
   */
  #liftOf(event: Event): PlatformLift | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.dataset['lift'];
      if (value === undefined) continue;
      return sessionLifts(this.session).find((lift) => lift === value) ?? null;
    }
    return null;
  }

  /**
   * Which lift §20's fold was showing, validated the way `#liftOf` validates.
   *
   * A separate walk rather than a second attribute read inside `#liftOf`,
   * because the two answer different questions off different attributes and
   * folding them together is what would put `data-lift` above the warm-up --
   * the one thing `WARMUP_SUBJECT_FIELD` exists to keep off it.
   */
  #warmupLiftOf(event: Event): PlatformLift | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.dataset[WARMUP_SUBJECT_FIELD];
      if (value === undefined) continue;
      return sessionLifts(this.session).find((lift) => lift === value) ?? null;
    }
    return null;
  }

  /**
   * Which record §19's fold was showing, validated against the meet's subjects.
   *
   * A third walk rather than a branch inside `#warmupLiftOf`, for the reason
   * that one is separate from `#liftOf`: the answer here is a `RecordSubject`
   * and `total` is one of them. Narrowing it through `sessionLifts` would drop
   * every total record on the floor -- silently, because a dropped answer looks
   * exactly like a fold nobody typed into.
   */
  #recordSubjectOf(event: Event): RecordSubject | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.dataset[RECORD_SUBJECT_ATTRIBUTE];
      if (value === undefined) continue;
      return recordSubjectsIn(this.session.setup.format).find((it) => it === value) ?? null;
    }
    return null;
  }

  /**
   * Which lifter a roster control belongs to, read and not yet checked.
   *
   * `#liftOf` validates against the lifts on screen and this deliberately does
   * not validate against the meet, because the one thing worth checking -- that
   * the id names somebody in the document -- is checked in `#patchEntry`, which
   * every writer goes through. Doing it in both places is one rule written
   * twice, and the copy that gets forgotten is the one on the next handler.
   */
  #lifterOf(event: Event): string | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.dataset[BOARD_LIFTER_FIELD];
      if (value !== undefined) return value;
    }
    return null;
  }

  /**
   * Which of a lifter's handlers a control belongs to (§21.3).
   *
   * The second axis on the roster's rows, read off the same path as the first.
   * Parsed rather than trusted: it is written from a number and read back as a
   * string, and a value that is not one lands on `null`, which `#patchHandler`
   * turns into writing nothing. Silently taking the first handler instead is the
   * failure worth ruling out -- one person's name typed onto another's row.
   */
  #handlerOf(event: Event): number | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      const value = node.dataset[ROSTER_HANDLER_INDEX_FIELD];
      if (value === undefined) continue;
      const position = Number.parseInt(value, 10);
      return Number.isInteger(position) ? position : null;
    }
    return null;
  }

  /**
   * Applies one chosen option.
   *
   * `dataset` and a choice value are both strings out of the DOM, and every
   * mapper below is total: an unrecognised value lands on the answer that claims
   * nothing rather than on a state no control can show back.
   */
  #applyChoice(
    field: string,
    value: string,
    lift: PlatformLift | null,
    lifterId: string | null,
  ): void {
    const session = this.session;
    switch (field) {
      case MODE_FIELD:
        this.#chooseMode(value);
        return;
      case FEDERATION_FIELD:
        this.#chooseFederation(value);
        return;
      case FORMAT_FIELD:
        this.#setSession(withSetup(session, { format: formatFromValue(value) }));
        return;
      case UNIT_FIELD:
        this.#chooseUnit(unitFromValue(value));
        return;
      case FIRST_MEET_FIELD:
        this.#setSession(withSetup(session, { firstMeet: firstMeetFromValue(value) }));
        return;
      case GOAL_FIELD:
        this.#setSession(withSetup(session, { goal: goalFromValue(value) }));
        return;
      case METHOD_FIELD:
        this.#setSession(withSetup(session, { method: methodFromValue(value) }));
        return;
      case CONVERT_FIELD:
        this.#answerConversion(value);
        return;
      case WARMUP_LIFT_FIELD:
        // Narrowed against the lifts this format contests rather than cast: the
        // value is a string out of the DOM like every other one here, and an
        // unrecognised one leaves the fold where it is instead of putting the
        // picker on a lift the meet does not run.
        this.#chooseWarmupLift(value);
        return;
      case RECORD_SUBJECT_FIELD:
        // Narrowed against a different list and for a different reason: the
        // whole subject vocabulary rather than this meet's lifts, because the
        // fold's own render already refuses a subject the format does not
        // contest and `total` is a legal answer here that is not a lift at all.
        this.#chooseRecordSubject(value);
        return;
      case EQUIPMENT_FIELD:
        this.#setSession(withExtras(session, { equipment: equipmentFromValue(value) }));
        return;
      case READINESS_FIELD:
        this.#setSession(withExtras(session, { readiness: readinessFromValue(value) }));
        return;
      case HARD_CUT_FIELD:
        this.#setSession(withExtras(session, { hardCut: answerFromValue(value) }));
        return;
      case COMPARISON_FIELD:
        this.#setSession(withExtras(session, { comparison: comparisonFromValue(value) }));
        return;
      case MAXIMUM_SOURCE_FIELD:
        this.#setSession(withExtras(session, { maximumSource: maximumSourceFromValue(value) }));
        return;
      case EVIDENCE_AGE_FIELD:
        this.#setSession(withExtras(session, { evidenceAge: evidenceAgeFromValue(value) }));
        return;
      case ROSTER_COLOUR_FIELD:
        // `NO_COLOUR` is a real option and not an absent answer -- a coach taking
        // a colour back off a row has said something, and mapping it to `null`
        // here is what lets the board fall back to the identifier (§21) rather
        // than go on drawing a swatch nobody asked for.
        this.#patchEntry(lifterId, { colour: value === NO_COLOUR ? null : value });
        return;
      default:
        // §22.1's three tile groups have no constant of their own -- their
        // `data-field` is the `LifterSetup` key -- so they are caught here
        // rather than by a case. Ahead of `#applyLiftChoice`, which is the
        // other switch with no constants: it reads `data-lift`, and a setup
        // tile carries none, so the order does not matter today. It is written
        // this way round anyway, because the day a §22 answer becomes per-lift
        // the other order would silently drop it into the wrong record.
        if (isSetupField(field)) {
          this.prep = withSetupAnswer(this.prep, field, value);
          return;
        }
        this.#applyLiftChoice(field, value, lift);
        return;
    }
  }

  /** The per-lift half of the same switch, split so neither half is unreadable. */
  #applyLiftChoice(field: string, value: string, lift: PlatformLift | null): void {
    if (lift === null) return;
    const guided = this.session.figures[lift].guided;
    switch (field) {
      case GUIDED_RESERVE_FIELD:
        this.#patchFigures(lift, { guided: { ...guided, repsInReserve: reserveFromValue(value) } });
        return;
      case GUIDED_STANDARD_FIELD:
        this.#patchFigures(lift, {
          guided: { ...guided, competitionStandard: answerFromValue(value) },
        });
        return;
      case GUIDED_AGE_FIELD:
        this.#patchFigures(lift, { guided: { ...guided, age: evidenceAgeFromValue(value) } });
        return;
      case GUIDED_EQUIPMENT_FIELD:
        this.#patchFigures(lift, { guided: { ...guided, sameEquipment: answerFromValue(value) } });
        return;
      case OPENER_TESTED_FIELD:
        this.#patchFigures(lift, { openerTested: answerFromValue(value) });
        return;
      default:
        return;
    }
  }

  /** Applies one typed figure. Every field here holds exactly what was typed. */
  #applyNumber(field: string, value: string, lift: PlatformLift | null): void {
    const session = this.session;
    switch (field) {
      case TARGET_TOTAL_FIELD:
        this.#setSession(withTargetTotal(session, value));
        return;
      case BODYWEIGHT_FIELD:
        this.#setSession(withExtras(session, { bodyweight: value }));
        return;
      case AGE_FIELD:
        this.#setSession(withExtras(session, { age: value }));
        return;
      case PRIOR_MEETS_FIELD:
        this.#setSession(withExtras(session, { priorMeets: value }));
        return;
      case MINIMUM_JUMP_FIELD:
        this.#setSession(withExtras(session, { minimumJump: value }));
        return;
      case MAXIMUM_JUMP_FIELD:
        this.#setSession(withExtras(session, { maximumJump: value }));
        return;
      case PERSONAL_RECORD_TOTAL_FIELD:
        this.#setSession(withTargets(session, { personalRecordTotal: value }));
        return;
      case QUALIFYING_TOTAL_FIELD:
        this.#setSession(withTargets(session, { qualifyingTotal: value }));
        return;
      case MINIMUM_TOTAL_FIELD:
        this.#setSession(withTargets(session, { minimumAcceptableTotal: value }));
        return;
      case STRETCH_TOTAL_FIELD:
        this.#setSession(withTargets(session, { stretchTotal: value }));
        return;
      default:
        this.#applyLiftNumber(field, value, lift);
        return;
    }
  }

  #applyLiftNumber(field: string, value: string, lift: PlatformLift | null): void {
    if (lift === null) return;
    const figures = this.session.figures[lift];

    const attemptIndex = ATTEMPT_FIELDS.indexOf(field as (typeof ATTEMPT_FIELDS)[number]);
    if (attemptIndex !== -1) {
      const attempts: [string, string, string] = [
        figures.attempts[0],
        figures.attempts[1],
        figures.attempts[2],
      ];
      attempts[attemptIndex] = value;
      this.#patchFigures(lift, { attempts });
      return;
    }

    switch (field) {
      case EXPECTED_MAXIMUM_FIELD:
        this.#patchFigures(lift, { expectedMaximum: value });
        return;
      case GUIDED_WEIGHT_FIELD:
        this.#patchFigures(lift, { guided: { ...figures.guided, weight: value } });
        return;
      case GUIDED_REPS_FIELD:
        this.#patchFigures(lift, { guided: { ...figures.guided, reps: value } });
        return;
      case OPENER_FIELD:
        this.#patchFigures(lift, { opener: value });
        return;
      case CEILING_FIELD:
        this.#patchFigures(lift, { ceiling: value });
        return;
      case PERSONAL_RECORD_FIELD:
        this.#patchFigures(lift, { personalRecord: value });
        return;
      default:
        return;
    }
  }

  #patchFigures(lift: PlatformLift, patch: Parameters<typeof withFigures>[2]): void {
    this.#setSession(withFigures(this.session, lift, patch));
  }

  /**
   * Records the federation and tells the transport, in that order.
   *
   * The event carries the identifier rather than leaving the listener to read it
   * back off this element: a listener that read the property would be reading it
   * after a Lit update it has no way to await, and the chart it fetched would
   * belong to whichever federation happened to be current by then.
   */
  #chooseFederation(federationId: string): void {
    if (federationId === '') return;
    if (!this.profiles.some((profile) => profile.id === federationId)) return;
    this.#setSession(withSetup(this.session, { federationId }));
    this.dispatchEvent(
      new CustomEvent<FederationChangeDetail>(FEDERATION_CHANGE_EVENT, {
        detail: { federationId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Moves the display unit and raises the question about the digits.
   *
   * `withUnit` withdraws the confirmations; see its note for why that is not
   * optional. What it does *not* do is touch a digit -- that is the lifter's
   * answer to the question this raises, and until they give one the digits stand
   * unchanged, which is the "keep" reading.
   */
  #chooseUnit(unit: WeightUnit): void {
    const session = this.session;
    const typedIn = this.typedIn ?? session.setup.unit;
    this.#setSession(withUnit(session, unit));
    this.typedIn = unit === typedIn || !hasTypedWeights(session) ? null : typedIn;
  }

  #answerConversion(value: string): void {
    const typedIn = this.typedIn;
    if (typedIn === null) return;
    if (value === CONVERT_ANSWER) {
      this.#setSession(convertFigures(this.session, typedIn, this.session.setup.unit));
    }
    this.typedIn = null;
  }

  /**
   * §20's picker, checked against the lifts this format actually contests.
   *
   * The check is what stops the fold pointing at a lift with no attempts behind
   * it -- `warmups` is total, so an unchecked value would render a blank room
   * for a lift the meet does not run, with no opener and therefore no ramp, and
   * nothing on screen saying why.
   */
  #chooseWarmupLift(value: string): void {
    const lift = sessionLifts(this.session).find((candidate) => candidate === value);
    if (lift === undefined) return;
    this.warmupLift = lift;
  }

  /**
   * §19's picker, checked against the subjects that exist rather than against
   * the ones this meet contests.
   *
   * It narrowed against the format first, and a mutation showed that check does
   * nothing: swapping the format for a fixed `'full-power'` left all 130 tests
   * green. `this.recordSubject` is read in exactly two places and both of them
   * pass it through `recordSubjectIn`, which falls back to the first subject the
   * format contests -- so an off-format answer never reaches a screen. Nor could
   * a check here own that question. The format is a setup answer and can change
   * *after* a subject is picked, at which point a subject validated on the way
   * in is stale and the render's fallback is the only thing standing; a guard
   * that covers a strictly smaller case than the one below it reads as the
   * defence and is not.
   *
   * A value that is no subject at all is still refused, and that one is worth
   * the line. `recordSubjectIn` answers it with the *first* subject, so a forged
   * report (§13.14) would slide the fold silently back onto the squat -- which
   * looks exactly like a coach having chosen the squat, on a screen whose whole
   * job is to say which record is being planned. Dropped rather than defaulted,
   * for the reason `#recordSubjectOf` drops.
   *
   * Held as one answer across both paths and every lifter, unlike the *record*
   * itself. Which lift a coach is asking about is a property of the question
   * being asked at the rack -- open the next athlete and it is still the squat
   * record on screen -- while what the record *is* differs per lifter and is
   * filed under them by `#onRecordChange`.
   */
  #chooseRecordSubject(value: string): void {
    const subject = RECORD_SUBJECTS.find((candidate) => candidate === value);
    if (subject === undefined) return;
    this.recordSubject = subject;
  }

  /**
   * §6.1's branch, refused once either meet exists.
   *
   * The control is off the screen by then (`#renderMode`), so this cannot be
   * reached by a tap -- and it is checked anyway, because the listener is on the
   * host and a composed choice event carrying `data-field="mode"` from anywhere
   * would otherwise switch the screen out from under a running meet. Nothing is
   * destroyed by that: both runs are still in memory. What is destroyed is the
   * lifter's ability to find them, because the branch that renders the way back
   * is the one that just went away.
   */
  #chooseMode(value: string): void {
    if (this.live !== null || this.coach !== null) return;
    this.mode = value === COACH_MODE ? 'coach' : 'solo';
  }

  /*
   * ---------------------------------------------------------------------------
   * Live mode.
   * ---------------------------------------------------------------------------
   */

  /**
   * §14's name and §21's two per-lifter answers, all held in memory.
   *
   * The switch is exhaustive by default rather than by omission: a composed
   * event arriving from a child that is not one of this element's own controls
   * lands here too, because the listener is on the host. The tool had exactly
   * one text field when this was written and dropping the guard passed the whole
   * suite -- the test that bites is a foreign composed event dispatched at the
   * host, not a second control -- and it now has four, three of which would have
   * been renaming the lifter.
   *
   * None of these writes to the session or reaches the preference store.
   * §13.4's rule is that the setup answers are settings on a device and a
   * person's own facts are not; a lifter's name is the plainest instance, and a
   * coach's roster is a list of *other* people's names on a shared phone, which
   * is the same rule with more of it at stake (§2.3). §22.1's fourteen boxes
   * fall the same way and for a reason of their own -- a rack height belongs to
   * a venue and a lot number to one Saturday, so remembering them would greet a
   * lifter at their second meet with the first one's answers.
   *
   * The `default` is no longer a bare return, which is the one thing to be
   * careful of here: §22.1 names its fields by their `LifterSetup` key rather
   * than by a constant per box, so fourteen of them arrive with no case of their
   * own. `#writeSetupAnswer` is what keeps that from being the same as
   * accepting anything -- it asks `isSetupField` before writing, so a foreign
   * composed event still falls through to nothing.
   */
  readonly #onText = (event: CustomEvent<TextFieldChangeDetail>): void => {
    const value = event.detail.value;
    const field = fieldOf(event);
    switch (field) {
      case LIFTER_NAME_FIELD:
        this.lifterName = value;
        return;
      case ROSTER_NAME_FIELD:
        this.rosterName = value;
        return;
      case MEET_NAME_FIELD:
        this.meetName = value;
        // The shelf's sentence is cleared for the reason the custom-item refusal
        // is: it is about the name that was in the box, so leaving "Give the
        // meet a name" up while somebody types one says the tool has not
        // noticed.
        this.shelfMessage = '';
        return;
      case ROSTER_IDENTIFIER_FIELD:
        // Untrimmed, deliberately: it is a lot number as the coach typed it, and
        // `rosterSummary` trims only to decide whether there is one.
        this.#patchEntry(this.#lifterOf(event), { identifier: value });
        return;
      case ROSTER_RACK_FIELD:
        // Untrimmed for the same reason and with the same reader downstream:
        // `rackSequences` and §21.2 both trim before matching, so a trailing
        // space cannot split one bar into two, and the box still shows the coach
        // what they typed.
        this.#patchEntry(this.#lifterOf(event), { rackId: value });
        return;
      case ROSTER_HANDLER_NAME_FIELD:
        this.#patchHandler(event, { name: value });
        return;
      case CUSTOM_ITEM_FIELD:
        this.customItemText = value;
        // Cleared on the keystroke rather than on the next press. The refusal is
        // about the text that was in the box, so leaving it up while the lifter
        // shortens the row says the shortened row is refused too -- and the one
        // sentence they are being asked to act on is the one that stops being
        // true first.
        this.customItemRefusal = null;
        return;
      default:
        this.#writeSetupAnswer(field, value);
        return;
    }
  };

  /**
   * §22.1's two prose answers, plus §22.2's notes.
   *
   * A separate event from the one above (`ptk-text-change`, not
   * `ptk-text-field-change`) and therefore a separate listener -- which is worth
   * a handler of its own rather than a shared body, because the two events carry
   * different detail types and folding them together would need a union nothing
   * else in this file has.
   */
  readonly #onTextArea = (event: CustomEvent<TextAreaChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === PREP_NOTES_FIELD) {
      this.prep = withPrepNotes(this.prep, event.detail.value);
      return;
    }
    this.#writeSetupAnswer(field, event.detail.value);
  };

  /**
   * Writes one §22.1 answer, or nothing at all.
   *
   * The `isSetupField` guard is the whole of the routing: `fields.ts` makes a
   * setup field name *be* a `LifterSetup` key, so there is no per-box constant
   * to switch on and the check has to be against the tuple. It is also what
   * stops the `default` branches above from accepting a `data-field` this
   * element never rendered -- the listeners are on the host, so a composed event
   * from anywhere in the tree reaches them.
   *
   * The conversion of the three closed-vocabulary answers happens in
   * `withSetupAnswer`, beside the type, rather than here; a switch over
   * `squatStart`, `footBlocks` and `handoff` in this file would be a §22
   * vocabulary living in the module that knows about plans and platforms.
   */
  #writeSetupAnswer(field: string | null, value: string): void {
    if (field === null || !isSetupField(field)) return;
    this.prep = withSetupAnswer(this.prep, field, value);
  }

  /**
   * §22.2's add box, decided here because only here can clear it.
   *
   * The element reports the text with the press and holds no opinion; the
   * refusal codes come back from `addCustomItem` and are handed straight down.
   */
  readonly #onPrepAddItem = (event: CustomEvent<PrepAddItemDetail>): void => {
    const result = addCustomItem(this.prep, event.detail.text);
    if (!result.ok) {
      this.customItemRefusal = result.refusal;
      return;
    }
    this.prep = result.prep;
    this.customItemText = '';
    this.customItemRefusal = null;
  };

  /** §22.2's removal, which only ever reaches a row somebody added. */
  readonly #onPrepRemoveItem = (event: CustomEvent<PrepRemoveItemDetail>): void => {
    this.prep = removeCustomItem(this.prep, event.detail.itemId);
  };

  /**
   * §20's answers, filed under the lift the fold was showing.
   *
   * The element reports a whole `MeetWarmupState` rather than one field, which
   * is why this is an assignment and not a patch: `ptk-meet-warmup` owns no
   * state of its own (its header says so), so the record it hands back is the
   * one it was given with a single answer moved, and merging here would be a
   * second copy of the writers in `warmup.ts`.
   *
   * The lift comes off the DOM rather than off `warmupLift`, which
   * `WARMUP_SUBJECT_FIELD` in `fields.ts` argues at length. Silence when there
   * is no attribute above the event, rather than a fallback to the state: a
   * report from something that is not the fold is not an answer about any lift.
   *
   * Which lifter it is about needs no attribute of its own, because exactly one
   * is open at a time: the coach path renders the fold only inside
   * `#renderCoachLifter`, which is reached only when `openLifterId` is set. So
   * the open lifter *is* the subject, and the guard below is the honest reading
   * of a report arriving with nobody open -- which a control cannot produce and
   * a forged event can.
   */
  readonly #onWarmupChange = (event: CustomEvent<MeetWarmupChangeDetail>): void => {
    const lift = this.#warmupLiftOf(event);
    if (lift === null) return;
    if (this.mode === 'coach') {
      const lifterId = this.coach?.openLifterId ?? null;
      if (lifterId === null) return;
      this.coachWarmups = withWarmupForLifter(
        this.coachWarmups,
        lifterId,
        lift,
        event.detail.state,
      );
      return;
    }
    this.warmups = withWarmupFor(this.warmups, lift, event.detail.state);
  };

  /**
   * §19's answers, filed under the record the fold was showing.
   *
   * `#onWarmupChange` above, one attribute over, and every sentence in its
   * header applies here for the same reasons -- whole state rather than a
   * patch, subject off the DOM rather than off `recordSubject`, silence when no
   * attribute sits above the event, and the open lifter as the only subject the
   * coach path can mean.
   *
   * The one thing that is genuinely different: a record filed under the wrong
   * subject is not a cosmetic mix-up. Every margin in `recordPlan` is measured
   * off the figure typed here, so a squat record landing on the deadlift row
   * produces a legal-looking weight for a record that does not exist -- which
   * is why the subject is narrowed in `#recordSubjectOf` and dropped rather
   * than defaulted when it does not read.
   */
  readonly #onRecordChange = (event: CustomEvent<MeetRecordChangeDetail>): void => {
    const subject = this.#recordSubjectOf(event);
    if (subject === null) return;
    if (this.mode === 'coach') {
      const lifterId = this.coach?.openLifterId ?? null;
      if (lifterId === null) return;
      this.coachRecords = withRecordForLifter(
        this.coachRecords,
        lifterId,
        subject,
        event.detail.state,
      );
      return;
    }
    this.records = withRecordFor(this.records, subject, event.detail.state);
  };

  /**
   * The plan, onto a board.
   *
   * Not guarded on the name being blank, although the button is disabled for it.
   * A press landing on the `ptk-button` host's own padding runs the listener
   * whatever the inner control's state -- a real thumb on a real phone -- and
   * `add-lifter` refuses an empty name with `lifter-name-required`, which is
   * already a sentence this screen knows how to say. A second check here would
   * be a copy of a domain rule in an element, silently answering differently the
   * day the rule changes.
   */
  readonly #onStart = (): void => {
    const context = this.#context();
    const view = this.#view();
    if (context === null || view === null) return;

    const seeded = seedLiveMeet({
      rules: context.rules,
      session: this.session,
      view,
      lifterName: this.lifterName,
      at: this.clock.now(),
    });
    if (!seeded.ok) {
      this.problems = seeded.problems.map((problem) => problem.code);
      return;
    }
    if (seeded.unplaced.length > 0) {
      // A planned weight the same rule set then refused is a defect in this
      // tool, not something a lifter did, and there is nothing for them to act
      // on -- the attempt is simply blank and the screen asks them to choose.
      // Codes only: the messages quote the plan, and §2.3 keeps a lifter's
      // figures out of the console.
      console.error(
        'meet-day: planned weights did not reach the board',
        seeded.unplaced.map((problem) => problem.code),
      );
    }

    this.live = {
      rules: context.rules,
      lifterId: seeded.lifterId,
      // The same `view` object `livePlanningFrom` is built from, one line down,
      // so the plan the summary compares against and the plan the board was
      // seeded from cannot be two different plans.
      view,
      planning: livePlanningFrom(view),
      targets: liveTargetsFrom(this.session),
      timeline: seeded.timeline,
    };
    // A documented mutation survivor: `viewingPlan` is already false wherever
    // this can run, because only `#onBackToPlan` sets it and that control
    // exists only while a meet is up -- at which point `#renderStart` draws
    // nothing to press. So the assignment is unreachable *by argument* rather
    // than by effect, and it stays: the day a meet can be finished, starting a
    // second one from the plan screen is exactly the path that needs it, and
    // the failure would be a board that is running with the plan on screen.
    this.viewingPlan = false;
    this.#clearFeedback();
  };

  readonly #onBackToPlan = (): void => {
    this.viewingPlan = true;
  };

  /*
   * Both toggles move a screen state and nothing else. Neither one decides
   * whether the sheet is printed -- that is `@media print`, unconditionally --
   * so pressing Hide before pressing Print still produces the sheet.
   */
  readonly #onTogglePack = (): void => {
    this.showingPack = !this.showingPack;
  };

  readonly #onToggleRoster = (): void => {
    this.showingRoster = !this.showingRoster;
  };

  readonly #onReturnToMeet = (): void => {
    this.viewingPlan = false;
  };

  /**
   * §13's choice, which is two actions or one depending on what was chosen.
   *
   * A weight is set and then declared, because `actionFor` keys the next action
   * off the attempt's status and a weight sitting at `planned` leaves the screen
   * still asking the lifter to choose the thing they just chose. A pass is a
   * result rather than a weight -- there is no weight to set -- and recording it
   * is what moves the meet on to the next lift.
   */
  readonly #onLiveChoice = (event: CustomEvent<LiveChoiceDetail>): void => {
    const { attemptId, kilograms } = event.detail;
    if (kilograms === null) {
      this.#applyLive({ kind: 'record-result', attemptId, result: { outcome: 'passed' } });
      return;
    }
    if (!this.#applyLive({ kind: 'set-attempt-weight', attemptId, kilograms })) return;
    this.#applyLive({ kind: 'advance-attempt', attemptId, to: 'selected' });
  };

  readonly #onSubmissionMarked = (event: CustomEvent<SubmissionMarkedDetail>): void => {
    this.#applyLive({
      kind: 'advance-attempt',
      attemptId: event.detail.attemptId,
      to: 'submitted',
    });
  };

  /**
   * §12's result, with the lights written *before* the outcome and not after.
   *
   * Both orders produce the same document and only one of them produces the
   * right undo. Recording the result last means the last action is the result,
   * so §13.9's control takes back the mis-tap it exists for; annotating last
   * means one press removes the lights and leaves the wrong outcome standing,
   * on a screen whose button said it would undo recording the attempt.
   *
   * The annotation is skipped when there is nothing to say, so an undo after a
   * result recorded with no lights and no note is still one press.
   */
  readonly #onAttemptResult = (event: CustomEvent<AttemptResultDetail>): void => {
    const { attemptId, result, lights, note } = event.detail;
    if (lights !== null || note !== null) {
      if (!this.#applyLive({ kind: 'annotate-attempt', attemptId, lights, note })) return;
    }
    this.#applyLive({ kind: 'record-result', attemptId, result });
  };

  /**
   * §13.9's undo, declined when the world moved between the paint and the tap.
   *
   * The screen sends what it *said* it would take back, and this compares it
   * with what would actually go. They are the same object when nothing has
   * changed -- `undoableAction` returns the action off the timeline the view was
   * built from -- so identity is the whole check. Declining silently is right:
   * the screen has already repainted with the new label, and an error about a
   * press that did nothing would be a sentence about a race the lifter cannot
   * see.
   */
  readonly #onUndoRequest = (event: CustomEvent<UndoRequestDetail>): void => {
    const run = this.#current();
    if (run === null) return;
    if (undoableAction(run.timeline) !== event.detail.action) return;
    this.#undo(run);
  };

  /**
   * §26's undo, from the root's own control rather than from a child.
   *
   * No identity check, unlike the handler above, because there is no child that
   * named an action and nothing repainting behind the press: the summary is a
   * finished meet. `#renderFinishedUndo` says the same thing from the other side.
   */
  readonly #onFinishedUndo = (): void => {
    const run = this.#current();
    if (run === null) return;
    this.#undo(run);
  };

  /** One step back, and whatever came back if the document refused it. */
  #undo(run: RunningMeet): void {
    const result = undo(run.timeline);
    if (!result.ok) {
      this.problems = result.problems.map((problem) => problem.code);
      return;
    }
    this.#commit(result.timeline);
    this.#clearFeedback();
  }

  /** One action onto the document, and whatever came back if it was refused. */
  #applyLive(action: MeetAction): boolean {
    const run = this.#current();
    if (run === null) return false;
    const result = applyMeetAction(run.rules, run.timeline, action, this.clock.now());
    if (!result.ok) {
      this.#refuse(run, action, result.problems);
      return false;
    }
    this.#commit(result.timeline);
    this.#clearFeedback();
    return true;
  }

  /**
   * Whichever meet the mode says is running, or neither.
   *
   * The two are mutually exclusive by construction, not by discipline: the §6.1
   * choice comes off the screen the moment either exists, so nothing can start
   * the second one. This pair is what lets §12's result flow, §13's choices,
   * §14.1's mark and §13.9's undo be written once and reached from both screens
   * -- a coach recording an attempt on one of their lifters goes through exactly
   * the handlers a lifter recording their own does.
   */
  #current(): RunningMeet | null {
    return this.mode === 'coach' ? this.coach : this.live;
  }

  #commit(timeline: MeetTimeline): void {
    if (this.mode === 'coach') {
      if (this.coach !== null) this.coach = { ...this.coach, timeline };
      return;
    }
    if (this.live !== null) this.live = { ...this.live, timeline };
  }

  /**
   * A refusal, split between the two places a lifter would look for it.
   *
   * `weight-not-legal` is one code covering every reason a weight is illegal,
   * and its message is prose the document built. The reason *codes* are what the
   * choices element renders under the field, so they are asked for again here --
   * from the same `MeetRules` the refusal came from, so this cannot disagree
   * with it. Deriving them instead of pre-checking is deliberate: the document
   * decides, and this only asks why.
   */
  #refuse(run: RunningMeet, action: MeetAction, problems: readonly MeetActionProblem[]): void {
    if (action.kind === 'set-attempt-weight') {
      const illegal = problems.some((problem) => problem.code === 'weight-not-legal');
      if (illegal) {
        this.refusals = this.#refusalsFor(run, action.attemptId, action.kilograms);
        this.problems = problems
          .filter((problem) => problem.code !== 'weight-not-legal')
          .map((problem) => problem.code);
        return;
      }
    }
    this.refusals = [];
    this.problems = problems.map((problem) => problem.code);
  }

  #refusalsFor(
    run: RunningMeet,
    attemptId: string,
    kilograms: number,
  ): readonly AttemptRefusalCode[] {
    const found = findAttempt(run.timeline.present, attemptId);
    if (found === null) return [];
    const legality = run.rules.isLegalNextAttempt(
      takenOn(found.lifter, found.attempt.lift),
      kilograms,
    );
    return legality.legal ? [] : legality.reasons;
  }

  /**
   * Cleared on every accepted action, both together.
   *
   * A refusal that outlives the weight it was about is the worst of the two
   * available bugs here: the lifter retypes, the table takes it, and the red
   * sentence under the field still says the rules do not allow it.
   */
  #clearFeedback(): void {
    this.refusals = [];
    this.problems = [];
  }

  /*
   * ---------------------------------------------------------------------------
   * Coach mode.
   * ---------------------------------------------------------------------------
   */

  /**
   * A fresh run, deliberately not assigned to `this.coach` by this function.
   *
   * The caller assigns it only once `add-lifter` has been accepted, so a refused
   * first name leaves the federation and the meet-type questions still on the
   * screen and still answerable. Assigning here instead would fix the rule book
   * on a press that added nobody -- the coach corrects the name, and the meet
   * they are correcting it into is one they can no longer change the format of.
   */
  #startCoachMeet(): CoachRun | null {
    const context = this.#context();
    if (context === null) return null;
    return {
      rules: context.rules,
      timeline: startTimeline(createMeetDocument(context.rules, this.session.setup.format)),
      entries: [],
      openLifterId: null,
    };
  }

  /**
   * §21's roster, and the press that starts the meet if nothing has yet.
   *
   * Not guarded on a blank name, for the reason `#onStart` is not: a press
   * landing on the `ptk-button` host's own padding runs the listener whatever
   * the inner control's state, and `add-lifter` refuses an empty name with
   * `lifter-name-required`, which this screen already knows how to say. The
   * refusal reaches the coach through `problems`, and the run is dropped on the
   * floor rather than kept -- see `#startCoachMeet`.
   */
  readonly #onRosterAdd = (event: CustomEvent<RosterAddDetail>): void => {
    const run = this.coach ?? this.#startCoachMeet();
    if (run === null) return;
    const result = applyMeetAction(
      run.rules,
      run.timeline,
      { kind: 'add-lifter', name: event.detail.name },
      this.clock.now(),
    );
    if (!result.ok) {
      this.problems = result.problems.map((problem) => problem.code);
      return;
    }
    this.coach = { ...run, timeline: result.timeline };
    this.rosterName = '';
    this.#clearFeedback();
  };

  /**
   * §21.1's one tap from the board to one lifter's own platform screen.
   *
   * The id is re-checked against the document rather than trusted, the way
   * `ptk-coach-board` re-checks it against its own view: the board is re-sorted
   * by urgency four times a second, so the row under a thumb at the start of a
   * press is not necessarily the row under it at the end (§13.6). An id that no
   * longer names anybody would open a screen `buildLiveView` answers `null` for,
   * which renders as a meet that is over.
   */
  readonly #onBoardOpen = (event: CustomEvent<BoardOpenDetail>): void => {
    const run = this.coach;
    if (run === null) return;
    const lifterId = event.detail.lifterId;
    if (!run.timeline.present.lifters.some((lifter) => lifter.id === lifterId)) return;
    this.coach = { ...run, openLifterId: lifterId };
    this.#clearFeedback();
  };

  readonly #onBoardPin = (event: CustomEvent<BoardPinDetail>): void => {
    this.#patchEntry(event.detail.lifterId, { pinned: event.detail.pinned });
  };

  readonly #onBackToBoard = (): void => {
    const run = this.coach;
    if (run === null) return;
    this.coach = { ...run, openLifterId: null };
  };

  /**
   * One lifter's per-device entry, created by whichever answer arrives first.
   *
   * Every writer comes through here, which is what makes one validity check
   * enough: an id that does not name somebody in the document writes nothing.
   * Without it a stale `data-lifter` would grow an entry for a lifter who is not
   * in the meet, and `buildBoardView` matches entries to lifters by id -- so it
   * would sit in the list, invisible, and §24 would save it and carry it to the
   * next device the file is opened on.
   */
  #patchEntry(lifterId: string | null, patch: Partial<Omit<CoachBoardEntry, 'lifterId'>>): void {
    const run = this.coach;
    if (run === null || lifterId === null) return;
    if (!run.timeline.present.lifters.some((lifter) => lifter.id === lifterId)) return;
    const known = run.entries.some((entry) => entry.lifterId === lifterId);
    const entries = known
      ? run.entries.map((entry) => (entry.lifterId === lifterId ? { ...entry, ...patch } : entry))
      : [...run.entries, { lifterId, ...patch }];
    this.coach = { ...run, entries };
  }

  /**
   * One lifter's handlers, as the entry holds them and never as the board does.
   *
   * `coachBoard` drops the unnamed ones (§21.3's rows are created blank), so a
   * writer reading the board's list back would renumber every position after the
   * first unnamed row -- and the symptom is a coach typing a name into row three
   * and watching row four change.
   */
  #handlersOf(lifterId: string): readonly HandlerAssignment[] {
    return this.coach?.entries.find((entry) => entry.lifterId === lifterId)?.handlers ?? [];
  }

  /**
   * One field of one handler, found by the two tags on the control's path.
   *
   * Refuses a position that is not in the list rather than growing one. A stale
   * `data-handler` -- a press landing after a remove has rebuilt the fold -- is
   * the case, and appending in that situation would add a handler nobody asked
   * for, carrying half of one they had just deleted.
   */
  #patchHandler(event: Event, patch: Partial<HandlerAssignment>): void {
    const lifterId = this.#lifterOf(event);
    const index = this.#handlerOf(event);
    if (lifterId === null || index === null) return;
    const handlers = this.#handlersOf(lifterId);
    if (handlers[index] === undefined) return;
    this.#patchEntry(lifterId, {
      handlers: handlers.map((handler, at) => (at === index ? { ...handler, ...patch } : handler)),
    });
  }

  /**
   * §21.3's add, which appends somebody with no name and everything to cover.
   *
   * `general` rather than nothing, and it is the one default in this file worth
   * arguing about. `covers` in §21.2 treats an empty list as covering nothing, so
   * a handler added and left untouched could never appear in a warning -- the
   * feature would be on the screen and off the board, which is the shape of a
   * bug rather than of a default. A second pair of hands on a lifter is
   * "anything" until somebody says otherwise, and the seven tiles are right
   * there to narrow it.
   */
  readonly #onHandlerAdd = (event: CustomEvent<RosterHandlerAddDetail>): void => {
    const lifterId = event.detail.lifterId;
    this.#patchEntry(lifterId, {
      handlers: [...this.#handlersOf(lifterId), { name: '', responsibilities: ['general'] }],
    });
  };

  readonly #onHandlerRemove = (event: CustomEvent<RosterHandlerRemoveDetail>): void => {
    const { lifterId, index } = event.detail;
    const handlers = this.#handlersOf(lifterId);
    // The same refusal `#patchHandler` makes, and the reason it cannot be shared
    // with it: this one has no field to write, so there is nothing to patch --
    // out of range here means removing the last handler instead of none.
    if (handlers[index] === undefined) return;
    const remaining = [...handlers];
    remaining.splice(index, 1);
    this.#patchEntry(lifterId, { handlers: remaining });
  };

  /*
   * ---------------------------------------------------------------------------
   * §24: saving, the shelf, and moving a meet between devices.
   * ---------------------------------------------------------------------------
   */

  /**
   * Every saved field as one object, for `updated`'s identity check.
   *
   * Deliberately the live objects rather than a copy of anything inside them.
   * Every one of §24.1's ten actions replaces the field it writes -- `this.prep
   * = withPrepNotes(...)`, `this.coach = { ...run, entries }` -- so a reference
   * comparison is exact here in a way it would not be in a codebase that
   * mutated. It is also the only comparison cheap enough: this runs on every
   * paint, and the coach board paints four times a second for the whole of a
   * meet, so a structural comparison would walk a document holding eight
   * lifters' attempts twelve hundred times a minute.
   */
  #snapshot(): StateSnapshot {
    return {
      mode: this.mode,
      session: this.session,
      prep: this.prep,
      live: this.live,
      coach: this.coach,
      warmups: this.warmups,
      warmupLift: this.warmupLift,
      coachWarmups: this.coachWarmups,
      records: this.records,
      recordSubject: this.recordSubject,
      coachRecords: this.coachRecords,
    };
  }

  /**
   * The same fields flattened into what the store can hold.
   *
   * `document` comes from whichever run is up, and `null` when neither is: a
   * meet named on the planning screen and never started is a real saved meet --
   * §22's prep and §7's session are most of what a lifter fills in the night
   * before -- and refusing to save it until a lifter presses Start would lose
   * exactly the work §24 exists to keep.
   *
   * The entries are rebuilt field by field rather than spread, which looks like
   * ceremony and is the one thing here that must not be simplified. A spread
   * carries `warmup` through, `JSON.stringify` in the store writes it, and a
   * meet reopened tomorrow announces a warm-up that was due nineteen hours ago.
   * `SavedCoachEntry` is `Omit<CoachBoardEntry, 'warmup'>`, so a spread would
   * also type-check -- an excess property is only refused on an object literal
   * assigned directly, and this one is inside a `map`.
   */
  #savedState(): SavedMeetState {
    const run = this.coach;
    return {
      mode: this.mode,
      session: this.session,
      prep: toSavedPrep(this.prep),
      document: this.live?.timeline.present ?? run?.timeline.present ?? null,
      lifterId: this.live?.lifterId ?? null,
      entries: (run?.entries ?? []).map(savedEntry),
      openLifterId: run?.openLifterId ?? null,
      history: this.#historyEntry(),
      warmup: this.#savedWarmup(),
      records: this.#savedRecords(),
    };
  }

  /**
   * §20's answers, or `null` where nobody has opened the fold.
   *
   * The guard is three identity comparisons against the class-field defaults, and
   * it is exact rather than approximate for `#warmupTimelines`' reason: every
   * writer in `warmup.ts` replaces the state wholesale, so a state that is still
   * `EMPTY_WARMUP_STATES` is one nothing has been typed into. What it is *not* is
   * a test for "the answers are all blank" -- a lifter who typed a figure and
   * deleted it again writes an equal-but-distinct object and saves the whole
   * thing. That is the right way round: the cheap check catches the common case,
   * and the expensive one would be a deep walk of two plate inventories on every
   * keystroke to save a kilobyte.
   *
   * `SavedWarmup` argues the size question in full. In short, an always-present
   * empty answer is five kilobytes on every saved meet whose fold was never
   * opened, and most saved meets are exactly that.
   */
  #savedWarmup(): SavedWarmup | null {
    if (
      this.warmups === EMPTY_WARMUP_STATES &&
      this.warmupLift === NO_WARMUP_ANSWERS.lift &&
      this.coachWarmups === NO_WARMUPS
    ) {
      return null;
    }
    return toSavedWarmup({
      states: this.warmups,
      lift: this.warmupLift,
      byLifter: this.coachWarmups,
    });
  }

  /**
   * §19's answers, or `null` where nobody has typed a record.
   *
   * `#savedWarmup`'s guard, one fold down, and the identity argument transfers
   * whole: every writer in `records.ts` replaces the state it touches, so a
   * `records` still identical to `EMPTY_RECORD_STATES` is one nothing has reached.
   *
   * What does **not** transfer is the reason for having a guard at all. The
   * warm-up's is size -- five kilobytes of plate inventory on every saved meet
   * whose fold was never opened -- and four record states are a few hundred bytes,
   * so on size alone this could save unconditionally. It is here because `null` is
   * the difference the restore reads: `fromSavedRecords(null)` is the empty answer
   * and nothing is marked, while a `SavedRecords` is answers somebody typed and
   * every non-blank one of them earns `RECORD_RESTORED`. Saving an empty object
   * instead would put that caveat over four untouched boxes on the first meet a
   * lifter ever reopens.
   *
   * `recordSubject` is deliberately **not** part of the guard, unlike
   * `warmupLift` in the method above. It is one answer shared across both paths
   * and every lifter (`#chooseRecordSubject` says why), so a coach who moved the
   * picker to the deadlift and typed nothing has expressed a preference about the
   * question rather than an answer to it -- and writing a `SavedRecords` for it
   * would flag four blank folds as restored to say so. The picker position is
   * kept only where there is something to keep it with.
   */
  #savedRecords(): SavedRecords | null {
    if (this.records === EMPTY_RECORD_STATES && this.coachRecords === NO_RECORDS) return null;
    return toSavedRecords({
      states: this.records,
      subject: this.recordSubject,
      byLifter: this.coachRecords,
    });
  }

  /**
   * §9.4's entry, once the day is over, and `null` every other moment.
   *
   * WHY IT IS FILED HERE AND NOT WHEN THE SUMMARY IS RENDERED
   *
   * `#renderLive` builds the same summary to draw §26's page, so filing the entry
   * there would save a call. It would also file it from a render, which is the
   * one place in this element that must not have a side effect: the screen
   * repaints off the clock seam four times a second, and a write per paint is a
   * write to the disk four times a second for as long as the finished screen is
   * open. Doing it from the save path means it is stamped exactly when everything
   * else about the meet is, under `updated`'s snapshot guard -- which no clock
   * tick moves, because none of the five fields it compares is the time.
   *
   * WHY IT ASKS `positionOf` RATHER THAN READING A VIEW
   *
   * There is no `LiveView` here. Building one needs a rule book, a chart, a plan,
   * targets, observations and an instant, and the answer wanted is one boolean --
   * but re-deriving that boolean in this file is the worse option by some way.
   * "The meet is over" is a rule about extra attempts and uncontested lifts
   * (§13.5, §13.8), and a second reading of it that drifted would file a history
   * entry for a lifter still owed a deadlift, which calibration would then read
   * as a bombed meet.
   *
   * SOLO ONLY
   *
   * §9.4 is *personal* calibration, and a coach's phone accumulating three
   * athletes' meets into one history is a worse version of the equipment mixture
   * §9.4 is written to separate. The coach path has nothing to file anyway: its
   * summary is built with `EMPTY_VIEW` and no targets, so every
   * `plannedMaximumKilograms` on it would be null.
   */
  #historyEntry(): SavedHistory | null {
    const run = this.live;
    if (run === null) return null;
    if (positionOf(run.timeline.present, run.lifterId)?.meetOver !== true) return null;
    const { equipment, lifts } = summariseMeet({
      rules: run.rules,
      chart: this.chart,
      timeline: run.timeline,
      lifterId: run.lifterId,
      view: run.view,
      targets: run.targets,
      equipment: historyEquipmentFor(this.session.extras.equipment),
    }).historyEntry;
    return { equipment, lifts };
  }

  /**
   * Write the open meet's state into the library, then the library to the store.
   *
   * The library half is synchronous and the store half is not, deliberately:
   * `this.library` is what the shelf renders and what the next save merges into,
   * so leaving it behind an await would let two saves a keystroke apart both
   * read the pre-save library and the second one lose the first.
   *
   * A refusal here is reported and the write is abandoned. The only reachable
   * one is `unknown-meet` -- a meet deleted from the shelf while it is open --
   * and re-creating it silently would resurrect something the lifter has just
   * confirmed they wanted gone.
   */
  #save(id: string): void {
    const change = saveMeetState(this.library, id, this.#savedState(), this.clock.now());
    if (!change.ok) {
      this.#say(libraryRefusalSentence(change.reason), 'error');
      return;
    }
    this.library = change.library;
    this.#writeLibrary(change.library);
  }

  /**
   * The store write, chained so that two of them cannot overtake each other.
   *
   * `MeetStore.save` reads the library, merges and writes it back, so an earlier
   * write finishing after a later one puts the earlier library on the disk --
   * and the loss is invisible until the next visit. Chaining is enough because
   * this element is the only writer; a lock would be the same guarantee with a
   * way to deadlock.
   *
   * The `catch` re-enters the same reporting path rather than propagating, which
   * is what keeps the chain from staying rejected: a rejected promise at the end
   * of `#writing` makes every later save a no-op, silently, for as long as the
   * screen is open.
   */
  #writeLibrary(library: MeetLibrary): void {
    this.#writing = this.#writing.then(async () => {
      try {
        this.#reportSave(await this.store.save(library));
      } catch {
        this.#reportSave('failed');
      }
    });
  }

  /**
   * What the shelf is told about a write, which for a successful one is nothing.
   *
   * `meetSavedSentence` answers `null` for `'saved'` -- a tool that says "saved"
   * after every keystroke is a tool nobody reads -- so the success path is
   * silent by construction rather than by a branch here.
   *
   * The `no-storage` suppression is the case worth spelling out. In a private
   * window the store keeps nothing and reports it on every write; the shelf
   * already carries `STORAGE_WARNING_NOT_DURABLE` permanently for exactly that
   * configuration. Saying it twice, once permanently and once per keystroke,
   * reads as something having just gone wrong rather than as the standing state
   * of the browser. The test is `!== 'device'` rather than `=== 'page'` so a
   * store added later that keeps nothing inherits the quiet: an unexpected
   * refusal on a shelf that promised durability is the one worth a sentence, and
   * that is the only case left.
   */
  #reportSave(outcome: SaveOutcome): void {
    if (outcome === 'no-storage' && this.store.persistence !== 'device') return;
    const sentence = meetSavedSentence(outcome);
    if (sentence === null) return;
    this.#say(sentence, 'error');
  }

  #say(message: string, tone: NoticeTone): void {
    this.shelfMessage = message;
    this.shelfTone = tone;
  }

  /**
   * Read the shelf, once per store.
   *
   * The result is checked against the store it came from before it is used. A
   * story that swaps `store` mid-flight -- or a route that hands in a real one
   * after painting with `noMeetStore` -- otherwise has the first read land after
   * the second and overwrite it with the library of a store nobody is using,
   * which is a shelf that keeps reappearing empty.
   */
  #loadLibrary(): void {
    const store = this.store;
    void store.load().then((stored) => {
      if (this.store !== store) return;
      this.unreadable = stored.unreadable;
      this.#adopt(stored.library);
    });
  }

  /**
   * Take a new library, and follow it if it moved the open meet.
   *
   * Every library command funnels through here rather than assigning
   * `this.library` directly, because several of them change which meet is open
   * as a side effect of doing something else: `duplicateMeet` opens the copy and
   * `archiveMeet` closes the meet it archives. The screen has to *notice* that
   * rather than be told, or duplicating meet A while meet B is open leaves B's
   * attempts on screen and the next auto-save writes them over the copy of A.
   *
   * Closing deliberately leaves the screen exactly as it is. Blanking it would
   * be the tool throwing away work in response to a press about a different
   * meet; what happens instead is that the naming block comes back, auto-save
   * stops, and naming a new meet carries the state on screen into it.
   */
  #adopt(library: MeetLibrary): void {
    this.library = library;
    const meet = activeMeet(library);
    const id = meet?.id ?? null;
    if (id === this.#openMeetId) return;
    this.#openMeetId = id;
    if (meet === null) {
      this.#lastSaved = null;
      return;
    }
    this.#pending = meet;
    this.#restoreIfReady();
  }

  /**
   * Restore the waiting meet once the rule profiles have arrived.
   *
   * The store answers off the device and `profiles` is a network read, so on a
   * cold visit the meet to restore is known several hundred milliseconds before
   * the rule book it was planned under. Restoring the session immediately and
   * the document later would paint one screen and then a different one, and a
   * lifter typing into the first loses it -- so the meet waits in `#pending`
   * until the whole restore can happen on one update.
   *
   * `failed` counts as ready. A rule book that could not be read is not going to
   * arrive later, and the alternative is a saved meet the lifter can see on the
   * shelf and can never open.
   */
  #restoreIfReady(): void {
    const meet = this.#pending;
    if (meet === null || this.status === 'loading') return;
    this.#pending = null;
    this.#restore(meet);
  }

  /**
   * Put a saved meet on screen, run and all.
   *
   * The run is rebuilt rather than stored, which is the same argument
   * `liveChoicesFor` and `buildLiveView` make (§13.1, §13.5): `rules` comes from
   * the rule book published *now*, `planning` and `targets` are recomputed from
   * the restored session, and the document is the only thing that was actually
   * written down. A stored `LiveRun` would carry a rule book the lifter can no
   * longer see the source of.
   *
   * `startTimeline` rather than the saved history, because the history is not
   * saved: undo takes back the actions of *this* sitting, and a lifter who
   * reopens a meet in the morning pressing undo ten times would walk back
   * yesterday's attempts one at a time. §13.10 made the same call when live mode
   * seeds a plan.
   *
   * `#lastSaved` is set at the end so the restore itself does not immediately
   * look like a change and write the meet straight back out.
   */
  #restore(meet: SavedMeet): void {
    const state = meet.state;
    this.mode = state.mode;
    this.session = state.session;
    this.prep = fromSavedPrep(state.prep);
    this.live = null;
    this.coach = null;
    this.viewingPlan = false;
    this.meetName = '';
    this.importing = null;
    this.#clearFeedback();

    // All three together, and assigned unconditionally. `fromSavedWarmup` answers
    // the empties for a meet with no warm-up in it, which is what makes this a
    // *restore* rather than a merge: switching from a meet whose squat room is
    // kilogram plates to one saved before §20 existed must leave the second one
    // showing the defaults, not the first one's rack.
    const warmup = fromSavedWarmup(state.warmup);
    this.warmups = warmup.states;
    this.warmupLift = warmup.lift;
    this.coachWarmups = warmup.byLifter;

    // §19's three, on the same terms and for the same reason. The marking is the
    // half that is not a mirror of the warm-up: what came off the disk has to be
    // distinguishable from what somebody types next, and this is the only moment
    // the difference is knowable.
    const records = fromSavedRecords(state.records);
    this.records = records.states;
    this.recordSubject = records.subject;
    this.coachRecords = records.byLifter;
    this.#markRestored(records);

    const context = this.#context();
    const document = state.document;
    if (context !== null && document !== null) {
      const timeline = startTimeline(document);
      if (state.mode === 'coach') {
        this.coach = {
          rules: context.rules,
          timeline,
          entries: [...state.entries],
          openLifterId: state.openLifterId,
        };
      } else if (state.lifterId !== null) {
        const view = this.#view();
        this.live = {
          rules: context.rules,
          timeline,
          lifterId: state.lifterId,
          // Rebuilt from the restored session rather than restored, because §24
          // saves the answers and not the drawn plan. So a meet taken off the
          // shelf compares its attempts against the plan those answers produce
          // *now* -- under whatever rule book the session names now, which is
          // the drift `#restoreReport` is about. `EMPTY_VIEW` where there is no
          // plan at all is the lit-html binding rule arriving in a field: the
          // summary reads `view.lifts` and a null would reach it.
          view: view ?? EMPTY_VIEW,
          planning: view === null ? NO_PLANNING_AT_ALL : livePlanningFrom(view),
          targets: liveTargetsFrom(this.session),
        };
      }
    }

    this.#say(this.#restoreReport(meet) ?? '', 'info');
    this.#lastSaved = this.#snapshot();
  }

  /**
   * Files every restored record answer somebody actually typed.
   *
   * Both paths in one walk, because the caveat is per state object and the fold
   * asks the same question whichever screen drew it.
   *
   * **The blank ones are skipped, and that is the whole of the correctness here.**
   * `RecordStates` is total over the four subjects, so a meet where the lifter
   * answered only the squat still restores four states -- three of them empty
   * boxes with nothing in them to have gone stale. Marking those would put
   * `RECORD_RESTORED` over the deadlift fold of every meet ever reopened, which
   * is a warning about nothing, and a warning about nothing is how a lifter learns
   * to read past the one that matters.
   *
   * Nothing is ever removed. There is no need: a retyped answer is a new object
   * (`records.ts` replaces rather than mutates) and was therefore never in the
   * set, and restoring a second meet marks its own states without the first
   * meet's being reachable from any field.
   */
  #markRestored(answers: RecordAnswers): void {
    const mark = (states: RecordStates): void => {
      for (const subject of RECORD_SUBJECTS) {
        const state = states[subject];
        if (!isBlankRecord(state)) this.#restoredRecords.add(state);
      }
    };
    mark(answers.states);
    for (const states of answers.byLifter.values()) mark(states);
  }

  /**
   * Which of §24's three drift reports applies, or `null` for none.
   *
   * Ordered by how much of the plan is unchecked: a profile that is gone means
   * nothing on screen can be checked against a federation at all, a revision
   * that moved means the increment and the deadline may have, and a methodology
   * that moved means only that anything worked out from here uses a newer
   * method. One sentence, because three at once is a screen a lifter closes.
   *
   * A meet whose recorded federation is not the one the restored session names
   * reports nothing. That is a lifter who changed federation after naming the
   * meet: the plan on screen has already been redrawn under the new rule book,
   * so `rulebookRevision` describes a rule book nothing is being checked against
   * and comparing it would raise a warning about a change the lifter made
   * themselves. An unnamed profile -- a meet named before any federation was
   * chosen -- falls out of the same check.
   */
  #restoreReport(meet: SavedMeet): string | null {
    if (meet.rulesProfileId !== this.session.setup.federationId) return null;
    const profile = this.profiles.find((candidate) => candidate.id === meet.rulesProfileId) ?? null;
    if (profile === null) return RESTORE_PROFILE_MISSING;
    if (profile.source.revision !== meet.rulebookRevision) return RESTORE_RULEBOOK_MOVED;
    if (meet.methodologyVersion !== SAVED_MEET_METHODOLOGY_VERSION)
      return RESTORE_METHODOLOGY_MOVED;
    return null;
  }

  /**
   * §24's naming press: the screen becomes a meet, without moving.
   *
   * Deliberately not routed through `#adopt`. A create opens the meet it just
   * made, and `#adopt` restores whatever it opens -- which here would rebuild
   * `live` and `coach` from the state that was saved a microsecond ago, throwing
   * away the undo history and, on the coach path, the open lifter's screen. The
   * saved state *is* the screen, so there is nothing to restore.
   *
   * Not guarded on a blank name either, for the reason `#onStart` and
   * `#onRosterAdd` are not: a press landing on the `ptk-button` host's own
   * padding runs the listener whatever the inner control's state, and
   * `readMeetName` refuses an empty name with a sentence this screen can say.
   */
  readonly #onCreateMeet = (): void => {
    const reading = readMeetName(this.meetName);
    if (!reading.ok) {
      this.#say(libraryRefusalSentence(reading.reason), 'error');
      return;
    }
    const profile = this.#profile();
    const change = createMeet(this.library, {
      name: reading.name,
      now: this.clock.now(),
      // Empty when no federation has been chosen, which is a real state: §22's
      // prep fold is answerable from the first paint and is most of what gets
      // filled in the night before. `#restoreReport` treats it as nothing to
      // check rather than as a rule book that disappeared.
      rulesProfileId: profile?.id ?? '',
      rulebookRevision: profile?.source.revision ?? '',
      state: this.#savedState(),
    });
    if (!change.ok) {
      this.#say(libraryRefusalSentence(change.reason), 'error');
      return;
    }
    this.library = change.library;
    this.#openMeetId = change.library.activeMeetId;
    this.#lastSaved = this.#snapshot();
    this.meetName = '';
    this.#say('', 'info');
    this.#writeLibrary(change.library);
  };

  /**
   * §24.2's five per-meet presses, applied and then followed.
   *
   * The command is turned into a `LibraryChange` by a pure function in
   * `saved-meet.ts` and this handler does nothing but report the refusal and
   * hand the result to `#adopt`. `duplicateMeet` and `archiveMeet` are the two
   * that move the open meet as a side effect, which is `#adopt`'s whole job.
   *
   * `?? ''` on the name is not defensive padding: the detail's `name` is
   * optional because three of the five commands have no name, so a forged event
   * missing one reaches `readMeetName('')` and is refused with "Give the meet a
   * name" rather than silently renaming a meet to nothing.
   */
  readonly #onMeetCommand = (event: CustomEvent<MeetCommandDetail>): void => {
    const change = this.#applyCommand(event.detail);
    if (!change.ok) {
      this.#say(libraryRefusalSentence(change.reason), 'error');
      return;
    }
    this.#say('', 'info');
    this.#adopt(change.library);
    this.#writeLibrary(change.library);
  };

  #applyCommand(detail: MeetCommandDetail): LibraryChange {
    const now = this.clock.now();
    switch (detail.kind) {
      case 'resume':
        return openMeet(this.library, detail.meetId);
      case 'rename':
        return renameMeet(this.library, detail.meetId, detail.name ?? '');
      case 'duplicate':
        return duplicateMeet(this.library, detail.meetId, detail.name ?? '', now);
      case 'archive':
        return archiveMeet(this.library, detail.meetId, detail.archived ?? false);
      case 'delete':
        return deleteMeet(this.library, detail.meetId);
    }
  }

  /**
   * §24.4's export: every saved meet, as one file.
   *
   * The whole shelf rather than the open meet, because the thing this is for is
   * moving to another device or keeping a copy off a browser that clears its
   * storage -- and a lifter who has to export five meets one at a time exports
   * none of them.
   *
   * The anchor is never attached to the document. A detached one still opens the
   * download, and attaching it would put a control in the light DOM of a page
   * that renders everything else inside a shadow root.
   */
  readonly #onMeetExport = (): void => {
    const now = this.clock.now();
    const url = URL.createObjectURL(
      new Blob([writeMeetFile(this.library.meets, now)], { type: 'application/json' }),
    );
    const link = window.document.createElement('a');
    link.href = url;
    link.download = meetExportFilename(isoDateOf(now));
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * §24.4's import, which is two presses because it says what it will do first.
   *
   * The file is read and parsed here and *nothing* is written; what comes back
   * is an `ImportPreview`, held in `@state` and rendered as a panel above the
   * shelf. That panel is drawn by this element rather than by
   * `ptk-meet-library`, deliberately: the shelf reports what it is given and
   * knows nothing about a file, and giving it a confirmation flow would put half
   * an import in each of two files.
   *
   * A file holding no meets is reported on the shelf and opens no panel. A
   * confirm button over an empty preview asks the lifter to agree to nothing.
   */
  readonly #onMeetImport = (event: CustomEvent<MeetImportDetail>): void => {
    void this.#readImport(event.detail.file);
  };

  async #readImport(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.#say(meetFileRefusalSentence('unreadable'), 'error');
      return;
    }
    const reading = readMeetFile(text);
    if (!reading.ok) {
      this.#say(meetFileRefusalSentence(reading.reason, reading.foundVersion), 'error');
      return;
    }
    const preview = previewImport(this.library, reading.file.meets);
    if (preview.entries.length === 0) {
      this.#say(importPreviewSentence(preview), 'error');
      return;
    }
    this.#say('', 'info');
    this.importing = preview;
  }

  /**
   * The second press: the meets are added, and none of them is opened.
   *
   * `importMeets` sets no `activeMeetId`, so the meet on screen stays the meet
   * on screen and `#adopt` is not called -- which is the right behaviour and
   * worth stating, because the obvious alternative is to open what just arrived.
   * A lifter importing a backup on the morning of a meet would then have the
   * screen they are standing at the expeditor's table with replaced by a file.
   */
  readonly #onConfirmImport = (): void => {
    const preview = this.importing;
    if (preview === null) return;
    this.importing = null;
    const outcome = importMeets(this.library, preview);
    this.library = outcome.library;
    this.#say(importOutcomeSentence(outcome), outcome.added === 0 ? 'error' : 'info');
    this.#writeLibrary(outcome.library);
  };

  readonly #onCancelImport = (): void => {
    this.importing = null;
    this.#say('', 'info');
  };

  /**
   * §24.2's delete-everything, which the shelf has already asked twice about.
   *
   * The screen is left alone for the reason closing a meet leaves it alone: the
   * press was about what is on the disk, and blanking the plan somebody is
   * looking at is a second destruction nobody asked for. What it does do is stop
   * saving -- there is no meet to save into -- so the naming block comes back
   * and says so.
   *
   * Nothing is said afterwards. The shelf visibly empties and prints its own
   * "nothing saved here" line, which is the report; a sentence beside an empty
   * shelf saying everything was deleted is the same fact twice.
   */
  readonly #onDeleteEverything = (): void => {
    this.#openMeetId = null;
    this.#lastSaved = null;
    this.#pending = null;
    this.library = EMPTY_LIBRARY;
    this.unreadable = 0;
    this.importing = null;
    this.#say('', 'info');
    this.#writing = this.#writing.then(async () => {
      try {
        await this.store.clear();
      } catch {
        this.#reportSave('failed');
      }
    });
  };

  /*
   * ---------------------------------------------------------------------------
   * The clock, attached only while something on screen is moving.
   * ---------------------------------------------------------------------------
   */

  #unwatch: (() => void) | null = null;

  /**
   * Which clock the subscription belongs to, so a swap is noticed.
   *
   * Comparing against this rather than tracking a boolean: a story that replaces
   * `clock` while live mode is up would otherwise keep ticking off the old one,
   * and the symptom is a countdown that ignores `advance()` -- which reads as
   * the countdown being broken rather than as the test holding the wrong clock.
   */
  #watched: Clock | null = null;

  readonly #onTick = (): void => {
    this.requestUpdate();
  };

  /**
   * Attached while something on screen is counting, which on the board is always.
   *
   * The solo path stops the clock behind the plan screens because nothing there
   * counts down. The coach path has no such state: the board *is* the countdown
   * -- every row carries one and the ladder re-sorts on them -- so it watches
   * from the moment the first lifter is added, including while one lifter's own
   * screen is open, because that screen is a live screen too.
   */
  #syncClock(): void {
    const running =
      this.mode === 'coach' ? this.coach !== null : this.live !== null && !this.viewingPlan;
    const wanted = running ? this.clock : null;
    if (wanted === this.#watched) return;
    this.#stopWatching();
    if (wanted === null) return;
    this.#watched = wanted;
    this.#unwatch = wanted.watch(this.#onTick);
  }

  #stopWatching(): void {
    this.#unwatch?.();
    this.#unwatch = null;
    this.#watched = null;
  }

  /**
   * Lit settles when this element's template is committed, which is before the
   * four elements it just handed a session to have rendered anything (§5.8). A
   * caller awaiting `updateComplete` and then reading text out of one would
   * otherwise read the previous render's -- usually not, which is what makes it
   * expensive.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }
}

/**
 * Which control fired, read from the composed path.
 *
 * `event.target` is retargeted to this host for anything fired inside a child's
 * own shadow tree, so its `dataset` is empty and every answer is dropped -- with
 * the controls still visibly responding, which reads as a rendering fault
 * (§5.8). The path is the only place the real element is still visible.
 */
function fieldOf(event: Event): string | null {
  return attributeOf(event, 'field');
}

/**
 * §21.3's ticks, narrowed against the tuple the tiles were built from.
 *
 * Filtered rather than cast, for the reason `isSetupField` is checked rather
 * than cast: a `ToggleGroupChangeDetail` is a list of strings out of the DOM, and
 * writing an unrecognised one into a `HandlerAssignment` would put it in §24's
 * export -- where the schema, built from this same tuple, refuses the whole file
 * on the next device rather than on this one. Dropping it here loses a tick
 * nothing could have produced; keeping it loses a meet.
 */
function asResponsibilities(values: readonly string[]): readonly HandlerResponsibility[] {
  const known: readonly string[] = HANDLER_RESPONSIBILITIES;
  return values.filter((value): value is HandlerResponsibility => known.includes(value));
}

/**
 * §20's subject, or `null` for a lift with no weight to count back from.
 *
 * `attemptsPerLift` comes off the rule book and there is no honest source for it
 * otherwise: guessing three would put a made-up figure into the estimate of how
 * long the flight ahead takes, which is the one number on the fold a lifter acts
 * on. Both paths hand in the rules the meet is being run under, which on the
 * coach path is the meet's own rather than whatever is on screen.
 */
function warmupSubject(
  lift: PlatformLift,
  openerKilograms: number | undefined,
  rules: MeetRules,
): WarmupSubject | null {
  if (openerKilograms === undefined) return null;
  return {
    lift,
    opener: { amount: openerKilograms, unit: 'kg' },
    attemptsPerLift: rules.profile.attemptsPerLift,
  };
}

/**
 * The weight a coach-path ramp counts back from: the lifter's first competition
 * attempt on that lift, or `undefined` while nobody has declared one.
 *
 * The first *competition* attempt, not the first attempt of any kind. A granted
 * extra shares the number it replaces (`meet-document.ts`), so a lifter who was
 * given a fourth on their opener has two attempts numbered one, and the record
 * attempt is not the weight the morning's ramp was built for.
 */
function openerOn(lifter: LiveLifter, lift: PlatformLift): number | undefined {
  const opener = lifter.attempts.find(
    (attempt) =>
      attempt.lift === lift && attempt.kind === 'competition' && attempt.attemptNumber === 1,
  );
  return opener?.kilograms ?? undefined;
}

/**
 * The nearest `data-<name>` on the composed path, for a name that is not
 * `field`.
 *
 * §22.2's checklist is the one control in the tool that answers a *group* of
 * rows rather than a field, and it says so with `data-group`. Reading it needs
 * the same walk `fieldOf` does and for the same reason, so the walk is written
 * once here and `fieldOf` is now a call to it -- two copies of a loop this
 * subtle is how one of them ends up stopping at the first `HTMLElement` rather
 * than at the first one carrying the attribute.
 *
 * `dataset` keys are camel-cased from the attribute, so a name here is the
 * dataset spelling. Every one in use is a single lower-case word, which is why
 * the two spellings have not yet had to be told apart.
 */
function attributeOf(event: Event, name: string): string | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    const value = node.dataset[name];
    if (value !== undefined) return value;
  }
  return null;
}

/**
 * Whether two snapshots are the same objects.
 *
 * Reference equality per field, which is exact here because every action in
 * this file replaces the field it writes rather than mutating it. The argument
 * for not comparing structurally is in `#snapshot`; the argument for comparing
 * at all is that `updated` runs on every paint and the coach board paints four
 * times a second, so an unconditional save would write the same document to the
 * disk twelve hundred times a minute for the whole of a meet.
 */
function sameState(left: StateSnapshot, right: StateSnapshot): boolean {
  return (
    left.mode === right.mode &&
    left.session === right.session &&
    left.prep === right.prep &&
    left.live === right.live &&
    left.coach === right.coach &&
    left.warmups === right.warmups &&
    left.warmupLift === right.warmupLift &&
    left.coachWarmups === right.coachWarmups &&
    left.records === right.records &&
    left.recordSubject === right.recordSubject &&
    left.coachRecords === right.coachRecords
  );
}

/**
 * A board entry with the stopwatch taken off it.
 *
 * Field by field rather than a rest-spread, because `warmup` is the one field
 * that must not be written down and `exactOptionalPropertyTypes` makes the
 * omission visible only if each optional field is spelled. A `const { warmup:
 * _drop, ...rest } = entry` would do the same job in one line and would also
 * carry any field added to `CoachBoardEntry` later straight into the saved
 * document, silently -- which for the next timing field is the same bug again.
 */
function savedEntry(entry: CoachBoardEntry): SavedCoachEntry {
  const saved: { -readonly [K in keyof SavedCoachEntry]: SavedCoachEntry[K] } = {
    lifterId: entry.lifterId,
  };
  if (entry.identifier !== undefined) saved.identifier = entry.identifier;
  if (entry.colour !== undefined) saved.colour = entry.colour;
  if (entry.platformCall !== undefined) saved.platformCall = entry.platformCall;
  if (entry.handlers !== undefined) saved.handlers = entry.handlers;
  if (entry.rackId !== undefined) saved.rackId = entry.rackId;
  if (entry.pinned !== undefined) saved.pinned = entry.pinned;
  return saved;
}

/**
 * The local calendar date, for the exported filename.
 *
 * `toISOString` is the one-line version and is wrong west of Greenwich for the
 * last hours of the evening: it would date a file exported at ten at night with
 * tomorrow, so a lifter exporting the night before a meet gets a file named for
 * the meet day and another one named the same the following morning. §5.5's
 * "never use `Date` for a calendar date" is the same hazard read the other way,
 * and there is no `PlainDate` here because this is not a domain figure -- it is
 * the local day, taken from the local fields.
 */
function isoDateOf(now: number): string {
  const when = new Date(now);
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${String(when.getFullYear())}-${month}-${day}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-day-planner': PtkMeetDayPlanner;
  }

  interface HTMLElementEventMap {
    [FEDERATION_CHANGE_EVENT]: CustomEvent<FederationChangeDetail>;
  }
}
