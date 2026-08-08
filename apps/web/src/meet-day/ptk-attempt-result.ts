// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §12: recording what happened, in three or four taps.
 *
 * Outcome, then the one follow-up question that outcome asks, then Record. A
 * pass or a granted extra asks nothing and is two taps. Everything else §12.1
 * lists -- the three lights, the referees' stated reason, a note -- is behind a
 * fold, because the requirement is explicit that light-by-light entry must not
 * stand between an attempt and the next set of choices.
 *
 * WHY THIS ELEMENT OWNS ITS DRAFT, WHEN THE PLAN SCREENS OWN NOTHING
 *
 * Every element on the plan side reads a `PlannerSession` and reports changes
 * upward; the root owns the state. This one keeps the half-filled result in its
 * own fields until Record is pressed, and the departure is deliberate:
 *
 *   - The draft is never persisted and never part of the meet document. Nothing
 *     that reads the document should be able to see a result that has not been
 *     recorded, and the surest way to guarantee that is for the draft not to
 *     exist out there.
 *   - The live screen repaints off the clock seam four times a second (§14).
 *     Routing every keystroke of a note through the root means a state update
 *     per character on a screen already re-rendering on a timer.
 *   - The reset is keyed to `subject.attemptId` and happens in `willUpdate`, so
 *     a screen that swaps the attempt underneath a half-filled draft cannot
 *     forget to clear it. §13.9's undo does exactly that swap, and a draft that
 *     survived it would let a lifter record the previous attempt's reading
 *     against this one.
 *
 * The event carries a `RecordedResult` the caller passes straight to
 * `applyMeetAction`. This element decides nothing about what the result means.
 */
import {
  RPE_BOUNDS,
  type AttemptEffort,
  type AttemptLights,
  type AttemptWeight,
  type MissReason,
  type RecordedResult,
  type RefereeLight,
} from '@platform-toolkit/domain';
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-notice';
import '@platform-toolkit/ui/ptk-number-field';
import '@platform-toolkit/ui/ptk-segmented';
import '@platform-toolkit/ui/ptk-text-area';
import {
  CHOICE_CHANGE_EVENT,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  NUMBER_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-number-field';
import {
  SEGMENTED_CHANGE_EVENT,
  type SegmentedChangeDetail,
} from '@platform-toolkit/ui/ptk-segmented';
import {
  TEXT_AREA_CHANGE_EVENT,
  type TextAreaChangeDetail,
} from '@platform-toolkit/ui/ptk-text-area';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  DETAIL_FOLD_SUMMARY,
  EFFORT_CHOICES,
  EFFORT_MISSING,
  LIGHT_CHOICES,
  LIGHT_POSITION_LABELS,
  MISS_REASON_CHOICES,
  MISS_REASON_MISSING,
  NOTE_HINT,
  NOTE_LABEL,
  OUTCOME_CHOICES,
  OUTCOME_MISSING,
  RECORD_KEEPING_NOTE,
  RECORD_LABEL,
  RPE_HINT,
  RPE_LABEL,
  attemptKilogramsText,
  attemptPoundsText,
  resultSubjectLine,
  type ResultOutcome,
} from './copy.js';
import {
  EFFORT_FIELD,
  LIGHT_FIELDS,
  MISS_REASON_FIELD,
  NOTE_FIELD,
  OUTCOME_FIELD,
  RPE_FIELD,
} from './fields.js';

/** The attempt this card is about. Supplied; never derived from a document here. */
export interface ResultSubject {
  readonly attemptId: string;
  /** §14's named failure is the right weight against the wrong athlete. */
  readonly lifterName: string;
  readonly lift: PlatformLift;
  readonly attemptNumber: number;
  /** `null` for an attempt that reached the platform without a declared weight. */
  readonly weight: AttemptWeight | null;
}

/**
 * What was recorded, ready for `applyMeetAction`.
 *
 * `lights` and `note` ride alongside the result rather than inside it because
 * that is how the document takes them: `record-result` carries the result and
 * `annotate-attempt` carries the decorations. Folding them into one object here
 * would mean unpicking it again in the caller.
 */
