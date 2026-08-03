// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §12's result card, in the states a lifter actually puts it into.
 *
 * The interesting states are all about what the card is *asking* at a given
 * moment: nothing on the platform, an outcome not yet chosen, and the two
 * follow-up questions that only one outcome each brings on screen. A story of
 * the filled-in happy path documents the one arrangement nobody has trouble
 * imagining.
 *
 * The draft is element-local and clears when the attempt changes, so a story
 * cannot set it from outside. Each story that needs one presses the tiles in a
 * `play` function instead -- which is also the only way to document them, since
 * "what the card looks like after Good lift" is a fact about the interaction.
 */
import { attemptWeightFor } from '@platform-toolkit/domain';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { EFFORT_FIELD, OUTCOME_FIELD } from './fields.js';
import type { PtkAttemptResult, ResultSubject } from './ptk-attempt-result.js';
import './ptk-attempt-result.js';

/**
 * An invented weight, on an invented grid (§5.1).
 *
 * No chart is supplied, so `publishedPounds` is `null` and the card shows the
 * kilogram figure alone -- which is the honest state on a screen with no
 * federation pound chart loaded, and §16 forbids filling the gap by computing.
 */
const WEIGHT = attemptWeightFor(182.5, null);

const SUBJECT: ResultSubject = {
  attemptId: 'attempt-squat-2',
  lifterName: 'Sam Okafor',
  lift: 'squat',
  attemptNumber: 2,
  weight: WEIGHT,
};

const meta: Meta<PtkAttemptResult> = {
  title: 'Meet day/Attempt result',
  component: 'ptk-attempt-result',
  tags: ['autodocs'],
  args: { subject: SUBJECT },
  render: (args) => html`<ptk-attempt-result .subject=${args.subject}></ptk-attempt-result>`,
};

export default meta;

type Story = StoryObj<PtkAttemptResult>;

/**
 * The one card on the canvas, settled.
 *
 * Thrown at rather than returned nullable: a story whose subject failed to render
 * would otherwise document an empty box, and `smoke-stories.mjs` fails a story
 * that renders no text -- but only after somebody has read the screenshot and
 * wondered. The throw names the cause on the first line of the log instead.
 */
async function cardIn(canvasElement: HTMLElement): Promise<PtkAttemptResult> {
  const card = canvasElement.querySelector('ptk-attempt-result');
  if (card === null) throw new Error('The card did not render.');
  await card.updateComplete;
  return card;
}

/** Presses one tile in a group tagged with a `data-field`, the way a thumb does. */
async function press(
  canvasElement: HTMLElement,
  field: string,
  value: string,
): Promise<PtkAttemptResult> {
  const card = await cardIn(canvasElement);
  const group = card.shadowRoot?.querySelector(`[data-field="${field}"]`);
  const radio = [...(group?.shadowRoot?.querySelectorAll('input') ?? [])].find(
    (input) => input.value === value,
  );
  if (radio === undefined) {
    throw new Error(`No "${value}" tile in the "${field}" group.`);
  }
  radio.click();
  await card.updateComplete;
  return card;
}

/** Opens the optional half by setting `open`, not by pressing the summary. */
async function openDetails(card: PtkAttemptResult): Promise<void> {
  const fold = card.shadowRoot?.querySelector('ptk-disclosure');
  if (fold === null || fold === undefined) {
    throw new Error('The details fold is not on the card.');
  }
  // Set rather than pressed: `<details>` fires `toggle` asynchronously, so a
  // press leaves the story racing the browser for the screenshot.
  fold.open = true;
  await card.updateComplete;
}

/**
 * Nothing on the platform.
 *
 * The state the live screen sits in between a result going in and the next bar
 * being loaded, and the reason `subject` is nullable rather than the caller
 * unmounting the card: a card that appears and disappears moves everything below
 * it twice per attempt.
 */
export const Waiting: Story = { args: { subject: null } };

/** The opening question, and the only one on screen until it is answered. */
export const Unanswered: Story = {};

/**
 * §12.2's six readings, which only a good lift asks for.
 *
 * These are the tiles that change what the tool offers next, which is why they
 * are the only list on the card carrying a second line each.
 */
export const GoodLift: Story = {
  play: async ({ canvasElement }) => {
    await press(canvasElement, OUTCOME_FIELD, 'good');
  },
};

/**
 * §12.3's six reasons.
 *
 * A tile list rather than a note, because the requirement says outright that
 * these "materially affect the next recommendation and must not be hidden in a
 * notes field".
 */
export const NoLift: Story = {
  play: async ({ canvasElement }) => {
    await press(canvasElement, OUTCOME_FIELD, 'no-lift');
  },
};

/** Two taps. A pass asks nothing: there is no reading to take from it. */
export const Passed: Story = {
  play: async ({ canvasElement }) => {
    await press(canvasElement, OUTCOME_FIELD, 'passed');
  },
};

/** Answered end to end, so Record is live. Three taps from an empty card. */
export const ReadyToRecord: Story = {
  play: async ({ canvasElement }) => {
    await press(canvasElement, OUTCOME_FIELD, 'good');
    await press(canvasElement, EFFORT_FIELD, 'solid');
  },
};

/**
 * The optional half, opened.
 *
 * Lights, RPE and the note, none of them required (§12.1) -- and the RPE field
 * appears only under a good lift, because there is no exertion to grade on a
 * miss.
 */
export const DetailsOpen: Story = {
  play: async ({ canvasElement }) => {
    await openDetails(await press(canvasElement, OUTCOME_FIELD, 'good'));
  },
};

/** No weight was declared before the bar was loaded. Said, not left blank. */
export const NoWeightDeclared: Story = {
  args: { subject: { ...SUBJECT, weight: null } },
};

/**
 * The width a phone gives this card.
 *
 * Constrained by a wrapper rather than a viewport setting, because the wrapper
 * is what the element responds to (§5.7). The three light bars are the part that
 * has to collapse to one column here.
 */
export const Narrow: Story = {
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-attempt-result .subject=${args.subject}></ptk-attempt-result>
    </div>
  `,
  play: async ({ canvasElement }) => {
    await openDetails(await cardIn(canvasElement));
  },
};
