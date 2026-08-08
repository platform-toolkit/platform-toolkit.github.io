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
 * The digits are not in a live region. A countdown in one announces itself once a
 * second, over the top of everything else the device is saying, for three minutes --
 * which is not an accessible timer, it is a reason to turn the tool off. The spoken
 * form of the digits is rendered beside them and hidden from sight, so a reader that
 * navigates here is told "forty-five seconds left" instead of "zero colon forty five",
 * and is told it only when it asks.
 *
 * Two regions do speak, and they are two rather than one because they say unrelated
 * things at the same moment: the rest is up, and an alert the lifter switched on did
 * not happen. Sharing a region would mean the second sentence replacing the first --
 * the one thing worth interrupting for -- with an apology about a tone.
 *
 * WHAT HAPPENS WHEN AN ALERT CANNOT
 *
 * Every failure this element can detect is said on screen, and the switch that caused
 * it goes back off. See `rest-alert.ts` for what can be detected and what cannot.
 */

import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-select';
import '@platform-toolkit/ui/ptk-toggle-group';
import type { Choice } from '@platform-toolkit/ui/ptk-choice-group';
import type { SelectOption } from '@platform-toolkit/ui/ptk-select';
import {
  TOGGLE_GROUP_CHANGE_EVENT,
  type ToggleGroupChangeDetail,
} from '@platform-toolkit/ui/ptk-toggle-group';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { REST_STEP_SECONDS, restRemainingMillis, type RestTimer } from '../core/rest.js';
import type { Instant, RestAlertChannel, RestAlertSettings } from '../types.js';

import { REST_NOTES, formatRest, formatRestSpoken } from './copy.js';
import { REST_LIFT_DURATION_FIELD, actionOf } from './dataset.js';
import {
  defaultRestAlerter,
  withChannel,
  type RestAlerter,
  type RestAlertTrouble,
} from './rest-alert.js';

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
 * The alert channels the lifter turned on or off, as the whole set.
 *
 * A second event rather than a seventh action, because this one carries a value and
 * the six do not -- the same division `#duration` explains below. The whole set travels
 * so the root writes what it was handed instead of applying a delta to a copy of the
 * settings it may have already replaced.
 *
 * Dispatched only after the channel has been proved to work. A refusal changes nothing
 * and is reported on the band; see {@link PtkRestTimer.alerts}.
 */
export const REST_ALERTS_EVENT = 'ptk-rest-alerts';

