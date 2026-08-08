// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * How long a browser-mode test waits on a real database before giving up.
 *
 * Shared by the three element suites that mount against a real IndexedDB rather than
 * a fake, because the number is a statement about the machine and not about any one
 * of them.
 */

/**
 * The budget for a wait that ends when storage answers.
 *
 * `vi.waitFor` defaults to one second, which is about a hundred times a real write on
 * an idle laptop and not enough on a loaded one. It ran out during a fresh-clone gate
 * on 2026-08-07 -- `expected 'Saving' not to be 'Saving'`, a save that was proceeding
 * normally in a Chromium sharing the machine with the rest of a 196-file run -- so it
 * became five seconds. It ran out again the same evening, on the same assertion, in
 * another fresh-clone gate, at load 140.
 *
 * Twenty seconds now, and the second raise is the interesting one, because five was
 * already chosen against a loaded machine and the machine simply got louder. There is
 * no number here that is right about the hardware; the only defensible number is one
 * large enough that reaching it means something is wedged rather than busy. It costs
 * nothing on a passing run -- a wait that succeeds returns as soon as the condition
 * holds, so this is only ever spent by a test that was going to fail anyway -- and the
 * whole price is that a genuinely wedged write is reported twenty seconds later.
 *
 * Do not reach for this to paper over a wait on something that is not storage. A render
 * settles on a microtask; if one of those needs seconds, the element is wrong.
 */
export const STORAGE_WAIT = { timeout: 20_000 } as const;
