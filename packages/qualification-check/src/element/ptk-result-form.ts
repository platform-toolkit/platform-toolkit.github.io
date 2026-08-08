// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A meet result, typed in from the sheet it is printed on.
 *
 * The brief calls the no-archive path "the common case" and says it "must be the
 * best-designed screen, not the fallback". `typed-result.ts` makes that true of the
 * data -- what leaves this form is an `AthleteEntry`, byte-identical in shape to a
 * mirrored one, and every rule downstream applies to it without knowing where it
 * came from. This element is the other half: the form has to feel like the main way
 * in, not like the box you use when the import failed.
 *
 * WHY IT ASKS FOR THE SHEET'S WORDS AND NOT FOR CATEGORIES
 *
 * Sex and equipment are free text here, and a picker would be the obvious
 * improvement. It would also be wrong. What the registration screen does with these
 * is *match* them -- fold the string, compare it against this federation's
 * catalogue, and refuse to fill anything in where the two merely agree on a word.
 * A picker would collapse that: the lifter would choose this federation's "Raw" and
 * the tool would then observe that the result says "Raw", which is a match against
 * itself. The evidence and the answer have to come from different places or the
 * check is theatre.
 *
 * WHAT CARRIES OVER, AND WHY NOT MORE
 *
 * Adding a result clears the meet and the lifts but keeps the federation, the parent
 * body, the sex and the equipment, because a lifter typing three meets is nearly
 * always typing three meets of one federation and would otherwise retype the same
 * four answers on a phone. Weight class, division and age are deliberately not
 * carried over even though they usually repeat -- those are the four answers the
 * registration screen refuses to guess, and a form that pre-filled last meet's
 * weight class would be guessing on its behalf.
 */
