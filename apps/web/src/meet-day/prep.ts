// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * §22's meet preparation: what a lifter wrote down beforehand, and what they
 * still have to pack or do.
 *
 * Pure, like `session.ts` beside it, and a separate module from it for a reason
 * the requirement states outright -- "store information that is important at the
 * meet but keep it away from urgent live decisions until relevant". That is a
 * structural instruction as much as a layout one. Nothing here may feed `plan.ts`
 * or `live-choices.ts`, and keeping it in its own file with its own state is what
 * makes that checkable: a rack height cannot quietly become an input to an
 * attempt recommendation when there is no path from here to there.
 *
 * A RACK HEIGHT IS TEXT AND A WEIGH-IN TIME IS NOT
 *
 * Every §22.1 answer except the two times is free text, and that is a decision
 * rather than laziness. A rack height is a label on somebody else's rack: it is
 * `12` on one brand, `12.5` on another, `A4` on a third, and the monolift setting
 * is a pair of numbers on a card the crew reads. Parsing it would let the tool
 * reject the true answer -- and worse, "correct" it. The one thing a lifter must
 * never get from this screen is a rack height they cannot call out.
 *
 * The two times are the exception because they are the two fields on this screen
 * that can make somebody miss the meet. A weigh-in time typed wrong is not a
 * cosmetic error, so it is read, and `timeProblems` says which one did not parse.
 * What is deliberately *not* computed is any relationship between them: a
 * day-before weigh-in makes "the weigh-in is later in the day than lifting
 * starts" a true and legal answer, so a tool that flagged it would be wrong at
 * exactly the meets that weigh in the night before.
 *
 * THE CHECKLIST IS DERIVED; ONLY THE TICKS ARE STORED
 *
 * `checklistFor` builds the rows from the meet, and `MeetPrep` holds nothing but
 * which ids are ticked. Stored rows would go stale the moment anything they were
 * derived from moved: a lifter who sets up a bench-only meet and later corrects
 * it to full power would be packing against the list they built by mistake, with
 * no squat shoes on it and nothing on screen to say so.
 *
 * A TICK ON A ROW THAT NO LONGER APPLIES IS KEPT
 *
 * Ticks outlive their rows on purpose. Deadlift socks ticked under full power
 * disappear from the list when the format is corrected to bench-only -- and the
 * socks are still in the bag, so switching back must not present them as
 * unpacked. Custom items are the opposite case and are handled the opposite way:
 * their ids come from a counter and are never reissued, so a removed item's tick
 * can never be shown again and is dropped rather than saved forever.
 *
 * WHAT THIS FILE MUST NEVER SAY
 *
 * §22.2 ends with a prohibition, and it lands here rather than only in `copy.ts`
 * because it is about what rows exist as much as how they are worded: no
 * weight-cutting, medical, drug, supplement or nutrition instruction. "Food and
 * familiar snacks" and "Fluids" are pack-this rows and must stay pack-this rows.
 * The moment one of them grows an amount, a timing or a kind, this tool is giving
 * nutrition advice, and §31 puts that out of scope in v1.
 */
import { liftsInFormat, type MeetGoal } from '@platform-toolkit/domain';
import type { MeetFormat, PlatformLift } from '@platform-toolkit/data-contracts';

import { answerFromValue, type Answer, type EquipmentCategory } from './session.js';

/*
 * ---------------------------------------------------------------------------
 * §22.1 -- lifter and platform setup.
 * ---------------------------------------------------------------------------
 */

/**
 * How the squat comes out of the rack.
 *
 * Its own question rather than a note, because it is the one setup answer a
 * handler has to know before the bar moves and the two answers need different
 * things from the crew: a walkout needs a spotter briefed on when to let go, a
 * monolift needs the arms set and a signal.
 */
export type SquatStart = 'walkout' | 'monolift' | 'unstated';

export const SQUAT_STARTS: readonly SquatStart[] = ['walkout', 'monolift', 'unstated'];

/**
 * Who lifts the bar off for the bench press.
 *
 * `no-handoff` is a real answer and not the absence of one -- a lifter who takes
 * their own unrack has to say so, or a well-meaning spotter reaches in and the
 * lift is red-lighted for assistance.
 */
export type HandoffPreference = 'own-handler' | 'meet-spotter' | 'no-handoff' | 'unstated';

