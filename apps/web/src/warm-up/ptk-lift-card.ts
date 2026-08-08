// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One lift on today's list: what is planned, and the ramp to get there.
 *
 * This is the screen a lifter actually looks at, and it is looked at between
 * sets, on a phone, with chalk on their hands. Three consequences run through
 * everything below. The ramp is a checklist of individually tickable rows rather
 * than a table, because knowing which set has happened is the whole point. Every
 * row prints its total in words and its plates in a picture, because colour alone
 * is not identification. And the tick targets are full-width rows, because a
 * missed tap here means repeating a set.
 *
 * It owns nothing. The entry, the equipment and the set of ticks arrive as
 * properties and every change leaves as an event, so a card can be put into any
 * state -- an unloadable weight, a rack with no plates, a half-typed number --
 * from a story or a test with no storage and no session behind it.
 */
import {
  describeChange,
  formatWeight,
  type WarmupAdvisory,
  type WarmupPlan,
  type WeightUnit,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import '@platform-toolkit/ui/ptk-notice';
import '@platform-toolkit/ui/ptk-number-field';
import '@platform-toolkit/ui/ptk-plate-stack';
import {
  CHOICE_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import {
  NUMBER_FIELD_CHANGE_EVENT,
  type NumberFieldChangeDetail,
} from '@platform-toolkit/ui/ptk-number-field';
import { parseCount, parseWeight, type FieldReading } from '@platform-toolkit/ui/field-reading';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { BAR_PRESETS, CUSTOM_BAR_ID, barLabel, type Equipment } from './equipment.js';
import {
  adjustableWarmups,
  markKey,
  planFor,
  sessionRows,
  withAdjustment,
  type AdjustableWarmup,
  type Completion,
  type LiftEntry,
  type SessionRow,
} from './session.js';

/** Fired when the lifter edits a field on this row. */
export interface LiftChangeDetail {
  readonly key: string;
  readonly patch: Partial<Pick<LiftEntry, 'barId' | 'weight' | 'sets' | 'reps' | 'adjustments'>>;
}

/** Fired when the lifter moves this row up or down the list. */
export interface LiftMoveDetail {
  readonly key: string;
  readonly direction: -1 | 1;
}

/** Fired when the lifter takes this lift off the list. */
export interface LiftRemoveDetail {
  readonly key: string;
}

/** Fired when the lifter ticks or unticks one set. */
export interface SetToggleDetail {
  readonly key: string;
  readonly index: number;
}

export const LIFT_CHANGE_EVENT = 'ptk-lift-change';
export const LIFT_MOVE_EVENT = 'ptk-lift-move';
export const LIFT_REMOVE_EVENT = 'ptk-lift-remove';
export const SET_TOGGLE_EVENT = 'ptk-set-toggle';

/** The value meaning "whatever the equipment section says". */
const INHERIT_BAR = '';

@customElement('ptk-lift-card')
export class PtkLiftCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    article {
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface-raised);
      padding: var(--ptk-space-md);
    }

    header {
      display: flex;
      align-items: center;
      gap: var(--ptk-space-sm);
      margin-bottom: var(--ptk-space-md);
      /* The last resort, and only reached when shrinking the two items below
         has run out: the controls drop to a line of their own rather than off
         the side of the screen. */
      flex-wrap: wrap;
    }

    h3 {
      flex: 1;
      /* So a long name wraps rather than pushing the controls off a 320px
         screen. A flex item will not shrink below its content without this.
         Shrinking the name stops being enough once the controls themselves
         outgrow the column -- see .controls. */
      min-width: 0;
      margin: 0;
      font-size: var(--ptk-font-size-lg);
    }

    .controls {
      display: flex;
      gap: var(--ptk-space-xs);
      /*
       * Not flex: none. A tap target is sized in px and does not scale with the
       * text (§5.7), but the glyph inside it does -- so at 200% text these three
       * buttons are 90px each, 291px of row inside 192px of card, and flex: none
       * forbade the row from giving any of it back. Allowing the row to wrap
       * internally, and to shrink to the width one button needs, is what lets
       * the header above wrap it onto its own line instead of overflowing.
       *
       * Never let it shrink past a single button: these buttons are already at
       * the 44px floor, and a squeezed one is a target a chalked thumb misses.
       */
      flex: 0 1 auto;
      flex-wrap: wrap;
      min-width: var(--ptk-tap-target-min);
    }

    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
      gap: var(--ptk-space-md);
    }

    .bar {
      margin-top: var(--ptk-space-md);
    }

    .plan {
      margin-top: var(--ptk-space-md);
    }

    .advisories {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
      margin-bottom: var(--ptk-space-md);
    }

    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
    }

    /*
     * The whole row is the tick target, not a checkbox beside it. A lifter
     * reaching for a 16px box between sets misses it; a row that is at least a
     * thumb tall and the full width of the column cannot be missed.
     */
    .row {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: start;
      gap: var(--ptk-space-md);
      min-height: var(--ptk-tap-target-min);
      padding: var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
      cursor: pointer;
    }

    .row:has(input:focus-visible) {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    /*
     * A done row is dimmed and struck through, never hidden. A lifter who ticks
     * the wrong one has to be able to find it again, and a list that shortens
     * under a thumb moves the next row under the finger that is still moving.
     */
    .row.done {
      background-color: var(--ptk-color-surface-sunken);
      color: var(--ptk-color-text-muted);
    }

    .row.done .total {
      text-decoration: line-through;
    }

    .row.working {
      border-color: var(--ptk-color-accent);
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-xs);
      min-width: 0;
    }

    .total {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .reps {
      font-weight: 400;
      font-size: var(--ptk-font-size-md);
    }

    .change,
    .stage {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .row.done .change,
    .row.done .stage {
      color: inherit;
    }

    input[type='checkbox'] {
      width: 1.5rem;
      height: 1.5rem;
      margin: 0;
      flex: none;
    }

    .idle {
      margin: 0;
      color: var(--ptk-color-text-muted);
    }

    .adjust {
      margin-top: var(--ptk-space-md);
    }

    .hint {
      margin: 0 0 var(--ptk-space-md);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    ul.tweaks {
      list-style: none;
      margin: 0 0 var(--ptk-space-md);
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
    }

    /* Wraps for the same reason .controls does: the two buttons are sized in px
       and do not scale with the text, but their glyphs do, so at 200% text a
       row of name, weight and two steppers outgrows a 320px card. Letting it
       wrap costs a taller row; not letting it wrap costs the steppers. */
    .tweak {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ptk-space-sm);
      min-height: var(--ptk-tap-target-min);
    }

    .tweak-name {
      /* A flex item will not shrink below its min-content width without this,
         and min-content only counts a break opportunity that overflow-wrap
         declares -- which is why it is anywhere and not break-word. */
      flex: 1 1 6rem;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    .tweak-mark {
      display: block;
      color: var(--ptk-color-accent);
    }

    .tweak-total {
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }

    .tweak-steps {
      display: flex;
      gap: var(--ptk-space-xs);
    }

    /* A stepper is a glyph, which is exactly the dense case the knob exists for.
       At the default padding the two of them are a single unbreakable 190px pair
       -- wider, at 200% text, than the whole fold they sit in. The 44px floor
       still decides how big they are to a thumb; this only stops the padding
       from deciding it instead. */
    .tweak-steps ptk-button {
      --ptk-button-padding-inline: var(--ptk-space-sm);
    }
  `;

  @property({ attribute: false }) entry!: LiftEntry;

  @property({ attribute: false }) equipment!: Equipment;

  @property({ attribute: false }) completion: Completion = new Set<string>();

  /** Whether the move controls at the ends of the list should be unavailable. */
  @property({ type: Boolean }) first = false;

  @property({ type: Boolean }) last = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(NUMBER_FIELD_CHANGE_EVENT, this.#onNumber);
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onChoice);
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

  override render(): TemplateResult {
    const unit = this.equipment.plateUnit;
    const weight = parseWeight(this.entry.weight, unit);
    const sets = parseCount(this.entry.sets, 'sets');
    const reps = parseCount(this.entry.reps, 'reps');
    return html`
      <article>
        <header>
          <h3>${this.entry.name}</h3>
          <div class="controls">
            <ptk-button
              accessible-name=${`Move ${this.entry.name} earlier`}
              ?disabled=${this.first}
              @click=${() => {
                this.#move(-1);
              }}
              >↑</ptk-button
            >
            <ptk-button
              accessible-name=${`Move ${this.entry.name} later`}
              ?disabled=${this.last}
              @click=${() => {
                this.#move(1);
              }}
              >↓</ptk-button
            >
            <ptk-button
              accessible-name=${`Remove ${this.entry.name}`}
              @click=${() => {
                this.#remove();
              }}
              >✕</ptk-button
            >
          </div>
        </header>

        <div class="fields">
          <ptk-number-field
            data-field="weight"
            label="Working weight"
            unit=${unit}
            .value=${this.entry.weight}
            error=${messageOf(weight)}
          ></ptk-number-field>
          <ptk-number-field
            data-field="sets"
            label="Sets"
            .value=${this.entry.sets}
            error=${messageOf(sets)}
          ></ptk-number-field>
          <ptk-number-field
            data-field="reps"
            label="Reps"
            .value=${this.entry.reps}
            error=${messageOf(reps)}
          ></ptk-number-field>
        </div>

        <div class="bar">
          <ptk-disclosure label="Bar for this lift" summary=${this.#barSummary()}>
            <ptk-choice-group
              data-field="bar"
              label="Bar"
              .choices=${this.#barChoices()}
              .value=${this.entry.barId}
            ></ptk-choice-group>
          </ptk-disclosure>
        </div>

        <div class="plan">${this.#renderPlan([weight, sets, reps])}</div>
      </article>
    `;
  }

  #barSummary(): string {
    if (this.entry.barId === INHERIT_BAR) {
      return `Same as the setup — ${barLabel(this.equipment, this.equipment.barId)}`;
    }
    return barLabel(this.equipment, this.entry.barId);
  }

  #barChoices(): readonly Choice[] {
    return [
      {
        value: INHERIT_BAR,
        label: 'Same as the setup',
        description: barLabel(this.equipment, this.equipment.barId),
      },
      ...BAR_PRESETS.map((preset) => ({
        value: preset.id,
        label: barLabel(this.equipment, preset.id),
      })),
      { value: CUSTOM_BAR_ID, label: barLabel(this.equipment, CUSTOM_BAR_ID) },
    ];
  }

  #renderPlan(readings: readonly FieldReading[]): TemplateResult {
    const result = planFor(this.entry, this.equipment);
    if (result === null) {
      // Two different situations arrive here and they must not read alike.
      // `planFor` cannot tell them apart -- an empty field and `1o5` both stop
      // it before there is anything to plan -- but the readings can: only a
      // mistake carries a message. Telling a lifter who typed something to
      // enter a working weight sends them to look at a field that is not empty.
      if (readings.some((reading) => !reading.ok && reading.message !== null)) {
        return html`<p class="idle">Check the numbers above to see the warm-up.</p>`;
      }
      // Nothing typed yet is not a mistake, so it gets a sentence rather than an
      // error: the fields above already carry any message about what *is* wrong.
      return html`<p class="idle">Enter a working weight to see the warm-up.</p>`;
    }
    if (!result.ok) {
      // `WarmupProblemCode` is input-only by design, so anything here has already
      // been said under the field that caused it. Saying it twice on one card
      // reads as two separate faults.
      return html`<p class="idle">Check the numbers above to see the warm-up.</p>`;
    }
    const plan = result.plan;
    // Computed once for both halves of the panel: the checklist numbers each
    // movable set, and the fold below offers to move the same ones. Two calls
    // would be two searches of the rack for one answer.
    const movable = adjustableWarmups(plan, this.entry.adjustments);
    const byIndex = new Map(movable.map((row) => [row.index, row]));
    return html`
      ${this.#renderAdvisories(plan)}
      <ol>
        ${sessionRows(plan).map((row) => this.#renderRow(row, byIndex))}
      </ol>
      ${this.#renderAdjust(movable)}
    `;
  }

  #renderAdvisories(plan: WarmupPlan): TemplateResult | typeof nothing {
    // An advisory whose sentence comes back empty is one whose condition the plan
    // no longer meets, and an empty notice is a coloured box saying nothing.
    const sentences = plan.advisories
      .map((advisory) => this.#advisoryText(advisory, plan))
      .filter((sentence) => sentence !== '');
    if (sentences.length === 0) return nothing;
    return html`
      <div class="advisories">
        ${sentences.map((sentence) => html`<ptk-notice>${sentence}</ptk-notice>`)}
      </div>
    `;
  }

  /**
   * What an advisory means, in the lifter's terms.
   *
   * The tone is `info` and never `error` for all of them: every one of these is
   * a true statement about a plan that exists, and the requirements are explicit
   * that an unloadable working weight is warned about and not blocked. Colouring
   * them red would tell a lifter their session is broken when it is loadable to
   * within a kilogram.
   */
  #advisoryText(advisory: WarmupAdvisory, plan: WarmupPlan): string {
    const unit = this.equipment.plateUnit;
    const shown = (amount: number): string => formatWeight({ amount, unit });
    switch (advisory.code) {
      case 'working-weight-not-loadable': {
        if (plan.working.load.kind === 'loadable') return '';
        const { below, above } = plan.working.load;
        const neighbours = [below, above]
          .filter((loading) => loading !== null)
          .map((loading) => shown(loading.total));
        if (neighbours.length === 0) {
          return `${shown(plan.working.total)} cannot be built from these plates.`;
        }
        return `${shown(plan.working.total)} cannot be built from these plates. The nearest are ${neighbours.join(' and ')}.`;
      }
      case 'working-weight-at-or-below-implement':
        return `The bar and collars already weigh ${shown(plan.emptyImplement.total)}, so there is nothing to warm up to.`;
      case 'no-plates-available':
        return 'No plates are selected in the equipment section, so every set is the bar on its own.';
      case 'full-diameter-unavailable':
        return 'No full-diameter plate is available, so the first pull starts with the bar lower than it will be for the working sets.';
      case 'jump-exceeds-full-plate':
        return 'These plates are too coarse to keep every jump within one full plate a side.';
    }
  }

  #renderRow(row: SessionRow, byIndex: ReadonlyMap<number, AdjustableWarmup>): TemplateResult {
    const unit = this.equipment.plateUnit;
    const warmup = row.warmupIndex === null ? undefined : byIndex.get(row.warmupIndex);
    const key = markKey(this.entry.key, row.index);
    const done = this.completion.has(key);
    const change = row.change === null ? '' : describeChange(row.change, unit);
    return html`
      <li>
        <label
          class=${['row', row.kind === 'working' ? 'working' : '', done ? 'done' : ''].join(' ')}
        >
          <input
            type="checkbox"
            .checked=${done}
            @change=${() => {
              this.#toggle(row.index);
            }}
          />
          <span class="body">
            <span class="total"
              >${formatWeight({ amount: row.total, unit })}
              <span class="reps">× ${row.reps}</span></span
            >
            <span class="stage">${stageName(row, warmup)}</span>
            ${
              row.loading === null
                ? html`<span class="change">These plates cannot build this weight.</span>`
                : html`<ptk-plate-stack
                    .plates=${row.loading.perSide}
                    unit=${unit}
                  ></ptk-plate-stack>`
            }
            ${change === '' ? nothing : html`<span class="change">${change}</span>`}
          </span>
        </label>
      </li>
    `;
  }

  /**
   * The stepper column, folded away under the checklist.
   *
   * Folded because adjusting a calculated weight is not what anybody came here
   * to do -- the ramp is the product, and a column of steppers beside every row
   * would make the checklist look like a form to fill in rather than a list to
   * work through. Below the checklist rather than above it for the same reason,
   * and because every row of the checklist is a tick target: a control inside
   * one would be a press that also marks a set as done.
   *
   * Steppers rather than typed fields. This is read between sets on a phone: a
   * stepper cannot be mistyped, cannot name a weight the rack cannot build, and
   * does not put a keyboard over the list. What one press is worth is the rack's
   * own answer, so a gym with quarter-pound plates steps in quarters.
   */
  #renderAdjust(movable: readonly AdjustableWarmup[]): TemplateResult | typeof nothing {
    // A ramp of nothing but bar-only sets has nothing to offer, and an empty
    // fold is a control that opens onto a blank.
    if (movable.length === 0) return nothing;

    const changed = movable.filter((row) => row.adjusted).length;
    return html`
      <div class="adjust">
        <ptk-disclosure
          label="Adjust the warm-up weights"
          summary=${adjustSummary(changed, movable.length)}
        >
          <p class="hint">
            Each step is the next weight these plates can build. The working sets are not changed.
          </p>
          <ul class="tweaks">
            ${movable.map((row) => this.#renderTweak(row))}
          </ul>
          <ptk-button
            ?disabled=${changed === 0}
            @click=${() => {
              this.#change({ adjustments: [] });
            }}
            >Use the calculated weights</ptk-button
          >
        </ptk-disclosure>
      </div>
    `;
  }

  #renderTweak(row: AdjustableWarmup): TemplateResult {
    const unit = this.equipment.plateUnit;
    return html`
      <li class="tweak">
        <span class="tweak-name">
          Warm-up
          ${row.ordinal}${
            row.adjusted ? html`<span class="tweak-mark">Your weight</span>` : nothing
          }
        </span>
        <span class="tweak-total">${formatWeight({ amount: row.total, unit })}</span>
        <span class="tweak-steps">
          <ptk-button
            accessible-name=${stepName('Lower', row, row.down, unit, this.entry.name)}
            ?disabled=${row.down === null}
            @click=${() => {
              this.#nudge(row.index, row.down);
            }}
            >−</ptk-button
          >
          <ptk-button
            accessible-name=${stepName('Raise', row, row.up, unit, this.entry.name)}
            ?disabled=${row.up === null}
            @click=${() => {
              this.#nudge(row.index, row.up);
            }}
            >+</ptk-button
          >
        </span>
      </li>
    `;
  }

  /**
   * Move one warm-up to a weight the rack can already build.
   *
   * `null` is the end of the rack in that direction and the button offering it
   * is disabled, so this is only reached by a press that raced a re-render.
   * Dispatching the whole adjustment list rather than the one change keeps the
   * card stateless: the session owns the list, and a card holding a copy would
   * be a second owner of the thing the storage layer writes.
   */
  #nudge(index: number, total: number | null): void {
    if (total === null) return;
    this.#change({ adjustments: withAdjustment(this.entry.adjustments, index, total) });
  }

  readonly #onNumber = (event: CustomEvent<NumberFieldChangeDetail>): void => {
    const field = fieldOf(event);
    if (field !== 'weight' && field !== 'sets' && field !== 'reps') return;
    this.#change({ [field]: event.detail.value });
  };

  readonly #onChoice = (event: CustomEvent<ChoiceChangeDetail>): void => {
    if (fieldOf(event) !== 'bar') return;
    this.#change({ barId: event.detail.value });
  };

  #change(patch: LiftChangeDetail['patch']): void {
    this.dispatchEvent(
      new CustomEvent<LiftChangeDetail>(LIFT_CHANGE_EVENT, {
        detail: { key: this.entry.key, patch },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #move(direction: -1 | 1): void {
    this.dispatchEvent(
      new CustomEvent<LiftMoveDetail>(LIFT_MOVE_EVENT, {
        detail: { key: this.entry.key, direction },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #remove(): void {
    this.dispatchEvent(
      new CustomEvent<LiftRemoveDetail>(LIFT_REMOVE_EVENT, {
        detail: { key: this.entry.key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #toggle(index: number): void {
    this.dispatchEvent(
      new CustomEvent<SetToggleDetail>(SET_TOGGLE_EVENT, {
        detail: { key: this.entry.key, index },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/**
 * The sentence to show under a field, or nothing.
 *
 * A field that parsed and a field nobody has typed in yet are both silent, and
 * they are silent for different reasons -- the first has no fault to report, the
 * second has not been used. Collapsing them here rather than at each call site
 * keeps three near-identical ternaries out of the template.
 */
function messageOf(reading: FieldReading): string {
  return reading.ok ? '' : (reading.message ?? '');
}

/**
 * What a row is, in one short phrase.
 *
 * The stage names come from the ramp rules and mean nothing to a lifter, so they
 * are translated here rather than shown. "Warm-up" alone would do for most of
 * them; the bar-only sets and the working sets are called out because those two
 * are the ones somebody scanning the list is looking for.
 */
function stageName(row: SessionRow, warmup: AdjustableWarmup | undefined): string {
  if (row.kind === 'working') return 'Working set';
  if (row.stage === 'empty-implement') return 'Empty bar';
  // The ordinal is what ties this row to the row in the adjustment fold, and it
  // counts only the movable sets -- the bar-only ones above are not numbered, so
  // the first thing a lifter can move is always "Warm-up 1".
  if (warmup === undefined) return 'Warm-up';
  return warmup.adjusted ? `Warm-up ${warmup.ordinal} · Your weight` : `Warm-up ${warmup.ordinal}`;
}

/**
 * What is true about the warm-up weights while the fold is shut.
 *
 * §5.8 requires a disclosure's summary to state the whole of what it hides, and
 * what this one hides is whether the numbers above are the calculator's or the
 * lifter's. A fold reading only "Adjust the warm-up weights" over a ramp with
 * two hand-set rungs is how somebody reads a plan they edited last week as one
 * the tool just produced for today's working weight.
 */
function adjustSummary(changed: number, total: number): string {
  if (changed === 0) return 'Calculated weights';
  return `${changed} of ${total} set by you`;
}

/**
 * The name of one stepper, including the weight the press lands on.
 *
 * Naming the destination is what makes this usable without sight. A stepper
 * called "Raise warm-up 2" tells a screen-reader user the direction and nothing
 * about the result, so the new figure has to be hunted for after every press --
 * and a live region announcing it would talk over the checklist on a screen
 * whose whole purpose is being read between sets. The "to" clause is dropped at
 * the end of the rack, where the button is disabled and there is no destination
 * to name.
 */
function stepName(
  verb: 'Lower' | 'Raise',
  row: AdjustableWarmup,
  to: number | null,
  unit: WeightUnit,
  liftName: string,
): string {
  const target = to === null ? '' : ` to ${formatWeight({ amount: to, unit })}`;
  return `${verb} warm-up ${row.ordinal} for ${liftName}${target}`;
}

/**
 * Which control an event came from, or `null`.
 *
 * The composed path rather than `event.target`: a listener on this host sees the
 * target retargeted to the host itself for anything fired inside a child's own
 * shadow tree, so `event.target.dataset` is empty and every keystroke is dropped.
 */
function fieldOf(event: Event): string | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.dataset['field'] !== undefined) {
      return node.dataset['field'];
    }
  }
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-lift-card': PtkLiftCard;
  }

  interface HTMLElementEventMap {
    [LIFT_CHANGE_EVENT]: CustomEvent<LiftChangeDetail>;
    [LIFT_MOVE_EVENT]: CustomEvent<LiftMoveDetail>;
    [LIFT_REMOVE_EVENT]: CustomEvent<LiftRemoveDetail>;
    [SET_TOGGLE_EVENT]: CustomEvent<SetToggleDetail>;
  }
}
