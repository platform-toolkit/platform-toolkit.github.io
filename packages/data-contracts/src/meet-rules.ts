// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';

/**
 * A federation's competition rules, as far as an attempt planner has to know them.
 *
 * WHY THIS IS DATA AND NOT CONSTANTS
 *
 * Every number here is one a federation can revise between two releases of this
 * project: the increment, the submission window, what the expeditor writes down
 * when nobody submits in time, which attempts may still be changed, whether a
 * fourth attempt exists at all. The IPF rulebook current while this was written
 * takes effect on 1 March 2026 and is its third version -- so a build that
 * hard-coded any of it would be a build that goes wrong on a date nobody set a
 * reminder for, at an expeditor's table, in the one minute a lifter has.
 *
 * So every profile carries the rulebook revision it was read from, the day a
 * person last checked it, and a link to the document. A screen showing a rule can
 * therefore say whose rule it is and how old the copy is, which is the whole
 * difference between an aid and a claim.
 *
 * THERE IS NO UNIVERSAL PROFILE, DELIBERATELY
 *
 * Federations do not share these rules. The two profiles published from this
 * repository already differ on the opener-change deadline, on the record margin,
 * and on whether a fourth attempt exists. A default profile would be a set of
 * numbers no federation stands behind, and it would be the one a hurried user
 * left selected. A meet whose federation is not published here is a *custom*
 * profile, which the interface must label as unverified.
 *
 * WHAT IS NOT IN HERE
 *
 * Anything that does not change an attempt's legality: referee counts, gear
 * specifications, sanctioning levels, weigh-in procedure. They are real rules and
 * they belong to the rulebook, not to a planner -- and each one added here is
 * another figure somebody has to re-verify every time the rulebook moves.
 */

const Identifier = v.pipe(v.string(), v.minLength(1));
const Label = v.pipe(v.string(), v.minLength(1));

/** Prose a person wrote, shown to the user verbatim. Never assembled from parts. */
const Sentence = v.pipe(v.string(), v.minLength(1));

/** The single artifact identifier holding every published profile. */
export const MEET_RULES_ARTIFACT_ID = 'meet-rules';

/**
 * The three lifts an attempt is taken on.
 *
 * Not `LiftSchema` from the record contract, which also admits `total`. A total
 * is a thing a lifter has, not a thing they walk onto a platform to attempt, and
 * a rule saying how many times a third total may be changed is not a rule. Two
 * picklists rather than one shared one that is right in neither place.
 */
export const PlatformLiftSchema = v.picklist(['squat', 'bench', 'deadlift'] as const);

export type PlatformLift = v.InferOutput<typeof PlatformLiftSchema>;

/**
 * A kilogram figure a bar can actually be loaded to.
 *
 * Above zero, and with no upper bound: the ceiling on an attempt is the lifter,
 * and a contract that guessed one would be a contract that eventually refuses a
 * real world record. The floor is a tenth of a gram rather than zero because
 * every figure typed as this one is an increment, and a zero increment makes the
 * arithmetic downstream either divide by zero or loop forever.
 */
const PositiveKilograms = v.pipe(v.number(), v.finite(), v.minValue(0.000_1));

/**
 * A link that will end up in an `href`.
 *
 * Checked for scheme rather than trusted, for the reason `conversions.ts` gives:
 * `v.url()` alone accepts `javascript:`, which is a string that validates,
 * renders, and executes when somebody taps the citation under a rule.
 */
const CitationUrl = v.pipe(
  v.string(),
  v.url(),
  v.check(
    (value) => value.startsWith('https://'),
    'A citation URL must be https so that it cannot carry a script or be read in transit.',
  ),
);

/**
 * Which document a profile was read from, and when.
 *
 * The same four fields the conversion chart carries, and required for the same
 * reason: without them the tool shows a federation's rules without saying whose
 * they are or how old the reading is.
 */