export const HANDOFF_PREFERENCES: readonly HandoffPreference[] = [
  'own-handler',
  'meet-spotter',
  'no-handoff',
  'unstated',
];

/** §22.1's answers. Every one optional; none of them reaches a recommendation. */
export interface LifterSetup {
  readonly squatRackHeight: string;
  readonly squatSafetyHeight: string;
  readonly monoliftSetting: string;
  readonly squatStart: SquatStart;
  readonly benchRackHeight: string;
  readonly benchSafetyHeight: string;
  readonly footBlocks: Answer;
  readonly handoff: HandoffPreference;
  readonly deadliftNotes: string;
  readonly commands: string;
  readonly flight: string;
  readonly lot: string;
  readonly platform: string;
  readonly session: string;
  readonly weighInTime: string;
  readonly liftingStartTime: string;
}

export const EMPTY_LIFTER_SETUP: LifterSetup = {
  squatRackHeight: '',
  squatSafetyHeight: '',
  monoliftSetting: '',
  squatStart: 'unstated',
  benchRackHeight: '',
  benchSafetyHeight: '',
  footBlocks: 'unstated',
  handoff: 'unstated',
  deadliftNotes: '',
  commands: '',
  flight: '',
  lot: '',
  platform: '',
  session: '',
  weighInTime: '',
  liftingStartTime: '',
};

/**
 * The setup answers that are read out rather than read.
 *
 * A rack height, a lot number and a flight are called across a platform, so they
 * are short by nature and a long one is a paste accident. The cap exists because
 * §23 prints these on a page a handler holds and §24 saves them, and both of
 * those discover an unbounded string at the worst moment. Generous enough for
 * "12 / safety 4" and for a session named in words.
 */
export const SETUP_LABEL_MAX = 40;

/** The two prose answers. Long enough for the commands, short of an essay. */
export const SETUP_NOTE_MAX = 400;

/** §22's reminders and user-authored notes, which are genuinely prose. */
export const PREP_NOTES_MAX = 2000;

/** A checklist row somebody wrote themselves. */
export const CUSTOM_ITEM_MAX = 80;

/*
 * ---------------------------------------------------------------------------
 * §22.2 -- the checklist.
 * ---------------------------------------------------------------------------
 */

/**
 * §22.2's rows, as codes.
 *
 * Codes and not sentences, for the reason this directory gives everywhere else:
 * the wording is the tool's and lives in `copy.ts`, and an identifier that is
 * also a sentence cannot be reworded without invalidating every tick already
 * saved against it. These ids go into the saved document (§24) and are therefore
 * never renamed.
 */
export type ChecklistItemId =
  | 'membership-and-identification'
  | 'singlet'
  | 'approved-shirt'
  | 'approved-underwear'
  | 'belt'
  | 'knee-sleeves-or-wraps'
  | 'wrist-wraps'
  | 'squat-shoes'
  | 'bench-shoes'
  | 'deadlift-shoes'
  | 'deadlift-socks'
  | 'equipped-gear'
  | 'chalk-and-powder'
  | 'food'
  | 'fluids'
  | 'attempt-plan-in-kilograms'
  | 'printed-backup'
  | 'phone-charger'
  | 'record-documentation'
  | 'rack-height-confirmation'
  | 'equipment-check'
  | 'weigh-in'
  | 'rules-and-commands-review';

/**
 * Packing, doing, and whatever the lifter added.
 *
 * The split is not decoration. The first group is done the night before with two
 * clean hands and a bag open on the floor; the second is done on the day, between
 * other things, and is the case §22 calls out -- a lifter taps it with chalk on
 * their hands. Presenting twenty-three rows as one list makes the four that are
 * urgent look like the nineteen that are not.
 *
 * `own` is a third group rather than a placement question asked per item.
 * Adding a row already costs a keyboard on a phone in a warm-up room; asking
 * "and is that a bring or a do?" afterwards is a second question for a
 * distinction the person who typed it already knows and does not need the tool
 * to file.
 */
export type ChecklistGroup = 'bring' | 'do' | 'own';

export const CHECKLIST_GROUPS: readonly ChecklistGroup[] = ['bring', 'do', 'own'];

