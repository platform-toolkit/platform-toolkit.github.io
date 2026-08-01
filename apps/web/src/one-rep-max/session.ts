/**
 * What the one-rep max calculator holds between keystrokes, and what it
 * remembers between visits.
 *
 * Pure, like every other tool's session module. Everything interesting here is
 * a decision about what an answer *means* -- what happens to a technique
 * standard when the lift changes underneath it, what a unit flick does to a
 * typed weight, which of these answers a device is allowed to keep -- and none
 * of those need a browser to state or a browser to test.
 *
 * WHAT IS A SETTING AND WHAT IS ONE SET
 *
 * Two stores, the way tool 2 has two, and the split is different from tool 2's.
 * A lifter's *preferences* -- kilograms or pounds, how coarse the rounding is,
 * how big a step the percentage table takes, which lift they usually open with
 * -- are theirs for as long as they use the tool, and re-answering them at a
 * rack is the friction this collection exists to remove. Everything that
 * describes *the set they just did* is scratch: the weight, the repetitions,
 * how close to failure it was, whether they were fresh, whether a spotter
 * touched the bar. That has to survive a phone locking and a reload at the rack
 * (§12) and it must be gone next Tuesday, because a set description reopened a
 * week later is a training record the lifter never wrote.
 *
 * The reported sex and the training experience are in the scratch store too,
 * and deliberately. They are optional weighting inputs, not settings, and
 * writing a sex marker into a device's long-lived storage for the sake of
 * saving one tap is a trade this project does not need to make.
 *
 * STRINGS UNTIL SOMETHING PARSES THEM
 *
 * The weight and the repetition count are held as exactly what is in the field.
 * A half-typed `12.` has a text and no value, and the field has to keep showing
 * it -- a visitor cannot correct a character the tool silently ate.
 */
import {
  ESTIMATE_LIFTS,
  MAX_COMPLETED_REPS,
  MAX_WEIGHT_INPUT,
  MIN_COMPLETED_REPS,
  ROUNDING_INCREMENTS,
  defaultRoundingIncrement,
  defaultTechniqueFor,
  enterWeight,
  entryAmount,
  entryWeight,
  findTechnique,
  parseWeightInput,
  showEntryIn,
  techniquesFor,
  type EnteredWeight,
  type EstimateLift,
  type FormQuality,
  type OneRepMaxRequest,
  type RepsInReserve,
  type ReportedSex,
  type SetFreshness,
  type TrainingExperience,
  type WeightUnit,
} from '@platform-toolkit/domain';
import {
  PreferenceValue,
  definePreference,
  type PreferenceStore,
} from '@platform-toolkit/preferences';

/**
 * Repetition counts offered as one tap each.
 *
 * §12 asks for common rep counts to be quick to enter, and these are the sets a
 * lifter actually tests: singles through triples, the classic five, and the two
 * higher counts anybody uses to estimate from. Everything else is typed. Twenty
 * chips would be a keyboard with worse ergonomics than a keyboard.
 */
export const QUICK_REPS: readonly number[] = [1, 2, 3, 5, 8, 10];

/**
 * The reserve question's answers, in the order §5.2 fixes them.
 *
 * A string for every answer, including the numeric ones, because this list is
 * what a radio group reports back and what a device stores -- both of which are
 * strings -- and because the domain's own type mixes numbers with words. The
 * mapping to that type is `reserveFrom`, which is total in both directions.
 */
export type ReserveChoice = '0' | '1' | '2' | '3' | 'four-or-more' | 'unknown';

export const RESERVE_CHOICES: readonly ReserveChoice[] = [
  '0',
  '1',
  '2',
  '3',
  'four-or-more',
  'unknown',
];

export function reserveFrom(choice: ReserveChoice): RepsInReserve {
  switch (choice) {
    case '0':
      return 0;
    case '1':
      return 1;
    case '2':
      return 2;
    case '3':
      return 3;
    case 'four-or-more':
      return 'four-or-more';
    case 'unknown':
      return 'unknown';
  }
}

