// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §19's screen: the record, and the two attempts that would take it.
 *
 * `records.ts` holds the answers and calls the domain; `copy.ts` holds every
 * sentence. This file lays the result out and computes nothing -- no margin, no
 * rounding, no eligibility, no arithmetic on a total. A property arrives and an
 * event leaves, which is what lets the same element serve the planning screen
 * and one open lifter on the coach board without either of them knowing about
 * the other.
 *
 * BOTH ROUTES, ALWAYS, EVEN THE CLOSED ONE
 *
 * The competition attempt and the fourth attempt are not the same weight, and
 * `meet-records.ts` opens on why. What that means for a screen is the rule this
 * file is built around: **neither figure is ever rendered without the heading
 * that names which attempt it belongs to, and a closed route keeps its heading
 * and shows the reason where the weight would be.** Hiding a closed route would
 * leave one number on screen with nothing to distinguish it from the other one,
 * and the fourth-attempt figure handed to an expeditor as a competition attempt
 * is a refused card.
 *
 * THE ANSWER IS AT THE TOP AND THE QUESTIONS ARE UNDER IT
 *
 * §20's layout, for §20's reason. A lifter opens this between attempts to check
 * one figure -- what has to go on the bar -- and the ordinary form order would
 * put five questions above it. So the routes render first, they render with
 * nothing filled in (as two refusals and the mandatory sentence), and every
 * question is below them.
 *
 * NOTHING HERE HAS BEEN LOOKED UP, AND THE SCREEN NEVER STOPS SAYING SO
 *
 * §29 records that this application has read no record book, and every figure on
 * this screen is downstream of one number a lifter typed from memory or from a
 * page on their phone. `plan.verifyWithOfficials` is therefore rendered on every
 * state including both refusals, in the domain's own words, and it is the last
 * thing in the answer block rather than the first: a sentence above the figures
 * is read once and a sentence under them is read every time the figures are.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type {
  RecordAdvisory,
  RecordPlan,
  RecordRoute,
  RecordRouteAnswer,
  RecordRouteBlockCode,
} from '@platform-toolkit/domain';
import {
  NUMBER_FIELD_CHANGE_EVENT,
  SEGMENTED_CHANGE_EVENT,
  TEXT_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
  type SegmentedChangeDetail,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';

import {
  RECORD_FOURTH_ATTEMPT_HEADING,
  RECORD_HEADING,
  RECORD_HOLDER_CHOICES,
  RECORD_HOLDER_HELD,
  RECORD_HOLDER_LABEL,
  RECORD_HOLDER_UNCLAIMED,
  RECORD_IN_COMPETITION_HEADING,
  RECORD_INTRO,
  RECORD_KILOGRAMS_HINT,
  RECORD_KILOGRAMS_LABEL,
  RECORD_KILOGRAMS_UNIT,
  RECORD_LEVEL_HINT,
  RECORD_LEVEL_LABEL,
  RECORD_NEEDS_A_FIGURE,
  RECORD_NEEDS_RULES,
  RECORD_POST_LIFT_EQUIPMENT_CHECK,
  RECORD_QUALIFYING_HEADING,
  RECORD_RELATION_CHOICES,
  RECORD_RELATION_HINT,
  RECORD_RELATION_LABEL,
  RECORD_REQUIRES_PERMISSION,
  RECORD_TOTAL_SO_FAR_HINT,
  RECORD_TOTAL_SO_FAR_LABEL,
  recordBlockSentence,
  recordCountsTowardTotalText,
  recordExcludedFromText,
  recordQualifyingText,
  recordRelationUnstatedText,
  recordRouteWeightText,
  recordSubmissionText,
} from './copy.js';
import type { FieldReading } from './session.js';
import {
  EMPTY_RECORD_STATE,
  buildMeetRecord,
  recordLevelRelationFromValue,
  withRecord,
  type MeetRecordState,
  type MeetRecordView,
  type RecordAttemptSubject,
  type RecordSubject,
} from './records.js';

export const MEET_RECORD_CHANGE_EVENT = 'ptk-meet-record-change';

export interface MeetRecordChangeDetail {
  readonly state: MeetRecordState;
}

/**
 * The five `data-field` names, none of which is a key of the state.
 *
 * Spelled out rather than derived from `MeetRecordState`'s keys, which is the
 * opposite of what `ptk-meet-warmup` does and is deliberate: there are five
 * controls, three of them write a field under a different name (`unclaimed` is
 * asked as a holder, `levelRelation` as a comparison), and a table mapping five
 * strings to five keys is longer than five constants and one switch.
 *
 * They are prefixed `record-` for the same reason every class in this directory
 * is prefixed: a bare `level` or `total` is a name three other elements on this
 * screen could plausibly have taken, and the collision would show up as a
 * keystroke landing in somebody else's field rather than as a build failure.
 */
const RECORD_KILOGRAMS_FIELD = 'record-kilograms';
const RECORD_TOTAL_SO_FAR_FIELD = 'record-total-so-far';
const RECORD_LEVEL_FIELD = 'record-level';
const RECORD_HOLDER_FIELD = 'record-holder';
const RECORD_RELATION_FIELD = 'record-relation';

@customElement('ptk-meet-record')
export class PtkMeetRecord extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .record {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    section {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-lg);
    }

    h4 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    p {
      margin: 0;
      color: var(--ptk-color-text-muted);
    }

    /*
     * The two routes side by side where there is room and stacked where there is
     * not, on the intrinsic grid rather than a media query. The track minimum is
     * wider than the warm-up's rows because a route carries four short sentences
     * under its figure and two columns of one word each would be worse than one
     * column of two.
     */
    .record-routes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    .record-route {
      display: grid;
      align-content: start;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background: var(--ptk-color-surface-raised);
    }

    /*
     * The open route is bordered in the accent colour and the closed one is not,
     * and neither of them is identified by that. §21's rule is the collection's
     * rule: the heading names the attempt and the sentence under it says whether
     * it is open, so the border is confirmation for somebody who can see it and
     * nothing is lost by somebody who cannot.
     */
    .record-route.record-open {
      border-color: var(--ptk-color-accent);
    }

    .record-route .record-figure {
      margin: 0;
      font-size: var(--ptk-font-size-xl);
      font-weight: 600;
      color: var(--ptk-color-text);
    }

    .record-verify {
      color: var(--ptk-color-text);
      font-weight: 600;
    }

    .record-advisories {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .record-fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--ptk-space-sm);
    }
  `;

  /** Everything §19 asks about one record. Owned by the caller. */
  @property({ attribute: false }) state: MeetRecordState = EMPTY_RECORD_STATE;

  /** Which of the meet's records this is about, clamped by the caller. */
  @property({ type: String }) subject: RecordSubject = 'squat';

  /**
   * The attempt the record would be taken on. `null` before there is a rule book.
   *
   * Null rather than a stand-in profile, so that "no federation chosen yet" and
   * "a federation whose rules close both routes" are two different screens. Only
   * one of them is something the lifter can do anything about.
   */
  @property({ attribute: false }) attempt: RecordAttemptSubject | null = null;

  override render(): TemplateResult {
    const view =
      this.attempt === null ? null : buildMeetRecord(this.state, this.subject, this.attempt);
    return html`
      <div class="record">
        <section>
          <h3>${RECORD_HEADING}</h3>
          <p>${RECORD_INTRO}</p>
        </section>
        ${this.#renderAnswer(view)} ${this.#renderQuestions(view)}
      </div>
    `;
  }

  /**
   * The routes, or the one sentence that stands in for them.
   *
   * Three states and they are not interchangeable. No rule book is a setup
   * answer nobody has given; no figure is a box nobody has filled in; a plan is
   * the two routes. The first two are `ptk-notice` rather than a bare paragraph
   * because each of them names something for the lifter to go and do.
   */
  #renderAnswer(view: MeetRecordView | null): TemplateResult {
    if (view === null) {
      return html`<section><ptk-notice>${RECORD_NEEDS_RULES}</ptk-notice></section>`;
    }
    const plan = view.plan;
    if (plan.record === null) {
      return html`
        <section>
          <ptk-notice>${RECORD_NEEDS_A_FIGURE}</ptk-notice>
          <p class="record-verify">${plan.verifyWithOfficials}</p>
        </section>
      `;
    }
    return html`
      <section>
        ${this.#renderRelationCaveat(view)}
        <div class="record-routes">
          ${this.#renderRoute(RECORD_IN_COMPETITION_HEADING, plan.inCompetition)}
          ${this.#renderRoute(RECORD_FOURTH_ATTEMPT_HEADING, plan.asFourthAttempt)}
        </div>
        ${this.#renderQualifying(plan)} ${this.#renderAdvisories(plan.advisories)}
        <p class="record-verify">${plan.verifyWithOfficials}</p>
      </section>
    `;
  }

  /**
   * Which condition the figures above assume, said only where it bites.
   *
   * `relationAlternative` is already the whole of that question -- null once the
   * lifter answers, and null where answering would not move a weight either
   * heading names -- so there is no second test here. The figure comes off the
   * view rather than being worked out again, which is §13.8's rule: an expected
   * value this element computed itself would move with the code it is meant to
   * pin.
   */
  #renderRelationCaveat(view: MeetRecordView): TemplateResult | typeof nothing {
    if (view.relationAlternative === null) return nothing;
    return html`<ptk-notice>${recordRelationUnstatedText(view.relationAlternative)}</ptk-notice>`;
  }

  #renderRoute(heading: string, answer: RecordRouteAnswer): TemplateResult {
    return html`
      <div class="record-route ${answer.available ? 'record-open' : ''}">
        <h4>${heading}</h4>
        ${answer.available ? this.#renderOpenRoute(answer.route) : this.#renderReasons(answer.reasons)}
      </div>
    `;
  }

  /**
   * An open route: the weight, then what the lift is worth, then its conditions.
   *
   * The weight is the largest thing in the block and everything under it is one
   * short sentence, because a handler reading this has already decided which
   * route they are on and wants the number. The conditions render only where they
   * are true -- a line reading "no permission needed" on every competition
   * attempt is three words of noise on the route that never needs any.
   */
  #renderOpenRoute(route: RecordRoute): TemplateResult {
    const excluded = recordExcludedFromText(route.excludedFrom);
    return html`
      <p class="record-figure">${recordRouteWeightText(route)}</p>
      <p>${recordCountsTowardTotalText(route.countsTowardTotal)}</p>
      ${excluded === null ? nothing : html`<p>${excluded}</p>`}
      <p>${recordSubmissionText(route.submissionSeconds)}</p>
      ${route.requiresPermission ? html`<p>${RECORD_REQUIRES_PERMISSION}</p>` : nothing}
      ${
        route.requiresPostLiftEquipmentCheck
          ? html`<p>${RECORD_POST_LIFT_EQUIPMENT_CHECK}</p>`
          : nothing
      }
    `;
  }

  /**
   * Every reason at once, deduplicated, the way the domain reports them.
   *
   * All of them rather than the first, for §7.4's reason arriving on a screen
   * with a clock on it: a lifter whose third was a miss *and* who was never close
   * enough has two things to be told, and fixing one of them changes nothing.
   * Deduplicated because two codes can share a sentence.
   */
  #renderReasons(reasons: readonly RecordRouteBlockCode[]): TemplateResult {
    const said = [...new Set(reasons.map((reason) => recordBlockSentence(reason)))];
    return html`${said.map((sentence) => html`<p>${sentence}</p>`)}`;
  }

  /** §19's qualifying attempt, silent until there is a third attempt to report on. */
  #renderQualifying(plan: RecordPlan): TemplateResult | typeof nothing {
    const said = recordQualifyingText(plan.qualifyingAttempt);
    if (said === null) return nothing;
    return html`
      <div>
        <h4>${RECORD_QUALIFYING_HEADING}</h4>
        <p>${said}</p>
      </div>
    `;
  }

  #renderAdvisories(advisories: readonly RecordAdvisory[]): TemplateResult | typeof nothing {
    if (advisories.length === 0) return nothing;
    return html`
      <div class="record-advisories">
        ${advisories.map(
          (advisory) =>
            html`<ptk-notice tone=${advisory.severity === 'caution' ? 'error' : 'info'}
              >${advisory.message}</ptk-notice
            >`,
        )}
      </div>
    `;
  }

  /**
   * The five questions, with the banked total asked only where it is read.
   *
   * The total field is the one control on this screen that appears and
   * disappears, and it does so on the subject rather than on whether the routes
   * need it: `isTotalRecord` comes off the view, so the field is on screen for a
   * total record whose figure will not read, which is exactly when a lifter is
   * looking for the box they missed.
   */
  #renderQuestions(view: MeetRecordView | null): TemplateResult {
    const state = this.state;
    return html`
      <section>
        <div class="record-fields">
          <ptk-number-field
            data-field=${RECORD_KILOGRAMS_FIELD}
            label=${RECORD_KILOGRAMS_LABEL}
            unit=${RECORD_KILOGRAMS_UNIT}
            hint=${RECORD_KILOGRAMS_HINT}
            error=${messageOf(view?.kilogramsReading)}
            value=${state.kilograms}
          ></ptk-number-field>
          <ptk-text-field
            data-field=${RECORD_LEVEL_FIELD}
            label=${RECORD_LEVEL_LABEL}
            hint=${RECORD_LEVEL_HINT}
            capitalize="words"
            value=${state.levelLabel}
          ></ptk-text-field>
          ${
            view?.isTotalRecord
              ? html`<ptk-number-field
                  data-field=${RECORD_TOTAL_SO_FAR_FIELD}
                  label=${RECORD_TOTAL_SO_FAR_LABEL}
                  unit=${RECORD_KILOGRAMS_UNIT}
                  hint=${RECORD_TOTAL_SO_FAR_HINT}
                  error=${messageOf(view.totalSoFarReading)}
                  value=${state.totalFromOtherLifts}
                ></ptk-number-field>`
              : nothing
          }
        </div>
        <ptk-segmented
          data-field=${RECORD_HOLDER_FIELD}
          label=${RECORD_HOLDER_LABEL}
          .choices=${RECORD_HOLDER_CHOICES}
          value=${state.unclaimed ? RECORD_HOLDER_UNCLAIMED : RECORD_HOLDER_HELD}
        ></ptk-segmented>
        <ptk-segmented
          data-field=${RECORD_RELATION_FIELD}
          label=${RECORD_RELATION_LABEL}
          .choices=${RECORD_RELATION_CHOICES}
          value=${state.levelRelation}
        ></ptk-segmented>
        <p>${RECORD_RELATION_HINT}</p>
      </section>
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber as EventListener);
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onText as EventListener);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented as EventListener);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber as EventListener);
    this.removeEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onText as EventListener);
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented as EventListener);
    super.disconnectedCallback();
  }

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = attributeOf(event, 'field');
    const value = event.detail.value;
    if (field === RECORD_KILOGRAMS_FIELD) {
      this.#emit({ kilograms: value });
      return;
    }
    if (field === RECORD_TOTAL_SO_FAR_FIELD) {
      this.#emit({ totalFromOtherLifts: value });
    }
  };

  readonly #onText = (event: CustomEvent<TextFieldChangeDetail>): void => {
    if (attributeOf(event, 'field') !== RECORD_LEVEL_FIELD) return;
    // Untrimmed, like the roster's identifier and for the same reason: it is what
    // the list called the record, shown back exactly as it was typed. Nothing
    // downstream matches on it, so a trailing space costs nothing and correcting
    // it under the lifter's cursor costs a character they meant to type.
    this.#emit({ levelLabel: event.detail.value });
  };

  readonly #onSegmented = (event: CustomEvent<SegmentedChangeDetail>): void => {
    const field = attributeOf(event, 'field');
    const value = event.detail.value;
    if (field === RECORD_HOLDER_FIELD) {
      // Compared against the unclaimed option rather than against the held one,
      // so that a value this element did not render lands on `false` -- which is
      // the answer that charges the margin. The other direction hands a lifter
      // permission to load the record itself off a string nothing produced.
      this.#emit({ unclaimed: value === RECORD_HOLDER_UNCLAIMED });
      return;
    }
    if (field === RECORD_RELATION_FIELD) {
      this.#emit({ levelRelation: recordLevelRelationFromValue(value) });
    }
  };

  /**
   * Hands the new answers up and renders nothing itself.
   *
   * A patch rather than a whole state, which is the difference from
   * `ptk-meet-warmup`: every control here writes exactly one field of a flat
   * record, so `withRecord` is the whole of the merge and putting it in the
   * caller would be five writers in the root instead. The property is still not
   * written here -- the caller owns the state, and an element that painted its
   * own answer a frame before the caller agreed to it would show a record for a
   * lifter whose screen has since been closed.
   */
  #emit(patch: Partial<MeetRecordState>): void {
    this.dispatchEvent(
      new CustomEvent<MeetRecordChangeDetail>(MEET_RECORD_CHANGE_EVENT, {
        detail: { state: withRecord(this.state, patch) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * §5.8: a host whose children are LitElements is not complete when it says so.
   *
   * Every question on this screen is inside a child and so is every notice, so
   * without the await a test asserting on a field's error or on an advisory's
   * sentence passes or fails on timing.
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
 * `ptk-plan-method`'s helper with one more case on the front: this element
 * renders its questions before there is a federation to read them against, so
 * there is no view and therefore no reading. A field nobody has typed in yet
 * also carries a `null` message, and rendering either as text would put "null"
 * or "undefined" under an empty box.
 */
function messageOf(reading: FieldReading | undefined): string {
  if (reading === undefined || reading.ok) return '';
  return reading.message ?? '';
}

/**
 * The nearest `data-<name>` on the composed path.
 *
 * The path rather than `event.target`, for the reason the planner's own copy of
 * this documents: a target is retargeted to this host for anything fired inside
 * a child's shadow tree, so its dataset is empty and every keystroke is dropped
 * while the controls go on visibly responding.
 */
function attributeOf(event: Event, name: string): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement) {
      const value = node.dataset[name];
      if (value !== undefined) return value;
    }
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-meet-record': PtkMeetRecord;
  }

  interface HTMLElementEventMap {
    [MEET_RECORD_CHANGE_EVENT]: CustomEvent<MeetRecordChangeDetail>;
  }
}
