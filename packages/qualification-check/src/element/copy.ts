// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { Lift, TestedOffering } from '@platform-toolkit/data-contracts';

import type { RegistrationAxis, TestedProposal } from '../core/registration.js';
import type {
  TypedResultForm,
  TypedResultProblem,
  TypedTestedAnswer,
} from '../core/typed-result.js';
import type { WindowProblemCode } from '../core/window.js';
import type {
  AgeReadingSupport,
  CategoryProposal,
  DisregardReason,
  MeetTiming,
  ReadingBasis,
  RegistrationLabels,
  SetAsideResult,
  UncheckableCondition,
  UngradedReason,
  UnreadableStandardReason,
} from '../types.js';

// Type-only, and therefore erased: this file is imported *by* that one, and a value
// import here would close the cycle at run time.
import type { StandardsStatus } from './ptk-standing-report.js';

/**
 * Every sentence this tool says, in one file.
 *
 * Here rather than inline for the reason tool 3 put its wording in one place, and
 * for one more that is particular to this tool: **section 29 forbids the screen
 * from ruling on eligibility, and that rule is enforced by vocabulary or it is not
 * enforced at all.** A verdict does not arrive as a boolean somebody adds; it
 * arrives as a word. "Qualified" instead of "reaches the standard", "ineligible"
 * instead of "the route names other federations", "eligible" anywhere at all --
 * each is one adjective, each reads as helpful, and each converts an arithmetic
 * result into a ruling the federation has not made.
 *
 * Collected here, the whole vocabulary can be read in one pass and the banned
 * words can be asserted against by a test rather than caught in review. Nothing in
 * this file interpolates a figure: numbers are formatted where they are rendered,
 * so a sentence cannot silently acquire a rounding rule.
 */

/** The lifts a report covers, in the order a scoresheet prints them. */
export const LIFT_LABELS: Readonly<Record<Lift, string>> = {
  squat: 'Squat',
  bench: 'Bench press',
  deadlift: 'Deadlift',
  total: 'Total',
};

/**
 * Why a lift carries no grade, said as a fact about a specific thing.
 *
 * Three sentences and not one, because the three have different owners. The first
 * is the lifter's own history and they know whether it is right; the second and
 * third are this project's data, and a lifter who reads either as "you have not
 * qualified" has been told something false about themselves. So each names what is
 * missing and whose it is.
 */
export const UNGRADED_REASONS: Readonly<Record<UngradedReason, string>> = {
  'no-result': 'No successful lift of this kind inside the window.',
  'no-standards':
    'This federation publishes no standards for this combination, so there is nothing to read the lift against.',
  'ambiguous-standards':
    'Two published tables cover this lifter equally closely and they do not agree. Neither is chosen here.',
};

/**
 * Why a result is listed but counted nowhere.
 *
 * One entry today, and a `Record` rather than a string for the same reason
 * `UNGRADED_REASONS` is one: the day a second reason is added, this stops
 * compiling instead of rendering the disqualification sentence for it.
 */
export const SET_ASIDE_REASONS: Readonly<Record<SetAsideResult['reason'], string>> = {
  disqualified: 'The meet struck this result, so no figure above counts it.',
};

/**
 * The sentences the standings screen says in its own voice.
 *
 * Each one exists because a reader would otherwise draw a wrong conclusion from a
 * true layout, and the wrong conclusion is named in the comment above it.
 */
export const REPORT_NOTES = {
  /**
   * Grades read under five answers look like facts about the lifter. They are
   * facts about the lifter *under those answers*, and the answers are editable.
   */
  registration:
    'Every grade below is read under these five answers. Change any of them and the grades change with them.',

  /**
   * A lifter whose heaviest number is a push/pull total will look for it, and its
   * absence from the total row reads as arithmetic that has gone wrong.
   */
  partialTotal:
    'Heavier than the total above, and deliberately not read against it: a total standard is the sum of three lifts, and this sum is not.',

  /** A blank grade reads as missing data rather than as a figure below the ladder. */
  belowFirstStandard: 'Under the first standard on this table.',

  /** A result silently dropped is a history the lifter cannot check from memory. */
  setAside: 'Listed here and counted in nothing above.',

  /** The one sentence that keeps the screen a reading rather than a ruling. */
  notARuling:
    "This is what your results come to against published standards. Whether a meet accepts an entry is the federation's decision and is not made here.",
} as const;

