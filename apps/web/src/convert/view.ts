// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Builds the converter, reads the federation's chart, and gives the tool
 * somewhere to remember what it was doing.
 *
 * The only file in this tool that knows a transport or a storage exists --
 * §5.8's rule, arriving for the third time. Everything below takes the chart and
 * the *state of the read* as properties, which is what makes "still loading",
 * "this federation publishes none", and "the read failed" three different
 * sentences on screen and three reachable states in a story with no network.
 *
 * WHY THE VALIDATION FAILURE IS NOT AN ERROR STATE
 *
 * `ConversionChart.from` can refuse a published chart -- rows out of order, a
 * repeated value -- and when it does the tool renders `ready` with no chart,
 * which reads to a visitor exactly like a federation that publishes none. That
 * is the honest answer: nothing the visitor can do changes it, and telling them
 * to reload would be a lie. The reason goes to the console for whoever maintains
 * the feed, which is who can act on it.
 */
import { DataSourceError, type DataSource } from '@platform-toolkit/data-access';
import { ConversionChart } from '@platform-toolkit/domain';
import {
  browserPreferenceStorage,
  createPreferenceStore,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

import { dataSource } from '../data-source.js';
import './ptk-converter.js';
import type { PtkConverter } from './ptk-converter.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'convert';

export interface ConverterViewOptions {
  /**
   * Whose chart to quote. Required, and required for the same reason tool 1's
   * is (§5.1): a default here is a federation named in code, which stays valid
   * the day a second one ships and is silently wrong from then on. A conversion
   * chart is exactly the kind of number that must not be guessed -- the whole
   * tool is an argument that 500 lb has no single right answer.
   */
  readonly federationId: string;

  /** Defaults to the site's configured source. Injected in tests. */
  readonly source?: DataSource;

  /** Defaults to this device's ordinary storage. Injected in tests. */
  readonly settings?: PreferenceStore;
}

/**
 * The tool, ready to append.
 *
 * Returned before the chart arrives, showing its own loading sentence, so the
 * page has a height immediately -- the embed route reports that height to its
 * parent, and a frame that starts at zero and then jumps is worse than one that
 * starts the size of a sentence.
 */
export function createConverterView(options: ConverterViewOptions): PtkConverter {
  const element = document.createElement('ptk-converter');
  element.settings = options.settings ?? createPreferenceStore(browserPreferenceStorage());

  void loadChart(element, options.source ?? dataSource, options.federationId);
  return element;
}

async function loadChart(
  element: PtkConverter,
  source: DataSource,
  federationId: string,
): Promise<void> {
  try {
    const data = await source.getConversionChart(federationId);
    if (data === null) {
      // An answer, not a failure: this federation publishes no chart. The
      // exact arithmetic is still shown, labelled as arithmetic, and the screen
      // says why there is no chart figure beside it.
      element.chartStatus = 'unavailable';
      return;
    }

    const result = ConversionChart.from(data);
    if (!result.ok) {
      // Reported here rather than swallowed (§2.4), and reported with the
      // problem codes only -- the messages are about the data's shape, not its
      // values, so they are safe, but the codes are what identify the defect.
      console.error(
        `The published conversion chart could not be used: ${result.problems
          .map((problem) => problem.code)
          .join(', ')}.`,
      );
      element.chartStatus = 'ready';
      return;
    }

    element.chart = result.chart;
    element.chartStatus = 'ready';
  } catch (caught) {
    element.chartStatus = 'failed';
    reportFailure(caught);
  }
}

/**
 * Says on the console that the read failed, and says nothing else.
 *
 * The caught object is not passed through. `DataSourceError` carries no URL by
 * construction, but its `cause` is whatever the transport threw and a console
 * expands a cause chain -- which is where a request URL shows up. The reason
 * code is the part that helps and the only part that is safe to keep.
 */
function reportFailure(caught: unknown): void {
  const reason = caught instanceof DataSourceError ? caught.reason : 'unexpected';
  console.error(`The converter could not load the conversion chart: ${reason}.`);
}
