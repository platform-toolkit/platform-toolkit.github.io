// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What this lifter has committed to, and how far away it is.
 *
 * The tray, which the review asks for and which only exists once something is in
 * it: an empty "My goals" heading above an empty list is a promise the tool has
 * not kept yet, occupying the space under a report somebody is reading. Nothing
 * renders until a goal is saved.
 *
 * WHY THE GAP IS ARITHMETIC AND NOTHING ELSE
 *
 * "Goal 150 kg · Current best 140 kg · Gap 10 kg". Three figures and a
 * subtraction. No bar, no percentage, no encouragement -- the review is explicit
 * that this is where a targets tool starts inventing motivation, and a lifter
 * planning a third attempt is doing arithmetic, not reading a dashboard. A
 * percentage in particular reads as progress towards something and is wrong the
 * moment two goals are in different lifts.
 *
 * The gap needs a current best, which is optional and stays optional. Without one
 * the row prints the goal alone, and a secondary action opens the lift entry
 * below rather than pulling a field up into the tray -- there is one place in this
 * tool where a lifter says what they lift, and a second would be a second answer.
 *
 * WHAT THIS ELEMENT DOES NOT OWN
 *
 * The list. It is handed goals and dispatches requests, the same arrangement the
 * report uses, so that the device's copy is written in exactly one place. See
 * `goals.ts` for what a goal is and why it is stored as identifiers.
 */
import type { CategoryCatalog, ClassificationBook } from '@platform-toolkit/data-contracts';
import '@platform-toolkit/ui/ptk-select';
import {
  SELECT_CHANGE_EVENT,
  type SelectChangeDetail,
  type SelectOption,
} from '@platform-toolkit/ui/ptk-select';
// Side-effect only, for `ptk-select` in the template below. See the note in
// §5.8: an unregistered custom element still renders its children, so the
// failure is silent styling loss rather than an error, and the story that mounts
// this alone is where it would land.
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
  GOAL_TAGS,
  GOAL_TAG_LABELS,
  describeGoal,
  goalKey,
  type Goal,
  type GoalTag,
} from './goals.js';
import { figuresFor } from './report.js';
import { readLiftEntries, type LiftEntries, type LiftEntry, NO_ENTRIES } from './standards.js';

/** A goal is to be forgotten, or filed under a different horizon. */
export interface GoalListDetail {
  readonly key: string;
  /** The horizon to file it under. `null` when the goal is being removed. */
  readonly tag: GoalTag | null;
}

/** Fired when a lifter removes a goal from the tray. */
export const GOAL_REMOVE_EVENT = 'ptk-goal-remove';

/** Fired when a lifter files a goal under a horizon. */
export const GOAL_TAG_EVENT = 'ptk-goal-tag';

/**
 * Fired when a lifter asks to enter what they are lifting now.
 *
 * The tray does not open the panel itself. The panel is a sibling under the
 * composition root, and an element reaching across to a sibling is an element
 * that cannot be mounted without one.
 */
export const CURRENT_LIFTS_EVENT = 'ptk-current-lifts';

/** The attribute a delegated listener reads to find which goal a select belongs to. */
const KEY_ATTRIBUTE = 'data-goal';

/**
 * The horizons, minus "no label".
 *
 * `ptk-select` always renders a placeholder of its own and reports `null` for
 * it, so the unlabelled state is that placeholder rather than an option beside
 * it. Listing `none` as well would put two ways of saying the same thing in one
 * picker, and the tool would then have to decide which of them a stored `none`
 * shows as -- a control that answers itself differently depending on how it was
 * cleared.
 */
const TAG_OPTIONS: readonly SelectOption[] = GOAL_TAGS.filter((tag) => tag !== 'none').map(
  (tag) => ({ value: tag, label: GOAL_TAG_LABELS[tag] }),
);