/**
 * What stands in for the grades while there are none to show, and why there are not.
 *
 * Keyed on every {@link StandardsStatus} except `ready`, so that a fourth status
 * added later stops this file compiling rather than rendering an empty panel under a
 * heading -- which is the shape that reads as "your category has no standards".
 *
 * Neither sentence says a lift failed to reach anything, because neither knows. The
 * distinction is the whole reason the status exists: a lifter told "no standards are
 * published for this combination" during a two-second fetch has been told something
 * false about their federation, and it is the kind of false a reader acts on.
 */
export const STANDARDS_STATUS_NOTES: Readonly<Record<Exclude<StandardsStatus, 'ready'>, string>> = {
  loading: "Reading this federation's published standards for this category.",
  failed:
    "This federation's published standards could not be read, so the lifts above are not measured against anything. Everything else on this page is unaffected.",
};

/**
 * The five questions an entry form asks, in the words an entry form asks them.
 *
 * A `Record` over {@link RegistrationAxis} rather than five constants, and that is
 * load-bearing twice over. It stops compiling the day a sixth axis is added, which
 * is the failure worth catching -- an axis with no question is a control the form
 * never draws and a registration that never resolves, and nothing else in the
 * package would say so. And because its keys are exactly the axes, it is also what
 * `fields.ts` narrows a `data-axis` string against, so the routing table and the
 * legends cannot drift apart into two lists that disagree.
 */
export const AXIS_QUESTIONS: Readonly<Record<RegistrationAxis, string>> = {
  sex: 'Sex',
  equipment: 'Equipment',
  'weight-class': 'Weight class',
  division: 'Division',
  tested: 'Drug tested',
};

/**
 * Why an axis was, or was not, filled in for the reader.
 *
 * The distinction `category-match.ts` is built around, said out loud on the screen.
 * A measured proposal came from arithmetic against a published boundary and is
 * safe to hand somebody; a spelled one came from two documents using the same word,
 * which is the case that is *actively wrong* for the most common entry in the
 * corpus -- one federation's Raw allows what another's does not. A reader who
 * cannot tell those two apart cannot tell which of the five answers to check.
 *
 * None of these interpolates the archive's own wording. The observed string is
 * rendered beside the sentence rather than inside it, so a catalogue label can
 * never arrive as part of a sentence this file claims to own.
 */
export const PROPOSAL_NOTES = {
  nothingRecorded: 'Your results record nothing under this heading, so nothing is filled in.',
  noMatch:
    "Nothing in this federation's catalogue is written the way your results are, so this one is yours to answer.",
  ambiguous:
    'More than one published category is written that way. Two of them cannot both be right and neither is chosen here.',
  measured:
    "Filled in by measuring your results against this federation's published boundaries. Change it if you entered differently.",
  spelled:
    'Your results and this federation use the same word here, which is not the same as meaning the same thing. Nothing is filled in for you.',
  unexplained: 'This one is yours to answer.',
} as const;

