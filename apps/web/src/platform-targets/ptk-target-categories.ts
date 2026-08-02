/**
 * The manual selection path: the questions a lifter answers to identify the
 * category the report is drawn for.
 *
 * This is a tool component rather than shared chrome. It knows that a weight
 * class belongs to a sex category and that a division has an age band;
 * `ptk-choice-group` and `ptk-select` know none of that and are repeated once
 * per question here.
 *
 * TWO CONTROLS, CHOSEN BY HOW MUCH ROOM THE ANSWERS NEED
 *
 * Everything used to be tiles, and two of the questions ruined the screen for
 * it: the age divisions are seventeen bands and the regions are fifty states, so
 * a lifter arrived at a wall of radios and had to scroll past most of a phone
 * screen of them to reach the thing they came for. The rule now is about the
 * *answers*, not the question -- a handful of short ones stay tiles, because a
 * tile is a 44 px target that shows every option at once, and a long list
 * becomes a select, because a native picker is the platform's own answer to
 * exactly this and on a phone it is a full-screen wheel with a keyboard.
 * `resolveSelection` decides which is which; this element only draws them.
 *
 * It does no loading. The catalogue and the state of the read arrive as
 * properties, which is what lets the whole interface be exercised in a browser
 * test without a transport, and what keeps "we are still fetching", "this
 * federation is not published", and "the read failed" as three separate things
 * the screen can say. Rendering an empty question set for all three is the
 * failure this avoids -- it looks like a working page that is asking nothing.
 */
import type { CategoryCatalog } from '@platform-toolkit/data-contracts';
import {
  CHOICE_CHANGE_EVENT,
  SELECT_CHANGE_EVENT,
  type ChoiceChangeDetail,
  type SelectChangeDetail,
} from '@platform-toolkit/ui';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  NO_SELECTION,
  resolveSelection,
  type CategorySelection,
  type RecordPartition,
  type SelectionField,
  type SelectionPicker,
  type SelectionQuestion,
} from './selection.js';

/** Where the catalogue read has got to. */
export type CatalogStatus = 'loading' | 'ready' | 'unavailable' | 'failed';

/** Fired whenever the answered category changes. */
export interface SelectionChangeDetail {
  readonly selection: CategorySelection;
  /**
   * Enough is answered to draw the report.
   *
   * Not "every question is answered". Three of the questions only add columns,
   * and gating the report on them would hide it behind answers that do not
   * change what it says -- requirement 9, in one boolean.
   */
  readonly ready: boolean;
  /**
   * Every record artifact this selection needs, in the order the report shows
   * them.
   *
   * Carried on the event rather than derived by the listener, because deriving
   * it needs the catalogue and the transport deliberately has no catalogue --
   * `view.ts` reads data and knows nothing about what a competition level is.
   * It also retires a hazard: the record scope used to arrive on a second event,
   * so the watcher had to keep its own copy of each axis and could never read
   * the element (a listener registered before the element is appended runs
   * before the element's own listener has recorded anything, so it read the
   * value from before the event). One event carrying everything removes the
   * situation rather than documenting it.
   */
  readonly partitions: readonly RecordPartition[];
}

/** Event name, exported so a listener cannot misspell it. */
export const SELECTION_CHANGE_EVENT = 'ptk-selection-change';

