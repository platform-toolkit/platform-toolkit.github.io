// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import * as v from 'valibot';

/**
 * The address of one published record table, built from the three identifiers
 * that name it.
 *
 * WHY A TEMPLATE IN THE MAPPING RATHER THAN A STRING IN THE CODE
 *
 * A lifter reading a figure they intend to beat wants to see it where the
 * federation publishes it -- who set it, at which meet, and whether the page has
 * moved on since this build read it. The address of that page is a fact about one
 * federation's website, which §5.1 puts in the curated document rather than in a
 * module.
 *
 * The same template is what the crawler fetches. That is the point of it being
 * one value: a template that had drifted out of step with the crawler would
 * publish a link per record to a page that does not exist, and nothing in a build
 * would notice, because a build never follows it. Sharing it means a mistake
 * fails the crawl instead -- loudly, on the first table.
 *
 * WHY THREE NAMED PLACEHOLDERS AND NOT A FORMAT STRING
 *
 * The substitution below is the narrowest thing that does the job. Every value
 * is percent-encoded, so a curated identifier cannot add a query parameter or a
 * path segment, and the template is checked to contain exactly these three
 * placeholders and no others -- a fourth would be a name nothing here can supply,
 * and would survive into the URL as literal braces.
 */

/** What one table is named by, in the federation's own vocabulary. */
export interface RecordTableTargetNames {
  readonly location: string;
  readonly status: string;
  readonly event: string;
}

/** The placeholders a template must use, and may only use. */
const PLACEHOLDERS = ['location', 'status', 'event'] as const;

/** Every `{...}` in a template, whether or not this file knows the name. */
const PLACEHOLDER_PATTERN = /\{([^{}]*)\}/gu;

/**
 * A URL with `{location}`, `{status}` and `{event}` standing in for the three
 * identifiers.
 *
 * Checked before the placeholders are filled, and checked again as a URL after --
 * the first catches a template nobody can use, the second catches a template that
 * is only a URL for some identifiers.
 */
export const RecordTableUrlTemplateSchema = v.pipe(
  v.string(),
  v.check((value) => value.startsWith('https://'), 'an https URL template'),
  v.check((value) => {
    const parsed = URL.parse(value.replaceAll(PLACEHOLDER_PATTERN, 'x'));
    return parsed !== null && parsed.username === '' && parsed.password === '';
  }, 'a URL template with no embedded credentials'),
  v.check(
    (value) => {
      const used = [...value.matchAll(PLACEHOLDER_PATTERN)].map(([, name]) => name);
      return (
        used.length === PLACEHOLDERS.length &&
        PLACEHOLDERS.every((name) => used.filter((candidate) => candidate === name).length === 1)
      );
    },
    `a URL template using each of {${PLACEHOLDERS.join('}, {')}} exactly once`,
  ),
);

/**
 * Fills a template in.
 *
 * @throws {TypeError} if the result is not a URL. A template that passed the
 *   schema and an identifier that is a plain word cannot produce one, so this
 *   fires only when something upstream stopped being either.
 */
export function buildRecordTableUrl(template: string, target: RecordTableTargetNames): string {
  const filled = template.replaceAll(PLACEHOLDER_PATTERN, (whole, name: string) => {
    switch (name) {
      case 'location':
        return encodeURIComponent(target.location);
      case 'status':
        return encodeURIComponent(target.status);
      case 'event':
        return encodeURIComponent(target.event);
      default:
        // Unreachable through the schema, and left as the literal text rather
        // than as an empty string: a placeholder silently erased would produce a
        // plausible URL for the wrong table.
        return whole;
    }
  });

  const parsed = URL.parse(filled);
  if (parsed === null) {
    throw new TypeError(
      `Record table template did not produce a URL for ${target.location}/${target.status}/${target.event}`,
    );
  }
  return parsed.href;
}
