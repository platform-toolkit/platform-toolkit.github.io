// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Values substituted at build time by `define` in vite.config.ts.
 *
 * Declared as globals rather than added to `ImportMetaEnv`, because
 * `import.meta.env` is populated by prefix and this project deliberately does
 * not enable an env prefix -- see the note beside `define`.
 */

/**
 * Absolute or root-relative URL of the published data, always ending in `/`.
 *
 * Same-origin by default; an https origin when `PTK_DATA_ORIGIN` is set, which
 * is also what widens `connect-src`.
 */
declare const __PTK_DATA_BASE_URL__: string;
