// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22.2: what to bring, what to do at the venue, and whatever else you thought of.
 *
 * A tick is the whole interaction, and a lifter makes it with chalk on their
 * hands between sets -- which is why every row is a full-width list row rather
 * than a tile (§5.7), why removal is somewhere else entirely, and why the count
 * is above the list where it is read at a glance rather than counted.
 *
 * `prep.ts` decides which rows this meet reaches; this file draws them and
 * reports presses. It filters nothing, adds nothing and refuses nothing.
 *
 * WHY THREE CONTROLS AND NOT ONE
 *
 * `ptk-toggle-group` reports its *whole* selection on every press, so three
 * groups is three reports and each has to be applied within its own rows or
 * ticking a row under "Bring" clears everything under "Do at the venue". Each
 * group therefore carries `data-group` and the root narrows with
 * `withCheckedRows(prep, within, checked)`. `CHECKLIST_GROUP_FIELD` in
 * `fields.ts` is that attribute's name and is imported by the root rather than
 * by this file -- lit-html interpolates an attribute's value and never its
 * name, so the spelling here has to be a literal, which is also why the two
 * files agree by that constant and not by both writing the word twice.
 *
 * The alternative, one control over all twenty-three rows, loses §22.2's own
 * grouping: "Weigh-in" and "Deadlift socks" are not the same kind of thing, and
 * a lifter at the venue is reading one of those lists and not the other.
 *
 * WHY REMOVAL IS A FOLD AND NOT A BUTTON ON THE ROW
 *
 * Two reasons and either would be enough. `ptk-toggle-group` renders its rows
 * inside its own shadow root, so a control on a row means forking the shared
 * component (§5.8) for one caller. And a remove button beside a tick puts the
 * destructive control at the same size, on the same row, as the one that is hit
 * forty times -- with chalk on the hands, on a 320px column. So the ticks are
 * the list and removal is a separate fold whose buttons name the row they take
 * away, which is also the only thing that distinguishes them to somebody
 * reading one control at a time.
 */
import '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { Choice } from '@platform-toolkit/ui';

import {
  ADD_CUSTOM_ITEM_LABEL,
  CHECKLIST_HEADING,
  CHECKLIST_HINT,
  CUSTOM_ITEM_LABEL,
  CUSTOM_ITEM_PLACEHOLDER,
  PREP_NOTES_HINT,
  PREP_NOTES_LABEL,
  PREP_SCOPE_NOTE,
  REMOVE_CUSTOM_ITEM_HEADING,
  checklistGroupHeading,
  checklistItemLabel,
  checklistProgressText,
  customItemRefusalText,
  removeCustomItemLabel,
  setupProblemText,
} from './copy.js';
import {
  CUSTOM_ITEM_FIELD,
  CUSTOM_ITEM_ID_FIELD,
  PREP_NOTES_FIELD,
  REMOVE_CUSTOM_ITEM_FIELD,
} from './fields.js';
import {
  CHECKLIST_GROUPS,
  EMPTY_PREP,
  checklistFor,
  checklistProgress,
  prepNotesProblem,
  type ChecklistContext,
  type ChecklistGroup,
  type ChecklistRow,
  type CustomItemRefusal,
  type MeetPrep,
} from './prep.js';

/**
 * The list for a meet nobody has described yet.
 *
 * The three defaults `EMPTY_SESSION` opens with, spelled again rather than
 * imported: a `PlannerSession` is a much larger thing and reaching for it here
 * would make this element depend on the whole of the planning state to name one
 * format. What matters is the *direction* of each, and all three go the same
 * way -- `full-power` contests every lift and `unstated` equipment is not
 * equipped, so the default list is the widest one that claims nothing. A
 * narrower default would hide rows before the lifter has said anything, and a
 * hidden row is one nobody packs.
 */
const DEFAULT_CONTEXT: ChecklistContext = {
  format: 'full-power',
  equipment: 'unstated',
  goal: 'balanced',
};

/**
 * A press of Add, carrying the text rather than leaving the root to read it.
 *
 * The same reasoning `ROSTER_ADD_EVENT` records: the root owns the box's value,
 * so reading it back in the handler is a second instant. The text arrives here
 * as a property and goes back out with the press, which makes the row that is
 * added the row that was on screen.
 */
