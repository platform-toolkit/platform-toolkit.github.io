# @platform-toolkit/platform-targets

What a lifter has to lift to reach the next classification, the next record, or a goal they set
themselves — for their category, in their federation, from that federation's own published data.

A lifter answers four required questions — sex category, equipment, weight class, drug-tested — and
three optional ones — a second weight class to compare against, an age division, a region. From
there the tool draws the whole report: every lift, every classification level, world and national
records always and state records once a state is named, with the exact kilograms between where the
lifter is and each target.

**Every number on screen comes from a published artifact.** No classification standard, qualifying
total or record is written into this package, and none is written into the repository it lives in.
That is not tidiness: a standard hard-coded on the day it was correct is a standard that goes on
being shown after the federation revises it, and nothing on the screen would look wrong. The same
rule decides the fixtures — the records the tests and stories run against are invented, and
deliberately do not match any real federation's, so a passing test can never be read as a claim
about a published figure.

**Which federation is never this package's decision.** There is no default and no fallback: the host
says which, every time. One federation named in code reads as correct for exactly as long as one is
published.

There are three ways to use it. Pick the first one that fits; they get more work and more control in
the order they are listed.

---

## 1. Embed the hosted view in an iframe

Nothing to install, and the fastest way to put the tool on a page you own.

```html
<iframe
  src="https://example.invalid/platform-targets/embed/uspa/"
  title="Platform targets"
  style="width: 100%; border: 0"
  height="900"
></iframe>
```

**The federation segment is part of the route, not an option.** There is no `/embed/` that picks one
for you. A frame is a page and a page is for one federation, so a second federation is a second
frame.

Add `?theme=` to override the visitor's system setting when your page's design requires it —
`system` (the default), `light`, or `dark`. That is the only parameter the route takes. The
repository README's **Theming** section is the full account and applies unchanged here.

The framed view posts its rendered height to the parent so you can size the frame without a
scrollbar:

```js
const frame = document.querySelector('iframe[title="Platform targets"]');

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.source !== 'platform-toolkit' || message.type !== 'height') return;
  if (message.tool !== 'platform-targets') return;
  frame.height = String(message.height);
});
```

A height is the only thing the frame ever sends. It is worth listening for here more than anywhere
else in the collection: the page is a seven-question form that collapses to two lines and is
replaced by a table of every lift at every level, so the height it starts at and the height it ends
at are not close.

The framed copy remembers the lifter's category in storage the browser partitions per embedding
site, and may refuse it outright. Nothing here is lost if it does: the tool asks its four questions
and works exactly as well.

---

## 2. Install the package

```sh
pnpm add @platform-toolkit/platform-targets
```

> **Not on a public registry yet.** The package builds and packs — a check in this repository
> installs the tarball into a scratch consumer, type-checks against its shipped declarations and
> runs its core in Node on every run — but nothing has been published. Today you would install it
> from a tarball or a git dependency.

### Entry points

| Import                                       | What is in it                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `@platform-toolkit/platform-targets`         | The pure rules and the vocabulary, re-exported. Start here.             |
| `@platform-toolkit/platform-targets/core`    | The pure rules alone. No Lit, no DOM, no storage, no network, no clock. |
| `@platform-toolkit/platform-targets/element` | The seven custom elements and `definePlatformTargets()`.                |
| `@platform-toolkit/platform-targets/types`   | The vocabulary as types only.                                           |

The published shapes are in none of them. A category catalogue, a classification book and a record
book are `@platform-toolkit/data-contracts`, so a second tool reading the same artifacts describes
them the same way.

### Peer expectations

The package depends on `lit` and on `@platform-toolkit/data-contracts`, `@platform-toolkit/domain`,
`@platform-toolkit/preferences` and `@platform-toolkit/ui` from this collection. It brings no
state-management library, no CSS framework and no HTTP client.

**It makes no network request of any kind, and it does not depend on `@platform-toolkit/data-access`
either.** Fetching the catalogue, the standards and the record partitions is the host's job, and the
elements take all of it as properties. That is what lets the whole interface be exercised — every
loading, empty, failed and offline state included — with no transport at all, and it is why a
consumer with an archive of its own can drive this tool without going near the collection's data
layer.

### Registering the elements

```js
import { definePlatformTargets } from '@platform-toolkit/platform-targets/element';
import '@platform-toolkit/ui/tokens.css';

definePlatformTargets();
```

