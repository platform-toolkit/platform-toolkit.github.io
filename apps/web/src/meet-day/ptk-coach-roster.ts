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
import type { HandlerAssignment } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-text-field';
import '@platform-toolkit/ui/ptk-toggle-group';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  COLOUR_CHOICES,
  HANDLER_RESPONSIBILITY_CHOICES,
  NO_COLOUR,
  ROSTER_ADD_HANDLER_LABEL,
  ROSTER_ADD_LABEL,
  ROSTER_COLOUR_LABEL,
  ROSTER_EMPTY,
  ROSTER_HANDLERS_EMPTY,
  ROSTER_HANDLERS_HEADING,
  ROSTER_HANDLERS_NOTE,
  ROSTER_HANDLER_DUTIES_LABEL,
  ROSTER_HANDLER_NAME_LABEL,
  ROSTER_HEADING,
  ROSTER_IDENTIFIER_HINT,
  ROSTER_IDENTIFIER_LABEL,
  ROSTER_NAME_HINT,
  ROSTER_NAME_LABEL,
  ROSTER_NEEDS_A_FEDERATION,
  ROSTER_RACK_HINT,
  ROSTER_RACK_LABEL,
  ROSTER_STARTS_THE_MEET,
  removeHandlerLabel,
  rosterSummary,
} from './copy.js';
import {
  ROSTER_COLOUR_FIELD,
  ROSTER_HANDLER_ADD_FIELD,
  ROSTER_HANDLER_DUTIES_FIELD,
  ROSTER_HANDLER_INDEX_FIELD,
  ROSTER_HANDLER_NAME_FIELD,
  ROSTER_HANDLER_REMOVE_FIELD,
  ROSTER_IDENTIFIER_FIELD,
  ROSTER_NAME_FIELD,
  ROSTER_RACK_FIELD,
} from './fields.js';

/** One lifter, as the meet document and this phone's entry together describe them. */
export interface RosterLifter {
  readonly lifterId: string;
  /** From the meet document. Never blank -- `add-lifter` refuses an empty name. */
  readonly name: string;
  /** §21's identifier as the coach typed it. `''` is a real answer. */
  readonly identifier: string;
  readonly colour: string | null;
  /**
   * §21.3's handlers, in the order they were added and never re-sorted.
   *
   * The raw entry's list rather than the board's: `coachBoard` drops the ones
   * with no name yet, and this is the screen a name is typed on, so a row that
   * disappeared as soon as it was added would be unusable. The board's filter and
   * this element are looking at the same list for two different reasons.
   */
  readonly handlers: readonly HandlerAssignment[];
  /** §21.4's bar as typed. `''` means this lifter is not on a shared one. */
  readonly rackId: string;
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

/**
 * A press of "Add a handler", which appends a blank assignment to one lifter.
 *
 * Blank rather than a name typed into a box first, which is the other way this
 * could go and would put a second "add" box inside a fold that already has one
 * above it. A row's own name field is the box either way, so the alternative is
 * a box that exists to be emptied into another box.
 *
 * The cost of a blank row is that it is briefly a handler with no name, and it
 * is paid one layer down rather than here: `coachBoard` drops an unnamed handler
 * from the board and from §23's pack, so nothing outside this fold ever renders
 * the empty line. Refusing to create one instead -- disabling Add, or dropping
 * the row on blur -- would mean a coach cannot leave a row half-typed while they
 * go and ask somebody their surname, which is what the roster is for.
 */
export const ROSTER_HANDLER_ADD_EVENT = 'ptk-meet-day-roster-handler-add';

export interface RosterHandlerAddDetail {
  readonly lifterId: string;
}

/**
 * A press of one of the remove buttons, carrying who and which.
 *
 * By position, which every other list in this tool refuses to do, and `fields.ts`
 * records the reason at `ROSTER_HANDLER_INDEX_FIELD`: nothing re-sorts a handler
 * list, and two unnamed rows have no other way to be told apart.
 */
export const ROSTER_HANDLER_REMOVE_EVENT = 'ptk-meet-day-roster-handler-remove';

export interface RosterHandlerRemoveDetail {
  readonly lifterId: string;
  readonly index: number;
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

