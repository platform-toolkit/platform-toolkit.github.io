// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §20: the warm-up calculator, pointed at a platform instead of a training day.
 *
 * IT IS A PRESET, NOT A SECOND CALCULATOR
 *
 * §20 says to reuse the existing warm-up calculator with a meet-day preset, and
 * §5.8 says the same thing about every number this tool shows. So the ramp here is
 * `planWarmup`'s ramp, the customisations are `warmup-adjust.ts`'s, and the plates
 * are `plates.ts`'s. What is genuinely new is small and is all of it about time:
 * a meet-day warm-up is the same ramp with a deadline attached, and the deadline
 * is an estimate about a room the application cannot see.
 *
 * THE OPENER IS A SINGLE, AND THAT IS THE WHOLE PRESET
 *
 * A training ramp ends in three sets of five; a meet ramp ends in one attempt, and
 * the lifter takes exactly one. Passing the opener as one set of one rep is what
 * makes the ramp come out as a meet ramp rather than a training ramp with a heavy
 * top set, and it is why nothing here reimplements the spacing.
 *
 * THE SCHEDULE IS BUILT BACKWARD FROM THE PLATFORM, AND IT IS A RANGE
 *
 * Everything is seconds from now, never a time of day -- the same property
 * `platform-timing.ts` and `live-choices.ts` have, and for the same reason: a pure
 * function of the meet's state survives an undo and a refresh, and a function that
 * reads a clock does not. The two ends of the schedule come from the two ends of
 * the platform estimate combined with the two ends of the lead window, so an
 * uncertain pace widens the warm-up plan exactly as much as it widens the estimate
 * behind it, rather than being flattened into a single confident minute.
 *
 * A START TIME IN THE PAST IS REPORTED AS ONE
 *
 * `startsInSeconds.earliest` goes negative and is not clamped. A ramp the lifter
 * should already have begun and a ramp starting right now are different situations
 * wanting different things from a handler, and §21 sorts the coach board by exactly
 * this figure. Zero for both would be the tool losing the distinction on the one
 * screen that exists to keep it.
 *
 * A DELAY MOVES THE TIMELINE AND ADDS NOTHING TO IT
 *
 * §20.1 says a delay must not silently produce extra warm-up sets. That is
 * structural here rather than defended by a rule: the item list is a function of
 * the ramp, and the delay only ever enters through {@link PlatformEstimate}, which
 * carries it as an offset. There is no branch that could add a set, because the
 * delay is never in scope where the sets are built.
 *
 * WHAT IT DOES NOT KNOW
 *
 * How long a set takes, how long the bar is tied up when a rack is shared, and when
 * a bench shirt goes on are facts about a warm-up room. The first two have round
 * defaults that are stated as round defaults; the third is supplied per item,
 * because "knee wraps go on last" and "the shirt goes on before the last single"
 * are both true, of different lifters, and inventing an order would be this tool
 * telling an equipped lifter how to get ready.
 */
import type { PlatformLift } from '@platform-toolkit/data-contracts';

import type { BarbellSetup } from './plates.js';
import { MEET_STAFF_ARE_AUTHORITATIVE, type PlatformEstimate } from './platform-timing.js';
import { weightIn, type Weight } from './weight.js';
import {
  adjustWarmups,
  setWarmupReps,
  trimWarmups,
  type WarmupAdjustment,
  type WarmupReps,
} from './warmup-adjust.js';
import { planWarmup, type WarmupFamily, type WarmupPlan, type WarmupProblem } from './warmup.js';

/**
 * How long one warm-up set takes, including the plate change before it.
 *
 * A round figure a handler adjusts, not a measurement -- the same standing as
 * `ASSUMED_SECONDS_PER_ATTEMPT`. It is deliberately generous: a warm-up that
 * finishes early costs a lifter a few minutes standing about, and one that
 * finishes late costs the attempt.
 */
export const DEFAULT_SET_SECONDS = 45;

/** How long between warm-up sets when nobody has said. Adjustable, per §20. */
export const DEFAULT_REST_SECONDS = 120;

/**
 * The gap §20 asks for between the final warm-up and the platform attempt.
 *
 * "Approximately 10-12 minutes", and a window rather than a figure because that is
 * how the requirement is written and because the estimate it is measured against is
 * itself a range. Fully adjustable, which §20 also asks for by name.
 */
export const DEFAULT_FINAL_WARMUP_LEAD: FinalWarmupLead = {
  minimumSeconds: 10 * 60,
  maximumSeconds: 12 * 60,
};

