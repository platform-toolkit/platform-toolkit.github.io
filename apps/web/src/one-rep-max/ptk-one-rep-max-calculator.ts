/**
 * The tool. It owns every piece of state; the four elements below it own none.
 *
 * That split is the same one tools 2 and 4 use and it is what makes this
 * testable: any state -- a half-typed weight, twenty-five repetitions, an
 * assisted set, a lift nobody has described a standard for, no storage at all --
 * is reachable from a story and a test by handing in an entry, with no browser
 * storage and no network behind it.
 *
 * TWO STORES, TWO LIFETIMES
 *
 * `settings` outlives the tab and holds the unit, the lift, the rounding step
 * and the percentage step. `session` dies with it and holds the set: the weight,
 * the repetitions, how close to failure it was, and every refinement including
 * the reported sex. `session.ts` says why at length; the short version is that a
 * set description reopened a week later is a training record the lifter never
 * wrote, and a sex marker is not worth writing to a device to save one tap.
 *
 * EVERY ANSWER GOES THROUGH ONE PATH
 *
 * Controls report through their own composed events and are identified by
 * `data-field` read off `event.composedPath()` -- never `event.target`, which is
 * retargeted to this host for anything fired inside a child's shadow tree and
 * would leave every answer silently dropped (§5.8). One `#setEntry` writes state
 * and storage together, so a control cannot visibly respond and quietly fail to
 * stick.
 */
