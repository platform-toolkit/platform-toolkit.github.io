// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §8: Improve My Plan. Everything optional, behind one fold.
 *
 * WHY IT IS FOLDED AND §6 AND §7 ARE NOT
 *
 * §6.1 gives the tool sixty seconds to a usable plan, and none of these answers
 * is needed to draw one. Twenty more questions in front of a lifter is how a
 * planner becomes a form nobody finishes -- and the ones here are the questions
 * whose honest answer is often "I would rather not say", which is a worse thing
 * to ask beside a required field than behind a fold somebody opened on purpose.
 *
 * WHAT THE SUMMARY HAS TO DO
 *
 * `ptk-disclosure`'s rule (§5.8) is that the summary states the whole of what is
 * true while folded, and here that rule has teeth: several of these answers move
 * the data-confidence grade the plan screen prints. A grade that rests on
 * "evidence from the last eight weeks" while the fold that says so is shut is a
 * grade built on an assumption the lifter cannot see. So the summary names every
 * answer that changes something, and says plainly when none has been given.
 *
 * WHAT IS NOT IN HERE
 *
 * The evidence questions disappear under Guided Estimate, where the lifter has
 * already described the set and `maximumSourceFor` reads the answer off it.
 * Asking a second time invites two answers that disagree, and the derived one
 * wins -- so the field would be a control that visibly responds and changes
 * nothing, which is worse than no control at all.
 *
 * The per-lift ceiling moves the other way: §7.3 and §7.5 need it as input, so
 * under those two methods `ptk-plan-method` asks for it and this fold does not.
 * There is one ceiling per lift, and two fields for it would let a lifter answer
 * one and watch the other contradict it.
 *
 * This element is presentation. It reads a `PlannerSession` and reports changes
 * as the shared components' own composed events tagged with `data-field` and,
 * where the answer belongs to one lift, `data-lift`. The root owns every piece of
 * state.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  ANSWER_CHOICES,
  COMPARISON_CHOICES,
  COMPARISON_EXPLANATION,
  EVIDENCE_AGE_CHOICES,
  MAXIMUM_SOURCE_CHOICES,
  READINESS_CHOICES,
  comparisonLabel,
  equipmentChoices,
  equipmentLabel,
  evidenceAgeLabel,
  liftLabel,
  maximumSourceLabel,
  readinessLabel,
} from './copy.js';
import {
  AGE_FIELD,
  BODYWEIGHT_FIELD,
  CEILING_FIELD,
  COMPARISON_FIELD,
  EQUIPMENT_FIELD,
  EVIDENCE_AGE_FIELD,
  HARD_CUT_FIELD,
  MAXIMUM_JUMP_FIELD,
  MAXIMUM_SOURCE_FIELD,
  MINIMUM_JUMP_FIELD,
  MINIMUM_TOTAL_FIELD,
  OPENER_TESTED_FIELD,
  PERSONAL_RECORD_FIELD,
  PERSONAL_RECORD_TOTAL_FIELD,
  PRIOR_MEETS_FIELD,
  QUALIFYING_TOTAL_FIELD,
  READINESS_FIELD,
  STRETCH_TOTAL_FIELD,
} from './fields.js';
import {
  AGE_BOUNDS,
  EMPTY_SESSION,
  PRIOR_MEETS_MAX,
  parseCount,
  parseWeight,
  sessionLifts,
  type FieldReading,
  type PlannerSession,
} from './session.js';

