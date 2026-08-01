/**
 * What the lifter has lifted, read against the standards for their category.
 *
 * A tool component, like `ptk-target-categories`: it knows what a lift is and
 * what a classification means, neither of which belongs in `packages/ui`. The
 * arithmetic and every sentence it displays come from `standards.ts`, which is
 * pure, so this file is only the arrangement -- four fields, four status lines,
 * and the wiring between them.
 *
 * It does no loading. The book and the state of the read arrive as properties,
 * for the same reason the categories element takes its catalogue that way: it
 * keeps "still fetching", "this federation publishes none", and "the read
 * failed" as three different sentences instead of one empty panel that reads as
 * a working page with nothing to say.
 */
import type { ClassificationBook, Lift } from '@platform-toolkit/data-contracts';
import type { WeightUnit } from '@platform-toolkit/domain';
import {
  CHOICE_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
  type NumberFieldChangeDetail,
} from '@platform-toolkit/ui';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  LIFTS,
  NO_ENTRIES,
  amountAsUnit,
  lifterCategoryFrom,
  resolveStandards,
  setEntryUnit,
  standingSummary,
  typeLift,
  type LiftEntries,
  type LiftStanding,
} from './standards.js';
import { NO_SELECTION, type CategorySelection } from './selection.js';

/** Where the read of this category's standards has got to. */
export type StandardsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * The two units, as options rather than as a toggle.
 *
 * A radio pair and not `ptk-toggle-group`: these are two answers to one question,
 * and a checkbox group would admit both at once and neither. The same shape tool 4
 * uses for its direction control, so the two screens are answered the same way.
 */
const UNIT_CHOICES: readonly Choice[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
];

/** Narrowed rather than cast: a radio reports a string, and a typo is a string. */
function unitFrom(value: string): WeightUnit | null {
  return value === 'kg' || value === 'lb' ? value : null;
}