export function reserveChoiceOf(reserve: RepsInReserve): ReserveChoice {
  switch (reserve) {
    case 0:
      return '0';
    case 1:
      return '1';
    case 2:
      return '2';
    case 3:
      return '3';
    case 'four-or-more':
      return 'four-or-more';
    case 'unknown':
      return 'unknown';
  }
}

/**
 * How a declined answer is spelled on the wire. The domain spells it `null`.
 *
 * A word rather than an absent key, because `packages/preferences` has no
 * nullable shape and should not grow one: "I would rather not say" is an answer
 * the lifter gave, and it has to read back as that rather than as a setting
 * that failed to save.
 */
const DECLINED = 'declined';

type StoredSex = 'man' | 'woman' | typeof DECLINED;
type StoredExperience = 'new' | 'intermediate' | 'experienced' | typeof DECLINED;

/**
 * The same two answers as a radio group reports them, in both directions.
 *
 * A control hands back a `string`, and the two obvious ways to turn that into
 * `ReportedSex` are an assertion and a cast-shaped lookup table, both of which
 * keep compiling when the option list and the domain type drift apart. A total
 * switch does not: adding a value to `ReportedSex` makes this fail to build,
 * which is where a missing option should be discovered.
 *
 * "Declined" and "not asked yet" are the same state on purpose. Both mean the
 * lifter has not told the tool, and the estimate is produced either way (§7.4).
 */
export function sexFrom(value: string): ReportedSex {
  switch (value) {
    case 'man':
      return 'man';
    case 'woman':
      return 'woman';
    default:
      return null;
  }
}

export function sexValueOf(sex: ReportedSex): string {
  return sex ?? DECLINED;
}

export function experienceFrom(value: string): TrainingExperience {
  switch (value) {
    case 'new':
      return 'new';
    case 'intermediate':
      return 'intermediate';
    case 'experienced':
      return 'experienced';
    default:
      return null;
  }
}

export function experienceValueOf(experience: TrainingExperience): string {
  return experience ?? DECLINED;
}

/** The freshness answers as a control reports them. Unknown text means unstated. */
export function freshnessFrom(value: string): SetFreshness {
  switch (value) {
    case 'fresh':
      return 'fresh';
    case 'fatigued':
      return 'fatigued';
    default:
      return 'unstated';
  }
}

export function formQualityFrom(value: string): FormQuality {
  switch (value) {
    case 'consistent':
      return 'consistent';
    case 'degraded':
      return 'degraded';
    default:
      return 'unstated';
  }
}

/** A reserve answer from a control, defaulting to the one that claims nothing. */
export function reserveFromValue(value: string): ReserveChoice {
  return RESERVE_CHOICES.find((choice) => choice === value) ?? 'unknown';
}

/** A lift identifier from a control, defaulting to the one the tool opens on. */
export function liftFromValue(value: string): EstimateLift {
  return ESTIMATE_LIFTS.find((lift) => lift === value) ?? 'squat';
}

/** A unit from a control. Anything unrecognised is kilograms, the platform unit. */
export function unitFromValue(value: string): WeightUnit {
  return value === 'lb' ? 'lb' : 'kg';
}

/**
 * The technique a lift starts on: the one that claims nothing.
 *
 * Not `defaultTechniqueFor`, which answers with the *competition* standard --
 * right as a description of the list's ordering, wrong as an opening state.
 * "Competition depth" is an assertion that raises the input grade (§8.3), and a
 * tool that makes that assertion on a lifter's behalf before they have said
 * anything has upgraded its own answer for free. Every lift's list ends in an
 * unsure option; that is the honest place to start. The competition-standard
 * default is kept as the fallback so a lift added later without an unsure
 * option still lands on something real rather than on nothing.
 */
export function openingTechniqueFor(lift: EstimateLift): string {
  const unsure = techniquesFor(lift).find((option) => option.match === 'unsure');
  return (unsure ?? defaultTechniqueFor(lift))?.id ?? '';
}

