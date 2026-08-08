// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The rack a lifter is on, and the gyms they have saved.
 *
 * Two things on one screen, stored in two places, behaving differently -- which is why
 * `EQUIPMENT_NOTES` spends as many sentences on the boundary between them as on the
 * controls. The editor is `settings.equipment`: one snapshot, overwritten as the lifter
 * changes it, no press required. A profile is a row of a library, written only when
 * asked. Confusing the two costs a lifter their rack, so nothing here shares a verb
 * across the line.
 *
 * WHY THE LIVE VALUE IS AN `Equipment` AND NOT THE STORED SNAPSHOT
 *
 * This is the one thing in this file that would be wrong if it were written the obvious
 * way, and it type-checks either way. `equipmentFrom` is lossy on purpose (see
 * `core/equipment.ts`): it hands back a rack whose bar is `CUSTOM_BAR_ID`, whose custom
 * boxes have been overwritten with the resolved preset weights, and whose *other* unit's
 * inventory has been replaced with the catalogue default. All of that is correct for
 * opening a stored rack once, and catastrophic on a render path -- it allocates a fresh
 * object every call, so Lit's identity check always fails and always re-sets the child's
 * property, and `ptk-equipment-setup` has already assigned its own newer value by then.
 * The lifter types, the parent stores, the parent re-renders, and the reconstruction
 * overwrites the child: the bar radio jumps to "Custom" mid-keystroke, and every pair
 * count in the unit they are not looking at is silently wiped, over and over. Half of
 * that is visible and half is discovered weeks later.
 *
 * So the live value is held here as an `Equipment`, `snapshotFrom` runs only when
 * something is written, and `equipmentFrom` runs at exactly two moments: the first time
 * a stored snapshot arrives, and the moment a saved gym is applied. {@link #reseed}
 * is the whole of that rule and the comment on it is the reason it compares rather than
 * assigning.
 *
 * WHY IT WRITES NOTHING ON FIRST PAINT
 *
 * `settings.equipment` is `null` until a lifter has chosen a rack, and that null is read
 * elsewhere as "no rack yet" -- it is what lets the plate-loading card draw nothing
 * rather than draw the default gym's plates under somebody's session. Opening this
 * screen is not choosing a rack. So a null snapshot seeds the editor from the catalogue
 * default and reports nothing; the first report happens when the lifter changes
 * something.
 */

import { DEFAULT_EQUIPMENT as CATALOGUE_DEFAULT, type Equipment } from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-equipment-setup';
import '@platform-toolkit/ui/ptk-text-field';
import {
  EQUIPMENT_CHANGE_EVENT,
  type EquipmentChangeDetail,
} from '@platform-toolkit/ui/ptk-equipment-setup';
import {
  TEXT_FIELD_CHANGE_EVENT,
  type TextFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-text-field';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

import { equipmentFrom, findProfileFor, sameEquipment, snapshotFrom } from '../core/equipment.js';
import type { EquipmentProfile, EquipmentSnapshot, LogbookId } from '../types.js';

import { EQUIPMENT_NOTES } from './copy.js';
import { actionOf, fieldOf, profileOf } from './dataset.js';

/** The tag `defineTrainingLogbook()` registers this under. */
export const EQUIPMENT_LIBRARY_TAG = 'ptk-equipment-library';

/** The rack in front of the lifter changed. Not a saved gym. */
export const RACK_CHANGED_EVENT = 'ptk-rack-changed';
/** The lifter asked to keep the rack in front of them under a name. */
export const PROFILE_SAVED_EVENT = 'ptk-profile-saved';
/** The lifter asked to stand in a gym they saved earlier. */
export const PROFILE_APPLIED_EVENT = 'ptk-profile-applied';
/** The lifter asked to forget a saved gym. Their workouts are not involved. */
export const PROFILE_REMOVED_EVENT = 'ptk-profile-removed';

/** The rack as it should now be stored. */
export interface RackChangedDetail {
  readonly equipment: EquipmentSnapshot;
}

/**
 * A name and the rack to file under it.
 *
 * No identifier and no timestamp, because this element has neither and must not
 * invent them. Whether the name is new or replaces a gym is the root's decision, made
 * against the same list it wrote -- section 12.3.
 */
export interface ProfileSavedDetail {
  readonly name: string;
  readonly equipment: EquipmentSnapshot;
}

/** Which saved gym. */
export interface ProfileIdDetail {
  readonly id: LogbookId;
}

const SAVE_ACTION = 'save-rack';
const USE_ACTION = 'use-rack';
const REMOVE_ACTION = 'remove-rack';
const NAME_FIELD = 'gym-name';

/**
 * The one bound on a name.
 *
 * Past anything a person types on purpose and well short of anything storage would
 * notice, so it exists to keep a row a row rather than to protect the database. The
 * message names the fault rather than the number -- somebody who has pasted a
 * paragraph does not need to be told it was 4,812 characters.
 */
const MAX_NAME_LENGTH = 200;

export class PtkEquipmentLibrary extends LitElement {
  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
    }

    h2 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-md);
    }

    h3 {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
    }

    .note {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
      overflow-wrap: anywhere;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
    }

    .library {
      margin-top: var(--ptk-space-lg);
    }

    ul {
      list-style: none;
      margin: 0 0 var(--ptk-space-sm);
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-xs);
    }

    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ptk-space-xs);
      padding: var(--ptk-space-xs) 0;
      border-block-end: 1px solid var(--ptk-color-border);
    }

    .name {
      flex: 1 1 8rem;
      overflow-wrap: anywhere;
    }

    .in-use {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }
  `;

  /**
   * The rack currently in force, as stored, or `null` where none has been chosen.
   *
   * An input only. What the lifter is editing lives in {@link draft}, and the two are
   * reconciled by {@link #reseed} rather than by rendering one from the other.
   */
  @property({ attribute: false }) equipment: EquipmentSnapshot | null = null;

  @property({ attribute: false }) profiles: readonly EquipmentProfile[] = [];

  /**
   * Whether the library could be read at all.
   *
   * Separate from an empty list, because the two look identical and only one of them
   * makes saving under a familiar name safe.
   */
  @property({ type: Boolean, attribute: 'unreadable' }) unreadable = false;

  /** Whether this device will keep any of it. Passed straight through to the editor. */
  @property({ type: Boolean, attribute: 'remembers' }) remembers = true;

  /** The rack the lifter is actually editing. See the note at the top of this file. */
  @state() private draft: Equipment = CATALOGUE_DEFAULT;

  @state() private name = '';

  @state() private nameError = '';

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(EQUIPMENT_CHANGE_EVENT, this.#onEquipment);
    this.addEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onName);
    this.addEventListener('click', this.#onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(EQUIPMENT_CHANGE_EVENT, this.#onEquipment);
    this.removeEventListener(TEXT_FIELD_CHANGE_EVENT, this.#onName);
    this.removeEventListener('click', this.#onClick);
    super.disconnectedCallback();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('equipment')) this.#reseed();
  }

  /**
   * Waits for the rack editor as well as for this element.
   *
   * Lit's own promise settles once *this* template has committed, which is before the
   * children it just rendered have. Without this, an `await element.updateComplete` in
   * a test resolves against a subtree that has not drawn, and every assertion below it
   * passes or fails on timing. `ptk-equipment-setup` carries the same override for the
   * same reason, and this one is what makes it reachable through this host.
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
   * Takes the stored rack as the live one, but only when it is a different rack.
   *
   * The comparison is the whole point. Every edit the lifter makes travels up as a
   * snapshot, is written, and comes back down this property -- and reseeding on that
   * echo would rebuild the editor's value from a lossy reconstruction between one
   * keystroke and the next. So a snapshot that already describes what is on screen is
   * ignored, and only a genuinely different rack -- a saved gym applied, or a second
   * tab's write arriving -- replaces the draft.
   */
  #reseed(): void {
    const stored = this.equipment;
    // No rack chosen yet. The catalogue default is shown so the pickers open on
    // something real, and nothing is reported: opening this screen is not a choice.
    if (stored === null) return;
    if (sameEquipment(stored, snapshotFrom(this.draft))) return;
    this.draft = equipmentFrom(stored);
  }

  /** The saved gyms in a stable order the storage layer does not promise. */
  #sorted(): readonly EquipmentProfile[] {
    return [...this.profiles].sort((left, right) => left.name.localeCompare(right.name));
  }

  override render(): TemplateResult {
    return html`
      <h2>${EQUIPMENT_NOTES.heading}</h2>
      <p class="note">${EQUIPMENT_NOTES.intro}</p>

      <div class="stack">
        <ptk-equipment-setup
          label=${EQUIPMENT_NOTES.editorSummary}
          .equipment=${this.draft}
          ?remembers=${this.remembers}
        ></ptk-equipment-setup>
        <p class="note">${EQUIPMENT_NOTES.editorNote}</p>
      </div>

      <div class="library">
        <h3>${EQUIPMENT_NOTES.libraryHeading}</h3>
        ${this.#renderLibrary()}
        <div class="stack">
          <ptk-text-field
            data-field=${NAME_FIELD}
            label=${EQUIPMENT_NOTES.nameLabel}
            placeholder=${EQUIPMENT_NOTES.namePlaceholder}
            hint=${EQUIPMENT_NOTES.nameHint}
            error=${this.nameError}
            .value=${this.name}
          ></ptk-text-field>
          <p class="note">${EQUIPMENT_NOTES.saveOverwrites}</p>
          <div>
            <ptk-button variant="secondary" data-action=${SAVE_ACTION}
              >${EQUIPMENT_NOTES.save}</ptk-button
            >
          </div>
        </div>
      </div>
    `;
  }

  /**
   * The saved gyms, or the sentence saying they could not be read.
   *
   * The refusal is in a region that is in the document from the first render and is
   * empty until there is something to say, rather than being returned in the list's
   * place. It arrives from an asynchronous read with nothing else on the screen
   * changing, so a region created at the same moment as its sentence is a sentence
   * roughly half the engines never speak -- `ptk-rest-timer` sets the rule out at
   * length. Polite, because the library is a corner of the home screen and the tool
   * behind it still works.
   */
  #renderLibrary(): TemplateResult {
    const unreadable = this.unreadable;
    return html`
      <div class="unreadable" role="status">
        ${unreadable ? html`<p class="note">${EQUIPMENT_NOTES.libraryUnreadable}</p>` : nothing}
      </div>
      ${unreadable ? nothing : this.#renderProfiles()}
    `;
  }

  #renderProfiles(): TemplateResult {
    const profiles = this.#sorted();
    if (profiles.length === 0) return html`<p class="note">${EQUIPMENT_NOTES.libraryEmpty}</p>`;

    // Against the stored rack rather than against the draft, so the mark says which gym
    // the tool is *using* -- an unsaved edit detaches it, and that is the truth worth
    // showing. `findProfileFor` answers the first match by value, which is all the data
    // can support: `settings.equipment` holds a rack and never a profile identifier.
    const inUse = this.equipment === null ? null : findProfileFor(profiles, this.equipment);
    return html`
      <ul>
        ${profiles.map((profile) => this.#renderRow(profile, profile.id === inUse?.id))}
      </ul>
      <p class="note">${EQUIPMENT_NOTES.removeNote}</p>
    `;
  }

  #renderRow(profile: EquipmentProfile, inUse: boolean): TemplateResult {
    return html`
      <li data-profile=${profile.id}>
        <span class="name">${profile.name}</span>
        ${
          inUse
            ? html`<span class="in-use">${EQUIPMENT_NOTES.inUse}</span>`
            : html`<ptk-button
                variant="quiet"
                data-action=${USE_ACTION}
                accessible-name=${`${EQUIPMENT_NOTES.use}: ${profile.name}`}
                >${EQUIPMENT_NOTES.use}</ptk-button
              >`
        }
        <ptk-button
          variant="quiet"
          data-action=${REMOVE_ACTION}
          accessible-name=${`${EQUIPMENT_NOTES.remove} ${profile.name}`}
          >${EQUIPMENT_NOTES.remove}</ptk-button
        >
      </li>
    `;
  }

  /**
   * The rack editor reported a change.
   *
   * `unitWas` is deliberately dropped. Tool 2 uses it to offer to reinterpret the
   * weights a lifter has typed into *its* fields; there are no such fields here, and
   * the logbook's `displayUnit` is a separate setting about how weights are shown that
   * has no business following the plate unit of a rack.
   */
  readonly #onEquipment = (event: CustomEvent<EquipmentChangeDetail>): void => {
    // Stopped here even though the root stops it again: this element is the boundary
    // for its own child, and a consumer mounting it alone must not have a whole rack
    // escape onto their document. Section 12.5.
    event.stopPropagation();
    this.draft = event.detail.equipment;
    this.dispatchEvent(
      new CustomEvent<RackChangedDetail>(RACK_CHANGED_EVENT, {
        detail: { equipment: snapshotFrom(this.draft) },
        bubbles: true,
        composed: true,
      }),
    );
  };

  readonly #onName = (event: CustomEvent<TextFieldChangeDetail>): void => {
    if (fieldOf(event) !== NAME_FIELD) return;
    event.stopPropagation();
    this.name = event.detail.value;
    // Cleared as they type rather than re-validated. The message answers a press, and
    // leaving it under a box somebody is already fixing reads as a second fault.
    this.nameError = '';
  };

  readonly #onClick = (event: Event): void => {
    switch (actionOf(event)) {
      case SAVE_ACTION:
        this.#save();
        return;
      case USE_ACTION:
        this.#report(PROFILE_APPLIED_EVENT, event);
        return;
      case REMOVE_ACTION:
        this.#report(PROFILE_REMOVED_EVENT, event);
        return;
      default:
        return;
    }
  };

  #save(): void {
    const name = this.name.trim();
    if (name === '') {
      this.nameError = EQUIPMENT_NOTES.nameRequired;
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      this.nameError = EQUIPMENT_NOTES.nameTooLong;
      return;
    }
    this.nameError = '';
    // Emptied on the way out, not on the way back. The field asked one question and it
    // has been answered; leaving the name in it would make the next save look like an
    // accidental second copy of this one.
    this.name = '';
    this.dispatchEvent(
      new CustomEvent<ProfileSavedDetail>(PROFILE_SAVED_EVENT, {
        detail: { name, equipment: snapshotFrom(this.draft) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #report(type: string, event: Event): void {
    const id = profileOf(event);
    if (id === null) return;
    this.dispatchEvent(
      new CustomEvent<ProfileIdDetail>(type, {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-equipment-library': PtkEquipmentLibrary;
  }

  interface HTMLElementEventMap {
    [RACK_CHANGED_EVENT]: CustomEvent<RackChangedDetail>;
    [PROFILE_SAVED_EVENT]: CustomEvent<ProfileSavedDetail>;
    [PROFILE_APPLIED_EVENT]: CustomEvent<ProfileIdDetail>;
    [PROFILE_REMOVED_EVENT]: CustomEvent<ProfileIdDetail>;
  }
}
