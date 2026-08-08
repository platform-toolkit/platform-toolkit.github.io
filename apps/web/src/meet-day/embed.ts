// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { publishEmbedHeight, publishEmbedHeightOnResize } from '@platform-toolkit/ui/embed-height';
import { initializeTheme } from '@platform-toolkit/ui/theme';

import { noMeetStore } from './meet-store.js';
import { TOOL_ID, createPlannerView } from './view.js';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Application mount point #app is missing from the document.');
}

// A forced dark theme can wrap a label that fitted on one line, and a frame left
// at its old height is the visible symptom -- on somebody else's page.
initializeTheme({
  onChange: () => {
    publishEmbedHeight({ tool: TOOL_ID });
  },
});

// No service worker here, deliberately: embedding a widget must never install
// anything on the embedder's visitor or cache anything under their origin.
//
// §24's shelf is refused for the same reason and one more. A saved meet holds a
// bodyweight, an age, three maximums and a person's name, and keeping that
// under an embedder's origin is data this project has no business leaving on
// somebody else's site -- so `noMeetStore` and not `sessionMeets`, which would
// accumulate the same thing in memory the parent page shares. It is passed
// explicitly although it is also `view.ts`'s default: the refusal is a decision
// about this route, and a decision that is only visible as an omission is one
// the next person reading this file has no way to see was made.
app.replaceChildren(createPlannerView({ store: noMeetStore() }));

// This tool's height moves on nearly every answer: choosing a method swaps a
// whole block of fields, unfolding §8 adds a dozen more, and the plan itself
// appears only once every lift has been agreed to. An embedder left at the
// height of the setup questions would show the plan through a scrollbar, or not
// at all.
//
// The height is all that leaves, which matters more here than in the other tools
// because what is typed into this one is a bodyweight, an age and three
// maximums. None of it is ever sent to a parent page and there is no message
// that could carry it.
publishEmbedHeightOnResize({ tool: TOOL_ID });