/**
 * Everything the tool is currently being asked about.
 *
 * `unit` is held beside the weight rather than read off it because an empty
 * field has no weight to read a unit from, and the unit control has to keep
 * working before anything is typed.
 */
export interface EstimateEntry {
  /** Exactly what is in the weight field. */
  readonly weightText: string;
  /**
   * The drift-free origin behind the weight field, or `null` when nothing parses.
   *
   * Tool 4's `EnteredWeight`, reused rather than re-derived: §15 makes
   * "converting between units repeatedly introduces no cumulative drift" an
   * acceptance test, and the only way to pass it is to never rewrite the number
   * the lifter typed. Flicking kg/lb changes which unit the origin is *shown*
   * in and touches the origin not at all.
   */
  readonly weight: EnteredWeight | null;
  readonly unit: WeightUnit;
  /** Exactly what is in the repetitions field. */
  readonly repsText: string;
  readonly reserve: ReserveChoice;
  readonly lift: EstimateLift;
  /** Always an identifier `techniquesFor(lift)` offers. */
  readonly techniqueId: string;
  readonly sex: ReportedSex;
  readonly experience: TrainingExperience;
  readonly freshness: SetFreshness;
  readonly formQuality: FormQuality;
  readonly assisted: boolean;
  /** The step the three displayed figures are rounded to, in `unit`. */
  readonly roundTo: number;
  /** The gap between rows of the training-percentage table, in whole percent. */
  readonly percentageStep: number;
}

export const EMPTY_ENTRY: EstimateEntry = {
  weightText: '',
  weight: null,
  // Kilograms, which §5.1 names as the default: this is a powerlifting tool and
  // a platform is loaded in kilograms even where the audience thinks in pounds.
  unit: 'kg',
  repsText: '',
  // "Not sure", because before the lifter answers that is what is true. Opening
  // on zero -- the answer that earns the strongest grade -- would flatter every
  // first result, and opening on nothing at all would leave the tool unable to
  // show a result until a question the requirements call optional was answered.
  reserve: 'unknown',
  lift: 'squat',
  techniqueId: openingTechniqueFor('squat'),
  sex: null,
  experience: null,
  freshness: 'unstated',
  formQuality: 'unstated',
  assisted: false,
  roundTo: defaultRoundingIncrement('kg'),
  percentageStep: 5,
};

/*
 * ---------------------------------------------------------------------------
 * Editing.
 * ---------------------------------------------------------------------------
 */

/**
 * Accepts a keystroke in the weight field.
 *
 * A unit suffix is honoured and changes the unit, the way tool 4's field does:
 * somebody who types `315 lb` into a kilogram field has said which unit their
 * number is in, and reading it as kilograms would put a hundred and fifty
 * kilograms of difference on the screen with nothing to indicate it.
 */
export function typeWeight(entry: EstimateEntry, text: string): EstimateEntry {
  const parsed = parseWeightInput(text);
  if (!parsed.ok) {
    return { ...entry, weightText: text, weight: null };
  }
  const unit = parsed.unit ?? entry.unit;
  return {
    ...entry,
    weightText: text,
    unit,
    roundTo: unit === entry.unit ? entry.roundTo : matchIncrement(entry.roundTo, entry.unit, unit),
    weight: enterWeight(parsed.amount, unit),
  };
}

/** Accepts a keystroke in the repetitions field. Parsing happens on the way out. */
export function typeReps(entry: EstimateEntry, text: string): EstimateEntry {
  return { ...entry, repsText: text };
}

/** A quick-pick chip. Writes the digits a visitor would otherwise type. */
export function chooseReps(entry: EstimateEntry, reps: number): EstimateEntry {
  return { ...entry, repsText: String(reps) };
}

/**
 * Switches unit, converting what was typed rather than rereading it.
 *
 * The requirement in one line (§10): "Changing units SHALL convert values, not
 * reinterpret them." 100 kg becomes 220.46 lb, never 100 lb. The rounding step
 * moves with it -- see `matchIncrement`.
 */
