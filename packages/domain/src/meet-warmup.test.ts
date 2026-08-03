// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FINAL_WARMUP_LEAD,
  DEFAULT_REST_SECONDS,
  DEFAULT_SET_SECONDS,
  meetWarmup,
  type EquipmentPrep,
  type MeetWarmupRequest,
  type MeetWarmupSchedule,
  type ScheduledItem,
} from './meet-warmup.js';
import { MEET_STAFF_ARE_AUTHORITATIVE, type PlatformEstimate } from './platform-timing.js';
import type { BarbellSetup, PlateDenomination } from './plates.js';

/**
 * A competition warm-up room: kilogram plates, a 20 kg bar, competition collars.
 *
 * Collars that weigh something are the meet-day case and the training-day
 * exception, and they change every reachable weight -- which is exactly the reason
 * §20 asks for a meet-specific plate inventory rather than reusing the lifter's
 * gym. Nothing in this suite writes out a warm-up weight: the ramp is `warmup.ts`'s
 * answer and this module's job is when to take it, not what to put on the bar.
 */
const KILOGRAM_PLATES: readonly PlateDenomination[] = [
  { weight: 25, pairs: null, fullDiameter: true },
  { weight: 20, pairs: null, fullDiameter: true },
  { weight: 15, pairs: null, fullDiameter: false },
  { weight: 10, pairs: null, fullDiameter: true },
  { weight: 5, pairs: null, fullDiameter: false },
  { weight: 2.5, pairs: null, fullDiameter: false },
  { weight: 1.25, pairs: null, fullDiameter: false },
];

const WARM_UP_ROOM: BarbellSetup = {
  plateUnit: 'kg',
  bar: { amount: 20, unit: 'kg' },
  collars: { amount: 5, unit: 'kg' },
  plates: KILOGRAM_PLATES,
};

/**
 * Fifty attempts out on a measured minute apiece, which is where a warm-up begins.
 *
 * Written out rather than computed by `platformEstimate`, so a change to the pace
 * spread cannot silently move every figure in this suite: 50 attempts at 60 s is
 * 3000 s, 15% either side is 2550 and 3450, and those round outward to 42 and 58
 * minutes. A ramp to a 160 kg opener plus §20's twelve-minute lead runs to about
 * half an hour, so anything much tighter than this is a lifter who is already late
 * -- which is a case below, not the default one.
 */
const ESTIMATE: PlatformEstimate = {
  attemptsBefore: 50,
  pace: { secondsPerAttempt: 60, source: 'observed' },
  earliestSeconds: 2520,
  latestSeconds: 3480,
  delaySeconds: 0,
  advisories: [],
};

function request(patch: Partial<MeetWarmupRequest> = {}): MeetWarmupRequest {
  return {
    lift: 'squat',
    opener: { amount: 160, unit: 'kg' },
    setup: WARM_UP_ROOM,
    estimate: ESTIMATE,
    ...patch,
  };
}

function scheduled(patch: Partial<MeetWarmupRequest> = {}): MeetWarmupSchedule {
  const result = meetWarmup(request(patch));
  if (!result.ok) {
    throw new Error(`expected a schedule, got problems: ${JSON.stringify(result.problems)}`);
  }
  return result.schedule;
}

function codes(schedule: MeetWarmupSchedule): readonly string[] {
  return schedule.advisories.map((advisory) => advisory.code);
}

function warmupItems(schedule: MeetWarmupSchedule): readonly ScheduledItem[] {
  return schedule.items.filter((item) => item.kind === 'warm-up-set');
}

function finalWarmup(schedule: MeetWarmupSchedule): ScheduledItem {
  const sets = warmupItems(schedule);
  const last = sets[sets.length - 1];
  if (last === undefined) throw new Error('the ramp has no warm-up sets');
  return last;
}

