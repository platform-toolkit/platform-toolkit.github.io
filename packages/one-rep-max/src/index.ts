// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One-rep max estimator.
 *
 * An estimate from a set that was actually performed -- a weight, a repetition
 * count, and as much or as little else as the lifter wants to say about it --
 * shown as three figures with a stated grade and every published equation
 * behind them. It never claims a lifter can complete the number, and the spread
 * between equations is never dressed up as a confidence interval: the tool's job
 * is to show its working, not to sell the answer.
 *
 * Entry points: `.` is this file, `./core` is the pure rules, `./element` is the
 * five custom elements plus `defineOneRepMax()`, and `./types` is the
 * vocabulary. The equations themselves are `@platform-toolkit/domain`, so a
 * consumer that wants the figure and not the interface can stop there.
 */

export * from './core/index.js';
export type * from './types.js';