export function setUnit(entry: EstimateEntry, unit: WeightUnit): EstimateEntry {
  if (unit === entry.unit) return entry;
  const held = entry.weight;
  const weight = held === null ? null : showEntryIn(held, unit);
  return {
    ...entry,
    unit,
    weight,
    weightText: weight === null ? entry.weightText : String(entryAmount(weight)),
    roundTo: matchIncrement(entry.roundTo, entry.unit, unit),
  };
}

/**
 * The same coarseness in the other unit, by position rather than by size.
 *
 * The two lists are not conversions of each other -- half a kilogram and one
 * pound are both "the finest step a bar takes", and 2.5 kg and 5 lb are both
 * "the plate I am actually loading". Converting the number instead would answer
 * 1.1 lb for half a kilogram, which is not a step any bar has, and the offered
 * list would then contain a value nothing selects.
 */
function matchIncrement(step: number, from: WeightUnit, to: WeightUnit): number {
  const index = ROUNDING_INCREMENTS[from].indexOf(step);
  return ROUNDING_INCREMENTS[to][index] ?? defaultRoundingIncrement(to);
}

/**
 * Changes the lift, and resets the technique standard with it.
 *
 * The identifiers are only unique within a lift, so carrying `touch-and-go`
 * across to a squat would either select nothing or -- worse, if two lists ever
 * shared a spelling -- select something the lifter did not choose. Resetting to
 * the unsure option is the one answer that is true of a lift nobody has
 * described yet.
 */
export function setLift(entry: EstimateEntry, lift: EstimateLift): EstimateEntry {
  if (lift === entry.lift) return entry;
  return { ...entry, lift, techniqueId: openingTechniqueFor(lift) };
}

/** Sets the technique standard, ignoring an identifier this lift does not offer. */
export function setTechnique(entry: EstimateEntry, techniqueId: string): EstimateEntry {
  return findTechnique(entry.lift, techniqueId) === null ? entry : { ...entry, techniqueId };
}

/*
 * ---------------------------------------------------------------------------
 * Reading the two typed fields.
 * ---------------------------------------------------------------------------
 */

/**
 * The sentence to show under the weight field, or `null` when nothing is wrong.
 *
 * An empty field is deliberately not a problem: it is where every visit starts,
 * and an error there is the tool telling somebody off for opening it.
 */
export function weightProblem(entry: EstimateEntry): string | null {
  const text = entry.weightText;
  if (text.trim() === '') return null;
  const parsed = parseWeightInput(text);
  if (parsed.ok) return null;
  switch (parsed.code) {
    case 'empty':
      return null;
    case 'negative':
      return 'Enter a weight above zero.';
    case 'too-large':
      return `Enter a weight of ${MAX_WEIGHT_INPUT.toLocaleString('en-US')} or less.`;
    case 'unknown-unit':
      return 'Enter a weight in kilograms or pounds, for example 130 kg.';
    case 'not-a-number':
      return 'Enter a weight using digits, for example 130.';
  }
}

/**
 * The repetition count, or `null` when the field cannot be read as one.
 *
 * Out-of-range counts come back as numbers on purpose. Twenty-one repetitions
 * is a set the tool has something specific to say about (§11: the set is
 * unsuitable, use a heavier one), and it can only say it if the number reaches
 * the domain instead of being swallowed here as "not a number".
 */
export function readReps(entry: EstimateEntry): number | null {
  const text = entry.repsText.trim();
  if (text === '') return null;
  if (!/^\d+$/u.test(text)) return null;
  const reps = Number(text);
  return Number.isSafeInteger(reps) ? reps : null;
}

/** The sentence to show under the repetitions field, for the shape of the input only. */
export function repsProblem(entry: EstimateEntry): string | null {
  const text = entry.repsText.trim();
  if (text === '') return null;
  return readReps(entry) === null
    ? `Enter a whole number of repetitions, ${String(MIN_COMPLETED_REPS)} to ${String(MAX_COMPLETED_REPS)}.`
    : null;
}

