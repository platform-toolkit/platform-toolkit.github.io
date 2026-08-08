// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The pure core of Platform Targets.
 *
 * No Lit, no DOM, no storage, no network, and no clock -- section 15's first
 * requirement for a tool package. The `PreferenceStore` the session module names
 * is a *port*, handed in by the caller: this half decides what may be remembered
 * and reads and writes it through whatever the host supplies, so a run in bare
 * Node covers the same code the browser runs. Nothing here reaches for
 * `localStorage`, and nothing here fetches: the published catalogue, records and
 * standards all arrive as arguments, which is why the transport stayed in the
 * shell (§5.1).
 *
 * `selection.ts` is here despite importing `@platform-toolkit/ui`, and that is a
 * deliberate exception rather than an oversight. The two names it takes --
 * `Choice` and `SelectOption` -- are plain data interfaces, `import type` only,
 * erased at emit; no Lit surface and no registry write follows them. The
 * alternative was pushing it into `src/element/`, which would have taken the
 * other six modules with it, since every one of them computes from a
 * `CategorySelection`. A core that cannot say what the tool asks is not a core.
 * The rule the boundary actually enforces is the one above: what may be reached
 * at runtime.
 */

export {
  REFRESH_REQUEST_EVENT,
  categoryPhrase,
  readFreshness,
  type Connection,
  type DataMetaStatus,
  type Freshness,
  type FreshnessInput,
  type FreshnessTone,
} from './freshness.js';

export {
  GOALS_PREFERENCE,
  GOAL_ATTEMPTS,
  GOAL_KINDS,
  GOAL_TAGS,
  GOAL_TAG_LABELS,
  MAX_GOALS,
  addGoal,
  describeGoal,
  goalKey,
  loadGoals,
  removeGoal,
  saveGoals,
  tagGoal,
  type AddGoalOutcome,
  type Goal,
  type GoalAttempt,
  type GoalDescription,
  type GoalKind,
  type GoalTag,
  type GoalTarget,
  type GoalVocabulary,
} from './goals.js';

export {
  TARGET_LABELS,
  recordCategoryFrom,
  recordFigure,
  recordSummary,
  recordTargetLines,
  resolveRecordStandings,
  type LiftRecord,
  type LiftRecordStanding,
  type RecordCategory,
  type RecordTargetLine,
  type TargetBasis,
} from './record-standings.js';

export {
  NOT_PUBLISHED,
  NO_RECORD_YET,
  buildReport,
  figuresFor,
  nextIn,
  reachedIn,
  type Figures,
  type LiftTargets,
  type Matrix,
  type MatrixCell,
  type MatrixRow,
  type RecordAttempt,
  type RecordDetail,
  type RecordDisagreement,
  type RecordHolder,
  type Report,
  type ReportInput,
  type TargetGroup,
} from './report.js';

export {
  NO_SELECTION,
  REQUIRED_FIELDS,
  TESTED_VALUES,
  contextSummary,
  partitionKey,
  resolveSelection,
  testedFlag,
  type ContextSummary,
  type OpenDivisionProblem,
  type ResolvedSelection,
  type SelectionPicker,
  type SelectionQuestion,
  type TestedValue,
} from './selection.js';

export {
  TARGETS_PREFERENCES,
  forgetContext,
  loadSettings,
  saveContext,
  saveView,
  type TargetsSettings,
} from './session.js';

export {
  LIFTS,
  LIFT_LABELS,
  NO_ENTRIES,
  amountAsUnit,
  formatAsUnit,
  formatKilograms,
  lifterAxesFrom,
  lifterCategoryFor,
  readLiftEntries,
  resolveStandards,
  setEntryUnit,
  typeLift,
  type LiftEntries,
  type LiftEntry,
  type LiftField,
  type LiftStandards,
  type LiftStanding,
  type LifterAxes,
  type LifterCategory,
} from './standards.js';