The call is explicit rather than a side effect of the import, and it is safe to make any number of
times from any number of modules. The custom element registry is a global that throws on a second
write, so a package that registered its tags on import would hand you a `NotSupportedError` from a
file you did not write, before a line of your own code ran, the first time a bundler failed to
dedupe it. All seven tags go in together, and six of them render inside the seventh, so registering
only the root would give you a blank tool with a clean console.

`tokens.css` is a stylesheet, not a framework — the design tokens the elements read for colour,
spacing, type scale and tap-target size. Without it the elements render with the browser's defaults,
including tap targets below the 44 px floor.

### Driving the root element

```html
<ptk-platform-targets></ptk-platform-targets>
```

| Property          | Type                                 | What it is                                                 |
| ----------------- | ------------------------------------ | ---------------------------------------------------------- |
| `catalog`         | `CategoryCatalog \| null`            | The federation's categories. Drives all seven questions.   |
| `catalogStatus`   | `CatalogStatus`                      | `loading`, `ready`, `unavailable` or `failed`.             |
| `book`            | `ClassificationBook \| null`         | Standards for the lifter's sex and equipment.              |
| `standardsStatus` | `StandardsStatus`                    | `idle`, `loading`, `ready` or `failed`.                    |
| `recordReads`     | `ReadonlyMap<string, PartitionRead>` | One entry per records artifact, keyed by `partitionKey`.   |
| `dataMeta`        | `DataMeta \| null`                   | The published index, which says how old the figures are.   |
| `dataMetaStatus`  | `DataMetaStatus`                     | `loading`, `ready` or `failed`.                            |
| `connection`      | `Connection`                         | `online` or `offline`.                                     |
| `settings`        | `PreferenceStore \| null`            | Where the answered category and the current view are kept. |

Every status is a separate property from the thing it describes, and that is the point: "still
fetching", "this federation publishes none for this category" and "the read failed" are three
different sentences, and a bare `Book | null` can only say one of them.

`settings` defaults to `null`, which means remember nothing: the element reads every default and
writes nowhere, so it works standing on its own in plain HTML and an embed whose host blocked
storage needs no branch anywhere. The default is the absence of a store rather than an inert one on
purpose -- where a visitor's choices are kept is yours to decide, and a store the element built
would be a decision it made for you. Hand it a real one to have the category survive a visit:

```js
import { browserPreferenceStorage, createPreferenceStore } from '@platform-toolkit/preferences';

element.settings = createPreferenceStore(browserPreferenceStorage());
```

Two events tell a host what to fetch:

- **`ptk-selection-applied`** carries the applied category _and_ the record partitions the report
  now wants. Take both off the event rather than reading them back off the element — a listener
  registered before the element is connected runs first, and the element's own copy is still one
  answer behind.
- **`ptk-refresh-request`** carries no detail and comes from two places: the footer when nothing
  loaded at all, and the notice beside a level of records that did not answer. A lifter pressing
  either means "try the whole thing again", so re-issue whatever is currently failed and nothing
  else.

---

## 3. Consume the rules

The third reuse route is neither the frame nor the elements: it is `./core`, which is a total
function of its arguments all the way down and needs no browser.

```js
import {
  NO_SELECTION,
  buildReport,
  resolveSelection,
} from '@platform-toolkit/platform-targets/core';

const resolved = resolveSelection({ ...NO_SELECTION, sex: 'female' }, catalog);
const report = buildReport({ resolved, book, reads, entries, goals });
```

- `resolveSelection` is the rule that keeps a half-changed category honest: an answer the catalogue
  does not offer is dropped rather than kept. Without it a lifter who picks the 56 kg class and then
  corrects their sex category keeps a class from the other ladder, and every number downstream is
  drawn from a category they are not in — with nothing on screen looking wrong.
- `resolved.ready` is the four required answers, and `resolved.partitions` is the list of records
  artifacts the report wants, in the order it lists them.
- `buildReport` is the whole table: standings, the kilograms to each target, and the record
  disagreements when two published books say different things.
- `partitionKey` is how a partition is named as a map key, and the host filing reads and the report
  looking them up have to agree — so use it on both sides rather than spelling a key twice.
- `typeLift` accepts a keystroke and `readLiftEntries` decides what it meant, including adding up a
  total the lifter did not type.
- `addGoal`, `removeGoal` and `tagGoal` are pure list operations, so undo is the plain thing it
  should be: keep the list you had and write it back.
- `GOALS_PREFERENCE` and `TARGETS_PREFERENCES` are the preference definitions, bounded and typed,
  for use with any `PreferenceStore`.

Nothing here fetches, and nothing here knows which federation it is looking at. Both are arguments.

---

## Licence

Apache-2.0. See the repository `LICENSE`.