/**
 * The request to hand the domain, or `null` when there is not yet a set to describe.
 *
 * `null` means "nothing to estimate", never "the input is wrong". A count of
 * twenty-five and a weight of zero both produce a request, because both have an
 * answer the domain is the right place to give.
 */
export function requestFor(entry: EstimateEntry): OneRepMaxRequest | null {
  const held = entry.weight;
  const reps = readReps(entry);
  if (held === null || reps === null) return null;
  return {
    weight: entryWeight(held),
    completedReps: reps,
    repsInReserve: reserveFrom(entry.reserve),
    lift: entry.lift,
    techniqueId: entry.techniqueId,
    sex: entry.sex,
    experience: entry.experience,
    freshness: entry.freshness,
    formQuality: entry.formQuality,
    assisted: entry.assisted,
    displayUnit: entry.unit,
    roundTo: entry.roundTo,
  };
}

/*
 * ---------------------------------------------------------------------------
 * What survives, and for how long.
 * ---------------------------------------------------------------------------
 */

/**
 * Every technique identifier the domain offers, spelled out.
 *
 * `PreferenceValue.choice` infers its literal union from a `const` type
 * parameter, so a list computed from `techniquesFor` widens to `string` and the
 * preference stops being a closed picklist -- which is the whole reason
 * `packages/preferences` has no free-text builder (§5.12). Spelled inline
 * instead, and held in step with the domain by a test that fails the moment the
 * two disagree. A stored identifier is validated against the *lift* on the way
 * back in regardless, so the worst a stale entry can do is fall back.
 */
const TECHNIQUE_IDS = [
  'competition-squat',
  'above-depth',
  'knee-wraps',
  'paused-or-tempo',
  'squat-unstated',
  'competition-bench',
  'touch-and-go',
  'close-grip',
  'feet-up-or-larsen',
  'bench-unstated',
  'conventional',
  'sumo',
  'straps',
  'deficit-or-blocks',
  'deadlift-unstated',
  'strict-press',
  'push-press',
  'seated-press',
  'press-unstated',
  'other-same-standard',
  'other-different-standard',
  'other-unstated',
] as const;

type TechniqueId = (typeof TECHNIQUE_IDS)[number];

/** Exposed for the test that holds the list above in step with the domain. */
export const STORED_TECHNIQUE_IDS: readonly string[] = TECHNIQUE_IDS;

/**
 * The identifier as a member of the stored list, or the safest fallback.
 *
 * A membership test would not narrow the string, and the alternative every
 * caller reaches for is an assertion -- which keeps compiling after the domain
 * adds a technique this file has not caught up with, and then throws on a
 * keystroke because the write violates its own definition (§5.12). Finding the
 * member yields the narrow type honestly, and a miss becomes a fallback rather
 * than a screen that disappears over a dropdown.
 */
function storableTechniqueId(id: string): TechniqueId {
  return TECHNIQUE_IDS.find((known) => known === id) ?? 'squat-unstated';
}

/**
 * The remembered weight, and whether there was one.
 *
 * The same three-plus-a-flag shape tool 4 stores, for the same two reasons.
 * `unit` is the unit the number was *typed* in and `shownIn` is the unit it is
 * being read in now; after a unit flick those differ, and storing only one of
 * them either loses the lifter's unit or starts the drift the origin exists to
 * prevent. The `present` flag is not redundant with a zero amount either: zero
 * is a weight somebody can type, and encoding "empty" as zero would turn a
 * typed `0` into a blank field on the next visit.
 */
interface StoredWeight {
  readonly amount: number;
  readonly unit: WeightUnit;
  readonly shownIn: WeightUnit;
  readonly present: boolean;
}

