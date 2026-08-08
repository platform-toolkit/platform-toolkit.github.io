// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What the lifter has already lifted. Four fields and a unit, and nothing else.
 *
 * FOLDED, AND OUT OF THE WAY
 *
 * This used to be the second of three panels and it opened unfolded, above the
 * records -- so the first thing a lifter met after answering the questions was a
 * form asking them to type their meet in. Requirement 11 in the user's own
 * words: "The 'your lifts' section is not yet very helpful yet... It is
 * currently distracting. So, let's make a way to hide it and expand if needed.
 * Put it out of the way for now." It is a `ptk-disclosure`, it starts closed,
 * and the report renders in full without it.
 *
 * A fold is only safe when its summary states the whole of what is true while
 * closed (§5.8) -- a fold that hides an answer the numbers below depend on is
 * how somebody reads a report drawn for a lift they did not enter. So the
 * summary names every figure entered, or says plainly that none are. That is
 * also what makes hiding this defensible at all: the report is a ladder of what
 * a lifter *might* hit and is complete without knowing what they have hit; the
 * entries only mark which rungs are behind them.
 *
 * WHAT IT NO LONGER DOES
 *
 * It used to resolve classifications and print a status line under each field.
 * Those sentences are the report's job now -- requirement 7 asks for every
 * classification level on screen, and a one-line "next classification" summary
 * under a text field is one rung of the ladder the report draws in full. So this
 * element no longer takes a book, a status, or a selection: it is entry, and the
 * only thing it knows about the domain is that there are four lifts and that a
 * total can be derived from three of them.
 */
import type { Lift } from '@platform-toolkit/data-contracts';
import type { WeightUnit } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-number-field';
import {
  CHOICE_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  NUMBER_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-number-field';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import {
  LIFTS,
  LIFT_LABELS,
  NO_ENTRIES,
  amountAsUnit,
  formatAsUnit,
  readLiftEntries,
  setEntryUnit,
  typeLift,
  type LiftEntries,
  type LiftEntry,
} from './standards.js';

/**
 * What the fold is called, and the name a test or a layout check finds it by.
 *
 * A verb, not a possessive. "Your lifts (optional)" describes a *section* and
 * says nothing about what pressing it does, and the parenthesis was carrying the
 * whole of the message -- the 2026-08-02 review replaces both with an action
 * ("Add current lifts") on the grounds that a lifter scanning a screen of
 * targets reads labels as things they can do. The word "optional" moves into the
 * first sentence inside the fold, where there is room to say what it means.
 *
 * Exported so the tests assert against the same string the template renders.
 * `scripts/check-narrow-layout.mjs` also names this fold by its `label`
 * attribute and cannot import a TypeScript module, so that one copy stays
 * hand-kept -- it fails loudly when it goes stale ("nothing matched") rather
 * than skipping the panel it was written to measure, which is the whole reason
 * an unmatched selector is an error in that file.
 */
export const LIFTS_FOLD_LABEL = 'Add current lifts';

/** Fired whenever one of the four fields, or the unit they are read in, changes. */
export interface EntriesChangeDetail {
  readonly entries: LiftEntries;
}

/** Event name, exported so a listener cannot misspell it. */
export const ENTRIES_CHANGE_EVENT = 'ptk-entries-change';

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

