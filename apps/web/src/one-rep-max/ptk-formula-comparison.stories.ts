import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';

import { estimateFor, weighing } from './estimate-fixture.js';
import type { PtkFormulaComparison } from './ptk-formula-comparison.js';
import './ptk-formula-comparison.js';

/**
 * The tool showing its work: every published equation, what it answered, and why
 * it did or did not count.
 *
 * A calculator that produces one number from a score of models and never shows
 * them is asking to be trusted. §16 is what stops that, and the stories below are
 * mostly about the parts nobody would think to render — the equations that
 * declined the set, the ones shown but not counted, and the second copy of the
 * Epley relationship that is excluded precisely so one relationship cannot vote
 * twice under two names.
 *
 * The spread figures at the top are the other thing to read carefully. They are
 * how far apart published models are on this set. They are not a confidence
 * interval, not a margin of error, and not a probability — and the caveat under
 * them says so, because a reader who takes the spread for a probability plans a
 * third attempt out of it.
 *
 * The legend above the cards is the third thing to read. Twenty-two notations
 * shipped with nothing on the page defining a symbol in any of them, and `1RM =
 * 7.24 + 1.05w` is a regression on a weight — which weight being the entire
 * question. A lifter read this section and concluded the tool was using a body
 * weight it had never asked for. So the legend names `w` as the load lifted and
 * then says outright that no equation here uses body weight, which is a stronger
 * claim than defining the symbol and leaving the impression to fade.
 *
 * Two real states are missing on purpose: an assisted set and no estimate both
 * render nothing at all, which is correct and unstoryable — `smoke-stories.mjs`
 * fails a story that renders no text. The browser suite asserts both.
 */

/** Presses the summary, which is how a visitor opens it. */
async function unfold(canvasElement: HTMLElement): Promise<void> {
  const comparison = canvasElement.querySelector('ptk-formula-comparison');
  if (comparison === null) throw new Error('Nothing rendered.');
  await comparison.updateComplete;

  const summary = comparison.shadowRoot
    ?.querySelector('ptk-disclosure')
    ?.shadowRoot?.querySelector('summary');
  if (!(summary instanceof HTMLElement)) throw new Error('No summary rendered.');
  summary.click();
  await comparison.updateComplete;
}

const meta: Meta<PtkFormulaComparison> = {
  title: 'One-rep max/Every equation',
  component: 'ptk-formula-comparison',
  tags: ['autodocs'],
  argTypes: {
    estimate: {
      control: false,
      description: "The domain's whole answer, including the outcome of every equation.",
    },
  },
  args: { estimate: estimateFor() },
  render: (args) => html`
    <ptk-formula-comparison .estimate=${args.estimate}></ptk-formula-comparison>
  `,
  play: async ({ canvasElement }) => {
    await unfold(canvasElement);
  },
};

export default meta;

type Story = StoryObj<PtkFormulaComparison>;

/**
 * Five reps at 142.5 kg: seven equations counted, fifteen shown and not counted.
 *
 * Read the exclusion reasons rather than the numbers. Baechle / Welday answers
 * within a fifth of a kilogram of Epley because it *is* Epley with the
 * coefficient written out — letting both vote would give one relationship two
 * votes out of eight. Two of the Reynolds equations answer nothing at all,
 * because they are fitted on a five-rep maximum of a different movement.
 */
export const EveryEquation: Story = {};

/**
 * Twelve reps, where the models come apart.
 *
 * The full spread crosses five percent of the middle figure, which is what earns
 * the advisory on the panel above. Note the wording here does not change with it:
 * it is disagreement between published models at both widths, and the sentence
 * saying what it is not is not a footnote that appears when things look bad.
 */
export const EquationsDisagree: Story = {
  args: { estimate: estimateFor({ repsText: '12' }) },
};

/**
 * A single, where no equation gets a vote.
 *
 * The disagreement block is gone — there is nothing to disagree about — but every
 * card stays, each marked with the same reason: a single was observed and no
 * equation overrules it. Several of them do answer more than the weight lifted,
 * which is exactly why they are shown as not counting rather than hidden.
 */
export const ObservedSingle: Story = {
  args: { estimate: estimateFor({ repsText: '1' }) },
};

/**
 * Folded.
 *
 * The summary counts the equations off `FORMULAS` rather than saying a number
 * somebody typed. A sentence reading "twenty" over a list of twenty-two is the
 * tool being wrong about itself in the one section whose job is showing its work.
 */
export const Folded: Story = {
  play: async () => {
    // Deliberately does not unfold: this story is about the closed state.
  },
};

/**
 * A phone-width column.
 *
 * The reason this is a grid of cards and not a table. Five columns at 320 px is
 * either a sideways scroll or a four-character truncation — and a notation column
 * reading "1RM =" is still a rendered table, which is the version nobody catches.
 */
export const Narrow: Story = {
  args: { estimate: estimateFor(weighing('315 lb')) },
  render: (args) => html`
    <div style="width: 320px; outline: 1px dashed currentColor;">
      <ptk-formula-comparison .estimate=${args.estimate}></ptk-formula-comparison>
    </div>
  `,
};
