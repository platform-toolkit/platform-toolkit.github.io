// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Platform Targets.
 *
 * What a lifter in one category has to lift to reach the next classification, the
 * next record, or a goal they set themselves -- drawn from a federation's own
 * published classification standards and record books, and never from a number
 * written into this repository (§5.1). A category is seven answers, four of them
 * required; the report is every lift, every level, and the exact kilograms
 * between where the lifter is and each target.
 *
 * Entry points: `.` is this file, `./core` is the pure rules, `./element` is the
 * seven custom elements plus `definePlatformTargets()`, and `./types` is the
 * vocabulary. The published artifacts are `@platform-toolkit/data-contracts` and
 * fetching them is the host's job -- this package is handed a catalogue, a
 * standards book and a set of record reads, and says what they mean. Which
 * federation any of it belongs to is likewise the host's to decide: nothing here
 * defaults one.
 */

export * from './core/index.js';
export type * from './types.js';
// The one runtime value in the vocabulary. `export type *` above erases it, and
// a consumer handling the widened view-change event from this entry point
// should get the sentinel, not have to spell 'all' as a literal.
export { ALL_LIFTS } from './types.js';