/**
 * When a row is on the list.
 *
 * A closed vocabulary answered by one function rather than a predicate per row.
 * Twenty-three predicates is twenty-three places to write `'bench'` where
 * `'deadlift'` was meant, and each one would need its own test to catch it; one
 * switch is one place, and the table below reads as a list of claims about the
 * sport that somebody can check by eye.
 */
export type Applicability =
  | 'always'
  | 'squats'
  | 'benches'
  | 'deadlifts'
  | 'squats-or-deadlifts'
  | 'uses-a-rack'
  | 'equipped'
  | 'record-attempt';

/** What the list is being built for. Three answers the setup already holds. */
export interface ChecklistContext {
  readonly format: MeetFormat;
  readonly equipment: EquipmentCategory;
  readonly goal: MeetGoal;
}

interface ChecklistEntry {
  readonly id: ChecklistItemId;
  readonly group: ChecklistGroup;
  readonly applies: Applicability;
}

/**
 * §22.2's twenty-three rows, in the order the requirement lists them.
 *
 * The order is kept because it is a packing order -- identification and singlet
 * first, the things that go on top of the bag last -- and re-sorting it
 * alphabetically or by applicability would be the tool having an opinion about
 * somebody else's bag.
 *
 * Four rows are conditional on the meet and the claims are all checkable:
 * shoes and socks follow the lifts actually contested, knee sleeves follow the
 * two lifts they are worn for, a rack confirmation needs a rack, equipped gear
 * needs an equipped division, and record paperwork needs a record attempt.
 *
 * Two rows carry "where applicable" in the requirement and are nonetheless
 * unconditional here: approved underwear and chalk. Neither is answerable from
 * anything the tool holds -- no published rule profile says whether a federation
 * mandates briefs or permits baby powder (§15 would have to grow a field), and
 * inventing the answer is worse than carrying the caveat in the wording. So the
 * row is always offered and `copy.ts` says "where your federation requires it".
 */
const CHECKLIST: readonly ChecklistEntry[] = [
  { id: 'membership-and-identification', group: 'bring', applies: 'always' },
  { id: 'singlet', group: 'bring', applies: 'always' },
  { id: 'approved-shirt', group: 'bring', applies: 'always' },
  { id: 'approved-underwear', group: 'bring', applies: 'always' },
  { id: 'belt', group: 'bring', applies: 'always' },
  { id: 'knee-sleeves-or-wraps', group: 'bring', applies: 'squats-or-deadlifts' },
  { id: 'wrist-wraps', group: 'bring', applies: 'always' },
  { id: 'squat-shoes', group: 'bring', applies: 'squats' },
  { id: 'bench-shoes', group: 'bring', applies: 'benches' },
  { id: 'deadlift-shoes', group: 'bring', applies: 'deadlifts' },
  { id: 'deadlift-socks', group: 'bring', applies: 'deadlifts' },
  { id: 'equipped-gear', group: 'bring', applies: 'equipped' },
  { id: 'chalk-and-powder', group: 'bring', applies: 'always' },
  { id: 'food', group: 'bring', applies: 'always' },
  { id: 'fluids', group: 'bring', applies: 'always' },
  { id: 'attempt-plan-in-kilograms', group: 'bring', applies: 'always' },
  { id: 'printed-backup', group: 'bring', applies: 'always' },
  { id: 'phone-charger', group: 'bring', applies: 'always' },
  { id: 'record-documentation', group: 'bring', applies: 'record-attempt' },
  { id: 'rack-height-confirmation', group: 'do', applies: 'uses-a-rack' },
  { id: 'equipment-check', group: 'do', applies: 'always' },
  { id: 'weigh-in', group: 'do', applies: 'always' },
  { id: 'rules-and-commands-review', group: 'do', applies: 'always' },
];

/** Every default row this tool knows, applicable or not. §23 and §24 read it. */
export const CHECKLIST_ITEM_IDS: readonly ChecklistItemId[] = CHECKLIST.map((entry) => entry.id);

/**
 * Whether a condition holds for this meet.
 *
 * Exported so its claims can be tested one at a time rather than only through
 * the twenty-three rows that happen to use them.
 */
