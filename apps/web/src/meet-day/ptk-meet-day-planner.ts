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
import type { MeetRuleProfile, PlatformLift } from '@platform-toolkit/data-contracts';
import type {
  AttemptRefusalCode,
  CoachBoardEntry,
  ConversionChart,
  LiveTarget,
  MeetAction,
  MeetActionProblem,
  MeetActionProblemCode,
  MeetTimeline,
  WeightUnit,
} from '@platform-toolkit/domain';
import {
  MeetRules,
  applyMeetAction,
  createMeetDocument,
  findAttempt,
  startTimeline,
  takenOn,
  undo,
  undoableAction,
} from '@platform-toolkit/domain';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import {
  CHOICE_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  TEXT_AREA_CHANGE_EVENT,
  TEXT_FIELD_CHANGE_EVENT,
  TOGGLE_GROUP_CHANGE_EVENT,
  type ChoiceChangeDetail,
  type NumberFieldChangeDetail,
  type TextAreaChangeDetail,
  type TextFieldChangeDetail,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { systemClock, type Clock } from '../clock.js';

import './ptk-coach-board.js';
import './ptk-coach-roster.js';
import './ptk-handler-pack.js';
import './ptk-live-screen.js';
import './ptk-meet-checklist.js';
import './ptk-meet-pack.js';
import './ptk-meet-prep.js';
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
  MEET_IS_RUNNING_NOTE,
  MODE_CHOICES,
  MODE_LABEL,
  NO_COLOUR,
  PACK_HEADING,
  PACK_HIDE_LABEL,
  PACK_PRINT_NOTE,
  PACK_SHOW_LABEL,
  PACK_SUMMARY,
  PREP_HEADING,
  PREP_SUMMARY,
  RETURN_TO_MEET_LABEL,
  START_MEET_HEADING,
  START_MEET_LABEL,
  START_MEET_NEEDS_A_PLAN,
  START_MEET_NOTE,
  UNIT_CHOICES,
  UNIT_LABEL,
  conversionChoices,
  conversionQuestion,
  meetProblemSentence,
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
  ROSTER_COLOUR_FIELD,
  ROSTER_IDENTIFIER_FIELD,
  ROSTER_NAME_FIELD,
  STRETCH_TOTAL_FIELD,
  TARGET_TOTAL_FIELD,
  UNIT_FIELD,
  isSetupField,
} from './fields.js';
import {
  EMPTY_LIVE_VIEW,
  NOTHING_OBSERVED,
  NO_PLANNING_AT_ALL,
  buildLiveView,
  type LivePlanning,
} from './live.js';
import { livePlanningFrom, liveTargetsFrom, seedLiveMeet } from './live-session.js';
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
import { ROSTER_ADD_EVENT, type RosterAddDetail, type RosterLifter } from './ptk-coach-roster.js';
import { LIVE_CHOICE_EVENT, type LiveChoiceDetail } from './ptk-live-choices.js';
import { UNDO_REQUEST_EVENT, type UndoRequestDetail } from './ptk-live-screen.js';
import {
  PREP_ADD_ITEM_EVENT,
  PREP_REMOVE_ITEM_EVENT,
  type PrepAddItemDetail,
  type PrepRemoveItemDetail,
} from './ptk-meet-checklist.js';
import { CONFIRM_VALUE } from './ptk-plan-method.js';
import type { ProfilesStatus } from './ptk-planner-setup.js';
import {
  SUBMISSION_MARKED_EVENT,
  type SubmissionMarkedDetail,
} from './ptk-submission-countdown.js';
import { buildHandlerPack, buildMeetPack, type HandlerPack, type MeetPack } from './pack.js';
import { EMPTY_VIEW, buildPlan, type PlanContext, type PlannerView } from './plan.js';
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
 * `rules`, `planning` and `targets` are the answers as they stood when the meet
 * started and are never refreshed. See the header: the planning screens remain
 * open behind live mode, and a weight already on the board does not move because
 * somebody corrected a figure that produced it.
 */
