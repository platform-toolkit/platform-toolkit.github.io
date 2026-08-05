// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A deterministic {@link SessionContext} for tests.
 *
 * The core takes its clock and its identifier generator as arguments precisely so
 * that a test can hand it a counter and a fixed string, and every assertion about
 * ordering, stamping and identity in this package rests on that. A test that
 * reached for `Date.now()` instead would be asserting against a value it did not
 * choose, which is how a timing assertion becomes a test that fails once a month
 * on a fast machine.
 */

import type { Instant, LogbookId } from '../types.js';

import type { SessionContext } from './session.js';

/** An invented instant. Not today's date, so nothing can pass by coincidence. */
export const AT_START: Instant = '2026-03-10T17:00:00.000Z';

/** A later invented instant, twenty minutes after {@link AT_START}. */
export const AT_LATER: Instant = '2026-03-10T17:20:00.000Z';

/** An invented calendar day matching the instants above in most of the world. */
export const ON_DAY = '2026-03-10';

/**
 * A context whose identifiers count up from `id-1`.
 *
 * Sequential and readable rather than random, because a failing assertion that
 * names `id-4` can be traced to the fourth object created; one that names a UUID
 * cannot. Each call to this function starts a fresh counter, so two contexts in
 * one test do not share a sequence -- which would make the identifiers depend on
 * the order the test happened to build things in.
 */
export function testContext(at: Instant = AT_START): SessionContext {
  let next = 0;
  return {
    nextId: (): LogbookId => {
      next += 1;
      return `id-${String(next)}`;
    },
    at,
  };
}

/**
 * A context sharing one counter across several instants.
 *
 * Used where a test performs a sequence of operations at different times and
 * still needs every identifier in the workout to be distinct -- which is the
 * realistic case, since a repository hands the same generator to every call.
 */
export function contextSeries(): (at: Instant) => SessionContext {
  let next = 0;
  const nextId = (): LogbookId => {
    next += 1;
    return `id-${String(next)}`;
  };
  return (at: Instant): SessionContext => ({ nextId, at });
}