export const PREP_ADD_ITEM_EVENT = 'ptk-meet-day-prep-add-item';

export interface PrepAddItemDetail {
  readonly text: string;
}

/**
 * A press of one of the remove buttons, carrying the item id.
 *
 * By id and never by position, for the reason `REMOVE_CUSTOM_ITEM_FIELD` gives:
 * the list is rebuilt on every change, so an index names whichever row moved
 * into that place, and the failure is a row deleted that nobody asked to
 * delete.
 */
export const PREP_REMOVE_ITEM_EVENT = 'ptk-meet-day-prep-remove-item';

export interface PrepRemoveItemDetail {
  readonly itemId: string;
}

@customElement('ptk-meet-checklist')
export class PtkMeetChecklist extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .checklist {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    h3 {
      margin: 0;
      font-size: var(--ptk-font-size-lg);
    }

    p {
      margin: 0;
    }

    .hint,
    .scope {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * The one number read at a glance, so it is set apart from the sentence
     * above it rather than folded into it.
     */
    .progress {
      font-weight: 600;
    }

    .groups {
      display: grid;
      gap: var(--ptk-space-lg);
    }

    .add,
    .removals {
      display: grid;
      gap: var(--ptk-space-sm);
      justify-items: start;
    }

    /*
     * Every control here stretches. One sized to its own label ends wherever
     * the label happens to end, which on a 320px column is a button floating in
     * the middle of a row a thumb is aiming at (§5.7) -- and on the removal
     * buttons, whose labels are the rows themselves, it would be a different
     * width per row.
     */
    .add ptk-text-field,
    .add ptk-button,
    .removals ptk-button {
      width: 100%;
    }
  `;

  @property({ attribute: false }) prep: MeetPrep = EMPTY_PREP;

  /** Which rows this meet reaches. The root holds the answers it is built from. */
  @property({ attribute: false }) context: ChecklistContext = DEFAULT_CONTEXT;

  /** The add box's contents. Owned by the root, so an accepted add can clear it. */
  @property({ type: String, attribute: 'custom-item-text' }) customItemText = '';

  /** Why the last add was refused, or `null`. The root applies; this renders. */
  @property({ attribute: false }) refusal: CustomItemRefusal | null = null;

  override render(): TemplateResult {
    const rows = checklistFor(this.prep, this.context);
    const progress = checklistProgress(rows);
    return html`
      <section class="checklist">
        <div>
          <h3>${CHECKLIST_HEADING}</h3>
          <p class="hint">${CHECKLIST_HINT}</p>
        </div>
        <p class="progress">${checklistProgressText(progress.done, progress.total)}</p>
        <div class="groups">${CHECKLIST_GROUPS.map((group) => this.#renderGroup(group, rows))}</div>
        ${this.#renderAdd()} ${this.#renderRemovals(rows)} ${this.#renderNotes()}
        <p class="scope">${PREP_SCOPE_NOTE}</p>
      </section>
    `;
  }

  /**
   * One group, or nothing at all when this meet reaches none of its rows.
   *
   * Rather than `ptk-toggle-group`'s own `emptyMessage`, which would put a
   * heading and a sentence on the screen for a list that is not a list. "Yours"
   * is the group that is normally empty -- it exists only once somebody adds a
   * row -- and a permanent empty heading reads as a feature that is broken
   * rather than one that has not been used.
   */
  #renderGroup(
    group: ChecklistGroup,
    rows: readonly ChecklistRow[],
  ): TemplateResult | typeof nothing {
    const within = rows.filter((row) => row.group === group);
    if (within.length === 0) return nothing;

    const choices: readonly Choice[] = within.map((row) => ({
      value: row.itemId,
      label: rowLabel(row),
    }));
    return html`
      <ptk-toggle-group
        data-group=${group}
        layout="list"
        label=${checklistGroupHeading(group)}
        .choices=${choices}
        .values=${within.filter((row) => row.done).map((row) => row.itemId)}
      ></ptk-toggle-group>
    `;
  }

  #renderAdd(): TemplateResult {
    return html`
      <div class="add">
        <ptk-text-field
          data-field=${CUSTOM_ITEM_FIELD}
          label=${CUSTOM_ITEM_LABEL}
          placeholder=${CUSTOM_ITEM_PLACEHOLDER}
          .value=${this.customItemText}
          error=${this.refusal === null ? '' : customItemRefusalText(this.refusal)}
        ></ptk-text-field>
        <ptk-button @click=${this.#onAdd}>${ADD_CUSTOM_ITEM_LABEL}</ptk-button>
      </div>
    `;
  }

  /**
   * The removal fold, which is absent rather than empty until there is a row.
   *
   * Shut by default: it is the one destructive control on the screen, and the
   * screen it is on is tapped forty times in a warm-up room.
   */
  #renderRemovals(rows: readonly ChecklistRow[]): TemplateResult | typeof nothing {
    const custom = rows.filter((row) => row.kind === 'custom');
    if (custom.length === 0) return nothing;

    return html`
      <ptk-disclosure label=${REMOVE_CUSTOM_ITEM_HEADING}>
        <div class="removals" @click=${this.#onRemove}>
          ${custom.map(
            (row) => html`
              <ptk-button data-field=${REMOVE_CUSTOM_ITEM_FIELD} data-item=${row.itemId}
                >${removeCustomItemLabel(rowLabel(row))}</ptk-button
              >
            `,
          )}
        </div>
      </ptk-disclosure>
    `;
  }

  /**
   * §22's notes, below the add box because a refusal points down here.
   *
   * `customItemRefusalText('too-long')` reads "Shorten it, or put the detail in
   * the notes below", so the two are in that order on the screen and not by
   * coincidence. Moving the notes above the checklist would make that sentence
   * point at nothing.
   */
  #renderNotes(): TemplateResult {
    const problem = prepNotesProblem(this.prep.notes);
    return html`
      <ptk-text-area
        data-field=${PREP_NOTES_FIELD}
        label=${PREP_NOTES_LABEL}
        hint=${PREP_NOTES_HINT}
        rows="5"
        .value=${this.prep.notes}
        error=${problem === null ? '' : setupProblemText(problem)}
      ></ptk-text-area>
    `;
  }

  readonly #onAdd = (): void => {
    this.dispatchEvent(
      new CustomEvent<PrepAddItemDetail>(PREP_ADD_ITEM_EVENT, {
        detail: { text: this.customItemText },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * One delegated listener over the fold, reading `data-item` off the path.
   *
   * Not a closure per button. The id is already on the control -- `fields.ts`
   * declares the attribute pair for it -- and a press is then identified the
   * same way every other control in this tool is, which is the one thing that
   * keeps the handlers in the root from drifting into reading different keys.
   * The guard is not decoration: this listens on a container, so a press
   * landing in the gap between two buttons arrives here with no id on the path.
   */
  readonly #onRemove = (event: Event): void => {
    if (attributeOf(event, 'field') !== REMOVE_CUSTOM_ITEM_FIELD) return;
    const itemId = attributeOf(event, CUSTOM_ITEM_ID_FIELD);
    if (itemId === null) return;
    this.dispatchEvent(
      new CustomEvent<PrepRemoveItemDetail>(PREP_REMOVE_ITEM_EVENT, {
        detail: { itemId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  /**
   * Lit settles when this element's template is committed, which is before the
   * children it just handed choices to have rendered any (§5.8).
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

/** A default row is named by `copy.ts`; a row somebody added names itself. */
function rowLabel(row: ChecklistRow): string {
  return row.kind === 'custom' ? row.text : checklistItemLabel(row.itemId);
}

/** The nearest `data-<name>` on the composed path, or `null`. */
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
    'ptk-meet-checklist': PtkMeetChecklist;
  }

  interface HTMLElementEventMap {
    [PREP_ADD_ITEM_EVENT]: CustomEvent<PrepAddItemDetail>;
    [PREP_REMOVE_ITEM_EVENT]: CustomEvent<PrepRemoveItemDetail>;
  }
}