    .handlers {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /*
     * A rule above each handler rather than a border around it. Three of these
     * nested inside a fold inside a card is three levels of box on a 320px
     * column, and every level costs padding on both sides (§5.7); a line says
     * "a new person starts here" for nothing.
     */
    .handler {
      display: grid;
      gap: var(--ptk-space-sm);
      padding-top: var(--ptk-space-sm);
      border-top: 1px solid var(--ptk-color-border);
    }

    /*
     * Full width, like the add button above. A remove control sized to its own
     * label lands wherever the handler's name happens to end, which is a button
     * that moves as somebody types.
     */
    .handlers ptk-button {
      width: 100%;
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
   * Every control carries `data-lifter` and never a row index. The roster does
   * not re-sort today, so an index would work -- and the board beside it does,
   * four times a second, so one attribute meaning one thing on both screens is
   * what keeps the two handlers in the root from drifting. See `fields.ts`.
   *
   * The order is the order the answers are wanted in. The identifier and the
   * colour are asked of every lifter and are asked first (§21); the handlers and
   * the bar are asked of a room that has them, and a coach running two people
   * off one bar scrolls past two controls to reach them rather than four.
   */
  #renderLifter(lifter: RosterLifter): TemplateResult {
    return html`
      <ptk-disclosure
        label=${lifter.name}
        summary=${rosterSummary(
          lifter.identifier,
          lifter.colour,
          lifter.rackId,
          lifter.handlers.length,
        )}
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

          ${this.#renderHandlers(lifter)}

          <ptk-text-field
            data-field=${ROSTER_RACK_FIELD}
            data-lifter=${lifter.lifterId}
            label=${ROSTER_RACK_LABEL}
            hint=${ROSTER_RACK_HINT}
            autocomplete="off"
            .value=${lifter.rackId}
          ></ptk-text-field>
        </div>
      </ptk-disclosure>
    `;
  }

  /**
   * §21.3's people, and the two presses that change how many there are.
   *
   * The add press is below the list rather than beside the heading, so that the
   * thing a coach reaches for after typing a name is under their thumb rather
   * than back up the screen. The removes are inside the list for the same
   * reason -- a row's own remove is the last control on that row.
   *
   * Both presses are delegated to one listener on the section rather than bound
   * per button, so that the number of listeners does not grow with the number of
   * handlers on a screen that repaints while a meet is running.
   */
  #renderHandlers(lifter: RosterLifter): TemplateResult {
    return html`
      <div class="handlers" @click=${this.#onHandlerPress}>
        <h3>${ROSTER_HANDLERS_HEADING}</h3>
        <p class="note">${ROSTER_HANDLERS_NOTE}</p>
        ${
          lifter.handlers.length === 0
            ? html`<p class="note">${ROSTER_HANDLERS_EMPTY}</p>`
            : lifter.handlers.map((handler, index) =>
                this.#renderHandler(lifter.lifterId, handler, index),
              )
        }
        <ptk-button
          variant="secondary"
          data-field=${ROSTER_HANDLER_ADD_FIELD}
          data-lifter=${lifter.lifterId}
          >${ROSTER_ADD_HANDLER_LABEL}</ptk-button
        >
      </div>
    `;
  }

  /**
   * One handler: who they are, what they are on, and a way to take them off.
   *
   * The toggle group is bound to `handler.responsibilities` and not left to its
   * own default, which §13.13 records as the mutation this directory's tests are
   * weakest against: a group that ignored the property would show seven blank
   * tiles the second time a fold is opened, and a coach would re-tick answers
   * they already gave. There is a test that reads the boxes back for that reason.
   */
  #renderHandler(lifterId: string, handler: HandlerAssignment, index: number): TemplateResult {
    return html`
      <div class="handler">
        <ptk-text-field
          data-field=${ROSTER_HANDLER_NAME_FIELD}
          data-lifter=${lifterId}
          data-handler=${index}
          label=${ROSTER_HANDLER_NAME_LABEL}
          capitalize="words"
          autocomplete="off"
          .value=${handler.name}
        ></ptk-text-field>

        <ptk-toggle-group
          data-field=${ROSTER_HANDLER_DUTIES_FIELD}
          data-lifter=${lifterId}
          data-handler=${index}
          label=${ROSTER_HANDLER_DUTIES_LABEL}
          .choices=${HANDLER_RESPONSIBILITY_CHOICES}
          .values=${handler.responsibilities}
        ></ptk-toggle-group>

        <ptk-button
          variant="secondary"
          data-field=${ROSTER_HANDLER_REMOVE_FIELD}
          data-lifter=${lifterId}
          data-handler=${index}
          >${removeHandlerLabel(handler.name, index)}</ptk-button
        >
      </div>
    `;
  }

  /**
   * The two presses inside the handler section, told apart by `data-field`.
   *
   * One delegated listener rather than two bound handlers, and it reads the tags
   * off `composedPath()` the way the root does -- a press landing on the gap
   * between two buttons arrives with no field on the path and is ignored, which
   * is the same rule §22.2's removals follow.
   */
  readonly #onHandlerPress = (event: Event): void => {
    const lifterId = tagOf(event, 'lifter');
    if (lifterId === null) return;
    const field = tagOf(event, 'field');
    if (field === ROSTER_HANDLER_ADD_FIELD) {
      this.dispatchEvent(
        new CustomEvent<RosterHandlerAddDetail>(ROSTER_HANDLER_ADD_EVENT, {
          detail: { lifterId },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    if (field !== ROSTER_HANDLER_REMOVE_FIELD) return;
    // Parsed rather than trusted: the attribute is written from a number here,
    // and read back as the string the DOM stores. A `NaN` would go on to splice
    // nothing out of the entry, which is a press that visibly does nothing --
    // so it is refused here where the reason is legible.
    const position = Number.parseInt(tagOf(event, ROSTER_HANDLER_INDEX_FIELD) ?? '', 10);
    if (!Number.isInteger(position)) return;
    this.dispatchEvent(
      new CustomEvent<RosterHandlerRemoveDetail>(ROSTER_HANDLER_REMOVE_EVENT, {
        detail: { lifterId, index: position },
        bubbles: true,
        composed: true,
      }),
    );
  };

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

/**
 * The nearest `data-` tag of that name on the path a press took.
 *
 * The same walk the root does for `data-field` and `data-lifter`, written here
 * because a press inside this element is answered here: `composedPath()` crosses
 * the shadow boundary of the `ptk-button` the coach actually hit, and
 * `event.target` is the native control inside it.
 */
function tagOf(event: Event, name: string): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.dataset[name] !== undefined) {
      return node.dataset[name];
    }
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-coach-roster': PtkCoachRoster;
  }

  interface HTMLElementEventMap {
    [ROSTER_ADD_EVENT]: CustomEvent<RosterAddDetail>;
    [ROSTER_HANDLER_ADD_EVENT]: CustomEvent<RosterHandlerAddDetail>;
    [ROSTER_HANDLER_REMOVE_EVENT]: CustomEvent<RosterHandlerRemoveDetail>;
  }
}