export interface AttemptResultDetail {
  readonly attemptId: string;
  readonly result: RecordedResult;
  /** All three or none -- two lights and a blank is not a judgement. */
  readonly lights: AttemptLights | null;
  /** Untrimmed emptiness is reported as `null`, not as an empty note. */
  readonly note: string | null;
}

export const ATTEMPT_RESULT_EVENT = 'ptk-meet-day-attempt-result';

/** A light not yet set. Not a value the domain has, which is the point. */
type LightDraft = RefereeLight | null;

@customElement('ptk-attempt-result')
export class PtkAttemptResult extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .card {
      display: grid;
      gap: var(--ptk-space-md);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    .subject {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .weight {
      margin: 0;
      font-size: var(--ptk-font-size-xl);
      font-weight: 700;
    }

    .pounds {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .lights {
      display: grid;
      gap: var(--ptk-space-md);
      /*
       * The min() is load-bearing: without it a container narrower than the
       * track minimum overflows rather than collapsing to one column (§5.7).
       */
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
    }

    .details {
      display: grid;
      gap: var(--ptk-space-md);
    }

    .missing {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .note {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  /** `null` before an attempt is on the platform. Rendered as a waiting sentence. */
  @property({ attribute: false }) subject: ResultSubject | null = null;

  /*
   * The draft. `@state` rather than `@property`: nothing outside sets these, and
   * a caller that could would be able to record a result the lifter never chose.
   */
  @state() private outcome: ResultOutcome | null = null;
  @state() private effort: AttemptEffort | null = null;
  @state() private missReason: MissReason | null = null;
  @state() private rpeText = '';
  @state() private note = '';
  @state() private lights: readonly [LightDraft, LightDraft, LightDraft] = [null, null, null];

  /** Which attempt the current draft belongs to, so a swap can be noticed. */
  #draftFor: string | null = null;

  /**
   * Clear the draft when the attempt changes.
   *
   * In `willUpdate` rather than in a setter so that it also covers the first
   * render and an undo that replaces the subject object without the element
   * being touched otherwise. Keyed on the id and not on object identity: the
   * live view is rebuilt on every clock tick (§13.5), so a fresh object arrives
   * four times a second and identity would clear the draft mid-sentence.
   */
  protected override willUpdate(): void {
    const id = this.subject?.attemptId ?? null;
    if (id === this.#draftFor) return;
    this.#draftFor = id;
    this.outcome = null;
    this.effort = null;
    this.missReason = null;
    this.rpeText = '';
    this.note = '';
    this.lights = [null, null, null];
  }

  override render(): TemplateResult {
    const subject = this.subject;
    if (subject === null) {
      return html`<ptk-notice tone="info">Nothing on the platform to record yet.</ptk-notice>`;
    }

    const missing = this.#missing();
    return html`
      <div class="card">
        <h3>Record the attempt</h3>
        <p class="subject">
          ${resultSubjectLine(subject.lifterName, subject.lift, subject.attemptNumber)}
        </p>
        ${this.#renderWeight(subject)}

        <ptk-choice-group
          data-field=${OUTCOME_FIELD}
          label="What happened?"
          .choices=${OUTCOME_CHOICES}
          .value=${this.outcome}
        ></ptk-choice-group>

        ${this.#renderFollowUp()} ${this.#renderDetails()}

        <ptk-button variant="primary" ?disabled=${missing !== null} @click=${this.#onRecord}
          >${RECORD_LABEL}</ptk-button
        >
        ${missing === null ? nothing : html`<p class="missing">${missing}</p>`}
        <p class="note">${RECORD_KEEPING_NOTE}</p>
      </div>
    `;
  }

  /**
   * The weight, in kilograms, with the chart's pound figure beneath it if there
   * is one (§16). Never a computed pound figure: this card is read aloud.
   */
  #renderWeight(subject: ResultSubject): TemplateResult {
    if (subject.weight === null) return html`<p class="weight">No weight declared</p>`;
    const pounds = attemptPoundsText(subject.weight);
    return html`
      <p class="weight">${attemptKilogramsText(subject.weight)}</p>
      ${pounds === null ? nothing : html`<p class="pounds">${pounds}</p>`}
    `;
  }

  /**
   * The one question the chosen outcome asks.
   *
   * §12.2 and §12.3 are two lists and only ever one of them is on screen, which
   * is what keeps the flow at three taps. A pass and a granted extra ask nothing
   * -- there is no reading to take from a lift that did not happen.
   */
  #renderFollowUp(): TemplateResult | typeof nothing {
    switch (this.outcome) {
      case 'good':
        return html`
          <ptk-choice-group
            data-field=${EFFORT_FIELD}
            label="How did it feel?"
            .choices=${EFFORT_CHOICES}
            .value=${this.effort}
          ></ptk-choice-group>
        `;
      case 'no-lift':
        return html`
          <ptk-choice-group
            data-field=${MISS_REASON_FIELD}
            label="Why was it missed?"
            .choices=${MISS_REASON_CHOICES}
            .value=${this.missReason}
          ></ptk-choice-group>
        `;
      case 'passed':
      case 'extra-attempt-granted':
      case null:
        return nothing;
    }
  }

  /** §12.1's optional half. Folded, and the summary says it is optional. */
  #renderDetails(): TemplateResult {
    return html`
      <ptk-disclosure label="Details" summary=${DETAIL_FOLD_SUMMARY}>
        <div class="details">
          <div class="lights">
            ${LIGHT_FIELDS.map(
              (field, index) => html`
                <ptk-segmented
                  data-control=${field}
                  label=${LIGHT_POSITION_LABELS[index] ?? ''}
                  .choices=${LIGHT_CHOICES}
                  .value=${this.lights[index] ?? null}
                ></ptk-segmented>
              `,
            )}
          </div>
          ${
            this.outcome === 'good'
              ? html`
                  <ptk-number-field
                    data-field=${RPE_FIELD}
                    label=${RPE_LABEL}
                    hint=${RPE_HINT}
                    .value=${this.rpeText}
                    error=${this.#rpeError() ?? ''}
                  ></ptk-number-field>
                `
              : nothing
          }
          <ptk-text-area
            data-field=${NOTE_FIELD}
            label=${NOTE_LABEL}
            hint=${NOTE_HINT}
            .value=${this.note}
          ></ptk-text-area>
        </div>
      </ptk-disclosure>
    `;
  }

  /**
   * What still has to be answered, or `null` when nothing does.
   *
   * One sentence at a time, because the button is disabled for one reason at a
   * time and a list of two would only ever have one true entry.
   */
  #missing(): string | null {
    if (this.outcome === null) return OUTCOME_MISSING;
    if (this.outcome === 'good') {
      if (this.effort === null) return EFFORT_MISSING;
      return this.#rpeError();
    }
    if (this.outcome === 'no-lift' && this.missReason === null) return MISS_REASON_MISSING;
    return null;
  }

  /**
   * The typed RPE, refused here rather than by the document.
   *
   * Empty is not an error: RPE is optional, and the bounds come from the domain
   * so this field and `recordResult` cannot disagree about what 11 means.
   */
  #rpeError(): string | null {
    const trimmed = this.rpeText.trim();
    if (trimmed === '') return null;
    if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
      return 'Enter an RPE using digits, for example 8.5.';
    }
    const value = Number(trimmed);
    if (value < RPE_BOUNDS.min || value > RPE_BOUNDS.max) {
      return `RPE is recorded on the usual ${String(RPE_BOUNDS.min)} to ${String(RPE_BOUNDS.max)} scale.`;
    }
    return null;
  }

