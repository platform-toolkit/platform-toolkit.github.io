// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Turning source identifiers into artifact names.
 *
 * Not exported from the package. Callers get purpose-named functions --
 * `recordArtifactId`, `categoryCatalogArtifactId` -- because an artifact name is
 * a contract between the publisher and the browser, and a generic slug helper on
 * the public surface invites someone to build a name by hand somewhere the two
 * sides cannot be kept in step.
 */

/**
 * Reduces a source identifier to the character set an artifact name allows, or
 * `null` if nothing survives.
 *
 * `toLowerCase` rather than `toLocaleLowerCase`: the same corpus must produce the
 * same filenames on a build machine in any locale, and the Turkish dotless i
 * would otherwise make that untrue.
 *
 * Lossy, deliberately -- the alternative is an escaping scheme nobody can read
 * in a directory listing. Two identifiers can therefore reduce to one name, so
 * anything that publishes a set has to check for collisions across it.
 */
export function slugSegment(value: string): string | null {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? null : slug;
}