/** A span of seconds from now. Either end may be negative: see the module header. */
export interface TimeRange {
  readonly earliestSeconds: number;
  readonly latestSeconds: number;
}

export interface FinalWarmupLead {
  readonly minimumSeconds: number;
  readonly maximumSeconds: number;
}

/**
 * Something that has to happen around the ramp and is not lifting.
 *
 * `when` is supplied rather than derived. Knee wraps go on at the last possible
 * moment; a squat suit is on well before the first warm-up. Both are "preparation
 * time" to §20 and they sit on opposite sides of the ramp.
 */
export interface EquipmentPrep {
  /** A stable identifier the caller chose, echoed back on the scheduled item. */
  readonly id: string;
  readonly seconds: number;
  readonly when: 'before-the-ramp' | 'after-the-final-warm-up';
}

/**
 * A rack the lifter does not have to themselves.
 *
 * The arithmetic is the honest minimum: with `lifters` on one bar, a lifter waits
 * for the others to take a set before each of their own. It is an assumption about
 * a room and it is announced as one -- {@link MeetWarmupAdvisoryCode} carries it --
 * rather than being folded silently into the rest interval.
 */
export interface SharedRack {
  /** Lifters on the bar, including this one. */
  readonly lifters: number;
}

/** What §20 lets a lifter change about a ramp the calculator produced. */
export interface MeetWarmupCustomisation {
  /** Weights, resolved to what the rack can build. See `warmup-adjust.ts`. */
  readonly weights?: readonly WarmupAdjustment[] | undefined;
  readonly reps?: readonly WarmupReps[] | undefined;
  /** A cap on the weighted sets, trimmed from the lightest up. */
  readonly maximumSets?: number | undefined;
}

/**
 * What to do with the time a delay just handed the lifter.
 *
 * §20.1 says to tell the user which of these applies "based on their saved
 * preference", so the preference decides and this module reports. It is not a
 * recommendation the tool computes, and a delay long enough to make one choice look
 * silly is still not grounds for overriding what the lifter asked for -- which is
 * why the advice carries the delay beside it and lets them change their mind.
 */
export type DelayPreference = 'wait' | 'repeat-a-light-movement' | 'continue';

export interface DelayAdvice {
  readonly action: DelayPreference;
  readonly delaySeconds: number;
  readonly message: string;
}

export type MeetWarmupAdvisoryCode =
  /** Always present. §20.1 forbids implying otherwise. */
  | 'meet-staff-are-authoritative'
  /** The first item's start has already passed. */
  | 'behind-the-warm-up-timeline'
  /** The timeline assumes the shared bar comes free in turn. */
  | 'sharing-a-rack'
  /** Preparation after the final warm-up does not fit the lead, which was widened. */
  | 'equipment-prep-does-not-fit-the-lead'
  /** The lifter asked for fewer warm-ups than the ramp had. */
  | 'the-ramp-was-shortened';

export type MeetWarmupAdvisorySeverity = 'note' | 'caution';

export interface MeetWarmupAdvisory {
  readonly code: MeetWarmupAdvisoryCode;
  readonly severity: MeetWarmupAdvisorySeverity;
  readonly message: string;
}

export type ScheduledItemKind = 'equipment' | 'warm-up-set' | 'platform';

export interface ScheduledItem {
  readonly kind: ScheduledItemKind;
  /** Which set of `schedule.plan.warmups`, for a warm-up set. `null` otherwise. */
  readonly warmupIndex: number | null;
  /** The {@link EquipmentPrep.id} this item is, for preparation. `null` otherwise. */
  readonly equipmentId: string | null;
  /** How long it takes. Zero for the platform attempt, which is the meet's business. */
  readonly seconds: number;
  readonly startsInSeconds: TimeRange;
}

export interface MeetWarmupSchedule {
  /** The ramp, customisations applied. Every weight and plate change comes from here. */
  readonly plan: WarmupPlan;
  /** Earliest first, ending with the platform attempt. */
  readonly items: readonly ScheduledItem[];
  /** When the whole thing starts, which is the figure a coach board sorts on. */
  readonly startsInSeconds: TimeRange;
  /** The estimate this was built backward from, carried so a screen can cite it. */
  readonly platform: TimeRange;
  readonly delay: DelayAdvice | null;
  readonly advisories: readonly MeetWarmupAdvisory[];
}

