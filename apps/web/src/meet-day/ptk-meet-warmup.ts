// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §20's screen: the warm-up counted backwards from the platform.
 *
 * `warmup.ts` holds the answers and calls the two engines; `copy.ts` holds every
 * sentence. This file lays the result out and computes nothing -- no pace, no
 * range, no ordinal arithmetic, no rounding. A property arrives and an event
 * leaves, which is what lets the same element serve the solo planning screen and
 * one open lifter on the coach board without either of them knowing about the
 * other.
 *
 * THE ANSWER IS AT THE TOP AND THE QUESTIONS ARE UNDER IT
 *
 * The ordinary form order -- fill this in, then read the result -- is wrong for
 * the room this is used in. A handler opens this between attempts to check one
 * figure, and it is always the same figure: how long have we got. So the
 * estimate and the timeline render first, they render with nothing filled in,
 * and every question is below them or inside a fold. The screen is useful before
 * it is answered and stays useful when it is only half answered, which is what
 * §20.1's degrading estimate is for.
 *
 * WHY THE ROOM IS TOOL 2'S ELEMENT AND NOT A COPY OF IT
 *
 * `ptk-equipment-setup` already asks every question §20 asks about a warm-up
 * room, it stores nothing, and it takes an `Equipment` in and hands one back on
 * an event. §20 says "reuse the existing warm-up calculator with a meet-day
 * preset" and §5.8 forbids the fork, so this screen embeds that element and
 * passes it a different `Equipment` -- the meet's, kept apart from the gym's.
 * The only thing this file adds is the heading above it.
 *
 * NO CLOCK FACE, ANYWHERE
 *
 * Not one figure on this screen is a time of day, and every duration is a range.
 * That is §20.1's "avoid false precision" made structural rather than left to
 * the wording: a lifter given "2:47" plans to 2:47 and is standing at the rack
 * with cold hands at 2:55, and no caption under it prevents that. The one
 * sentence that is not a range is `MEET_STAFF_ARE_AUTHORITATIVE`, which sits
 * under the estimate and says who actually decides.
 *
 * WHY THE TIMELINE IS A LIST AND NOT A BAR
 *
 * A bar chart of the ramp was the obvious drawing and is unreadable at 320
 * pixels with eight items on it, which per §5.7 is the width that matters. It
 * also has to carry two figures per row -- a range is two numbers -- and a bar
 * with a range on it is a bar with an error bar, which reads as a measurement.
 * A list of rows, each with what to do and when, is scannable with chalk on your
 * hands and degrades to one column without a media query.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  MEET_STAFF_ARE_AUTHORITATIVE,
  formatWeight,
  isAdjustable,
  type MeetWarmupAdvisory,
  type MeetWarmupSchedule,
  type PlatformEstimate,
  type ScheduledItem,
  type TimingAdvisory,
  type WarmupSet,
} from '@platform-toolkit/domain';
import type { MeetFormat } from '@platform-toolkit/data-contracts';
import {
  EQUIPMENT_CHANGE_EVENT,
  NUMBER_FIELD_CHANGE_EVENT,
  SEGMENTED_CHANGE_EVENT,
  type EquipmentChangeDetail,
  type NumberFieldChangeDetail,
  type SegmentedChangeDetail,
} from '@platform-toolkit/ui';
import '@platform-toolkit/ui';