  /** All three or none. Two lights and a blank is not a judgement. */
  #completeLights(): AttemptLights | null {
    const [left, head, right] = this.lights;
    if (left === null || head === null || right === null) return null;
    return [left, head, right];
  }

  /**
   * The draft as the document takes it.
   *
   * Returns `null` for a draft that is not answerable, which is the same
   * condition the button is disabled on -- expressed once, in `#missing`, and
   * checked again here because a caller can dispatch a click at a disabled
   * button through the DOM and the guard is one line.
   */
  #result(): RecordedResult | null {
    switch (this.outcome) {
      case 'good': {
        if (this.effort === null || this.#rpeError() !== null) return null;
        const trimmed = this.rpeText.trim();
        // `exactOptionalPropertyTypes` is on, so the key is omitted rather than
        // set to undefined -- a present `rpe: undefined` is not the same shape.
        return trimmed === ''
          ? { outcome: 'good', effort: this.effort }
          : { outcome: 'good', effort: this.effort, rpe: Number(trimmed) };
      }
      case 'no-lift':
        return this.missReason === null ? null : { outcome: 'no-lift', reason: this.missReason };
      case 'passed':
        return { outcome: 'passed' };
      case 'extra-attempt-granted':
        return { outcome: 'extra-attempt-granted' };
      case null:
        return null;
    }
  }

  readonly #onRecord = (): void => {
    const subject = this.subject;
    const result = this.#result();
    if (subject === null || result === null) return;
    const note = this.note.trim();
    this.dispatchEvent(
      new CustomEvent<AttemptResultDetail>(ATTEMPT_RESULT_EVENT, {
        detail: {
          attemptId: subject.attemptId,
          result,
          lights: this.#completeLights(),
          note: note === '' ? null : this.note,
        },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * One listener per event name, reading `event.composedPath()`.
   *
   * `event.target` is retargeted to this host for anything fired inside a
   * child's own shadow tree (§5.8), so the `data-field` is unreachable from it
   * and every answer would be silently dropped while the controls visibly
   * responded.
   */
  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.addEventListener(TEXT_AREA_CHANGE_EVENT, this.#onText);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented);
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.removeEventListener(TEXT_AREA_CHANGE_EVENT, this.#onText);
    super.disconnectedCallback();
  }

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const field = attributeOf(event, 'field');
    const value = event.detail.value;
    if (field === OUTCOME_FIELD) {
      this.outcome = asOutcome(value);
      return;
    }
    if (field === EFFORT_FIELD) {
      this.effort = asEffort(value);
      return;
    }
    if (field === MISS_REASON_FIELD) {
      this.missReason = asMissReason(value);
    }
  };

  readonly #onSegmented = (event: CustomEvent<SegmentedChangeDetail>): void => {
    const control = attributeOf(event, 'control');
    const index = LIGHT_FIELDS.findIndex((field) => field === control);
    if (index < 0) return;
    const light = asLight(event.detail.value);
    if (light === null) return;
    const next: LightDraft[] = [...this.lights];
    next[index] = light;
    // Rebuilt as a fresh tuple: Lit compares by identity, so mutating the array
    // in place would change the draft and render nothing.
    this.lights = [next[0] ?? null, next[1] ?? null, next[2] ?? null];
  };

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    if (attributeOf(event, 'field') !== RPE_FIELD) return;
    this.rpeText = event.detail.value;
  };

  readonly #onText = (event: CustomEvent<TextAreaChangeDetail>): void => {
    if (attributeOf(event, 'field') !== NOTE_FIELD) return;
    this.note = event.detail.value;
  };

  /**
   * Lit settles when this element's template is committed, before the controls
   * it just handed options to have rendered any (§5.8).
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

/*
 * Four narrowings, each checked against the list the control was given rather
 * than asserted. `dataset` and a change detail are both strings out of the DOM,
 * and a typo in a choice list would otherwise write a value the domain has no
 * branch for -- which surfaces as an attempt recorded with an effort nothing
 * matches, well downstream of the control that produced it.
 */
function asOutcome(value: string): ResultOutcome | null {
  switch (value) {
    case 'good':
    case 'no-lift':
    case 'passed':
    case 'extra-attempt-granted':
      return value;
    default:
      return null;
  }
}

function asEffort(value: string): AttemptEffort | null {
  switch (value) {
    case 'flew':
    case 'solid':
    case 'slow':
    case 'grind':
    case 'pain':
    case 'unsure':
      return value;
    default:
      return null;
  }
}

function asMissReason(value: string): MissReason | null {
  switch (value) {
    case 'command':
    case 'strength':
    case 'pain':
    case 'platform-error':
    case 'administrative':
    case 'unsure':
      return value;
    default:
      return null;
  }
}

function asLight(value: string): RefereeLight | null {
  switch (value) {
    case 'white':
    case 'red':
      return value;
    default:
      return null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-attempt-result': PtkAttemptResult;
  }

  interface HTMLElementEventMap {
    [ATTEMPT_RESULT_EVENT]: CustomEvent<AttemptResultDetail>;
  }
}
