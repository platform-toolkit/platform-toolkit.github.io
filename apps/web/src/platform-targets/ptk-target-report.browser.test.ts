import type { Lift } from '@platform-toolkit/data-contracts';
import { PtkNotice } from '@platform-toolkit/ui';
// Every measurement at the bottom of this file reads a spacing or tap-target
// token, and a declaration referencing an undefined custom property is dropped
// -- so without the stylesheet the 320 px check measures a layout with no gaps
// and the link check measures a link with no floor.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import type { PartitionRead, PtkTargetReport } from './ptk-target-report.js';
import './ptk-target-report.js';
import {
  ANSWERED,
  BOOK,
  CATALOG,
  CLASSIFICATIONS,
  FULLY_ANSWERED,
  NATIONAL,
  NORTH,
  STATE_BOOK,
  bookOf,
  record,
} from './records-fixture.js';
import { NO_SELECTION, partitionKey, type CategorySelection } from './selection.js';
import { LIFTS, NO_ENTRIES, typeLift, type LiftEntries } from './standards.js';

/**
 * The report, in a real browser, mounted on its own.
 *
 * `report.ts` decides every figure and every sentence and is tested in Node, so
 * nothing here re-checks arithmetic. What only a browser can answer is whether
 * the arrangement carries it: whether a lifter can tell a record from a
 * classification, whether the weight leading a record row is the one that
 * *takes* it, whether a failed read is distinguishable from a category the
 * federation keeps nothing in, and whether any of it survives a 320 px column.
 *
 * Mounted alone rather than through `ptk-platform-targets`, deliberately. That
 * is the arrangement that catches an element rendering a `ptk-*` tag it never
 * registered -- in the assembled page a sibling imports the package, so the
 * missing registration is invisible and the notice merely loses its border.
 */

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
});

interface MountOptions {
  readonly selection?: CategorySelection;
  readonly catalog?: PtkTargetReport['catalog'];
  readonly classifications?: PtkTargetReport['classifications'];
  readonly classificationsStatus?: PtkTargetReport['classificationsStatus'];
  readonly reads?: readonly PartitionRead[];
  readonly entries?: LiftEntries;
}

/** A read that arrived, which is what most of these tests want. */
function ready(partition: PartitionRead['partition'], book: PartitionRead['book']): PartitionRead {
  return { partition, status: 'ready', book };
}

async function mount(options: MountOptions = {}): Promise<PtkTargetReport> {
  const element = document.createElement('ptk-target-report');
  element.catalog = options.catalog === undefined ? CATALOG : options.catalog;
  element.selection = options.selection ?? ANSWERED;
  element.classifications =
    options.classifications === undefined ? CLASSIFICATIONS : options.classifications;
  element.classificationsStatus = options.classificationsStatus ?? 'ready';
  element.recordReads = new Map(
    (options.reads ?? [ready(NATIONAL, BOOK)]).map((read) => [partitionKey(read.partition), read]),
  );
  element.entries = options.entries ?? NO_ENTRIES;
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  await element.updateComplete;
  return element;
}

/** Everything on screen, across shadow boundaries. */
function text(element: PtkTargetReport): string {
  return deepText(element);
}

function all(element: PtkTargetReport, selector: string): Element[] {
  return [...(element.shadowRoot?.querySelectorAll(selector) ?? [])];
}

/**
 * The one element matching, or a failure naming the selector.
 *
 * Not generic, for the reason the warm-up suite gives: `querySelector<T>` is an
 * assertion wearing a function's clothes, and the failure from a selector typo
 * arrives three lines later as a missing property.
 */
function only(container: ParentNode, selector: string): Element {
  const [found, ...rest] = [...container.querySelectorAll(selector)];
  if (found === undefined) {
    throw new Error(`Nothing rendered for "${selector}".`);
  }
  if (rest.length > 0) {
    throw new Error(`Expected one "${selector}", found ${String(rest.length + 1)}.`);
  }
  return found;
}

/** The section for one lift, found by its heading the way a reader finds it. */
function sectionFor(element: PtkTargetReport, label: string): Element {
  const found = all(element, '.section').find(
    (section) => section.querySelector('h3')?.textContent.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`No section headed "${label}".`);
  }
  return found;
}

function sectionHeadings(element: PtkTargetReport): string[] {
  return all(element, '.section h3').map((heading) => heading.textContent.trim());
}

function columnsIn(section: Element): Element[] {
  return [...section.querySelectorAll('.column')];
}