/** Which of {@link PROPOSAL_NOTES} covers one proposal. */
export function proposalNote(proposal: CategoryProposal<unknown>): string {
  const [only, ...rest] = proposal.candidates;
  if (only === undefined) {
    return proposal.observed === null ? PROPOSAL_NOTES.nothingRecorded : PROPOSAL_NOTES.noMatch;
  }
  if (rest.length > 0) return PROPOSAL_NOTES.ambiguous;

  switch (proposal.basis) {
    case 'measured':
      return PROPOSAL_NOTES.measured;
    case 'spelled':
      return PROPOSAL_NOTES.spelled;
    case 'none':
      // Unreachable today, stated rather than thrown. `fromCandidates` only
      // downgrades the basis to `none` when it refuses to propose, and it refuses
      // by keeping every candidate -- so a single candidate always carries the
      // basis it was matched on. If that ever stops being true, the sentence that
      // claims nothing is the one that stays honest.
      return PROPOSAL_NOTES.unexplained;
  }
}

/**
 * The drug-tested axis, which does not read like the other four.
 *
 * Its own two sentences rather than {@link PROPOSAL_NOTES}, because the absence
 * means something different here. A missing equipment category is a gap in a
 * catalogue; a blank drug-tested column is a meet the archive did not annotate,
 * and reading it as "untested" is how somebody arrives at a tested platform having
 * planned against the wrong standards.
 */
export const TESTED_NOTES = {
  unrecorded:
    'Your results record nothing either way, and a blank is not a no. Answer it from your own paperwork.',
  recorded: 'Taken from what your results record. Change it if you are entering a different meet.',
} as const;

/** Which of {@link TESTED_NOTES} covers one proposal. */
export function testedNote(proposal: TestedProposal): string {
  return proposal.observed === null ? TESTED_NOTES.unrecorded : TESTED_NOTES.recorded;
}

/**
 * Which reading of an approximate age reaches a division.
 *
 * Rendered only beside an approximate age. Every candidate of an exact age is
 * `either-reading` by construction, so printing the qualifier there would put the
 * word "either" against a number the archive was certain about -- which reads as
 * doubt the source did not express.
 */
export const AGE_READING_SUPPORT: Readonly<Record<AgeReadingSupport, string>> = {
  'either-reading': 'on either reading of the age',
  'younger-reading-only': 'only if you were the younger age',
  'older-reading-only': 'only if you were the older age',
};

/**
 * The sentences the registration form says in its own voice.
 *
 * Same rule as {@link REPORT_NOTES}: each one is here because a reader would
 * otherwise draw a wrong conclusion from a true screen, and the wrong conclusion
 * is named above it.
 */
export const ANSWER_NOTES = {
  /** Five controls with no preamble read as a profile. They are a table selector. */
  intro:
    'These five answers choose the table your results are read against. Change any of them and every grade changes with it.',

  /** A proposal with its source hidden is indistinguishable from an assertion. */
  observedPrefix: 'Your results record',

  /**
   * The one place this screen could quietly become a ruling. Eligibility for a
   * division is arithmetic; entering one is a decision, and section 29 is that the
   * tool does not make it.
   */
  divisionChoice:
    "Being eligible for a division is not the same as entering it. Somebody eligible for both a Masters division and the Open may enter either, and which standards they are read against follows that choice, so it is theirs to make and not this tool's.",

  /** An empty list under a heading reads as a failed read rather than as no age. */
  divisionsUnknownAge: 'No age is recorded, so every published division is offered.',

  /** Without the heading the divisions below read as the ones already chosen. */
  divisionsByAge: 'What the recorded ages admit:',

  /** The two classes disagreeing looks like a fault until this says it is not. */
  weightClassEntered:
    'Standards are published per class entered, so the entered class is the one filled in. Entering above a weigh-in is allowed and common.',

  /** Named, because it is the figure the entered class should be checked against. */
  weightClassWeighed: 'The recorded bodyweight makes',

  /**
   * An empty picker that is this screen's fault, said so rather than blamed upwards.
   *
   * Weight classes are published one ladder per sex, so this control genuinely has
   * nothing to offer until the first question is answered. The alternative wording --
   * that the federation publishes no classes -- is a statement about the federation,
   * it is false, and it sends the reader to look for a data problem that is not there.
   */
  weightClassNeedsSex:
    'Weight classes are published per sex. Answer the sex question and they appear here.',

  /** A form with a blank in it and no list of blanks is a form nobody finishes. */
  stillToAnswer: 'Still to answer:',

  /** No answer, and none proposed either -- so the placeholder means what it says. */
  placeholderUnanswered: 'Not answered',

  /**
   * An axis with a proposal cannot be emptied, and the placeholder has to say so.
   *
   * Clearing removes the reader's own answer, and what is underneath is the
   * proposal, not a blank -- so the control repaints with a value in it. Labelled
   * "Not answered" that reads as a control refusing to clear; labelled this, it
   * reads as the undo it is.
   */
  placeholderRevert: 'Back to what your results say',
} as const;