export interface MeetWarmupRequest {
  readonly lift: PlatformLift;
  /** The selected opener, in whatever unit it was declared in. */
  readonly opener: Weight;
  /** The warm-up room's bar and plates, which are not the lifter's gym. */
  readonly setup: BarbellSetup;
  readonly estimate: PlatformEstimate;
  readonly lead?: FinalWarmupLead | undefined;
  readonly restSeconds?: number | undefined;
  readonly setSeconds?: number | undefined;
  readonly equipment?: readonly EquipmentPrep[] | undefined;
  readonly sharedRack?: SharedRack | null | undefined;
  readonly customisation?: MeetWarmupCustomisation | undefined;
  readonly delayPreference?: DelayPreference | undefined;
}

export type MeetWarmupResult =
  | { readonly ok: true; readonly schedule: MeetWarmupSchedule }
  | { readonly ok: false; readonly problems: readonly WarmupProblem[] };

/**
 * Which ramp each platform lift uses.
 *
 * A map rather than a lookup in `warmup.ts`, because the three competition lifts
 * are a closed set and the exhaustiveness is worth having at the type level: a
 * fourth lift added to `PlatformLift` should fail to compile here rather than fall
 * through to a default family nobody chose.
 */
const FAMILY_BY_LIFT: Readonly<Record<PlatformLift, WarmupFamily>> = {
  squat: 'squat-press',
  bench: 'squat-press',
  deadlift: 'deadlift',
};

const DELAY_MESSAGE: Readonly<Record<DelayPreference, string>> = {
  wait: 'The meet is behind. Your saved preference is to wait rather than add work.',
  'repeat-a-light-movement':
    'The meet is behind. Your saved preference is to repeat a light movement, not to add a warm-up set.',
  continue: 'The meet is behind. Your saved preference is to carry on as planned.',
};

function sumSeconds(items: readonly EquipmentPrep[]): number {
  return items.reduce((total, item) => total + Math.max(0, item.seconds), 0);
}

/**
 * How long the ramp is tied up for one set, including waiting for a shared bar.
 *
 * The rest interval is what the lifter asked for; the waiting is what the room
 * costs them. Kept as one figure because the schedule only ever needs the gap
 * between two of this lifter's sets, and kept separate from the set's own duration
 * because a set the lifter is performing and a set they are standing through are
 * the same minutes to a clock and not to a warm-up.
 */
function gapBetweenSets(restSeconds: number, setSeconds: number, rack: SharedRack | null): number {
  const others = rack === null ? 0 : Math.max(0, Math.floor(rack.lifters) - 1);
  return restSeconds + others * setSeconds;
}

interface Piece {
  readonly kind: ScheduledItemKind;
  readonly warmupIndex: number | null;
  readonly equipmentId: string | null;
  readonly seconds: number;
  /** Whether this piece sits above the final warm-up, so the lead shifts it. */
  readonly aboveTheLead: boolean;
}

/**
 * The ramp and its bookends as a list of durations, latest first.
 *
 * Built once and offset twice, which is what keeps the two ends of the schedule
 * describing the same plan. Two independent walks would be free to disagree about
 * how many sets there are.
 */
function piecesFor(
  plan: WarmupPlan,
  equipment: readonly EquipmentPrep[],
  setSeconds: number,
): readonly Piece[] {
  const after = equipment.filter((item) => item.when === 'after-the-final-warm-up');
  const before = equipment.filter((item) => item.when === 'before-the-ramp');

  const pieces: Piece[] = [
    { kind: 'platform', warmupIndex: null, equipmentId: null, seconds: 0, aboveTheLead: false },
  ];
  // Reversed, because the list runs backward from the platform and the last thing
  // a lifter does before walking out is the last one the caller listed.
  for (const item of [...after].reverse()) {
    pieces.push({
      kind: 'equipment',
      warmupIndex: null,
      equipmentId: item.id,
      seconds: Math.max(0, item.seconds),
      aboveTheLead: false,
    });
  }
  for (const [index, set] of [...plan.warmups.entries()].reverse()) {
    pieces.push({
      kind: 'warm-up-set',
      warmupIndex: index,
      equipmentId: null,
      seconds: setSeconds * Math.max(1, set.count),
      aboveTheLead: true,
    });
  }
  for (const item of [...before].reverse()) {
    pieces.push({
      kind: 'equipment',
      warmupIndex: null,
      equipmentId: item.id,
      seconds: Math.max(0, item.seconds),
      aboveTheLead: true,
    });
  }
  return pieces;
}

