/**
 * Every equation shown, and the spread underneath it kept out of the language of
 * probability.
 *
 * Three claims need a rendered tree. The first is completeness: §16 requires every
 * formula in the library to be listed with its equation, its source and the reason
 * it did or did not count, and "every" is a comparison between what `FORMULAS`
 * holds and what reaches the screen — a template that dropped the excluded ones
 * would still return a correct estimate. The second is the vocabulary: the spread
 * figures are disagreement between published models and the copy has to say so and
 * say what they are not. The third is the layout: five columns of data at 320 px is
 * either a sideways scroll or a silent truncation, and the card grid exists to be
 * neither.
 */
import { FORMULAS } from '@platform-toolkit/domain';
// The card grid's track minimum is a length in a custom property; without the
// stylesheet the grid has no minimum and the 320px measurement below is of a
// layout that does not ship.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { estimateFor, weighing } from './estimate-fixture.js';
import type { PtkFormulaComparison } from './ptk-formula-comparison.js';
import './ptk-formula-comparison.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface Options {
  readonly estimate?: PtkFormulaComparison['estimate'];
  readonly within?: HTMLElement;
  readonly open?: boolean;
}

async function mount(options: Options = {}): Promise<PtkFormulaComparison> {
  const element = document.createElement('ptk-formula-comparison');
  element.estimate = options.estimate === undefined ? estimateFor() : options.estimate;
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  if (options.open ?? true) {
    const disclosure = element.shadowRoot?.querySelector('ptk-disclosure');
    if (disclosure === null || disclosure === undefined) throw new Error('No disclosure rendered.');
    disclosure.open = true;
    await element.updateComplete;
  }
  return element;
}

/** The text of one class of element on every card, in card order. */
function texts(element: PtkFormulaComparison, selector: string): string[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].map((node) =>
    node.textContent.trim(),
  );
}