/** What a device keeps for as long as the lifter uses the tool. */
export const DISPLAY_PREFERENCES = {
  unit: definePreference<WeightUnit>({
    name: 'one-rep-max.unit',
    value: PreferenceValue.choice(['kg', 'lb']),
    fallback: 'kg',
  }),
  lift: definePreference<EstimateLift>({
    name: 'one-rep-max.lift',
    value: PreferenceValue.choice(['squat', 'bench-press', 'deadlift', 'overhead-press', 'other']),
    fallback: 'squat',
  }),
  roundTo: definePreference<number>({
    name: 'one-rep-max.round-to',
    // The bound is the coarsest step either unit offers. A corrupted value
    // outside it would round a headline figure to something no bar loads.
    value: PreferenceValue.quantity({ min: 0.5, max: 5 }),
    fallback: defaultRoundingIncrement('kg'),
  }),
  percentageStep: definePreference<number>({
    name: 'one-rep-max.percentage-step',
    value: PreferenceValue.count({ min: 5, max: 10 }),
    fallback: 5,
  }),
};

/** What a device keeps only until the tab closes: the set itself. */
export const SET_PREFERENCES = {
  weight: definePreference<StoredWeight>({
    name: 'one-rep-max.weight',
    value: PreferenceValue.shape({
      amount: PreferenceValue.quantity({ min: 0, max: MAX_WEIGHT_INPUT }),
      unit: PreferenceValue.choice(['kg', 'lb']),
      shownIn: PreferenceValue.choice(['kg', 'lb']),
      present: PreferenceValue.flag(),
    }),
    fallback: { amount: 0, unit: 'kg', shownIn: 'kg', present: false },
  }),
  reps: definePreference<number>({
    name: 'one-rep-max.reps',
    // Zero means "nothing typed", which is unambiguous here in a way it is not
    // for the weight: a set of zero repetitions is not a set. The ceiling is
    // well above the supported range on purpose, so that the twenty-five a
    // lifter typed survives a reload and is answered again rather than being
    // silently forgotten as unstorable.
    value: PreferenceValue.count({ min: 0, max: 999 }),
    fallback: 0,
  }),
  reserve: definePreference<ReserveChoice>({
    name: 'one-rep-max.reserve',
    value: PreferenceValue.choice(['0', '1', '2', '3', 'four-or-more', 'unknown']),
    fallback: 'unknown',
  }),
  technique: definePreference<TechniqueId>({
    name: 'one-rep-max.technique',
    value: PreferenceValue.choice(TECHNIQUE_IDS),
    fallback: 'squat-unstated',
  }),
  sex: definePreference<StoredSex>({
    name: 'one-rep-max.sex',
    value: PreferenceValue.choice(['man', 'woman', 'declined']),
    fallback: DECLINED,
  }),
  experience: definePreference<StoredExperience>({
    name: 'one-rep-max.experience',
    value: PreferenceValue.choice(['new', 'intermediate', 'experienced', 'declined']),
    fallback: DECLINED,
  }),
  freshness: definePreference<SetFreshness>({
    name: 'one-rep-max.freshness',
    value: PreferenceValue.choice(['fresh', 'fatigued', 'unstated']),
    fallback: 'unstated',
  }),
  formQuality: definePreference<FormQuality>({
    name: 'one-rep-max.form-quality',
    value: PreferenceValue.choice(['consistent', 'degraded', 'unstated']),
    fallback: 'unstated',
  }),
  assisted: definePreference<boolean>({
    name: 'one-rep-max.assisted',
    value: PreferenceValue.flag(),
    fallback: false,
  }),
};

/**
 * Rebuilds the whole entry from the two stores.
 *
 * Every value is re-checked against the list that offers it rather than
 * trusted. Storage is a trust boundary like any other: a rounding step that is
 * not one of this unit's steps would leave a control with nothing selected, and
 * a technique identifier belonging to another lift would silently claim a
 * standard the lifter never chose.
 */
