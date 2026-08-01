/**
 * Which federation's rules a page is showing.
 *
 * Every question this collection asks has a different answer per federation:
 * what raw means, where the class boundaries fall, whether age is read on the
 * meet date or across the calendar year. So a page is always *a federation's*
 * page, and the federation has to come from somewhere.
 *
 * It comes from the page's own markup, as an attribute on the mount point. Three
 * alternatives were available and each is worse:
 *
 *   - A constant in the view. That is what this replaces. It reads as correct
 *     while one federation is published and is wrong the moment a second is,
 *     with no compiler complaint at the changeover.
 *   - A query parameter. An embedding site could then switch which rules a
 *     reader is looking at without the URL they were given changing, and every
 *     federation would share one cache entry.
 *   - Parsing the path. The embed route happens to end in the federation today,
 *     and the standalone route does not; a parser would have to encode that
 *     asymmetry and would guess wrongly the first time the routes change shape.
 *
 * An attribute makes publishing a second federation a matter of adding pages,
 * which is what it actually is, and keeps `window.location` out of everything
 * below the page entry -- see the note about a native shell in the project
 * notes. The entry reads the attribute; this file decides whether it is usable.
 */

/** The attribute a page declares its federation in. */
export const FEDERATION_ATTRIBUTE = 'data-federation';

/**
 * The character set an identifier may use.
 *
 * The same one the published artifact index keys are held to. A federation
 * identifier is part of an artifact name, so an identifier this rejects is one
 * that could never have named a published file -- catching it here turns it into
 * an error naming the page, rather than a lookup that finds nothing and renders
 * as "this federation's categories have not been published yet". That message is
 * a legitimate answer, which is exactly why a typo must not be able to produce
 * it: nobody investigates an answer.
 */
const IDENTIFIER = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Reads a declared federation identifier, or explains what the page got wrong.
 *
 * Takes the attribute value rather than the element so that it stays a pure
 * function with nothing to mock. The entry does the one line of DOM access.
 *
 * @throws {Error} if the attribute is absent, empty, or not an identifier.
 */
export function parseFederationId(declared: string | null): string {
  if (declared === null) {
    throw new Error(
      `This page does not say which federation it is for: add ${FEDERATION_ATTRIBUTE} to the mount point.`,
    );
  }
  // Trimmed before the test, not as part of it: an attribute written across two
  // lines in the HTML is a formatting choice, and failing on it would be a
  // puzzle rather than a fault.
  const federationId = declared.trim();
  if (!IDENTIFIER.test(federationId)) {
    throw new Error(
      `${FEDERATION_ATTRIBUTE}="${declared}" is not a federation identifier: expected lowercase letters, digits, and hyphens.`,
    );
  }
  return federationId;
}
