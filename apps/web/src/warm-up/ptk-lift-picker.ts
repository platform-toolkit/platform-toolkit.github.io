// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Choosing what is on today's list.
 *
 * The four pinned lifts sit in the open because they are what most sessions are
 * made of; everything else is behind a fold with a search box, because thirty-two
 * lifts is a scroll a lifter should only take when they want it. Which four are
 * pinned comes from the catalogue's own flag and never from identifiers written
 * out here -- a second list is a second place to forget.
 *
 * The element adds nothing itself. It reports what was chosen and the tool owns
 * the list, which is what keeps "already on the list" a single fact rather than
 * one the picker and the session could disagree about.
 */
import {
  LIFTS,
  PRIMARY_LIFTS,
  liftsByGroup,
  type LiftDefinition,
  type LiftGroup,
  type WarmupFamily,
} from '@platform-toolkit/domain';
import '@platform-toolkit/ui/ptk-button';
import '@platform-toolkit/ui/ptk-choice-group';
import '@platform-toolkit/ui/ptk-disclosure';
import {
  CHOICE_CHANGE_EVENT,
  type Choice,
  type ChoiceChangeDetail,
} from '@platform-toolkit/ui/ptk-choice-group';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/** Fired when the lifter picks a lift from the catalogue. */
export interface AddLiftDetail {
  readonly liftId: string;
}

/** Fired when the lifter names a lift of their own. */
export interface AddCustomLiftDetail {
  readonly name: string;
  readonly family: WarmupFamily;
}

export const ADD_LIFT_EVENT = 'ptk-add-lift';
export const ADD_CUSTOM_LIFT_EVENT = 'ptk-add-custom-lift';

/** Section headings for the catalogue, in the order the catalogue lists them. */
const GROUP_NAMES: Readonly<Record<LiftGroup, string>> = {
  primary: 'The four',
  'core-additions': 'Core additions',
  'squat-variants': 'Squat variants',
  'press-variants': 'Press and bench variants',
  'pull-variants': 'Pull variants',
  'olympic-variants': 'Olympic variants',
  ancillary: 'Assistance',
};

/**
 * The ramp families, in the words a lifter would use.
 *
 * A custom lift needs one, because the family is what decides whether the ramp
 * starts on an empty bar or on the smallest loading that puts the bar at the
 * right height. Asking is better than guessing from a typed name.
 */
interface FamilyOption {
  readonly family: WarmupFamily;
  readonly label: string;
  readonly description: string;
}

const FAMILY_OPTIONS: readonly FamilyOption[] = [
  {
    family: 'squat-press',
    label: 'Squat or press',
    description: 'Starts with the empty bar, then builds up.',
  },
  {
    family: 'deadlift',
    label: 'Deadlift',
    description: 'Starts at the height the bar pulls from.',
  },
  {
    family: 'pull',
    label: 'Pull from the floor',
    description: 'Rows, shrugs, snatch-grip pulls.',
  },
  {
    family: 'olympic',
    label: 'Olympic lift',
    description: 'Fewer reps as the weight climbs.',
  },
  {
    family: 'assistance',
    label: 'Assistance',
    description: 'A short ramp for lighter accessory work.',
  },
];

/**
 * The same options as the picker's radios want them.
 *
 * Derived rather than written twice, and the *typed* list above is the one the
 * event handler looks a family up in -- so the family that comes back is a
 * `WarmupFamily` because it was one all along, not because of an assertion that
 * would keep compiling after somebody adds a sixth family here and nowhere else.
 */
const FAMILY_CHOICES: readonly Choice[] = FAMILY_OPTIONS.map((option) => ({
  value: option.family,
  label: option.label,
  description: option.description,
}));

/** The maximum name length, which is also the widest thing a card can show. */
const MAX_NAME_LENGTH = 60;

