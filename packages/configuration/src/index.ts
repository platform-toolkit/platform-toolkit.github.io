// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

export {
  HeightMessageSchema,
  HostThemeMessageSchema,
  MESSAGE_SOURCE,
  MESSAGE_VERSION,
  readHeightMessage,
  readHostThemeMessage,
  type HeightMessage,
  type HeightReading,
  type HostThemeMessage,
} from './embedding.js';
export {
  THEME_MODES,
  THEME_PARAMETER,
  asThemeMode,
  resolveEffectiveTheme,
  themeModeFromSearch,
  type EffectiveTheme,
  type ThemeMode,
} from './theme.js';