/**
 * The fields of a typed-in result whose answer is a string.
 *
 * Derived from {@link TypedResultForm} rather than listed, so the two that are not
 * strings are excluded by the compiler and a field added to the form arrives here
 * without anybody remembering to add it. What that buys is the error below: a new
 * field with no label stops the build, rather than becoming a control the form
 * never draws.
 */
export type TypedResultTextField = Exclude<keyof TypedResultForm, 'tested' | 'ageApproximate'>;

/**
 * What each field of the result form asks for.
 *
 * Several of these say "as the sheet prints it", and that phrasing is the whole
 * point rather than a flourish. `history.ts` matches a federation name and an
 * equipment word by folding the string, so what is wanted is the meet's own
 * spelling and not the lifter's improvement on it -- somebody who types "raw with
 * wraps" where the sheet says "Wraps" has quietly changed which ladder their squat
 * is read against, and nothing on the screen would say so.
 *
 * A `Record` over the union, so a field added to the form fails to compile here.
 * Its keys are also what `fields.ts` narrows a `data-field` string against, which is
 * what keeps the routing table and the labels from becoming two lists.
 */
export const RESULT_FIELD_LABELS: Readonly<Record<TypedResultTextField, string>> = {
  date: 'Date of the meet',
  meetName: 'Meet name',
  federation: 'Sanctioning federation',
  parentFederation: 'Parent body',
  sex: 'Sex, as the sheet prints it',
  equipment: 'Equipment, as the sheet prints it',
  division: 'Division entered',
  ageClass: 'Age division printed',
  ageYears: 'Age on the day',
  bodyweightKg: 'Bodyweight at weigh-in',
  weightClassKg: 'Weight class entered',
  squatKg: 'Squat',
  benchKg: 'Bench press',
  deadliftKg: 'Deadlift',
};

/**
 * The help under a field, where the obvious answer is the wrong one.
 *
 * Partial and deliberately short. A hint under every control is a hint under none:
 * the eye stops reading them, and the four that matter are the four that change what
 * the arithmetic does.
 */
export const RESULT_FIELD_HINTS: Readonly<Partial<Record<TypedResultTextField, string>>> = {
  federation:
    'Spelled the way the results sheet spells it. A qualifying route that names the federations it accepts is matched on this.',
  parentFederation:
    'Leave blank unless the sheet names one. A route naming the parent body will otherwise set the result aside.',
  equipment: 'The words the sheet uses, not the category you would pick here.',
  weightClassKg: 'As printed: 90, 82.5, 90+.',
  squatKg: 'Best of three. Leave a lift blank if it was missed or not contested.',
};

/** The three answers to drug testing, in the three states the data actually has. */
export const TESTED_ANSWERS: Readonly<Record<TypedTestedAnswer, string>> = {
  tested: 'Drug tested',
  untested: 'Not tested',
  unstated: 'Not stated',
};

/**
 * The sentences the result form and the list of results say in their own voice.
 *
 * Same rule as the two above: each is here because a reader would otherwise draw a
 * wrong conclusion from a true screen.
 */
