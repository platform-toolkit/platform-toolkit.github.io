// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Training Logbook.
 *
 * Plan a session, log what was actually lifted, and keep the record on the
 * device that recorded it. There is no account, no server and no sync: the data
 * lives in the browser's own storage, and the way it leaves is a JSON file the
 * lifter downloads.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not tell anybody what to lift next. Sections 15.3 and 16.1 draw that
 * line and this package holds it: a missed set is recorded and not scored, an RPE
 * is stored and not interpreted, and nothing here derives a programme from a
 * history. Prescribing is a different tool, and a logbook that quietly started
 * coaching would be giving advice nobody asked it for and nobody can see the
 * basis of.
 *
 * ENTRY POINTS
 *
 * - `.` -- this file: the core plus the vocabulary.
 * - `./core` -- the pure rules. No Lit, no DOM, no storage, no clock.
 * - `./element` -- the Lit elements and `defineTrainingLogbook()`.
 * - `./handoff` -- the warm-up calculator's record and the storage key it
 *   travels in. Its own entry point rather than a corner of `./core`, because
 *   the tool that writes a handoff is not this one and has no use for the rest
 *   of the package; see the file's header.
 * - `./storage` -- the repository port, an IndexedDB adapter, and an in-memory
 *   one. The only part of the package that touches a database.
 * - `./types` -- the persisted vocabulary, importable on its own by a consumer
 *   that only needs to read a backup file.
 *
 * Nothing above `./core` may hold storage or transport, and `./core` is the
 * boundary a review checks.
 *
 * This file re-exports `./core` and `./types` and deliberately stops there.
 * Pulling `./storage` in as well would put IndexedDB into the module graph of a
 * consumer that only wanted to score a session in a script, and the two entry
 * points exist precisely so that does not happen.
 */

export * from './core/index.js';
export type * from './types.js';