export function appliesWhen(condition: Applicability, context: ChecklistContext): boolean {
  const lifts = liftsInFormat(context.format);
  const contests = (lift: PlatformLift): boolean => lifts.includes(lift);

  switch (condition) {
    case 'always':
      return true;
    case 'squats':
      return contests('squat');
    case 'benches':
      return contests('bench');
    case 'deadlifts':
      return contests('deadlift');
    case 'squats-or-deadlifts':
      return contests('squat') || contests('deadlift');
    case 'uses-a-rack':
      return contests('squat') || contests('bench');
    case 'equipped':
      // Wraps are raw equipment under every profile this tool has: they are
      // knee wraps, and the row they would switch on is a bench shirt and a
      // squat suit. `other` and `unstated` are not equipped either, and the
      // direction matters -- offering an equipped lifter no gear row is a
      // missing prompt, and offering a raw lifter one is a row they cannot
      // complete and learn to tick anyway.
      return context.equipment === 'single-ply' || context.equipment === 'multi-ply';
    case 'record-attempt':
      return context.goal === 'record-attempt';
  }
}

/*
 * ---------------------------------------------------------------------------
 * The state.
 * ---------------------------------------------------------------------------
 */

/** A row somebody added. The id is minted here; the text is theirs. */
export interface CustomChecklistItem {
  readonly itemId: string;
  readonly text: string;
}

export interface MeetPrep {
  readonly setup: LifterSetup;
  /**
   * Which rows are ticked, by id.
   *
   * A set rather than a flag per row, because the rows are derived and there is
   * no fixed shape to hang flags on. Custom ids share the space with default
   * ones and cannot collide: every custom id is `custom-<n>`, which is not a
   * `ChecklistItemId`.
   */
  readonly done: ReadonlySet<string>;
  readonly custom: readonly CustomChecklistItem[];
  /** §22's reminders and user-authored notes, in the lifter's own words. */
  readonly notes: string;
  /**
   * The counter behind custom ids.
   *
   * The same device `meet-document.ts` uses for lifters, for the same reason:
   * an id has to be stable across a re-render and unique across a removal, and
   * a position in the array is neither. Never decremented, so a removed item's
   * id is retired rather than handed to the next one -- which is what makes
   * dropping its tick safe.
   */
  readonly nextCustomOrdinal: number;
}

export const EMPTY_PREP: MeetPrep = {
  setup: EMPTY_LIFTER_SETUP,
  done: new Set<string>(),
  custom: [],
  notes: '',
  nextCustomOrdinal: 1,
};

/*
 * ---------------------------------------------------------------------------
 * Reading the list.
 * ---------------------------------------------------------------------------
 */

/** One row as a screen or a printed page needs it. */
export type ChecklistRow =
  | {
      readonly kind: 'default';
      readonly itemId: ChecklistItemId;
      readonly group: ChecklistGroup;
      readonly done: boolean;
    }
  | {
      readonly kind: 'custom';
      readonly itemId: string;
      readonly group: 'own';
      readonly text: string;
      readonly done: boolean;
    };

/**
 * Every row that applies to this meet, in group order.
 *
 * One function rather than one per group so that the group order is stated once.
 * A caller wanting a single group filters; a caller wanting all of them -- the
 * printed pack, the progress count -- gets them without knowing the order.
 */
export function checklistFor(prep: MeetPrep, context: ChecklistContext): readonly ChecklistRow[] {
  const defaults: ChecklistRow[] = CHECKLIST.filter((entry) =>
    appliesWhen(entry.applies, context),
  ).map((entry) => ({
    kind: 'default',
    itemId: entry.id,
    group: entry.group,
    done: prep.done.has(entry.id),
  }));

  const own: ChecklistRow[] = prep.custom.map((item) => ({
    kind: 'custom',
    itemId: item.itemId,
    group: 'own',
    text: item.text,
    done: prep.done.has(item.itemId),
  }));

  return [
    ...defaults.filter((row) => row.group === 'bring'),
    ...defaults.filter((row) => row.group === 'do'),
    ...own,
  ];
}

/** How much of a list is ticked. Handed the rows so a caller can count a group. */
export interface ChecklistProgress {
  readonly total: number;
  readonly done: number;
  readonly remaining: number;
}

export function checklistProgress(rows: readonly ChecklistRow[]): ChecklistProgress {
  const done = rows.filter((row) => row.done).length;
  return { total: rows.length, done, remaining: rows.length - done };
}

/*
 * ---------------------------------------------------------------------------
 * Transitions.
 * ---------------------------------------------------------------------------
 */

