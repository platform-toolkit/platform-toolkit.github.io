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
import type { CategoryCatalog, ClassificationBook, Lift } from '@platform-toolkit/data-contracts';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './ptk-target-categories.js';
import './ptk-target-context.js';
import './ptk-target-lifts.js';
import './ptk-target-report.js';
import {
  SELECTION_APPLIED_EVENT,
  SELECTION_CANCEL_EVENT,
  type CatalogStatus,
  type SelectionChangeDetail,
} from './ptk-target-categories.js';
import { CONTEXT_EDIT_EVENT } from './ptk-target-context.js';
import { ENTRIES_CHANGE_EVENT, type EntriesChangeDetail } from './ptk-target-lifts.js';
import {
  VIEW_CHANGE_EVENT,
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
   * Set when the phase changes to `targets` by an action rather than by a
   * restore, and cleared once the heading has been focused.
   *
   * Moving focus is right after a lifter presses "Show targets" -- the thing
   * they asked for is now elsewhere on the page and a keyboard or screen-reader
   * user is otherwise left on a button that no longer exists. It is wrong on a
   * page that simply loaded: focus belongs at the top of the document, and
   * stealing it is how a reader misses the heading and the context above it.
   */
  #focusResult = false;

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
    const report = this.shadowRoot?.querySelector('ptk-target-report');
    await Promise.all([categories?.updateComplete, context?.updateComplete, lifts?.updateComplete]);
    // Awaited after the other two rather than alongside them. The report renders
    // from state this element mirrors out of both of them, so its update is
    // queued by their settling -- awaiting all three at once resolves before that
    // second render has been committed, and a test then reads the report drawn
    // for the answer before last.
    await report?.updateComplete;
    // And any focus move this update asked for, which waits on that same
    // render. See #focusReport.
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
  }

  override disconnectedCallback(): void {
    this.removeEventListener(SELECTION_APPLIED_EVENT, this.#onSelectionApplied);
    this.removeEventListener(SELECTION_CANCEL_EVENT, this.#onSelectionCancel);
    this.removeEventListener(CONTEXT_EDIT_EVENT, this.#onContextEdit);
    this.removeEventListener(VIEW_CHANGE_EVENT, this.#onViewChange);
    this.removeEventListener(ENTRIES_CHANGE_EVENT, this.#onEntriesChange);
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
    if (this.#focusResult) {
      this.#focusResult = false;
      this.#focusing = this.#focusReport();
    }
  }

  /**
   * Moves focus to the report's heading, once the report has one.
   *
   * The wait is the whole of this method and it is not optional. A press of
   * "Show targets" is the render that *creates* the report element: this
   * element's own update commits the tag and its properties, and the report's
   * first render is queued behind it, so at the moment `updated()` runs there is
   * no heading in that shadow root yet. Focusing there hits nothing, and
   * `focusHeading` is deliberately silent about it (a root that had to know
   * which branch of the report's template rendered would be a root that knows
   * the report's template) -- so the failure is not an error, it is focus
   * quietly staying on a button that has just been removed from the page.
   */
  async #focusReport(): Promise<void> {
    const report = this.shadowRoot?.querySelector('ptk-target-report');
    await report?.updateComplete;
    report?.focusHeading();
    this.#focusing = null;
  }

  override render(): TemplateResult {
    return this.phase === 'targets' ? this.#renderTargets() : this.#renderQuestions();
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
    return html`
      <section>
        <h2>${editing ? 'Edit context' : 'Set up your targets'}</h2>
        <p class="lead">
          ${
            editing
              ? 'Change any answer, then show your targets again.'
              : 'Choose sex category, equipment, tested status, and a weight class to show USPA targets.'
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
          .initialLift=${this.lift}
          .initialTargetType=${this.targetType}
        ></ptk-target-report>
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
    this.#focusResult = true;
    saveContext(this.settings, event.detail.selection);
  };

  /** The edit was abandoned. The applied context is untouched, so nothing is. */
  readonly #onSelectionCancel = (): void => {
    if (this.phase === 'editing') {
      this.phase = 'targets';
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
