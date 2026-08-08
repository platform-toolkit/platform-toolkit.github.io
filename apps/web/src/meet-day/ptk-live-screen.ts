// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §11: the whole meet, on the screen a lifter is actually holding.
 *
 * This is the one element in the collection that composes others rather than
 * rendering a decision of its own. `buildLiveView` in `live.ts` has already
 * answered every question -- what lift, which round, what the next action is,
 * what is banked, what a pass would leave, how close the bomb-out is -- and this
 * file lays those answers out and hands three of them to the children that own
 * them (§13's choices, §12's result flow, §14.1's countdown). Nothing here
 * computes a weight, a total, a band or a deadline.
 *
 * WHAT MAKES IT §11 RATHER THAN A DASHBOARD
 *
 * §11 asks for the immediate workflow only, with "advanced details available
 * without competing with the next action". The screen it replaces is the one
 * that shows everything at once and leaves the lifter to work out which part is
 * theirs, with a minute on the clock and chalk on their hands. So the layout is
 * ordered by when a thing is needed rather than by how much of it there is:
 *
 *   1. Who and where -- the name and the round, because a handler runs two.
 *   2. The next action, as one imperative sentence, the largest text here.
 *   3. What has to happen away from the platform -- how many attempts until the
 *      lifter is called, and any urgent warm-up or equipment note.
 *   4. The bomb-out warning, when there is one.
 *   5. The attempt itself, then §14.1's minute.
 *   6. The workspace -- either §13's three choices or §12's result controls,
 *      never both, because only one of them is ever the next action.
 *   7. The two totals, then undo, then the sentences §29 requires.
 *   8. Everything else, behind a fold.
 *
 * WHAT IT DELIBERATELY DOES NOT RENDER
 *
 * Advisories and granted extra attempts belong to `ptk-live-choices`, which
 * already renders both from the same `LiveChoices` object this screen would read
 * them from -- `LiveView.advisories` and `LiveView.extraAttempts` are that
 * object's fields lifted for a caller that has no choices element. Rendering
 * them here as well is the §5.8 fork: two copies of one sentence, worded the
 * same the day they are written.
 *
 * Bomb-out is the opposite case and is why the distinction is worth stating. No
 * child renders `bombOut`, so if this screen does not, §13.7's prominence
 * requirement is met by nothing at all -- and the failure is silent, because the
 * screen looks complete.
 *
 * THERE IS NO CLOCK IN THIS FILE EITHER
 *
 * The view arrives four times a second from a caller wired to `src/clock.ts`.
 * Every child here is a function of the view it is given, which is what lets a
 * story be a photograph of one instant and a test an assertion about one.
 */
import {
  type ConversionChart,
  type AttemptRefusalCode,
  type AttemptWeight,
  type MeetAction,
  type WeightUnit,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-notice';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  BANKED_HEADING,
  MEET_DETAIL_SUMMARY,
  NEXT_ATTEMPT_HEADING,
  NOTHING_TO_UNDO,
  NO_NEXT_ATTEMPT_NOTE,
  NO_PROJECTION_NOTE,
  NEXT_ATTEMPT_UNCHOSEN,
  PROJECTED_HEADING,
  URGENT_HEADING,
  approximatePoundsText,
  attemptKilogramsText,
  attemptPoundsText,
  attemptsBeforeCalledText,
  bombOutSentence,
  jumpText,
  liftsFinishedText,
  nextActionHeadline,
  positionText,
  runningTotalText,
  undoLabel,
  urgentNoteLabel,
} from './copy.js';
import { EMPTY_LIVE_VIEW, type LiveView, type NextAttemptView } from './live.js';
import { deviceHaptics, type Haptics } from './ptk-submission-countdown.js';
import './ptk-attempt-result.js';
import './ptk-live-choices.js';
import './ptk-submission-countdown.js';

/**
 * What pressing undo would take back, handed to the caller rather than acted on.
 *
 * The action goes in the detail instead of the caller reading `undoable` again
 * because those are two different instants. The view repaints four times a
 * second; between the paint the lifter read and the tap that followed it, a
 * result could have been recorded, and `undo(timeline)` would then take back the
 * result rather than the mis-tap the button was labelled with. A caller holding
 * both can compare them and decline.
 */
export interface UndoRequestDetail {
  readonly action: MeetAction;
}

export const UNDO_REQUEST_EVENT = 'ptk-meet-day-undo-request';

@customElement('ptk-live-screen')
export class PtkLiveScreen extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-lg);
      container-type: inline-size;
    }

    h2,
    h3 {
      margin: 0;
    }

    h2 {
      font-size: var(--ptk-font-size-xl);
      line-height: var(--ptk-line-height);
    }

    h3 {
      font-size: var(--ptk-font-size-md);
    }

    p {
      margin: 0;
    }

    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .muted {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .stack {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    /*
     * The name and the round, small and above the headline rather than beside
     * it. A handler with two lifters in one flight needs the name on screen at
     * all times, and it must never be the thing competing with the imperative
     * below it -- so it is quiet, and it is first.
     */
    .who {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * "You are up now" is the most urgent sentence this screen can say and is
     * the only one keyed to the accent, because everything louder than it on
     * this screen is a warning about a miss.
     */
    .called {
      font-weight: 600;
    }

    .called[data-now] {
      color: var(--ptk-color-accent-text);
      font-size: var(--ptk-font-size-lg);
    }

    .panel {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .weight {
      font-size: var(--ptk-font-size-xl);
      font-variant-numeric: tabular-nums;
    }

    /*
     * Two totals, one grid, and they widen together. Side by side they are the
     * comparison §17 wants -- what is real against what is not yet -- and each
     * keeps its own heading, because a figure without one is the fusion §17
     * exists to prevent.
     */
    .totals {
      display: grid;
      gap: var(--ptk-space-md);
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
    }

    .total {
      display: grid;
      gap: var(--ptk-space-xs);
    }

    .figure {
      font-size: var(--ptk-font-size-lg);
      font-variant-numeric: tabular-nums;
    }

    .notices {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .detail {
      display: grid;
      gap: var(--ptk-space-xs);
    }
  `;

  /**
   * §11, already decided.
   *
   * Defaulted rather than nullable, and the default is the exported empty view
   * for the reason task #47 recorded: a lit-html property binding assigns over
   * the class-field default, so `.view=${live}` with a nullable `live` puts
   * `null` on a non-null property and the first render throws. Bind
   * `.view=${live ?? EMPTY_LIVE_VIEW}`.
   */
  @property({ attribute: false }) view: LiveView = EMPTY_LIVE_VIEW;

  /** §16's published chart, passed through to the choices element. `null` is a state. */
  @property({ attribute: false }) chart: ConversionChart | null = null;

  /** The unit the lifter set. Attempts ignore it; totals follow it (§16). */
  @property({ attribute: false }) unit: WeightUnit = 'kg';

  /** Why the last weight was refused, passed through to the choices element. */
  @property({ attribute: false }) refusals: readonly AttemptRefusalCode[] = [];

  /**
   * The buzz port, forwarded to §14.1's panel.
   *
   * Exposed here only so a story or a test can silence it in one place, and it
   * repeats the child's default rather than being nullable: a lit-html property
   * binding assigns, so `.haptics=${this.haptics ?? undefined}` would write
   * `undefined` over the child's own default and the panel would throw the first
   * time a band escalated. The duplication is the price of the binding rule.
   */
  @property({ attribute: false }) haptics: Haptics = deviceHaptics;

  override render(): TemplateResult {
    const view = this.view;
    return html`
      ${this.#renderHeader(view)} ${this.#renderCalled(view)} ${this.#renderUrgent(view)}
      ${this.#renderBombOut(view)} ${this.#renderNextAttempt(view)} ${this.#renderSubmission(view)}
      ${this.#renderWorkspace(view)} ${this.#renderTotals(view)} ${this.#renderUndo(view)}
      ${this.#renderNotices(view)} ${this.#renderDetail(view)}
    `;
  }

  #renderHeader(view: LiveView): TemplateResult {
    return html`
      <div class="stack">
        <p class="who">${view.lifterName} -- ${positionText(view.position)}</p>
        <h2>${nextActionHeadline(view.nextAction)}</h2>
      </div>
    `;
  }

  /**
   * How many attempts are ahead, including when nobody has counted.
   *
   * The `null` case gets a sentence rather than no line, and that is the whole
   * decision: an absent line reads as "there is nobody ahead of you", which is
   * the one wrong answer that costs an attempt. `0` is a different sentence
   * again, not a smaller number, because it is the only one that means move.
   */
  #renderCalled(view: LiveView): TemplateResult | typeof nothing {
    if (view.position.meetOver) return nothing;
    const count = view.observed.attemptsBeforeCalled;
    return html`<p class="called" ?data-now=${count === 0}>${attemptsBeforeCalledText(count)}</p>`;
  }

  #renderUrgent(view: LiveView): TemplateResult | typeof nothing {
    const urgent = view.observed.urgent;
    if (urgent.length === 0) return nothing;
    return html`
      <section class="stack">
        <h3>${URGENT_HEADING}</h3>
        <ul class="notices">
          ${urgent.map(
            (note) => html`
              <li>
                <ptk-notice tone="info">${urgentNoteLabel(note.kind)}: ${note.message}</ptk-notice>
              </li>
            `,
          )}
        </ul>
      </section>
    `;
  }

  /**
   * §13.7's warning, which is this screen's alone to render.
   *
   * `bombOutSentence` returns `null` on a single miss and that silence is
   * deliberate -- see the copy. What matters here is that the element does not
   * second-guess it by rendering an empty notice: an error-toned box with
   * nothing in it is louder than the sentence it lost.
   */
  #renderBombOut(view: LiveView): TemplateResult | typeof nothing {
    if (view.bombOut === null) return nothing;
    const sentence = bombOutSentence(view.bombOut);
    if (sentence === null) return nothing;
    return html`<ptk-notice tone="error">${sentence}</ptk-notice>`;
  }

  /**
   * §11's attempt card: the weight, the pound reading, and the jump.
   *
   * Shown beside §14.1's panel rather than folded into it. The panel is about a
   * deadline and names the weight only to pin it to a lifter (§14's wrong-athlete
   * failure); this is the attempt itself, and the jump -- the figure a handler
   * argues about -- has nowhere else to be.
   */
  #renderNextAttempt(view: LiveView): TemplateResult | typeof nothing {
    if (view.position.meetOver) return nothing;
    const attempt = view.nextAttempt;
    if (attempt === null) {
      return html`<p class="muted">${NO_NEXT_ATTEMPT_NOTE}</p>`;
    }
    return html`
      <section class="panel">
        <h3>${NEXT_ATTEMPT_HEADING}</h3>
        ${this.#renderAttemptWeight(attempt)}
      </section>
    `;
  }

  #renderAttemptWeight(attempt: NextAttemptView): TemplateResult {
    const weight = attempt.weight;
    if (weight === null) {
      return html`<p class="muted">${NEXT_ATTEMPT_UNCHOSEN}</p>`;
    }
    const jump = jumpText(attempt.jumpKilograms);
    return html`
      <p class="weight">${attemptKilogramsText(weight)}</p>
      <p class="muted pounds">${this.#poundsLine(weight)}</p>
      ${jump === null ? nothing : html`<p>${jump}</p>`}
    `;
  }

  /**
   * §16 in one line: the published figure, or an approximation labelled as one.
   *
   * `attemptPoundsText` answers `null` when the chart has no row, and the
   * fallback says so rather than printing a bare converted number -- a pound
   * figure beside an attempt that is not off the chart and does not say it is a
   * conversion is the one thing §16 forbids outright.
   */
  #poundsLine(weight: AttemptWeight): string {
    return attemptPoundsText(weight) ?? approximatePoundsText(weight);
  }

  #renderSubmission(view: LiveView): TemplateResult | typeof nothing {
    if (view.submission === null) return nothing;
    return html`
      <ptk-submission-countdown
        .submission=${view.submission}
        .haptics=${this.haptics}
      ></ptk-submission-countdown>
    `;
  }

  /**
   * One workspace, chosen by the next action, never two.
   *
   * The result controls appear only while an attempt is on the platform, and the
   * choices disappear for exactly that span. Both at once would offer a lifter a
   * new weight for the attempt a referee is judging, which the rules refuse and
   * the screen should not have suggested.
   *
   * `submit-to-the-table` keeps the choices up on purpose: the weight is chosen
   * but the minute is still running, and §13's whole point is that a lifter may
   * change their mind while the rules still allow it.
   */
  #renderWorkspace(view: LiveView): TemplateResult | typeof nothing {
    if (view.nextAction === 'record-the-result') {
      return this.#renderResult(view);
    }
    if (view.choices === null) return nothing;
    return html`
      <ptk-live-choices
        .choices=${view.choices}
        .chart=${this.chart}
        .unit=${this.unit}
        .refusals=${this.refusals}
      ></ptk-live-choices>
    `;
  }

  /**
   * §12's controls, with the subject read off the view rather than rebuilt.
   *
   * Under `record-the-result` the attempt the domain calls next *is* the one on
   * the platform -- `actionFor` keys the code off that attempt's status -- so
   * every field of the subject is already on the view and none of it is
   * assembled by guessing which attempt is being judged.
   */
  #renderResult(view: LiveView): TemplateResult | typeof nothing {
    const attempt = view.nextAttempt;
    const lift = view.position.lift;
    if (attempt === null || lift === null) return nothing;
    return html`
      <ptk-attempt-result
        .subject=${{
          attemptId: attempt.attemptId,
          lifterName: view.lifterName,
          lift,
          attemptNumber: attempt.attemptNumber,
          weight: attempt.weight,
        }}
      ></ptk-attempt-result>
    `;
  }

  /** §11's two figures, each under its own heading (§17). */
  #renderTotals(view: LiveView): TemplateResult {
    return html`
      <div class="totals">
        <section class="total">
          <h3>${BANKED_HEADING}</h3>
          <p class="figure">${runningTotalText(view.banked, this.unit)}</p>
        </section>
        <section class="total">
          <h3>${PROJECTED_HEADING}</h3>
          ${
            view.projected === null
              ? html`<p class="muted">${NO_PROJECTION_NOTE}</p>`
              : html`<p class="figure projected">${runningTotalText(view.projected, this.unit)}</p>`
          }
        </section>
      </div>
    `;
  }

  /**
   * §13.9's control, on the screen and not in the fold.
   *
   * What it takes back is nearly always a mis-tapped result, and the moment it
   * is wanted is the second after the tap. A fold costs a press to open and a
   * read to find, which is a fold's whole purpose and exactly wrong here.
   */
  #renderUndo(view: LiveView): TemplateResult {
    const action = view.undoable;
    if (action === null) {
      return html`<p class="muted">${NOTHING_TO_UNDO}</p>`;
    }
    return html`
      <ptk-button variant="secondary" @click=${this.#onUndo}>${undoLabel(action)}</ptk-button>
    `;
  }

  /** §29's sentences, from the domain that owns them. Never behind a fold. */
  #renderNotices(view: LiveView): TemplateResult | typeof nothing {
    if (view.notices.length === 0) return nothing;
    return html`
      <ul class="notices">
        ${view.notices.map((notice) => html`<li><ptk-notice tone="info">${notice}</ptk-notice></li>`)}
      </ul>
    `;
  }

  /**
   * §11's "advanced details available without competing with the next action".
   *
   * Which lifts are behind the lifter, which is the context the banked figure is
   * read against. It is real and it is worth having; it is also the sort of thing
   * that, left on the screen, is one more line between a lifter and the button
   * they have forty seconds to press.
   */
  #renderDetail(view: LiveView): TemplateResult {
    return html`
      <ptk-disclosure label=${MEET_DETAIL_SUMMARY} summary=${MEET_DETAIL_SUMMARY}>
        <div class="detail">
          <p>${liftsFinishedText(view.position.liftsFinished)}</p>
        </div>
      </ptk-disclosure>
    `;
  }

  #onUndo = (): void => {
    const action = this.view.undoable;
    if (action === null) return;
    this.dispatchEvent(
      new CustomEvent<UndoRequestDetail>(UNDO_REQUEST_EVENT, {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * §5.8: a host whose children are LitElements is not complete when it says so.
   *
   * `super.getUpdateComplete()` resolves when this element's own template has
   * been written to the DOM, which is before the four children below it have
   * rendered anything -- and every test on this screen reads text out of those
   * children. Without this a test asserting on the choices cards passes or fails
   * on timing.
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

declare global {
  interface HTMLElementTagNameMap {
    'ptk-live-screen': PtkLiveScreen;
  }

  interface HTMLElementEventMap {
    [UNDO_REQUEST_EVENT]: CustomEvent<UndoRequestDetail>;
  }
}