export function withLifterSetup(prep: MeetPrep, patch: Partial<LifterSetup>): MeetPrep {
  return { ...prep, setup: { ...prep.setup, ...patch } };
}

/**
 * The §22.1 keys whose answer is whatever the lifter typed.
 *
 * Derived rather than listed, so it cannot drift from `LifterSetup`. `string
 * extends LifterSetup[K]` is true only of a genuinely free field -- a key typed
 * as a closed set of words is *assignable to* string and so would pass the
 * obvious test written the other way round, which is the mistake this spelling
 * exists to avoid.
 */
type FreeTextField = {
  [K in keyof LifterSetup]: string extends LifterSetup[K] ? K : never;
}[keyof LifterSetup];

/**
 * Writes one setup answer, named by the `data-field` its control carried.
 *
 * The one function in this file that exists because of how the screen is
 * wired. `fields.ts` makes a §22.1 field name *be* the `LifterSetup` key, so
 * the root has a narrowed key and a string and no switch to route them
 * through, and three of the sixteen answers are not strings. Doing the routing
 * in the element would put `squatStartFromValue` and its two neighbours in a
 * template; doing it in the root would put a §22 vocabulary in a file that
 * knows about plans and platforms. It belongs beside the type.
 *
 * The `text` binding in the last branch is not a formality. A computed key is
 * checked by nothing -- TypeScript accepts `{ [field]: value }` against
 * `Partial<LifterSetup>` for *any* key of it, including the three above -- so
 * without that line a `SquatStart` field silently accepts the string `"14"`,
 * which is §2.4's silent coercion arriving through a hole in the compiler. The
 * annotation is what makes the switch above exhaustive: add a fourth
 * closed-vocabulary key to `LifterSetup` and forget its case, and this stops
 * compiling rather than storing a rack height where a squat start goes.
 */
export function withSetupAnswer(prep: MeetPrep, field: keyof LifterSetup, value: string): MeetPrep {
  switch (field) {
    case 'squatStart':
      return withLifterSetup(prep, { squatStart: squatStartFromValue(value) });
    case 'footBlocks':
      return withLifterSetup(prep, { footBlocks: answerFromValue(value) });
    case 'handoff':
      return withLifterSetup(prep, { handoff: handoffFromValue(value) });
    default: {
      const text: FreeTextField = field;
      return withLifterSetup(prep, { [text]: value });
    }
  }
}

export function withPrepNotes(prep: MeetPrep, notes: string): MeetPrep {
  return { ...prep, notes };
}

/**
 * Ticks or unticks one row.
 *
 * Told what the answer now is rather than asked to flip it. A checkbox reports
 * its own new state, and a toggle would invert twice on the one occasion the two
 * disagree -- a repeated report, which `ptk-toggle-group` can emit and every
 * caller of it has had to guard against.
 */
export function withChecklistItem(prep: MeetPrep, itemId: string, done: boolean): MeetPrep {
  if (prep.done.has(itemId) === done) return prep;
  const next = new Set(prep.done);
  if (done) next.add(itemId);
  else next.delete(itemId);
  return { ...prep, done: next };
}

/**
 * Ticks or unticks a whole group at once, without touching the other groups.
 *
 * `ptk-toggle-group` reports its entire selection rather than the row that
 * moved, which is the right contract for a control and the wrong shape for this
 * state -- three groups are three controls, and writing one control's selection
 * over `done` would untick the other two. So the caller says which rows the
 * report was about, and only those are reconciled.
 */
export function withCheckedRows(
  prep: MeetPrep,
  within: readonly string[],
  checked: readonly string[],
): MeetPrep {
  const now = new Set(checked);
  const next = new Set(prep.done);
  for (const itemId of within) {
    if (now.has(itemId)) next.add(itemId);
    else next.delete(itemId);
  }
  return { ...prep, done: next };
}

/** Why a row somebody typed was not added. */
export type CustomItemRefusal = 'empty' | 'too-long' | 'duplicate';

export type AddCustomItemResult =
  | { readonly ok: true; readonly prep: MeetPrep }
  | { readonly ok: false; readonly refusal: CustomItemRefusal };

