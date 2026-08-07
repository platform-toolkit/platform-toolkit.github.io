# @platform-toolkit/configuration

Theme rules, and the protocol an embedding page speaks to a framed tool.

Pure: no DOM, no network, no storage. It decides what a theme setting means and what a message is
allowed to say. `@platform-toolkit/ui` is what actually touches the document; this package is what
both sides of a frame boundary agree on, which is why an embedder can depend on it without depending
on Lit.

## Theme

```js
import {
  THEME_MODES,
  resolveEffectiveTheme,
  themeModeFromSearch,
} from '@platform-toolkit/configuration';

THEME_MODES; // ['system', 'light', 'dark']
themeModeFromSearch('?theme=dark'); // 'dark'
themeModeFromSearch('?theme=neon'); // 'system'
resolveEffectiveTheme('system', true); // 'dark'
```

`THEME_PARAMETER` is `'theme'`, and it is the only query parameter any page in this collection
reads. Anything unrecognised falls back to `system` rather than reaching the page.

A mode and a theme are separate types on purpose. `ThemeMode` is `system | light | dark` — what was
configured. `EffectiveTheme` is `light | dark` — what is on screen right now. Code that collapses
them stops following the system the moment the system changes, which is the one bug this split
exists to prevent. `resolveEffectiveTheme` is the only crossing, and it needs to be told what the
system currently prefers because this package cannot ask.

`asThemeMode(value)` narrows an unknown to a `ThemeMode` or `null`.

## Embedding

Both directions are declared in `src/embedding.ts` and validated with the same schemas on both
sides. Every message carries `source: 'platform-toolkit'` (`MESSAGE_SOURCE`) and `version: 1`
(`MESSAGE_VERSION`).

A host sends a theme in:

```js
import { MESSAGE_SOURCE, MESSAGE_VERSION } from '@platform-toolkit/configuration';

const frame = document.querySelector('iframe[title="Platform Targets"]');

frame.contentWindow.postMessage(
  { source: MESSAGE_SOURCE, version: MESSAGE_VERSION, type: 'set-theme', mode: 'dark' },
  'https://example.invalid',
);
```

A tool sends its rendered height out:

```js
{ source: 'platform-toolkit', version: 1, tool: 'qualify', type: 'height', height: 900 }
```

`tool` names which tool spoke, so a page framing two of them can size each frame rather than sizing
both to whichever spoke last.

`readHostThemeMessage(payload)` is the whole inbound path: it takes an `unknown`, validates it
against `HostThemeMessageSchema`, and answers a `ThemeMode` or `null`. It never throws, so a
listener can hand it anything that arrives on the window.

```js
import { readHostThemeMessage } from '@platform-toolkit/configuration';

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const mode = readHostThemeMessage(event.data);
  if (mode === null) return;
  // apply mode
});
```

`readHostThemeMessage` does not check the sender — a schema cannot see where a message came from.
Checking `event.source` is the caller's job and skipping it is the mistake to avoid, because any
window that can reach yours can post to it.

A theme mode is the only thing a host may set. There is no message for supplying markup, CSS, a URL,
a script, or data, and adding one would hand the embedding page a way to change what a tool says.

## Licence

Apache-2.0. See the repository `LICENSE`.