/**
 * Seconds before the platform attempt that each piece starts, for one lead.
 *
 * Called twice, with the two ends of the lead window. The pieces below the final
 * warm-up are anchored to the platform and come out identical both times, which is
 * correct: the lead is uncertainty about when the ramp may begin, not about how
 * long it takes to put knee wraps on.
 *
 * `leadResidualSeconds` is the lead less whatever preparation already sits inside
 * it -- see {@link meetWarmup}. Passing the whole lead here would push the ramp
 * back by the preparation twice over.
 */
function offsetsFor(
  pieces: readonly Piece[],
  leadResidualSeconds: number,
  gapSeconds: number,
): readonly number[] {
  const offsets: number[] = [];
  // The walk runs backward, so `cursor` is always "seconds before the platform
  // attempt", and a piece's own duration is spent between its start and whatever
  // was processed immediately before it here.
  let cursor = 0;
  let leadSpent = false;
  for (const piece of pieces) {
    if (piece.aboveTheLead && !leadSpent) {
      // The gap between the top of the ramp and the platform is §20's window, not
      // the rest interval, and it is charged exactly once.
      cursor += leadResidualSeconds;
      leadSpent = true;
    } else if (piece.kind === 'warm-up-set') {
      // Preparation before the ramp runs straight into the first set, so only a
      // set is separated from the thing above it by a rest.
      cursor += gapSeconds;
    }
    cursor += piece.seconds;
    offsets.push(cursor);
  }
  return offsets;
}

function advisoriesFor(input: {
  readonly startsInSeconds: TimeRange;
  readonly rack: SharedRack | null;
  readonly leadWasWidened: boolean;
  readonly rampWasShortened: boolean;
}): readonly MeetWarmupAdvisory[] {
  const advisories: MeetWarmupAdvisory[] = [
    {
      code: 'meet-staff-are-authoritative',
      severity: 'note',
      message: MEET_STAFF_ARE_AUTHORITATIVE,
    },
  ];

  if (input.startsInSeconds.earliestSeconds < 0) {
    advisories.push({
      code: 'behind-the-warm-up-timeline',
      severity: 'caution',
      message: 'This warm-up should already have started. Sets will have to come off it.',
    });
  }

  if (input.rack !== null && input.rack.lifters > 1) {
    advisories.push({
      code: 'sharing-a-rack',
      severity: 'note',
      message: 'The timeline assumes the shared bar comes free in turn.',
    });
  }

  if (input.leadWasWidened) {
    advisories.push({
      code: 'equipment-prep-does-not-fit-the-lead',
      severity: 'caution',
      message:
        'Preparation after the final warm-up takes longer than the gap asked for, so the gap was widened to hold it.',
    });
  }

  if (input.rampWasShortened) {
    advisories.push({
      code: 'the-ramp-was-shortened',
      severity: 'note',
      message: 'Fewer warm-ups than the ramp offered, trimmed from the lightest up.',
    });
  }

  return advisories;
}

function customise(
  plan: WarmupPlan,
  customisation: MeetWarmupCustomisation | undefined,
): WarmupPlan {
  if (customisation === undefined) return plan;
  // Trim first: an index the lifter gave for a weight is an index into the ramp
  // they are looking at, and that is the trimmed one.
  const trimmed =
    customisation.maximumSets === undefined ? plan : trimWarmups(plan, customisation.maximumSets);
  const weighted = adjustWarmups(trimmed, customisation.weights ?? []);
  return setWarmupReps(weighted, customisation.reps ?? []);
}

/**
 * The meet-day warm-up: the calculator's ramp, on the platform's clock.
 *
 * Refuses only where `planWarmup` refuses, and for its reasons. Everything this
 * module adds is a duration, and a duration that makes no sense produces an
 * advisory or a negative start rather than a missing plan -- a handler at a warm-up
 * rack has nothing to do with a refusal.
 */
