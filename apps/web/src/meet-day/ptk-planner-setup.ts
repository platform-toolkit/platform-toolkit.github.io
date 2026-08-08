// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §6.2's one-minute setup and §6.3's goal.
 *
 * WHY THIS IS FOUR QUESTIONS AND NOT FOURTEEN
 *
 * §6.1 gives the tool sixty seconds to a usable plan. Everything that could be
 * asked here and is not -- bodyweight, age, equipment, readiness, jump limits --
 * is in `ptk-plan-extras` behind §8's fold, because each of them refines a plan
 * and none of them is needed to draw one. The order is the order of the
 * questions' consequences: the federation decides what a legal weight is, the
 * format decides which lifts exist, the unit decides how every field is read,
 * and the first-meet answer decides which goal the goal list opens on.
 *
 * WHY THE READ STATUS IS A PROPERTY
 *
 * The federation list is published data (`getMeetRuleProfiles`), so this element
 * has three states before it has one profile: loading, failed, and published-but-
 * empty. Taking the status in as a property rather than reading it here is what
 * makes all three reachable from a story and a browser test with no network
 * (§5.8) -- and the loading and failed states are exactly the ones nobody sees
 * during development, because a local build serves the artifact instantly.
 *
 * This element is presentation. It reads a `PlannerSession` and reports changes
 * as the shared components' own composed events tagged with `data-field`; the
 * root owns every piece of state.
 */
import type { MeetRuleProfile } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-notice';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  FIRST_MEET_CHOICES,
  FORMAT_CHOICES,
  GOAL_CHOICES,
  UNIT_CHOICES,
  UNIT_LABEL,
} from './copy.js';
import {
  FEDERATION_FIELD,
  FIRST_MEET_FIELD,
  FORMAT_FIELD,
  GOAL_FIELD,
  UNIT_FIELD,
} from './fields.js';
import { EMPTY_SESSION, firstMeetValueOf, type PlannerSession } from './session.js';

/** Where the published rule profiles have got to. */
export type ProfilesStatus = 'loading' | 'ready' | 'failed';

/**
 * Whose meet the answers are about (§6.1).
 *
 * Two of the four questions are about the person holding the phone rather than
 * about the meet: whether this is their first one, and what the day is for.
 * A coach running other people's attempts has no answer to either, and the goal
 * in particular is load-bearing -- it decides how much §7 asks of a third
 * attempt, so a coach's own untouched answer would quietly shape nine other
 * people's plans. Dropping the two questions is what stops that, and it is a
 * property rather than a second element because the other two questions, their
 * four read states and the profile note under them are identical in both.
 */
export type SetupScope = 'solo' | 'coach';

@customElement('ptk-planner-setup')
export class PtkPlannerSetup extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .questions {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    /*
     * The format and the unit side by side once there is room, stacked before
     * that. auto-fit against this element's own width, never the viewport: the
     * same markup is a phone and a 320px embed column on a desktop page, and a
     * media query answers only one of them (§5.7).
     */
    .pair {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
      gap: var(--ptk-space-lg);
    }

    .note {
      margin: var(--ptk-space-xs) 0 0;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  @property({ attribute: false }) session: PlannerSession = EMPTY_SESSION;

  /** The published rule profiles, or an empty list while there are none. */
  @property({ attribute: false }) profiles: readonly MeetRuleProfile[] = [];

  @property({ type: String }) status: ProfilesStatus = 'loading';

  @property({ type: String }) scope: SetupScope = 'solo';

  override render(): TemplateResult {
    return html`
      <div class="questions">
        ${this.#renderFederation()} ${this.#renderMeet()} ${this.#renderLifter()}
      </div>
    `;
  }

  /** The two questions every scope asks: which lifts, and in which unit. */
  #renderMeet(): TemplateResult {
    const setup = this.session.setup;
    return html`
      <div class="pair">
        <ptk-choice-group
          data-field=${FORMAT_FIELD}
          label="Meet type"
          .choices=${FORMAT_CHOICES}
          .value=${setup.format}
        ></ptk-choice-group>

        <ptk-choice-group
          data-field=${UNIT_FIELD}
          label=${UNIT_LABEL}
          .choices=${UNIT_CHOICES}
          .value=${setup.unit}
        ></ptk-choice-group>
      </div>
    `;
  }

  /** The two questions only the lifter themselves can answer. */
  #renderLifter(): TemplateResult | typeof nothing {
    if (this.scope !== 'solo') return nothing;
    const setup = this.session.setup;
    return html`
      <ptk-choice-group
        data-field=${FIRST_MEET_FIELD}
        label="Is this your first meet?"
        .choices=${FIRST_MEET_CHOICES}
        .value=${firstMeetValueOf(setup.firstMeet)}
      ></ptk-choice-group>

      <div>
        <ptk-choice-group
          data-field=${GOAL_FIELD}
          label="What is the day for?"
          .choices=${GOAL_CHOICES}
          .value=${setup.goal}
        ></ptk-choice-group>
        <p class="note">
          Every goal opens conservatively. The goal decides how much is asked of the third attempt,
          and nothing here makes an opener a gamble.
        </p>
      </div>
    `;
  }

  /**
   * The federation question, in whichever of its four states applies.
   *
   * A failed read is an error tone and an empty one is not: nothing went wrong
   * when a corpus has no profiles in it yet, and a reload will not change it --
   * so offering one would send a lifter round a loop that cannot end.
   */
  #renderFederation(): TemplateResult {
    if (this.status === 'loading') {
      return html`<ptk-notice>Loading the published rule books…</ptk-notice>`;
    }
    if (this.status === 'failed') {
      return html`<ptk-notice tone="error">
        The rule books could not be loaded, so attempts cannot be checked against a federation's
        increments. Reload the page to try again.
      </ptk-notice>`;
    }
    if (this.profiles.length === 0) {
      return html`<ptk-notice>No federation rule books have been published yet.</ptk-notice>`;
    }

    return html`
      <div>
        <ptk-choice-group
          data-field=${FEDERATION_FIELD}
          label="Federation"
          .choices=${this.profiles.map((profile) => ({
            value: profile.id,
            label: profile.label,
            description: profile.source.label,
          }))}
          .value=${this.session.setup.federationId}
        ></ptk-choice-group>
        ${this.#renderProfileNote()}
      </div>
    `;
  }

  /**
   * What the chosen rule book does to a bar, said before any plan is drawn.
   *
   * The bar multiple is the one profile figure that visibly changes every weight
   * on the screen below, so a lifter who picked the wrong federation sees it here
   * rather than deducing it from three attempts that all end in .5. Read off the
   * profile rather than written down, because §5.1 keeps federation numbers out
   * of source.
   */
  #renderProfileNote(): TemplateResult | typeof nothing {
    const profile = this.profiles.find((entry) => entry.id === this.session.setup.federationId);
    if (profile === undefined) return nothing;
    return html`<p class="note">
      Bars load to ${String(profile.barMultipleKilograms)} kg multiples, and each attempt must be at
      least ${String(profile.minimumProgressionKilograms)} kg above the one before.
    </p>`;
  }

  /**
   * Lit settles when this element's template is committed, which is before the
   * choice groups it just handed options to have rendered any (§5.8). A caller
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

declare global {
  interface HTMLElementTagNameMap {
    'ptk-planner-setup': PtkPlannerSetup;
  }
}