import {
  WARMUP_ATTEMPTS_DONE_LABEL,
  WARMUP_ATTEMPTS_LEFT_HINT,
  WARMUP_ATTEMPTS_LEFT_LABEL,
  WARMUP_BREAK_LABEL,
  WARMUP_CURRENT_POSITION_HINT,
  WARMUP_CURRENT_POSITION_LABEL,
  WARMUP_CURRENT_ROUND_LABEL,
  WARMUP_DELAY_CHOICES,
  WARMUP_DELAY_LABEL,
  WARMUP_DELAY_PREFERENCE_LABEL,
  WARMUP_ELAPSED_HINT,
  WARMUP_ELAPSED_LABEL,
  WARMUP_FLIGHTS_BETWEEN_LABEL,
  WARMUP_FLIGHT_SIZE_LABEL,
  WARMUP_HEADING,
  WARMUP_INTRO,
  WARMUP_LEAD_HINT,
  WARMUP_LEAD_MAXIMUM_LABEL,
  WARMUP_LEAD_MINIMUM_LABEL,
  WARMUP_LEAD_UNIT,
  WARMUP_MAXIMUM_SETS_HINT,
  WARMUP_MAXIMUM_SETS_LABEL,
  WARMUP_NEEDS_AN_OPENER,
  WARMUP_PACE_HEADING,
  WARMUP_PLACE_CHOICES,
  WARMUP_PLACE_HEADING,
  WARMUP_PLACE_LABEL,
  WARMUP_PREFERENCES_HEADING,
  WARMUP_PREP_HEADING,
  WARMUP_PREP_MINUTES_LABEL,
  WARMUP_PREP_WHEN_CHOICES,
  WARMUP_RESET_SETS_LABEL,
  WARMUP_REST_LABEL,
  WARMUP_ROOM_HEADING,
  WARMUP_SETS_HEADING,
  WARMUP_SET_REPS_LABEL,
  WARMUP_SET_SECONDS_LABEL,
  WARMUP_SET_WEIGHT_LABEL,
  WARMUP_SHARED_RACK_HINT,
  WARMUP_SHARED_RACK_LABEL,
  WARMUP_TARGET_POSITION_HINT,
  WARMUP_TARGET_POSITION_LABEL,
  WARMUP_TARGET_ROUND_LABEL,
  WARMUP_TIMELINE_HEADING,
  attemptsBeforeText,
  platformEstimateText,
  warmupItemLabel,
  warmupPaceText,
  warmupPrepLabel,
  warmupProblemSentence,
  warmupSetsSummary,
  warmupStartText,
} from './copy.js';
import {
  EMPTY_WARMUP_STATE,
  PREP_KINDS,
  buildMeetWarmup,
  delayPreferenceFromValue,
  hasSetAnswers,
  meetPlaceFromValue,
  paceFor,
  prepKindsFor,
  prepWhenFromValue,
  setAnswerFor,
  withCalculatedSets,
  withPreferences,
  withPrep,
  withProgress,
  withRoom,
  withSetReps,
  withSetWeight,
  type MeetProgress,
  type MeetWarmupResultView,
  type MeetWarmupState,
  type PrepKind,
  type WarmupPreferences,
  type WarmupSubject,
} from './warmup.js';

export const MEET_WARMUP_CHANGE_EVENT = 'ptk-meet-warmup-change';

export interface MeetWarmupChangeDetail {
  readonly state: MeetWarmupState;
}

/**
 * The `data-field` names that are not simply a key of the state.
 *
 * Six of them, and every other control on the screen names its state key
 * directly -- so the two tables below carry no mapping at all, only the question
 * "is this string one of those keys".
 */
const PLACE_FIELD = 'place';
const DELAY_PREFERENCE_FIELD = 'delay-preference';
const SET_WEIGHT_FIELD = 'set-weight';
const SET_REPS_FIELD = 'set-reps';
const PREP_MINUTES_FIELD = 'prep-minutes';
const PREP_WHEN_FIELD = 'prep-when';

/** The `MeetProgress` keys a number field can write, and their labels. */
type ProgressField = Exclude<keyof MeetProgress, 'place'>;

/** The `WarmupPreferences` keys a number field can write. */
type PreferenceField = Exclude<keyof WarmupPreferences, 'delayPreference' | 'prep'>;

/**
 * Which strings out of the DOM name a state key, as records rather than arrays.
 *
 * A `Record<ProgressField, true>` is exhaustive and an array of the same type is
 * not: leave a key out of the array and it compiles, the control renders, the
 * keystrokes are dropped by the narrowing below, and the field looks like a
 * rendering fault. Leave one out of the record and it does not build. That is
 * the whole reason for the shape -- the values carry no information.
 */
const PROGRESS_FIELDS: Readonly<Record<ProgressField, true>> = {
  currentRound: true,
  currentPosition: true,
  attemptsLeftInTheRunningFlight: true,
  wholeFlightsBetween: true,
  flightSize: true,
  attemptsCompleted: true,
  minutesSinceSessionStart: true,
  breakMinutes: true,
  delayMinutes: true,
  targetRound: true,
  targetPosition: true,
};

const PREFERENCE_FIELDS: Readonly<Record<PreferenceField, true>> = {
  leadMinimumMinutes: true,
  leadMaximumMinutes: true,
  restSeconds: true,
  setSeconds: true,
  maximumSets: true,
  sharedRackLifters: true,
};