@customElement('ptk-target-goals')
export class PtkTargetGoals extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    /*
     * The separation from the report above lives on the section rather than on
     * the host, because the host is always in the document and the section is
     * not: an empty tray with a margin would push the lift entry down by the
     * width of a gap nothing is in, which reads as a section that failed to
     * render.
     *
     * (No backticks in this comment: they would end the css template -- see the
     * gotcha in CLAUDE.md 5.8.)
     */
    section {
      margin-block-start: var(--ptk-space-xl);
      padding-block-start: var(--ptk-space-xl);
      border-block-start: 1px solid var(--ptk-color-border);
    }

    h3 {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-lg);
    }

    ul {
      list-style: none;
      margin: 0 0 var(--ptk-space-md);
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-sm);
    }

    li {
      padding: var(--ptk-space-sm);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background: var(--ptk-color-surface-raised);
    }

    .title {
      margin: 0;
      font-weight: 700;
    }

    .attempt {
      font-weight: 400;
      color: var(--ptk-color-text-muted);
    }

    .scope {
      margin: 0 0 var(--ptk-space-xs);
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /*
     * Tabular figures for the same reason the matrix uses them: this line is
     * three numbers a reader compares, and proportional digits move the same
     * digit to a different place on every row.
     */
    .arithmetic {
      margin: 0 0 var(--ptk-space-sm);
      font-variant-numeric: tabular-nums;
    }

    .goal-weight {
      font-size: var(--ptk-font-size-lg);
      font-weight: 700;
    }

    .pounds {
      font-size: var(--ptk-font-size-sm);
      color: var(--ptk-color-text-muted);
    }

    /* A word, never a colour on its own -- the rule the report's flags follow. */
    .reached {
      font-weight: 700;
      color: var(--ptk-color-accent);
    }

    /*
     * The label picker and the remove button share a line once there is room for
     * one, and stack on a phone. Wrapping rather than a container query because
     * there are exactly two children and the natural widths already say when they
     * stop fitting.
     */
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--ptk-space-sm);
    }

    ptk-select {
      flex: 1 1 10rem;
    }

    .remove {
      min-height: var(--ptk-tap-target-comfortable);
      padding: var(--ptk-space-xs) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-sm);
      background: var(--ptk-color-surface);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    /*
     * Secondary, and it looks it. The review puts current-best entry after the
     * goal and below it in importance: a lifter who never touches this still has
     * every figure they came for.
     */
    .add-lifts {
      min-height: var(--ptk-tap-target-comfortable);
      padding: var(--ptk-space-xs) var(--ptk-space-sm);
      border: 0;
      background: none;
      color: var(--ptk-color-accent);
      font: inherit;
      text-align: start;
      text-decoration: underline;
      cursor: pointer;
    }
  `;

  /** Everything saved on this device, in the order it was committed to. */
  @property({ attribute: false }) goals: readonly Goal[] = [];

  /** The published vocabulary, for resolving what each goal is called. */
  @property({ attribute: false }) catalog: CategoryCatalog | null = null;

  /** This category's standards, the only source of a classification level's name. */
  @property({ attribute: false }) classifications: ClassificationBook | null = null;

  /** What the lifter has entered, if anything. The other half of the gap. */
  @property({ attribute: false }) entries: LiftEntries = NO_ENTRIES;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(SELECT_CHANGE_EVENT, this.#onTagChange);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(SELECT_CHANGE_EVENT, this.#onTagChange);
    super.disconnectedCallback();
  }

  /**
   * Resolves once the selects have rendered too.
   *
   * Lit's own `updateComplete` settles when this template is committed, which
   * sets `.options` on a child and leaves the child's render queued -- see the
   * same override in `ptk-target-lifts.ts`.
   */
  protected override async getUpdateComplete(): Promise<boolean> {
    const complete = await super.getUpdateComplete();
    const selects = this.shadowRoot?.querySelectorAll('ptk-select') ?? [];
    await Promise.all([...selects].map((select) => select.updateComplete));
    return complete;
  }

  override render(): TemplateResult {
    if (this.goals.length === 0) {
      return html`${nothing}`;
    }

    // Read once for the whole tray rather than per row. `readLiftEntries` parses
    // four fields and derives a total, and a row that recomputed it would do that
    // work twenty times to print one subtraction.
    const read = readLiftEntries(this.entries);
    const missingBest = this.goals.some((goal) => read[goal.lift].kind !== 'weight');

    return html`
      <section aria-labelledby="goals-heading">
        <h3 id="goals-heading">My goals</h3>
        <ul>
          ${this.goals.map((goal) => this.#renderGoal(goal, read[goal.lift]))}
        </ul>
        ${
          missingBest
            ? html`<button
                type="button"
                class="add-lifts"
                @click=${() => {
                  this.#requestCurrentLifts();
                }}
              >
                Add current best to calculate the gap
              </button>`
            : nothing
        }
      </section>
    `;
  }

  #renderGoal(goal: Goal, entry: LiftEntry): TemplateResult {
    const key = goalKey(goal);
    const description = describeGoal(goal, {
      catalog: this.catalog,
      classifications: this.classifications,
    });
    const spoken =
      description.scope === '' ? description.title : `${description.title}, ${description.scope}`;

    return html`
      <li>
        <p class="title">
          ${description.title}
          ${
            description.attemptLabel === null
              ? nothing
              : html`<span class="attempt">· ${description.attemptLabel}</span>`
          }
        </p>
        <p class="scope">${description.scope}</p>
        ${this.#renderArithmetic(goal, entry)}
        <div class="actions">
          <ptk-select
            data-goal=${key}
            label="Label"
            accessible-name=${`Label for ${spoken}`}
            placeholder=${GOAL_TAG_LABELS.none}
            .options=${TAG_OPTIONS}
            .value=${goal.tag === 'none' ? null : goal.tag}
          ></ptk-select>
          <button
            type="button"
            class="remove"
            aria-label=${`Remove goal: ${spoken}`}
            @click=${() => {
              this.#requestRemove(key);
            }}
          >
            Remove
          </button>
        </div>
      </li>
    `;
  }

  /**
   * The goal, the current best if there is one, and the difference.
   *
   * Written out rather than reduced to one sentence, because the three figures
   * are three different facts and a lifter checks them separately -- what I said
   * I would do, what I have done, what is left. The subtraction is done in
   * kilograms and only then converted, which is the rule the whole tool runs on:
   * a gap worked out in pounds and converted back lands between two legal
   * loadings.
   */
  #renderArithmetic(goal: Goal, entry: LiftEntry): TemplateResult {
    const goalFigures = figuresFor(goal.kilograms);
    const figure = html`<span class="goal-weight">${goalFigures.kilogramsText} kg</span>
      <span class="pounds">${goalFigures.poundsText} lb</span>`;

    if (entry.kind !== 'weight') {
      return html`<p class="arithmetic">Goal ${figure}</p>`;
    }

    const best = figuresFor(entry.kilograms);
    const remaining = goal.kilograms - entry.kilograms;
    return html`
      <p class="arithmetic">
        Goal ${figure} · Current best ${best.kilogramsText} kg ·
        ${
          remaining > 0
            ? html`Gap ${figuresFor(remaining).kilogramsText} kg`
            : // "Reached", never "Beaten" or a tick. The review allows a value to be
              // marked reached *only* once there is a current best to compare, which
              // is exactly this branch, and forbids the judgement that would
              // otherwise attach to it.
              html`<span class="reached">Reached</span>`
        }
      </p>
    `;
  }

  /**
   * A label was chosen.
   *
   * `composedPath()` rather than `event.target`, for the reason the report gives
   * at length: an event from a child's own shadow tree is retargeted to this
   * host, so reading the identifier off the target finds nothing and every choice
   * is silently dropped.
   *
   * The value is checked against the known horizons before it leaves. It arrives
   * as a string from the DOM, and a value that is not a horizon would be handed
   * to a store that throws on it (§5.12) -- taking the screen down over a typo in
   * a template.
   *
   * `null` is the placeholder, which means the lifter cleared the label, and that
   * is `none` rather than nothing to do.
   */
  readonly #onTagChange = (event: CustomEvent<SelectChangeDetail>): void => {
    const control = event
      .composedPath()
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.hasAttribute(KEY_ATTRIBUTE),
      );
    const key = control?.getAttribute(KEY_ATTRIBUTE) ?? null;
    const tag = event.detail.value === null ? 'none' : asTag(event.detail.value);
    if (key === null || tag === null) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent<GoalListDetail>(GOAL_TAG_EVENT, {
        detail: { key, tag },
        bubbles: true,
        composed: true,
      }),
    );
  };

  #requestRemove(key: string): void {
    this.dispatchEvent(
      new CustomEvent<GoalListDetail>(GOAL_REMOVE_EVENT, {
        detail: { key, tag: null },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #requestCurrentLifts(): void {
    this.dispatchEvent(new CustomEvent(CURRENT_LIFTS_EVENT, { bubbles: true, composed: true }));
  }
}

/** Narrowed rather than cast: a select reports a string, and a typo is a string. */
function asTag(value: string): GoalTag | null {
  return GOAL_TAGS.find((tag) => tag === value) ?? null;
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-target-goals': PtkTargetGoals;
  }

  interface HTMLElementEventMap {
    [GOAL_REMOVE_EVENT]: CustomEvent<GoalListDetail>;
    [GOAL_TAG_EVENT]: CustomEvent<GoalListDetail>;
    [CURRENT_LIFTS_EVENT]: CustomEvent<undefined>;
  }
}
