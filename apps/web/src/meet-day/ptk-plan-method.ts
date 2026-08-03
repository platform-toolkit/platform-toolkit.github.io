// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §7: the five ways to build a plan, and the fields each one asks for.
 *
 * FIVE METHODS, ONE SHAPE
 *
 * A lifter begins from whichever information they trust most, so the method is a
 * question rather than a mode this tool decides. What changes between them is
 * only which fields are on screen: every one of them ends at a planning maximum
 * per lift, or at three typed attempts, and `plan.ts` takes it from there.
 *
 * WHY NOTHING IS DELETED WHEN THE METHOD CHANGES
 *
 * The session holds every method's fields for every lift at once, so switching
 * away and back returns what was typed. What a switch *does* discard is the
 * confirmations (`withSetup`), because the methods produce different maximums
 * from the same fields and a tick made under one of them says nothing about
 * another -- which is why the confirmation row below re-reads `view`, never a
 * remembered figure.
 *
 * WHY THE CEILING APPEARS HERE UNDER TWO METHODS AND IN §8 UNDER THE OTHERS
 *
 * There is one ceiling per lift and it does two jobs. Under Known Opener and
 * Target Total it is required input -- the second and third are planned between
 * the opener and it, and the split is pinned by it -- so it is asked for here,
 * beside the field it works with. Everywhere else it is §8.1's optional hard
 * ceiling and lives in the fold. Two fields would let a lifter answer one of them
 * and watch the other contradict it.
 *
 * This element is presentation. It reads a `PlannerSession` and the `PlannerView`
 * built from it, and reports changes as the shared components' own composed
 * events tagged with `data-field` and, where the answer belongs to one lift,
 * `data-lift`. The root owns every piece of state.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  ANSWER_CHOICES,
  EVIDENCE_AGE_CHOICES,
  RESERVE_CHOICES,
  liftLabel,
  methodChoices,
  methodExplanation,
  problemSentence,
  weightText,
} from './copy.js';
import {
  ATTEMPT_FIELDS,
  CEILING_FIELD,
  CONFIRM_FIELD,
  EXPECTED_MAXIMUM_FIELD,
  GUIDED_AGE_FIELD,
  GUIDED_EQUIPMENT_FIELD,
  GUIDED_REPS_FIELD,
  GUIDED_RESERVE_FIELD,
  GUIDED_STANDARD_FIELD,
  GUIDED_WEIGHT_FIELD,
  METHOD_FIELD,
  OPENER_FIELD,
  TARGET_TOTAL_FIELD,
} from './fields.js';
import { EMPTY_VIEW } from './plan.js';
import type { LiftPlanView, PlannerView } from './plan.js';
import {
  EMPTY_SESSION,
  GUIDED_REPS_MAX,
  methodNeedsConfirmation,
  parseCount,
  parseWeight,
  reserveValueOf,
  sessionLifts,
  type FieldReading,
  type PlannerSession,
} from './session.js';

/** The value of the one tick in a confirmation row. */
export const CONFIRM_VALUE = 'confirmed';