interface LiveRun extends RunningMeet {
  readonly lifterId: string;
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
 * The entries are also not persisted (§2.3, §13.4). An identifier is a lot
 * number and a colour is a coach's own shorthand, but the list they are keyed to
 * is a list of athletes' names, and a shared phone at a meet is exactly the
 * device this project does not leave that on.
 *
 * `openLifterId` is which screen is up rather than which lifter matters. The
 * board's own focus row is computed by the domain and changes as clocks run
 * down; this only moves when a coach taps §21.1's switch.
 */
interface CoachRun extends RunningMeet {
  readonly entries: readonly CoachBoardEntry[];
  readonly openLifterId: string | null;
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
   * form because it is wrong rather than blank. Persisting a whole meet is
   * task #52, where it comes with the consent question it needs.
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

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onText);
    this.addEventListener(TEXT_AREA_CHANGE_EVENT, this.#onTextArea);
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.addEventListener(PREP_ADD_ITEM_EVENT, this.#onPrepAddItem);
    this.addEventListener(PREP_REMOVE_ITEM_EVENT, this.#onPrepRemoveItem);
    this.addEventListener(LIVE_CHOICE_EVENT, this.#onLiveChoice);
    this.addEventListener(SUBMISSION_MARKED_EVENT, this.#onSubmissionMarked);
    this.addEventListener(ATTEMPT_RESULT_EVENT, this.#onAttemptResult);
    this.addEventListener(UNDO_REQUEST_EVENT, this.#onUndoRequest);
    this.addEventListener(ROSTER_ADD_EVENT, this.#onRosterAdd);
    this.addEventListener(BOARD_OPEN_EVENT, this.#onBoardOpen);
    this.addEventListener(BOARD_PIN_EVENT, this.#onBoardPin);
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
    this.removeEventListener(LIVE_CHOICE_EVENT, this.#onLiveChoice);
    this.removeEventListener(SUBMISSION_MARKED_EVENT, this.#onSubmissionMarked);
    this.removeEventListener(ATTEMPT_RESULT_EVENT, this.#onAttemptResult);
    this.removeEventListener(UNDO_REQUEST_EVENT, this.#onUndoRequest);
    this.removeEventListener(ROSTER_ADD_EVENT, this.#onRosterAdd);
    this.removeEventListener(BOARD_OPEN_EVENT, this.#onBoardOpen);
    this.removeEventListener(BOARD_PIN_EVENT, this.#onBoardPin);
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
   */
  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('settings')) {
      this.session = loadSession(this.settings);
    }
    this.#syncClock();
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
    const board =
      run === null
        ? null
        : buildBoardView(run.timeline.present, {
            rules: run.rules,
            chart: this.chart,
            entries: run.entries,
            now: this.clock.now(),
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

      <ptk-live-screen
        .view=${view ?? EMPTY_LIVE_VIEW}
        .chart=${this.chart}
        .unit=${this.session.setup.unit}
        .refusals=${this.refusals}
      ></ptk-live-screen>
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

      ${this.#renderPlan(view)} ${this.#renderStart(view)} ${this.#renderPrep()}
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
   * lifter's own equipment settings and a per-lifter copy is task #52's problem
   * -- and not in live mode, where the whole point of folding it away is that
   * the lifter has something else to look at.
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

      <ptk-live-screen
        .view=${view ?? EMPTY_LIVE_VIEW}
        .chart=${this.chart}
        .unit=${this.session.setup.unit}
        .refusals=${this.refusals}
      ></ptk-live-screen>
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
   * §7's confirmation and §22.2's checklist, the two toggle groups in the tool.
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
    if (fieldOf(event) !== CONFIRM_FIELD) return;
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
      case ROSTER_IDENTIFIER_FIELD:
        // Untrimmed, deliberately: it is a lot number as the coach typed it, and
        // `rosterSummary` trims only to decide whether there is one.
        this.#patchEntry(this.#lifterOf(event), { identifier: value });
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
    const result = undo(run.timeline);
    if (!result.ok) {
      this.problems = result.problems.map((problem) => problem.code);
      return;
    }
    this.#commit(result.timeline);
    this.#clearFeedback();
  };

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
   * would sit in the list, invisible, until §24 exported it.
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

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-day-planner': PtkMeetDayPlanner;
  }

  interface HTMLElementEventMap {
    [FEDERATION_CHANGE_EVENT]: CustomEvent<FederationChangeDetail>;
  }
}
