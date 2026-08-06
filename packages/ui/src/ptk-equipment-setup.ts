// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What the lifter has: the unit, the bar, the collars, and the plates.
 *
 * Shared chrome, though it knows that a 25 kg plate is competition diameter and
 * that a bar has a weight. Naming a domain concept was the old test for keeping
 * an element in a tool; the real test is whether a second package would have to
 * fork it. The training logbook became the third consumer and is itself a
 * package, so it cannot import from `apps/web` -- and `ptk-plate-stack` had been
 * here on the same footing all along. The vocabulary comes from
 * `@platform-toolkit/domain`, so nothing is duplicated to pay for the move.
 *
 * It touches no storage. An `Equipment` arrives as a property and a new one
 * leaves on an event, which is what lets every state of this screen -- an empty
 * rack, a custom bar, a coarse inventory -- be reached from a story and a test
 * with nothing persisted anywhere.
 *
 * WHY IT FOLDS
 *
 * Nine denominations, a bar, collars and a unit is a screenful before a single
 * number appears, and a lifter changes all of it once and then never again. So it
 * lives inside `ptk-disclosure`, and the summary line -- the whole of what has to
 * be true for the numbers below to be right -- stays on screen while the controls
 * do not.
 *
 * WHY A CUSTOM WEIGHT CARRIES ITS OWN UNIT
 *
 * A custom bar and custom collars each get a unit control of their own, and
 * switching the plate unit leaves both alone. The two alternatives are worse in
 * ways that are hard to see afterwards. Converting the figure means 20 kg becomes
 * 44.09 lb becomes 20.0002 kg, and a lifter flicking between units twice watches
 * their bar drift -- the exact failure the weight module exists to prevent.
 * Re-labelling the figure without converting turns a 20 kg bar into a 20 lb bar
 * and moves every number on the screen. A separate control costs two radios that
 * only appear when "Custom" is chosen, and it is the only version where what the
 * screen says is what the bar weighs.
 */
import {
  BAR_PRESETS,
  COLLAR_PRESETS,
  CUSTOM_BAR_ID,
  CUSTOM_COLLAR_ID,
  DENOMINATIONS,
  MICRO_DENOMINATIONS,
  barLabel,
  denomination,
  describeEquipment,
  formatWeight,
  microPlateState,
  setMicroPlates,
  toggleDenomination,
  updateDenomination,
  type Equipment,
  type PlateDenomination,
  type Weight,
  type WeightUnit,
} from '@platform-toolkit/domain';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// `ptk-disclosure` is rendered but nothing else here imports it, and a
// side-effect import is the only thing that registers it. Reaching the siblings
// through the package barrel used to do this for free; from inside the package
// that would be a self-import, so the fold would render as an inert element with
// its children showing -- which looks close enough to right that a story and a
// text assertion both pass.
import './ptk-disclosure.js';
import { parseCount, parseWeight } from './field-reading.js';
import { CHOICE_CHANGE_EVENT, type Choice, type ChoiceChangeDetail } from './ptk-choice-group.js';
import { NUMBER_FIELD_CHANGE_EVENT, type NumberFieldChangeDetail } from './ptk-number-field.js';
import { TOGGLE_GROUP_CHANGE_EVENT, type ToggleGroupChangeDetail } from './ptk-toggle-group.js';

/** Fired whenever the lifter changes anything about the rack. */
export interface EquipmentChangeDetail {
  readonly equipment: Equipment;
  /**
   * The unit the plates were in before, when this change switched it.
   *
   * The tool needs it to offer converting the weights already typed into the
   * lift rows, which is an explicit action rather than something that happens
   * underneath a lifter.
   */
  readonly unitWas: WeightUnit | null;
}

export const EQUIPMENT_CHANGE_EVENT = 'ptk-equipment-change';

/**
 * Bounds on a custom bar, custom collars, and a pair count.
 *
 * These restate what the preferences package will accept, and that restatement
 * is load-bearing rather than defensive: writing a value that violates its own
 * definition throws by design (§5.12), so a bar of 1e308 typed into this box
 * would take the screen down instead of showing a sentence. Saying it here is
 * what keeps that write unreachable.
 */
