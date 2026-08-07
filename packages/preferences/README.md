# @platform-toolkit/preferences

The seam between a tool and whatever remembers a visitor's own settings between visits.

A preference is something the person operating the tool chose about the tool — which unit they read
in, which bar they own, whether they want the timer to beep. It is never something about a lifter.

## Using it

Define the preference once, next to the code that reads it, then read and write it through a store.

```js
import {
  PreferenceValue,
  createPreferenceStore,
  definePreference,
  browserPreferenceStorage,
} from '@platform-toolkit/preferences';

const unit = definePreference({
  name: 'warm-up.unit',
  value: PreferenceValue.choice(['kg', 'lb']),
  fallback: 'kg',
});

const store = createPreferenceStore(browserPreferenceStorage());

store.write(unit, 'lb'); // 'saved'
store.read(unit); // 'lb'
```

`PreferenceStore` is `remembers`, `read`, `write`, `forget` and `forgetAll`. Keys are namespaced
with `PREFERENCE_KEY_PREFIX` (`'ptk.'`), so `forgetAll` clears this collection's keys and leaves the
rest of the origin's storage alone.

`browserPreferenceStorage()`, `browserSessionStorage()` and `memoryPreferenceStorage()` are the
adapters; `webStorage(candidate)` wraps any `Storage`-shaped object. Use the in-memory one in tests.

Lifetime is chosen by which backing you pass in, and a tool may want two stores.
`browserPreferenceStorage()` outlives the tab; `browserSessionStorage()` does not. Settings belong
in the first, scratch state that should survive a reload but not a week belongs in the second.

## The four things to get right

**A value is a closed set, and that is the point.** A preference can only be declared against a
`PreferenceValue`, and a `PreferenceValue` can only come from one of the static builders: `choice`,
`flag`, `quantity`, `count`, `publishedId`, `listOf`, `shape`. **There is no builder that admits
free text.** A name, a profile link or a date of birth has no shape to be stored under, so it cannot
be persisted by accident and a reviewer does not have to check whether it was. Bounds on `quantity`
and `count` and a `maxLength` on `listOf` are required, not optional.

`publishedId` is the narrow exception, for identifiers a federation names in an artifact fetched at
runtime — a weight class, a division — which `choice` cannot hold because its options must exist at
module load. It comes with an obligation on the reader: resolve the stored id against published data
before using it, and drop it when the source does not offer it. A `publishedId` read straight onto a
screen defeats the rule.

**Reading always answers.** `read` returns the stored value, or the definition's `fallback` when
nothing is stored, storage is unavailable, or what is stored no longer satisfies the definition.
There is no undefined case for a caller to handle and no way for a stale value to reach a screen.

**Writing answers `'saved' | 'unavailable' | 'refused'` rather than throwing.** Storage that is
absent, full, or partitioned is an ordinary condition — a private window, a third-party frame — and
a tool should degrade to holding the setting for this session rather than showing an error. `write`
does throw a `RangeError` if the value does not satisfy the definition it was given, because that is
a bug in the caller and not a fact about the browser. When the value is one you do not control — a
federation renaming something you hold as a `publishedId` — ask
`definition.value.accepts(candidate)` first and store nothing rather than taking the screen down.

**`createPreferenceStore(null)` is supported.** It is the honest store for a context with no
storage: reads answer the fallback, writes answer `'unavailable'`. `remembers` is false, so a tool
can decline to offer a "remember this" control instead of offering one that silently does nothing.

Probing is a real write and delete, not a feature check. A browser can expose `localStorage` and
throw on touching it, and it can throw on the property access itself, so both are inside the guard.

## Licence

Apache-2.0. See the repository `LICENSE`.
