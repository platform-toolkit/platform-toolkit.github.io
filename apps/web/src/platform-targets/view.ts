import { TOOLS } from '../tools.js';

/** Identifier for this tool, and what it calls itself in a height message. */
export const TOOL_ID = 'platform-targets';

/**
 * What Platform Targets renders today.
 *
 * The selection interface is not built yet. This exists so the page is not
 * blank while it is being built: an empty `<main>` reads as a broken deploy
 * rather than as work in progress, and the embed route additionally needs
 * something with a height to report to the page framing it. It will be replaced
 * wholesale, so it is deliberately not worth styling.
 */
export function createPlatformTargetsView(): HTMLElement {
  const tool = TOOLS.find((candidate) => candidate.id === TOOL_ID);
  if (tool === undefined) {
    // The list is a compile-time constant, so this is a wiring mistake rather
    // than a runtime condition -- but a silent empty page is exactly the
    // failure this function exists to avoid.
    throw new Error(`Tool "${TOOL_ID}" is missing from the tool list.`);
  }

  const section = document.createElement('section');

  const summary = document.createElement('p');
  summary.textContent = tool.summary;

  const status = document.createElement('p');
  status.textContent = 'The lifter selection interface is still being built.';

  section.append(summary, status);
  return section;
}
