// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Convert.
 *
 * Pounds to kilograms and back, against a federation's *published* chart rather
 * than against arithmetic alone. Those are two different numbers -- the exact
 * mathematical equivalent of 315 lb is not the figure the federation will let a
 * lifter load -- and the whole tool exists to keep them apart and show both.
 *
 * A row is never manufactured. A weight that falls between published rows gets the
 * rows either side and which is nearer, an exact midpoint is reported as a tie, and
 * a federation that publishes no chart is a state of its own rather than an error.
 *
 * Entry points: `.` is this file, `./core` is the pure rules, `./element` is the
 * four custom elements plus `defineConvert()`, and `./types` is the vocabulary.
 * Transport -- fetching the chart -- lives outside this package, in
 * `apps/web/src/convert/view.ts`.
 */

export * from './core/index.js';
export type * from './types.js';