function platformItem(schedule: MeetWarmupSchedule): ScheduledItem {
  const item = schedule.items[schedule.items.length - 1];
  if (item === undefined) throw new Error('the schedule is empty');
  return item;
}

describe('meetWarmup', () => {
  it('ramps to the opener as a single, not as a training top set', () => {
    const schedule = scheduled();
    expect(schedule.plan.working.total).toBe(160);
    expect(schedule.plan.working.sets).toBe(1);
    expect(schedule.plan.working.reps).toBe(1);
    // And it is the meet's ramp, so the meet's collars are under every weight.
    expect(schedule.plan.emptyImplement.total).toBe(25);
  });

  it('takes the opener in whatever unit it was declared in', () => {
    // A pound gym warming a lifter up for a kilogram platform is the case §20's
    // "meet-specific plate inventory" is about, read the other way round.
    const inKilograms = scheduled();
    const inPounds = scheduled({ opener: { amount: 160 / 0.453_592_37, unit: 'lb' } });
    expect(inPounds.plan.working.total).toBeCloseTo(inKilograms.plan.working.total, 6);
    // The control: a figure taken as a bare number would come out wildly heavier.
    expect(160 / 0.453_592_37).toBeGreaterThan(300);
  });

  it('sends each lift to its own ramp', () => {
    expect(scheduled({ lift: 'squat' }).plan.family).toBe('squat-press');
    expect(scheduled({ lift: 'bench' }).plan.family).toBe('squat-press');
    expect(scheduled({ lift: 'deadlift' }).plan.family).toBe('deadlift');
  });

  it('refuses only where the calculator refuses, and passes its reasons through', () => {
    const result = meetWarmup(request({ opener: { amount: -5, unit: 'kg' } }));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toContain(
      'working-weight-not-positive',
    );
  });

  it('never implies it outranks the meet staff', () => {
    for (const schedule of [
      scheduled(),
      scheduled({ estimate: { ...ESTIMATE, delaySeconds: 600 } }),
      scheduled({ estimate: { ...ESTIMATE, earliestSeconds: 0, latestSeconds: 60 } }),
    ]) {
      expect(codes(schedule)).toContain('meet-staff-are-authoritative');
      expect(schedule.advisories[0]?.message).toBe(MEET_STAFF_ARE_AUTHORITATIVE);
    }
  });

  describe('the schedule runs backward from the platform', () => {
    it('ends with the attempt and starts with the first thing to do', () => {
      const schedule = scheduled();
      expect(platformItem(schedule).kind).toBe('platform');
      expect(platformItem(schedule).startsInSeconds).toEqual(schedule.platform);
      expect(schedule.startsInSeconds).toEqual(schedule.items[0]?.startsInSeconds);

      // Earliest first, and strictly so: two items starting at the same second
      // would mean something in the walk is not taking any time.
      const starts = schedule.items.map((item) => item.startsInSeconds.earliestSeconds);
      for (const [index, start] of starts.entries()) {
        if (index === 0) continue;
        expect(start).toBeGreaterThan(starts[index - 1] ?? Number.NEGATIVE_INFINITY);
      }
    });

    it('puts the final warm-up inside the window §20 asks for', () => {
      const schedule = scheduled();
      const final = finalWarmup(schedule);
      const endsAt = final.startsInSeconds.earliestSeconds + final.seconds;
      expect(schedule.platform.earliestSeconds - endsAt).toBe(
        DEFAULT_FINAL_WARMUP_LEAD.maximumSeconds,
      );

      const endsAtLatest = final.startsInSeconds.latestSeconds + final.seconds;
      expect(schedule.platform.latestSeconds - endsAtLatest).toBe(
        DEFAULT_FINAL_WARMUP_LEAD.minimumSeconds,
      );
      // The two figures are the requirement, and they are ten and twelve minutes.
      expect(DEFAULT_FINAL_WARMUP_LEAD.minimumSeconds).toBe(10 * 60);
      expect(DEFAULT_FINAL_WARMUP_LEAD.maximumSeconds).toBe(12 * 60);
    });

    it('rests between sets by the amount asked for, and only between sets', () => {
      const schedule = scheduled({ restSeconds: 90 });
      const sets = warmupItems(schedule);
      expect(sets.length).toBeGreaterThan(2);
      for (const [index, item] of sets.entries()) {
        if (index === 0) continue;
        const previous = sets[index - 1];
        if (previous === undefined) continue;
        const gap =
          item.startsInSeconds.earliestSeconds -
          (previous.startsInSeconds.earliestSeconds + previous.seconds);
        expect(gap).toBe(90);
      }
      // The control: the rest is read rather than fixed.
      const slower = scheduled({ restSeconds: 180 });
      expect(slower.startsInSeconds.earliestSeconds).toBeLessThan(
        schedule.startsInSeconds.earliestSeconds,
      );
    });

    it('takes both its ends from both uncertainties and never inverts them', () => {
      for (const item of scheduled().items) {
        expect(item.startsInSeconds.latestSeconds).toBeGreaterThanOrEqual(
          item.startsInSeconds.earliestSeconds,
        );
      }
      // A wider platform estimate widens every start with it, rather than the
      // schedule quietly picking one end of it.
      const vague = scheduled({
        estimate: { ...ESTIMATE, latestSeconds: ESTIMATE.latestSeconds + 600 },
      });
      const tight = scheduled();
      const spread = (item: ScheduledItem): number =>
        item.startsInSeconds.latestSeconds - item.startsInSeconds.earliestSeconds;
      expect(spread(finalWarmup(vague))).toBe(spread(finalWarmup(tight)) + 600);
    });

    it('says a start already in the past is in the past rather than calling it now', () => {
      // A lifter who has just been told they are two attempts away.
      const late = scheduled({
        estimate: { ...ESTIMATE, attemptsBefore: 2, earliestSeconds: 60, latestSeconds: 180 },
      });
      expect(late.startsInSeconds.earliestSeconds).toBeLessThan(0);
      expect(codes(late)).toContain('behind-the-warm-up-timeline');
      // The control: with time in hand, the same ramp starts in the future and
      // says nothing.
      expect(scheduled().startsInSeconds.earliestSeconds).toBeGreaterThan(0);
      expect(codes(scheduled())).not.toContain('behind-the-warm-up-timeline');
    });
  });

  describe('the room the tool cannot see', () => {
    it('places preparation on the side of the ramp it was given', () => {
      const wraps: EquipmentPrep = {
        id: 'knee-wraps',
        seconds: 240,
        when: 'after-the-final-warm-up',
      };
      const suit: EquipmentPrep = { id: 'squat-suit', seconds: 300, when: 'before-the-ramp' };
      const schedule = scheduled({ equipment: [suit, wraps] });

      const items = schedule.items;
      const suitAt = items.findIndex((item) => item.equipmentId === 'squat-suit');
      const wrapsAt = items.findIndex((item) => item.equipmentId === 'knee-wraps');
      const firstSetAt = items.findIndex((item) => item.kind === 'warm-up-set');
      expect(suitAt).toBeLessThan(firstSetAt);
      expect(wrapsAt).toBeGreaterThan(items.findIndex((item) => item === finalWarmup(schedule)));
      expect(wrapsAt).toBeLessThan(items.length - 1);

      // The wraps end as the lifter is called, and the suit ends as the ramp begins.
      const wrapsItem = items[wrapsAt];
      expect((wrapsItem?.startsInSeconds.earliestSeconds ?? 0) + (wrapsItem?.seconds ?? 0)).toBe(
        schedule.platform.earliestSeconds,
      );
      const suitItem = items[suitAt];
      expect((suitItem?.startsInSeconds.earliestSeconds ?? 0) + (suitItem?.seconds ?? 0)).toBe(
        items[firstSetAt]?.startsInSeconds.earliestSeconds,
      );
    });

    it('does not charge the lead twice for preparation that sits inside it', () => {
      const wraps: EquipmentPrep = {
        id: 'knee-wraps',
        seconds: 240,
        when: 'after-the-final-warm-up',
      };
      const bare = scheduled();
      const wrapped = scheduled({ equipment: [wraps] });
      // The final warm-up does not move: the wraps go on during the ten to twelve
      // minutes that were already set aside, which is where they happen.
      expect(finalWarmup(wrapped).startsInSeconds).toEqual(finalWarmup(bare).startsInSeconds);
    });

    it('widens the lead rather than scheduling wraps over the call to the bar', () => {
      const long: EquipmentPrep = {
        id: 'suit-and-wraps',
        seconds: DEFAULT_FINAL_WARMUP_LEAD.minimumSeconds + 120,
        when: 'after-the-final-warm-up',
      };
      const schedule = scheduled({ equipment: [long] });
      expect(codes(schedule)).toContain('equipment-prep-does-not-fit-the-lead');
      const final = finalWarmup(schedule);
      const endsAt = final.startsInSeconds.latestSeconds + final.seconds;
      expect(schedule.platform.latestSeconds - endsAt).toBe(long.seconds);

      // The control: preparation that fits leaves the lead alone.
      expect(codes(scheduled({ equipment: [{ ...long, seconds: 120 }] }))).not.toContain(
        'equipment-prep-does-not-fit-the-lead',
      );
    });

    it('allows for a bar the lifter does not have to themselves, and says that it did', () => {
      const alone = scheduled();
      const shared = scheduled({ sharedRack: { lifters: 3 } });
      const sets = warmupItems(alone).length;
      expect(sets).toBeGreaterThan(1);

      // Two other lifters take a set each between this lifter's, in every gap.
      const extra = (sets - 1) * 2 * DEFAULT_SET_SECONDS;
      expect(alone.startsInSeconds.earliestSeconds - shared.startsInSeconds.earliestSeconds).toBe(
        extra,
      );
      expect(codes(shared)).toContain('sharing-a-rack');
      // The controls: a rack of one is a rack to yourself, and so is no rack.
      expect(codes(scheduled({ sharedRack: { lifters: 1 } }))).not.toContain('sharing-a-rack');
      expect(codes(alone)).not.toContain('sharing-a-rack');
      expect(scheduled({ sharedRack: { lifters: 1 } }).startsInSeconds).toEqual(
        alone.startsInSeconds,
      );
    });
  });

  describe('what the lifter is allowed to change', () => {
    it('takes their weights through the adjuster, plate changes and all', () => {
      const bare = scheduled();
      const index = warmupItems(bare).length - 2;
      const original = bare.plan.warmups[index]?.loading.total ?? 0;
      const wanted = original - 10;
      const schedule = scheduled({ customisation: { weights: [{ index, total: wanted }] } });

      expect(schedule.plan.warmups[index]?.loading.total).toBe(wanted);
      // The set after it now describes different plates, which is the thing a
      // substitution in a template would get wrong.
      expect(schedule.plan.warmups[index + 1]?.change).not.toEqual(
        bare.plan.warmups[index + 1]?.change,
      );
    });

    it('takes their rep counts without touching the plates', () => {
      const bare = scheduled();
      const schedule = scheduled({ customisation: { reps: [{ index: 0, reps: 8 }] } });
      expect(schedule.plan.warmups[0]?.reps).toBe(8);
      expect(schedule.plan.warmups.map((set) => set.loading.total)).toEqual(
        bare.plan.warmups.map((set) => set.loading.total),
      );
    });

    it('shortens the ramp from the lightest up, keeping the top of it', () => {
      const bare = scheduled();
      const weighted = bare.plan.warmups.filter((set) => set.stage !== 'empty-implement');
      expect(weighted.length).toBeGreaterThan(2);

      const schedule = scheduled({ customisation: { maximumSets: 2 } });
      const kept = schedule.plan.warmups.filter((set) => set.stage !== 'empty-implement');
      expect(kept).toHaveLength(2);
      expect(kept.map((set) => set.loading.total)).toEqual(
        weighted.slice(weighted.length - 2).map((set) => set.loading.total),
      );
      expect(codes(schedule)).toContain('the-ramp-was-shortened');
      // A shorter ramp starts later, which is the reason to ask for one.
      expect(schedule.startsInSeconds.earliestSeconds).toBeGreaterThan(
        bare.startsInSeconds.earliestSeconds,
      );
      // The control: a cap above the ramp changes nothing and claims nothing.
      const uncut = scheduled({ customisation: { maximumSets: weighted.length + 5 } });
      expect(codes(uncut)).not.toContain('the-ramp-was-shortened');
      expect(uncut.startsInSeconds).toEqual(bare.startsInSeconds);
    });
  });

  describe('when the meet is delayed', () => {
    const delayed: PlatformEstimate = {
      ...ESTIMATE,
      earliestSeconds: ESTIMATE.earliestSeconds + 900,
      latestSeconds: ESTIMATE.latestSeconds + 900,
      delaySeconds: 900,
    };

    it('moves the timeline and adds nothing to it', () => {
      const onTime = scheduled();
      const late = scheduled({ estimate: delayed });

      // §20.1's requirement, asserted on the thing it is about: the same sets.
      expect(late.items).toHaveLength(onTime.items.length);
      expect(late.plan.warmups.map((set) => set.loading.total)).toEqual(
        onTime.plan.warmups.map((set) => set.loading.total),
      );
      for (const [index, item] of late.items.entries()) {
        const before = onTime.items[index];
        expect(item.startsInSeconds.earliestSeconds).toBe(
          (before?.startsInSeconds.earliestSeconds ?? 0) + 900,
        );
        expect(item.seconds).toBe(before?.seconds);
      }
    });

    it('tells the lifter what they already said they wanted', () => {
      for (const action of ['wait', 'repeat-a-light-movement', 'continue'] as const) {
        const schedule = scheduled({ estimate: delayed, delayPreference: action });
        expect(schedule.delay?.action).toBe(action);
        expect(schedule.delay?.delaySeconds).toBe(900);
        expect(schedule.delay?.message).toBeTruthy();
      }
      // A saved preference that says to repeat a light movement is not a licence
      // to add a warm-up set, and the two read alike on a phone.
      const repeating = scheduled({
        estimate: delayed,
        delayPreference: 'repeat-a-light-movement',
      });
      expect(warmupItems(repeating)).toHaveLength(warmupItems(scheduled()).length);
    });

    it('says nothing about a delay there has not been one of', () => {
      expect(scheduled().delay).toBeNull();
      expect(scheduled({ delayPreference: 'continue' }).delay).toBeNull();
    });
  });

  it('reads no clock, so the same question twice is the same answer', () => {
    const shape = request({
      sharedRack: { lifters: 2 },
      equipment: [{ id: 'wraps', seconds: 200, when: 'after-the-final-warm-up' }],
      customisation: { maximumSets: 3 },
    });
    expect(meetWarmup(shape)).toEqual(meetWarmup(shape));
  });

  it('leans on the calculator for the ramp and on itself only for the clock', () => {
    // The defaults are round figures, and this suite would rather assert that they
    // are the ones the module documents than pretend they were measured.
    expect(DEFAULT_SET_SECONDS).toBe(45);
    expect(DEFAULT_REST_SECONDS).toBe(120);
    const schedule = scheduled();
    for (const item of warmupItems(schedule)) {
      const set = schedule.plan.warmups[item.warmupIndex ?? -1];
      expect(item.seconds).toBe(DEFAULT_SET_SECONDS * (set?.count ?? 0));
    }
  });
});
