// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §14.1: the attempt that is owed, and the minute if there is one.
 *
 * The panel shows four things §14.1 lists -- the time remaining, the attempt
 * that is owed, whether the lifter has marked it handed in, and what the
 * officials write down if nothing is said -- and it computes none of them.
 * `buildLiveView` derives the seconds from `now`, so this element renders a
 * `SubmissionView` and reports one press.
 *
 * THE CLOCK IS THE PART THAT CAN BE ABSENT
 *
 * `SubmissionView.clock` is null on the opener of each lift, because the tool's
 * minute starts from a recorded result and there is no earlier result on that
 * lift to start it from. The panel is still the panel: the weight is owed, the
 * name is on it, and the mark control is the only way in the tool to say the
 * weight reached the table. So a null clock takes the digits and the band off
 * the panel and puts a sentence where they were, rather than taking the panel
 * away -- which for three of the nine attempts would leave the lifter nothing to
 * press.
 *
 * IT DOES NOT COUNT DOWN
 *
 * There is no timer in this file. The screen above it repaints off the clock
 * seam and hands in a fresh view, and the seconds on that view are
 * `deadline - now` rather than a number that has been decremented. A decrementing
 * counter loses real seconds the moment the phone goes in a pocket -- a browser
 * throttles a background interval to one tick a second, then to one a minute,
 * and stops it altogether with the screen off -- and it comes back showing time
 * the lifter does not have, during the sixty seconds this panel is about.
 *
 * IT HANDS NOTHING IN
 *
 * §14 says the application does not submit attempts to meet officials. The
 * button records that the lifter did, which is why it reads "Mark handed in" and
 * why the official-clock sentence is on the panel rather than in a fold.
 */
import type { AttemptWeight } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  MARK_SUBMITTED_LABEL,
  NO_DEADLINE_NOTE,
  NO_SUBMISSION_NOTE,
  OFFICIAL_CLOCK_NOTE,
  SUBMISSION_HEADING,
  approximatePoundsText,
  attemptPoundsText,
  automaticSentence,
  countdownSpokenText,
  countdownText,
  submissionStatusText,
  submissionSubjectLine,
  urgencySentence,
} from './copy.js';
import type { SubmissionClock, SubmissionUrgency, SubmissionView } from './live.js';

/** Which attempt the lifter says is now with the table. */
export interface SubmissionMarkedDetail {
  readonly attemptId: string;
}

export const SUBMISSION_MARKED_EVENT = 'ptk-meet-day-submission-marked';

/**
 * A buzz, behind a one-function port.
 *
 * §14.1 asks for vibration "where supported by the existing application
 * environment", and support is the whole problem: `navigator.vibrate` is absent
 * on every iOS browser, which is the device §5.7 names as primary. A port rather
 * than a direct call because a test cannot observe the real one -- Chromium
 * reports nothing back, and an element that vibrated directly would have its one
 * escalation rule covered by nothing at all.
 */
export type Haptics = (pattern: number | number[]) => void;

/**
 * The default port. Silent where the device has no vibrator.
 *
 * Annotated `Partial<Navigator>` on purpose: `lib.dom` declares `vibrate` as
 * always present, so a plain `typeof` guard reads as dead code to the linter and
 * an unguarded call throws on the platform that matters. The annotation is the
 * honest one -- this member may not be there.
 */
export const deviceHaptics: Haptics = (pattern) => {
  const device: Partial<Navigator> = navigator;
  device.vibrate?.(pattern);
};

/** Longer as the deadline closes, because a pocket only carries so much detail. */
const HAPTIC_PATTERNS: Readonly<Record<SubmissionUrgency, number | number[]>> = {
  calm: 0,
  hurry: 120,
  critical: [80, 80, 80],
  lapsed: 400,
};