/**
 * Adds a row of somebody's own.
 *
 * Trimmed, because a row is read at a glance and leading space makes two rows
 * that look identical sort and compare differently. A duplicate is refused for
 * the same reason it matters here and not elsewhere: two identical rows on a
 * list tapped with chalky hands means one of them stays unticked forever and the
 * count never reaches zero. Compared case-insensitively -- "mouthguard" and
 * "Mouthguard" are one item to the person holding the bag.
 */
export function addCustomItem(prep: MeetPrep, text: string): AddCustomItemResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, refusal: 'empty' };
  if (trimmed.length > CUSTOM_ITEM_MAX) return { ok: false, refusal: 'too-long' };

  const folded = trimmed.toLocaleLowerCase();
  if (prep.custom.some((item) => item.text.toLocaleLowerCase() === folded)) {
    return { ok: false, refusal: 'duplicate' };
  }

  const itemId = `custom-${String(prep.nextCustomOrdinal)}`;
  return {
    ok: true,
    prep: {
      ...prep,
      custom: [...prep.custom, { itemId, text: trimmed }],
      nextCustomOrdinal: prep.nextCustomOrdinal + 1,
    },
  };
}

/**
 * Removes a row of somebody's own, and its tick with it.
 *
 * The tick goes because the id is retired and can never be shown again -- see
 * the note on `nextCustomOrdinal`. This is the opposite of what happens to a
 * default row that stops applying, and the difference is exactly that a default
 * row can come back.
 */
export function removeCustomItem(prep: MeetPrep, itemId: string): MeetPrep {
  const custom = prep.custom.filter((item) => item.itemId !== itemId);
  if (custom.length === prep.custom.length) return prep;

  const done = new Set(prep.done);
  done.delete(itemId);
  return { ...prep, custom, done };
}

/*
 * ---------------------------------------------------------------------------
 * Reading what was typed.
 * ---------------------------------------------------------------------------
 */

/** A time of day as minutes past midnight, or why it could not be read. */
export type TimeReading =
  | { readonly ok: true; readonly minutes: number }
  | { readonly ok: false; readonly empty: true }
  | { readonly ok: false; readonly empty: false };

const MINUTES_PER_HOUR = 60;
const HOURS_PER_HALF_DAY = 12;

/**
 * Reads a time of day, in whichever of the two forms somebody types it.
 *
 * Both, deliberately. This tool is built first for USPA and IPL lifters, who
 * write `8:30 AM`, and it supports federations whose schedules are published in
 * twenty-four hour time. Refusing either would refuse the true answer at half
 * the meets, and a rule of "twenty-four hour only, see the hint" is a rule that
 * gets broken at 6am in a car park.
 *
 * The separator may be a colon or a full stop, because `8.30` is what a phone
 * keypad makes easy and it is unambiguous here. What is *not* accepted is a bare
 * `830`: it reads as 8:30 to a person and as one number to everything else, and
 * guessing wrong on a weigh-in time is the failure this parse exists to prevent.
 *
 * With no meridiem marker the figure is read as twenty-four hour, which is the
 * only reading that cannot be wrong -- `14:00` has no other meaning, and `8:30`
 * typed by somebody thinking in twelve hours is a morning either way.
 */
export function parseTimeOfDay(text: string): TimeReading {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, empty: true };

  const match = /^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i.exec(trimmed);
  if (match === null) return { ok: false, empty: false };

  const [, rawHours, rawMinutes, marker] = match;
  // The capture groups are guaranteed by a match on a pattern that has them,
  // which the compiler cannot see; reading them through a default keeps this
  // total without a non-null assertion.
  const hours = Number(rawHours ?? '');
  const minutes = Number(rawMinutes ?? '');
  if (minutes >= MINUTES_PER_HOUR) return { ok: false, empty: false };

  if (marker === undefined) {
    if (hours >= 24) return { ok: false, empty: false };
    return { ok: true, minutes: hours * MINUTES_PER_HOUR + minutes };
  }

  // Twelve is the hour that breaks the pattern in both directions: 12 am is
  // midnight and 12 pm is noon, so it maps to zero before the pm offset rather
  // than after it. Getting this backwards puts a noon weigh-in at midnight.
  if (hours < 1 || hours > HOURS_PER_HALF_DAY) return { ok: false, empty: false };
  const base = hours === HOURS_PER_HALF_DAY ? 0 : hours;
  const offset = marker.toLowerCase() === 'pm' ? HOURS_PER_HALF_DAY * MINUTES_PER_HOUR : 0;
  return { ok: true, minutes: base * MINUTES_PER_HOUR + minutes + offset };
}