export const MeetRuleSourceSchema = v.object({
  /** How the document names itself, e.g. "USPA Technical Rules". */
  label: Label,
  url: CitationUrl,

  /**
   * The revision as the document versions itself.
   *
   * A string because a federation numbers its rulebook however it likes -- a
   * year, an effective date, a version -- and this project does not get to impose
   * a scheme. Absent is the one thing it may not be.
   */
  revision: Identifier,

  /** The day a person last read these rules against that document. */
  verifiedOn: v.pipe(v.string(), v.isoDate()),
});

export type MeetRuleSource = v.InferOutput<typeof MeetRuleSourceSchema>;

/**
 * What the officials write down when the minute runs out.
 *
 * Two answers because the rule has two branches, and they are not symmetrical:
 * after a good lift the bar goes up by the increment whether the lifter wanted
 * that or not, and after a miss it stays where it is. A planner that showed only
 * one of them would be silent in exactly the case a lifter needs warning about --
 * a made opener and a coach who looked away.
 *
 * `repeat` and `increase-by-increment` are the only two behaviours the published
 * profiles use. A federation that does something else needs a code adding here
 * rather than a free-text field, so that the arithmetic in the domain has to be
 * taught the new behaviour instead of rendering a sentence over the old one.
 */
export const AutomaticAttemptBehaviourSchema = v.picklist([
  'repeat',
  'increase-by-increment',
] as const);

export type AutomaticAttemptBehaviour = v.InferOutput<typeof AutomaticAttemptBehaviourSchema>;

/**
 * When a lifter may still change an opener they have already declared.
 *
 * Both deadlines are here because both rulebooks state both, and which one
 * applies depends on whether the lifter is in the first group of the session.
 * The planner cannot know that reliably, so it shows the pair and says which is
 * which -- an aid that picked one would be guessing about a deadline.
 */
export const OpenerChangeSchema = v.object({
  /** Changes permitted per lift. Zero is a legal answer and must be modelled. */
  allowed: v.pipe(v.number(), v.integer(), v.minValue(0)),

  /** Minutes before that lift's first round, for a lifter in the first group. */
  firstGroupMinutesBefore: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),

  /** Attempts before the end of the previous group's last round, for later groups. */
  laterGroupAttemptsBefore: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0))),

  /** The deadline in the rulebook's own terms, for a screen to quote. */
  summary: Sentence,
});

/**
 * How many times a third attempt may be changed, and on what condition.
 *
 * Keyed by lift because the answer differs by lift in both published profiles:
 * the squat and the bench press are locked once submitted and the deadlift is
 * not. That asymmetry is the reason this is a list rather than one number, and
 * getting it wrong in the lenient direction would have the planner offering a
 * change the expeditor will refuse — in the round where there is no time to
 * recover.
 */
export const ThirdAttemptChangeSchema = v.object({
  lift: PlatformLiftSchema,
  allowed: v.pipe(v.number(), v.integer(), v.minValue(0)),

  /**
   * Whether a change lapses once the bar is loaded and the lifter called.
   *
   * Both profiles say so for the deadlift. It is a condition the application
   * cannot observe -- it does not know when the speaker called a name -- so it is
   * carried in order to be *said*, not in order to be enforced. A planner that
   * silently assumed the change was still available would be the reason somebody
   * walked to the expeditor and was turned away.
   */
  lapsesOnceCalledToLoadedBar: v.boolean(),

  /**
   * Whether a change may not go below the weight the preceding lifter just took.
   *
   * The rising bar, stated as a floor on a change. USPA states it; the IPF
   * rulebook states the rising-bar principle without attaching it to this rule,
   * so the flag is per profile rather than assumed.
   */
  notBelowPrecedingLifter: v.boolean(),
});

/**
 * The rules for an extra attempt at a record, or absence of the whole idea.
 *
 * Nullable at the profile level, because one of the two published federations
 * does not have fourth attempts at all. A profile with a fourth-attempt block
 * full of zeroes would render as "a fourth attempt you can never take", which is
 * a different and wrong statement.
 */
