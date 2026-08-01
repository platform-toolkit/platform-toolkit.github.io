import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { toolkitFigureFor, weighing } from './estimate-fixture.js';
import type { PtkTrainingPercentages } from './ptk-training-percentages.js';
import './ptk-training-percentages.js';

/**
 * Percentages of the estimate, and not one of them told what it is for.
 *
 * The thing to look for in every story below is what is *absent*: no row says
 * training max, working set, opener or deload. Those are decisions belonging to
 * whoever wrote the programme, and a label here would turn a reference table into
 * a prescription issued by a calculator that has never seen the lifter (§9.3).
 *
 * The other thing worth comparing across stories is the rounding. Every load
 * rounds **down**, and the step has to be the one the headline figure above was
 * rounded to — `CoarseRounding` is what it looks like when it is not: a hundred
 * percent row reading 165 kg under a headline reading 166.
 *
 * One state is deliberately missing: with no estimate the element renders nothing
 * at all, which is correct and unstoryable — `smoke-stories.mjs` fails any story
 * that renders no text, and a wrapper added to give it some would be documenting
 * the wrapper. The browser suite asserts that state instead.
 */

/** The default described set's headline figure, already rounded to 0.5 kg. */
const ESTIMATE = toolkitFigureFor();

/** Presses the summary, which is how a visitor opens it. */
async function unfold(canvasElement: HTMLElement): Promise<void> {
  const percentages = canvasElement.querySelector('ptk-training-percentages');
  if (percentages === null) throw new Error('Nothing rendered.');
  await percentages.updateComplete;

  const summary = percentages.shadowRoot
    ?.querySelector('ptk-disclosure')
    ?.shadowRoot?.querySelector('summary');
  if (!(summary instanceof HTMLElement)) throw new Error('No summary rendered.');
  summary.click();
  await percentages.updateComplete;
}

const meta: Meta<PtkTrainingPercentages> = {
  title: 'One-rep max/Training percentages',
  component: 'ptk-training-percentages',
  tags: ['autodocs'],
  argTypes: {
    estimate: {
      control: false,
      description: 'The already-rounded headline figure, or null when there is not one.',
    },
    step: { control: 'inline-radio', options: [5, 10], description: 'Whole percent between rows.' },
    roundTo: {
      control: 'number',
      description: 'The step the headline was rounded to. Every load floors to it.',
    },
  },
  args: { estimate: ESTIMATE, step: 5, roundTo: 0.5 },
  render: (args) => html`
    <ptk-training-percentages
      .estimate=${args.estimate}
      .step=${args.step}
      .roundTo=${args.roundTo}
    ></ptk-training-percentages>
  `,
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

export default meta;

type Story = StoryObj<PtkTrainingPercentages>;

/** Eleven rows at five percent, from the figure itself down to half of it. */
export const EveryFivePercent: Story = {};

/**
 * The same rows, thinned.
 *
 * Eleven rows is a scroll on a phone. This is a selection of the same figures,
 * not a second calculation — the 90% row is 149 kg in both.
 */
export const EveryTenPercent: Story = {
  args: { step: 10 },
};

/**
 * A rounding step coarser than the headline's.
 *
 * What the section must never look like in the tool: the first row reads 165 kg
 * under a headline reading 166. Two figures on one screen that should be
 * identical and are not, which a lifter reads as the tool getting arithmetic
 * wrong rather than as a rounding choice. The root passes the entry's own step
 * for exactly this reason; this story exists so the failure is recognisable.
 */
export const CoarseRounding: Story = {
  args: { roundTo: 2.5 },
};

/** Pounds, rounded to the pound. */
export const Pounds: Story = {
  args: { estimate: toolkitFigureFor(weighing('315 lb')), roundTo: 1 },
};

/**
 * Folded.
 *
 * The summary carries the whole of what is inside: which figure the percentages
 * are of, and which way each load was rounded. A fold that hid either would leave
 * a lifter reading loads without knowing what they are a fraction of.
 */
export const Folded: Story = {
  play: async () => {
    // Deliberately does not unfold: this story is about the closed state.
  },
};

/**
 * A phone-width column.
 *
 * Two columns of numbers is the one table shape that survives 320 px without
 * scrolling sideways, and every row is a thumb tall whether or not tapping it
 * does anything.
 */
export const Narrow: Story = {
  args: { estimate: toolkitFigureFor(weighing('315 lb')), roundTo: 1 },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-training-percentages
        .estimate=${args.estimate}
        .step=${args.step}
        .roundTo=${args.roundTo}
      ></ptk-training-percentages>
    </div>
  `,
};
