// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Who is on the board, and what this phone calls each of them (§21).
 *
 * §6.1's coach branch has no plan screen behind it: a coach is not planning
 * their own nine attempts, so there is no maximum to agree and no §7 to walk
 * through. What there is instead is a list of names, and the two per-lifter
 * facts §21 requires on every row -- a distinctive identifier and a colour.
 *
 * WHY ADDING THE FIRST LIFTER IS WHAT STARTS THE MEET
 *
 * A meet document is created against a rule book and a meet type, and both are
 * fixed from that moment (`createMeetDocument` takes them once). So there are
 * only two honest designs: create the document when the coach picks a
 * federation and then leave two controls on screen that no longer do anything,
 * or create it when the first lifter arrives and take the two questions away.
 * The second is what `ROSTER_STARTS_THE_MEET` says out loud before it happens,
 * and it is the same promise `MEET_IS_RUNNING_NOTE` makes on the solo path.
 *
 * WHY THE IDENTIFIER AND THE COLOUR ARE FOLDED AWAY AND THE NAME IS NOT
 *
 * A name is asked once and answered once. The other two are corrections -- a
 * coach types a lot number when the lot numbers are handed out, which is after
 * the flight list -- and a roster that put a text field and seven colour tiles
 * on screen for every lifter would be eight screenfuls of controls above the
 * board on a phone, for answers most coaches give once and never revisit
 * (§5.7). One fold per lifter, with the answers on its summary line so the
 * whole roster is still readable shut.
 *
 * This element is presentation. It owns nothing: the name being typed, the
 * entries and the meet document are all the root's, and every answer here is
 * reported as the shared components' own composed events tagged with
 * `data-field` (§5.8).
 */
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  COLOUR_CHOICES,
  NO_COLOUR,
  ROSTER_ADD_LABEL,
  ROSTER_COLOUR_LABEL,
  ROSTER_EMPTY,
  ROSTER_HEADING,
  ROSTER_IDENTIFIER_HINT,
  ROSTER_IDENTIFIER_LABEL,
  ROSTER_NAME_HINT,
  ROSTER_NAME_LABEL,
  ROSTER_NEEDS_A_FEDERATION,
  ROSTER_STARTS_THE_MEET,
  rosterSummary,
} from './copy.js';
import { ROSTER_COLOUR_FIELD, ROSTER_IDENTIFIER_FIELD, ROSTER_NAME_FIELD } from './fields.js';

/** One lifter, as the meet document and this phone's entry together describe them. */
export interface RosterLifter {
  readonly lifterId: string;
  /** From the meet document. Never blank -- `add-lifter` refuses an empty name. */
  readonly name: string;
  /** §21's identifier as the coach typed it. `''` is a real answer. */
  readonly identifier: string;
  readonly colour: string | null;
}

/**
 * A press of Add, carrying the name rather than leaving the root to read it.
 *
 * The root owns the box's value and could read its own state -- and those are
 * two different instants. The name arrives here as a property, so this reports
 * the name it was actually showing when the press landed, which is the one the
 * coach read. The same reasoning `FederationChangeDetail` records.
 */
export const ROSTER_ADD_EVENT = 'ptk-meet-day-roster-add';

export interface RosterAddDetail {
  readonly name: string;
}