@customElement('ptk-plan-method')
export class PtkPlanMethod extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-lg);
      container-type: inline-size;
    }

    .explanation {
      margin: var(--ptk-space-xs) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .lift {
      display: grid;
      gap: var(--ptk-space-md);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .lift h3 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    /*
     * Two fields side by side once there is room, stacked before that. auto-fit
     * against this element's own width, never the viewport: the same markup is a
     * phone and a 320px embed column on a desktop page (§5.7).
     */
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--ptk-space-md);
    }

    .attempts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
      gap: var(--ptk-space-md);
    }

    .problems {
      display: grid;
      gap: var(--ptk-space-xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }
  `;

  @property({ attribute: false }) session: PlannerSession = EMPTY_SESSION;

  /** The plan as far as the answers reach, so the confirmation rows can name a figure. */
  @property({ attribute: false }) view: PlannerView = EMPTY_VIEW;

  override render(): TemplateResult {
    const method = this.session.setup.method;
    return html`
      <div>
        <ptk-choice-group
          data-field=${METHOD_FIELD}
          label="Start from"
          .choices=${methodChoices()}
          .value=${method}
        ></ptk-choice-group>
        ${methodExplanation(method).map((sentence) => html`<p class="explanation">${sentence}</p>`)}
      </div>

      ${method === 'target-total' ? this.#renderTargetTotal() : nothing}
      ${sessionLifts(this.session).map((lift) => this.#renderLift(lift))}
    `;
  }

  /** §7.5's one figure for the whole session, above the lifts it divides between. */
  #renderTargetTotal(): TemplateResult {
    const unit = this.session.setup.unit;
    return html`
      <div>
        <ptk-number-field
          data-field=${TARGET_TOTAL_FIELD}
          label="Target total"
          unit=${unit}
          placeholder=${unit === 'kg' ? '500' : '1100'}
          .value=${this.session.targetTotal}
          error=${messageOf(parseWeight(this.session.targetTotal, unit))}
        ></ptk-number-field>
        ${this.view.proposalProblems.map(
          (problem) => html`<p class="explanation">${problemSentence(problem)}</p>`,
        )}
      </div>
    `;
  }

  #renderLift(lift: PlatformLift): TemplateResult {
    const view = this.view.lifts.find((entry) => entry.lift === lift) ?? null;
    return html`
      <section class="lift">
        <h3>${liftLabel(lift)}</h3>
        ${this.#renderFigures(lift)} ${this.#renderProblems(view)}
        ${this.#renderConfirm(lift, view)}
      </section>
    `;
  }

  /** Whichever of §7's field sets the open method asks for. */
  #renderFigures(lift: PlatformLift): TemplateResult {
    switch (this.session.setup.method) {
      case 'expected-max':
        return this.#renderExpectedMaximum(lift);
      case 'guided-estimate':
        return this.#renderGuidedSet(lift);
      case 'known-opener':
        return this.#renderKnownOpener(lift);
      case 'manual':
        return this.#renderAttempts(lift);
      case 'target-total':
        return html`
          <div class="pair">
            ${this.#renderExpectedMaximum(lift)} ${this.#renderCeiling(lift, 'Hard ceiling')}
          </div>
        `;
    }
  }

  #renderExpectedMaximum(lift: PlatformLift): TemplateResult {
    const unit = this.session.setup.unit;
    const text = this.session.figures[lift].expectedMaximum;
    return html`
      <ptk-number-field
        data-field=${EXPECTED_MAXIMUM_FIELD}
        data-lift=${lift}
        label="Expected meet-day maximum"
        unit=${unit}
        placeholder=${unit === 'kg' ? '200' : '440'}
        .value=${text}
        error=${messageOf(parseWeight(text, unit))}
      ></ptk-number-field>
    `;
  }

  #renderCeiling(lift: PlatformLift, label: string): TemplateResult {
    const unit = this.session.setup.unit;
    const text = this.session.figures[lift].ceiling;
    return html`
      <ptk-number-field
        data-field=${CEILING_FIELD}
        data-lift=${lift}
        label=${label}
        unit=${unit}
        .value=${text}
        error=${messageOf(parseWeight(text, unit))}
      ></ptk-number-field>
    `;
  }

  /** §7.2's six questions about one recent set. */
  #renderGuidedSet(lift: PlatformLift): TemplateResult {
    const unit = this.session.setup.unit;
    const guided = this.session.figures[lift].guided;
    return html`
      <div class="pair">
        <ptk-number-field
          data-field=${GUIDED_WEIGHT_FIELD}
          data-lift=${lift}
          label="Weight lifted"
          unit=${unit}
          placeholder=${unit === 'kg' ? '170' : '375'}
          .value=${guided.weight}
          error=${messageOf(parseWeight(guided.weight, unit))}
        ></ptk-number-field>
        <ptk-number-field
          data-field=${GUIDED_REPS_FIELD}
          data-lift=${lift}
          label="Repetitions completed"
          placeholder="3"
          .value=${guided.reps}
          error=${messageOf(parseCount(guided.reps, 'repetitions', { max: GUIDED_REPS_MAX }))}
        ></ptk-number-field>
      </div>

      <ptk-choice-group
        data-field=${GUIDED_RESERVE_FIELD}
        data-lift=${lift}
        label="Repetitions left in the tank"
        .choices=${RESERVE_CHOICES}
        .value=${reserveValueOf(guided.repsInReserve)}
      ></ptk-choice-group>

      <ptk-choice-group
        data-field=${GUIDED_STANDARD_FIELD}
        data-lift=${lift}
        label="Judged to competition standard?"
        .choices=${ANSWER_CHOICES}
        .value=${guided.competitionStandard}
      ></ptk-choice-group>

      <ptk-choice-group
        data-field=${GUIDED_AGE_FIELD}
        data-lift=${lift}
        label="When was the set?"
        .choices=${EVIDENCE_AGE_CHOICES}
        .value=${guided.age}
      ></ptk-choice-group>

      <ptk-choice-group
        data-field=${GUIDED_EQUIPMENT_FIELD}
        data-lift=${lift}
        label="Same equipment as the meet?"
        .choices=${ANSWER_CHOICES}
        .value=${guided.sameEquipment}
      ></ptk-choice-group>
    `;
  }

  /** §7.3: the opener the lifter has already decided on, and where the day tops out. */
  #renderKnownOpener(lift: PlatformLift): TemplateResult {
    const unit = this.session.setup.unit;
    const figures = this.session.figures[lift];
    return html`
      <div class="pair">
        <ptk-number-field
          data-field=${OPENER_FIELD}
          data-lift=${lift}
          label="Opener"
          unit=${unit}
          placeholder=${unit === 'kg' ? '180' : '400'}
          .value=${figures.opener}
          error=${messageOf(parseWeight(figures.opener, unit))}
        ></ptk-number-field>
        ${this.#renderCeiling(lift, 'Realistic ceiling')}
      </div>
      ${this.#renderOpenerNotes(lift)}
    `;
  }

  /**
   * §7.3's working, shown as it is computed.
   *
   * The opener implies a maximum, and that implied figure is what the second and
   * third are planned from -- so a lifter whose ceiling sits under it needs to see
   * the arithmetic rather than a plan that quietly ignored one of the two numbers
   * they gave.
   */
  #renderOpenerNotes(lift: PlatformLift): TemplateResult | typeof nothing {
    const view = this.view.lifts.find((entry) => entry.lift === lift) ?? null;
    if (view === null || view.openerNotes.length === 0) return nothing;
    return html`<ul class="problems">
      ${view.openerNotes.map((note) => html`<li class="explanation">${note.message}</li>`)}
    </ul>`;
  }

  /** §7.4: all three, typed. Nothing here moves a weight the lifter chose. */
  #renderAttempts(lift: PlatformLift): TemplateResult {
    const unit = this.session.setup.unit;
    const attempts = this.session.figures[lift].attempts;
    return html`
      <div class="attempts">
        ${ATTEMPT_FIELDS.map((field, index) => {
          const text = attempts[index] ?? '';
          return html`<ptk-number-field
            data-field=${field}
            data-lift=${lift}
            label=${`Attempt ${String(index + 1)}`}
            unit=${unit}
            .value=${text}
            error=${messageOf(parseWeight(text, unit))}
          ></ptk-number-field>`;
        })}
      </div>
    `;
  }

  #renderProblems(view: LiftPlanView | null): TemplateResult | typeof nothing {
    if (view === null || view.problems.length === 0) return nothing;
    return html`<ul class="problems">
      ${view.problems.map(
        (problem) =>
          html`<li><ptk-notice tone="error">${problemSentence(problem)}</ptk-notice></li>`,
      )}
    </ul>`;
  }

  /**
   * §7.1 and §7.5's gate: the lifter underwrites the planning maximum.
   *
   * Rendered only where the method asks for one and only once there is a figure
   * to agree to -- a tick beside an empty field asks the lifter to confirm
   * nothing, and it would stay ticked while they typed, which is the one state
   * this gate exists to make impossible.
   */
  #renderConfirm(lift: PlatformLift, view: LiftPlanView | null): TemplateResult | typeof nothing {
    if (!methodNeedsConfirmation(this.session.setup.method)) return nothing;
    const maximum = view?.maximumKilograms ?? null;
    if (maximum === null) return nothing;

    const figure = weightText(maximum, this.session.setup.unit);
    return html`
      <ptk-toggle-group
        data-field=${CONFIRM_FIELD}
        data-lift=${lift}
        label="Plan from this figure"
        .choices=${[
          {
            value: CONFIRM_VALUE,
            label: `Plan the ${liftLabel(lift).toLowerCase()} from ${figure}`,
            description: 'Nothing is planned for this lift until this is ticked.',
          },
        ]}
        .values=${this.session.figures[lift].confirmed ? [CONFIRM_VALUE] : []}
      ></ptk-toggle-group>
    `;
  }

  /**
   * Lit settles when this element's template is committed, which is before the
   * controls it just handed options to have rendered any (§5.8). A caller
   * awaiting `updateComplete` and then reading an option would otherwise read the
   * previous render's -- usually not, which is what makes it expensive.
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
 * The sentence to show under a field, or the empty string for none.
 *
 * `FieldReading` has three cases and only one of them is an error: a field
 * nobody has typed in yet carries a `null` message, and rendering that as text
 * would put "null" under every empty box on the screen. `ptk-number-field` reads
 * the empty string as "no error", so the two non-error cases collapse here.
 */
function messageOf(reading: FieldReading): string {
  return reading.ok ? '' : (reading.message ?? '');
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-plan-method': PtkPlanMethod;
  }
}