/**
 * One lift's column, by the weight class heading when there is more than one.
 *
 * By the heading rather than by index: the report orders its columns by the
 * ladder and not by which class was answered first, so an index would silently
 * assert against the comparison class the day that ordering is what breaks.
 */
function columnFor(element: PtkTargetReport, lift: string, weightClass?: string): Element {
  const columns = columnsIn(sectionFor(element, lift));
  if (weightClass === undefined) {
    const [column, ...rest] = columns;
    if (column === undefined || rest.length > 0) {
      throw new Error(`Expected one "${lift}" column, found ${String(columns.length)}.`);
    }
    return column;
  }
  const found = columns.find(
    (column) => column.querySelector('h4')?.textContent.trim() === weightClass,
  );
  if (found === undefined) {
    throw new Error(`No "${lift}" column headed "${weightClass}".`);
  }
  return found;
}

function rowsIn(container: Element): Element[] {
  return [...container.querySelectorAll('li.row')];
}

function titlesIn(container: Element): string[] {
  return [...container.querySelectorAll('.title')].map((title) => title.textContent.trim());
}

function noticesIn(element: PtkTargetReport): PtkNotice[] {
  return all(element, 'ptk-notice').map((notice) => {
    if (!(notice instanceof PtkNotice)) {
      // Thrown, never skipped. An unregistered custom element still renders its
      // text, so a filter that quietly dropped one would leave every sentence
      // assertion in this file passing over an element with no tone, no border
      // and no role -- which is exactly the defect mounting alone exists to catch.
      throw new Error('A notice rendered as an unregistered element.');
    }
    return notice;
  });
}

/** Entries as though somebody typed them, never as a literal. */
function typed(figures: Partial<Record<Lift, string>>): LiftEntries {
  let entries = NO_ENTRIES;
  for (const lift of LIFTS) {
    const figure = figures[lift];
    if (figure !== undefined) {
      entries = typeLift(entries, lift, figure);
    }
  }
  return entries;
}