export const RESULT_LOG_NOTES = {
  /** Without this a blank form reads as a requirement rather than as one route in. */
  intro:
    'Type a meet result the way its results sheet reads. One result is enough to see where you stand; add more and the best of each lift is taken across all of them.',

  /** Nothing on screen otherwise says the typed route is as complete as the import. */
  parity:
    'A result typed here is read exactly the way an imported one is. Nothing about it is treated as second-hand.',

  /** A list with no results in it reads as a failed load rather than as a start. */
  empty: 'No results yet.',

  /** A struck result cannot be typed, and somebody will look for the control. */
  noPlace:
    'There is no field for a placing. A result the meet struck is one to leave out, because nothing above counts it either way.',

  /** Results kept only in the tab reads as data loss unless it is said first. */
  notSaved: 'These stay in this tab and are not saved anywhere. Closing it clears them.',

  /** A three-lift total is derived, and a lifter will look for somewhere to type it. */
  totalDerived: 'The total is added up from the lifts, so there is nothing to type.',

  /** A form that refuses without saying which control is a form nobody finishes. */
  problems: 'This result is not recorded yet:',

  /** Removing is the only way to correct a typo, and it needs to look reversible. */
  remove: 'Remove',
} as const;

/** Why one result was left out of the figures a route is read on. */
export const DISREGARD_REASONS: Readonly<Record<DisregardReason, string>> = {
  'outside-the-route-window': "Set outside this route's own qualifying window.",
  'federation-not-named':
    'This route names the federations whose meets count, and this is not one.',
  'meet-not-drug-tested':
    'This route asks for a tested meet, and the archive records this one as untested.',
  'drug-testing-unrecorded':
    'This route asks for a tested meet, and the archive records nothing either way. Your own paperwork may settle it.',
};

/** Why one reading of a route's named standard produced nothing. */
export const UNREADABLE_STANDARD_REASONS: Readonly<Record<UnreadableStandardReason, string>> = {
  'no-standards': 'No published table covers this registration and this lift.',
  'ambiguous-standards': 'Two equally specific tables cover it and they are different ladders.',
  'standard-not-published':
    'The covering table publishes nothing under the standard this route names. That is a gap in the transcribed data, not a statement about the lifter.',
  'open-division-unknown':
    'This route reads out of the Open table, and the catalogue does not identify a single Open division.',
};

/**
 * Which table a route's standard was read out of.
 *
 * The distinction the criteria themselves are often silent about, and the reason
 * `RouteOutcome` has a `two-readings` arm at all: the same total is an Elite total
 * in one table and short of it in the other, and for a Masters lifter that gap is
 * their whole entry. So the basis is printed on every reading, including the easy
 * ones -- a line that appears only when there is a problem is a line nobody has
 * learned to read by the time there is one.
 */
export const READING_BASIS: Readonly<Record<ReadingBasis, string>> = {
  open: 'Read from the Open table.',
  'lifters-age-division': "Read from your own division's table.",
  'either-table': 'The Open table and your own division give the same answer here.',
};

/** Which competition a meet sanctions. */
export const TESTED_OFFERING: Readonly<Record<TestedOffering, string>> = {
  tested: 'Drug tested only',
  untested: 'Untested only',
  both: 'Both drug tested and untested',
};

/**
 * The sentences the meet screen says in its own voice.
 *
 * The vocabulary rule at the top of this file is at its tightest here, because this
 * is the screen a lifter is on while deciding whether to pay an entry fee. Every
 * sentence below is about a published figure or a published sentence. None of them
 * is about whether the lifter may enter.
 */