/** Which setup field is wrong, and how. Codes; `copy.ts` writes the sentence. */
export type SetupProblemCode = 'time-not-understood' | 'too-long';

export interface SetupProblem {
  readonly field: keyof LifterSetup;
  readonly code: SetupProblemCode;
  /** The cap that was exceeded, so the sentence can name it. */
  readonly max: number | null;
}

const LABEL_FIELDS = [
  'squatRackHeight',
  'squatSafetyHeight',
  'monoliftSetting',
  'benchRackHeight',
  'benchSafetyHeight',
  'flight',
  'lot',
  'platform',
  'session',
] as const satisfies readonly (keyof LifterSetup)[];

const NOTE_FIELDS = ['deadliftNotes', 'commands'] as const satisfies readonly (keyof LifterSetup)[];

const TIME_FIELDS = [
  'weighInTime',
  'liftingStartTime',
] as const satisfies readonly (keyof LifterSetup)[];

/**
 * Everything wrong with the setup, in field order.
 *
 * All of it at once rather than the first problem, because these are typed in
 * any order and a screen showing one error at a time makes a lifter fix four
 * fields in four passes. Empty is not a problem: every answer here is optional,
 * and §22's whole premise is that some of it is not known until the morning.
 */
export function setupProblems(setup: LifterSetup): readonly SetupProblem[] {
  const problems: SetupProblem[] = [];

  for (const field of LABEL_FIELDS) {
    if (setup[field].length > SETUP_LABEL_MAX) {
      problems.push({ field, code: 'too-long', max: SETUP_LABEL_MAX });
    }
  }
  for (const field of NOTE_FIELDS) {
    if (setup[field].length > SETUP_NOTE_MAX) {
      problems.push({ field, code: 'too-long', max: SETUP_NOTE_MAX });
    }
  }
  for (const field of TIME_FIELDS) {
    const reading = parseTimeOfDay(setup[field]);
    if (!reading.ok && !reading.empty) {
      problems.push({ field, code: 'time-not-understood', max: null });
    }
  }

  return problems;
}

/** The problem to show under one field, if any. */
export function problemFor(
  problems: readonly SetupProblem[],
  field: keyof LifterSetup,
): SetupProblem | null {
  return problems.find((problem) => problem.field === field) ?? null;
}

/**
 * Whether the notes are over `PREP_NOTES_MAX`.
 *
 * Its own function rather than a row in `setupProblems`, because the notes are
 * not a setup answer -- they hang off `MeetPrep` and not off `LifterSetup`, so
 * a `SetupProblem` has nowhere to put the field name. The shape is deliberately
 * the tail of one, which is what lets `setupProblemText` write both sentences.
 *
 * It exists at all because the cap was being announced and not applied. The
 * hint on the box names 2000 characters and `withPrepNotes` took a string of
 * any length, so the only thing between a paste of somebody's whole training
 * log and §23's printed page was that nobody had tried it. A refusal rather
 * than a truncation: silently dropping the tail of what a lifter wrote is the
 * coercion §2.4 forbids, and the part it would drop is the part they were still
 * typing.
 */
export interface PrepNotesProblem {
  readonly code: Extract<SetupProblemCode, 'too-long'>;
  readonly max: number;
}

export function prepNotesProblem(notes: string): PrepNotesProblem | null {
  return notes.length > PREP_NOTES_MAX ? { code: 'too-long', max: PREP_NOTES_MAX } : null;
}

/*
 * ---------------------------------------------------------------------------
 * Reading a control's value.
 *
 * The same crossing `session.ts` documents at length: a radio's value is a
 * string out of the DOM, every one of these is total, and an unrecognised value
 * lands on the answer that claims nothing rather than on a state no control can
 * show back.
 * ---------------------------------------------------------------------------
 */

function oneOf<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function squatStartFromValue(value: string): SquatStart {
  return oneOf(SQUAT_STARTS, value, 'unstated');
}

export function handoffFromValue(value: string): HandoffPreference {
  return oneOf(HANDOFF_PREFERENCES, value, 'unstated');
}