describe('ptk-formula-comparison', () => {
  it('re-renders when the estimate changes after the first render', async () => {
    const element = await mount();
    expect(deepText(element)).toContain('(5.6%)');

    element.estimate = estimateFor({ repsText: '12' });
    await element.updateComplete;

    expect(deepText(element)).toContain('(11.8%)');
  });

  it('lists every published equation, counted or not', async () => {
    // The failure this catches is a filter that quietly showed only the seven
    // that voted -- which looks like a tidier table and is the whole of what §16
    // forbids. A tool that produces one number from a score of models and never
    // shows them is asking to be trusted.
    const element = await mount();
    const names = texts(element, '.name');

    expect(names).toHaveLength(FORMULAS.length);
    expect(names).toEqual(FORMULAS.map((formula) => formula.name));
  });

  it('says the same count in the summary as it renders in cards', async () => {
    // Written out, the sentence would keep reading "twenty" over a list of
    // twenty-two the day an equation is added -- the tool being wrong about
    // itself, in the one section whose whole job is showing its work.
    const element = await mount({ open: false });
    const summary = element.shadowRoot?.querySelector('ptk-disclosure')?.getAttribute('summary');
    expect(summary).toBe(
      `${String(FORMULAS.length)} published equations, what each answered for this set, and why it did or did not count.`,
    );
  });

  it('gives every card its equation, its source, and the reason it did or did not count', async () => {
    const element = await mount();

    expect(texts(element, '.notation')).toHaveLength(FORMULAS.length);
    expect(texts(element, '.source')).toHaveLength(FORMULAS.length);
    expect(texts(element, '.reason')).toHaveLength(FORMULAS.length);
    // A spot check that the content is the formula's own rather than a
    // placeholder repeated: Epley's is the one everybody recognises.
    expect(deepText(element)).toContain('1RM = w × (1 + r / 30)');
    expect(deepText(element)).toContain('Epley, 1985.');
  });

  it('defines the symbols the equations are written in', async () => {
    // Twenty-two notations shipped with nothing on the page defining a letter in
    // any of them. `w` is the load lifted and the legend has to say so in those
    // words, because the alternative reading is the one a lifter actually
    // reached: that `1RM = 7.24 + 1.05w` is a regression on their body weight.
    const element = await mount();
    const rendered = deepText(element);

    expect(rendered).toContain('Reading the equations');
    expect(rendered).toContain('what was on the bar, not what you weigh');
    expect(rendered).toContain('the reps you completed plus any you said were left');
    expect(rendered).toContain('The heaviest weight liftable for five repetitions.');
  });

  it('says outright that no equation here uses body weight', async () => {
    // Not left to the legend to imply. A reader who has just worked out that one
    // of these wants their body weight needs the impression contradicted, and
    // needs to know the omission is a decision rather than a missing field.
    const element = await mount();
    const rendered = deepText(element);

    expect(rendered).toContain('None of these equations uses body weight');
    expect(rendered).toContain('one fixed test load');
  });

  it('keeps the legend when no equation voted', async () => {
    // An observed single takes the spread section away with it, and the legend
    // is not part of the spread: twenty-two notations are still on screen and
    // still need their letters defined.
    const element = await mount({ estimate: estimateFor({ repsText: '1' }) });
    const rendered = deepText(element);

    expect(rendered).not.toContain('How far apart the equations are');
    expect(rendered).toContain('Reading the equations');
    expect(rendered).toContain('None of these equations uses body weight');
  });

  it('names the 2026 preprint after its author, not after its shape', async () => {
    // "Weight-dependent" was the one card whose *name* invited the reading the
    // notations invite: in a barbell tool, weight is a lifter's own about as
    // often as it is a load. It is dependent on the magnitude of the bar.
    const element = await mount();
    const rendered = deepText(element);

    expect(texts(element, '.name')).toContain('Marzagão (2026 preprint)');
    expect(rendered).not.toContain('Weight-dependent');
  });

  it('marks an equation that did not count without dimming what it says', async () => {
    // The reason a formula was excluded is the most useful sentence on the card,
    // so exclusion is drawn with a border and a surface -- never by fading text
    // a reader then has to squint at.
    const element = await mount();
    const excluded = element.shadowRoot?.querySelectorAll('.card.excluded') ?? [];

    expect(excluded.length).toBeGreaterThan(0);
    for (const card of excluded) {
      expect(card.textContent.trim()).not.toBe('');
      expect(Number.parseFloat(getComputedStyle(card).opacity)).toBe(1);
    }
    expect(deepText(element)).toContain('Expanded set: shown, not counted');
  });

  it('shows an equation that declined the set as having no answer', async () => {
    // A blank cell reads as a rendering fault. "No answer" is a fact about the
    // equation's supported range and is a different thing from answering zero.
    const element = await mount();
    expect(texts(element, '.result')).toContain('No answer');
  });

  it('reports the five disagreement figures §8.4 asks for by name', async () => {
    const element = await mount();
    const rendered = deepText(element);

    for (const term of [
      'Lowest equation',
      'Highest equation',
      'Full spread',
      'Middle half',
      'Independent families counted',
    ]) {
      expect(rendered).toContain(term);
    }
    // One place on the percentages, because 2.5 and 3.4 sit either side of the
    // threshold that moves a grade and a whole number would print both as 3.
    expect(rendered).toContain('9.28 kg (5.6%)');
    expect(rendered).toContain('7');
  });

  it('says what the spread is not, in the same breath as showing it', async () => {
    const element = await mount();
    const rendered = deepText(element);

    expect(rendered).toContain('disagreement between published models');
    expect(rendered).toContain('not a margin of error');
    expect(rendered).toContain('says nothing about how likely any of these figures is');
  });

  it('never borrows the language of probability for the spread', async () => {
    // §7.5 and §11 are product constraints. A reader who takes the spread for a
    // probability plans a third attempt out of it.
    for (const estimate of [
      estimateFor(),
      estimateFor({ repsText: '12' }),
      estimateFor({ repsText: '1' }),
      estimateFor({ repsText: '18', reserve: 'four-or-more' }),
    ]) {
      const element = await mount({ estimate });
      const rendered = deepText(element).toLowerCase();
      for (const phrase of [
        'confidence interval',
        'probability',
        'standard deviation',
        'likely to lift',
        'guaranteed',
      ]) {
        expect(rendered).not.toContain(phrase);
      }
    }
  });

  it('drops the spread, but not the equations, when nothing was estimated', async () => {
    // A single was observed, so no equation gets a vote and there is nothing for
    // them to disagree about -- but what each of them would have said is still
    // the interesting part of the section, and §16 still wants it shown.
    const element = await mount({ estimate: estimateFor({ repsText: '1' }) });
    const rendered = deepText(element);

    expect(rendered).not.toContain('How far apart the equations are');
    expect(texts(element, '.name')).toHaveLength(FORMULAS.length);
    expect(rendered).toContain('A single was observed; no equation overrules it');
  });

  it('renders nothing at all when no equation was evaluated', async () => {
    // An assisted set is refused before any equation runs. A fold promising what
    // each equation answered, over an empty list, reads as a section that failed
    // to load rather than as a set nothing was computed from.
    const element = await mount({ estimate: estimateFor({ assisted: true }), open: false });
    expect(element.shadowRoot?.querySelector('ptk-disclosure')).toBeNull();
    expect(deepText(element).trim()).toBe('');
  });

  it('renders nothing without an estimate', async () => {
    const element = await mount({ estimate: null, open: false });
    expect(deepText(element).trim()).toBe('');
  });

  it('states the methodology version, because a later tool will quote it', async () => {
    const element = await mount();
    expect(deepText(element)).toContain('Methodology version 1.0.0.');
  });

  it('has no accessibility violations with every card showing', async () => {
    const element = await mount();
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with twenty-two cards and a pound figure', async () => {
    // The reason this is cards and not a table. Five columns at 320 px is either
    // a sideways scroll or a four-character truncation, and the second one is
    // silent -- a notation column reading "1RM =" is still a rendered table.
    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });

    await mount({ estimate: estimateFor(weighing('315 lb')), within: frame });

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
