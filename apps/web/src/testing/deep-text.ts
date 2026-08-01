/**
 * Everything a visitor can read on screen, including text inside shadow roots.
 *
 * Imported by browser tests only; nothing that ships imports it, so it is never
 * bundled into a page.
 *
 * `textContent` stops at a shadow boundary, and the sentences worth asserting on
 * in this collection are almost all on the far side of one -- a `summary` handed
 * to `ptk-disclosure` is rendered inside *its* root, so a host-only read comes
 * back empty. A `toContain` then fails for the wrong reason and, far worse, a
 * `not.toContain` passes without measuring anything.
 *
 * Shared rather than copied into each test file: every rule below is a detail
 * that makes an assertion silently vacuous when it is missed, and a second copy
 * is a second place for one of them to be dropped.
 */
export function deepText(node: Node): string {
  return readDeep(node).replace(/\s+/gu, ' ').trim();
}

function readDeep(node: Node): string {
  // Lit marks every interpolation with a comment node, and a comment's
  // `textContent` is its data -- so leaving them in puts `?lit$1234$` in the
  // middle of every sentence an assertion is trying to match.
  if (node.nodeType === Node.COMMENT_NODE) return '';
  // A slot renders what was assigned to it, so following the assignment is what
  // keeps slotted content in the order it appears rather than appended after
  // the shadow tree it was projected into.
  if (node instanceof HTMLSlotElement) {
    return node.assignedNodes().map(readDeep).join('');
  }
  // A shadow root replaces its host's children on screen; reading both would
  // report unslotted content nobody can see.
  if (node instanceof Element && node.shadowRoot !== null) {
    return readDeep(node.shadowRoot);
  }
  // Joined with nothing, the way `textContent` concatenates, so an interpolated
  // sentence reads back as the sentence rather than as its fragments spaced
  // apart.
  if (node.hasChildNodes()) {
    return [...node.childNodes].map(readDeep).join('');
  }
  return node.textContent ?? '';
}
