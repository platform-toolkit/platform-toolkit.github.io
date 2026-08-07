// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rest between sets, on screen. Section 7.11.
 *
 * Holds no timer of its own. `core/rest.ts` owns what a rest *is* and this owns what it
 * looks like, which here means two things and nothing else: turning what is left into
 * `m:ss`, and saying which control was pressed. The root applies the press, the same way
 * every other screen in this package hands up a named change rather than a new value.
 *
 * WHY THE DISPLAY IS COMPUTED AND NEVER COUNTED DOWN
 *
 * The interval below repaints; it does not subtract. Every paint asks {@link now} what
 * time it is and asks the core what that leaves. A phone in a pocket has its tab
 * throttled to one tick a second, then one a minute, then none at all -- so a display
 * driven by counting ticks comes back wrong by however long the lifter was away, and
 * wrong in the direction that sends them back to the bar early. Computed, a missed tick
 * costs a stale paint that the next one corrects, and the number after a four-minute
 * pocket is the right one.
 *
 * That is also why the interval is faster than the thing it draws. Four samples a second
 * against a display in whole seconds means a second boundary is never straddled by a
 * missed paint, and `secondsLeft` only changes once a second, so the extra samples cost
 * nothing: Lit skips an update that assigns the value already there. `apps/web/src/clock.ts`
 * reached the same number for the same reason.
 *
 * WHAT IS ANNOUNCED AND WHAT IS NOT
 *
 * One live region, holding one sentence: the rest is up. The digits are not in it. A
 * countdown in a live region announces itself once a second, over the top of everything
 * else the device is saying, for three minutes -- which is not an accessible timer, it
 * is a reason to turn the tool off. The spoken form of the digits is rendered beside
 * them and hidden from sight, so a reader that navigates here is told "forty-five
 * seconds left" instead of "zero colon forty five", and is told it only when it asks.
 */

import type { SelectOption } from '@platform-toolkit/ui';
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { REST_STEP_SECONDS, restRemainingMillis, type RestTimer } from '../core/rest.js';
import type { Instant } from '../types.js';

import { REST_NOTES, formatRest, formatRestSpoken } from './copy.js';
import { REST_LIFT_DURATION_FIELD, actionOf } from './dataset.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const REST_TIMER_TAG = 'ptk-rest-timer';

/**
 * A control the lifter pressed on the rest timer.
 *
 * Named rather than applied, like `SET_PLAN_EVENT` next door. The timer is state the
 * root owns -- it has to be, or a lifter who opens an exercise's history mid-rest loses
 * the rest -- and an element that computed the next timer would be a second place that
 * knows what pause means.
 */
export const REST_ACTION_EVENT = 'ptk-rest-action';

/** The six section 7.11 asks for, with resume as pause's other half. */
export type RestAction = 'pause' | 'resume' | 'extend' | 'shorten' | 'reset' | 'dismiss';

export interface RestActionDetail {
  readonly action: RestAction;
}

/**
 * The lift a rest belongs to, where the lifter may say how long it should be.
 *
 * Section 7.11's exercise-specific duration, offered on the band because the band is
 * where a lifter is standing when they find out the rest is wrong. The alternative
 * homes are all worse: the exercise library holds only the movements a lifter invented,
 * so the big lifts -- the ones that want five minutes -- could never get an entry, and a
 * list of every exercise in the settings is a screen nobody would open twice.
 *
 * Handed down whole and nullable, so this element decides nothing about when to offer
 * it. Only the root knows which lift the running rest came from and what the settings
 * currently say, and `options` is the root's preset list rather than one invented here
 * -- two lists of the rests worth offering is how they come apart.
 *
 * The picker is deliberately not the same press as `+30s`. A step is about today and
 * leaves the configured length alone; this changes what a rest after this lift *is*.
 */
export interface RestLift {
  /** As it read on the day, which is what the session snapshotted. */
  readonly name: string;
  /** What the settings say this lift rests for now, in seconds. */
  readonly seconds: number;
  readonly options: readonly SelectOption[];
}

/**
 * How often the display is recomputed, in milliseconds.
 *
 * Four times the rate of the thing it shows. See the note at the top of the file: this
 * is a sampling rate and not a tick, and nothing here subtracts it from anything.
 */
const REST_TICK_MS = 250;

const PAUSE_ACTION: RestAction = 'pause';
const RESUME_ACTION: RestAction = 'resume';
const EXTEND_ACTION: RestAction = 'extend';
const SHORTEN_ACTION: RestAction = 'shorten';
const RESET_ACTION: RestAction = 'reset';
const DISMISS_ACTION: RestAction = 'dismiss';