@customElement('ptk-meet-warmup')
export class PtkMeetWarmup extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .warmup {
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

    .estimate {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background: var(--ptk-color-surface-raised);
    }

    .estimate .figure {
      margin: 0;
      font-size: var(--ptk-font-size-xl);
      font-weight: 600;
      color: var(--ptk-color-text);
    }

    /*
     * The rows are a grid rather than a flex line so that the "when" column and
     * the "what" column stay aligned down the list at any width, and collapse to
     * two stacked lines together rather than one row at a time.
     */
    .timeline {
      display: grid;
      gap: var(--ptk-space-xs);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .item {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
      padding: var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-sm);
    }

    .item.platform {
      border-color: var(--ptk-color-accent);
    }

    .item .what {
      font-weight: 600;
    }

    .item .when {
      color: var(--ptk-color-text-muted);
    }

    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    .prep-row {
      display: grid;
      gap: var(--ptk-space-xs);
      padding-block-end: var(--ptk-space-sm);
      border-block-end: 1px solid var(--ptk-color-border);
    }

    .prep-row:last-child {
      padding-block-end: 0;
      border-block-end: none;
    }

    .set-row {
      display: grid;
      gap: var(--ptk-space-xs);
      padding-block-end: var(--ptk-space-sm);
    }

    .advisories {
      display: grid;
      gap: var(--ptk-space-xs);
    }
  `;

  /** Every answer §20 and §20.1 ask for. Owned by the caller. */
  @property({ attribute: false }) state: MeetWarmupState = EMPTY_WARMUP_STATE;

  /**
   * Which lift, off what opener. `null` where no opener has been chosen.
   *
   * Null rather than a zero weight, so that "no opener yet" and "an opener the
   * room cannot build a ramp to" are two different sentences. They are two
   * different problems and only one of them is the lifter's to fix.
   */
  @property({ attribute: false }) subject: WarmupSubject | null = null;

  @property({ type: String }) format: MeetFormat = 'full-power';

  /** Read once by the caller, per §5.7's clock seam. Stamped, never consulted. */
  @property({ type: Number }) now = 0;

  override render(): TemplateResult {
    const result =
      this.subject === null
        ? null
        : buildMeetWarmup(this.state, this.subject, this.format, this.now);
    const estimate = result?.estimate ?? null;
    const schedule = result?.ok === true ? result.timeline.schedule : null;

    return html`
      <div class="warmup">
        <section>
          <h3>${WARMUP_HEADING}</h3>
          <p>${WARMUP_INTRO}</p>
          ${this.#renderEstimate(estimate)}
        </section>
        ${this.#renderTimeline(result, schedule)} ${this.#renderPlace()} ${this.#renderPace()}
        ${this.#renderSets(schedule)} ${this.#renderPreferences()} ${this.#renderRoom()}
      </div>
    `;
  }

  /**
   * §20.1's headline, which is the reason a handler opened the screen.
   *
   * Rendered even with nothing answered, because the fallbacks in `warmup.ts`
   * make the estimate meaningful from the first field: an unanswered screen says
   * the lifter is up now, which is the safe direction to be wrong in and is also
   * literally what "I know nothing about this meet" should mean to somebody
   * standing next to the platform.
   */
  #renderEstimate(estimate: PlatformEstimate | null): TemplateResult | typeof nothing {
    if (estimate === null) return nothing;
    return html`
      <div class="estimate">
        <p class="figure">${platformEstimateText(estimate)}</p>
        <p>${attemptsBeforeText(estimate)}</p>
        <p>${MEET_STAFF_ARE_AUTHORITATIVE}</p>
        ${this.#renderAdvisories(estimate.advisories)}
      </div>
    `;
  }

  #renderTimeline(
    result: MeetWarmupResultView | null,
    schedule: MeetWarmupSchedule | null,
  ): TemplateResult | typeof nothing {
    if (result === null) {
      return html`<section>
        <h4>${WARMUP_TIMELINE_HEADING}</h4>
        <p>${WARMUP_NEEDS_AN_OPENER}</p>
      </section>`;
    }
    if (schedule === null) {
      // Every problem at once, the way the domain collects them: a screen that
      // reports one at a time makes the lifter fix, look again, and discover
      // the next one, which is §7.4's rule arriving somewhere with a clock on
      // it. Deduplicated because two codes can share a sentence.
      const said = [
        ...new Set(
          (result.ok ? [] : result.problems).map((problem) => warmupProblemSentence(problem.code)),
        ),
      ];
      return html`<section>
        <h4>${WARMUP_TIMELINE_HEADING}</h4>
        ${said.map((sentence) => html`<ptk-notice tone="error">${sentence}</ptk-notice>`)}
      </section>`;
    }
    return html`
      <section>
        <h4>${WARMUP_TIMELINE_HEADING}</h4>
        <ol class="timeline">
          ${schedule.items.map((item) => this.#renderItem(schedule, item))}
        </ol>
        ${
          schedule.delay === null
            ? nothing
            : html`<ptk-notice tone="error">${schedule.delay.message}</ptk-notice>`
        }
        ${this.#renderAdvisories(schedule.advisories)}
      </section>
    `;
  }

  /**
   * One line of the timeline.
   *
   * The weight is on the row rather than only in the sets fold, because the fold
   * is shut by default and a ramp with no numbers on it is a list of times. It
   * is formatted in the room's plate unit, which is not necessarily the unit the
   * rest of the meet document is in -- a lifter can perfectly well plan in pounds
   * and warm up on a kilogram bar, and printing the ramp in the document's unit
   * would have them hunting for a 102.5 that is not painted on anything.
   *
   * The attempt itself is one of these rows and is not appended separately.
   * `MeetWarmupSchedule.items` is documented as "earliest first, ending with the
   * platform attempt", and the first version of this element rendered the ramp
   * from `items` and then drew the platform again from `schedule.platform` --
   * two identical last rows saying the lifter is called twice. `platform` is
   * the estimate carried along so a screen can cite it, not a row.
   */
  #renderItem(schedule: MeetWarmupSchedule, item: ScheduledItem): TemplateResult {
    const set =
      item.warmupIndex === null ? null : (schedule.plan.warmups[item.warmupIndex] ?? null);
    const unit = schedule.plan.setup.plateUnit;
    return html`
      <li class="item ${item.kind === 'platform' ? 'platform' : ''}">
        <span class="what">
          ${warmupItemLabel(item.kind, this.#ordinalOf(schedule, item.warmupIndex), item.equipmentId)}
          ${
            set === null
              ? nothing
              : html`&middot; ${formatWeight({ amount: set.loading.total, unit })} &times;
                ${String(set.reps)}`
          }
        </span>
        <span class="when"
          >${warmupStartText(item.startsInSeconds.earliestSeconds, item.startsInSeconds.latestSeconds)}</span
        >
      </li>
    `;
  }

  /**
   * Tool 2's numbering, which counts only the sets a lifter can move.
   *
   * `null` for the bar-only sets, which are not numbered in either tool. Doing
   * this here rather than in `copy.ts` keeps the copy function a pure mapping
   * from a number to a phrase; doing it in the domain would put a presentation
   * ordinal on a plan two other consumers read.
   */
  #ordinalOf(schedule: MeetWarmupSchedule, index: number | null): number | null {
    if (index === null) return null;
    const set = schedule.plan.warmups[index];
    if (set === undefined || !isAdjustable(set)) return null;
    return schedule.plan.warmups.slice(0, index + 1).filter(isAdjustable).length;
  }

  #renderAdvisories(
    advisories: readonly (TimingAdvisory | MeetWarmupAdvisory)[],
  ): TemplateResult | typeof nothing {
    // The authority sentence is already under the estimate in full; repeating it
    // as an advisory would put it on the screen twice, which is how a rule that
    // matters starts reading as boilerplate.
    const shown = advisories.filter((advisory) => advisory.code !== 'meet-staff-are-authoritative');
    if (shown.length === 0) return nothing;
    return html`
      <div class="advisories">
        ${shown.map(
          (advisory) =>
            html`<ptk-notice tone=${advisory.severity === 'caution' ? 'error' : 'info'}
              >${advisory.message}</ptk-notice
            >`,
        )}
      </div>
    `;
  }

  /**
   * §20.1's position questions, with only the pair the answer above needs.
   *
   * Both pairs on screen at once was the first version and is worse than it
   * looks: four number fields, two of which are meaningless under the current
   * answer, on a screen whose whole difficulty is that every field is optional.
   * The values under the hidden pair are kept (`warmup.ts` stores the
   * discriminant, not the union), so flipping back does not lose them.
   */
  #renderPlace(): TemplateResult {
    const progress = this.state.progress;
    const own = progress.place === 'own-flight-running';
    return html`
      <section>
        <h4>${WARMUP_PLACE_HEADING}</h4>
        <ptk-segmented
          data-field=${PLACE_FIELD}
          label=${WARMUP_PLACE_LABEL}
          .choices=${WARMUP_PLACE_CHOICES}
          value=${progress.place}
        ></ptk-segmented>
        <div class="fields">
          ${
            own
              ? html`
                  ${this.#progressField('currentRound', WARMUP_CURRENT_ROUND_LABEL)}
                  ${this.#progressField(
                    'currentPosition',
                    WARMUP_CURRENT_POSITION_LABEL,
                    WARMUP_CURRENT_POSITION_HINT,
                  )}
                `
              : html`
                  ${this.#progressField(
                    'attemptsLeftInTheRunningFlight',
                    WARMUP_ATTEMPTS_LEFT_LABEL,
                    WARMUP_ATTEMPTS_LEFT_HINT,
                  )}
                  ${this.#progressField('wholeFlightsBetween', WARMUP_FLIGHTS_BETWEEN_LABEL)}
                `
          }
          ${this.#progressField('flightSize', WARMUP_FLIGHT_SIZE_LABEL)}
          ${this.#progressField('targetRound', WARMUP_TARGET_ROUND_LABEL)}
          ${this.#progressField(
            'targetPosition',
            WARMUP_TARGET_POSITION_LABEL,
            WARMUP_TARGET_POSITION_HINT,
          )}
        </div>
      </section>
    `;
  }

  #renderPace(): TemplateResult {
    const progress = this.state.progress;
    return html`
      <section>
        <h4>${WARMUP_PACE_HEADING}</h4>
        <p>${warmupPaceText(paceFor(progress))}</p>
        <div class="fields">
          ${this.#progressField('attemptsCompleted', WARMUP_ATTEMPTS_DONE_LABEL)}
          ${this.#progressField(
            'minutesSinceSessionStart',
            WARMUP_ELAPSED_LABEL,
            WARMUP_ELAPSED_HINT,
          )}
          ${this.#progressField('breakMinutes', WARMUP_BREAK_LABEL)}
          ${this.#progressField('delayMinutes', WARMUP_DELAY_LABEL)}
        </div>
      </section>
    `;
  }

  /**
   * §20's per-set weights and repetitions, behind a fold.
   *
   * Behind a fold because most lifters take the ramp as calculated -- that is
   * what the calculator is for -- and two number fields per set is the tallest
   * thing on this screen. The summary says whose figures are above it, which is
   * §5.8's rule for a disclosure and matters more here than usual: the ramp is
   * rebuilt on every keystroke elsewhere on the screen, so a lifter can easily
   * be looking at their own week-old figures under a fresh estimate.
   */
  #renderSets(schedule: MeetWarmupSchedule | null): TemplateResult | typeof nothing {
    if (schedule === null) return nothing;
    const rows = schedule.plan.warmups
      .map((set, index) => ({ set, index }))
      .filter((row) => isAdjustable(row.set));
    if (rows.length === 0) return nothing;
    const changed = this.state.weights.length + this.state.reps.length;
    return html`
      <ptk-disclosure
        label=${WARMUP_SETS_HEADING}
        summary=${warmupSetsSummary(changed, rows.length * 2)}
      >
        ${rows.map((row, ordinal) => this.#renderSetRow(schedule, row.set, row.index, ordinal + 1))}
        ${
          hasSetAnswers(this.state)
            ? html`<ptk-button variant="secondary" @click=${this.#onResetSets}
                >${WARMUP_RESET_SETS_LABEL}</ptk-button
              >`
            : nothing
        }
      </ptk-disclosure>
    `;
  }

  #renderSetRow(
    schedule: MeetWarmupSchedule,
    set: WarmupSet,
    index: number,
    ordinal: number,
  ): TemplateResult {
    const unit = schedule.plan.setup.plateUnit;
    return html`
      <div class="set-row">
        <h4>${warmupItemLabel('warm-up-set', ordinal, null)}</h4>
        <div class="fields">
          <ptk-number-field
            data-field=${SET_WEIGHT_FIELD}
            data-index=${String(index)}
            label=${WARMUP_SET_WEIGHT_LABEL}
            unit=${unit}
            placeholder=${formatWeight({ amount: set.loading.total, unit })}
            value=${setAnswerFor(this.state.weights, index)}
          ></ptk-number-field>
          <ptk-number-field
            data-field=${SET_REPS_FIELD}
            data-index=${String(index)}
            label=${WARMUP_SET_REPS_LABEL}
            placeholder=${String(set.reps)}
            value=${setAnswerFor(this.state.reps, index)}
          ></ptk-number-field>
        </div>
      </div>
    `;
  }

  #renderPreferences(): TemplateResult {
    const preferences = this.state.preferences;
    return html`
      <ptk-disclosure label=${WARMUP_PREFERENCES_HEADING} summary=${WARMUP_LEAD_HINT}>
        <div class="fields">
          ${this.#preferenceField('leadMinimumMinutes', WARMUP_LEAD_MINIMUM_LABEL, WARMUP_LEAD_UNIT)}
          ${this.#preferenceField('leadMaximumMinutes', WARMUP_LEAD_MAXIMUM_LABEL, WARMUP_LEAD_UNIT)}
          ${this.#preferenceField('restSeconds', WARMUP_REST_LABEL, 'seconds')}
          ${this.#preferenceField('setSeconds', WARMUP_SET_SECONDS_LABEL, 'seconds')}
          ${this.#preferenceField(
            'maximumSets',
            WARMUP_MAXIMUM_SETS_LABEL,
            '',
            WARMUP_MAXIMUM_SETS_HINT,
          )}
          ${this.#preferenceField(
            'sharedRackLifters',
            WARMUP_SHARED_RACK_LABEL,
            '',
            WARMUP_SHARED_RACK_HINT,
          )}
        </div>
        <ptk-segmented
          data-field=${DELAY_PREFERENCE_FIELD}
          label=${WARMUP_DELAY_PREFERENCE_LABEL}
          .choices=${WARMUP_DELAY_CHOICES}
          value=${preferences.delayPreference}
        ></ptk-segmented>
        <h4>${WARMUP_PREP_HEADING}</h4>
        ${prepKindsFor(this.format).map((kind) => this.#renderPrepRow(kind))}
      </ptk-disclosure>
    `;
  }

  /**
   * One preparation: how long, and which side of the ramp.
   *
   * The side is asked on every row rather than only on the rows where it is in
   * doubt. `warmup.ts` proposes a side per kind and every one of those proposals
   * is a claim about somebody else's routine -- a lifter who wraps early or gets
   * into a suit late is not doing it wrong, and a control that appeared only for
   * the kinds this tool is unsure about would tell them they are.
   */
  #renderPrepRow(kind: PrepKind): TemplateResult {
    const answer = this.state.preferences.prep[kind];
    return html`
      <div class="prep-row">
        <ptk-number-field
          data-field=${PREP_MINUTES_FIELD}
          data-prep=${kind}
          label=${`${warmupPrepLabel(kind)} — ${WARMUP_PREP_MINUTES_LABEL.toLowerCase()}`}
          value=${answer.minutes}
        ></ptk-number-field>
        ${
          answer.minutes.trim() === ''
            ? nothing
            : html`<ptk-segmented
                data-field=${PREP_WHEN_FIELD}
                data-prep=${kind}
                label=${`${warmupPrepLabel(kind)} — when`}
                hide-label
                .choices=${WARMUP_PREP_WHEN_CHOICES}
                value=${answer.when}
              ></ptk-segmented>`
        }
      </div>
    `;
  }

  #renderRoom(): TemplateResult {
    return html`
      <section>
        <h4>${WARMUP_ROOM_HEADING}</h4>
        <ptk-equipment-setup .equipment=${this.state.room}></ptk-equipment-setup>
      </section>
    `;
  }

  #progressField(field: ProgressField, label: string, hint = ''): TemplateResult {
    return html`
      <ptk-number-field
        data-field=${field}
        label=${label}
        hint=${hint}
        value=${this.state.progress[field]}
      ></ptk-number-field>
    `;
  }

  #preferenceField(field: PreferenceField, label: string, unit = '', hint = ''): TemplateResult {
    return html`
      <ptk-number-field
        data-field=${field}
        label=${label}
        unit=${unit}
        hint=${hint}
        value=${this.state.preferences[field]}
      ></ptk-number-field>
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber as EventListener);
    this.addEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented as EventListener);
    this.addEventListener(EQUIPMENT_CHANGE_EVENT, this.#onEquipment as EventListener);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber as EventListener);
    this.removeEventListener(SEGMENTED_CHANGE_EVENT, this.#onSegmented as EventListener);
    this.removeEventListener(EQUIPMENT_CHANGE_EVENT, this.#onEquipment as EventListener);
    super.disconnectedCallback();
  }

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = attributeOf(event, 'field');
    if (field === null) return;
    const value = event.detail.value;

    if (field === PREP_MINUTES_FIELD) {
      const kind = prepOf(event);
      if (kind !== null) this.#emit(withPrep(this.state, kind, { minutes: value }));
      return;
    }
    if (field === SET_WEIGHT_FIELD || field === SET_REPS_FIELD) {
      const index = indexOf(event);
      if (index === null) return;
      this.#emit(
        field === SET_WEIGHT_FIELD
          ? withSetWeight(this.state, index, value)
          : withSetReps(this.state, index, value),
      );
      return;
    }
    // Narrowed against the two lists rather than cast. The names come off
    // controls this element rendered, but they arrive as strings out of the DOM
    // and both targets are objects §24 saves -- a key nothing produced would
    // travel to the next device inside a document the schema then refuses.
    if (isProgressField(field)) {
      this.#emit(withProgress(this.state, { [field]: value }));
      return;
    }
    if (isPreferenceField(field)) {
      this.#emit(withPreferences(this.state, { [field]: value }));
    }
  };

  readonly #onSegmented = (event: CustomEvent<SegmentedChangeDetail>): void => {
    const field = attributeOf(event, 'field');
    const value = event.detail.value;
    if (field === PLACE_FIELD) {
      this.#emit(withProgress(this.state, { place: meetPlaceFromValue(value) }));
      return;
    }
    if (field === DELAY_PREFERENCE_FIELD) {
      this.#emit(withPreferences(this.state, { delayPreference: delayPreferenceFromValue(value) }));
      return;
    }
    if (field === PREP_WHEN_FIELD) {
      const kind = prepOf(event);
      if (kind !== null) this.#emit(withPrep(this.state, kind, { when: prepWhenFromValue(value) }));
    }
  };

  readonly #onEquipment = (event: CustomEvent<EquipmentChangeDetail>): void => {
    this.#emit(withRoom(this.state, event.detail.equipment));
  };

  readonly #onResetSets = (): void => {
    this.#emit(withCalculatedSets(this.state));
  };

  /**
   * Hands the new answers up and renders nothing itself.
   *
   * The property is not written here. The caller owns the state and is the only
   * thing that can save it (§24.1), and an element that also wrote its own
   * property would paint the new ramp a frame before the caller agreed to it --
   * which on the coach board is a ramp for a lifter whose screen has since been
   * closed.
   */
  #emit(state: MeetWarmupState): void {
    this.dispatchEvent(
      new CustomEvent<MeetWarmupChangeDetail>(MEET_WARMUP_CHANGE_EVENT, {
        detail: { state },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * §5.8: a host whose children are LitElements is not complete when it says so.
   *
   * Every reading on this screen is inside a child -- the timeline is the only
   * plain markup on it, and the estimate above it is three paragraphs. Without
   * the await, a test asserting on a number field's value or on a notice's
   * sentence passes or fails on timing. Recorded as a documented survivor in
   * §§13.6-13.9 and 13.14 for the same reason it is recorded here: no assertion
   * in this directory has ever been able to distinguish it.
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

function isProgressField(field: string): field is ProgressField {
  return Object.hasOwn(PROGRESS_FIELDS, field);
}

function isPreferenceField(field: string): field is PreferenceField {
  return Object.hasOwn(PREFERENCE_FIELDS, field);
}

const PREP_ATTRIBUTE = 'prep';

function prepOf(event: Event): PrepKind | null {
  const value = attributeOf(event, PREP_ATTRIBUTE);
  if (value === null) return null;
  return isPrepKind(value) ? value : null;
}

const PREP_KIND_SET: ReadonlySet<string> = new Set<string>(PREP_KINDS);

function isPrepKind(value: string): value is PrepKind {
  return PREP_KIND_SET.has(value);
}

function indexOf(event: Event): number | null {
  const value = attributeOf(event, 'index');
  if (value === null) return null;
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
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
    'ptk-meet-warmup': PtkMeetWarmup;
  }

  interface HTMLElementEventMap {
    [MEET_WARMUP_CHANGE_EVENT]: CustomEvent<MeetWarmupChangeDetail>;
  }
}
