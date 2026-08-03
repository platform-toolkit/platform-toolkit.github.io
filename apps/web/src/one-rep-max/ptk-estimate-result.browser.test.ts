// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The answer panel: three states, one fixed order, and a vocabulary it may not use.
 *
 * Two of the three claims here are only checkable against a rendered tree. The
 * order §9.1 fixes -- figure, grade, scenarios, interpretation, reasons -- is a
 * property of the DOM and not of any return value, and a template that renders
 * the research above the number still passes every unit test that could be
 * written for it. The banned vocabulary is the same shape: `copy.ts` can be read
 * for the words it contains, but what matters is which of them reach a screen
 * for a given set, and that is a composition of five functions and a switch.
 *
 * Every estimate below comes from `estimate-fixture.ts`, which describes a set
 * and asks the domain. Nothing here hand-writes an estimate -- see the note at
 * the top of that file for why a fixture with a grade nobody computed is worse
 * than no fixture.
 */
import type { OneRepMaxEstimate, OneRepMaxProblem } from '@platform-toolkit/domain';
// Sizes are measured below and every rule that sets one reads a custom property.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { estimateFor, problemsFor, weighing } from './estimate-fixture.js';
import type { EstimateEntry } from './session.js';
import type { PtkEstimateResult } from './ptk-estimate-result.js';
import './ptk-estimate-result.js';

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

/**
 * Every refinement answered in the way that earns the best grade.
 *
 * Spelled out rather than defaulted into the fixture, because the tool's own
 * opening state answers none of these -- the technique starts on "not sure" so
 * the tool does not upgrade its own answer on a lifter's behalf. A default set
 * is therefore a rough estimate, and a story or test wanting the strong one has
 * to say what the lifter said.
 */
const EVERYTHING_ANSWERED: Partial<EstimateEntry> = {
  techniqueId: 'competition-squat',
  reserve: '0',
  freshness: 'fresh',
  formQuality: 'consistent',
  experience: 'experienced',
};

interface Options {
  readonly estimate?: OneRepMaxEstimate | null;
  readonly problems?: readonly OneRepMaxProblem[];
  readonly within?: HTMLElement;
}

