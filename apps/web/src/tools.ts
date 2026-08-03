// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Every tool published by this site.
 *
 * Adding a tool means an entry here, an entry in `vite.config.ts`, and the pages
 * themselves. Nothing else in the site needs to know the list.
 *
 * Paths are relative on purpose. The site is normally served from the root, but
 * `PTK_BASE_PATH` lets it deploy under a subpath on another host, and a relative
 * href resolves correctly under either without the page having to know which.
 */
export interface Tool {
  /** Directory segment, and the tool's stable identifier in message payloads. */
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Present when the tool offers a route intended to be framed by other sites. */
  readonly embedPath?: string;
}

export const TOOLS: readonly Tool[] = [
  {
    id: 'platform-targets',
    name: 'Platform Targets',
    summary:
      'Classifications, records, and meet qualification standards for one lifter, on one screen.',
    embedPath: 'platform-targets/embed/uspa/',
  },
  {
    id: 'warm-up',
    name: 'Warm-Up Calculator',
    summary: 'Warm-up sets and plate loading for a working weight, on the plates in front of you.',
    embedPath: 'warm-up/embed/',
  },
  {
    id: 'convert',
    name: 'Pounds and Kilograms',
    summary:
      "The exact conversion and the weight the federation's published chart actually lists, side by side.",
    embedPath: 'convert/embed/uspa/',
  },
  {
    id: 'one-rep-max',
    name: 'One-Rep Max Estimator',
    summary:
      // No count in the sentence. The library gains and loses equations, and a
      // numeral here is a claim on the hub that nothing recomputes -- it would
      // keep reading "twenty" beside a tool that shows twenty-two.
      'What a set you already did suggests about a single, from the published equations — including where they disagree.',
    embedPath: 'one-rep-max/embed/',
  },
  {
    id: 'meet-day',
    name: 'Meet Day Planner',
    summary:
      // "Legal" rather than a number: what a bar may be loaded to is published
      // data per federation, and a figure in this sentence would be a rule in
      // source (§5.1) that nothing refreshes.
      'Nine attempts that are legal on your federation’s bar, with what each one asks of you and how much the plan is standing on kept apart.',
    embedPath: 'meet-day/embed/',
  },
];