const CUSTOM_BAR_RANGE = { min: 1, max: 200 } as const;
const CUSTOM_COLLAR_RANGE = { min: 0, max: 50 } as const;
const MAX_PAIRS = 40;

@customElement('ptk-equipment-setup')
export class PtkEquipmentSetup extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .sections {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-lg);
    }

    .custom {
      margin-top: var(--ptk-space-md);
    }

    .details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
      gap: var(--ptk-space-md);
    }

    .detail {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
    }

    .detail-name {
      font-weight: 600;
    }

    .switch {
      display: flex;
      align-items: center;
      gap: var(--ptk-space-sm);
      min-height: var(--ptk-tap-target-min);
      cursor: pointer;
    }

    /* The label beside a box has to be allowed to wrap, and a flex item will not
       shrink under its longest word without being told to. "Full diameter" sits
       four levels of padding deep in the plate details, and at 200% text one word
       of it is wider than the box it is in. */
    .switch > span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .note {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .nested {
      margin-top: var(--ptk-space-md);
    }
  `;

  @property({ attribute: false }) equipment!: Equipment;

  /**
   * What the fold calls itself.
   *
   * A property because the second consumer puts this element *under* a heading of
   * its own: the training logbook's equipment screen is a section called Equipment
   * with a library of saved gyms beside the editor, and a fold inside it also
   * labelled "Equipment" would give one screen two of the same name and leave a
   * screen reader's landmark list saying it twice. There the label says which of
   * the two racks this one is. The default is the name tool 2 has always used, so
   * nothing that does not set it changes.
   */
  @property({ type: String }) label = 'Equipment';

  /** Whether the section starts unfolded. The tool decides; this only reports. */
  @property({ type: Boolean, reflect: true }) open = false;

  /**
   * Whether the tool is able to remember any of this.
   *
   * Rendered as a plain sentence rather than hidden, because a lifter who sets
   * up a rack in a private window and comes back to defaults deserves to have
   * been told, and the store already knows the answer before anything is typed.
   */
  @property({ type: Boolean, attribute: 'remembers' }) remembers = true;

  /**
   * What is in each free-typing field, as typed.
   *
   * Rendering these from the parsed equipment would delete a keystroke: `20.`
   * parses to 20, re-renders as `20`, and the decimal point the lifter just
   * pressed is gone. So the text is held here and only a figure that parses is
   * pushed up. Keys carry the unit, because the kilogram 25 and the pound 25 are
   * different denominations that would otherwise share a box.
   */
  @state() private typed: Readonly<Record<string, string>> = {};

  override connectedCallback(): void {
    super.connectedCallback();
    // One delegated listener per event rather than a binding per control: the
    // events are composed, so they reach this host from every child, and a
    // single listener cannot fall out of step with the list of controls.
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.addEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
    this.removeEventListener(TOGGLE_GROUP_CHANGE_EVENT, this.#onToggle);
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    super.disconnectedCallback();
  }

  /**
   * Resolves once the controls have rendered too, not just this element.
   *
   * Lit's own promise settles when this template is committed -- which sets
   * `.choices` on a child and leaves the child's render queued. A caller awaiting
   * only the host is reading a subtree that happens to have caught up.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const children = [...(this.shadowRoot?.querySelectorAll('*') ?? [])].filter(
      // A comma-separated selector resolves to `Element` rather than a union of
      // the tag map's entries, so the narrowing is done here instead. Filtering
      // on the base class also picks up any element added to the template later
      // without this list having to be edited to match.
      (child): child is LitElement => child instanceof LitElement,
    );
    await Promise.all(children.map((child) => child.updateComplete));
    return complete;
  }

  override render(): TemplateResult {
    const unit = this.equipment.plateUnit;
    return html`
      <ptk-disclosure
        label=${this.label}
        summary=${describeEquipment(this.equipment)}
        ?open=${this.open}
      >
        <div class="sections">
          <ptk-choice-group
            data-field="unit"
            label="Plate unit"
            .choices=${UNIT_CHOICES}
            .value=${unit}
          ></ptk-choice-group>

          ${this.#renderBar()} ${this.#renderCollars()} ${this.#renderPlates(unit)}
          ${
            this.remembers
              ? nothing
              : html`<p class="note">
                  This device is not letting the page remember settings, so the rack resets when the
                  page is closed.
                </p>`
          }
        </div>
      </ptk-disclosure>
    `;
  }

  #renderBar(): TemplateResult {
    const choices: readonly Choice[] = [
      ...BAR_PRESETS.map((preset) => ({
        value: preset.id,
        label: barLabel(this.equipment, preset.id),
      })),
      { value: CUSTOM_BAR_ID, label: 'Custom bar' },
    ];
    return html`
      <div>
        <ptk-choice-group
          data-field="bar"
          label="Bar"
          .choices=${choices}
          .value=${this.equipment.barId}
        ></ptk-choice-group>
        ${
          this.equipment.barId === CUSTOM_BAR_ID
            ? this.#renderCustomWeight(
                'custom-bar',
                'Custom bar weight',
                this.equipment.customBar,
                CUSTOM_BAR_RANGE,
              )
            : nothing
        }
      </div>
    `;
  }

  #renderCollars(): TemplateResult {
    const choices: readonly Choice[] = [
      ...COLLAR_PRESETS.map((preset) => ({
        value: preset.id,
        label:
          preset.weight.amount === 0
            ? preset.name
            : `${preset.name}, ${formatWeight(preset.weight)}`,
      })),
      { value: CUSTOM_COLLAR_ID, label: 'Custom collars' },
    ];
    return html`
      <div>
        <ptk-choice-group
          data-field="collars"
          label="Collars"
          .choices=${choices}
          .value=${this.equipment.collarId}
        ></ptk-choice-group>
        ${
          this.equipment.collarId === CUSTOM_COLLAR_ID
            ? this.#renderCustomWeight(
                'custom-collars',
                'Custom collar weight, the pair',
                this.equipment.customCollars,
                CUSTOM_COLLAR_RANGE,
              )
            : nothing
        }
      </div>
    `;
  }

  #renderCustomWeight(
    field: string,
    label: string,
    weight: Weight,
    range: { readonly min: number; readonly max: number },
  ): TemplateResult {
    const text = this.typed[field] ?? String(weight.amount);
    return html`
      <div class="custom">
        <ptk-number-field
          data-field=${field}
          label=${label}
          .value=${text}
          unit=${weight.unit}
          error=${weightError(text, weight.unit, range)}
        ></ptk-number-field>
        <div class="custom">
          <ptk-choice-group
            data-field=${`${field}-unit`}
            label="Measured in"
            .choices=${UNIT_CHOICES}
            .value=${weight.unit}
          ></ptk-choice-group>
        </div>
      </div>
    `;
  }

  #renderPlates(unit: WeightUnit): TemplateResult {
    const offered = DENOMINATIONS[unit];
    const choices: readonly Choice[] = offered.map((weight) => ({
      value: String(weight),
      label: `${weight} ${unit}`,
    }));
    const selected = this.equipment.inventory[unit];
    const micro = microPlateState(this.equipment, unit);
    const largestMicro = MICRO_DENOMINATIONS[unit][0];
    return html`
      <div>
        <ptk-toggle-group
          data-field="plates"
          label="Plates on the rack"
          .choices=${choices}
          .values=${selected.map((plate) => String(plate.weight))}
          empty-message="No plate denominations are offered for this unit."
        ></ptk-toggle-group>
        <label class="switch">
          <input
            type="checkbox"
            data-field="micro-all"
            .checked=${micro !== 'none'}
            .indeterminate=${micro === 'some'}
            @change=${(event: Event) => {
              this.#onMicroPlates(unit, event);
            }}
          />
          <span
            >All fractional
            plates${
              largestMicro === undefined ? nothing : html` (${largestMicro} ${unit} and under)`
            }</span
          >
        </label>
        <p class="note">
          The small plates sold as a bagged set. Untick any one above that is not in the bag.
        </p>
        ${
          selected.length === 0
            ? html`<p class="note">
                With no plates selected every lift warms up on the bar alone.
              </p>`
            : html`<div class="nested">
                <ptk-disclosure
                  label="Plate details"
                  summary=${describePlateDetails(selected, unit)}
                >
                  <div class="details">
                    ${selected.map((plate) => this.#renderPlateDetail(plate, unit))}
                  </div>
                </ptk-disclosure>
              </div>`
        }
      </div>
    `;
  }

  #renderPlateDetail(plate: PlateDenomination, unit: WeightUnit): TemplateResult {
    const field = `pairs:${unit}:${plate.weight}`;
    const text = this.typed[field] ?? (plate.pairs === null ? '' : String(plate.pairs));
    return html`
      <div class="detail">
        <span class="detail-name">${plate.weight} ${unit}</span>
        <ptk-number-field
          data-field=${field}
          label="Pairs on the rack"
          .value=${text}
          placeholder="Plenty"
          hint="Leave blank if there are always enough."
          error=${pairsError(text)}
        ></ptk-number-field>
        <label class="switch">
          <input
            type="checkbox"
            data-field=${`full:${unit}:${plate.weight}`}
            .checked=${plate.fullDiameter}
            @change=${(event: Event) => {
              this.#onFullDiameter(unit, plate.weight, event);
            }}
          />
          <span>Full diameter</span>
        </label>
      </div>
    `;
  }

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    const field = fieldOf(event);
    const chosen = event.detail.value;
    if (field === 'unit') {
      const unit = chosen === 'lb' ? 'lb' : 'kg';
      if (unit === this.equipment.plateUnit) return;
      this.#report({ ...this.equipment, plateUnit: unit }, this.equipment.plateUnit);
      return;
    }
    if (field === 'bar') {
      this.#report({ ...this.equipment, barId: chosen }, null);
      return;
    }
    if (field === 'collars') {
      this.#report({ ...this.equipment, collarId: chosen }, null);
      return;
    }
    const unit = chosen === 'lb' ? 'lb' : 'kg';
    if (field === 'custom-bar-unit') {
      this.#report({ ...this.equipment, customBar: { ...this.equipment.customBar, unit } }, null);
      return;
    }
    if (field === 'custom-collars-unit') {
      this.#report(
        { ...this.equipment, customCollars: { ...this.equipment.customCollars, unit } },
        null,
      );
    }
  };

  readonly #onToggle = (event: CustomEvent<ToggleGroupChangeDetail>): void => {
    if (fieldOf(event) !== 'plates') return;
    const weight = Number(event.detail.value);
    // The value came out of `dataset`-adjacent DOM state, so it is checked
    // against the offered list rather than trusted: a denomination that is not
    // offered would otherwise be written into the inventory with no checkbox
    // beside it, unremovable, and every ramp would keep using it.
    if (!DENOMINATIONS[this.equipment.plateUnit].includes(weight)) return;
    this.#report(toggleDenomination(this.equipment, this.equipment.plateUnit, weight), null);
  };

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = fieldOf(event);
    if (field === null) return;
    const text = event.detail.value;
    this.typed = { ...this.typed, [field]: text };

    if (field === 'custom-bar') {
      const amount = readWeight(text, this.equipment.customBar.unit, CUSTOM_BAR_RANGE);
      if (amount === null) return;
      this.#report({ ...this.equipment, customBar: { ...this.equipment.customBar, amount } }, null);
      return;
    }
    if (field === 'custom-collars') {
      const amount = readWeight(text, this.equipment.customCollars.unit, CUSTOM_COLLAR_RANGE);
      if (amount === null) return;
      this.#report(
        { ...this.equipment, customCollars: { ...this.equipment.customCollars, amount } },
        null,
      );
      return;
    }

    const pairs = pairsField(field);
    if (pairs === null) return;
    // An empty box is a real answer here -- "enough of these" -- and it is the
    // one answer a lifter reaches by deleting rather than typing, so it must not
    // be treated as a half-finished number and ignored.
    if (text.trim() === '') {
      this.#report(
        updateDenomination(this.equipment, pairs.unit, pairs.weight, { pairs: null }),
        null,
      );
      return;
    }
    const reading = parseCount(text, 'pairs', MAX_PAIRS);
    if (!reading.ok) return;
    this.#report(
      updateDenomination(this.equipment, pairs.unit, pairs.weight, { pairs: reading.value }),
      null,
    );
  };

  /**
   * The whole fractional set at once.
   *
   * Partly on reads as on, so the switch clears the remainder rather than
   * refusing to move. The individual chips above stay the authority -- this is
   * a shortcut past four taps, not a mode.
   */
  #onMicroPlates(unit: WeightUnit, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    this.#report(setMicroPlates(this.equipment, unit, input.checked), null);
  }

  #onFullDiameter(unit: WeightUnit, weight: number, event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (denomination(this.equipment, unit, weight) === null) return;
    this.#report(
      updateDenomination(this.equipment, unit, weight, { fullDiameter: input.checked }),
      null,
    );
  }

  #report(equipment: Equipment, unitWas: WeightUnit | null): void {
    this.equipment = equipment;
    this.dispatchEvent(
      new CustomEvent<EquipmentChangeDetail>(EQUIPMENT_CHANGE_EVENT, {
        detail: { equipment, unitWas },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/**
 * Which control an event came from, or `null` if it did not come from one.
 *
 * Read from the composed path, not from `event.target`. A listener on the host
 * sees the target retargeted to the host itself -- the control that fired lives
 * in its own tree and the platform hides that from the outside on purpose -- so
 * `event.target.dataset` is empty and every answer is dropped. The symptom is a
 * screen whose controls visibly respond while nothing is recorded.
 */
function fieldOf(event: Event): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.dataset['field'] !== undefined) {
      return node.dataset['field'];
    }
  }
  return null;
}

/** The unit and denomination a `pairs:kg:25` field is about, if it is one. */
function pairsField(field: string): { unit: WeightUnit; weight: number } | null {
  const [kind, unit, weight] = field.split(':');
  if (kind !== 'pairs' || weight === undefined) return null;
  if (unit !== 'kg' && unit !== 'lb') return null;
  const amount = Number(weight);
  if (!DENOMINATIONS[unit].includes(amount)) return null;
  return { unit, weight: amount };
}

/** The figure in a custom-weight box, or `null` while it is not usable yet. */
function readWeight(
  text: string,
  unit: WeightUnit,
  range: { readonly min: number; readonly max: number },
): number | null {
  const reading = parseWeight(text, unit);
  if (!reading.ok) return null;
  if (reading.value < range.min || reading.value > range.max) return null;
  return reading.value;
}

/** What to say about a custom weight, or nothing while it is fine or empty. */
function weightError(
  text: string,
  unit: WeightUnit,
  range: { readonly min: number; readonly max: number },
): string {
  const reading = parseWeight(text, unit);
  if (!reading.ok) return reading.message ?? '';
  if (reading.value < range.min) return `Enter a weight of ${String(range.min)} ${unit} or more.`;
  if (reading.value > range.max) return `Enter a weight of ${String(range.max)} ${unit} or less.`;
  return '';
}

function pairsError(text: string): string {
  const reading = parseCount(text, 'pairs', MAX_PAIRS);
  return reading.ok ? '' : (reading.message ?? '');
}

/** The summary line for the folded plate-details section. */
function describePlateDetails(plates: readonly PlateDenomination[], unit: WeightUnit): string {
  const limited = plates.filter((plate) => plate.pairs !== null);
  const full = plates.filter((plate) => plate.fullDiameter);
  const parts = [
    limited.length === 0
      ? 'plenty of every plate'
      : limited.map((plate) => `${String(plate.pairs)}× ${plate.weight} ${unit}`).join(', '),
    full.length === 0
      ? 'none full diameter'
      : `full diameter: ${full.map((plate) => `${plate.weight} ${unit}`).join(', ')}`,
  ];
  return parts.join(' • ');
}

const UNIT_CHOICES: readonly Choice[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
];

declare global {
  interface HTMLElementTagNameMap {
    'ptk-equipment-setup': PtkEquipmentSetup;
  }

  interface HTMLElementEventMap {
    [EQUIPMENT_CHANGE_EVENT]: CustomEvent<EquipmentChangeDetail>;
  }
}