async function mount(options: Options = {}): Promise<PtkEstimateResult> {
  const element = document.createElement('ptk-estimate-result');
  element.estimate = options.estimate ?? null;
  if (options.problems !== undefined) element.problems = options.problems;
  (options.within ?? document.body).append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/**
 * Where a phrase appears in the rendered text, or -1.
 *
 * The order §9.1 fixes is checked by comparing these rather than by walking the
 * element list, because the requirement is about what a lifter reads top to
 * bottom and the markup that produces it is free to change.
 */
function positionOf(element: PtkEstimateResult, phrase: string): number {
  return deepText(element).indexOf(phrase);
}

/** Every advisory's effect word, in the order they are rendered. */
function effects(element: PtkEstimateResult): string[] {
  return [...(element.shadowRoot?.querySelectorAll('.effect') ?? [])].map((label) =>
    label.textContent.trim(),
  );
}

describe('ptk-estimate-result', () => {
  it('re-renders when a property changes after first render', async () => {
    const element = await mount();
    expect(deepText(element)).toContain('Enter a weight and a repetition count');

    element.estimate = estimateFor();
    await element.updateComplete;

    expect(deepText(element)).toContain('166 kg');
  });

  it('opens on an invitation rather than on an error', async () => {
    // Nothing described yet is where every visit starts. An error there is the
    // tool telling somebody off for opening it.
    const element = await mount();
    expect(element.shadowRoot?.querySelector('ptk-notice')?.getAttribute('tone')).toBe('info');
  });

  it('puts the figure before the reasons for it, in the order §9.1 fixes', async () => {
    const element = await mount({ estimate: estimateFor(EVERYTHING_ANSWERED) });

    // Every one of these is a real position in one rendered string, so a
    // template that moved the advisories above the headline fails here and
    // nowhere else.
    const order = [
      'Estimated max',
      '166 kg',
      'Strong input',
      'Based on a squat',
      'Conservative',
      'A low-rep set stopped near failure',
      'Improves the grade',
      'An estimate from published equations',
    ].map((phrase) => positionOf(element, phrase));

    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('reads the set back so a stray keystroke is visible', async () => {
    // Thirty-three reps from a slipped finger produces a plausible number and
    // no other sign. The sentence under the headline is the only place the tool
    // says what it thought it was asked. Nothing was said about the movement
    // standard here, so nothing is claimed about it either.
    const element = await mount({ estimate: estimateFor({ repsText: '3' }) });
    expect(deepText(element)).toContain(
      'Based on a squat of 142.5 kg for 3 reps, with the reserve not stated.',
    );
  });

  it('names the movement standard once the lifter has stated one', async () => {
    const element = await mount({ estimate: estimateFor(EVERYTHING_ANSWERED) });
    expect(deepText(element)).toContain(
      'Based on a squat (competition depth, no wraps) of 142.5 kg for 5 reps, taken to failure.',
    );
  });

  it('shows all three scenarios with the middle one between the other two', async () => {
    const element = await mount({ estimate: estimateFor() });
    const rendered = deepText(element);

    expect(rendered).toContain('Conservative');
    expect(rendered).toContain('160.5 kg');
    expect(rendered).toContain('Optimistic');
    expect(rendered).toContain('167.5 kg');
    // The headline figure is the middle scenario, not a fourth number. A panel
    // showing four figures invites the question of which one to attempt.
    expect(positionOf(element, '160.5 kg')).toBeLessThan(positionOf(element, '167.5 kg'));
  });

  it('calls an observed single observed, not estimated', async () => {
    // Several equations answer more than the load at one repetition, so a tool
    // that let them through tells somebody who just missed a second attempt
    // that they in fact lifted more than they lifted.
    const element = await mount({ estimate: estimateFor({ repsText: '1' }) });
    const rendered = deepText(element);

    expect(rendered).toContain('Observed single');
    expect(rendered).toContain('142.5 kg');
    expect(rendered).not.toContain('Estimated max');
    // And no scenarios: there is nothing to be conservative or optimistic about
    // a weight that was lifted.
    expect(rendered).not.toContain('Conservative');
  });

  it('withholds a figure entirely rather than softening one', async () => {
    const element = await mount({ estimate: estimateFor({ assisted: true }) });

    expect(deepText(element)).toContain('No estimate');
    expect(deepText(element)).toContain('A spotter took part of the bar');
    // An em dash where the figure goes, not the entered weight standing in for
    // it -- that is exactly the number the domain refused to build on, and at
    // headline size it would read as the answer.
    expect(element.shadowRoot?.querySelector('.headline')?.textContent).toBe('—');
    expect(deepText(element)).not.toContain('Conservative');
  });

  it('reports every problem at once and drops the panel', async () => {
    const element = await mount({ problems: problemsFor({ repsText: '25' }) });

    expect(element.shadowRoot?.querySelector('ptk-notice')?.getAttribute('tone')).toBe('error');
    expect(deepText(element)).toContain('That set cannot be read as described.');
    expect(deepText(element)).toContain('Over twenty repetitions measures endurance');
  });

  it('shows problems even when an estimate is also set, because problems win', async () => {
    // The root never sets both, but nothing in the type stops it, and the
    // failure if the precedence went the other way is a stale figure sitting
    // where an error belongs.
    const element = await mount({
      estimate: estimateFor(),
      problems: problemsFor({ repsText: '25' }),
    });

    expect(deepText(element)).not.toContain('166 kg');
    expect(deepText(element)).toContain('That set cannot be read as described.');
  });

  it('says how each advisory moved the grade in words, not by colour alone', async () => {
    // Forced colours discards a colour cue entirely, and a lifter reading a
    // list of notes needs to know which of them cost a grade (§5.7, §21).
    const plain = await mount({ estimate: estimateFor() });
    expect(effects(plain)).toEqual(['Lowers the grade', 'Lowers the grade', 'Note']);

    // A cap is not a lowering and is labelled differently: no answer to any
    // other question can lift the grade past it.
    const capped = await mount({ estimate: estimateFor({ lift: 'other' }) });
    expect(effects(capped)).toContain('Caps the grade');
  });

  it('says where the sex question is, in the only place it mentions sex unfolded', async () => {
    // Reported as "mentions sex, but doesn't ask for it". It does ask, under
    // "Improve this estimate" -- but this note was the only mention outside that
    // fold, and a note about a setting with no route to the setting is
    // indistinguishable from a note about something the reader cannot change.
    const element = await mount({ estimate: estimateFor() });
    const rendered = deepText(element);

    expect(rendered).toContain('Sex-specific weighting is off');
    expect(rendered).toContain('Improve this estimate');
    // Optional, and said so: the grade effect is a note rather than a lowering,
    // and the sentence has to agree with the label beside it.
    expect(rendered).toContain('answering it is not required');
  });

  it('never claims a probability, an interval, or an attempt', async () => {
    // §7.5, §11, §14 and §17 are product constraints, not tone preferences. A
    // reader who takes the spread for a probability plans a third attempt out
    // of it. "Margin of error" is deliberately absent from this list and
    // checked separately below -- it appears in correct copy, denied, and a
    // blanket ban would fail against the sentence written to satisfy the rule.
    const forbidden = [
      'confidence interval',
      'probability',
      'safe attempt',
      'opener',
      'third attempt',
      'guaranteed',
      'you can lift',
    ];
    // Every state the panel has, because the banned words are likeliest to
    // appear in the ones written last.
    const states: Options[] = [
      {},
      { estimate: estimateFor(EVERYTHING_ANSWERED) },
      { estimate: estimateFor() },
      { estimate: estimateFor({ repsText: '1' }) },
      { estimate: estimateFor({ repsText: '12' }) },
      { estimate: estimateFor({ assisted: true }) },
      { estimate: estimateFor({ repsText: '18', reserve: 'four-or-more' }) },
      { problems: problemsFor({ repsText: '25' }) },
    ];

    for (const state of states) {
      const element = await mount(state);
      const rendered = deepText(element).toLowerCase();
      for (const phrase of forbidden) {
        expect(rendered).not.toContain(phrase);
      }
    }
  });

  it('mentions a margin of error only to deny being one', async () => {
    // Twelve reps is the cheapest set that makes the equations disagree by
    // enough to earn the sentence.
    const element = await mount({ estimate: estimateFor({ repsText: '12' }) });
    const rendered = deepText(element);

    expect(rendered).toContain('not a margin of error');
    // Every occurrence is that one. Counting rather than matching, because the
    // sentence may be reworded and the rule is about the denial, not the words.
    expect(rendered.split('margin of error')).toHaveLength(
      rendered.split('not a margin of error').length,
    );
  });

  it('has no accessibility violations with a full answer on screen', async () => {
    const element = await mount({ estimate: estimateFor(EVERYTHING_ANSWERED) });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('fits a phone-width column with the longest figure this panel shows', async () => {
    // A pound figure at 2.25rem is the widest thing the panel ever renders, and
    // three scenario cards beside it is the widest layout. Both at 320 px.
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
