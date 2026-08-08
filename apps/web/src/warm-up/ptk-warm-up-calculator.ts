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
import type { PreferenceStore } from '@platform-toolkit/preferences';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-equipment-setup';
import {
  CHOICE_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  EQUIPMENT_CHANGE_EVENT,
  type EquipmentChangeDetail,
} from '@platform-toolkit/ui/ptk-equipment-setup';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { DEFAULT_EQUIPMENT, loadEquipment, saveEquipment, type Equipment } from './equipment.js';
import type { LogbookHandoff } from './handoff.js';
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
  loggableSession,
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
      margin-top: var(--ptk-space-md);
    }

    .log {
      display: inline-flex;
      align-items: center;
      min-height: var(--ptk-tap-target-min);
      /* Its own line and not part of a sentence, because an inline link is as
         tall as its line box and no amount of padding grows the hit area
         without overlapping the prose above it -- section 5.7. The accent is
         set here for the reason tool 4's citation gives: tokens.css styles
         links at document level and cannot reach inside a shadow root, so this
         would otherwise be the UA blue, which is poor contrast in the dark
         theme. The underline stays; colour is never the only signal. */
      color: var(--ptk-color-accent);
    }

    .note {
      margin: var(--ptk-space-sm) 0 0;
      color: var(--ptk-color-text-muted);
    }
  `;

  /**
   * Where the rack and today's weights are kept between visits.
   *
   * `null` means remember nothing, and it is the default because a host that has
   * not said where to put anything has not chosen an inert store either -- that
   * is a placement, and picking one here would be this element deciding a seam
   * on the host's behalf. Not required, because `<ptk-warm-up-calculator>` in
   * plain HTML is what the README documents.
   */
  @property({ attribute: false }) settings: PreferenceStore | null = null;

  /**
   * Where the ticks are kept: per tab, and gone next week.
   *
   * A separate store and not a flag on the first one, because "what I squat" and
   * "which sets I have done today" have different lifetimes and the difference
   * has to be structural. One store with two lifetimes is one line away from
   * remembering last Tuesday's ticks against this Tuesday's ramp. `null` for the
   * same reason `settings` is, and separately: two seams, two decisions, neither
   * of them this element's.
   */
  @property({ attribute: false }) marks: PreferenceStore | null = null;

  /**
   * Somewhere to hand today's session, or `null` for a page that offers none.
   *
   * Null by default and null in the embed, so the action simply is not drawn --
   * a framed calculator on somebody else's page has no business replacing their
   * frame's contents with a different tool. `import type` on the interface is
   * deliberate: this element must not pull the logbook's package into a story,
   * a browser test or an embed that will never use it. `handoff.ts` is the only
   * file in the tool with a runtime import of it.
   */
  @property({ attribute: false }) logbook: LogbookHandoff | null = null;

  @state() private equipment: Equipment = DEFAULT_EQUIPMENT;

  @state() private entries: readonly LiftEntry[] = [];

  @state() private completion: Completion = new Set<string>();

  @state() private pending: PendingConversion | null = null;

  /** Set by a press that could not leave a record. Cleared by the next edit. */
  @state() private handoffRefused = false;

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
          ?remembers=${this.settings?.remembers ?? false}
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
        ${this.#renderHandoff()}
      </section>
    `;
  }

  /**
   * The offer to log today's session somewhere else.
   *
   * Drawn only where a page supplied somewhere to hand it to *and* something is
   * finished enough to log, rather than always and disabled: a control that
   * cannot do anything is root section 0.4's dead control, and on this screen it
   * would be dead for the whole of the time before a lifter has typed a weight,
   * which is the state the tool opens in.
   *
   * The list is read again here rather than remembered from the last press,
   * because it decides what the sentence under the link names -- and the whole
   * point of naming those lifts is that the lifter reads it before pressing.
   */
  #renderHandoff(): TemplateResult | typeof nothing {
    const logbook = this.logbook;
    if (logbook === null) return nothing;
    const { lifts, withheld } = loggableSession(this.entries, this.equipment);
    if (lifts.length === 0) return nothing;

    return html`
      <div class="actions">
        <a
          class="log"
          data-action="log-workout"
          href=${logbook.href}
          @click=${this.#onLog}
          @auxclick=${this.#onLog}
          >Log this workout</a
        >
      </div>
      ${
        withheld.length === 0
          ? nothing
          : html`<p class="note">
              The logbook logs from its own list of lifts, so ${listNames(withheld)} will not
              travel.
            </p>`
      }
      ${
        this.handoffRefused
          ? html`<p class="note" role="alert">
              This browser will not let the two tools share a session, so nothing was handed over.
              The plan above is unchanged.
            </p>`
          : nothing
      }
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
    this.handoffRefused = false;
  }

  #setEntries(entries: readonly LiftEntry[]): void {
    this.entries = entries;
    // The refusal was about a press, and the press is over. Leaving the sentence
    // up while the lifter goes on editing would turn a report of what happened
    // into a claim about what the tool can do.
    this.handoffRefused = false;
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

  /**
   * Leaves the record, and lets the link do the navigating.
   *
   * `auxclick` as well as `click` so that a middle-click writes the record too.
   * Without it the one thing an anchor is chosen for -- that it behaves like a
   * link -- would open the logbook in a new tab with nothing waiting in it, and
   * the tab would look exactly like an ordinary visit. The right button is left
   * alone: a context menu is not a press.
   *
   * On failure the press stops here. Following the link would put the lifter in
   * front of an empty logbook with nothing on screen saying why, which is the
   * one outcome worse than the action not being there at all.
   */
  readonly #onLog = (event: MouseEvent): void => {
    const logbook = this.logbook;
    if (logbook === null || event.button > 1) return;
    if (logbook.offer(this.entries, this.equipment) === 'offered') {
      this.handoffRefused = false;
      return;
    }
    event.preventDefault();
    this.handoffRefused = true;
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

/**
 * Names, as a sentence reads them.
 *
 * The sentence around it is written so that one name and four read the same way,
 * which is worth more here than it looks: these are lifts the lifter typed the
 * names of themselves, so there is no fixed list to write copy against and every
 * plural agreement would be a second string to get wrong.
 */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-warm-up-calculator': PtkWarmUpCalculator;
  }
}
