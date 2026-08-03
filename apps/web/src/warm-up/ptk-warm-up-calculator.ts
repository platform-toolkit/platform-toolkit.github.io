// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The warm-up calculator: the rack, today's lifts, and a ramp for each.
 *
 * The root element holds the whole of the tool's state and hands slices of it to
 * the three children below it, which own none. That arrangement is what makes a
 * unit switch a single decision made in one place rather than four components
 * agreeing about which unit they are in, and it is what lets every screen in the
 * tool be reached from a story by setting three properties.
 *
 * WHY PERSISTENCE IS INJECTED AND NOT REACHED FOR
 *
 * The two stores arrive as properties, exactly the way `ptk-target-categories`
 * takes its catalogue. A component that called `localStorage` itself would be a
 * component that cannot be tested without one, cannot be rendered in a story
 * twice on one page without the two copies fighting over the same key, and --
 * the case this collection actually ships into -- would throw on property access
 * inside a third-party iframe whose embedder blocked storage. `view.ts` builds
 * the stores and this element uses whatever it is given, including nothing.
 */
import { convertWeight, formatWeight, type WeightUnit } from '@platform-toolkit/domain';
import { createPreferenceStore, type PreferenceStore } from '@platform-toolkit/preferences';
import { CHOICE_CHANGE_EVENT, type Choice, type ChoiceChangeDetail } from '@platform-toolkit/ui';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { DEFAULT_EQUIPMENT, loadEquipment, saveEquipment, type Equipment } from './equipment.js';
import { EQUIPMENT_CHANGE_EVENT, type EquipmentChangeDetail } from './ptk-equipment-setup.js';
import './ptk-equipment-setup.js';
import {
  LIFT_CHANGE_EVENT,
  LIFT_MOVE_EVENT,
  LIFT_REMOVE_EVENT,
  SET_TOGGLE_EVENT,
  type LiftChangeDetail,
  type LiftMoveDetail,
  type LiftRemoveDetail,
  type SetToggleDetail,
} from './ptk-lift-card.js';
import './ptk-lift-card.js';
import {
  ADD_CUSTOM_LIFT_EVENT,
  ADD_LIFT_EVENT,
  type AddCustomLiftDetail,
  type AddLiftDetail,
} from './ptk-lift-picker.js';
import './ptk-lift-picker.js';
import {
  addCustomLift,
  addLift,
  convertEntryWeights,
  loadCompletion,
  loadEntries,
  markKey,
  moveEntry,
  removeEntry,
  saveCompletion,
  saveEntries,
  toggleMark,
  updateEntry,
  type Completion,
  type LiftEntry,
} from './session.js';

/** The field name on the unit-conversion prompt, so its answer is unambiguous. */
const CONVERT_FIELD = 'convert';

/**
 * A unit switch that has happened and has not yet been answered.
 *
 * Held rather than acted on because the two readings of "I switched to pounds"
 * are both common and tens of kilograms apart -- see `convertEntryWeights`. The
 * prompt is the only place in the tool that asks a question it could guess at,
 * and it exists because guessing here produces a warm-up for a weight nobody
 * chose.
 */
interface PendingConversion {
  readonly from: WeightUnit;
  readonly to: WeightUnit;
}