describe('ptk-target-report', () => {
  /**
   * Silent before the catalogue lands, because the questions above already say
   * whether it is loading, unpublished or failed -- and two sentences about one
   * read on one screen is how a reader concludes something is broken.
   */
  it('says nothing at all before the catalogue arrives', async () => {
    const element = await mount({ catalog: null, classificationsStatus: 'idle' });
    expect(text(element)).toBe('');
  });

  /**
   * Requirement 9 from the other side: the report names exactly the answers it
   * is waiting for, and does not wait for the optional ones. A sentence listing
   * every question would send a lifter off to answer a state and an age
   * division that change nothing about whether the report can be drawn.
   */
  it('names the answers it is waiting for, and only the required ones', async () => {
    const element = await mount({ selection: NO_SELECTION, classificationsStatus: 'idle' });
    expect(text(element)).toContain(
      'Choose Sex category, Equipment, Drug-tested status and Weight class above and your targets appear here.',
    );
    expect(text(element)).not.toContain('Masters');
  });

  /**
   * Requirement 9 proper. Nothing optional is answered here -- no comparison
   * class, no division, no region -- and the whole report is on screen.
   */
  it('draws the whole report from the required answers alone', async () => {
    const element = await mount();
    expect(sectionHeadings(element)).toEqual(['Squat', 'Bench press', 'Deadlift', 'Total']);
    expect(titlesIn(columnFor(element, 'Squat'))).toEqual([
      'Class III',
      'Class II',
      'National record',
      'Class I',
    ]);
  });

  /**
   * The axes every column shares, above the columns. They are answered by tiles
   * that scroll off the top of a phone, and a screen full of figures with
   * nothing saying whose they are is the state this line exists to prevent.
   */
  it('states whose report it is', async () => {
    expect(text(await mount())).toContain('56 kg · Open');
    expect(text(await mount({ selection: FULLY_ANSWERED }))).toContain(
      '52 kg and 56 kg · Open and Masters 1',
    );
  });

  /**
   * Requirement 5. Both units on every rung, and the pound figure is not shrunk
   * into a footnote: a lifter who trains in pounds is reading that column.
   */
  it('writes every rung in kilograms and in pounds', async () => {
    const [first] = rowsIn(columnFor(await mount(), 'Squat'));
    expect(first?.querySelector('.kilograms')?.textContent.trim()).toBe('100 kg');
    expect(first?.querySelector('.pounds')?.textContent.trim()).toBe('220.5 lb');
  });

  /**
   * The single most dangerous number on the screen. The weight leading a record
   * row is the weight that *takes* the record, not the record -- a reader who
   * assumes otherwise opens half a kilo light -- so the record itself is stated
   * underneath rather than left to be inferred.
   */
  it('leads a record row with the weight that takes it, and states the record under it', async () => {
    const row = only(columnFor(await mount(), 'Squat'), 'li.row.record');
    expect(only(row, '.kilograms').textContent.trim()).toBe('145.5 kg');
    expect(deepText(row)).toContain('Record: 145 kg (319.7 lb)');
  });

  /**
   * Requirement 6, on screen. Two conditions rather than one figure, because
   * the rule turns on the level of the meet a lifter has entered, this
   * application cannot see which meet that is, and one unconditional number is
   * the wrong number at every meet held above the record's own level.
   */
  it('gives both record-taking conditions with the weight each needs', async () => {
    const shown = text(await mount());
    expect(shown).toContain(
      'At a meet of this level or below: 145.5 kg (320.8 lb) — record plus the record-attempt margin.',
    );
    expect(shown).toContain(
      'At a meet above this level: 147.5 kg (325.2 lb) — record plus the full loading increment.',
    );
  });

  it('says who holds a record, with the date left unlocalised', async () => {
    const element = await mount();
    expect(text(element)).toContain('Robin Vance · 2024-05-18 · Example Winter Open');
    // `03/04/2022` is two different days depending on who is holding the phone,
    // and these tools are read wherever the federation runs meets.
    expect(all(element, 'time').map((time) => time.getAttribute('datetime'))).toContain(
      '2024-05-18',
    );
  });

  /**
   * The federation publishes each record twice on one row, in kilograms and in
   * pounds, and on a corpus this size the two sometimes disagree by more than
   * rounding can explain. Both figures are named, because a caution that only
   * said "this figure may be wrong" gives a lifter a reason to distrust a record
   * with no way to resolve it -- and the row's title is already a link to the
   * table where the question can be settled.
   */
  it('says so when the source contradicts itself about a record', async () => {
    const element = await mount({
      // A decimal point one place left in the pound cell, which is what most of
      // the real disagreements look like. Invented figures (§5.1).
      reads: [
        ready(
          NATIONAL,
          bookOf([
            record('squat', {
              kilograms: 145,
              sourceDisagreement: { pounds: 32, impliedKilograms: 14.51 },
            }),
          ]),
        ),
      ],
    });
    const shown = text(element);
    expect(shown).toContain(
      "The federation's table also prints this record as 32 lb, which is 14.51 kg.",
    );
    // The kilogram column still governs, above and in the arithmetic: the
    // headline is the weight that takes 145 kg, not anything derived from 14.51.
    expect(shown).toContain('Record: 145 kg (319.7 lb)');
    expect(only(columnFor(element, 'Squat'), 'li.row.record .kilograms').textContent.trim()).toBe(
      '145.5 kg',
    );
  });

  it('draws no caution when the source agrees with itself', async () => {
    // Which is nearly every row. Asserted because the caution is rendered from a
    // nullable field, and a template that drew it unconditionally would put a
    // contradiction notice under every record in the collection.
    expect(all(await mount(), '.caution')).toEqual([]);
  });

  /**
   * Requirement 12. The link goes to the *table* the record is published in, and
   * the note says so -- no federation this project reads publishes a per-record
   * certificate, and a link labelled as one would promise a page that does not
   * exist.
   */
  it('links a record back to the table the federation publishes it in', async () => {
    const element = await mount();
    const [link, ...rest] = all(element, '.title a');
    expect(link?.getAttribute('href')).toBe(
      'https://records.example.test/records?level=national&event=raw-full-power',
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    // The referrer would carry the page a lifter is reading, and these tools are
    // embedded on third-party sites where that is the embedder's URL.
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    // Every record in the book shares the one published table, so this is not a
    // single row that happened to be linked.
    expect(rest.length).toBeGreaterThan(0);
    expect(text(element)).toContain('Each record name links to the table');
  });

  /**
   * The tap-target floor applies to a link too (§5.7). It is reachable here only
   * because the title is its own line rather than a link inside a sentence --
   * vertical padding on an inline box grows the hit area without growing the
   * line, so a thumb aiming at the prose above would open a new tab.
   */
  it('gives a record link a real tap target', async () => {
    const element = await mount();
    const [link] = all(element, '.title a');
    expect(link?.getBoundingClientRect().height ?? 0).toBeGreaterThanOrEqual(44);
  });

  it('says nothing about links when no record carries one', async () => {
    // The state book lists no source table for its own scope, so the record is
    // shown and the note about links is not -- there are none to explain.
    const element = await mount({
      selection: FULLY_ANSWERED,
      classifications: null,
      reads: [ready(NORTH, STATE_BOOK)],
    });
    expect(titlesIn(columnFor(element, 'Squat', '56 kg'))).toEqual(['North Example State record']);
    expect(all(element, '.title a')).toEqual([]);
    expect(text(element)).not.toContain('Each record name links');
  });

  /**
   * Requirement 8. Two classes side by side, each named -- and named only when
   * there are two, because a single column headed with the class already stated
   * in the context line above is a heading that says nothing.
   */
  it('draws a column per weight class, named only when there is more than one', async () => {
    const wide = await mount({ selection: FULLY_ANSWERED });
    expect(
      columnsIn(sectionFor(wide, 'Squat')).map((column) => column.querySelector('h4')?.textContent),
    ).toEqual(['52 kg', '56 kg']);

    const narrow = await mount();
    expect(sectionFor(narrow, 'Squat').querySelector('h4')).toBeNull();
  });

  /**
   * Requirement 2. Open is always drawn and is never removable; the chosen
   * division is drawn beside it. A lifter looking at Masters 1 still needs to
   * see what the same lifts are worth in Open, because that is the division
   * most of them enter.
   */
  it('shows the chosen division alongside Open rather than instead of it', async () => {
    const bothDivisions = bookOf([
      record('squat', { kilograms: 145 }),
      record('squat', { kilograms: 120, divisionId: 'masters-1' }),
    ]);
    const element = await mount({
      selection: FULLY_ANSWERED,
      classifications: null,
      reads: [ready(NATIONAL, bothDivisions)],
    });
    const rows = rowsIn(columnFor(element, 'Squat', '56 kg'));
    const tags = rows.map((row) => deepText(only(row, '.tags')));
    expect(tags.some((tag) => tag.includes('Open'))).toBe(true);
    expect(tags.some((tag) => tag.includes('Masters 1'))).toBe(true);
  });

  /**
   * The other half of requirement 2, and the one a reader depends on: a
   * classification table that does not distinguish on division is *not*
   * labelled with one. Labelling it "Open, Masters 1" would say the federation
   * publishes two sets of standards that happen to agree, and a lifter reading
   * that has no way to tell it from a division that really was singled out.
   */
  it('leaves a division off a standard that applies to every division shown', async () => {
    const element = await mount({ selection: FULLY_ANSWERED });
    const first = only(columnFor(element, 'Squat', '56 kg'), 'li.row:first-child .tags');
    expect(deepText(first)).toBe('');
  });

  /**
   * Requirement 4. Every event the federation contests, unasked. The old screen
   * made a lifter pick one, which narrowed the report to a third of what the
   * data can say for an answer they had no reason to have decided.
   */
  it('shows every event without asking which one', async () => {
    const everyEvent = bookOf([
      record('bench', { kilograms: 82.5 }),
      record('bench', { kilograms: 80, disciplineId: 'bench-only' }),
      record('bench', { kilograms: 78, disciplineId: 'push-pull' }),
    ]);
    const element = await mount({
      classifications: null,
      reads: [ready(NATIONAL, everyEvent)],
    });
    const shown = deepText(sectionFor(element, 'Bench press'));
    expect(shown).toContain('Full power');
    expect(shown).toContain('Bench only');
    expect(shown).toContain('Push pull');
  });

  /**
   * A lift nothing is published for is dropped whole, rather than shown as an
   * empty heading between two sections that do have content.
   */
  it('drops a lift it has nothing at all to say about', async () => {
    const element = await mount({ classifications: null });
    expect(sectionHeadings(element)).toEqual(['Squat', 'Bench press', 'Total']);
  });

  /**
   * Requirement 7 and the entries together. A passed rung stays in the ladder,
   * dimmed: removing it would shorten the list under a thumb and move the next
   * row up into a finger already travelling, and a lifter needs to see what
   * they already have as much as what is ahead.
   */
  it('marks what a lifter has passed and what is next, without removing anything', async () => {
    const element = await mount({ entries: typed({ squat: '125' }) });
    const rows = rowsIn(columnFor(element, 'Squat'));
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.classList.contains('reached'))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    // Only the first rung ahead is flagged. Flagging every unreached one would
    // make "next" mean "not yet", which the undimmed rows already say.
    expect(rows.map((row) => row.classList.contains('next'))).toEqual([false, false, true, false]);
    expect(deepText(only(columnFor(element, 'Squat'), 'li.row.next'))).toContain('Next');
  });

  it('marks nothing when nothing has been entered', async () => {
    const element = await mount();
    expect(all(element, '.row.next')).toEqual([]);
    expect(all(element, '.row.reached')).toEqual([]);
  });

  /**
   * The three states of the classification read are three sentences, and only
   * the failed one carries the error tone. A report missing its standards
   * because a read failed looks exactly like a category the federation
   * publishes none for, and the difference is the difference between reloading
   * and planning around it.
   */
  it('distinguishes standards still loading from standards that failed', async () => {
    const loading = await mount({ classifications: null, classificationsStatus: 'loading' });
    expect(text(loading)).toContain('Loading the classification standards…');
    expect(noticesIn(loading).map((notice) => notice.tone)).toEqual(['info']);

    const failed = await mount({ classifications: null, classificationsStatus: 'failed' });
    expect(text(failed)).toContain('The published classification standards could not be loaded.');
    expect(noticesIn(failed).map((notice) => notice.tone)).toEqual(['error']);
  });

  /**
   * Each partition settles on its own, so each is named. A bare "the records
   * could not be loaded" over a report still showing national records reads as
   * covering the ones on screen.
   */
  it('names the partition a record read is waiting on, and the one that failed', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), { partition: NORTH, status: 'loading', book: null }],
    });
    expect(text(element)).toContain('Loading North Example State records…');
    // The national records that did arrive are drawn meanwhile. A report that
    // waited for the last read would be blank for the whole time a phone on gym
    // signal is doing the work.
    expect(titlesIn(columnFor(element, 'Squat', '56 kg'))).toContain('National record');

    const broken = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), { partition: NORTH, status: 'failed', book: null }],
    });
    expect(text(broken)).toContain(
      'The North Example State records could not be loaded. Reload the page to try again.',
    );
    expect(noticesIn(broken).map((notice) => notice.tone)).toEqual(['error']);
  });

  /**
   * Requirement 3. The records above a state are always shown; a state is
   * optional and adds to them rather than replacing them.
   */
  it('adds a state’s records to the national ones rather than swapping them', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
    });
    expect(titlesIn(columnFor(element, 'Squat', '56 kg'))).toEqual([
      'Class III',
      'Class II',
      'North Example State record',
      'National record',
      'Class I',
    ]);
  });

  /**
   * A category the federation publishes nothing for says so, in the cell. A
   * blank column says the same thing as a column that failed to render.
   */
  it('says plainly when a cell has nothing published in it', async () => {
    const element = await mount({ selection: FULLY_ANSWERED, classifications: null });
    // Every record in the book is published for the 56 kg class, so the
    // comparison column is the empty one while the other is full.
    expect(deepText(columnFor(element, 'Squat', '52 kg'))).toContain(
      'Nothing is published for this lift in this category.',
    );
    expect(deepText(columnFor(element, 'Squat', '56 kg'))).not.toContain('Nothing is published');
  });

  /**
   * Reported, never resolved by document order. Two records for one category
   * cannot both be current, and showing the first is a plausible figure that is
   * wrong half the time with nothing on screen to indicate it.
   */
  it('reports a conflict in the published data instead of choosing', async () => {
    const conflicted = await mount({
      classifications: null,
      reads: [
        ready(
          NATIONAL,
          bookOf([record('squat', { kilograms: 145 }), record('squat', { kilograms: 150 })]),
        ),
      ],
    });
    expect(text(conflicted)).toContain(
      'More than one National record is published for Open Full power, so none can be shown.',
    );
    expect(all(conflicted, 'li.row.record')).toEqual([]);
  });

  it('has no accessibility violations', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
      entries: typed({ squat: '125' }),
    });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  /**
   * The widest the report gets, in the narrowest column it has to fit: two
   * classes, two divisions and two partitions at 320 px. §5.7's case, and what
   * the intrinsic grid in `.columns` exists for.
   */
  it('fits a 320 pixel column at its widest', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
    });

    const frame = document.createElement('div');
    frame.style.width = '320px';
    document.body.append(frame);
    teardown.push(() => {
      frame.remove();
    });
    frame.append(element);
    await element.updateComplete;

    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