@customElement('ptk-coach-roster')
export class PtkCoachRoster extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    .roster {
      display: grid;
      gap: var(--ptk-space-md);
    }

    h2 {
      margin: 0;
      font-size: var(--ptk-font-size-lg);
    }

    .add {
      display: grid;
      gap: var(--ptk-space-sm);
      justify-items: start;
    }

    /*
     * Both stretch. A control sized to its own label lands wherever the label
     * happens to end, which on a 320px column is a button floating in the
     * middle of a row a thumb is aiming at (§5.7).
     */
    .add ptk-text-field,
    .add ptk-button {
      width: 100%;
    }

    p {
      margin: 0;
    }

    .note {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    ul {
      display: grid;
      gap: var(--ptk-space-sm);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .entry {
      display: grid;
      gap: var(--ptk-space-md);
    }
  `;

  @property({ attribute: false }) lifters: readonly RosterLifter[] = [];

  /** The name in the box, owned by the root. */
  @property({ type: String }) name = '';

  /**
   * Whether there is a rule book to create a meet against.
   *
   * A property rather than something derived from `lifters`, because the two
   * differ in exactly the state this screen opens in: no federation chosen and
   * nobody added. Deriving it would show the add box over a screen that cannot
   * take the answer, and the refusal would arrive one press later.
   */
  @property({ type: Boolean }) ready = false;

  override render(): TemplateResult {
    return html`
      <section class="roster">
        <h2>${ROSTER_HEADING}</h2>
        ${this.ready ? this.#renderAdd() : html`<p class="note">${ROSTER_NEEDS_A_FEDERATION}</p>`}
        ${this.#renderLifters()}
      </section>
    `;
  }

  /**
   * The box and the button, plus what pressing it settles for the rest of the day.
   *
   * The note is above the button and only while the meet has not started, for
   * the reason `START_MEET_NOTE` is: it answers the question that stops somebody
   * pressing. Said afterwards it is a sentence about something already done.
   *
   * The button is not disabled on a blank name, although it could be. A press
   * landing on the `ptk-button` host's own padding runs the listener whatever
   * the inner control's state, and `add-lifter` refuses an empty name with
   * `lifter-name-required` -- a sentence the root already knows how to say. A
   * second check here would be a copy of a domain rule in an element, silently
   * answering differently the day the rule changes.
   */
  #renderAdd(): TemplateResult {
    return html`
      <div class="add">
        <ptk-text-field
          data-field=${ROSTER_NAME_FIELD}
          label=${ROSTER_NAME_LABEL}
          hint=${ROSTER_NAME_HINT}
          capitalize="words"
          autocomplete="off"
          .value=${this.name}
        ></ptk-text-field>
        ${this.lifters.length === 0 ? html`<p class="note">${ROSTER_STARTS_THE_MEET}</p>` : nothing}
        <ptk-button @click=${this.#onAdd}>${ROSTER_ADD_LABEL}</ptk-button>
      </div>
    `;
  }

  #renderLifters(): TemplateResult {
    if (this.lifters.length === 0) return html`<p class="note">${ROSTER_EMPTY}</p>`;
    return html`
      <ul>
        ${this.lifters.map((lifter) => html`<li>${this.#renderLifter(lifter)}</li>`)}
      </ul>
    `;
  }

  /**
   * One lifter's fold.
   *
   * Both controls carry `data-lifter` and never a row index. The roster does not
   * re-sort today, so an index would work -- and the board beside it does, four
   * times a second, so one attribute meaning one thing on both screens is what
   * keeps the two handlers in the root from drifting. See `fields.ts`.
   */
  #renderLifter(lifter: RosterLifter): TemplateResult {
    return html`
      <ptk-disclosure
        label=${lifter.name}
        summary=${rosterSummary(lifter.identifier, lifter.colour)}
      >
        <div class="entry">
          <ptk-text-field
            data-field=${ROSTER_IDENTIFIER_FIELD}
            data-lifter=${lifter.lifterId}
            label=${ROSTER_IDENTIFIER_LABEL}
            hint=${ROSTER_IDENTIFIER_HINT}
            autocomplete="off"
            .value=${lifter.identifier}
          ></ptk-text-field>

          <ptk-choice-group
            data-field=${ROSTER_COLOUR_FIELD}
            data-lifter=${lifter.lifterId}
            label=${ROSTER_COLOUR_LABEL}
            .choices=${COLOUR_CHOICES}
            .value=${lifter.colour ?? NO_COLOUR}
          ></ptk-choice-group>
        </div>
      </ptk-disclosure>
    `;
  }

  readonly #onAdd = (): void => {
    this.dispatchEvent(
      new CustomEvent<RosterAddDetail>(ROSTER_ADD_EVENT, {
        detail: { name: this.name },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Lit settles when this element's template is committed, which is before the
   * children it just handed options to have rendered any (§5.8). A caller
   * awaiting `updateComplete` and then reading a control would otherwise read
   * the previous render's -- usually not, which is what makes it expensive.
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
    'ptk-coach-roster': PtkCoachRoster;
  }

  interface HTMLElementEventMap {
    [ROSTER_ADD_EVENT]: CustomEvent<RosterAddDetail>;
  }
}
