// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Handing today's session to the training logbook.
 *
 * The only file in this tool that imports the logbook's package, and the whole
 * of tool 2's half of section 4.3. Everything above it -- the calculator, the
 * cards, `session.ts` -- deals in `LoggableLift`, which is this tool's own
 * vocabulary, so the coupling is one module deep and one direction only. Why
 * that is worth insisting on: an element that imported the other tool would put
 * the logbook's catalogue, schemas and validator into the module graph of a
 * story, a browser test and an embedded calculator on somebody else's page, all
 * of which have no logbook to hand anything to.
 *
 * WHY THE ACTION IS A LINK AND THIS FILE DOES NOT NAVIGATE
 *
 * The record is written and the browser follows an ordinary `<a>`. Nothing here
 * or in the element touches `window.location`, which section 5.7 forbids
 * anywhere but a page entry -- and the reasons are not abstract on this
 * particular button. A real link is middle-clickable, is what a phone's
 * long-press offers to open in a new tab, and shows where it goes before it is
 * pressed. A script navigation is none of those, and on the one screen in this
 * collection somebody uses with chalk on their hands it would also be the thing
 * that swallows the press when the record fails to write.
 *
 * The href therefore comes from the page rather than from here, and it is
 * relative -- see `standalone.ts`, which is also where the reason the embed
 * route deliberately has no handoff is written down.
 */
import type { Equipment } from '@platform-toolkit/domain';
import { browserPreferenceStorage } from '@platform-toolkit/preferences';
import {
  offerHandoff,
  snapshotFrom,
  type HandoffExercise,
  type HandoffStorage,
} from '@platform-toolkit/training-logbook/handoff';

import { type Clock, systemClock } from '../clock.js';

import { loggableSession, type LiftEntry } from './session.js';

/** What the calculator needs in order to offer the logbook today's session. */
export interface LogbookHandoff {
  /** Where the action points. Resolved by the browser against the page. */
  readonly href: string;
  /**
   * Leaves the record for the logbook to find.
   *
   * `'unavailable'` where the browser will not give this page storage, or where
   * nothing in the list is finished enough to log. Answered rather than thrown
   * so the caller can say so instead of sending somebody to an empty screen --
   * the one failure this feature can produce that a lifter would not otherwise
   * notice until they arrived.
   */
  offer(entries: readonly LiftEntry[], equipment: Equipment): 'offered' | 'unavailable';
}

export interface LogbookHandoffOptions {
  readonly href: string;
  /** Where the record is left, or `null` where this origin refuses storage. */
  readonly storage: HandoffStorage | null;
  /** Defaults to the device's clock. The record is stamped so it can expire. */
  readonly clock?: Clock;
}

/**
 * The handoff, over a storage the caller supplies.
 *
 * The translation from this tool's rows to the record's is here and nowhere
 * else, and it is deliberately dull: every field is one of the lifter's own
 * inputs. Nothing computed crosses -- no ramp, no plate list, no total -- because
 * section 8.1 says both tools must answer the same for the same inputs, and a
 * record carrying an answer is that rule with a delivery mechanism attached. The
 * receiving build rebuilds the ramp through the same engine this one drew it
 * with, so the two agree by construction rather than by review.
 *
 * The exception is the adjustments, which are inputs too: a rung the lifter typed
 * over is a choice and not a calculation, and it is the one thing the far side
 * cannot re-derive.
 */
export function createLogbookHandoff(options: LogbookHandoffOptions): LogbookHandoff {
  const clock = options.clock ?? systemClock();

  return {
    href: options.href,
    offer: (entries, equipment) => {
      const { lifts } = loggableSession(entries, equipment);
      // Nothing to hand over is reported as the same failure as nowhere to put
      // it, because the action means one thing to the person pressing it and
      // there is one sentence to show either way.
      if (lifts.length === 0) return 'unavailable';

      const exercises: readonly HandoffExercise[] = lifts.map((lift) => ({
        exerciseId: lift.liftId,
        bar: lift.bar,
        workingWeight: lift.weight,
        workingSets: lift.sets,
        workingReps: lift.reps,
        adjustments: lift.adjustments,
      }));

      return offerHandoff(
        options.storage,
        { equipment: snapshotFrom(equipment), exercises },
        new Date(clock.now()).toISOString(),
      );
    },
  };
}

/**
 * The same thing over this device's own storage.
 *
 * `view.ts` says it is the only module in the tool that knows the browser has
 * storage, and this is the one exception, made for the reason that file now
 * records: it is on both routes, so building the handoff there would put the
 * logbook's package into the embed bundle -- the page that deliberately offers
 * no handoff. Keeping the browser call here means the coupling and its cost stay
 * in the same module, which is what the header above claims.
 *
 * `browserPreferenceStorage()` is handed straight in with no adapter, because
 * `HandoffStorage` is the three methods `PreferenceStorage` already has. Its
 * `null` for an origin that refuses access travels through unchanged, which is
 * what turns a blocked storage into a sentence rather than a thrown error.
 */
export function browserLogbookHandoff(href: string): LogbookHandoff {
  return createLogbookHandoff({ href, storage: browserPreferenceStorage() });
}
