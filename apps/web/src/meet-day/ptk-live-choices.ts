// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §13: three legal weights, and the field that says they are not the list.
 *
 * `liveChoicesFor` in `packages/domain` decides every number on this screen.
 * Nothing here computes a weight, grades a risk, or picks the highlight -- the
 * element renders a `LiveChoices` and reports which card was pressed. That
 * division is not tidiness: the same rules have to answer identically for a
 * story, a test and a phone at a meet, and a screen that adjusted a figure on
 * the way out would be a second rule set nobody could find.
 *
 * THE THREE CARDS ARE NOT A MENU
 *
 * §13's last line -- "never prevent the user from entering a different legal
 * weight" -- is the requirement this screen is most likely to fail while
 * looking finished. Three cards and a highlight satisfy every other line of
 * §13, and a lifter who wants 187.5 when the cards read 185, 190 and 192.5 has
 * nowhere to put it. So the free-entry field is not an escape hatch at the
 * bottom; it is the fourth thing on the list, and the hint above it says the
 * cards are suggestions.
 *
 * WHAT THIS ELEMENT WILL NOT DO
 *
 * It does not check legality. `MeetRules` refuses a weight on the way into the
 * document and reports why, and a second opinion here would be a copy of the
 * federation's rules living in a template -- wrong the first time a rule set
 * changes, and wrong in the direction of accepting something the table will
 * reject. The caller applies the action and hands back any `refusals`, which
 * are rendered under the field they came from.
 *
 * It also does not render §14's countdown or the submission state. Those belong
 * to the screen above this one; this element is about the choice, not about
 * what happens to it afterwards.
 */
import {
  attemptWeightFor,
  parseWeightInput,
  type AttemptRefusalCode,
  type AttemptWeight,
  type ConversionChart,
  type LiveAdvisory,
  type LiveAttempt,
  type LiveChoice,
  type LiveChoiceSlot,
  type LiveChoices,
  type WeightUnit,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui';
import { NUMBER_FIELD_CHANGE_EVENT, type NumberFieldChangeDetail } from '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  EXTRA_ATTEMPTS_HEADING,
  EXTRA_ATTEMPTS_NOTE,
  HIGHLIGHT_BADGE,
  NO_CHOICES_NOTE,
  OTHER_WEIGHT_HINT,
  OTHER_WEIGHT_LABEL,
  OTHER_WEIGHT_MUST_BE_KILOGRAMS,
  OTHER_WEIGHT_SUBMIT,
  SLOTS_EXPLANATION,
  TACTICAL_NOTE,
  approximatePoundsText,
  attemptKilogramsText,
  attemptPoundsText,
  chooseLabel,
  extraAttemptLine,
  increaseText,
  liftLabel,
  percentOfMaximumText,
  poundsAbsenceSentence,
  projectedText,
  reachesText,
  refusalSentence,
  riskLine,
  slotLabel,
  surrendersText,
  triggerSentence,
  weightInputProblemSentence,
} from './copy.js';
import { CHOICE_SLOT_FIELD, OTHER_WEIGHT_FIELD } from './fields.js';

/**
 * A weight the lifter chose, ready for a `select-weight` action.
 *
 * `kilograms: null` is §13.5's Pass / Stop This Lift, which is a choice and not
 * an absence -- the caller passes it on as a pass, never as "nothing was
 * decided". `slot` is `null` when the figure was typed rather than pressed, so
 * a caller that wants to know whether its own recommendation was taken can ask
 * without comparing floating-point weights.
 */
export interface LiveChoiceDetail {
  readonly attemptId: string;
  readonly kilograms: number | null;
  readonly slot: LiveChoiceSlot | null;
}

export const LIVE_CHOICE_EVENT = 'ptk-meet-day-live-choice';