@customElement('ptk-submission-countdown')
export class PtkSubmissionCountdown extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-md);
    }

    p {
      margin: 0;
    }

    .muted {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .panel {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 2px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    /*
     * Colour is the last carrier of urgency here and never the only one: the
     * seconds are always on screen and the band is always a sentence, so the
     * panel says the same thing in forced colours, to a reader who cannot
     * separate the hues, and read aloud across a warm-up room.
     */
    .panel[data-urgency='hurry'] {
      border-color: var(--ptk-color-caution);
    }

    .panel[data-urgency='critical'],
    .panel[data-urgency='lapsed'] {
      border-color: var(--ptk-color-negative);
    }

    /*
     * The name and the weight, at the size of a heading rather than of prose.
     * §14 names the failure this line exists to prevent -- the correct weight
     * handed in for the wrong athlete -- and a handler with two lifters reads
     * this line and nothing else.
     */
    .subject {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
    }

    .clock {
      font-size: var(--ptk-font-size-xl);
      font-weight: 700;
      /* Tabular figures, or the panel jiggles once a second as the glyph widths
         change under a proportional face -- on the one screen nobody can afford
         to look away from. */
      font-variant-numeric: tabular-nums;
    }

    .lapsed {
      color: var(--ptk-color-negative);
    }
  `;

  /** `null` when no attempt is owed. Rendered as a sentence, not as an empty box. */
  @property({ attribute: false }) submission: SubmissionView | null = null;

  /** Overridden in tests and in stories, where a real buzz is neither wanted nor visible. */
  @property({ attribute: false }) haptics: Haptics = deviceHaptics;

  /**
   * The last band this element buzzed for, so it buzzes once per escalation.
   *
   * Not per render: the view arrives four times a second, and a phone that
   * vibrated on every one of them would be a continuous buzz for a whole minute
   * rather than a signal. Reset when the attempt changes, so the next attempt's
   * escalation is announced again.
   */
  #buzzedFor: SubmissionUrgency | null = null;
  #buzzedOn: string | null = null;

  protected override willUpdate(): void {
    const submission = this.submission;
    if (submission === null) {
      this.#buzzedFor = null;
      this.#buzzedOn = null;
      return;
    }
    if (submission.attemptId !== this.#buzzedOn) {
      this.#buzzedOn = submission.attemptId;
      this.#buzzedFor = null;
    }
    /*
     * A panel with no clock on it buzzes for nothing. There is no escalation to
     * announce, and a buzz would be the pocket saying the deadline moved when no
     * deadline is running -- the one signal on this screen a lifter acts on
     * without looking.
     */
    const urgency = submission.clock?.urgency ?? null;
    if (urgency === null || urgency === this.#buzzedFor) return;
    this.#buzzedFor = urgency;
    /*
     * Nothing on the calm band and nothing once it is handed in. A buzz at the
     * top of the minute would fire on every attempt of the meet and teach the
     * lifter to ignore the two that mean something, and a lifter who has already
     * walked the weight to the table has nothing left to do about the clock.
     */
    if (urgency === 'calm' || submission.submitted) return;
    this.haptics(HAPTIC_PATTERNS[urgency]);
  }

  override render(): TemplateResult {
    const submission = this.submission;
    if (submission === null) {
      return html`<p class="muted">${NO_SUBMISSION_NOTE}</p>`;
    }
    return html`
      <section class="panel" data-urgency=${submission.clock?.urgency ?? nothing}>
        <h3>${SUBMISSION_HEADING}</h3>
        <p class="subject">${submissionSubjectLine(submission.lifterName, submission.weight)}</p>
        ${this.#renderPounds(submission.weight)} ${this.#renderClock(submission.clock)}
        <p class="status ${submission.submitted ? '' : 'muted'}">
          ${submissionStatusText(submission.submitted)}
        </p>
        <p class="muted">${automaticSentence(submission.automatic)}</p>
        <ptk-button
          variant="primary"
          ?disabled=${submission.submitted || submission.weight === null}
          @click=${this.#onMark}
          >${MARK_SUBMITTED_LABEL}</ptk-button
        >
        <p class="muted">${OFFICIAL_CLOCK_NOTE}</p>
      </section>
    `;
  }

  /** The reading aid beside the attempt, which is a chart entry or is hedged (§16). */
  #renderPounds(weight: AttemptWeight | null): TemplateResult | typeof nothing {
    if (weight === null) return nothing;
    return html`<p class="muted">${attemptPoundsText(weight) ?? approximatePoundsText(weight)}</p>`;
  }

  /**
   * The figure, then the band.
   *
   * Only the band is announced. The digits change four times a second, and a
   * live region over them would read a number over the top of everything else on
   * the screen for the whole minute; the band changes at most three times and is
   * the part a reader has to be told. The digits carry a spoken label instead, so
   * they can be asked for once.
   *
   * The band is read off the view rather than recomputed from the seconds. Two
   * readings of the same thing on one panel is how a border ends up red while
   * the sentence beside it still says there is time.
   *
   * No clock is a sentence rather than a blank. Digits missing from where digits
   * belong read as a clock that has stopped, and the reading a lifter acts on
   * there is that they have time -- which is the reading that costs the attempt.
   */
  #renderClock(clock: SubmissionClock | null): TemplateResult {
    if (clock === null) return html`<p class="muted no-clock">${NO_DEADLINE_NOTE}</p>`;
    return html`
      <p
        class="clock ${clock.lapsed ? 'lapsed' : ''}"
        aria-label=${countdownSpokenText(clock.secondsRemaining)}
      >
        ${countdownText(clock.secondsRemaining)}
      </p>
      <p role="status">${urgencySentence(clock.urgency)}</p>
    `;
  }

  /**
   * Guarded, even though the button is disabled in both cases.
   *
   * The listener sits on the `ptk-button` host and a press landing on the host's
   * own box runs it whatever the inner `<button>`'s state -- a real thumb near
   * the padding, not a synthetic event. Reporting twice would mark an attempt
   * handed in that the lifter pressed once, and reporting with no weight would
   * name an attempt that has none.
   */
  readonly #onMark = (): void => {
    const submission = this.submission;
    if (submission === null || submission.submitted || submission.weight === null) return;
    this.dispatchEvent(
      new CustomEvent<SubmissionMarkedDetail>(SUBMISSION_MARKED_EVENT, {
        detail: { attemptId: submission.attemptId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Lit settles when this element's template is committed, before the children it
   * just handed properties to have rendered anything (§5.8).
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
    'ptk-submission-countdown': PtkSubmissionCountdown;
  }

  interface HTMLElementEventMap {
    [SUBMISSION_MARKED_EVENT]: CustomEvent<SubmissionMarkedDetail>;
  }
}