export const MEET_NOTES = {
  /** A screen of criteria with no framing reads as a decision the tool has made. */
  intro:
    "What this meet's announcement asks for, read against your results. Whether you may enter is the meet's decision.",

  /** Routes are alternatives, and a reader will otherwise total them up. */
  routesAreAlternatives:
    'These are alternatives. The published criteria are met by any one of them.',

  /** Without this, a meet offering both competitions looks like it offers neither. */
  offersThisEntry: 'This meet sanctions the competition you answered for.',

  /**
   * The one place a true fact could be read as a refusal.
   *
   * The routes below are still shown, because somebody reading this may still be
   * choosing a platform -- so the sentence has to say what is true of the sanction
   * without reading as "and therefore stop here".
   */
  offersOtherEntry:
    'This meet does not sanction the competition you answered for. The routes below are shown so you can see what the other one asks.',

  /** A meet with no total to reach reads as an unread meet unless this says so. */
  entryOpenHeading: 'No qualifying total',

  /**
   * The state that must never look like the one above.
   *
   * "This meet requires no qualifying total" and "nobody has transcribed this
   * meet's criteria" are opposite facts, and the wrong one rendered sends a lifter
   * to a national championship on the strength of a gap in a repository.
   */
  entryUnstatedHeading: 'Not transcribed',

  /** Conditions decide entry and none of them is arithmetic. */
  conditionsHeading: 'Conditions no figure settles',

  /** A result excluded silently is a result a lifter cannot argue about. */
  disregardedHeading: 'Not read on this route:',

  /** A route with no figure looks like a fault rather than an empty window. */
  noResultInWindow:
    "No three-lift total inside this route's own dates survived what it asks of a qualifying meet.",

  /** Where the words came from, so a lifter can take it up with the document. */
  quotationHeading: 'The announcement says:',

  /** A disputed route is the one case where this project cannot pick a reading. */
  disputeHeading: 'The document states this two ways:',

  /** A threshold with no arithmetic beside it reads as a broken calculation. */
  pointsNotComputed:
    'This route asks for a coefficient score, which is a claim about the scoring system as much as about the lifter. The threshold and your figures are printed so you can do the arithmetic the meet will do.',

  /** A bracket admitting one standard and not the ones above it is genuinely odd. */
  aboveTheBracket:
    'This route names one standard and does not admit the ones above it, so a bigger total does not answer it.',

  /** Which competition the route is for, where it is not this one. */
  routeOpensTested: 'This route is for the drug-tested competition.',
  routeOpensUntested: 'This route is for the untested competition.',

  /** The window is per route, and a reader will assume it is per meet. */
  windowHeading: 'Set between',

  /** The federations a route accepts are matched on spelling, which is worth saying. */
  federationsHeading: 'Meets that count:',

  /** Territory is published and shown, never matched. Saying so prevents a bug report. */
  territoryHeading: 'Held in:',
} as const;

/** Where a meet sits relative to today. */
export const MEET_TIMING: Readonly<Record<MeetTiming, string>> = {
  'entry-open': 'Entry open',
  'entry-closed': 'Entry closed',
  'in-progress': 'Being held',
  held: 'Held',
};

/** Who states a condition no arithmetic can settle. */
export const CONDITION_SOURCE: Readonly<Record<UncheckableCondition['from'], string>> = {
  meet: 'This meet',
  federation: 'Federation rules',
};

/**
 * The words the whole screen is framed in.
 *
 * Gathered here rather than spelled into the root element for the reason every
 * other record in this file is: the sentence that keeps this tool a reading rather
 * than a ruling (section 29) has to be checkable in one pass, and it cannot be if
 * it is scattered through five templates. Anybody auditing the tool's language reads
 * this file and nothing else.
 */