export interface RestAlertsDetail {
  readonly alerts: RestAlertSettings;
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

const ALERT_CHANNELS: readonly RestAlertChannel[] = ['sound', 'vibrate', 'notify'];

function isRestAlertChannel(value: string): value is RestAlertChannel {
  return (ALERT_CHANNELS as readonly string[]).includes(value);
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
     * No border of its own, unlike the duration picker: two rules across a band this
     * short reads as three stacked cards. The disclosure draws its own edge.
     */
    .alerts {
      padding-top: var(--ptk-space-xs);
    }

    /*
     * Empty for nearly all of its life and it must cost nothing when it is, which rules
     * out both obvious ways of hiding it: display:none would take the sentence out of
     * the accessibility tree along with the pixels, and :empty does not match a
     * paragraph holding the whitespace a formatted template leaves behind. A grid with
     * no rows is already zero high, so neither is needed.
     *
     * Full-strength text and not the muted grey the other notes use. This is the one
     * thing on the band that is a fault, and it is read at arm's length.
     */
    .trouble {
      display: grid;
      gap: var(--ptk-space-xs);
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text);
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
   * Which alerts are on, or `null` to offer none. Section 7.11.
   *
   * `null` for the same reason {@link lift} is: a consumer mounting this alone has
   * nowhere to store an answer, and switches whose answer is thrown away are worse than
   * no switches. The root hands down what came out of storage, normalised, so the three
   * are booleans here and never `undefined`.
   *
   * Held by the root and never written here. What this element does own is the *proof*:
   * a channel is dispatched only once it has demonstrably worked, so the settings record
   * cannot come to hold an alert that this device refuses to give.
   */
  @property({ attribute: false }) alerts: RestAlertSettings | null = null;

  /**
   * How this device makes a noise, buzzes, and notifies.
   *
   * Supplied like {@link now}, and defaulted for the same reason -- except that the
   * default is shared across every instance rather than made per element, because the
   * audio context behind it is a resource a page has few of. See `rest-alert.ts`.
   */
  @property({ attribute: false }) alerter: RestAlerter = defaultRestAlerter();

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

  /**
   * The channels that did not do what they offered to do, and why. Empty is the norm.
   *
   * Replaced wholesale when the rest is up and per channel at a press, so a fault that
   * has stopped being true stops being on screen.
   */
  @state() private trouble: readonly RestAlertTrouble[] = [];

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
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onAlert);
    this.#repaint();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onAlert);
    this.#stop();
  }

  /**
   * Waits for the children, so a caller awaiting this one is not reading last render.
   *
   * The rule this package keeps tripping over: a child's `updateComplete` is not the
   * host's. **Provably inert today** -- emptying the list below leaves all 34 cases in
   * `ptk-rest-timer.browser.test.ts` green, because the switches settle within the
   * microtasks an `await` on this promise drains anyway. It stays because that is
   * timing rather than a guarantee, and the day it shifts the symptom is an assertion
   * against the previous render in a case that has passed for months. Do not delete it
   * on the strength of a green run.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const done = await super.getUpdateComplete();
    const children = this.renderRoot.querySelectorAll('*');
    await Promise.all(
      [...children].filter((node) => node instanceof LitElement).map((node) => node.updateComplete),
    );
    return done;
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
        ${this.#alertSwitches()}
        <!--
          Outside the disclosure above and unconditional, which are the same requirement
          twice. A sentence saying an alert did not happen is no use folded away, and a
          region that appears along with its first sentence is announced by roughly half
          the engines -- so this paragraph exists, empty, from the band's first paint,
          whether or not there is an alert control above it.
        -->
        <p class="trouble" aria-live="polite">
          ${this.trouble.map(
            (trouble) =>
              html`<span>${REST_NOTES.alertTrouble[trouble.channel][trouble.failure]}</span>`,
          )}
        </p>
        ${this.#duration()}
      </section>
    `;
  }

  /**
   * The three ways of being told, where there is somewhere to store the answer.
   *
   * On the band rather than in the settings, and for {@link RestLift}'s reason rather
   * than for want of a screen: a lifter finds out the timer is not loud enough while
   * standing at a rack with the timer in front of them, and a preference two screens
   * away is one they set after the session they needed it in.
   *
   * Only the channels this device has. See `rest-alert.ts` on why an unsupported one is
   * absent rather than disabled.
   */
  #alertSwitches(): TemplateResult | typeof nothing {
    const alerts = this.alerts;
    const channels = this.alerter.channels;
    if (alerts === null || channels.length === 0) return nothing;

    const choices: readonly Choice[] = channels.map((channel) => ({
      value: channel,
      ...REST_NOTES.alertOption[channel],
    }));

    /*
     * Derived here rather than held as state, and that is what unticks a refused switch.
     * `ptk-toggle-group` ticks its own box before this element hears about it, so the
     * band has to be able to overrule it -- and it does, because lit re-commits an
     * object-valued binding on every render whatever it last committed. Every path
     * through `#onAlert` reassigns `trouble`, so a refusal always redraws, and the
     * redraw puts the box back where the settings say. A mirrored `@state` was tried
     * and is exactly equivalent: it was one more thing to keep in step with `alerts`,
     * for a mechanism that was never the one doing the work.
     */
    const ticked = channels.filter((channel) => alerts[channel]);

    return html`
      <div class="alerts">
        <ptk-disclosure label=${REST_NOTES.alertsLabel}>
          <ptk-toggle-group
            layout="list"
            label=${REST_NOTES.alertsLegend}
            .choices=${choices}
            .values=${ticked}
          ></ptk-toggle-group>
        </ptk-disclosure>
      </div>
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

  /**
   * A box ticked or unticked, which is a request and not yet a decision.
   *
   * Stopped here rather than left to bubble. It is `composed`, so it would otherwise
   * reach the root, where two other screens listen for the same event -- and the detail
   * carries a bare string that means a plate denomination on one of them.
   */
  readonly #onAlert = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    event.stopPropagation();
    const alerts = this.alerts;
    const channel = event.detail.value;
    if (alerts === null || !isRestAlertChannel(channel)) return;

    if (!event.detail.selected) {
      // Off needs no proof and no permission. It is applied as it is pressed, and it
      // clears whatever this channel was complaining about -- a sentence about an alert
      // that is no longer switched on is a fault report with no fault behind it.
      this.#forget(channel);
      this.#save(withChannel(alerts, channel, false));
      return;
    }
    void this.#turnOn(alerts, channel);
  };

  /**
   * On, if the device will actually do it, and said out loud if it will not.
   *
   * The demonstration is the whole of this method's value. `arm` asks for whatever
   * permission the channel needs -- from this press, which is the only moment a browser
   * will honour the ask -- and then fires the channel, so a lifter learns here rather
   * than at the rack in three minutes. Nothing is dispatched unless it worked, so the
   * stored settings and what the device can do cannot drift apart.
   */
  async #turnOn(alerts: RestAlertSettings, channel: RestAlertChannel): Promise<void> {
    const outcome = await this.alerter.arm(channel, REST_NOTES.alertTestTitle);
    if (outcome === 'delivered') {
      this.#forget(channel);
      this.#save(withChannel(alerts, channel, true));
      return;
    }
    // Back off, in front of the lifter, with the reason underneath. Assigning `trouble`
    // is also what unticks the box the group ticked itself; see `#alertSwitches`.
    this.trouble = [
      ...this.trouble.filter((held) => held.channel !== channel),
      {
        channel,
        failure: outcome,
      },
    ];
  }

  #save(alerts: RestAlertSettings): void {
    this.dispatchEvent(
      new CustomEvent<RestAlertsDetail>(REST_ALERTS_EVENT, {
        detail: { alerts },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Drops anything held against one channel. */
  #forget(channel: RestAlertChannel): void {
    this.trouble = this.trouble.filter((held) => held.channel !== channel);
  }

  /**
   * Say it, on whichever channels are on.
   *
   * Called from the one transition to zero and never from a paint, so a lifter who
   * leaves the band on screen is told once. Asks for no permission -- there is no press
   * behind a countdown ending -- and reports whatever did not happen.
   *
   * Nothing switched on is not a special case, deliberately: `fire` skips a channel that
   * is off, so a rest ending in silence still replaces what is on screen with nothing. A
   * guard here would be a second copy of that rule, and it would leave a sentence about a
   * tone standing after the settings that asked for the tone had gone.
   */
  #announce(): void {
    const alerts = this.alerts;
    if (alerts === null) return;
    void this.#deliver(alerts);
  }

  async #deliver(alerts: RestAlertSettings): Promise<void> {
    this.trouble = await this.alerter.fire(alerts, REST_NOTES.up);
  }

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
    const before = this.secondsLeft;
    const left = timer === null ? 0 : Math.ceil(restRemainingMillis(timer, this.now()) / 1000);
    this.secondsLeft = left;

    // The crossing, and not the state. This runs four times a second and is the only
    // place that knows the rest has just ended, so the test is on the step from some
    // seconds to none: `left === 0` on its own would fire again on every paint, every
    // tab switch, and once more each time the lifter came back to a band they had left
    // sitting at zero. A rest that arrives already finished never crossed anything.
    if (timer !== null && left === 0 && before > 0) this.#announce();
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
    [REST_ALERTS_EVENT]: CustomEvent<RestAlertsDetail>;
  }
}