@customElement('ptk-target-standards')
export class PtkTargetStandards extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-lg);
    }

    ptk-notice {
      margin-block-end: var(--ptk-space-lg);
    }

    .unit {
      margin-block-end: var(--ptk-space-lg);
    }

    /*
     * One column on a phone, two once the element itself is wide enough --
     * keyed to this element's width rather than the viewport's, so a widget in
     * a narrow sidebar behaves like one on a phone with no media query. The
     * min() is load-bearing: without it a container narrower than the track
     * minimum overflows instead of collapsing to a single column.
     */
    .lifts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
      gap: var(--ptk-space-lg);
    }

    .lift {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-xs);
    }

    .summary {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .summary.placed {
      color: var(--ptk-color-text);
    }

    .derived {
      font-variant-numeric: tabular-nums;
    }
  `;

  /** This category's standards, or `null` if the federation publishes none. */
  @property({ attribute: false }) book: ClassificationBook | null = null;

  @property({ type: String }) status: StandardsStatus = 'idle';

  /** The answered category. Incomplete is normal and has its own sentence. */
  @property({ attribute: false }) selection: CategorySelection = NO_SELECTION;

  /**
   * What is in the four fields.
   *
   * Owned here rather than by the page, because these are the only values on
   * the screen that nothing outside the element reads. Deliberately **not**
   * persisted: §2.3 forbids storing imported athlete data by default, and a
   * lifter's competition results are exactly that whether they were imported or
   * typed. A field that survived a reload would be a quiet exception to it.
   */
  @state() private entries: LiftEntries = NO_ENTRIES;

  /**
   * Resolves once the fields have rendered too.
   *
   * Lit's default settles when this element's template is committed, which sets
   * `.value` on a child and leaves the child's own render queued. A caller
   * awaiting the host would be reading a subtree that happens to have caught up.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    // Comma-separated, so the result types as `Element` and the filter is what
    // makes `updateComplete` reachable -- the selector alone does not narrow.
    const children = this.shadowRoot?.querySelectorAll('ptk-number-field, ptk-choice-group') ?? [];
    await Promise.all(
      [...children]
        .filter((child) => child instanceof LitElement)
        .map((child) => child.updateComplete),
    );
    return complete;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // One delegated listener rather than four bound ones: the event is composed,
    // so it reaches this host from any field, and a single listener cannot fall
    // out of step with the list of lifts.
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumberChange);
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onUnitChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumberChange);
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onUnitChange);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const standings = resolveStandards(this.book, lifterCategoryFrom(this.selection), this.entries);

    return html`
      <h2>Your lifts</h2>
      ${this.#renderNotice()}
      <ptk-choice-group
        class="unit"
        label="Enter weights in"
        .choices=${UNIT_CHOICES}
        value=${this.entries.unit}
      ></ptk-choice-group>
      <div class="lifts">${standings.map((standing) => this.#renderLift(standing))}</div>
    `;
  }

  /**
   * The one sentence that is about the whole panel rather than one lift.
   *
   * Only rendered when it says something the per-lift lines cannot. While the
   * standards are loading, every lift would otherwise claim the federation
   * publishes none -- which is a different and alarming statement.
   */
  #renderNotice(): TemplateResult {
    if (this.status === 'loading') {
      return html`<ptk-notice>Loading the standards for this category…</ptk-notice>`;
    }
    if (this.status === 'failed') {
      return html`<ptk-notice tone="error">
        The published standards could not be loaded. Reload the page to try again.
      </ptk-notice>`;
    }
    if (this.entries.unit === 'lb') {
      // Said once, here, rather than repeated in every status line. The
      // federation publishes kilograms and a lifter working in pounds is entitled
      // to know that the figures below were converted for them -- but four
      // reminders under four fields is the arithmetic reminder this tool exists to
      // remove, spelled as prose.
      return html`<ptk-notice>
        Enter what you have lifted, in pounds, to see where it places. This federation publishes its
        standards in kilograms; the figures here are converted.
      </ptk-notice>`;
    }
    return html`<ptk-notice>
      Enter what you have lifted, in kilograms, to see where it places.
    </ptk-notice>`;
  }

  #renderLift(standing: LiftStanding): TemplateResult {
    const { entry } = standing;
    const { unit } = this.entries;
    // A derived total is shown in the field so the number a lifter reads is the
    // number the status line is about. Leaving the field blank under a sentence
    // about 250 kg is the kind of gap that gets read as a bug.
    const value =
      entry.kind === 'weight' && entry.derived
        ? amountAsUnit(entry.kilograms, unit)
        : this.entries.fields[standing.lift].text;

    return html`
      <div class="lift">
        <ptk-number-field
          data-lift=${standing.lift}
          .label=${standing.label}
          .value=${value}
          unit=${unit}
          placeholder=${unit === 'lb' ? '315' : '142.5'}
          .error=${entry.kind === 'invalid' ? entry.message : ''}
        ></ptk-number-field>
        <p class=${standing.classification === null ? 'summary' : 'summary placed'}>
          ${standingSummary(standing)}
        </p>
      </div>
    `;
  }

  /**
   * Bound once as a field so `removeEventListener` gets the same function it was
   * given. A method reference would be a fresh bound function and the listener
   * would outlive the element.
   */
  readonly #onNumberChange = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const lift = liftOf(event);
    if (lift === null) {
      return;
    }
    this.entries = typeLift(this.entries, lift, event.detail.value);
  };

  /**
   * A unit change converts every figure; it never rereads them.
   *
   * Tool 2 asks which was meant, because a rack setup is configuration somebody
   * might genuinely be re-stating. A competition best is not: it is a fact about a
   * meet that already happened, so 405 stays the 405 lb that was lifted. Rereading
   * it as 405 kg is the failure worth designing against, because there is nothing
   * on the screen to catch it -- it is simply reported back as Elite.
   */
  readonly #onUnitChange = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const unit = unitFrom(event.detail.value);
    if (unit === null) {
      return;
    }
    this.entries = setEntryUnit(this.entries, unit);
  };
}

/**
 * Which field an event came from, or `null` if it came from somewhere else.
 *
 * From the composed path, never `event.target`. A listener on this host sees the
 * target retargeted to the host itself for anything fired inside a child's own
 * shadow tree, so `event.target.dataset` is empty and every keystroke is
 * dropped. The symptom is a panel whose fields accept typing while no number
 * ever reaches the standards -- a rendering bug, to look at.
 *
 * The value is checked against the known lifts rather than trusted: `dataset` is
 * a string from the DOM, and a typo in the template would otherwise write a
 * fifth key into the entries that nothing reads back.
 */
function liftOf(event: Event): Lift | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const lift = LIFTS.find((candidate) => candidate === node.dataset['lift']);
    if (lift !== undefined) {
      return lift;
    }
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-standards': PtkTargetStandards;
  }
}
