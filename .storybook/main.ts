// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import type { StorybookConfig } from '@storybook/web-components-vite';

/**
 * Interactive documentation for the elements the tools are assembled from.
 *
 * A component here is exercised the way a tool exercises it -- properties set
 * from outside, events observed from outside -- with none of the loading,
 * routing, or data that surrounds it on a real page. That is what makes a story
 * a usable answer to "what does this element do and what may I pass it", and it
 * is why the states worth documenting are the awkward ones: no options, an
 * ambiguous catalogue, a read that failed. Those are the states a screenshot of
 * a working page never shows and a reader would otherwise have to guess at.
 *
 * Stories are colocated with the code they describe rather than gathered in a
 * `stories/` directory, so a component and its documentation move together and
 * a deleted element cannot leave a story behind that still renders.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/web-components-vite', options: {} },

  stories: ['../packages/*/src/**/*.stories.ts', '../apps/web/src/**/*.stories.ts'],

  addons: [
    // The same engine the browser-mode tests run, in the one place a reviewer
    // is actually looking at the component. A violation that a test would catch
    // only after it is written is visible here while the story is being made.
    '@storybook/addon-a11y',
  ],

  core: {
    // Storybook reports usage to its maintainers by default. This repository
    // sends nothing anywhere without a reason, and a development tool that
    // phones home from a contributor's machine is not a reason.
    disableTelemetry: true,
  },

  // Storybook renders workspace packages from their built output, exactly as the
  // site does, rather than through source aliases. Aliasing would be more
  // convenient and would also mean the story tree and the shipped tree could
  // disagree -- the interesting case being decorator lowering, where a
  // misconfigured transform produces an element that renders once and then never
  // updates. The `storybook` scripts build the packages first for that reason.
  typescript: {
    // Storybook's own prop extraction is off: these are custom elements, and
    // their public interface is the property list a story sets. Nothing here
    // relies on a generated manifest that could drift from the source.
    check: false,
  },
};

export default config;