@customElement('ptk-target-lifts')
export class PtkTargetLifts extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .unit {
      margin-block-end: var(--ptk-space-md);
    }

    p {
      margin: 0 0 var(--ptk-space-md);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * One column on a phone, more once this element is wide enough -- keyed to
     * its own width rather than the viewport's, so a widget in a narrow sidebar
     * behaves like one on a phone with no media query. The min() is
     * load-bearing: without it a container narrower than the track minimum
     * overflows sideways instead of collapsing to a single column.
     */
    .lifts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
      gap: var(--ptk-space-md);
    }
  `;

  /**
   * What is in the four fields.
   *
   * Owned here and deliberately not lifted into a property. The report needs the
   * same four numbers, but it needs to *read* them -- so this element keeps the
   * state and announces every change, rather than becoming a controlled element
   * whose fields go inert when it is mounted alone. A story or a test that mounts
   * this on its own still types into a working panel, which is the whole reason
   * every state here is reachable without a page.
   *
   * Deliberately **not** persisted: §2.3 forbids storing imported athlete data by
   * default, and a lifter's competition results are exactly that whether they
   * were imported or typed. A field that survived a reload would be a quiet
   * exception to it.
   */
  @state() private entries: LiftEntries = NO_ENTRIES;

  /** What the four fields currently hold. Read-only; set by typing. */
  get currentEntries(): LiftEntries {
    return this.entries;
  }

  /**
   * Resolves once the fields have rendered too.
   *
   * Lit's default settles when this element's template is committed, which sets
   * `.value` on a child and leaves the child's own render queued. A caller
   * awaiting the host would be reading a subtree that happens to have caught up.
   * The filter is what makes `updateComplete` reachable -- a comma-separated
   * selector types as `Element`, which has no such property.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children =
      this.shadowRoot?.querySelectorAll('ptk-number-field, ptk-choice-group, ptk-disclosure') ?? [];
    await Promise.all(
      [...children]
        .filter((child): child is LitElement => child instanceof LitElement)
        .map((child) => child.updateComplete),
    );
    return complete;
  }

  /**
   * Opens the fold and puts focus on it.
   *
   * Called by the composition root when a lifter presses "Add current lifts" from
   * the goals tray -- the review's secondary entry point into this panel, offered
   * from a saved goal rather than only from the fold's own summary. A lifter who
   * has committed to a weight is the one lifter with a reason to type what they
   * are lifting now, and that reason arrives after the goal, not before it.
   *
   * A method rather than an `open` property, because the fold's state belongs to
   * the visitor: a property would be re-applied on every render of the parent and
   * would reopen a section the lifter had just closed.
   */
  async reveal(): Promise<void> {
    const disclosure = this.shadowRoot?.querySelector('ptk-disclosure');
    if (disclosure === null || disclosure === undefined) {
      return;
    }
    disclosure.open = true;
    // Focus after the expansion has been committed. Focusing a summary inside a
    // `details` that is still closed scrolls the page to a collapsed strip and
    // announces the section as closed, which is the opposite of what was asked
    // for.
    await disclosure.updateComplete;
    disclosure.focusToggle();
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
    const read = readLiftEntries(this.entries);

    return html`
      <ptk-disclosure label=${LIFTS_FOLD_LABEL} summary=${enteredSummary(this.entries)}>
        <p>
          Optional. Entering what you have lifted marks the targets you have already passed and
          points at the next one. The targets above are complete without it.
        </p>
        <ptk-choice-group
          class="unit"
          label="Enter weights in"
          .choices=${UNIT_CHOICES}
          value=${this.entries.unit}
        ></ptk-choice-group>
        <div class="lifts">${LIFTS.map((lift) => this.#renderLift(lift, read[lift]))}</div>
      </ptk-disclosure>
    `;
  }

  #renderLift(lift: Lift, entry: LiftEntry): TemplateResult {
    const { unit } = this.entries;
    // A derived total is shown in the field so the number a lifter reads is the
    // number the report is measured against. Leaving the field blank while the
    // report strikes through rungs at 250 kg is the kind of gap read as a bug.
    const value =
      entry.kind === 'weight' && entry.derived
        ? amountAsUnit(entry.kilograms, unit)
        : this.entries.fields[lift].text;

    return html`
      <ptk-number-field
        data-lift=${lift}
        .label=${LIFT_LABELS[lift]}
        .value=${value}
        unit=${unit}
        placeholder=${unit === 'lb' ? '315' : '142.5'}
        .error=${entry.kind === 'invalid' ? entry.message : ''}
      ></ptk-number-field>
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
    this.#setEntries(typeLift(this.entries, lift, event.detail.value));
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
    this.#setEntries(setEntryUnit(this.entries, unit));
  };

  /**
   * Records the change and tells anyone outside about it.
   *
   * Announced rather than delegated. The report measures the same four numbers
   * against published figures, and a lifter must not have to type their meet
   * twice for two halves of one screen -- but the unit radio and the four fields
   * belong to this panel, so this is where a keystroke turns into a value. The
   * event is `composed`, so the page can hear it from outside this element's
   * shadow root without a callback threaded down.
   *
   * Fired only from the two handlers above, never from a property write, for the
   * usual reason: a listener that set state on the event would loop.
   */
  #setEntries(entries: LiftEntries): void {
    this.entries = entries;
    this.dispatchEvent(
      new CustomEvent<EntriesChangeDetail>(ENTRIES_CHANGE_EVENT, {
        detail: { entries },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/**
 * What is true while the fold is closed.
 *
 * Every entered figure, named and with its unit, or a plain statement that there
 * are none. This is the §5.8 rule about disclosure summaries applied to the one
 * case that matters here: the report marks rungs as already reached, and a lifter
 * who cannot see *which* numbers did the marking has no way to notice that a
 * mistyped bench is what struck out half a column.
 *
 * A derived total is included and reads exactly like a typed one, because to a
 * reader it is the same claim -- that the report was drawn against this figure.
 * An invalid entry is left out: the field itself carries the error, and naming
 * a rejected value in a summary of what was entered would say it counted.
 */
function enteredSummary(entries: LiftEntries): string {
  const read = readLiftEntries(entries);
  const stated = LIFTS.flatMap((lift) => {
    const entry = read[lift];
    return entry.kind === 'weight'
      ? [`${LIFT_LABELS[lift]} ${formatAsUnit(entry.kilograms, entries.unit)}`]
      : [];
  });
  return stated.length === 0 ? 'Nothing entered yet.' : `${stated.join(', ')}.`;
}

/**
 * Which field an event came from, or `null` if it came from somewhere else.
 *
 * From the composed path, never `event.target`. A listener on this host sees the
 * target retargeted to the host itself for anything fired inside a child's own
 * shadow tree, so `event.target.dataset` is empty and every keystroke is
 * dropped. The symptom is a panel whose fields accept typing while no number
 * ever reaches the report -- a rendering bug, to look at.
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
    'ptk-target-lifts': PtkTargetLifts;
  }

  interface HTMLElementEventMap {
    [ENTRIES_CHANGE_EVENT]: CustomEvent<EntriesChangeDetail>;
  }
}
