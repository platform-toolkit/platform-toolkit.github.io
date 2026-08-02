/**
 * The whole tool: the questions, the report, and the optional lift entry.
 *
 * Composition only. It holds no rules -- `selection.ts`, `standards.ts` and
 * `report.ts` have those -- and it loads nothing, because loading needs a
 * transport and this has to be mountable in a test with none. What it does own
 * are the two pieces of state that cross between its children: the answered
 * category, which the questions produce and the report consumes, and the four
 * entered weights, which the lift panel produces and the report consumes.
 *
 * THREE PHASES, AND WHY THEY ARE A STATE RATHER THAN A LAYOUT
 *
 * The screen shows one of three things, never two:
 *
 *   - `setup`     a first visit, and nothing but the questions. No report, no
 *                 lift entry, one action at the bottom.
 *   - `targets`   the report, under a two-line summary of the answers.
 *   - `editing`   the questions again, with the report *not rendered*.
 *
 * That last one is the load-bearing part. The 2026-08-02 review is explicit that
 * a long report must not reflow after every tap in the context editor, and the
 * usual fix -- render it and hide it -- keeps the layout cost and adds a second
 * copy of the screen for a reader to walk. Not rendering it makes the guarantee
 * structural: there is nothing to reflow. It is also what makes the two events
 * from the questions mean different things (`ptk-target-categories.ts`): the
 * draft keeps the pickers honest, the applied one changes the world.
 *
 * WHAT IS REMEMBERED
 *
 * The context and the two navigation bars, through `session.ts`. A returning
 * visit opens on `targets` with the report already drawn, which is the whole
 * difference between a tool consulted at a rack and a form filled in at one.
 * The entered lifts are deliberately not remembered -- see that file.
 *
 * The applied-selection event is `composed`, so it crosses this element's shadow
 * boundary on its way out. That is what lets `view.ts` listen on this element
 * directly to know when to read a different partition, rather than needing a
 * callback property threaded through -- and it keeps this file free of any
 * knowledge that a data source exists.
 */