@customElement('ptk-target-categories')
export class PtkTargetCategories extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    /*
     * Both rows use the intrinsic-grid pattern, keyed to this element's own
     * width rather than the viewport's -- a tool in a 320 px embed column is in
     * the same situation as one on a phone, and a media query gets that exactly
     * backwards. The min() is load-bearing: without it a container narrower
     * than the track minimum overflows sideways instead of collapsing to one
     * column.
     */
    .questions,
    .pickers {
      display: grid;
      gap: var(--ptk-space-md);
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
    }

    .pickers {
      margin-block-start: var(--ptk-space-lg);
      /* Wider tracks than the tiles: these hold weight-class and division
         labels, and a track sized for "Raw" truncates "Master 40-44 (40-44)". */
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    }

    .outstanding {
      margin: var(--ptk-space-md) 0 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }
  `;

  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  @property({ type: String }) status: CatalogStatus = 'loading';

  /**
   * What the lifter asked for, before the catalogue is consulted.
   *
   * Kept separate from the resolved answers on purpose. `resolveSelection`
   * discards anything this catalogue does not offer, and storing its output
   * would make that discard permanent -- a lifter who picked a class, switched
   * sex category to look at the other ladder, and switched back would find their
   * class silently gone. Re-resolving from the request each render restores it.
   */
  @state() private requested: CategorySelection = NO_SELECTION;

  override connectedCallback(): void {
    super.connectedCallback();
    // Delegated rather than bound per control: both events are composed, so
    // they reach this host from any of them, and one listener each cannot fall
    // out of step with the list of questions.
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoiceChange);
    this.addEventListener(SELECT_CHANGE_EVENT, this.#onSelectChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoiceChange);
    this.removeEventListener(SELECT_CHANGE_EVENT, this.#onSelectChange);
    super.disconnectedCallback();
  }

  /**
   * Resolves once the controls have rendered too, not just this element.
   *
   * Lit's default `updateComplete` settles when the host's own template has been
   * committed. That commit sets `.choices` on a group and leaves the group's own
   * render queued, so a caller awaiting the host is reading a subtree that
   * happens to have caught up rather than one that is guaranteed to have. It
   * usually has -- which is the problem: the guarantee is what a caller assumes,
   * and the day the timing shifts the failure is an assertion against last
   * render's weight classes, in a test that has passed for months.
   *
   * The children are filtered on `instanceof LitElement` rather than trusted
   * from the selector, because a comma-separated `querySelectorAll` types as
   * `Element` and `Element` has no `updateComplete`.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const controls = this.shadowRoot?.querySelectorAll('ptk-choice-group, ptk-select') ?? [];
    await Promise.all(
      [...controls]
        .filter((control): control is LitElement => control instanceof LitElement)
        .map((control) => control.updateComplete),
    );
    return complete;
  }

  override render(): TemplateResult {
    if (this.status === 'loading') {
      return html`<ptk-notice>Loading this federation's categories…</ptk-notice>`;
    }
    if (this.status === 'failed') {
      return html`<ptk-notice tone="error">
        The published categories could not be loaded. Reload the page to try again.
      </ptk-notice>`;
    }
    if (this.catalog === null) {
      // Covers `unavailable`, and covers `ready` arriving without a catalogue,
      // which is a wiring mistake that should still render something true. Not
      // an error tone: nothing failed, and a reload will not change it.
      return html`<ptk-notice>
        This federation's categories have not been published yet.
      </ptk-notice>`;
    }

    const resolved = resolveSelection(this.catalog, this.requested);
    return html`
      <div class="questions">
        ${resolved.questions.map((question) => this.#renderQuestion(question))}
      </div>
      <div class="pickers">${resolved.pickers.map((picker) => this.#renderPicker(picker))}</div>
      <p class="outstanding" role="status">${outstandingMessage(resolved.outstanding)}</p>
    `;
  }

  #renderQuestion(question: SelectionQuestion): TemplateResult {
    return html`
      <ptk-choice-group
        data-field=${question.field}
        .label=${question.label}
        .choices=${question.choices}
        .value=${question.value}
        empty-message=${question.emptyMessage}
      ></ptk-choice-group>
    `;
  }

  /**
   * One select.
   *
   * The placeholder is what makes an optional answer *undoable*: picking it back
   * clears the field, which is requirement 2's "a way to clear the age division
   * if selected on accident". A separate clear button would be a second 44 px
   * target beside every optional control, and it would be missing from the
   * native picker a phone actually shows.
   */
  #renderPicker(picker: SelectionPicker): TemplateResult {
    return html`
      <ptk-select
        data-field=${picker.field}
        .label=${picker.label}
        .options=${picker.options}
        .value=${picker.value}
        .placeholder=${picker.placeholder}
        .hint=${picker.hint}
        empty-message=${picker.emptyMessage}
      ></ptk-select>
    `;
  }

  /**
   * Bound once as a field so that `removeEventListener` is given the same
   * function it was added with. A method reference would be a new bound
   * function each time and the listener would outlive the element.
   */
  readonly #onChoiceChange = (event: CustomEvent<ChoiceChangeDetail>): void => {
    this.#answer(event, event.detail.value);
  };

  readonly #onSelectChange = (event: CustomEvent<SelectChangeDetail>): void => {
    this.#answer(event, event.detail.value);
  };

  /** Records one answer and reports the whole selection. Shared by both controls. */
  #answer(event: Event, value: string | null): void {
    const field = fieldOf(event);
    if (field === null) {
      return;
    }

    const requested: Record<SelectionField, string | null> = { ...this.requested };
    requested[field] = value;
    this.requested = requested;

    if (this.catalog === null) {
      return;
    }
    const resolved = resolveSelection(this.catalog, this.requested);
    this.dispatchEvent(
      new CustomEvent<SelectionChangeDetail>(SELECTION_CHANGE_EVENT, {
        detail: {
          selection: resolved.selection,
          ready: resolved.ready,
          partitions: resolved.partitions,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/**
 * Every field a control on this screen may carry.
 *
 * Kept in step with `SelectionField` by the type annotation, which is the point:
 * adding an axis to the selection and forgetting it here would leave a control
 * that visibly answers while nothing is recorded, and that reads as a rendering
 * bug rather than an event one.
 */
const FIELDS: readonly SelectionField[] = [
  'sex',
  'equipment',
  'tested',
  'weightClass',
  'comparisonWeightClass',
  'division',
  'region',
];

/**
 * Which question an event came from, or `null` if it did not come from one.
 *
 * Read from the composed path, not from `event.target`. A listener on the host
 * sees the target retargeted to the host itself -- the control that fired lives
 * in a different tree, and the platform hides that from the outside on purpose
 * -- so `event.target.dataset` is empty and every answer is dropped. The symptom
 * is a page whose controls visibly respond while nothing is ever recorded, which
 * looks like a rendering bug rather than an event one.
 *
 * The value is checked against the known fields rather than trusted: `dataset`
 * is a string from the DOM, and a typo in the template would otherwise write a
 * key into the selection that no question ever reads back.
 */
function fieldOf(event: Event): SelectionField | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const field = FIELDS.find((candidate) => candidate === node.dataset['field']);
    if (field !== undefined) {
      return field;
    }
  }
  return null;
}

/**
 * A live-region line naming what is still missing.
 *
 * The controls announce their own selection, so this deliberately says something
 * else: what remains. Its text only changes when the outstanding set changes, so
 * it does not re-announce on every click.
 *
 * It names only the *required* answers, which is requirement 9 arriving in the
 * copy as well as in the logic. A line listing the optional pickers would tell a
 * lifter the screen is incomplete while the report below it is already showing
 * them everything they came for.
 */
function outstandingMessage(outstanding: readonly string[]): string {
  if (outstanding.length === 0) {
    return 'Showing your report below.';
  }
  const labels = outstanding.map((label) => label.toLowerCase());
  // `join` rather than an index: `noUncheckedIndexedAccess` would otherwise make
  // reading the last label a `string | undefined` for no gain.
  const list =
    labels.length === 1
      ? labels.join('')
      : `${labels.slice(0, -1).join(', ')} and ${labels.slice(-1).join('')}`;
  return `Still to choose: ${list}.`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-categories': PtkTargetCategories;
  }

  interface HTMLElementEventMap {
    [SELECTION_CHANGE_EVENT]: CustomEvent<SelectionChangeDetail>;
  }
}