export const CHECK_NOTES = {
  intro:
    'What your competition results come to, read against what a federation publishes. Nothing here decides whether you may enter a meet.',

  resultsHeading: 'Your results',

  windowHeading: 'Dates to read',
  windowNote:
    'Leave both blank to read everything. A meet that asks for a total set inside its own dates applies those as well, on top of these.',
  windowFrom: 'From',
  windowTo: 'To',

  standingHeading: 'Which of your registrations',
  /**
   * Several standings is the normal case and not an edge one.
   *
   * A lifter who moved up a class, or lifted once tested and once not, has two
   * histories and they grade differently. Picking one for them would answer the
   * question this tool is meant to ask.
   */
  standingNote:
    'Your results split by how they were registered. A class change or a meet with different testing makes a separate one, and each reads differently.',
  standingEmpty:
    'No results inside those dates yet. Type one in above, or widen the dates if you have already.',

  answersHeading: 'How this federation would register you',

  meetHeading: 'A meet',
  meetNote:
    'Pick one to read its published criteria as well. Leave it unpicked and the standards below are all that is read.',
  meetLabel: 'Meet',
  meetNone: 'No meet',
  meetEmpty: 'No meets have been transcribed for this federation yet.',
  meetNotFound:
    'That meet is not in the published book. It may have been removed since this page loaded.',

  /**
   * The catalogue is what every identifier on this screen is keyed on, so its
   * absence is not a partial screen -- it is no screen. Named as a data gap rather
   * than as a fault of the lifter's.
   */
  noVocabulary:
    "This federation's categories have not been published, so there is nothing to read your results against.",
} as const;

/** What is wrong with one field of a typed-in result. */
export function typedResultProblem(problem: TypedResultProblem): string {
  switch (problem.code) {
    case 'missing':
      return 'Needed before this result can be recorded.';
    case 'unreadable-date':
      return 'Give the day as a date. A day that does not exist in its month is refused.';
    case 'unreadable-number':
      return 'Give a weight in kilograms, using a full stop for the decimal point.';
    case 'not-above-zero':
      // Named rather than merely refused. A nought here is almost always somebody
      // recording a miss, and "must be above zero" leaves them retyping it.
      return 'A lift that was missed is a blank field, not a nought.';
    case 'not-a-whole-number':
      return 'Whole years. Tick the box below if the archive only narrows it to two.';
    case 'no-lift':
      return 'Give at least one of the squat, bench press or deadlift.';
  }
}

/** What is wrong with a pair of dates. */
export const WINDOW_PROBLEMS: Readonly<Record<WindowProblemCode, string>> = {
  'from-unreadable': 'Give the first day as a date, or leave it blank.',
  'to-unreadable': 'Give the last day as a date, or leave it blank.',
  inverted: 'The last day is before the first, so nothing can fall between them.',
};

/**
 * One registration, in the archive's own words, on one line.
 *
 * Every part of it is printed, including the parts the archive left blank, because
 * this is the label a reader picks *between* -- two of a lifter's standings can
 * differ on nothing but the division, and a label that dropped an absent division
 * would render the two identically and leave somebody choosing at random.
 */
export function observedRegistrationLabel(registration: RegistrationLabels): string {
  const division = registration.division ?? registration.ageClass ?? 'No division recorded';
  const weightClass =
    registration.weightClassKg === null ? 'No class recorded' : `${registration.weightClassKg} kg`;
  return [
    registration.sex,
    registration.equipment,
    weightClass,
    division,
    testedLabel(registration.tested),
  ].join(' · ');
}

/**
 * Drug-tested status, in the three states the data actually has.
 *
 * The middle one is the whole reason this is a function and not a boolean cast.
 * A meet the archive says nothing about is not an untested meet, and a screen that
 * printed "Untested" for it would put a lifter on the wrong platform on the
 * strength of a blank column.
 */
export function testedLabel(tested: boolean | null): string {
  if (tested === null) return 'Not recorded either way';
  return tested ? 'Drug tested' : 'Not drug tested';
}

/**
 * An age, keeping the uncertainty the archive recorded it with.
 *
 * An approximate age is rendered as both readings rather than as the lower one
 * with a qualifier, because the two readings are often two divisions -- an
 * approximate 39 is a Submaster or an Open lifter -- and a reader scanning for
 * their own division needs to see the one they are looking for.
 */
export function ageLabel(years: number, approximate: boolean): string {
  return approximate ? `${String(years)} or ${String(years + 1)}` : String(years);
}
