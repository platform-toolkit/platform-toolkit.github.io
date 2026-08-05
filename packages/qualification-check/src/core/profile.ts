// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * What to search a results archive for, read out of whatever somebody pasted.
 *
 * The brief's second way in is a date range plus "an openpowerlifting profile or
 * URL". Both arrive through one field, because a reader who has their profile open
 * pastes the address bar and a reader who does not types a name -- and asking which
 * of the two they are about to do is a question with no consequence they can see.
 *
 * NOTHING HERE FETCHES THE LINK, AND NOTHING MAY
 *
 * Section 2.3: a URL a visitor supplies is never fetched and never proxied. What a
 * link is worth to this tool is the last segment of its path, and the reason that is
 * enough is a property of the archive's own index rather than a guess. Lookup keys
 * are folded with `athleteLookupKey`, which strips case, accents and every character
 * that is not a letter or a digit -- so `John Doe #1` and `johndoe1` fold to one key,
 * and a profile slug is simply a search term that happens to be spelled without
 * spaces. Reading it therefore costs a string operation, and the address itself goes
 * nowhere: not to a network, not to a log, not into an error, not to an embedding
 * parent.
 *
 * WHY THE READING IS HANDED BACK RATHER THAN USED
 *
 * The result says which of the two the input was taken as, so a screen can print the
 * term it is about to search for. Without that, a reader who pasted a link to the
 * wrong page -- a meet, a records table, the archive's front door -- gets "nobody by
 * that name" for an address that plainly names somebody, and has no way to see that
 * the tool read `results` out of it. Section 7: the uncertainty rule applies to the
 * input as much as to the answer.
 *
 * NO NORMALISING HAPPENS HERE
 *
 * The term is handed on as it was written, minus surrounding space. `findAthletes`
 * takes what a person wrote and folds it on the archive's own terms; a caller that
 * folded first would be a caller that breaks the day the indexing changes, and the
 * two sides would stop meeting with no error anywhere.
 */

/** Whether the term was typed as a name or lifted out of a pasted link. */
export type ProfileQuerySource = 'typed' | 'link';

/** Why nothing searchable could be read out of the field. */
export type ProfileQueryProblem =
  /** The field is empty, or holds only whitespace. */
  | 'blank'
  /**
   * It reads as a web link, and the link's path names nothing.
   *
   * Its own message rather than a shrug, because the two repairs are different: a
   * blank field wants anything at all, and this one wants the address of a profile
   * page rather than of the site it lives on.
   */
  | 'link-without-a-lifter';

export type ProfileQueryReading =
  | { readonly ok: true; readonly term: string; readonly source: ProfileQuerySource }
  | { readonly ok: false; readonly problem: ProfileQueryProblem };

/**
 * Reads a search term out of a name or a profile address.
 *
 * Total, offline and synchronous. A link is recognised by shape and read by taking
 * the **last non-empty segment of its path** -- no site's URL layout is encoded
 * here, and encoding one would be a rule about somebody else's routing that keeps
 * compiling after they change it. The last segment is what names the lifter on every
 * profile URL worth pasting, and on an address that names no lifter it is either
 * absent or obviously not a name, which is the case the reading reports.
 *
 * A link pasted without its scheme is read as a link. Copying an address out of a
 * browser's omnibox drops the `https://` on every current browser, so the common
 * paste is the scheme-less one; searching the archive for the literal string
 * `www.example.org/u/johndoe` folds to one long nonsense key and answers "nobody by
 * that name", which is a wrong-looking answer to a right input.
 */
export function readProfileQuery(input: string): ProfileQueryReading {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, problem: 'blank' };

  const url = asWebLink(trimmed);
  if (url === null) return { ok: true, term: trimmed, source: 'typed' };

  const segment = lastPathSegment(url);
  if (segment === null) return { ok: false, problem: 'link-without-a-lifter' };
  return { ok: true, term: segment, source: 'link' };
}

/**
 * The input as a web address, or `null` where it is not one.
 *
 * Two passes. The first accepts what `URL` accepts, which is the paste that kept its
 * scheme. The second covers the paste that lost it, and is guarded on there being no
 * whitespace and at least one slash -- a typed name has spaces and no slash, and
 * without the guard `Jean Luc` would be prefixed, parsed as a host, and searched for
 * as `jean%20luc`.
 */
function asWebLink(value: string): URL | null {
  const direct = parseUrl(value);
  if (direct !== null) return direct;
  if (/\s/u.test(value) || !value.includes('/')) return null;
  return parseUrl(`https://${value}`);
}

/**
 * `URL`, restricted to the two schemes a profile can be published under.
 *
 * The restriction is not decoration. `javascript:alert(1)` and a `data:` URL both
 * parse perfectly well, and without this they would take the link branch and have a
 * "path segment" read out of them. Nothing here executes a string, so the payload
 * would only ever have been searched for -- but a screen that echoes the tail of a
 * `javascript:` URL back as "searching for" is a screen doing an attacker's
 * formatting, and the cheapest place to stop that is where the string stops being
 * text and starts being an address.
 */
function parseUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not a URL. The only information in the throw is that fact, which is what
    // `null` says; `URL` gives no structured reason to pass on.
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/**
 * The last named segment of a path, decoded, or `null` for a path that has none.
 *
 * Query and fragment are ignored. A profile is a path on every archive worth
 * pasting from, and a lifter's name arriving in a query string would be a different
 * site with a different convention -- guessing at which parameter held it is exactly
 * the encoding of somebody else's routing this function refuses to do.
 */
function lastPathSegment(url: URL): string | null {
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const last = segments[segments.length - 1];
  if (last === undefined) return null;
  const decoded = decodePathSegment(last);
  return decoded === '' ? null : decoded;
}

/**
 * A path segment with its percent-escapes resolved, or the segment as it stands.
 *
 * `URL` normalises a pathname but does not reject a malformed escape, so `%zz`
 * survives into here and `decodeURIComponent` throws on it. The segment as written
 * is the better answer than no answer: it is what the reader can see in the field,
 * and the fold that follows discards the punctuation either way.
 */
function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