import type { AthleteEntry } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-date-field';
import '@platform-toolkit/ui/ptk-notice';
import '@platform-toolkit/ui/ptk-number-field';
import '@platform-toolkit/ui/ptk-segmented';
import '@platform-toolkit/ui/ptk-text-field';
import {
  CHOICE_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  DATE_FIELD_CHANGE_EVENT,
  type DateFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-date-field';
import {
  NUMBER_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-number-field';
import {
  SEGMENTED_CHANGE_EVENT,
  type SegmentedChangeDetail,
} from '@platform-toolkit/ui/ptk-segmented';
import {
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-text-field';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';

import type { TypedResultForm, TypedResultProblem } from '../core/typed-result.js';
import { emptyTypedResult, readTypedResult } from '../core/typed-result.js';

import {
  RESULT_FIELD_HINTS,
  RESULT_FIELD_LABELS,
  RESULT_LOG_NOTES,
  TESTED_ANSWERS,
  typedResultProblem,
  type TypedResultTextField,
} from './copy.js';
import {
  AGE_APPROXIMATE,
  AGE_APPROXIMATE_FIELD,
  AGE_EXACT,
  TESTED_FIELD,
  fieldOf,
  isTextualResultField,
  isTypedTestedAnswer,
} from './fields.js';

/** Fired when a typed result reads cleanly. Never for a form still being filled. */
export interface ResultEnteredDetail {
  /** The same shape a mirrored result arrives in, and read the same way. */
  readonly entry: AthleteEntry;
}

/** Event name, exported so a listener cannot misspell it. */
export const RESULT_ENTERED_EVENT = 'ptk-result-entered';

/** A form being filled in, with the two non-string answers written back. */
type FormDraft = { -readonly [K in keyof TypedResultForm]: TypedResultForm[K] };

/**
 * The tag this element is registered under by `defineQualificationCheck()`.
 *
 * Declared here and registered there, rather than by a `@customElement`
 * decorator, because the decorator writes to the registry the instant this module
 * is evaluated -- and the registry is a global that throws on a second write.
 * A consumer whose bundler failed to dedupe this package, or that imports it
 * alongside another copy, would get a `NotSupportedError` from a file it did not
 * write before a line of its own code ran (section 15).
 */
export const RESULT_FORM_TAG = 'ptk-result-form';

export class PtkResultForm extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .section + .section {
      margin-top: var(--ptk-space-lg);
    }

    h3 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-md);
    }

    .note {
      margin: 0 0 var(--ptk-space-sm);
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    /*
     * The intrinsic-grid pattern, at the width a label plus a 16px input needs.
     * The min() wrapper and not a bare 14rem: below that the track would be wider
     * than the column and the row would scroll sideways, which is the one thing a
     * 320px screen may never do.
     */
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    /*
     * The three lifts want to stay together and stay narrow -- they are three short
     * numbers read as a row, and a track sized for a text label would put one of
     * them alone on the second line at almost every width.
     */
    .fields.lifts {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-md);
    }

    /*
     * A button in a flex row will not shrink below its content, and a long label at
     * 200% text is wider than a 320px column. The cap is what turns that into a
     * wrapped label instead of a horizontally scrolling page (section 5.8).
     */
    .actions ptk-button {
      max-width: 100%;
    }

    .problems {
      margin-top: var(--ptk-space-md);
    }
  `;

  /**
   * What is typed so far.
   *
   * Internal state and not a property, which is the opposite of every other element
   * in this package and is the point: what a consumer wants back is the finished
   * result, and a bindable half-typed form is an invitation to persist one. Section
   * 2.3 forbids persisting imported athlete data by default, and a form holding a
   * meet name and a bodyweight is the same information by another route.
   */
  @state() private draft: FormDraft = emptyTypedResult();

  /** Everything wrong with the last submission, or empty before the first. */
  @state() private problems: readonly TypedResultProblem[] = [];

  readonly #onValue = (
    event: CustomEvent<TextFieldChangeDetail | NumberFieldChangeDetail | DateFieldChangeDetail>,
  ): void => {
    const field = fieldOf(event);
    if (field === null || !isTextualResultField(field)) return;
    this.#write(field, event.detail.value);
  };

  readonly #onSegmented = (event: CustomEvent<SegmentedChangeDetail>): void => {
    if (fieldOf(event) !== TESTED_FIELD) return;
    const { value } = event.detail;
    if (!isTypedTestedAnswer(value)) return;
    this.#set({ tested: value });
  };

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    if (fieldOf(event) !== AGE_APPROXIMATE_FIELD) return;
    this.#set({ ageApproximate: event.detail.value === AGE_APPROXIMATE });
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onValue);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onValue);
    this.addEventListener(DATE_FIELD_CHANGE_EVENT, this.#onValue);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented);
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children =
      this.shadowRoot?.querySelectorAll(
        'ptk-text-field, ptk-number-field, ptk-date-field, ptk-segmented, ptk-choice-group',
      ) ?? [];
    await Promise.all(
      [...children]
        .filter((child): child is LitElement => child instanceof LitElement)
        .map((child) => child.updateComplete),
    );
    return done;
  }

  override render(): TemplateResult {
    return html`
      <p class="note">${RESULT_LOG_NOTES.intro}</p>
      <p class="note">${RESULT_LOG_NOTES.parity}</p>

      <div class="section">
        <h3>The meet</h3>
        <div class="fields">
          ${this.#date('date')} ${this.#text('meetName')} ${this.#text('federation')}
          ${this.#text('parentFederation')} ${this.#tested()}
        </div>
      </div>

      <div class="section">
        <h3>You, on that day</h3>
        <p class="note">${RESULT_LOG_NOTES.noPlace}</p>
        <div class="fields">
          ${this.#text('sex')} ${this.#text('equipment')} ${this.#text('division')}
          ${this.#text('ageClass')} ${this.#number('ageYears', '')}
          ${this.#number('bodyweightKg', 'kg')} ${this.#text('weightClassKg')}
        </div>
        ${this.#ageExactness()}
      </div>

      <div class="section">
        <h3>The lifts</h3>
        <p class="note">${RESULT_LOG_NOTES.totalDerived}</p>
        <div class="fields lifts">
          ${this.#number('squatKg', 'kg')} ${this.#number('benchKg', 'kg')}
          ${this.#number('deadliftKg', 'kg')}
        </div>
      </div>

      ${this.#renderProblems()}

      <div class="actions">
        <ptk-button variant="primary" @click=${this.#submit}>Add this result</ptk-button>
      </div>
    `;
  }

  #text(field: TypedResultTextField): TemplateResult {
    return html`<div class="field" data-field=${field}>
      <ptk-text-field
        label=${RESULT_FIELD_LABELS[field]}
        .value=${this.draft[field]}
        hint=${RESULT_FIELD_HINTS[field] ?? ''}
        error=${this.#errorFor(field)}
        capitalize="words"
      ></ptk-text-field>
    </div>`;
  }

  #number(field: TypedResultTextField, unit: string): TemplateResult {
    return html`<div class="field" data-field=${field}>
      <ptk-number-field
        label=${RESULT_FIELD_LABELS[field]}
        unit=${unit}
        .value=${this.draft[field]}
        hint=${RESULT_FIELD_HINTS[field] ?? ''}
        error=${this.#errorFor(field)}
      ></ptk-number-field>
    </div>`;
  }

  #date(field: TypedResultTextField): TemplateResult {
    return html`<div class="field" data-field=${field}>
      <ptk-date-field
        label=${RESULT_FIELD_LABELS[field]}
        .value=${this.draft[field]}
        error=${this.#errorFor(field)}
      ></ptk-date-field>
    </div>`;
  }

  /**
   * Three answers on one bar, because the third is not a missing answer.
   *
   * A checkbox would have two states and the archive has three, so an unticked box
   * would arrive as the claim that the meet ran no testing -- and that is the axis a
   * lifter is turned away at weigh-in over.
   */
  #tested(): TemplateResult {
    const choices: readonly Choice[] = Object.entries(TESTED_ANSWERS).map(([value, label]) => ({
      value,
      label,
    }));
    return html`<div class="field" data-field=${TESTED_FIELD}>
      <ptk-segmented
        label="Drug testing at that meet"
        .choices=${choices}
        .value=${this.draft.tested}
      ></ptk-segmented>
    </div>`;
  }

  /**
   * Whether the age is the age, or one of two.
   *
   * Its own control rather than a note on the age field, because an archive that
   * recorded a birth year rather than a birth date genuinely does not know which of
   * two ages somebody was -- and the two are often two divisions. The registration
   * screen shows both readings, but only if this says there are two.
   */
  #ageExactness(): TemplateResult {
    const choices: readonly Choice[] = [
      { value: AGE_EXACT, label: 'That exact age' },
      { value: AGE_APPROXIMATE, label: 'That age or a year older' },
    ];
    return html`<div class="field" data-field=${AGE_APPROXIMATE_FIELD}>
      <ptk-choice-group
        label="How well the age is known"
        .choices=${choices}
        .value=${this.draft.ageApproximate ? AGE_APPROXIMATE : AGE_EXACT}
      ></ptk-choice-group>
    </div>`;
  }

  /**
   * The one problem with no control to attach it to.
   *
   * `no-lift` is reported against the three lift fields together, so there is no
   * field to mark -- marking all three would say each of them is individually wrong,
   * which is the opposite of what is true.
   */
  #renderProblems(): TemplateResult | typeof nothing {
    const loose = this.problems.filter((problem) => problem.field === 'lifts');
    if (this.problems.length === 0) return nothing;
    return html`<div class="problems">
      <ptk-notice tone="error">
        ${RESULT_LOG_NOTES.problems}
        ${loose.map((problem) => typedResultProblem(problem)).join(' ')}
      </ptk-notice>
    </div>`;
  }

  #errorFor(field: TypedResultTextField): string {
    const problem = this.problems.find((candidate) => candidate.field === field);
    return problem === undefined ? '' : typedResultProblem(problem);
  }

  #write(field: TypedResultTextField, value: string): void {
    this.#set({ [field]: value });
  }

  /**
   * Applies an edit and drops the complaints the previous submission made.
   *
   * Cleared on any edit rather than re-validated, because re-validating as somebody
   * types is how a half-typed date becomes an error message under a control they are
   * still using. The complaints come back on the next submission, against the form as
   * it then is.
   */
  #set(change: Partial<FormDraft>): void {
    this.draft = { ...this.draft, ...change };
    this.problems = [];
  }

  #submit = (): void => {
    const reading = readTypedResult(this.draft);
    if (!reading.ok) {
      this.problems = reading.problems;
      return;
    }

    this.draft = {
      ...emptyTypedResult(),
      federation: this.draft.federation,
      parentFederation: this.draft.parentFederation,
      sex: this.draft.sex,
      equipment: this.draft.equipment,
    };
    this.problems = [];
    this.dispatchEvent(
      new CustomEvent<ResultEnteredDetail>(RESULT_ENTERED_EVENT, {
        detail: { entry: reading.entry },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-result-form': PtkResultForm;
  }

  interface HTMLElementEventMap {
    [RESULT_ENTERED_EVENT]: CustomEvent<ResultEnteredDetail>;
  }
}