@customElement('ptk-live-choices')
export class PtkLiveChoices extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-lg);
      container-type: inline-size;
    }

    h3,
    h4 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    p {
      margin: 0;
    }

    .muted {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .heading {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .trigger {
      font-size: var(--ptk-font-size-lg);
    }

    .list {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    /*
     * One card a row at every width, and deliberately not three across once
     * there is room. Each card carries a weight, a pound reading, a risk band,
     * a jump, a share of the maximum, a projected total and up to three
     * sentences; three columns of that at 320px clip the sentences, and three
     * columns of it on a laptop turn a decision taken in fifteen seconds into a
     * comparison table. The cards are ordered secure to push, which is the
     * order a handler reads them out in (§5.7).
     */
    .cards {
      display: grid;
      gap: var(--ptk-space-md);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .card {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    /*
     * The border is decoration. The highlight badge inside the card is what
     * says this is the recommendation, so the card survives forced colours, a
     * reader who cannot separate the hues, and being read aloud.
     */
    .card[data-highlighted] {
      border-color: var(--ptk-color-accent);
      border-width: 2px;
      /* Hold the box the same size as its neighbours: a second pixel of border
         on one card in a list otherwise shifts that card's contents by one, and
         the list looks misaligned rather than marked. */
      padding: calc(var(--ptk-space-md) - 1px);
    }

    .card-line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
    }

    .badge {
      padding: var(--ptk-space-xs);
      border: 1px solid var(--ptk-color-accent);
      border-radius: var(--ptk-radius-sm);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-accent);
    }

    .weight {
      font-size: var(--ptk-font-size-xl);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .facts {
      display: grid;
      gap: var(--ptk-space-xs);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--ptk-font-size-sm);
    }

    .reaches {
      color: var(--ptk-color-positive);
    }

    .surrenders {
      color: var(--ptk-color-caution);
    }

    .other {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-sunken);
    }

    .extras {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }
  `;

  /** `null` before a lift is under way. Rendered as a waiting sentence. */
  @property({ attribute: false }) choices: LiveChoices | null = null;

  /**
   * The federation's pound chart, resolved per card at render.
   *
   * The element resolves rather than being handed a pre-paired list because a
   * second array of pound readings kept alongside the choices is a second thing
   * to keep in step, and the failure when it slips is a pound figure printed
   * beside the wrong kilogram figure -- read off a phone, called to an
   * expeditor, and wrong by whatever the two cards differ by.
   */
  @property({ attribute: false }) chart: ConversionChart | null = null;

  /** The unit the lifter is typing in. Attempts ignore it; totals follow it (§16). */
  @property({ attribute: false }) unit: WeightUnit = 'kg';

  /**
   * Why the last weight this element reported was not accepted.
   *
   * Supplied by the caller after `applyMeetAction` refused it. The element
   * cannot work these out and must not try: legality is the rule set's, and a
   * template that guessed would be a copy of the rules that goes stale silently.
   */
  @property({ attribute: false }) refusals: readonly AttemptRefusalCode[] = [];

  /**
   * The typed weight, owned here for the same reason §12's draft is.
   *
   * The live screen repaints off the clock seam four times a second, and a
   * half-typed figure routed through the root would be a state update per
   * keystroke on a screen already re-rendering on a timer. Cleared when the
   * attempt changes, so a figure typed against attempt two cannot be submitted
   * against attempt three.
   */
  @state() private otherWeight = '';

  /** Which attempt the typed figure belongs to, so a swap can be noticed. */
  #draftFor: string | null = null;

  /**
   * Clear the typed weight when the attempt changes.
   *
   * Keyed on the id and not on object identity: the live view is rebuilt on
   * every clock tick, so a fresh `LiveChoices` arrives four times a second and
   * identity would clear the field between two digits.
   */
  protected override willUpdate(): void {
    const id = this.choices?.attemptId ?? null;
    if (id === this.#draftFor) return;
    this.#draftFor = id;
    this.otherWeight = '';
  }

  override render(): TemplateResult {
    const choices = this.choices;
    if (choices === null) {
      return html`<ptk-notice tone="info">No lift under way.</ptk-notice>`;
    }
    return html`
      ${this.#renderHeading(choices)} ${this.#renderCards(choices)}
      ${this.#renderOtherWeight(choices)} ${this.#renderAdvisories(choices.advisories)}
      ${this.#renderExtras(choices.extraAttempts)}
    `;
  }

  #renderHeading(choices: LiveChoices): TemplateResult {
    return html`
      <div class="heading">
        <h3>${liftLabel(choices.lift)}</h3>
        <p class="trigger">${triggerSentence(choices.trigger)}</p>
        <p class="muted">${SLOTS_EXPLANATION}</p>
      </div>
    `;
  }

  #renderCards(choices: LiveChoices): TemplateResult {
    if (choices.choices.length === 0) {
      return html`<p class="muted">${NO_CHOICES_NOTE}</p>`;
    }
    const weights = choices.choices.map((choice) => this.#weightFor(choice));
    return html`
      <ul class="cards">
        ${choices.choices.map((choice, index) => this.#renderCard(choice, weights[index] ?? null))}
      </ul>
      ${this.#renderPoundsAbsence(weights)}
    `;
  }

  /**
   * One card. The eight facts §13 lists, in the order a handler says them.
   *
   * Every one of them is `null`-checked rather than defaulted, because an
   * absent fact and a fact worth zero are different: a jump of nothing is "the
   * same weight again" and a jump that could not be worked out is silence. A
   * card that printed "Up 0 kg" for the second case would be asserting
   * something the domain declined to say.
   */
  #renderCard(choice: LiveChoice, weight: AttemptWeight | null): TemplateResult {
    const pounds = weight === null ? null : attemptPoundsText(weight);
    const increase = increaseText(choice);
    const percent = percentOfMaximumText(choice.percentOfMaximum);
    const risk = riskLine(choice);
    const reaches = reachesText(choice.reaches);
    const surrenders = surrendersText(choice.surrenders);
    return html`
      <li class="card" ?data-highlighted=${choice.highlighted}>
        <div class="card-line">
          <h4>${slotLabel(choice.slot)}</h4>
          ${choice.highlighted ? html`<span class="badge">${HIGHLIGHT_BADGE}</span>` : nothing}
        </div>
        ${
          weight === null
            ? nothing
            : html`
                <p class="weight">${attemptKilogramsText(weight)}</p>
                <p class="muted">${pounds ?? approximatePoundsText(weight)}</p>
              `
        }
        <ul class="facts">
          ${increase === null ? nothing : html`<li>${increase}</li>`}
          ${percent === null ? nothing : html`<li>${percent}</li>`}
          <li>${projectedText(choice.projected, this.unit)}</li>
          ${risk === null ? nothing : html`<li>${risk}</li>`}
          ${reaches === null ? nothing : html`<li class="reaches">${reaches}</li>`}
          ${surrenders === null ? nothing : html`<li class="surrenders">${surrenders}</li>`}
          ${choice.tactical ? html`<li>${TACTICAL_NOTE}</li>` : nothing}
        </ul>
        <p class="muted">${choice.explanation}</p>
        <ptk-button
          data-slot=${choice.slot}
          variant=${choice.highlighted ? 'primary' : 'secondary'}
          @click=${this.#onChoose}
          >${chooseLabel(weight)}</ptk-button
        >
      </li>
    `;
  }

  /**
   * Why a pound figure is missing, said once per distinct reason.
   *
   * Read off every card rather than the first, and deduplicated: "no published
   * pound chart is loaded" is one fact about the read and would otherwise
   * appear three times, while "the chart has no row for this weight" can be
   * true of the push card and not the secure one -- so taking the first card's
   * reason and calling it the screen's would explain the wrong absence.
   */
  #renderPoundsAbsence(
    weights: readonly (AttemptWeight | null)[],
  ): TemplateResult | typeof nothing {
    const sentences = [
      ...new Set(
        weights.flatMap((weight) => {
          if (weight === null) return [];
          const sentence = poundsAbsenceSentence(weight.publishedPoundsReason);
          return sentence === null ? [] : [sentence];
        }),
      ),
    ];
    if (sentences.length === 0) return nothing;
    return html`<ul class="list muted">
      ${sentences.map((sentence) => html`<li>${sentence}</li>`)}
    </ul>`;
  }

  /** §13's "a different legal weight". Not an escape hatch; part of the offer. */
  #renderOtherWeight(choices: LiveChoices): TemplateResult {
    const error = this.#otherWeightError();
    return html`
      <div class="other">
        <ptk-number-field
          data-field=${OTHER_WEIGHT_FIELD}
          label=${OTHER_WEIGHT_LABEL}
          hint=${OTHER_WEIGHT_HINT}
          unit="kg"
          .value=${this.otherWeight}
          error=${error ?? ''}
        ></ptk-number-field>
        <ptk-button
          ?disabled=${choices.attemptId === null || this.#typedKilograms() === null}
          @click=${this.#onUseTyped}
          >${OTHER_WEIGHT_SUBMIT}</ptk-button
        >
        ${
          this.refusals.length === 0
            ? nothing
            : html`<ul class="list">
                ${this.refusals.map(
                  (code) =>
                    html`<li><ptk-notice tone="error">${refusalSentence(code)}</ptk-notice></li>`,
                )}
              </ul>`
        }
      </div>
    `;
  }

  #renderAdvisories(advisories: readonly LiveAdvisory[]): TemplateResult | typeof nothing {
    if (advisories.length === 0) return nothing;
    return html`<ul class="list">
      ${advisories.map(
        (advisory) => html`
          <li>
            <ptk-notice tone=${advisory.severity === 'strong' ? 'error' : 'info'}>
              ${advisory.message}
            </ptk-notice>
          </li>
        `,
      )}
    </ul>`;
  }

  /** §13.8's extras, in a block of their own and never among the three. */
  #renderExtras(extras: readonly LiveAttempt[]): TemplateResult | typeof nothing {
    if (extras.length === 0) return nothing;
    return html`
      <section class="extras">
        <h4>${EXTRA_ATTEMPTS_HEADING}</h4>
        <p class="muted">${EXTRA_ATTEMPTS_NOTE}</p>
        <ul class="list">
          ${extras.map((extra) => html`<li>${extraAttemptLine(extra)}</li>`)}
        </ul>
      </section>
    `;
  }

  /** The chart reading for a card, or `null` for the one card with no weight. */
  #weightFor(choice: LiveChoice): AttemptWeight | null {
    if (choice.kilograms === null) return null;
    return attemptWeightFor(choice.kilograms, this.chart);
  }

  /**
   * The typed figure as kilograms, or `null` when it is not one yet.
   *
   * A unit typed after the number is refused rather than converted. §16 makes
   * the attempt a kilogram figure, so accepting "400 lb" would mean this screen
   * computing the kilogram weight that gets called to the expeditor -- which is
   * exactly the conversion §16 gives to the published chart and to nothing else.
   */
  #typedKilograms(): number | null {
    const parsed = parseWeightInput(this.otherWeight);
    if (!parsed.ok) return null;
    if (parsed.unit !== null && parsed.unit !== 'kg') return null;
    return parsed.amount;
  }

  /** Empty is not an error: an untouched field has nothing wrong with it yet. */
  #otherWeightError(): string | null {
    if (this.otherWeight.trim() === '') return null;
    const parsed = parseWeightInput(this.otherWeight);
    if (!parsed.ok) return weightInputProblemSentence(parsed.code);
    if (parsed.unit !== null && parsed.unit !== 'kg') return OTHER_WEIGHT_MUST_BE_KILOGRAMS;
    return null;
  }

  readonly #onChoose = (event: Event): void => {
    const choices = this.choices;
    const attemptId = choices?.attemptId ?? null;
    if (choices === null || attemptId === null) return;
    const slot = asSlot(attributeOf(event, CHOICE_SLOT_FIELD));
    if (slot === null) return;
    const choice = choices.choices.find((candidate) => candidate.slot === slot);
    if (choice === undefined) return;
    this.#report(attemptId, choice.kilograms, slot);
  };

  /**
   * The typed weight.
   *
   * Guarded again even though the button is disabled: this listener sits on the
   * `ptk-button` host, and a press landing on the host's own box runs it
   * whatever the inner `<button>`'s disabled state -- which is a real click on a
   * real phone, near the padding, not a synthetic event in a test.
   */
  readonly #onUseTyped = (): void => {
    const attemptId = this.choices?.attemptId ?? null;
    const kilograms = this.#typedKilograms();
    if (attemptId === null || kilograms === null) return;
    this.#report(attemptId, kilograms, null);
  };

  #report(attemptId: string, kilograms: number | null, slot: LiveChoiceSlot | null): void {
    this.dispatchEvent(
      new CustomEvent<LiveChoiceDetail>(LIVE_CHOICE_EVENT, {
        detail: { attemptId, kilograms, slot },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * One delegated listener, reading `event.composedPath()`.
   *
   * `event.target` is retargeted to this host for anything fired inside a
   * child's own shadow tree (§5.8), so the `data-field` is unreachable from it
   * and every keystroke would be dropped while the field visibly accepted them.
   */
  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    super.disconnectedCallback();
  }

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    if (attributeOf(event, 'field') !== OTHER_WEIGHT_FIELD) return;
    this.otherWeight = event.detail.value;
  };

  /**
   * Lit settles when this element's template is committed, before the children
   * it just handed properties to have rendered anything (§5.8).
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

/** The nearest `data-<name>` on the composed path, or `null`. */
function attributeOf(event: Event, name: string): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement) {
      const value = node.dataset[name];
      if (value !== undefined) return value;
    }
  }
  return null;
}

/**
 * Checked against the list rather than asserted.
 *
 * `dataset` is a string out of the DOM, and a typo in the attribute would
 * otherwise send a slot the domain has no card for -- which surfaces as a press
 * that silently does nothing, well away from the template that produced it.
 */
function asSlot(value: string | null): LiveChoiceSlot | null {
  switch (value) {
    case 'secure':
    case 'recommended':
    case 'push':
      return value;
    default:
      return null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-live-choices': PtkLiveChoices;
  }

  interface HTMLElementEventMap {
    [LIVE_CHOICE_EVENT]: CustomEvent<LiveChoiceDetail>;
  }
}
