// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

export {
  browserPreferenceStorage,
  browserSessionStorage,
  memoryPreferenceStorage,
  webStorage,
  type PreferenceStorage,
} from './storage.js';
export {
  PREFERENCE_KEY_PREFIX,
  createPreferenceStore,
  definePreference,
  type PreferenceDefinition,
  type PreferenceStore,
  type PreferenceWriteResult,
} from './store.js';
export { PreferenceValue, type QuantityBounds } from './value.js';