import {
  PERCENTAGE_STEPS,
  ROUNDING_INCREMENTS,
  estimateOneRepMax,
  type OneRepMaxEstimate,
  type OneRepMaxProblem,
  type Weight,
} from '@platform-toolkit/domain';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import {
  CHOICE_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  TOGGLE_GROUP_CHANGE_EVENT,
  type ChoiceChangeDetail,
  type NumberFieldChangeDetail,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import './ptk-estimate-result.js';
import './ptk-formula-comparison.js';
import './ptk-set-refinements.js';
import './ptk-training-percentages.js';

import { UNIT_CHOICES, liftChoices, reserveChoices } from './copy.js';
import {
  ASSISTED_FIELD,
  EXPERIENCE_FIELD,
  FORM_QUALITY_FIELD,
  FRESHNESS_FIELD,
  LIFT_FIELD,
  PERCENTAGE_STEP_FIELD,
  REPS_FIELD,
  RESERVE_FIELD,
  ROUND_TO_FIELD,
  SEX_FIELD,
  TECHNIQUE_FIELD,
  UNIT_FIELD,
  WEIGHT_FIELD,
} from './fields.js';
import {
  EMPTY_ENTRY,
  QUICK_REPS,
  chooseReps,
  experienceFrom,
  formQualityFrom,
  freshnessFrom,
  liftFromValue,
  loadEntry,
  repsProblem,
  requestFor,
  reserveFromValue,
  saveEntry,
  setLift,
  setTechnique,
  setUnit,
  sexFrom,
  typeReps,
  typeWeight,
  unitFromValue,
  weightProblem,
  type EstimateEntry,
} from './session.js';

@customElement('ptk-one-rep-max-calculator')
export class PtkOneRepMaxCalculator extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-lg);
      container-type: inline-size;
    }

    .set {
      display: grid;
      gap: var(--ptk-space-md);
    }

    /*
     * The weight and the repetitions side by side once there is room for both,
     * stacked before that. auto-fit against the element's own width, never the
     * viewport: the same markup is a phone screen and a 320 px embed column on a
     * desktop page, and a media query answers only one of them (§5.7).
     */
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
      gap: var(--ptk-space-md);
    }

    .quick {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
      margin-top: var(--ptk-space-sm);
    }

    .quick-label {
      display: block;
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
    }
  `;

  /**
   * Where the unit, lift and rounding choices live.
   *
   * Defaulted to a store with no backing so the element stands up in a story or
   * a test with no branch anywhere -- and so the configuration these tools
   * actually ship into, an iframe whose embedder blocked storage, is the
   * supported path rather than the exceptional one (§5.12).
   */
  @property({ attribute: false }) settings: PreferenceStore = createPreferenceStore(null);

  /** Where the described set lives, for this visit only. */
  @property({ attribute: false }) session: PreferenceStore = createPreferenceStore(null);

  @state() private entry: EstimateEntry = EMPTY_ENTRY;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    super.disconnectedCallback();
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }

  /**
   * Restores from both stores whenever either is handed in or swapped out.
   *
   * Not `connectedCallback`: Lit records the class-field defaults as changed on
   * the first update, so this runs once before the first render either way, and
   * it *also* runs when `view.ts` or a story replaces a store afterwards.
   * Restoring only on connect shows defaults over a device that remembers
   * something else, on some visits and not others.
   */
  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('settings') || changed.has('session')) {
      this.entry = loadEntry(this.settings, this.session);
    }
  }

  override render(): TemplateResult {
    const entry = this.entry;
    const outcome = this.#outcome();
    return html`
      <section class="set">
        <ptk-choice-group
          data-field=${LIFT_FIELD}
          label="Lift"
          .choices=${liftChoices()}
          .value=${entry.lift}
        ></ptk-choice-group>

        <div class="pair">
          <ptk-number-field
            data-field=${WEIGHT_FIELD}
            label="Weight lifted"
            unit=${entry.unit}
            placeholder=${entry.unit === 'kg' ? '130' : '285'}
            .value=${entry.weightText}
            error=${weightProblem(entry) ?? ''}
          ></ptk-number-field>

          <div>
            <ptk-number-field
              data-field=${REPS_FIELD}
              label="Repetitions completed"
              placeholder="3"
              .value=${entry.repsText}
              error=${repsProblem(entry) ?? ''}
            ></ptk-number-field>
            <span class="quick-label" id="quick-reps-label">Common counts</span>
            <div class="quick" role="group" aria-labelledby="quick-reps-label">
              ${QUICK_REPS.map(
                (reps) =>
                  html`<ptk-button
                    variant=${entry.repsText === String(reps) ? 'primary' : 'secondary'}
                    accessible-name=${`${String(reps)} ${reps === 1 ? 'repetition' : 'repetitions'}`}
                    @click=${() => {
                      this.#setEntry(chooseReps(entry, reps));
                    }}
                    >${String(reps)}</ptk-button
                  >`,
              )}
            </div>
          </div>
        </div>

        <ptk-choice-group
          data-field=${UNIT_FIELD}
          label="Unit"
          .choices=${UNIT_CHOICES}
          .value=${entry.unit}
        ></ptk-choice-group>

        <ptk-choice-group
          data-field=${RESERVE_FIELD}
          label="Repetitions left in the tank"
          .choices=${reserveChoices()}
          .value=${entry.reserve}
        ></ptk-choice-group>

        <div class="actions">
          ${
            entry.weightText === '' && entry.repsText === ''
              ? nothing
              : html`<ptk-button
                  variant="quiet"
                  accessible-name="Clear the set and start again"
                  @click=${() => {
                    this.#setEntry({
                      ...EMPTY_ENTRY,
                      // The lifter's own unit, lift and steps are settings and
                      // survive a clear. Clearing them would make the button
                      // that removes one set also undo every preference.
                      unit: entry.unit,
                      lift: entry.lift,
                      techniqueId: entry.techniqueId,
                      roundTo: entry.roundTo,
                      percentageStep: entry.percentageStep,
                    });
                  }}
                  >Clear</ptk-button
                >`
          }
        </div>
      </section>

      <ptk-set-refinements .entry=${entry}></ptk-set-refinements>

      <ptk-estimate-result
        .estimate=${outcome.estimate}
        .problems=${outcome.problems}
      ></ptk-estimate-result>

      <ptk-training-percentages
        .estimate=${headlineOf(outcome.estimate)}
        .step=${entry.percentageStep}
        .roundTo=${entry.roundTo}
      ></ptk-training-percentages>

      <ptk-formula-comparison .estimate=${outcome.estimate}></ptk-formula-comparison>
    `;
  }

  /**
   * The domain's answer for the current entry.
   *
   * Recomputed on every render rather than cached in a field. It is arithmetic
   * over twenty closed-form equations on a set of numbers already in hand, and a
   * cache would introduce the one bug this shape cannot otherwise have: a
   * displayed figure belonging to a set the lifter has since changed.
   */
  #outcome(): {
    readonly estimate: OneRepMaxEstimate | null;
    readonly problems: readonly OneRepMaxProblem[];
  } {
    const request = requestFor(this.entry);
    if (request === null) return { estimate: null, problems: [] };
    const result = estimateOneRepMax(request);
    return result.ok
      ? { estimate: result.estimate, problems: [] }
      : { estimate: null, problems: result.problems };
  }

  #setEntry(entry: EstimateEntry): void {
    this.entry = entry;
    saveEntry(this.settings, this.session, entry);
  }

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) return;
    this.#applyChoice(field, event.detail.value);
  };

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === WEIGHT_FIELD) this.#setEntry(typeWeight(this.entry, event.detail.value));
    if (field === REPS_FIELD) this.#setEntry(typeReps(this.entry, event.detail.value));
  };

  readonly #onToggle = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    if (fieldOf(event) !== ASSISTED_FIELD) return;
    this.#setEntry({ ...this.entry, assisted: event.detail.values.includes('assisted') });
  };

  /**
   * Applies one answer, checking the value against the list that offered it.
   *
   * `dataset` and a choice value are both strings out of the DOM, and every
   * mapper below is total: an unrecognised value lands on the answer that claims
   * nothing rather than on a state no control can show back.
   */
  #applyChoice(field: string, value: string): void {
    const entry = this.entry;
    switch (field) {
      case LIFT_FIELD:
        this.#setEntry(setLift(entry, liftFromValue(value)));
        return;
      case UNIT_FIELD:
        this.#setEntry(setUnit(entry, unitFromValue(value)));
        return;
      case RESERVE_FIELD:
        this.#setEntry({ ...entry, reserve: reserveFromValue(value) });
        return;
      case TECHNIQUE_FIELD:
        this.#setEntry(setTechnique(entry, value));
        return;
      case FRESHNESS_FIELD:
        this.#setEntry({ ...entry, freshness: freshnessFrom(value) });
        return;
      case FORM_QUALITY_FIELD:
        this.#setEntry({ ...entry, formQuality: formQualityFrom(value) });
        return;
      case EXPERIENCE_FIELD:
        this.#setEntry({ ...entry, experience: experienceFrom(value) });
        return;
      case SEX_FIELD:
        this.#setEntry({ ...entry, sex: sexFrom(value) });
        return;
      case ROUND_TO_FIELD: {
        const step = Number(value);
        if (!ROUNDING_INCREMENTS[entry.unit].includes(step)) return;
        this.#setEntry({ ...entry, roundTo: step });
        return;
      }
      case PERCENTAGE_STEP_FIELD: {
        const step = Number(value);
        if (!PERCENTAGE_STEPS.includes(step)) return;
        this.#setEntry({ ...entry, percentageStep: step });
        return;
      }
      default:
        return;
    }
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
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    const field = node.dataset['field'];
    if (field !== undefined) return field;
  }
  return null;
}

/**
 * The figure the percentage table is a percentage *of*, or `null`.
 *
 * An observed single is the lifter's own load and is the honest basis; a
 * withheld estimate has no figure at all and must not silently fall back to the
 * entered weight, which is exactly the number the domain refused to build on.
 */
function headlineOf(estimate: OneRepMaxEstimate | null): Weight | null {
  if (estimate === null) return null;
  switch (estimate.kind) {
    case 'estimated':
      return estimate.toolkit;
    case 'observed-single':
      return estimate.observed;
    case 'withheld':
      return null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-one-rep-max-calculator': PtkOneRepMaxCalculator;
  }
}