export const FourthAttemptSchema = v.object({
  /** Whether the third attempt must have been good. Both real profiles: yes. */
  requiresSuccessfulThird: v.boolean(),

  /** How close to the record the lifter must already be, if the profile says. */
  withinKilogramsOfRecord: v.nullable(PositiveKilograms),

  /** How far the attempt must exceed the record. */
  minimumExcessKilograms: PositiveKilograms,

  /** Whether an official must grant it before it may be taken. */
  requiresPermission: v.boolean(),

  /** Seconds to declare it, measured from the end of the third attempt. */
  submissionSeconds: v.pipe(v.number(), v.integer(), v.minValue(1)),

  /**
   * Everything the attempt does *not* count toward.
   *
   * Written as a list of what is excluded rather than five booleans, because the
   * screen shows this as a sentence and a list keeps the sentence in step with
   * the rule. An empty list is meaningful: a fourth attempt that counts.
   */
  excludedFrom: v.array(
    v.picklist(['total', 'placing', 'classification', 'team-points', 'best-lifter'] as const),
  ),

  /** Whether the lifter is checked before leaving the platform. */
  requiresPostLiftEquipmentCheck: v.boolean(),

  /** The conditions in the rulebook's own terms, for a screen to quote. */
  summary: Sentence,
});

/**
 * How a tie on total is resolved, in the order the rules apply it.
 *
 * An ordered list because it is a sequence of tests, and the tactical mode has to
 * be able to tell a lifter whether a tie favours them -- which is only answerable
 * from the *first* test that separates them.
 */
export const TieBreakStepSchema = v.picklist([
  /** The lighter lifter ranks above the heavier one. */
  'lighter-bodyweight',
  /** Both lifters are weighed again after the competition. */
  'reweigh',
  /** Whoever reached the total first takes precedence. */
  'first-to-total',
  /** The placing is declared a tie and nothing further separates them. */
  'declared-tie',
] as const);

export type TieBreakStep = v.InferOutput<typeof TieBreakStepSchema>;

/** Which contests a profile's single-lift adjustments apply to. */
export const MeetFormatSchema = v.picklist([
  'full-power',
  'push-pull',
  'bench-only',
  'deadlift-only',
] as const);

export type MeetFormat = v.InferOutput<typeof MeetFormatSchema>;

/**
 * A third-attempt allowance that only exists in a single-lift contest.
 *
 * Both rulebooks grant the deadlift's two changes to the third round of a
 * single-lift bench press, which is the one place a full-power rule and a
 * single-lift rule genuinely disagree. Modelled as an override list so that the
 * base rules stay the base rules -- flattening the two into one table would mean
 * a planner set to full power reading a bench-only allowance.
 */
export const FormatOverrideSchema = v.object({
  format: MeetFormatSchema,
  lift: PlatformLiftSchema,
  allowed: v.pipe(v.number(), v.integer(), v.minValue(0)),
  summary: Sentence,
});

