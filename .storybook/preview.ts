// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { asThemeMode, THEME_MODES, type ThemeMode } from '@platform-toolkit/configuration';
import { applyThemeMode } from '@platform-toolkit/ui';
import type { Preview } from '@storybook/web-components-vite';

// The same stylesheet every page loads. Importing it here rather than restating
// a background colour in Storybook's own settings is what makes a story a real
// preview: an element that looks wrong against the token surface looks wrong
// here too, instead of looking fine against a white panel Storybook chose.
import '@platform-toolkit/ui/tokens.css';

/**
 * The name of the theme toolbar control.
 *
 * Deliberately the same word as the documented iframe query parameter, because
 * the toolbar is playing the same part: there is no visitor-facing theme switch
 * in this toolkit and adding one would be a product change. What the toolbar
 * simulates is the *embedding site* choosing, which is the only override the
 * design allows.
 */
const THEME_GLOBAL = 'theme';

/** Written out rather than derived, so a mode cannot be added without a label. */
const THEME_TITLES: Readonly<Record<ThemeMode, string>> = {
  system: 'System (default)',
  light: 'Forced light',
  dark: 'Forced dark',
};

const preview: Preview = {
  globalTypes: {
    [THEME_GLOBAL]: {
      description: 'What an embedding site has asked for. Visitors never see this control.',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: THEME_MODES.map((mode) => ({ value: mode, title: THEME_TITLES[mode] })),
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: { [THEME_GLOBAL]: 'system' },

  decorators: [
    (story, context) => {
      // Through `applyThemeMode` rather than by setting the attribute directly,
      // so the story tree gets the same behaviour the site gets -- including the
      // rule that `system` sets no attribute at all and leaves the media query
      // in charge. Writing `data-theme="light"` here would quietly make every
      // story a forced-theme story and hide the default from review.
      applyThemeMode(asThemeMode(context.globals[THEME_GLOBAL]) ?? 'system');
      return story();
    },
  ],

  parameters: {
    // Storybook's own background switcher would fight the tokens for control of
    // the same surface, and the winner would depend on load order.
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
};

export default preview;