@customElement('ptk-plan-extras')
export class PtkPlanExtras extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .sections {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    h3 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-md);
    }

    h4 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .fields {
      display: grid;
      gap: var(--ptk-space-md);
    }

    /*
     * auto-fit against this element's own width, never the viewport: the same
     * markup is a phone and a 320px embed column on a desktop page (§5.7).
     */
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--ptk-space-md);
    }

    .explanation {
      margin: var(--ptk-space-xs) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  @property({ attribute: false }) session: PlannerSession = EMPTY_SESSION;

  override render(): TemplateResult {
    return html`
      <ptk-disclosure label="Improve my plan" summary=${this.#summary()}>
        <div class="sections">
          ${this.#renderLifter()} ${this.#renderJumps()} ${this.#renderEvidence()}
          ${this.#renderComparison()} ${this.#renderPerLift()} ${this.#renderTotals()}
        </div>
      </ptk-disclosure>
    `;
  }

  /** §8.1's lifter information. */
  #renderLifter(): TemplateResult {
    const extras = this.session.extras;
    const unit = this.session.setup.unit;
    return html`
      <section>
        <h3>About the lifter</h3>
        <div class="fields">
          <div class="pair">
            <ptk-number-field
              data-field=${BODYWEIGHT_FIELD}
              label="Competition bodyweight"
              unit=${unit}
              .value=${extras.bodyweight}
              error=${messageOf(parseWeight(extras.bodyweight, unit))}
            ></ptk-number-field>
            <ptk-number-field
              data-field=${AGE_FIELD}
              label="Age"
              .value=${extras.age}
              error=${messageOf(parseCount(extras.age, 'years', AGE_BOUNDS))}
            ></ptk-number-field>
          </div>

          <ptk-number-field
            data-field=${PRIOR_MEETS_FIELD}
            label="Meets competed in"
            hint="Zero is an answer."
            .value=${extras.priorMeets}
            error=${messageOf(parseCount(extras.priorMeets, 'meets', { min: 0, max: PRIOR_MEETS_MAX }))}
          ></ptk-number-field>

          <ptk-choice-group
            data-field=${EQUIPMENT_FIELD}
            label="Equipment category"
            .choices=${equipmentChoices()}
            .value=${extras.equipment}
          ></ptk-choice-group>

          <ptk-choice-group
            data-field=${READINESS_FIELD}
            label="How do you expect the day to go?"
            .choices=${READINESS_CHOICES}
            .value=${extras.readiness}
          ></ptk-choice-group>

          <ptk-choice-group
            data-field=${HARD_CUT_FIELD}
            label="A hard weight cut or a difficult recovery?"
            .choices=${ANSWER_CHOICES}
            .value=${extras.hardCut}
          ></ptk-choice-group>
        </div>
      </section>
    `;
  }

  /** §8.1's custom jump limits. */
  #renderJumps(): TemplateResult {
    const extras = this.session.extras;
    const unit = this.session.setup.unit;
    return html`
      <section>
        <h3>Your own jump limits</h3>
        <div class="pair">
          <ptk-number-field
            data-field=${MINIMUM_JUMP_FIELD}
            label="Smallest jump"
            unit=${unit}
            .value=${extras.minimumJump}
            error=${messageOf(parseWeight(extras.minimumJump, unit))}
          ></ptk-number-field>
          <ptk-number-field
            data-field=${MAXIMUM_JUMP_FIELD}
            label="Largest jump"
            unit=${unit}
            .value=${extras.maximumJump}
            error=${messageOf(parseWeight(extras.maximumJump, unit))}
          ></ptk-number-field>
        </div>
        <p class="explanation">
          The federation's own minimum still applies underneath these. A smallest jump below it
          cannot make an illegal attempt legal.
        </p>
      </section>
    `;
  }

  /**
   * §10.1's evidence questions, where the method has not already answered them.
   *
   * Guided Estimate derives both from the set that was described, so asking again
   * would offer a control whose answer is discarded.
   */
  #renderEvidence(): TemplateResult | typeof nothing {
    if (this.session.setup.method === 'guided-estimate') return nothing;
    const extras = this.session.extras;
    return html`
      <section>
        <h3>Where the figure came from</h3>
        <div class="fields">
          <ptk-choice-group
            data-field=${MAXIMUM_SOURCE_FIELD}
            label="Your expected maximum is"
            .choices=${MAXIMUM_SOURCE_CHOICES}
            .value=${extras.maximumSource}
          ></ptk-choice-group>
          <ptk-choice-group
            data-field=${EVIDENCE_AGE_FIELD}
            label="How recent is it?"
            .choices=${EVIDENCE_AGE_CHOICES}
            .value=${extras.evidenceAge}
          ></ptk-choice-group>
        </div>
        <p class="explanation">
          These change how well evidenced the plan is said to be. They never change the weights.
        </p>
      </section>
    `;
  }

  /** §8.2's research comparison group. */
  #renderComparison(): TemplateResult {
    return html`
      <section>
        <h3>Research comparison</h3>
        <ptk-choice-group
          data-field=${COMPARISON_FIELD}
          label="Draw the jump warnings from"
          .choices=${COMPARISON_CHOICES}
          .value=${this.session.extras.comparison}
        ></ptk-choice-group>
        <p class="explanation">${COMPARISON_EXPLANATION}</p>
      </section>
    `;
  }

  /** §8.1's per-lift answers, and §8.3's per-lift records. */
  #renderPerLift(): TemplateResult {
    return html`
      <section>
        <h3>Lift by lift</h3>
        <div class="fields">
          ${sessionLifts(this.session).map((lift) => this.#renderLiftFields(lift))}
        </div>
      </section>
    `;
  }

  #renderLiftFields(lift: PlatformLift): TemplateResult {
    const unit = this.session.setup.unit;
    const figures = this.session.figures[lift];
    const method = this.session.setup.method;
    const asksForCeiling = method === 'known-opener' || method === 'target-total';
    return html`
      <div>
        <h4>${liftLabel(lift)}</h4>
        <div class="fields">
          <div class="pair">
            <ptk-number-field
              data-field=${PERSONAL_RECORD_FIELD}
              data-lift=${lift}
              label="Competition best"
              unit=${unit}
              .value=${figures.personalRecord}
              error=${messageOf(parseWeight(figures.personalRecord, unit))}
            ></ptk-number-field>
            ${
              asksForCeiling
                ? nothing
                : html`<ptk-number-field
                    data-field=${CEILING_FIELD}
                    data-lift=${lift}
                    label="Hard ceiling"
                    unit=${unit}
                    .value=${figures.ceiling}
                    error=${messageOf(parseWeight(figures.ceiling, unit))}
                  ></ptk-number-field>`
            }
          </div>
          <ptk-choice-group
            data-field=${OPENER_TESTED_FIELD}
            data-lift=${lift}
            label="Has the planned opener been made in training?"
            .choices=${ANSWER_CHOICES}
            .value=${figures.openerTested}
          ></ptk-choice-group>
        </div>
      </div>
    `;
  }

  /** §8.3's totals. */
  #renderTotals(): TemplateResult {
    const unit = this.session.setup.unit;
    const targets = this.session.targets;
    return html`
      <section>
        <h3>Totals worth measuring against</h3>
        <div class="pair">
          <ptk-number-field
            data-field=${PERSONAL_RECORD_TOTAL_FIELD}
            label="Personal-record total"
            unit=${unit}
            .value=${targets.personalRecordTotal}
            error=${messageOf(parseWeight(targets.personalRecordTotal, unit))}
          ></ptk-number-field>
          <ptk-number-field
            data-field=${QUALIFYING_TOTAL_FIELD}
            label="Qualifying total"
            unit=${unit}
            .value=${targets.qualifyingTotal}
            error=${messageOf(parseWeight(targets.qualifyingTotal, unit))}
          ></ptk-number-field>
          <ptk-number-field
            data-field=${MINIMUM_TOTAL_FIELD}
            label="Minimum acceptable total"
            unit=${unit}
            .value=${targets.minimumAcceptableTotal}
            error=${messageOf(parseWeight(targets.minimumAcceptableTotal, unit))}
          ></ptk-number-field>
          <ptk-number-field
            data-field=${STRETCH_TOTAL_FIELD}
            label="Stretch total"
            unit=${unit}
            .value=${targets.stretchTotal}
            error=${messageOf(parseWeight(targets.stretchTotal, unit))}
          ></ptk-number-field>
        </div>
      </section>
    `;
  }

  /**
   * What is true while this is folded.
   *
   * Only the answers that move something are listed, and every one of those is
   * listed. Naming the ones still on their opening value would make the sentence
   * longest exactly when the least has been said, and it exists to be read at a
   * glance -- but leaving out an answer that moves the confidence grade would put
   * that grade's reason behind a shut fold, which is the failure this summary is
   * for.
   *
   * The evidence answers are named even under Guided Estimate, where they are not
   * asked here: they are still true, they still move the grade, and a summary
   * that goes quiet about them when the fields disappear tells the lifter the
   * question stopped mattering.
   */
  #summary(): string {
    const extras = this.session.extras;
    const said: string[] = [];
    if (extras.bodyweight.trim() !== '') said.push('bodyweight');
    if (extras.age.trim() !== '') said.push('age');
    if (extras.priorMeets.trim() !== '') said.push('meets competed in');
    if (extras.equipment !== 'unstated') said.push(equipmentLabel(extras.equipment).toLowerCase());
    if (extras.readiness !== 'unstated') said.push(readinessLabel(extras.readiness).toLowerCase());
    if (extras.hardCut === 'yes') said.push('a hard cut or difficult recovery');
    if (extras.minimumJump.trim() !== '' || extras.maximumJump.trim() !== '')
      said.push('your own jump limits');
    if (extras.maximumSource !== 'unstated')
      said.push(maximumSourceLabel(extras.maximumSource).toLowerCase());
    if (extras.evidenceAge !== 'unstated') said.push(evidenceAgeLabel(extras.evidenceAge));
    if (extras.comparison !== 'none') said.push(comparisonLabel(extras.comparison));
    if (this.#anyTotalTyped()) said.push('totals to measure against');
    if (this.#anyLiftFieldTyped()) said.push('lift-by-lift figures');

    return said.length === 0
      ? 'Nothing added. Readiness, equipment, jump limits and how well evidenced your maximum is are all unstated.'
      : `Added: ${said.join(', ')}.`;
  }

  /**
   * Named one by one rather than through `Object.values`.
   *
   * `PlannerTargets` is an interface with no index signature, so `Object.values`
   * resolves to the `{}` overload and hands back `any[]` -- which then reads
   * `.trim()` off four values the compiler has stopped checking. Adding a fifth
   * total and forgetting it here is caught by nothing either way; this at least
   * keeps the four that exist typed.
   */
  #anyTotalTyped(): boolean {
    const targets = this.session.targets;
    return [
      targets.personalRecordTotal,
      targets.qualifyingTotal,
      targets.minimumAcceptableTotal,
      targets.stretchTotal,
    ].some((text) => text.trim() !== '');
  }

  #anyLiftFieldTyped(): boolean {
    return sessionLifts(this.session).some((lift) => {
      const figures = this.session.figures[lift];
      return (
        figures.personalRecord.trim() !== '' ||
        figures.ceiling.trim() !== '' ||
        figures.openerTested !== 'unstated'
      );
    });
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
 * would put "null" under every empty box in this fold.
 */
function messageOf(reading: FieldReading): string {
  return reading.ok ? '' : (reading.message ?? '');
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-plan-extras': PtkPlanExtras;
  }
}