@customElement('ptk-lift-picker')
export class PtkLiftPicker extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }

    .primary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    .heading {
      margin: 0 0 var(--ptk-space-sm);
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .fold {
      margin-top: var(--ptk-space-md);
    }

    .search {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-xs);
      margin-bottom: var(--ptk-space-md);
    }

    .search label,
    .named label {
      font-size: var(--ptk-font-size-sm);
      font-weight: 600;
      color: var(--ptk-color-text-muted);
    }

    input {
      min-height: var(--ptk-tap-target-min);
      padding: var(--ptk-space-sm) var(--ptk-space-md);
      border: 1px solid var(--ptk-color-border-strong);
      border-radius: var(--ptk-radius-md);
      background-color: var(--ptk-color-surface);
      color: var(--ptk-color-text);
      font-family: inherit;
      /* Never below 16px: iOS Safari zooms the page on focus under that and the
         layout jumps under the lifter's thumb mid-tap. */
      font-size: 1rem;
      /* An input's intrinsic width is wider than a 320px column, and a grid or
         flex child does not shrink below it without this. */
      min-width: 0;
      width: 100%;
      box-sizing: border-box;
    }

    input:focus-visible {
      outline: var(--ptk-focus-ring-width) solid var(--ptk-color-focus-ring);
      outline-offset: var(--ptk-focus-ring-offset);
    }

    .group {
      margin-bottom: var(--ptk-space-lg);
    }

    .group:last-child {
      margin-bottom: 0;
    }

    .options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
      gap: var(--ptk-space-sm);
    }

    .named {
      display: flex;
      flex-direction: column;
      gap: var(--ptk-space-md);
    }

    .note {
      margin: 0;
      color: var(--ptk-color-text-muted);
      font-size: var(--ptk-font-size-sm);
    }

    .none {
      margin: 0;
      color: var(--ptk-color-text-muted);
    }
  `;

  /** The catalogue lifts already on today's list, so they read as added. */
  @property({ attribute: false }) chosen: readonly string[] = [];

  @state() private query = '';

  @state() private customName = '';

  @state() private customFamily: WarmupFamily = 'squat-press';

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener(CHOICE_CHANGE_EVENT, this.#onFamily);
  }

  override disconnectedCallback(): void {
    this.removeEventListener(CHOICE_CHANGE_EVENT, this.#onFamily);
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
    return html`
      <p class="heading">Today's lifts</p>
      <div class="primary">${PRIMARY_LIFTS.map((lift) => this.#renderLift(lift))}</div>

      <div class="fold">
        <ptk-disclosure label="More lifts" summary=${`${String(LIFTS.length)} in the catalogue`}>
          ${this.#renderCatalogue()}
        </ptk-disclosure>
      </div>

      <div class="fold">
        <ptk-disclosure label="A lift of your own" summary="Name it and choose how it warms up">
          ${this.#renderCustom()}
        </ptk-disclosure>
      </div>
    `;
  }

  #renderCatalogue(): TemplateResult {
    const matches = search(this.query);
    return html`
      <div class="search">
        <label for="lift-search">Search the catalogue</label>
        <input
          id="lift-search"
          type="search"
          autocomplete="off"
          placeholder="Front squat, rack pull…"
          .value=${this.query}
          @input=${(event: Event) => {
            this.query = readInput(event);
          }}
        />
      </div>
      ${
        matches.size === 0
          ? html`<p class="none">No lift in the catalogue matches that.</p>`
          : [...matches].map(
              ([group, lifts]) => html`
                <div class="group">
                  <p class="heading">${GROUP_NAMES[group]}</p>
                  <div class="options">${lifts.map((lift) => this.#renderLift(lift))}</div>
                </div>
              `,
            )
      }
    `;
  }

  #renderLift(lift: LiftDefinition): TemplateResult {
    const added = this.chosen.includes(lift.id);
    return html`
      <ptk-button
        variant=${added ? 'secondary' : 'primary'}
        ?disabled=${added}
        accessible-name=${added ? `${lift.name}, already on the list` : `Add ${lift.name}`}
        @click=${() => {
          this.#add(lift.id);
        }}
        >${added ? `${lift.name} ✓` : lift.name}</ptk-button
      >
    `;
  }

  #renderCustom(): TemplateResult {
    const name = this.customName.trim();
    return html`
      <div class="named">
        <div class="search">
          <label for="custom-name">What is it called?</label>
          <input
            id="custom-name"
            type="text"
            autocomplete="off"
            maxlength=${MAX_NAME_LENGTH}
            .value=${this.customName}
            @input=${(event: Event) => {
              this.customName = readInput(event);
            }}
          />
        </div>
        <ptk-choice-group
          data-field="family"
          label="How should it warm up?"
          .choices=${FAMILY_CHOICES}
          .value=${this.customFamily}
        ></ptk-choice-group>
        <div>
          <ptk-button
            variant="primary"
            ?disabled=${name === ''}
            @click=${() => {
              this.#addCustom();
            }}
            >Add this lift</ptk-button
          >
        </div>
        <p class="note">
          A lift you name yourself lasts as long as this tab is open. It is not remembered, because
          nothing you type is written to this device.
        </p>
      </div>
    `;
  }

  #add(liftId: string): void {
    if (this.chosen.includes(liftId)) return;
    this.dispatchEvent(
      new CustomEvent<AddLiftDetail>(ADD_LIFT_EVENT, {
        detail: { liftId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #addCustom(): void {
    const name = this.customName.trim();
    if (name === '') return;
    this.dispatchEvent(
      new CustomEvent<AddCustomLiftDetail>(ADD_CUSTOM_LIFT_EVENT, {
        detail: { name, family: this.customFamily },
        bubbles: true,
        composed: true,
      }),
    );
    // Cleared so the next one starts empty. A name left in the box reads as a
    // lift that is about to be added a second time.
    this.customName = '';
  }

  readonly #onFamily = (event: CustomEvent<ChoiceChangeDetail>): void => {
    // Looked up in the typed list rather than cast: the value comes back from
    // the DOM, and an assertion would put a family through that `planWarmup`
    // has no rules for the day the two lists disagree.
    const option = FAMILY_OPTIONS.find((candidate) => candidate.family === event.detail.value);
    if (option === undefined) return;
    this.customFamily = option.family;
  };
}

/**
 * The catalogue narrowed to what the lifter typed, still grouped and in order.
 *
 * A substring match on the name, deliberately not fuzzy. A fuzzy match on
 * thirty-two short names offers the deficit deadlift for "press", and a lifter
 * who has to check whether the tool understood them is slower than one who
 * scrolls.
 */
function search(query: string): ReadonlyMap<LiftGroup, readonly LiftDefinition[]> {
  const needle = query.trim().toLowerCase();
  const grouped = liftsByGroup();
  if (needle === '') return grouped;

  const narrowed = new Map<LiftGroup, readonly LiftDefinition[]>();
  for (const [group, lifts] of grouped) {
    const matches = lifts.filter((lift) => lift.name.toLowerCase().includes(needle));
    if (matches.length > 0) narrowed.set(group, matches);
  }
  return narrowed;
}

/** What is in a native input, from the event that reported it changing. */
function readInput(event: Event): string {
  const input = event.currentTarget;
  return input instanceof HTMLInputElement ? input.value : '';
}

declare global {
  interface HTMLElementTagNameMap {
    'ptk-lift-picker': PtkLiftPicker;
  }

  interface HTMLElementEventMap {
    [ADD_LIFT_EVENT]: CustomEvent<AddLiftDetail>;
    [ADD_CUSTOM_LIFT_EVENT]: CustomEvent<AddCustomLiftDetail>;
  }
}
