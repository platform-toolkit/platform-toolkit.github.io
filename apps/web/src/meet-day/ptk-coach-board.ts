// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §21: several lifters at once, on a phone somebody is walking with.
 *
 * The second composing element in this directory, and the same kind of thing as
 * `ptk-live-screen`: `buildBoardView` in `board.ts` has already answered every
 * question -- who is most urgent, what the one action is, which pairs clash,
 * how to load the shared bar -- and this file lays those answers out. Nothing
 * here ranks a lifter, grades a clash, resolves a pound figure or plans a bar.
 *
 * WHAT MAKES IT A BOARD RATHER THAN A LIST OF LIVE SCREENS
 *
 * §21's board is a triage list. A coach reads it sideways, between two rooms,
 * and takes one thing away from it: who to go to and what for. So each row
 * carries the imperative first and everything else under it, and the rows sit
 * under the urgency headings the domain already sorted them into -- a heading
 * per run of rows, never a heading per lifter, because seven boxes of one row
 * each is a list with decoration rather than a triage list.
 *
 * The grouping is built from **maximal runs of the sorted rows**, not from a map
 * keyed by urgency. A map is the obvious spelling and it silently re-sorts: the
 * rows arrive ranked, and collecting them into buckets and rendering the buckets
 * in ladder order would put a row that the domain ranked ninth above one it
 * ranked second the day the two orders diverge. Runs cannot do that -- the rows
 * come out in exactly the order they went in, whatever the grouping finds.
 *
 * COLOUR IS NEVER THE CUE, AND THE PIN NEVER MOVES A ROW
 *
 * Both are §21's own rules and both are easy to break here. The swatch is
 * decorative and sits beside an identifier that says the same thing in
 * characters; `coachBoard` guarantees every row has one. And the pin filters,
 * never sorts -- `coach-board.ts` says outright that a rank a coach has learned
 * to scan cannot change meaning the moment somebody is pinned.
 *
 * WHAT IT DELIBERATELY DOES NOT RENDER
 *
 * `focusLifterId`, which is not a cue on this screen. It is the top row by
 * construction, so a marker on it would repeat the ordering the board already
 * shows and the note above the rows already explains -- and the one state where
 * it would say something new is the filtered one, where the focused lifter is
 * hidden and a marker on nothing is worse than no marker. It is on the view for
 * §21.1's automatic return, which is the route's decision and not this file's.
 *
 * And `row.submission`, because `row.remaining.seconds` is already the clock:
 * `coachBoard` puts the declaration deadline there whenever one is running, so
 * rendering both would put two countdowns on one row, one of them silent for
 * most of the meet and both of them about the same minute.
 *
 * THERE IS NO CLOCK IN THIS FILE
 *
 * The view arrives from a caller wired to `src/clock.ts`, four times a second.
 * That cadence is why the row controls are keyed by lifter id and why the filter
 * is held here rather than reported upward -- see `fields.ts` and the filter
 * below.
 */
import {
  type AttemptWeight,
  type CoachBoardUrgency,
  type WeightUnit,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui';
import { TOGGLE_GROUP_CHANGE_EVENT, type ToggleGroupChangeDetail } from '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import {
  BANKED_HEADING,
  BOARD_CONFLICTS_HEADING,
  BOARD_EMPTY_NOTE,
  BOARD_FILTER_LABEL,
  BOARD_HANDLERS_HEADING,
  BOARD_HEADING,
  BOARD_NO_ATTEMPT,
  BOARD_NO_WEIGHT,
  BOARD_OPEN_LABEL,
  BOARD_ORDER_NOTE,
  NO_PINNED_LIFTERS,
  PINNED_ONLY_LABEL,
  RACK_HEADING,
  RACK_NONE_NOTE,
  approximatePoundsText,
  attemptKilogramsText,
  attemptPoundsText,
  attemptsRemainingText,
  boardActionSentence,
  boardAttemptLine,
  boardCountdownText,
  boardLifterText,
  boardUrgencyLabel,
  conflictCountText,
  conflictOrderText,
  conflictSentence,
  handlerLine,
  openDescription,
  pinDescription,
  pinLabel,
  platformCallLabel,
  rackAdvisorySentence,
  rackLabel,
  rackLoadLine,
  rackSavingText,
  rackTakersText,
  runningTotalText,
  separationText,
} from './copy.js';
import {
  EMPTY_BOARD_VIEW,
  type BoardLifterRef,
  type BoardRowConflict,
  type BoardRowView,
  type BoardView,
} from './board.js';
import { BOARD_LIFTER_FIELD } from './fields.js';