export function meetWarmup(request: MeetWarmupRequest): MeetWarmupResult {
  const built = planWarmup({
    setup: request.setup,
    family: FAMILY_BY_LIFT[request.lift],
    workingWeight: weightIn(request.opener, request.setup.plateUnit),
    // The opener is one attempt, not a training prescription.
    workingSets: 1,
    workingReps: 1,
  });
  if (!built.ok) return built;

  const plan = customise(built.plan, request.customisation);

  const equipment = request.equipment ?? [];
  const rack = request.sharedRack ?? null;
  const setSeconds = Math.max(0, request.setSeconds ?? DEFAULT_SET_SECONDS);
  const restSeconds = Math.max(0, request.restSeconds ?? DEFAULT_REST_SECONDS);
  const gapSeconds = gapBetweenSets(restSeconds, setSeconds, rack);

  const lead = request.lead ?? DEFAULT_FINAL_WARMUP_LEAD;
  const afterFinalSeconds = sumSeconds(
    equipment.filter((item) => item.when === 'after-the-final-warm-up'),
  );
  // Preparation after the final warm-up happens inside the lead. Where it does not
  // fit, the lead gives way: the alternative is a schedule that has the lifter
  // putting knee wraps on while they are being called to the bar.
  const minimumLead = Math.max(lead.minimumSeconds, afterFinalSeconds);
  const maximumLead = Math.max(lead.maximumSeconds, minimumLead);

  const pieces = piecesFor(plan, equipment, setSeconds);
  // The preparation inside the lead is already in the piece list, so what separates
  // the top of the ramp from it is the rest of the lead.
  const earlyOffsets = offsetsFor(pieces, maximumLead - afterFinalSeconds, gapSeconds);
  const lateOffsets = offsetsFor(pieces, minimumLead - afterFinalSeconds, gapSeconds);

  const items: ScheduledItem[] = [];
  for (const [index, piece] of pieces.entries()) {
    items.push({
      kind: piece.kind,
      warmupIndex: piece.warmupIndex,
      equipmentId: piece.equipmentId,
      seconds: piece.seconds,
      startsInSeconds: {
        earliestSeconds: request.estimate.earliestSeconds - (earlyOffsets[index] ?? 0),
        latestSeconds: request.estimate.latestSeconds - (lateOffsets[index] ?? 0),
      },
    });
  }
  // Built backward, read forward.
  items.reverse();

  const startsInSeconds = items[0]?.startsInSeconds ?? {
    earliestSeconds: request.estimate.earliestSeconds,
    latestSeconds: request.estimate.latestSeconds,
  };

  const delaySeconds = request.estimate.delaySeconds;
  const preference = request.delayPreference ?? 'wait';

  return {
    ok: true,
    schedule: {
      plan,
      items,
      startsInSeconds,
      platform: {
        earliestSeconds: request.estimate.earliestSeconds,
        latestSeconds: request.estimate.latestSeconds,
      },
      delay:
        delaySeconds > 0
          ? { action: preference, delaySeconds, message: DELAY_MESSAGE[preference] }
          : null,
      advisories: advisoriesFor({
        startsInSeconds,
        rack,
        leadWasWidened: minimumLead > lead.minimumSeconds,
        rampWasShortened: plan.warmups.length < built.plan.warmups.length,
      }),
    },
  };
}

/**
 * How long before the bar the ramp begins.
 *
 * Two durations rather than one, and that is the part worth reading twice.
 * `meetWarmup` builds the early end of {@link MeetWarmupSchedule.startsInSeconds}
 * with the *maximum* lead and the late end with the *minimum* one, so the two ends
 * are not a single lead read against two platform times -- subtract each of them
 * from its own end of the estimate and two different figures come back. Reporting
 * either one alone claims a precision the lead window does not have, in the
 * direction that has a lifter still under the bar when they are called.
 */
export interface WarmupLeadRange {
  /** The shorter lead, behind the late end of the platform estimate. */
  readonly minimumSeconds: number;
  /** The longer lead, behind the early end. */
  readonly maximumSeconds: number;
}

/**
 * The one figure on a schedule that survives being printed.
 *
 * Everything else here is seconds from the instant the schedule was built, which
 * is right on a screen that rebuilds four times a second and worthless on paper:
 * §23.2's sheet is read hours after it leaves the printer, and it is read on
 * exactly the day the meet is running late, so a minutes-from-now figure would
 * send a handler to the rack an hour early and cold. Subtracting the start from
 * the platform cancels the estimate out of both ends and leaves the ramp, which
 * is the part of the schedule that does not move when the flight does.
 *
 * Never negative and never inverted, and nothing clamps it: both figures are sums
 * over the same pieces and the longer one carries the wider lead, so a change that
 * broke the ordering should be visible rather than absorbed into a `Math.max`.
 */
export function warmupLeadRange(schedule: MeetWarmupSchedule): WarmupLeadRange {
  return {
    minimumSeconds: schedule.platform.latestSeconds - schedule.startsInSeconds.latestSeconds,
    maximumSeconds: schedule.platform.earliestSeconds - schedule.startsInSeconds.earliestSeconds,
  };
}
