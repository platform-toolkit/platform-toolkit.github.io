// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What is on the bar for one set, drawn.
 *
 * Its own file rather than a method on the logging screen because two screens want it:
 * the logging screen draws it under every set now, and the builder will draw it under a
 * generated ramp at #17. A second copy would be the section 5.8 fork the whole collection
 * exists to avoid, and it would fork in the direction nobody checks -- the two screens
 * would agree on the plates and disagree about what to say when the rack cannot build the
 * weight, which is the case a lifter actually reads.
 *
 * WHY THE UNIT IS THE RACK'S AND NOT THE LIFTER'S
 *
 * `Loading.perSide` is in `plateUnit`, always. A lifter who trains at a kilogram gym and
 * reads in pounds is ordinary, and `displayUnit` is what the *plan* above the diagram is
 * written in -- so passing it here would label 20 kg plates "20 lb" and be wrong by a
 * factor a lifter would not notice until the bar came off the rack. The caller passes
 * `equipment.plateUnit` and nothing here has an opinion about the other one.
 *
 * Nothing in this file decides anything. `core/loading.ts` already answered, including
 * which stored plan a set reads its plates from (section 8.4); this turns that answer
 * into elements.
 */

import {
  describeChange,
  formatWeight,
  type Loading,
  type WeightUnit,
} from '@platform-toolkit/domain';
import { html, nothing, type TemplateResult } from 'lit';

import type { SetLoading } from '../core/loading.js';

import { LOADING_NOTES } from './copy.js';

/**
 * The plates for one set, or nothing at all.
 *
 * `nothing` for the `none` case rather than a sentence: a chin-up row explaining that it
 * has no plates would put a line of apology under every set of a bodyweight session, and
 * a weight box nobody has typed into yet is not a fault to report.
 */
export function renderLoading(
  loading: SetLoading,
  unit: WeightUnit,
): TemplateResult | typeof nothing {
  switch (loading.kind) {
    case 'none':
      return nothing;
    case 'loaded':
      return html`<div class="loading">
        <ptk-plate-stack
          .plates=${loading.loading.perSide}
          unit=${unit}
          empty-label=${LOADING_NOTES.barOnly}
        ></ptk-plate-stack>
        ${renderChange(loading, unit)}
      </div>`;
    case 'not-loadable':
      return html`<p class="loading-note">${describeGap(loading.below, loading.above, unit)}</p>`;
  }
}

/**
 * What has to move since the set above.
 *
 * Drawn only where there is something to carry. `describeChange` answers the empty string
 * for two identical loadings, and a row saying nothing has changed would be a line of
 * text per set for the commonest case there is -- a lifter doing five sets across.
 */
function renderChange(
  loading: Extract<SetLoading, { kind: 'loaded' }>,
  unit: WeightUnit,
): TemplateResult | typeof nothing {
  if (loading.change === null) return nothing;
  const text = describeChange(loading.change, unit);
  if (text === '') return nothing;
  return html`<p class="loading-note">${text}</p>`;
}

/**
 * The sentence for a weight the rack cannot build.
 *
 * Both neighbours can be absent -- above at the top of what the plates reach, below under
 * an empty bar -- and naming the ones that exist is the whole value of the line. A bare
 * "these plates cannot build that" leaves a lifter to work out what to type instead while
 * standing at the bar, which is the moment this tool is least able to help them.
 *
 * The same words as the warm-up calculator's `working-weight-not-loadable` advisory, and
 * deliberately so: it is the same fact about the same rack, and two phrasings would read
 * as two different problems to somebody who used both tools in one session.
 */
function describeGap(below: Loading | null, above: Loading | null, unit: WeightUnit): string {
  const neighbours = [below, above]
    .filter((loading): loading is Loading => loading !== null)
    .map((loading) => formatWeight({ amount: loading.total, unit }));
  if (neighbours.length === 0) return LOADING_NOTES.notLoadable;
  const lead = neighbours.length === 1 ? LOADING_NOTES.nearestOne : LOADING_NOTES.nearestTwo;
  return `${LOADING_NOTES.notLoadable} ${lead} ${neighbours.join(' and ')}.`;
}