export function loadEntry(display: PreferenceStore, set: PreferenceStore): EstimateEntry {
  const unit = display.read(DISPLAY_PREFERENCES.unit);
  const lift = display.read(DISPLAY_PREFERENCES.lift);
  const storedStep = display.read(DISPLAY_PREFERENCES.roundTo);
  const stored = set.read(SET_PREFERENCES.weight);
  const reps = set.read(SET_PREFERENCES.reps);
  const technique = set.read(SET_PREFERENCES.technique);
  const sex = set.read(SET_PREFERENCES.sex);
  const experience = set.read(SET_PREFERENCES.experience);

  const weight = stored.present
    ? showEntryIn(enterWeight(stored.amount, stored.unit), stored.shownIn)
    : null;
  // The weight carries its own unit and it wins. The two are written together
  // and can only disagree if one landed and the other did not, at which point
  // believing the unit preference puts a pound figure under a kilogram label.
  const shownIn = weight === null ? unit : weight.shownIn;

  return {
    weightText: weight === null ? '' : String(entryAmount(weight)),
    weight,
    unit: shownIn,
    repsText: reps === 0 ? '' : String(reps),
    reserve: set.read(SET_PREFERENCES.reserve),
    lift,
    techniqueId: findTechnique(lift, technique) === null ? openingTechniqueFor(lift) : technique,
    sex: sex === DECLINED ? null : sex,
    experience: experience === DECLINED ? null : experience,
    freshness: set.read(SET_PREFERENCES.freshness),
    formQuality: set.read(SET_PREFERENCES.formQuality),
    assisted: set.read(SET_PREFERENCES.assisted),
    roundTo: ROUNDING_INCREMENTS[shownIn].includes(storedStep)
      ? storedStep
      : defaultRoundingIncrement(shownIn),
    percentageStep: display.read(DISPLAY_PREFERENCES.percentageStep),
  };
}

/**
 * Writes the whole entry back to both stores.
 *
 * One function rather than one per control, because this runs on every
 * keystroke and every tap either way, and a per-control writer is one edit away
 * from a control that visibly responds and quietly never sticks.
 *
 * A write that violates its own definition throws by design (§5.12), which is
 * right for a caller bug and wrong on a keystroke path: half the values passing
 * through here are mid-edit. Anything unstorable is written as "nothing
 * entered" rather than clamped to a number nobody typed.
 */
export function saveEntry(
  display: PreferenceStore,
  set: PreferenceStore,
  entry: EstimateEntry,
): void {
  display.write(DISPLAY_PREFERENCES.unit, entry.unit);
  display.write(DISPLAY_PREFERENCES.lift, entry.lift);
  display.write(
    DISPLAY_PREFERENCES.roundTo,
    ROUNDING_INCREMENTS[entry.unit].includes(entry.roundTo)
      ? entry.roundTo
      : defaultRoundingIncrement(entry.unit),
  );
  display.write(DISPLAY_PREFERENCES.percentageStep, entry.percentageStep);

  const held = entry.weight;
  const storable =
    held !== null && held.origin.amount >= 0 && held.origin.amount <= MAX_WEIGHT_INPUT;
  set.write(
    SET_PREFERENCES.weight,
    storable
      ? {
          amount: held.origin.amount,
          unit: held.origin.unit,
          shownIn: held.shownIn,
          present: true,
        }
      : { amount: 0, unit: entry.unit, shownIn: entry.unit, present: false },
  );

  const reps = readReps(entry);
  set.write(SET_PREFERENCES.reps, reps !== null && reps <= 999 ? reps : 0);
  set.write(SET_PREFERENCES.reserve, entry.reserve);
  set.write(SET_PREFERENCES.technique, storableTechniqueId(entry.techniqueId));
  set.write(SET_PREFERENCES.sex, entry.sex ?? DECLINED);
  set.write(SET_PREFERENCES.experience, entry.experience ?? DECLINED);
  set.write(SET_PREFERENCES.freshness, entry.freshness);
  set.write(SET_PREFERENCES.formQuality, entry.formQuality);
  set.write(SET_PREFERENCES.assisted, entry.assisted);
}

/** Every lift, for the picker. Re-exported so a component needs one import. */
export const LIFTS: readonly EstimateLift[] = ESTIMATE_LIFTS;