/** §21.1's one-tap switch, reported rather than acted on. */
export interface BoardOpenDetail {
  readonly lifterId: string;
}

/**
 * A pin, carrying the state the press asks for rather than the one it saw.
 *
 * The caller owns the entries, so it could read the current value and invert it
 * -- and those are two different instants. The board repaints four times a
 * second and a pin can also arrive from another surface; between the paint the
 * coach read and the tap that followed it the flag can have moved, and an
 * inverting caller would then undo somebody else's pin. A caller holding both
 * can compare them and decline, which is the same reasoning `UndoRequestDetail`
 * records for the action it carries.
 */
export interface BoardPinDetail {
  readonly lifterId: string;
  /** What the press asks the flag to become. */
  readonly pinned: boolean;
}

export const BOARD_OPEN_EVENT = 'ptk-meet-day-board-open';
export const BOARD_PIN_EVENT = 'ptk-meet-day-board-pin';

/** The filter's one answer. A value, not a `data-field`. */
const PINNED_ONLY_VALUE = 'pinned-only';

/** A run of rows the domain gave the same urgency, in the order it gave them. */
interface BoardGroup {
  readonly urgency: CoachBoardUrgency;
  readonly rows: readonly BoardRowView[];
}

@customElement('ptk-coach-board')
export class PtkCoachBoard extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      gap: var(--ptk-space-lg);
      container-type: inline-size;
    }

    h2,
    h3,
    h4 {
      margin: 0;
    }

    h2 {
      font-size: var(--ptk-font-size-lg);
    }

    h3 {
      font-size: var(--ptk-font-size-md);
    }

    h4 {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
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

    .section {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    /*
     * The urgency heading, drawn as a band rather than as another line of text.
     * A coach scrolling a flight of twenty needs to find where "Clock running"
     * stops, and a heading that looks like the rows under it is not a boundary.
     */
    .band {
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ptk-color-text-muted);
      padding-bottom: var(--ptk-space-xs);
      border-bottom: 1px solid var(--ptk-color-border);
    }

    .rows {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .row {
      display: grid;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .who {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--ptk-space-sm);
    }

    /*
     * Decorative, and sized so it cannot be mistaken for a control. The
     * identifier beside it carries the same fact in characters (§21), so a
     * reader who cannot separate the hues loses nothing by it.
     */
    .swatch {
      inline-size: 0.75rem;
      block-size: 0.75rem;
      border-radius: var(--ptk-radius-sm);
      border: 1px solid var(--ptk-color-border);
      flex: none;
    }

    /* The one thing to do, and the largest text on the row. */
    .action {
      font-size: var(--ptk-font-size-md);
      font-weight: 600;
    }

    .clock {
      font-variant-numeric: tabular-nums;
    }

    .weight {
      font-variant-numeric: tabular-nums;
    }

    .facts {
      display: grid;
      gap: var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
    }

    .clashes {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    /*
     * Two short controls, side by side where there is room and stacked where
     * there is not. The min() around the track is load-bearing (§5.7): without
     * it a 320px column overflows rather than collapsing to one per row.
     */
    .controls {
      display: grid;
      gap: var(--ptk-space-sm);
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
    }

    .loads {
      display: grid;
      gap: var(--ptk-space-sm);
    }

    .load {
      display: grid;
      gap: var(--ptk-space-xs);
    }
  `;

  /**
   * §21, already decided.
   *
   * Defaulted rather than nullable, and the default is the exported empty view
   * for the reason this directory keeps rediscovering: a lit-html property
   * binding assigns over the class-field default, so `.view=${board}` with a
   * nullable `board` puts `null` on a non-null property and the first render
   * throws. Nothing type-checks a lit-html binding. Bind
   * `.view=${board ?? EMPTY_BOARD_VIEW}`.
   */
  @property({ attribute: false }) view: BoardView = EMPTY_BOARD_VIEW;

  /** The unit the coach set. Attempts stay in kilograms; totals follow it (§16). */
  @property({ attribute: false }) unit: WeightUnit = 'kg';

  /**
   * §21.1's filter, held here and reported to nobody.
   *
   * Element-local for §13.6's reason arriving on a different screen: it is a
   * view preference rather than a fact about the meet, nothing else in the tool
   * needs to know it, and this board repaints four times a second -- so routing
   * a checkbox through the root would be a state update on a screen already
   * re-rendering on a timer, to hold a flag the root would only hand straight
   * back. It also means the filter cannot survive into a saved meet document,
   * which is right: a coach who ticked it once at a warm-up rack has not said
   * anything about the meet.
   */
  @state() private pinnedOnly = false;

  override render(): TemplateResult {
    const view = this.view;
    return html`
      ${this.#renderHeader()} ${this.#renderConflicts(view)} ${this.#renderRows(view)}
      ${this.#renderRacks(view)}
    `;
  }

  #renderHeader(): TemplateResult {
    return html`
      <div class="stack">
        <h2>${BOARD_HEADING}</h2>
        <p class="muted">${BOARD_ORDER_NOTE}</p>
      </div>
      <ptk-toggle-group
        label=${BOARD_FILTER_LABEL}
        .choices=${[{ value: PINNED_ONLY_VALUE, label: PINNED_ONLY_LABEL }]}
        .values=${this.pinnedOnly ? [PINNED_ONLY_VALUE] : []}
      ></ptk-toggle-group>
    `;
  }

  /**
   * §21.2 as one figure, off `conflictCount` and never off the rows.
   *
   * A pair appears on both its rows, so summing the per-row lists heads two
   * warnings "4 clashes" -- the tool looking broken in the direction that costs
   * attention, on the one screen that exists to ration it. `board.ts` counts it
   * once and this reads that count.
   */
  #renderConflicts(view: BoardView): TemplateResult | typeof nothing {
    if (view.rows.length === 0) return nothing;
    return html`
      <section class="section">
        <h3>${BOARD_CONFLICTS_HEADING}</h3>
        <p>${conflictCountText(view.conflictCount)}</p>
      </section>
    `;
  }

  /**
   * The rows, or the reason there are none.
   *
   * Two empty states and they are not the same sentence. An empty board is a
   * meet nobody has been added to; an empty filter is a coach who has hidden
   * everybody, and telling them there are no lifters would be a lie they would
   * have to un-tick the box to disprove.
   */
  #renderRows(view: BoardView): TemplateResult {
    if (view.rows.length === 0) {
      return html`<p class="muted">${BOARD_EMPTY_NOTE}</p>`;
    }
    const visible = this.pinnedOnly ? view.rows.filter((row) => row.row.pinned) : view.rows;
    if (visible.length === 0) {
      return html`<p class="muted">${NO_PINNED_LIFTERS}</p>`;
    }
    return html`
      <div class="section">
        ${groupByUrgency(visible).map(
          (group) => html`
            <section class="section">
              <h3 class="band">${boardUrgencyLabel(group.urgency)}</h3>
              <ul class="rows">
                ${group.rows.map((row) => html`<li>${this.#renderRow(row)}</li>`)}
              </ul>
            </section>
          `,
        )}
      </div>
    `;
  }

  #renderRow(entry: BoardRowView): TemplateResult {
    const row = entry.row;
    const countdown = boardCountdownText(row.remaining.seconds);
    const colour = swatchColour(row.colour);
    return html`
      <article class="row">
        <div class="who">
          ${
            colour === null
              ? nothing
              : html`<span
                  class="swatch"
                  aria-hidden="true"
                  style=${styleMap({ backgroundColor: colour })}
                ></span>`
          }
          <span>${boardLifterText(refOf(entry))}</span>
          ${
            row.platformCall === null
              ? nothing
              : html`<span class="muted">${platformCallLabel(row.platformCall)}</span>`
          }
        </div>
        <p class="action">${boardActionSentence(row.nextAction)}</p>
        ${countdown === null ? nothing : html`<p class="clock">${countdown}</p>`}
        ${this.#renderAttempt(entry)}
        <ul class="facts">
          <li>${attemptsRemainingText(row.remaining)}</li>
          <li>${BANKED_HEADING}: ${runningTotalText(row.total, this.unit)}</li>
        </ul>
        ${this.#renderHandlers(entry)} ${this.#renderRowConflicts(entry)}
        ${this.#renderControls(entry)}
      </article>
    `;
  }

  /**
   * The attempt, and the two ways there can fail to be one.
   *
   * `null` on `current` is a lifter with nothing owed; `null` on `proposed` is
   * an attempt owed with no weight on it yet. They are different sentences and
   * they send a coach to different places -- one is finished, the other is the
   * next thing to do -- so neither is rendered as a blank.
   */
  #renderAttempt(entry: BoardRowView): TemplateResult {
    const current = entry.row.current;
    if (current === null) {
      return html`<p class="muted">${BOARD_NO_ATTEMPT}</p>`;
    }
    const weight = entry.proposed;
    return html`
      <div class="stack">
        <p>${boardAttemptLine(current)}</p>
        ${
          weight === null
            ? html`<p class="muted">${BOARD_NO_WEIGHT}</p>`
            : html`
                <p class="weight">${attemptKilogramsText(weight)}</p>
                <p class="muted pounds">${poundsLine(weight)}</p>
              `
        }
      </div>
    `;
  }

  #renderHandlers(entry: BoardRowView): TemplateResult | typeof nothing {
    const handlers = entry.row.handlers;
    if (handlers.length === 0) return nothing;
    return html`
      <div class="stack">
        <h4>${BOARD_HANDLERS_HEADING}</h4>
        <ul class="facts">
          ${handlers.map((handler) => html`<li>${handlerLine(handler)}</li>`)}
        </ul>
      </div>
    `;
  }

  /**
   * §21.2, told from this row's point of view.
   *
   * Three lines, and the second is the one the projection exists for: the
   * domain names one lifter of the pair as the one to serve first, and the same
   * clash is rendered on both rows, so each row gets the sentence that is true
   * of it. `conflictOrderText` answers the tie without inventing a
   * recommendation out of document order.
   */
  #renderRowConflicts(entry: BoardRowView): TemplateResult | typeof nothing {
    if (entry.conflicts.length === 0) return nothing;
    return html`
      <ul class="clashes">
        ${entry.conflicts.map((conflict) => html`<li>${renderConflict(conflict)}</li>`)}
      </ul>
    `;
  }

  /**
   * The two controls, both keyed by lifter id.
   *
   * The accessible names carry the lifter, because a screen reader moving
   * through twenty rows hears "Open, Open, Open" otherwise -- and a coach
   * running two lifters is exactly the reader who cannot afford to guess which
   * row the focus is on.
   */
  #renderControls(entry: BoardRowView): TemplateResult {
    const ref = refOf(entry);
    const pinned = entry.row.pinned;
    return html`
      <div class="controls">
        <ptk-button
          class="open"
          variant="primary"
          data-lifter=${ref.lifterId}
          accessible-name=${openDescription(ref)}
          @click=${this.#onOpen}
          >${BOARD_OPEN_LABEL}</ptk-button
        >
        <ptk-button
          class="pin"
          variant="secondary"
          data-lifter=${ref.lifterId}
          accessible-name=${pinDescription(ref, pinned)}
          @click=${this.#onPin}
          >${pinLabel(pinned)}</ptk-button
        >
      </div>
    `;
  }

  /** §21.4, one panel per shared bar, and a sentence for a room with none. */
  #renderRacks(view: BoardView): TemplateResult {
    if (view.racks.length === 0) {
      return html`
        <section class="section">
          <h3>${RACK_HEADING}</h3>
          <p class="muted">${RACK_NONE_NOTE}</p>
        </section>
      `;
    }
    const refs = refsById(view);
    return html`
      <section class="section">
        <h3>${RACK_HEADING}</h3>
        ${view.racks.map(
          (sequence) => html`
            <section class="section">
              <h4>${rackLabel(sequence.rackId)}</h4>
              <p class="muted">${rackSavingText(sequence)}</p>
              <ul class="loads">
                ${sequence.loads.map(
                  (load) => html`
                    <li class="load">
                      <p class="weight">${rackLoadLine(load)}</p>
                      <p class="muted">
                        ${rackTakersText(
                          load.takers.flatMap((taker) => {
                            const ref = refs.get(taker.lifterId);
                            return ref === undefined ? [] : [ref];
                          }),
                        )}
                      </p>
                    </li>
                  `,
                )}
              </ul>
              ${
                sequence.advisories.length === 0
                  ? nothing
                  : html`<ul class="clashes">
                      ${sequence.advisories.map(
                        (advisory) => html`
                          <li>
                            <ptk-notice tone="info">${rackAdvisorySentence(advisory)}</ptk-notice>
                          </li>
                        `,
                      )}
                    </ul>`
              }
            </section>
          `,
        )}
      </section>
    `;
  }

  readonly #onOpen = (event: Event): void => {
    const lifterId = this.#pressedLifter(event);
    if (lifterId === null) return;
    this.dispatchEvent(
      new CustomEvent<BoardOpenDetail>(BOARD_OPEN_EVENT, {
        detail: { lifterId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  readonly #onPin = (event: Event): void => {
    const lifterId = this.#pressedLifter(event);
    if (lifterId === null) return;
    const row = this.view.rows.find((candidate) => candidate.row.lifterId === lifterId);
    if (row === undefined) return;
    this.dispatchEvent(
      new CustomEvent<BoardPinDetail>(BOARD_PIN_EVENT, {
        detail: { lifterId, pinned: !row.row.pinned },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Which row was pressed, checked against the board rather than trusted.
   *
   * `dataset` is a string out of the DOM, and both listeners sit on a
   * `ptk-button` host -- a press landing on the host's own box, or any caller
   * doing `host.click()`, runs the handler whatever the inner button's state
   * (§13.6). An unchecked id would then be reported for a lifter the board is
   * not showing, and the caller would switch a coach to a live screen for
   * somebody who is not in the meet.
   */
  #pressedLifter(event: Event): string | null {
    const lifterId = attributeOf(event, BOARD_LIFTER_FIELD);
    if (lifterId === null) return null;
    const known = this.view.rows.some((row) => row.row.lifterId === lifterId);
    return known ? lifterId : null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    super.disconnectedCallback();
  }

  readonly #onToggle = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    this.pinnedOnly = event.detail.values.includes(PINNED_ONLY_VALUE);
  };

  /**
   * §5.8: a host whose children are LitElements is not complete when it says so.
   *
   * `super.getUpdateComplete()` resolves once this element's own template has
   * been written to the DOM, which is before the buttons, notices and the
   * filter below it have rendered anything -- and every test here reads text
   * out of those children.
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
 * One clash, as the three things a coach needs to act on it.
 *
 * A module function rather than a method because it reads nothing off the
 * element. The separation is last and is `null` where there is no gap worth
 * stating, which is a real answer -- two moments that coincide have no distance
 * between them and a "0 seconds apart" line would invite a coach to look for
 * one.
 */
function renderConflict(conflict: BoardRowConflict): TemplateResult {
  const separation = separationText(conflict.separationSeconds);
  return html`
    <ptk-notice tone="info">
      <span class="stack">
        <span>${conflictSentence(conflict)}</span>
        <span>${conflictOrderText(conflict)}</span>
        ${separation === null ? nothing : html`<span class="muted">${separation}</span>`}
      </span>
    </ptk-notice>
  `;
}

/**
 * §16 in one line: the published figure, or an approximation labelled as one.
 *
 * `attemptPoundsText` answers `null` where the chart has no row, and the
 * fallback says so rather than printing a bare converted number -- a pound
 * figure beside an attempt that does not say it is a conversion is the one
 * thing §16 forbids outright.
 */
function poundsLine(weight: AttemptWeight): string {
  return attemptPoundsText(weight) ?? approximatePoundsText(weight);
}

/**
 * A colour the browser agrees is a colour, or `null`.
 *
 * **`styleMap` is not a guard, and the obvious reading of it is wrong.** Its
 * `update` path calls `setProperty`, which parses and drops an invalid value --
 * but that path only runs from the *second* render onwards. On the first one it
 * falls back to `render`, which joins the object into `background-color:<value>;`
 * and lit writes that whole string as the `style` attribute. So a colour reading
 * `red; background-image: url(...)` arrives as two declarations, and the second
 * one is whatever the value's author wanted. Measured, not reasoned about: the
 * test asserting the injected `background-image` is empty failed before this
 * existed.
 *
 * `CoachBoardEntry.colour` is documented as a CSS colour and comes from the
 * coach's own device today, which is exactly the kind of "trusted for now" that
 * §24's import turns into a string off somebody else's phone. `CSS.supports`
 * asks the engine the one question worth asking, and a value it does not parse
 * as a colour is not one -- so the row falls back to the identifier beside it,
 * which §21 requires to be sufficient on its own anyway.
 */
function swatchColour(colour: string | null): string | null {
  if (colour === null) return null;
  return CSS.supports('color', colour) ? colour : null;
}

/** A row, as the board itself names the lifter on it. */
function refOf(entry: BoardRowView): BoardLifterRef {
  return {
    lifterId: entry.row.lifterId,
    name: entry.row.name,
    identifier: entry.row.identifier,
  };
}

/**
 * Every lifter on the board, for the rack panel's takers.
 *
 * Built from all the rows and not from the visible ones: a bar is a fact about
 * the room, and a coach filtering down to two pinned lifters still has to know
 * who else is queueing for the weight they are about to change.
 */
function refsById(view: BoardView): Map<string, BoardLifterRef> {
  return new Map(view.rows.map((entry) => [entry.row.lifterId, refOf(entry)]));
}

/**
 * Maximal runs of one urgency, in the order the rows arrived.
 *
 * See the header: a map keyed by urgency is the obvious spelling and it
 * silently re-sorts. This cannot, whatever the rows do.
 */
function groupByUrgency(rows: readonly BoardRowView[]): readonly BoardGroup[] {
  const groups: { urgency: CoachBoardUrgency; rows: BoardRowView[] }[] = [];
  for (const entry of rows) {
    const last = groups.at(-1);
    if (last?.urgency === entry.row.urgency) {
      last.rows.push(entry);
      continue;
    }
    groups.push({ urgency: entry.row.urgency, rows: [entry] });
  }
  return groups;
}

/**
 * The nearest `data-<name>` on the composed path, or `null`.
 *
 * `event.target` is retargeted to this host for anything fired inside a child's
 * own shadow tree (§5.8), so the attribute is unreachable from it and every
 * press would be dropped while the button visibly responded.
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
    'ptk-coach-board': PtkCoachBoard;
  }

  interface HTMLElementEventMap {
    [BOARD_OPEN_EVENT]: CustomEvent<BoardOpenDetail>;
    [BOARD_PIN_EVENT]: CustomEvent<BoardPinDetail>;
  }
}