import type {
  CategoryCatalog,
  ClassificationBook,
  DataMeta,
  Lift,
} from '@platform-toolkit/data-contracts';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './ptk-target-categories.js';
import './ptk-target-context.js';
import './ptk-target-freshness.js';
import './ptk-target-goals.js';
import './ptk-target-lifts.js';
import './ptk-target-report.js';
import { readFreshness, type Connection, type DataMetaStatus } from './freshness.js';
import {
  addGoal,
  describeGoal,
  goalKey,
  loadGoals,
  removeGoal,
  saveGoals,
  tagGoal,
  MAX_GOALS,
  type Goal,
  type GoalTarget,
} from './goals.js';
import {
  SELECTION_APPLIED_EVENT,
  SELECTION_CANCEL_EVENT,
  type CatalogStatus,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import { CONTEXT_EDIT_EVENT } from './ptk-target-context.js';
import {
  CURRENT_LIFTS_EVENT,
  GOAL_REMOVE_EVENT,
  GOAL_TAG_EVENT,
  type GoalListDetail,
} from './ptk-target-goals.js';
import { ENTRIES_CHANGE_EVENT, type EntriesChangeDetail } from './ptk-target-lifts.js';
import {
  GOAL_REQUEST_EVENT,
  VIEW_CHANGE_EVENT,
  type GoalRequestDetail,
  type PartitionRead,
  type StandardsStatus,
  type TargetType,
  type ViewChangeDetail,
} from './ptk-target-report.js';
import { NO_SELECTION, resolveSelection, type CategorySelection } from './selection.js';
import { loadSettings, saveContext, saveView } from './session.js';
import { NO_ENTRIES, type LiftEntries } from './standards.js';

/** Which of the three screens is showing. */
type Phase = 'setup' | 'targets' | 'editing';

/** Where focus goes after a phase change. See the pendingFocus field. */
type FocusTarget = 'report' | 'questions' | 'context';

@customElement('ptk-platform-targets')
export class PtkPlatformTargets extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    /*
     * An h2, because the page's own h1 is the tool's name. The setup screen and
     * the report are siblings under it -- one is never inside the other, which
     * is the whole point of the phases above.
     *
     * (No backticks in this comment: they would end the css template -- see the
     * gotcha in CLAUDE.md 5.8.)
     */
    h2 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-lg);
    }

    /*
     * :focus-visible and not :focus, which is what lets the heading be focused
     * at all without looking wrong: a lifter who tapped "Edit" with a thumb gets
     * no ring, and one who pressed it with a keyboard gets one and can see where
     * they landed. Same rule as the report heading.
     */
    h2:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    .lead {
      margin: 0 0 var(--ptk-space-lg);
      color: var(--ptk-color-text-muted);
    }

    /*
     * The summary sits directly above the report, with no rule between them:
     * they are one thing -- these numbers, for this lifter -- and a border says
     * they are two.
     */
    .context {
      margin-block-end: var(--ptk-space-md);
    }

    /*
     * The lift entry keeps its separator and its distance. It is optional
     * enrichment (review, and requirement 11 before it), so it reads as
     * something after the report rather than as part of it.
     */
    .lifts {
      margin-block-start: var(--ptk-space-xl);
      padding-block-start: var(--ptk-space-xl);
      border-block-start: 1px solid var(--ptk-color-border);
    }

    .freshness {
      display: block;
      margin-block-start: var(--ptk-space-lg);
    }

    /*
     * The persistent live region. Visually hidden rather than absent, because a
     * region has to be in the accessibility tree before the text arrives in it.
     * Clipped rather than display:none or visibility:hidden -- both of those
     * remove it from the tree entirely, so the announcement never happens and
     * the only symptom is silence.
     */
    .announcer {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
  `;

  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  @property({ type: String }) catalogStatus: CatalogStatus = 'loading';

  @property({ attribute: false }) book: ClassificationBook | null = null;

  @property({ type: String }) standardsStatus: StandardsStatus = 'idle';

  /**
   * One entry per record artifact the selection asks for, keyed by
   * `partitionKey`.
   *
   * Replaced wholesale by the transport rather than mutated in place. Lit
   * compares properties by identity, so a `Map` that is filled in as reads
   * settle is the same `Map` every time and nothing re-renders -- the symptom is
   * a report that stays on "Loading the state records" while every read has
   * already succeeded.
   */
  @property({ attribute: false }) recordReads: ReadonlyMap<string, PartitionRead> = new Map();

  /**
   * The published index, for the freshness line at the foot of the tool.
   *
   * Read by the transport rather than by the footer element, for the same reason
   * every other read is: the footer takes its data and the *state* of the read as
   * properties, so "still fetching", "nothing saved on this device" and "the
   * publisher is behind" are three reachable states rather than one blank line.
   */
  @property({ attribute: false }) dataMeta: DataMeta | null = null;

  @property({ type: String }) dataMetaStatus: DataMetaStatus = 'loading';

  /**
   * Whether this device currently has a network.
   *
   * A property rather than a read of `navigator.onLine` here, because this
   * element must stay mountable with no browser globals and because the whole
   * point of the value is that it *changes* -- the transport owns the `online`
   * and `offline` listeners and hands the answer down.
   */
  @property({ type: String }) connection: Connection = 'online';

  /**
   * Where remembered answers are read from and written to.
   *
   * A property rather than a module-level store, because a store reaching for
   * `localStorage` at import time is a tool that dies at import time in the one
   * configuration these are designed for -- a third-party iframe with storage
   * denied (§5.12). Defaulted to a store with no backing so every test and
   * story mounts without arranging one, and so the element has no branch for
   * "not remembering": that is what `createPreferenceStore(null)` *is*.
   */
  @property({ attribute: false }) settings: PreferenceStore = createPreferenceStore(null);

  /**
   * The answered category, as the questions last *applied* it.
   *
   * Read-only from outside: it is derived from what the lifter chose, and a
   * caller setting it would put the questions and the report out of step with
   * each other in a way neither could detect.
   */
  @state() private selection: CategorySelection = NO_SELECTION;

  /**
   * Which of the three screens is showing.
   *
   * Starts on `setup` and is moved to `targets` by the catalogue arriving with
   * a remembered context that still resolves -- never by the remembered context
   * alone. A federation that renames a weight class would otherwise open a
   * returning lifter straight into a report drawn for an answer that no longer
   * exists.
   */
  @state() private phase: Phase = 'setup';

  /**
   * The answers the questions open with.
   *
   * Separate from {@link selection} because they are not the same thing: this
   * is what was *asked for*, including whatever a restore turned up that the
   * catalogue may not offer, and `selection` is what a resolver accepted. Held
   * as state so that opening the editor re-seeds from the applied context
   * rather than from the restore, which is what makes a cancelled edit undo
   * cleanly.
   */
  @state() private draftSeed: CategorySelection = NO_SELECTION;

  /** Where the two navigation bars open. Restored, then owned by the report. */
  @state() private lift: Lift = 'squat';

  @state() private targetType: TargetType = 'classifications';

  /**
   * Where focus is owed after this update, or `null` when it is owed nowhere.
   *
   * Every phase change here replaces the whole screen, including the control
   * that was pressed to cause it. So focus lands on nothing and the browser
   * drops it to the document body: a keyboard or screen-reader user is returned
   * to the top of the page, with no announcement that anything happened, on
   * every one of the three transitions. Each one therefore names where the
   * lifter should land, and the answer is different each time:
   *
   * - `report`, after "Show targets" -- the thing they asked for.
   * - `questions`, after "Edit context" -- the screen they opened.
   * - `context`, after "Cancel" -- the summary button they opened it *from*,
   *   because nothing changed and returning focus to the invoker is the only
   *   move that says so. Sending them to the report heading instead would read
   *   as a fresh result for an edit they abandoned.
   *
   * It stays `null` on a page that simply loaded, including a returning visit
   * that restores a context: focus belongs at the top of a document nobody has
   * interacted with, and stealing it is how a reader misses the heading.
   */
  #pendingFocus: FocusTarget | null = null;

  /**
   * The pending focus move, or `null` when none is owed.
   *
   * Held so {@link getUpdateComplete} can wait for it. Without that a caller
   * who awaited this element would read focus before it had moved -- which is
   * the shape of an assertion that passes locally and fails on a slower
   * machine, in the one direction where the product is fine and the test is not.
   */
  #focusing: Promise<void> | null = null;

  /**
   * Whether the restored context has been offered to the transport yet.
   *
   * A returning visit has to announce its context the way a press of "Show
   * targets" does, or the report opens with a resolved category and no data
   * behind it. Once, though: the flag is what stops the dispatch repeating on
   * every subsequent update.
   */
  #announcedRestore = false;

  /**
   * The four weights, as the lift panel last reported them.
   *
   * Mirrored downward into the report only, never back into the panel that owns
   * the fields -- a round trip would make a keystroke depend on this element
   * being present, and the lift panel is mounted on its own in half its tests.
   */
  @state() private entries: LiftEntries = NO_ENTRIES;

  /**
   * Everything this device has committed to, in the order it was committed.
   *
   * Held here rather than in either element that shows it, because both of them
   * show it: the report marks a figure as saved, the tray lists it, and a goal
   * removed in one has to disappear from the other on the same tick. Two owners
   * would be two lists that agree until somebody presses the button in the panel
   * whose copy the other did not hear about.
   */
  @state() private goals: readonly Goal[] = [];

  /**
   * What just happened to that list, for the report's live region.
   *
   * A sentence rather than a code, because the region reads it out verbatim and
   * the three outcomes that are not "saved" are the ones worth explaining --
   * "the list is full" is the only thing that tells a lifter why the button they
   * pressed did nothing.
   */
  @state() private goalMessage = '';

  /** What the questions currently say the category is. */
  get currentSelection(): CategorySelection {
    return this.selection;
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    // Every one of these is absent in one phase or another, which is what the
    // optional chaining is for -- awaiting a child that this screen does not
    // show is not a wait, it is a missing element.
    const categories = this.shadowRoot?.querySelector('ptk-target-categories');
    const context = this.shadowRoot?.querySelector('ptk-target-context');
    const lifts = this.shadowRoot?.querySelector('ptk-target-lifts');
    const goals = this.shadowRoot?.querySelector('ptk-target-goals');
    const freshness = this.shadowRoot?.querySelector('ptk-target-freshness');
    const report = this.shadowRoot?.querySelector('ptk-target-report');
    await Promise.all([
      categories?.updateComplete,
      context?.updateComplete,
      lifts?.updateComplete,
      goals?.updateComplete,
      freshness?.updateComplete,
    ]);
    // Awaited after the other two rather than alongside them. The report renders
    // from state this element mirrors out of both of them, so its update is
    // queued by their settling -- awaiting all three at once resolves before that
    // second render has been committed, and a test then reads the report drawn
    // for the answer before last.
    await report?.updateComplete;
    // And any focus move this update asked for, which waits on that same
    // render. See #moveFocus.
    await this.#focusing;
    return complete;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(SELECTION_APPLIED_EVENT, this.#onSelectionApplied);
    this.addEventListener(SELECTION_CANCEL_EVENT, this.#onSelectionCancel);
    this.addEventListener(CONTEXT_EDIT_EVENT, this.#onContextEdit);
    this.addEventListener(VIEW_CHANGE_EVENT, this.#onViewChange);
    this.addEventListener(ENTRIES_CHANGE_EVENT, this.#onEntriesChange);
    this.addEventListener(GOAL_REQUEST_EVENT, this.#onGoalRequest);
    this.addEventListener(GOAL_REMOVE_EVENT, this.#onGoalRemove);
    this.addEventListener(GOAL_TAG_EVENT, this.#onGoalTag);
    this.addEventListener(CURRENT_LIFTS_EVENT, this.#onCurrentLifts);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(SELECTION_APPLIED_EVENT, this.#onSelectionApplied);
    this.removeEventListener(SELECTION_CANCEL_EVENT, this.#onSelectionCancel);
    this.removeEventListener(CONTEXT_EDIT_EVENT, this.#onContextEdit);
    this.removeEventListener(VIEW_CHANGE_EVENT, this.#onViewChange);
    this.removeEventListener(ENTRIES_CHANGE_EVENT, this.#onEntriesChange);
    this.removeEventListener(GOAL_REQUEST_EVENT, this.#onGoalRequest);
    this.removeEventListener(GOAL_REMOVE_EVENT, this.#onGoalRemove);
    this.removeEventListener(GOAL_TAG_EVENT, this.#onGoalTag);
    this.removeEventListener(CURRENT_LIFTS_EVENT, this.#onCurrentLifts);
    super.disconnectedCallback();
  }

  /**
   * Reads the remembered settings, and opens on the report when they still
   * resolve.
   *
   * In `willUpdate` rather than in a `firstUpdated` or a `connectedCallback`,
   * so the first paint is already the right screen. Assigning afterwards draws
   * the setup form and replaces it, which on a slow phone is a visible flash of
   * a question the lifter answered last week -- the same reasoning the report's
   * two seeds record.
   *
   * The restore is in two parts because its inputs arrive at two different
   * times. The store is a property, so the settings can be read on the first
   * update; the catalogue arrives over a network, so whether the remembered
   * answers are still real cannot be known until later. Splitting them is what
   * lets a first visit paint its setup screen immediately instead of waiting on
   * a fetch to tell it there is nothing to restore.
   */
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('settings')) {
      const settings = loadSettings(this.settings);
      this.draftSeed = settings.context;
      this.lift = settings.lift;
      this.targetType = settings.targetType;
      // Goals are read from the same store on the same tick, and deliberately
      // not through `session.ts`: that module remembers the *question* a lifter
      // asked, and a goal is an answer they chose to keep. One preference
      // holding both would make clearing a context forget the commitments made
      // under it, and a context that failed to store take the goals with it.
      this.goals = loadGoals(this.settings);
      // A change of store is a different device's worth of answers, so the
      // announcement is owed again.
      this.#announcedRestore = false;
    }

    if (this.phase === 'setup' && this.catalog !== null && !this.#announcedRestore) {
      const resolved = resolveSelection(this.catalog, this.draftSeed);
      if (resolved.ready) {
        this.selection = resolved.selection;
        this.phase = 'targets';
      }
    }
  }

  /**
   * Announces a restored context, once.
   *
   * Here rather than in `willUpdate` because it dispatches, and dispatching
   * during an update runs a listener that may set a property on this element --
   * a re-entrant update Lit warns about and whose second render is the one that
   * gets lost. The flag is set here too, so a restore that produced no report
   * (no catalogue, or answers this federation no longer offers) is still owed
   * its announcement when the catalogue lands.
   */
  protected override updated(): void {
    if (this.phase === 'targets' && !this.#announcedRestore && this.catalog !== null) {
      this.#announcedRestore = true;
      this.#announce(this.selection);
    }
    if (this.#pendingFocus !== null) {
      const target = this.#pendingFocus;
      // Cleared before the move rather than after it, because the move awaits a
      // child's render and this method runs again in the meantime -- leaving it
      // set would start a second move, and the second one would win.
      this.#pendingFocus = null;
      this.#focusing = this.#moveFocus(target);
    }
  }

  /**
   * What to say out loud about the state of the data -- the two things a lifter
   * cannot see happening: that they are reading a saved copy, and that the
   * publisher could not be refreshed.
   *
   * Read from the same function the footer renders, rather than decided a second
   * time here, so the sentence announced and the sentence on screen cannot
   * disagree -- and so nothing is announced that is not also visible, which is
   * what stops this being a region telling screen-reader users about a state
   * everybody else has to guess at.
   *
   * Computed per render rather than kept in a field, and that is what makes the
   * repeat-announcement problem go away rather than needing a guard: lit-html
   * only writes a text binding whose value actually changed, so a lifter
   * scrolling an offline report does not hear "Offline" on every tap. A field
   * assigned in `updated()` would do the same job and schedule a second render
   * for every one of the first, which is a caller awaiting `updateComplete` and
   * reading the previous sentence.
   *
   * The ordinary case announces nothing (`announce` is `null`), which is also
   * what empties the region when signal comes back.
   */
  #announcement(): string {
    return (
      readFreshness({
        connection: this.connection,
        meta: this.dataMeta,
        metaStatus: this.dataMetaStatus,
        showingData: this.#showingData(),
        federationLabel: this.catalog?.label ?? null,
      }).announce ?? ''
    );
  }

  /**
   * Whether a published figure is on screen right now.
   *
   * Asked of the reads rather than of the phase: a returning visit paints the
   * report before either read settles, and a footer told that data is showing at
   * that moment says "Showing data last verified …" over a skeleton. A record
   * partition counts even when the classifications failed, and the other way
   * round -- either one is a real figure a lifter is reading.
   */
  #showingData(): boolean {
    if (this.phase !== 'targets') {
      return false;
    }
    if (this.book !== null) {
      return true;
    }
    return [...this.recordReads.values()].some((read) => read.book !== null);
  }

  /**
   * Moves focus to where the last phase change owes it.
   *
   * The wait before each child move is the whole of this method and it is not
   * optional. A press of "Show targets" is the render that *creates* the report
   * element: this element's own update commits the tag and its properties, and
   * the report's first render is queued behind it, so at the moment `updated()`
   * runs there is no heading in that shadow root yet. Focusing there hits
   * nothing, and `focusHeading` is deliberately silent about it (a root that had
   * to know which branch of the report's template rendered would be a root that
   * knows the report's template) -- so the failure is not an error, it is focus
   * quietly staying on a button that has just been removed from the page.
   *
   * The questions branch awaits nothing, and that asymmetry is the point rather
   * than an oversight: that heading is in *this* element's shadow root, so the
   * update that scheduled the move is the update that rendered it.
   */
  async #moveFocus(target: FocusTarget): Promise<void> {
    if (target === 'questions') {
      this.shadowRoot?.querySelector<HTMLElement>('section h2')?.focus();
    } else if (target === 'context') {
      const context = this.shadowRoot?.querySelector('ptk-target-context');
      await context?.updateComplete;
      context?.focusSummary();
    } else {
      const report = this.shadowRoot?.querySelector('ptk-target-report');
      await report?.updateComplete;
      report?.focusHeading();
    }
    this.#focusing = null;
  }

  override render(): TemplateResult {
    return html`
      <!--
        Outside the phase switch, and first, so that it is in the accessibility
        tree from the first paint and stays the same node forever. A live region
        created in the same render as the text inside it is not reliably
        announced -- the assistive technology has nothing to compare against --
        and every phase change here replaces the entire screen, so a region
        rendered inside one would be a fresh region on every announcement.
      -->
      <p class="announcer" role="status">${this.#announcement()}</p>
      ${this.phase === 'targets' ? this.#renderTargets() : this.#renderQuestions()}
      <!--
        Also outside the switch, and last on every screen.

        Outside because the state it exists for is unreachable from the report:
        a lifter who installed the tool and then lost signal before any category
        was read never gets past the setup screen, so a footer rendered only with
        the report would be silent in precisely the one situation where the line
        is the whole answer. Last because the review puts the data date and
        source at the foot of the canonical order -- below the goal tray there,
        and here below the optional lift entry too, since a provenance footnote
        with a data-entry fold under it is a page that visibly continues past its
        own end the moment somebody opens the fold.
      -->
      <ptk-target-freshness
        class="freshness"
        .connection=${this.connection}
        .meta=${this.dataMeta}
        .metaStatus=${this.dataMetaStatus}
        .showingData=${this.#showingData()}
        .federationLabel=${this.catalog?.label ?? null}
      ></ptk-target-freshness>
    `;
  }

  /**
   * The setup screen, and the editor, which are the same screen.
   *
   * One template rather than two, because they differ in exactly two things: a
   * heading, and whether abandoning is offered. Two templates would be two
   * places to fix the day a question moves, and the failure is an editor that
   * quietly stops offering an answer the first run does.
   */
  #renderQuestions(): TemplateResult {
    const editing = this.phase === 'editing';
    // The federation's name comes from the catalogue and never from a literal
    // here (§5.1). It was hard-coded until the review asked for the setup
    // screen to name the federation whose targets these are -- which would have
    // shipped the second federation's screen headed with the first one's name,
    // in the one sentence a first-time visitor reads before answering anything.
    // Absent until the catalogue lands: the questions are drawn before the read
    // settles, and "show targets" is true with or without the name.
    const label = this.catalog?.label;
    const named = label === undefined ? 'targets' : `${label} targets`;
    return html`
      <section>
        <!--
          tabindex="-1" so the editor can be focused when it opens. Only the
          editor needs it, but it is unconditional: a heading that is sometimes
          focusable is a heading whose tab order changes as the screen does,
          and -1 keeps it out of the tab sequence either way.
        -->
        <h2 tabindex="-1">${editing ? 'Edit context' : 'Set up your targets'}</h2>
        <p class="lead">
          ${
            editing
              ? 'Change any answer, then show your targets again.'
              : `Choose sex category, equipment, tested status, and a weight class to show ${named}.`
          }
        </p>
        <ptk-target-categories
          .catalog=${this.catalog}
          .status=${this.catalogStatus}
          .initialSelection=${this.draftSeed}
          ?allow-cancel=${editing}
        ></ptk-target-categories>
      </section>
    `;
  }

  #renderTargets(): TemplateResult {
    return html`
      <section>
        <ptk-target-context
          class="context"
          .catalog=${this.catalog}
          .selection=${this.selection}
        ></ptk-target-context>
        <ptk-target-report
          .catalog=${this.catalog}
          .selection=${this.selection}
          .classifications=${this.book}
          .classificationsStatus=${this.standardsStatus}
          .recordReads=${this.recordReads}
          .entries=${this.entries}
          .savedGoals=${this.#savedKeys()}
          .goalMessage=${this.goalMessage}
          .initialLift=${this.lift}
          .initialTargetType=${this.targetType}
        ></ptk-target-report>
        <ptk-target-goals
          .goals=${this.goals}
          .catalog=${this.catalog}
          .classifications=${this.book}
          .entries=${this.entries}
        ></ptk-target-goals>
        <div class="lifts">
          <ptk-target-lifts></ptk-target-lifts>
        </div>
      </section>
    `;
  }

  /**
   * The lifter committed a context.
   *
   * Everything that makes this a commitment rather than a draft happens here
   * and nowhere else: the report is drawn for it, the device remembers it, and
   * focus follows it. The event keeps travelling outward -- `view.ts` reads the
   * partitions off it -- so it is neither stopped nor re-dispatched.
   */
  readonly #onSelectionApplied = (event: CustomEvent<SelectionChangeDetail>): void => {
    if (this.#announcing) {
      // Our own restore announcement, arriving back at us because a composed
      // event dispatched on this host is also delivered to this host's own
      // listeners. Acting on it would move focus into a report the lifter did
      // not ask for -- they have just loaded the page.
      return;
    }
    this.selection = event.detail.selection;
    this.draftSeed = event.detail.selection;
    this.phase = 'targets';
    this.#announcedRestore = true;
    this.#pendingFocus = 'report';
    saveContext(this.settings, event.detail.selection);
  };

  /** The edit was abandoned. The applied context is untouched, so nothing is. */
  readonly #onSelectionCancel = (): void => {
    if (this.phase === 'editing') {
      this.phase = 'targets';
      this.#pendingFocus = 'context';
    }
  };

  /**
   * The summary was pressed.
   *
   * The seed is reset to the applied context first. Without it an edit that was
   * cancelled half way through would reopen on the abandoned draft -- the
   * questions element is discarded on cancel, but the seed it was given is not.
   */
  readonly #onContextEdit = (): void => {
    this.draftSeed = this.selection;
    this.phase = 'editing';
    this.#pendingFocus = 'questions';
  };

  /** A navigation bar moved. Remembered so the next visit opens where this one left. */
  readonly #onViewChange = (event: CustomEvent<ViewChangeDetail>): void => {
    this.lift = event.detail.lift;
    this.targetType = event.detail.targetType;
    saveView(this.settings, event.detail.lift, event.detail.targetType);
  };

  /** Mirrored into the report, and left to keep travelling. */
  readonly #onEntriesChange = (event: CustomEvent<EntriesChangeDetail>): void => {
    this.entries = event.detail.entries;
  };

  /**
   * The keys of every saved goal, which is all the report is told.
   *
   * Rebuilt per render rather than kept beside the list. A second field holding
   * a projection of the first is a second thing to update, and the one path that
   * would forget it is the one that matters -- a goal removed from the tray
   * while the report is still drawing the figure as saved.
   */
  #savedKeys(): ReadonlySet<string> {
    return new Set(this.goals.map((goal) => goalKey(goal)));
  }

  /**
   * A figure was committed to, or the commitment was taken back.
   *
   * Every rule that can refuse one lives here rather than in the panel that
   * drew the button, because the tray can remove the same goal and both have to
   * end up looking at one list. The message is set for the report's live region
   * in all four outcomes -- a press that changes nothing still has to say why,
   * or a full list reads as a button that has stopped working.
   */
  readonly #onGoalRequest = (event: CustomEvent<GoalRequestDetail>): void => {
    const { target, action } = event.detail;
    const spoken = this.#describe(target);

    if (action === 'remove') {
      this.#commit(removeGoal(this.goals, goalKey(target)), `Removed goal: ${spoken}.`);
      return;
    }

    const outcome = addGoal(this.goals, target);
    switch (outcome.kind) {
      case 'added':
        this.#commit(outcome.goals, `Saved goal: ${spoken}.`);
        break;
      case 'already-saved':
        this.goalMessage = `Already saved: ${spoken}.`;
        break;
      case 'full':
        this.goalMessage = `You have ${String(MAX_GOALS)} goals saved. Remove one to save another.`;
        break;
      case 'unstorable':
        // Unreachable against published data, and said plainly rather than
        // swallowed: a button that does nothing with no sentence beside it is
        // the failure this branch exists to avoid.
        this.goalMessage = 'This target could not be saved on this device.';
        break;
    }
  };

  /** Removed from the tray. Same list, same write, same sentence as the panel's. */
  readonly #onGoalRemove = (event: CustomEvent<GoalListDetail>): void => {
    const goal = this.goals.find((candidate) => goalKey(candidate) === event.detail.key);
    if (goal === undefined) {
      return;
    }
    this.#commit(
      removeGoal(this.goals, event.detail.key),
      `Removed goal: ${this.#describe(goal)}.`,
    );
  };

  /**
   * A goal was filed under a horizon.
   *
   * Silent -- no message. The select the lifter just used shows the answer, so
   * announcing it would repeat what the control already said, and this is the
   * one goal action that happens several times in a row.
   */
  readonly #onGoalTag = (event: CustomEvent<GoalListDetail>): void => {
    const { key, tag } = event.detail;
    if (tag === null) {
      return;
    }
    this.goals = tagGoal(this.goals, key, tag);
    saveGoals(this.settings, this.goals);
  };

  /** The tray's secondary action. The panel is a sibling, so the root opens it. */
  readonly #onCurrentLifts = (): void => {
    void this.shadowRoot?.querySelector('ptk-target-lifts')?.reveal();
  };

  /**
   * Writes a changed list to the device and says what happened.
   *
   * One place, because the write and the announcement have to agree: a list
   * updated without the write is a goal that vanishes on reload, and a write
   * without the message is a press with nothing announced.
   *
   * The write's outcome is deliberately not turned into a different sentence.
   * `saveGoals` reports `unavailable` on a device that refuses storage, and the
   * goal is genuinely saved for this visit either way -- telling a lifter their
   * goal was not saved, in the moment they can see it listed, is worse than
   * being quiet about a limitation the tray does not promise around.
   */
  #commit(goals: readonly Goal[], message: string): void {
    this.goals = goals;
    this.goalMessage = message;
    saveGoals(this.settings, goals);
  }

  /** What a goal is called, for a sentence read out rather than drawn. */
  #describe(target: GoalTarget): string {
    const description = describeGoal(target, {
      catalog: this.catalog,
      classifications: this.book,
    });
    return description.scope === ''
      ? description.title
      : `${description.title}, ${description.scope}`;
  }

  /**
   * Tells the page about a context that was restored rather than pressed.
   *
   * The transport keys its reads to the applied event, so a returning visit
   * that only *rendered* its remembered context would show a report with no
   * data behind it and no request in flight -- a screen that looks like a
   * federation publishing nothing.
   *
   * The guard is a plain boolean rather than anything cleverer because
   * `dispatchEvent` is synchronous: the listener has run and the flag is back
   * down before this method returns.
   */
  #announce(selection: CategorySelection): void {
    if (this.catalog === null) {
      return;
    }
    const resolved = resolveSelection(this.catalog, selection);
    if (!resolved.ready) {
      return;
    }
    this.#announcing = true;
    try {
      this.dispatchEvent(
        new CustomEvent<SelectionChangeDetail>(SELECTION_APPLIED_EVENT, {
          detail: {
            selection: resolved.selection,
            ready: resolved.ready,
            partitions: resolved.partitions,
          },
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      this.#announcing = false;
    }
  }

  /** True only while {@link #announce} is dispatching. See its note. */
  #announcing = false;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-platform-targets': PtkPlatformTargets;
  }
}
