// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * One rule out of an element's `@media print` block, as a live declaration.
 *
 * Imported by browser tests only; nothing that ships imports it.
 *
 * Half of a printed element only exists inside `@media print`, and a browser
 * running a test is not printing -- `getComputedStyle` reports the screen half
 * and there is no way from inside the page to ask it for the other one. So the
 * printed half would go untested entirely, on the one element in the collection
 * whose primary medium is paper.
 *
 * The alternative that suggests itself is a substring search of `cssText`, and
 * it is worth nothing: `expect(css).toContain('color: #000')` passes against a
 * declaration in the wrong rule, in the wrong block, or commented out. This
 * reads the parsed CSSOM instead, so the selector has to exist inside a `print`
 * media rule and the property has to be set on *that* rule. A print block that
 * was dropped, renamed, or moved to a selector nothing matches fails here.
 *
 * What it still cannot see is whether the rule *applies* to anything -- a print
 * rule for `.sheet` is green whether or not the element renders a `.sheet`. Pair
 * it with an ordinary DOM assertion naming the same selector.
 */
import type { CSSResultGroup } from 'lit';

/** The stylesheet behind a `static styles`, refusing the shapes we do not use. */
function sheetOf(group: CSSResultGroup): CSSStyleSheet {
  if (Array.isArray(group)) {
    throw new Error('printRule expects one css`` result, not an array of them.');
  }
  const sheet = group instanceof CSSStyleSheet ? group : group.styleSheet;
  if (sheet === undefined) {
    throw new Error('The styles produced no CSSStyleSheet, so no rule can be read from them.');
  }
  return sheet;
}

/**
 * The declarations `selector` carries inside the element's print block.
 *
 * `selectorText` is compared exactly, so pass the selector as the CSSOM
 * normalises it -- one selector per rule. A grouped rule (`.muted, .fact .name`)
 * comes back under its whole comma-separated text, and matching one half of it
 * would be the substring search this file exists to avoid.
 */
export function printRule(group: CSSResultGroup, selector: string): CSSStyleDeclaration {
  const media = [...sheetOf(group).cssRules].find(
    (rule): rule is CSSMediaRule =>
      rule instanceof CSSMediaRule && rule.media.mediaText === 'print',
  );
  if (media === undefined) {
    throw new Error('The element has no @media print block at all.');
  }
  const rule = [...media.cssRules].find(
    (candidate): candidate is CSSStyleRule =>
      candidate instanceof CSSStyleRule && candidate.selectorText === selector,
  );
  if (rule === undefined) {
    const found = [...media.cssRules]
      .filter((candidate): candidate is CSSStyleRule => candidate instanceof CSSStyleRule)
      .map((candidate) => candidate.selectorText);
    throw new Error(`The print block has no rule for ${selector}. It has: ${found.join(' | ')}`);
  }
  return rule.style;
}