@customElement('ptk-warm-up-calculator')
export class PtkWarmUpCalculator extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    section {
      margin-bottom: var(--ptk-space-lg);
    }

    section:last-child {
      margin-bottom: 0;
    }

    h2 {
      margin: 0 0 var(--ptk-space-md);
      font-size: var(--ptk-font-size-lg);
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-md);
    }

    .empty {
      margin: 0;
      color: var(--ptk-color-text-muted);
    }

    .convert {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-md);
      margin-bottom: var(--ptk-space-md);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
    }

    .convert p {
      margin: 0;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ptk-space-sm);
    }
  `;

  /**
   * Where the rack and today's weights are kept between visits.
   *
   * Defaulted to a store with no backing rather than left undefined, so the
   * element works standing on its own in a story or a test and the tool is the
   * only thing that has to know a browser exists.
   */
  @property({ attribute: false }) settings: PreferenceStore = createPreferenceStore(null);

  /**
   * Where the ticks are kept: per tab, and gone next week.
   *
   * A separate store and not a flag on the first one, because "what I squat" and
   * "which sets I have done today" have different lifetimes and the difference
   * has to be structural. One store with two lifetimes is one line away from
   * remembering last Tuesday's ticks against this Tuesday's ramp.
   */
  @property({ attribute: false }) marks: PreferenceStore = createPreferenceStore(null);

  @state() private equipment: Equipment = DEFAULT_EQUIPMENT;

  @state() private entries: readonly LiftEntry[] = [];

  @state() private completion: Completion = new Set<string>();

  @state() private pending: PendingConversion | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(EQUIPMENT_CHANGE_EVENT, this.#onEquipment);
    this.addEventListener(ADD_LIFT_EVENT, this.#onAdd);
    this.addEventListener(ADD_CUSTOM_LIFT_EVENT, this.#onAddCustom);
    this.addEventListener(LIFT_CHANGE_EVENT, this.#onLiftChange);
    this.addEventListener(LIFT_MOVE_EVENT, this.#onMove);
    this.addEventListener(LIFT_REMOVE_EVENT, this.#onRemove);
    this.addEventListener(SET_TOGGLE_EVENT, this.#onToggle);
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onConvertAnswer);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(EQUIPMENT_CHANGE_EVENT, this.#onEquipment);
    this.removeEventListener(ADD_LIFT_EVENT, this.#onAdd);
    this.removeEventListener(ADD_CUSTOM_LIFT_EVENT, this.#onAddCustom);
    this.removeEventListener(LIFT_CHANGE_EVENT, this.#onLiftChange);
    this.removeEventListener(LIFT_MOVE_EVENT, this.#onMove);
    this.removeEventListener(LIFT_REMOVE_EVENT, this.#onRemove);
    this.removeEventListener(SET_TOGGLE_EVENT, this.#onToggle);
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onConvertAnswer);
    super.disconnectedCallback();
  }

  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }

  /**
   * Reads the stores whenever either of them is handed in or swapped out.
   *
   * Here rather than in `connectedCallback`, and the difference matters: Lit
   * records the class-field defaults as changed on the first update, so this
   * fires once before the first render either way -- but it *also* fires when
   * `view.ts` or a story replaces a store afterwards. Restoring only on connect
   * would show the defaults over a device that remembers something else, and the
   * symptom is a rack that resets on some visits and not others.
   */
  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('settings') || changed.has('marks')) {
      this.#restore();
    }
  }

  override render(): TemplateResult {
    return html`
      <section>
        <ptk-equipment-setup
          .equipment=${this.equipment}
          ?remembers=${this.settings.remembers}
        ></ptk-equipment-setup>
      </section>

      <section>
        <ptk-lift-picker .chosen=${this.#chosenIds()}></ptk-lift-picker>
      </section>

      <section>
        <h2>The plan</h2>
        ${this.#renderConversion()}
        ${
          this.entries.length === 0
            ? html`<p class="empty">Pick a lift above and the warm-up appears here.</p>`
            : html`<div class="cards">
                ${this.entries.map(
                  (entry, index) => html`
                    <ptk-lift-card
                      .entry=${entry}
                      .equipment=${this.equipment}
                      .completion=${this.completion}
                      ?first=${index === 0}
                      ?last=${index === this.entries.length - 1}
                    ></ptk-lift-card>
                  `,
                )}
              </div>`
        }
      </section>
    `;
  }

  #renderConversion(): TemplateResult | typeof nothing {
    const pending = this.pending;
    if (pending === null) return nothing;
    // Offered as a question with two named answers rather than a "convert"
    // button, because the button's absence is not an answer: a lifter who
    // ignores it leaves the tool in a state where nobody -- including the tool
    // -- knows whether the numbers on screen have been reinterpreted.
    const choices: readonly Choice[] = [
      {
        value: 'convert',
        label: `Convert them to ${pending.to}`,
        description: `${example(pending.from)} becomes ${converted(pending.from, pending.to)}.`,
      },
      {
        value: 'keep',
        label: `Leave the numbers as they are`,
        description: `They were meant as ${pending.to} all along.`,
      },
    ];
    return html`
      <div class="convert">
        <p>Today's weights were typed in ${pending.from}. What should happen to them?</p>
        <ptk-choice-group
          data-field=${CONVERT_FIELD}
          label="Weights already entered"
          .choices=${choices}
          .value=${null}
        ></ptk-choice-group>
      </div>
    `;
  }

  #chosenIds(): readonly string[] {
    return this.entries
      .map((entry) => entry.liftId)
      .filter((liftId): liftId is string => liftId !== null);
  }

  /**
   * Reads both stores back into state.
   *
   * The entries are loaded in the unit the equipment is now in, so the order
   * matters: equipment first, then the weights that have to be expressed in its
   * unit, then the ticks, which are only kept where the weight they were made
   * against still matches.
   */
  #restore(): void {
    const equipment = loadEquipment(this.settings);
    const entries = loadEntries(this.settings, equipment.plateUnit);
    this.equipment = equipment;
    this.entries = entries;
    this.completion = loadCompletion(this.marks, entries, equipment);
  }

  #setEquipment(equipment: Equipment): void {
    this.equipment = equipment;
    saveEquipment(this.settings, equipment);
  }

  #setEntries(entries: readonly LiftEntry[]): void {
    this.entries = entries;
    saveEntries(this.settings, entries, this.equipment.plateUnit);
    // Re-derived rather than carried: a weight that changed invalidates the ticks
    // made against it, and that rule lives in `loadCompletion` so there is one
    // copy of it. Saving first means the reload sees what was just typed.
    saveCompletion(this.marks, this.completion, entries, this.equipment);
    this.completion = loadCompletion(this.marks, entries, this.equipment);
  }

  readonly #onEquipment = (event: CustomEvent<EquipmentChangeDetail>): void => {
    const { equipment, unitWas } = event.detail;
    this.#setEquipment(equipment);
    if (unitWas === null || unitWas === equipment.plateUnit) return;
    // Only worth asking when there is something to reinterpret. A lifter who
    // switches units before typing anything gets no prompt at all.
    const typed = this.entries.some((entry) => entry.weight.trim() !== '');
    this.pending = typed ? { from: unitWas, to: equipment.plateUnit } : null;
  };

  readonly #onConvertAnswer = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const pending = this.pending;
    if (pending === null) return;
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.dataset['field'] !== CONVERT_FIELD) continue;
      if (event.detail.value === 'convert') {
        this.#setEntries(convertEntryWeights(this.entries, pending.from, pending.to));
      }
      this.pending = null;
      return;
    }
  };

  readonly #onAdd = (event: CustomEvent<AddLiftDetail>): void => {
    this.#setEntries(addLift(this.entries, event.detail.liftId));
  };

  readonly #onAddCustom = (event: CustomEvent<AddCustomLiftDetail>): void => {
    this.#setEntries(addCustomLift(this.entries, event.detail.name, event.detail.family));
  };

  readonly #onLiftChange = (event: CustomEvent<LiftChangeDetail>): void => {
    this.#setEntries(updateEntry(this.entries, event.detail.key, event.detail.patch));
  };

  readonly #onMove = (event: CustomEvent<LiftMoveDetail>): void => {
    this.#setEntries(moveEntry(this.entries, event.detail.key, event.detail.direction));
  };

  readonly #onRemove = (event: CustomEvent<LiftRemoveDetail>): void => {
    this.#setEntries(removeEntry(this.entries, event.detail.key));
  };

  readonly #onToggle = (event: CustomEvent<SetToggleDetail>): void => {
    const key = markKey(event.detail.key, event.detail.index);
    this.completion = toggleMark(this.completion, key);
    saveCompletion(this.marks, this.completion, this.entries, this.equipment);
  };
}

/** A round hundred in the unit the weights were typed in. */
const EXAMPLE_AMOUNT = 100;

/**
 * A worked example for the conversion prompt, so the choice is concrete.
 *
 * A round hundred in the old unit and what it actually comes to in the new one.
 * Computed through `convertWeight` rather than written out, because a figure
 * typed here is a figure that can disagree with what the tool then does to every
 * weight on the screen -- and the whole purpose of the prompt is to show the
 * lifter which of the two readings they are choosing.
 */
function example(from: WeightUnit): string {
  return formatWeight({ amount: EXAMPLE_AMOUNT, unit: from });
}

function converted(from: WeightUnit, to: WeightUnit): string {
  return formatWeight(convertWeight({ amount: EXAMPLE_AMOUNT, unit: from }, to));
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-warm-up-calculator': PtkWarmUpCalculator;
  }
}
