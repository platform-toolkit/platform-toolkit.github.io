// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * The vocabulary this tool answers in.
 *
 * Four names, and they are here rather than in the module that uses them most
 * because each one is spoken on both sides of the package boundary. A host page
 * seeds a `CategorySelection` and hands back a `PartitionRead` keyed by
 * `RecordPartition`; it stores and restores a `TargetType`. None of that should
 * require naming the module that happens to compute with them, and a consumer
 * that only wants to describe a lifter's category should not have to import the
 * catalogue reader to do it.
 *
 * `TargetType` in particular was declared inside `ptk-target-report` and read by
 * `session`, which is a core module importing an element -- backwards, and only
 * invisible while the two lived in one directory.
 *
 * Everything else stays where it is computed. The statuses (`CatalogStatus`,
 * `StandardsStatus`, `RecordsStatus`) belong to the elements that report them,
 * and the published shapes -- catalogues, record books, standards tables --
 * belong to `@platform-toolkit/data-contracts`, which is where a second tool
 * reading the same artifacts would look for them.
 */

/** Every answer the screen collects. */
export type SelectionField =
  'sex' | 'equipment' | 'weightClass' | 'comparisonWeightClass' | 'division' | 'tested' | 'region';

/** What the lifter has chosen so far. `null` is "not answered yet". */
export type CategorySelection = Readonly<Record<SelectionField, string | null>>;

/**
 * One published records artifact, named for the report.
 *
 * `regionId: null` means the level is not subdivided, which is a settled answer
 * -- there is one national record, not one per state. It never means "the region
 * question has not been answered yet": a level that *is* subdivided simply
 * produces no partition until a region is chosen. Collapsing the two would ask
 * for the artifact of a subdivided level's unsubdivided records, and the read
 * would succeed, return nothing, and be rendered as a federation that publishes
 * no records for the category -- a sentence nobody investigates.
 */
export interface RecordPartition {
  readonly levelId: string;
  readonly regionId: string | null;
  /** How the report names this set of records. */
  readonly label: string;
}

/** Which family of targets is on screen. */
export type TargetType = 'classifications' | 'records';
