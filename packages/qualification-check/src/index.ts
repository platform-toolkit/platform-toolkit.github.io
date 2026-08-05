// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Qualification Check.
 *
 * Answers one question -- "what does this lifter's competition history support?"
 * -- three ways, and never answers the question after it. Whether somebody may
 * enter a meet is the federation's to decide (section 29); this package puts the
 * published criteria and the published results side by side and lets a person
 * read them.
 *
 * The three ways in, in the order they matter:
 *
 * 1. **No meet, or a meet nobody has transcribed.** Classification per lift,
 *    classification on the total, and drug-tested status, so a lifter can read an
 *    unfamiliar entry form against them. This is the common case and it is built
 *    first, because a tool that can only answer for the meets somebody happened to
 *    ingest is unhelpful precisely when it is needed.
 * 2. **A meet with transcribed criteria**, read route by route.
 * 3. **A date range and a results archive**, which supplies the history the other
 *    two read.
 *
 * Entry points: `.` is this file, `./core` is the pure rules, and `./types` is the
 * vocabulary. Nothing above `./core` may hold transport.
 */

export * from './core/index.js';
export type * from './types.js';
