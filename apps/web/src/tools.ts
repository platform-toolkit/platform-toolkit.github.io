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
  {
    id: 'qualify',
    name: 'Qualification Check',
    summary:
      // "Reads" and "asks", never "eligible". The tool does not rule on entry
      // and the hub is the first place that promise is made or broken -- a
      // lifter who arrives expecting a verdict has been told the wrong thing
      // before the page has loaded.
      'What your results say about the meets you could enter, and every question the entry form will ask that an archive cannot answer.',
    embedPath: 'qualify/embed/uspa/',
  },
  {
    id: 'logbook',
    name: 'Training Logbook',
    summary:
      // "On this device" is the whole promise and it belongs in the first
      // sentence anybody reads about the tool. Every other tool on this hub
      // answers a question and forgets it; this one is asked to keep something,
      // and a lifter deciding whether to trust it with a training year needs to
      // know where it goes before they tap. It is also the honest limit -- there
      // is no account and no sync, and the backup is how training moves.
      'Plan a session, tick off each set as you finish it, and keep the record on this device.',
    embedPath: 'logbook/embed/',
  },
];
