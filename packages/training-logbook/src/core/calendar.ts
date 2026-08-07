// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { CalendarDay, Instant } from '../types.js';

/**
 * The calendar day an instant falls on, in the zone the code is running in.
 *
 * Pure, and that is the whole point of it being here rather than in the element:
 * it reads no clock. It takes an instant somebody else already obtained, which in
 * practice is the element's `now`, so the one wall-clock read the package makes
 * stays where it was and this adds none.
 *
 * `apps/web/src/clock.ts` has a sibling, `localCalendarDay`, whose own docblock
 * warns against exactly the third copy this looks like. It is not shared with
 * this one for two reasons and both are structural: that function takes epoch
 * milliseconds and sits beside the wall-clock read it belongs to, and a package
 * cannot import from the application that consumes it. What that comment is
 * really guarding is the mistake below, so the guard travels with the copy.
 *
 * **Never `toISOString`.** It is UTC, so everyone west of Greenwich gets
 * yesterday through their whole evening and files a session under a day they did
 * not train on; east of it the error runs the other way. The local getters are
 * the only correct read, and the test beside this pins it.
 */
export function calendarDayOf(instant: Instant): CalendarDay {
  const when = new Date(instant);
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${String(when.getFullYear())}-${month}-${day}`;
}