const ACTIONS: readonly RestAction[] = [
  PAUSE_ACTION,
  RESUME_ACTION,
  EXTEND_ACTION,
  SHORTEN_ACTION,
  RESET_ACTION,
  DISMISS_ACTION,
];

function isRestAction(value: string): value is RestAction {
  return (ACTIONS as readonly string[]).includes(value);
}

export class PtkRestTimer extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    /*
     * A band rather than a card, because this sits above whichever screen the lifter is
     * on and has to read as part of the tool rather than as something that landed on top
     * of it. Nothing here is fixed or sticky: a bar that follows the page down covers a
     * set row on a 320px handset, which is the one row that must stay tappable.
     */
    .rest {
      display: grid;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-sm);
      margin-bottom: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background: var(--ptk-color-surface);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--ptk-space-xs) var(--ptk-space-sm);
    }

    h2 {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
      font-weight: 400;
    }

    /*
     * Tabular figures, or the whole line shifts left and right as the digits change
     * width -- three minutes of a number that will not sit still, at arm's length.
     */
    .clock {
      margin: 0;
      font-size: var(--ptk-font-size-xl);
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }

    .state {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-xs);
    }

    /*
     * Under the controls and separated from them, because it is the one thing here that
     * outlives the rest on screen. A picker sitting in the button row would be read as a
     * seventh control over the next three minutes.
     */
    .duration {
      padding-top: var(--ptk-space-xs);
      border-top: 1px solid var(--ptk-color-border);
    }

    .duration .note {
      margin: var(--ptk-space-xs) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * The usual clip rectangle rather than display:none, which would take the text out
     * of the accessibility tree along with the pixels -- and the text is the entire
     * reason it exists.
     */
    .spoken {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `;

  /** The rest to draw, or `null` for no rest at all -- which draws nothing. */
  @property({ attribute: false }) timer: RestTimer | null = null;

  /**
   * The lift to offer a stored duration for, or `null` to offer none. See {@link RestLift}.
   *
   * `null` is the ordinary case for a consumer mounting this on its own, and it is also
   * what the root hands down for a rest whose lift it could not identify -- a picker
   * that would write a preference against nothing is worse than no picker.
   */
  @property({ attribute: false }) lift: RestLift | null = null;

  /**
   * What time it is.
   *
   * Supplied by the root, like everywhere else in this package. The default is here so
   * an element mounted alone in a story is not a blank box; nothing in the tool uses it.
   */
  @property({ attribute: false }) now: () => Instant = () => new Date().toISOString();

  /**
   * Whole seconds left, which is what the display is a function of.
   *
   * State and not a getter, so that a repaint is a Lit update and Lit gets to skip the
   * three samples a second that land on the same number.
   */
  @state() private secondsLeft = 0;

  #interval: ReturnType<typeof setInterval> | null = null;

  /**
   * A tab coming back to the front repaints immediately rather than on the next tick.
   *
   * Without it the first thing a lifter sees on unlocking the phone is the number from
   * whenever the browser last let the interval run, which on a throttled tab can be a
   * minute stale -- and it is stale in the reassuring direction, so it does not look
   * wrong.
   */
  readonly #onVisibility = (): void => {
    this.#repaint();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#repaint();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#stop();
  }

  /**
   * A timer that has just arrived is measured before it is drawn.
   *
   * Not left to the interval. `#sync` only starts one when there is time left to count,
   * and `secondsLeft` is whatever the last timer left behind -- so a rest started while
   * the previous one was up would be measured at zero, refuse to start ticking, and sit
   * there reading 0:00 with a full three minutes on it.
   */
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('timer')) this.#repaint();
  }

  protected override updated(): void {
    // After the render rather than before it, because whether the interval should be
    // running is decided by the timer that was just drawn. Starting one in `willUpdate`
    // would leave a stopped timer ticking for one more frame -- harmless, and the kind
    // of harmless that is indistinguishable from the bug it hides.
    this.#sync();
  }

  override render(): TemplateResult | typeof nothing {
    const timer = this.timer;
    if (timer === null) return nothing;

    const millis = this.secondsLeft * 1000;
    const up = this.secondsLeft === 0;
    const paused = timer.kind === 'paused';

    return html`
      <section class="rest" aria-label=${REST_NOTES.label}>
        <div class="head">
          <h2>${REST_NOTES.heading}</h2>
          <!--
            Always rendered, empty while the rest is simply running, and the only live
            region on the screen. A region created at the moment its sentence appears is
            announced by roughly half the engines and by none of them reliably, so the
            paragraph has to already be there -- and sitting in the heading row, an empty
            one costs no height.
          -->
          <p class="state" aria-live="polite">
            ${up ? REST_NOTES.up : paused ? REST_NOTES.paused : ''}
          </p>
        </div>
        <p class="clock">
          <span aria-hidden="true">${formatRest(millis)}</span>
          <span class="spoken">${formatRestSpoken(millis)}</span>
        </p>
        <div class="actions" @click=${this.#onPress}>
          ${up ? nothing : this.#control(paused ? RESUME_ACTION : PAUSE_ACTION)}
          ${this.#control(SHORTEN_ACTION)} ${this.#control(EXTEND_ACTION)}
          ${this.#control(RESET_ACTION)} ${this.#control(DISMISS_ACTION)}
        </div>
        ${this.#duration()}
      </section>
    `;
  }

  /**
   * The stored rest for this lift, where there is a lift to store one against.
   *
   * No event of its own: the select's own change bubbles, and `data-field` says which
   * of the tool's three pickers it came from. Every other named change in this element
   * goes up as an action because there is no control that already carries a value; this
   * one has one, and inventing a second event to repeat it is how the two get to
   * disagree about what was chosen.
   */
  #duration(): TemplateResult | typeof nothing {
    const lift = this.lift;
    // An empty list is a root that has nothing to offer, not a picker with no options:
    // section 0.4 forbids a control that stands in for a feature without providing it.
    if (lift === null || lift.options.length === 0) return nothing;
    return html`
      <div class="duration" data-field=${REST_LIFT_DURATION_FIELD}>
        <ptk-select
          label=${REST_NOTES.liftDurationLabel(lift.name)}
          .options=${lift.options}
          .value=${String(lift.seconds)}
        ></ptk-select>
        <p class="note">${REST_NOTES.liftDurationNote}</p>
      </div>
    `;
  }

  #control(action: RestAction): TemplateResult {
    switch (action) {
      case 'pause':
        return html`<ptk-button variant="quiet" data-action=${action}
          >${REST_NOTES.pause}</ptk-button
        >`;
      case 'resume':
        return html`<ptk-button variant="primary" data-action=${action}
          >${REST_NOTES.resume}</ptk-button
        >`;
      case 'shorten':
        // The sign is the label and the sentence is the accessible name. "-30s" is a
        // button a sighted lifter reads in a glance and a screen reader reads as "minus
        // thirty s", which is not a thing anybody would press on purpose.
        return html`<ptk-button
          variant="quiet"
          data-action=${action}
          accessible-name=${REST_NOTES.shortenName(REST_STEP_SECONDS)}
          >${REST_NOTES.shorten(REST_STEP_SECONDS)}</ptk-button
        >`;
      case 'extend':
        return html`<ptk-button
          variant="quiet"
          data-action=${action}
          accessible-name=${REST_NOTES.extendName(REST_STEP_SECONDS)}
          >${REST_NOTES.extend(REST_STEP_SECONDS)}</ptk-button
        >`;
      case 'reset':
        return html`<ptk-button variant="quiet" data-action=${action}
          >${REST_NOTES.reset}</ptk-button
        >`;
      case 'dismiss':
        return html`<ptk-button variant="secondary" data-action=${action}
          >${REST_NOTES.dismiss}</ptk-button
        >`;
    }
  }

  readonly #onPress = (event: Event): void => {
    const action = actionOf(event);
    if (action === null || !isRestAction(action)) return;
    this.dispatchEvent(
      new CustomEvent<RestActionDetail>(REST_ACTION_EVENT, {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /** Ticking exactly when there is something left to tick towards. */
  #sync(): void {
    const timer = this.timer;
    const wanted = timer !== null && timer.kind === 'running' && this.secondsLeft > 0;
    if (wanted === (this.#interval !== null)) return;
    if (wanted) {
      this.#interval = setInterval(() => {
        this.#repaint();
      }, REST_TICK_MS);
      return;
    }
    this.#stop();
  }

  #repaint(): void {
    const timer = this.timer;
    this.secondsLeft =
      timer === null ? 0 : Math.ceil(restRemainingMillis(timer, this.now()) / 1000);
  }

  #stop(): void {
    if (this.#interval === null) return;
    clearInterval(this.#interval);
    this.#interval = null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [REST_TIMER_TAG]: PtkRestTimer;
  }

  interface HTMLElementEventMap {
    [REST_ACTION_EVENT]: CustomEvent<RestActionDetail>;
  }
}