export const MeetRuleProfileSchema = v.object({
  /** Stable identifier. Saved inside a lifter's meet document, so never renamed. */
  id: Identifier,
  label: Label,

  source: MeetRuleSourceSchema,

  /** Attempts on each lift before any record attempt. Three, in every real profile. */
  attemptsPerLift: v.pipe(v.number(), v.integer(), v.minValue(1)),

  /**
   * The multiple every loaded bar must be a whole number of.
   *
   * Distinct from `minimumProgressionKilograms` below, and the two are equal in
   * both published profiles -- which is exactly why they are separate fields.
   * They answer different questions ("may the bar be 101 kg?" against "may the
   * second attempt be 1 kg above the first?"), a record attempt breaks the
   * equality, and a single field would make the record rule unstatable.
   */
  barMultipleKilograms: PositiveKilograms,

  /** The smallest legal step between one attempt and the next. */
  minimumProgressionKilograms: PositiveKilograms,

  /**
   * The smallest legal step when the attempt is declared as a record attempt.
   *
   * Null where a profile does not relax the increment for records. Where it is
   * set it is smaller than the normal progression, which is the only reason the
   * field exists: a record attempt is the one time a lifter may ask for a weight
   * that is not on the normal ladder.
   */
  recordProgressionKilograms: v.nullable(PositiveKilograms),

  /** Seconds to submit the next attempt, from the end of the preceding one. */
  submissionSeconds: v.pipe(v.number(), v.integer(), v.minValue(1)),

  /** What happens when that runs out, after a good lift and after a miss. */
  automaticAfterGoodLift: AutomaticAttemptBehaviourSchema,
  automaticAfterMiss: AutomaticAttemptBehaviourSchema,

  /**
   * Whether an attempt may never be below a weight the lifter has already missed.
   *
   * Stated outright by one rulebook and implied by the other's round rules. It is
   * a floor the planner has to respect when a miss makes it want to recommend
   * going down, which is precisely the situation §13 says to reduce in.
   */
  forbidsAttemptBelowFailedWeight: v.boolean(),

  /** Whether the bar only rises within a round. */
  risingBar: v.boolean(),

  /**
   * Whether the published attempt-jump research was gathered under these rules.
   *
   * A fact about the rulebook that only a person reading it can settle, so it is
   * curated alongside the increments rather than derived. The domain grades its
   * jump advice as population-matched or general depending on it, and the
   * alternatives were both worse: hard-coding the answer in the browser makes
   * every profile "general", including the one the research actually describes,
   * and inferring it from the profile identifier puts a federation's name in
   * source, which §5.1 keeps out.
   *
   * Note what it is not. It does not say the research is *right* about a lifter
   * under these rules -- the ranges describe what is common in a population and
   * `RESEARCH_BASIS_NOTE` says so either way. It says only that the population
   * lifted under this rulebook, which is the difference between advice that is
   * matched and advice that is transferred.
   */
  attemptResearchPopulation: v.boolean(),

  openerChange: OpenerChangeSchema,

  /** Changes permitted to a second attempt. Zero in both published profiles. */
  secondAttemptChangesAllowed: v.pipe(v.number(), v.integer(), v.minValue(0)),

  thirdAttemptChanges: v.pipe(v.array(ThirdAttemptChangeSchema), v.minLength(1)),

  formatOverrides: v.array(FormatOverrideSchema),

  fourthAttempt: v.nullable(FourthAttemptSchema),

  tieBreak: v.pipe(v.array(TieBreakStepSchema), v.minLength(1)),

  /**
   * Notes a person wrote that belong with the profile.
   *
   * Not a dumping ground: this is where a rule that matters to a lifter but is
   * not arithmetic goes -- the compensatory rest after a loading error, the
   * announcement that reopens an opener change. Shown, never parsed.
   */
  notes: v.array(Sentence),
});

export type MeetRuleProfile = v.InferOutput<typeof MeetRuleProfileSchema>;

/**
 * Every verified profile, in one artifact.
 *
 * One file rather than one per federation, unlike records and classifications.
 * Those are sharded because a screen shows one lifter and the corpus is
 * megabytes; this is the opposite case on both counts. The planner's first screen
 * asks which federation the meet is under, so it needs the whole list before it
 * can draw a single control, and the whole list is a few kilobytes. Splitting it
 * would be a request per option on a form nobody has filled in yet.
 *
 * The custom profile is not in here. It is not published data -- it is whatever a
 * user typed for one meet, and it lives in that meet's document, labelled
 * unverified.
 */
export const MeetRuleBookSchema = v.object({
  profiles: v.pipe(v.array(MeetRuleProfileSchema), v.minLength(1)),
});

export type MeetRuleBook = v.InferOutput<typeof MeetRuleBookSchema>;
