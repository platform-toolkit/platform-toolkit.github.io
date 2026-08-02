import type { Lift } from '@platform-toolkit/data-contracts';
import { PtkNotice, PtkSegmented } from '@platform-toolkit/ui';
// Every measurement at the bottom of this file reads a spacing or tap-target
// token, and a declaration referencing an undefined custom property is dropped
// -- so without the stylesheet the 320 px check measures a layout with no gaps
// and the tap-target checks measure controls with no floor.
import '@platform-toolkit/ui/tokens.css';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';

import { deepText } from '../testing/deep-text.js';
import { REFRESH_REQUEST_EVENT } from './freshness.js';
import {
  VIEW_CHANGE_EVENT,
  type PartitionRead,
  type PtkTargetReport,
  type ViewChangeDetail,
} from './ptk-target-report.js';
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
 * the arrangement carries it -- and after the redesign the arrangement *is* the
 * product, so most of this file is about it:
 *
 * - one lift and one target type on screen at a time, chosen with bars that stay
 *   put and a choice that survives the other bar being used;
 * - a real `<table>` with a caption, column headings and row headings, so a cell
 *   is announced with its class and its division rather than as a naked figure;
 * - the chosen age division and Open on adjacent rows inside one block;
 * - the record-attempt rule explained **once** above the matrices, with the two
 *   weights that take a record behind the record a lifter actually taps.
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
  readonly initialLift?: PtkTargetReport['initialLift'];
  readonly initialTargetType?: PtkTargetReport['initialTargetType'];
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
  if (options.initialLift !== undefined) {
    element.initialLift = options.initialLift;
  }
  if (options.initialTargetType !== undefined) {
    element.initialTargetType = options.initialTargetType;
  }
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

/**
 * The element's own shadow root, or a failure.
 *
 * Named rather than written out at forty call sites: `shadowRoot` is nullable,
 * and `?? element` as a fallback would silently search the light DOM and find
 * nothing, which reads as "the element rendered no table" rather than as a
 * missing root.
 */
function root(element: PtkTargetReport): ShadowRoot {
  const { shadowRoot } = element;
  if (shadowRoot === null) {
    throw new Error('The report has no shadow root.');
  }
  return shadowRoot;
}

function all(element: PtkTargetReport, selector: string): Element[] {
  return [...root(element).querySelectorAll(selector)];
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

/** One of the two bars, as the element it is rather than as whatever rendered. */
function bar(element: PtkTargetReport, control: string): PtkSegmented {
  const found = only(root(element), `ptk-segmented[data-control="${control}"]`);
  if (!(found instanceof PtkSegmented)) {
    // Thrown rather than skipped, for the reason the notice helper gives: an
    // unregistered custom element still renders text, so a lenient helper would
    // leave every assertion here passing over a bar with no radios in it.
    throw new Error(`The "${control}" bar rendered as an unregistered element.`);
  }
  return found;
}

async function segmentLabels(element: PtkTargetReport, control: string): Promise<string[]> {
  const control_ = bar(element, control);
  await control_.updateComplete;
  return [...(control_.shadowRoot?.querySelectorAll('label.segment') ?? [])].map((segment) =>
    segment.textContent.trim(),
  );
}

/** Answer one of the bars the way a thumb does. */
async function chooseSegment(
  element: PtkTargetReport,
  control: string,
  label: string,
): Promise<void> {
  const control_ = bar(element, control);
  await control_.updateComplete;
  const segments = [...(control_.shadowRoot?.querySelectorAll('label.segment') ?? [])];
  const found = segments.find((segment) => segment.textContent.trim() === label);
  if (found === undefined) {
    throw new Error(
      `No "${control}" segment labelled "${label}". Found: ${segments
        .map((segment) => segment.textContent.trim())
        .join(', ')}.`,
    );
  }
  const input = only(found, 'input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`The "${label}" segment holds no radio.`);
  }
  input.click();
  await control_.updateComplete;
  await element.updateComplete;
}

/** The records half of the report, which is never what a visit opens on. */
async function showRecords(element: PtkTargetReport): Promise<void> {
  await chooseSegment(element, 'target-type', 'Records');
}

function panelHeading(element: PtkTargetReport): string {
  return only(root(element), '.panel h3').textContent.trim();
}

function tables(element: PtkTargetReport): Element[] {
  return all(element, 'table');
}

function captions(element: PtkTargetReport): string[] {
  return all(element, 'caption').map((caption) => caption.textContent.trim());
}

function groupHeadings(element: PtkTargetReport): string[] {
  return all(element, '.group h4').map((heading) => heading.textContent.trim());
}

function columnHeadings(table: Element): string[] {
  return [...table.querySelectorAll('thead th')].map((heading) => heading.textContent.trim());
}

function bodyRows(table: Element): Element[] {
  return [...table.querySelectorAll('tbody tr')];
}

/** A row heading as a reader hears it: the level, then the division under it. */
function rowLabel(row: Element): string {
  const level = row.querySelector('.level')?.textContent.trim() ?? '';
  const division = row.querySelector('.division')?.textContent.trim();
  return division === undefined ? level : `${level} / ${division}`;
}

function rowLabels(table: Element): string[] {
  return bodyRows(table).map(rowLabel);
}

/**
 * Every printed kilogram figure in a table, row by row, empties included.
 *
 * Scoped to `tbody` deliberately: the header row opens with an empty `<td>`
 * holding the corner above the row headings, and a bare `td` selector reads it
 * as a first cell with no figure in it.
 */
function figuresIn(table: Element): string[] {
  return [...table.querySelectorAll('tbody td')].map((cell) => {
    const kilograms = cell.querySelector('.kilograms');
    return kilograms === null
      ? (cell.querySelector('.empty-figure')?.textContent.trim() ?? '')
      : kilograms.textContent.trim();
  });
}

/** The one table with this caption, so a test names what a reader would read. */
function tableCaptioned(element: PtkTargetReport, caption: string): Element {
  const found = tables(element).find(
    (table) => table.querySelector('caption')?.textContent.trim() === caption,
  );
  if (found === undefined) {
    throw new Error(`No table captioned "${caption}". Found: ${captions(element).join(', ')}.`);
  }
  return found;
}

function recordButtons(element: PtkTargetReport): HTMLButtonElement[] {
  return all(element, 'button.cell-button').map((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('A record cell rendered as something other than a button.');
    }
    return button;
  });
}

/** Open the first record on screen and hand back the panel it revealed. */
async function openFirstRecord(element: PtkTargetReport): Promise<Element> {
  const [button] = recordButtons(element);
  if (button === undefined) {
    throw new Error('No record cell to open.');
  }
  button.click();
  await element.updateComplete;
  return only(root(element), '.detail');
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

/** How many times a sentence is on screen. The redesign is largely about this. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
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
    expect(text(element)).not.toContain('Age division');
  });

  /**
   * Requirement 9 proper, and requirement 7 with it. Nothing optional is
   * answered -- no comparison class, no division, no region -- and the whole
   * classification ladder for the opening lift is on screen.
   */
  it('draws the whole report from the required answers alone', async () => {
    const element = await mount();
    expect(panelHeading(element)).toBe('Squat');
    expect(captions(element)).toEqual(['Classification standards']);
    const table = tableCaptioned(element, 'Classification standards');
    expect(rowLabels(table)).toEqual(['Class III', 'Class II', 'Class I']);
    expect(figuresIn(table)).toEqual(['100 kg', '120 kg', '150 kg']);
  });

  /**
   * The axes every matrix shares, above the matrices. They are answered by
   * controls that scroll off the top of a phone, and a screen full of figures
   * with nothing saying whose they are is the state this line exists to prevent.
   */
  it('states whose report it is', async () => {
    expect(text(await mount())).toContain('56 kg · Open');
    // The chosen division leads, the way it leads the rows below.
    expect(text(await mount({ selection: FULLY_ANSWERED }))).toContain(
      '52 kg and 56 kg · Masters 1 and Open',
    );
  });

  /**
   * P0: one lift at a time.
   *
   * The previous version put all four lifts and every target type on one page --
   * measured at 182 rows and roughly 11,900 CSS pixels on an ordinary category.
   * Four lifts on one page is four times the scrolling to reach the one being
   * planned, so the bar is the unit of navigation and only one panel exists.
   */
  it('shows one lift at a time and moves to the one chosen', async () => {
    const element = await mount();
    expect(await segmentLabels(element, 'lift')).toEqual([
      'Squat',
      'Bench press',
      'Deadlift',
      'Total',
    ]);
    expect(all(element, '.panel')).toHaveLength(1);

    await chooseSegment(element, 'lift', 'Bench press');
    expect(panelHeading(element)).toBe('Bench press');
    expect(all(element, '.panel')).toHaveLength(1);
  });

  /**
   * P0: classifications and records are separate views, not one list sorted by
   * weight. They answer different questions -- "where do I place" and "what
   * would I take" -- and interleaving them makes a reader sort them mentally
   * before they can read either.
   */
  it('keeps classifications and records on separate views', async () => {
    const element = await mount();
    expect(await segmentLabels(element, 'target-type')).toEqual(['Classifications', 'Records']);
    expect(captions(element)).toEqual(['Classification standards']);

    await showRecords(element);
    expect(captions(element)).toEqual(['National records']);
  });

  /**
   * The lift survives a change of target type and the target type survives a
   * change of lift. A bar that reset the other one would send a lifter back to
   * the squat every time they looked at records, which on a phone is most of the
   * interaction.
   */
  it('keeps the chosen lift when the target type changes, and the reverse', async () => {
    const element = await mount();
    await chooseSegment(element, 'lift', 'Total');
    await showRecords(element);
    expect(panelHeading(element)).toBe('Total');
    expect(captions(element)).toEqual(['National records']);

    await chooseSegment(element, 'lift', 'Squat');
    expect(panelHeading(element)).toBe('Squat');
    // Still records: the lift bar answers which lift, and nothing else.
    expect(captions(element)).toEqual(['National records']);
  });

  /**
   * The two bars can be seeded, once.
   *
   * A story that wanted the records half, and later a returning visit that wants
   * to open where the last one left off, both need a way in — and the first
   * paint has to already be on the right lift, because assigning after the first
   * render draws the squat's classifications and then replaces them, which on a
   * slow phone is a visible flash of somebody else's numbers.
   */
  it('opens on the lift and target type it was seeded with', async () => {
    const element = await mount({ initialLift: 'bench', initialTargetType: 'records' });
    expect(panelHeading(element)).toBe('Bench press');
    expect(captions(element)).toEqual(['National records']);
  });

  /**
   * And the seed is read once, never again.
   *
   * The element owns where the bars are, so a live property would let the next
   * parent render put a bar back where the lifter moved it away from — on a
   * screen whose entire navigation is those two bars. Re-rendering here with the
   * seed still set is exactly what a parent does on any unrelated update.
   */
  it('does not put a bar back after the lifter has moved it', async () => {
    const element = await mount({ initialLift: 'bench' });
    await chooseSegment(element, 'lift', 'Total');
    element.entries = typed({ squat: '125' });
    await element.updateComplete;
    expect(panelHeading(element)).toBe('Total');
  });

  /**
   * Where the bars stand is said out loud, so a returning visit can open there.
   *
   * Both bars report, and both report the *pair*: the composition root writes one
   * remembered setting holding both, and a detail carrying only what moved would
   * make it read the other half off a stale render.
   */
  it('says where both bars stand whenever either one moves', async () => {
    const element = await mount();
    const seen: ViewChangeDetail[] = [];
    const listener = (event: CustomEvent<ViewChangeDetail>): void => {
      seen.push(event.detail);
    };
    // On the body, outside the element: the claim is that the event left the
    // shadow root on its way to the root that persists it.
    document.body.addEventListener(VIEW_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(VIEW_CHANGE_EVENT, listener);
    });

    await chooseSegment(element, 'lift', 'Bench press');
    expect(seen.at(-1)).toEqual({ lift: 'bench', targetType: 'classifications' });

    await showRecords(element);
    expect(seen.at(-1)).toEqual({ lift: 'bench', targetType: 'records' });
    expect(seen).toHaveLength(2);
  });

  /**
   * And says nothing for a seed.
   *
   * A root writing the first render to storage would record a default as a
   * decision -- "opens on the squat because that is where I left it" against
   * "opens on the squat because everything does" -- and the second one is a
   * setting that can never be got rid of.
   */
  it('says nothing about the bars until a lifter moves one', async () => {
    const seen: Event[] = [];
    const listener = (event: Event): void => {
      seen.push(event);
    };
    document.body.addEventListener(VIEW_CHANGE_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(VIEW_CHANGE_EVENT, listener);
    });

    const element = await mount({ initialLift: 'bench', initialTargetType: 'records' });
    element.entries = typed({ squat: '125' });
    await element.updateComplete;
    expect(seen).toEqual([]);
  });

  /**
   * The heading takes focus on request, and only on request.
   *
   * Called by the composition root after "Show targets" replaces the whole
   * screen: the button that was pressed no longer exists, so focus falls to the
   * body and a keyboard user's next Tab starts again from the top of the page.
   * `tabindex="-1"` is what lets it be focused without joining the tab order,
   * and asserting on it is the difference between a heading that can be landed
   * on and one a lifter has to Tab past on every pass.
   */
  it('puts focus on the result heading when asked, without joining the tab order', async () => {
    const element = await mount();
    const heading = only(root(element), 'h2');
    expect(heading.getAttribute('tabindex')).toBe('-1');

    element.focusHeading();
    expect(root(element).activeElement).toBe(heading);
  });

  it('is silent about focus when there is no heading to move it to', async () => {
    // The catalogue can still be in flight when the root asks. A root that had
    // to know which branch of this template rendered would be a root that knows
    // this element's template.
    const element = await mount({ catalog: null });
    expect(() => {
      element.focusHeading();
    }).not.toThrow();
  });

  /**
   * The tab set is fixed at four and never shortens.
   *
   * The old page dropped a lift it had nothing to say about, which was right for
   * a page of stacked sections and wrong for a bar: a control whose options
   * appear and disappear as reads settle moves under a thumb already travelling,
   * and a lifter who cannot find the deadlift tab concludes the tool is broken
   * rather than that the federation publishes no deadlift record here.
   */
  it('keeps every lift in the bar and says plainly when one has nothing published', async () => {
    const element = await mount();
    await showRecords(element);
    await chooseSegment(element, 'lift', 'Deadlift');
    expect(await segmentLabels(element, 'lift')).toHaveLength(4);
    expect(tables(element)).toEqual([]);
    expect(text(element)).toContain(
      'No published record was found for this exact Example Federation category. The first qualifying lift sets one.',
    );
  });

  /**
   * P0: a real table.
   *
   * Not a purity argument. A CSS grid of `div`s announces a naked "100" with no
   * row and no column, so the whole context of every cell would have to be
   * duplicated into a hidden string per cell -- a second copy of the same
   * information and a far more verbose reading than the table semantics give
   * for free.
   */
  it('is a real table with a caption and both kinds of heading', async () => {
    const table = tableCaptioned(await mount(), 'Classification standards');
    expect(table.querySelector('caption')).not.toBeNull();
    expect(
      [...table.querySelectorAll('th[scope="col"]')].map((th) => th.textContent.trim()),
    ).toEqual(['56 kg']);
    expect(table.querySelectorAll('th[scope="row"]')).toHaveLength(3);
  });

  /**
   * Requirement 5. Both units in every cell, and the pound figure is not shrunk
   * into a footnote: a lifter who trains in pounds is reading that line.
   */
  it('writes every figure in kilograms and in pounds', async () => {
    const table = tableCaptioned(await mount(), 'Classification standards');
    const [first] = [...table.querySelectorAll('tbody td')];
    expect(first?.querySelector('.kilograms')?.textContent.trim()).toBe('100 kg');
    expect(first?.querySelector('.pounds')?.textContent.trim()).toBe('220.5 lb');
  });

  /**
   * Requirement 8. Two classes in every matrix simultaneously, one column each,
   * and exactly one column when only one class was asked for -- no reserved
   * empty space and no disabled placeholder column, which would read as a
   * comparison the federation publishes nothing for.
   */
  it('draws a column per weight class and nothing for a class nobody asked for', async () => {
    const wide = await mount({ selection: FULLY_ANSWERED });
    expect(columnHeadings(tableCaptioned(wide, 'Classification standards'))).toEqual([
      '52 kg',
      '56 kg',
    ]);

    const narrow = await mount();
    expect(columnHeadings(tableCaptioned(narrow, 'Classification standards'))).toEqual(['56 kg']);
  });

  /**
   * P0, and the single change the whole matrix exists for. Requirement 2 asks
   * for Open beside the chosen division; the previous version satisfied that by
   * interleaving both by target weight, so a lifter comparing their own division
   * against Open had to find the two halves before they could compare anything.
   *
   * Adjacent rows, chosen division first, in **one** `<tbody>` -- the block is
   * what binds them, and a rule between blocks rather than a stripe on alternate
   * rows is what keeps them bound (alternating colour would split exactly the
   * pair this arrangement exists to join, and is discarded under forced colours).
   */
  it('puts the chosen age division and Open on adjacent rows inside one block', async () => {
    const bothDivisions = bookOf([
      record('squat', { kilograms: 145 }),
      record('squat', { kilograms: 120, divisionId: 'masters-1' }),
    ]);
    const element = await mount({
      selection: FULLY_ANSWERED,
      classifications: null,
      reads: [ready(NATIONAL, bothDivisions)],
    });
    await showRecords(element);

    const table = tableCaptioned(element, 'National records');
    expect(rowLabels(table)).toEqual(['National record / Masters 1', 'National record / Open']);
    const bodies = [...table.querySelectorAll('tbody')];
    expect(bodies).toHaveLength(1);
    expect(bodyRows(table)).toHaveLength(2);
  });

  /**
   * The other half of requirement 2, and the one a reader depends on: a table
   * that does not distinguish on division is *not* labelled with one. Labelling
   * it "Open" when Open is the only division shown says the federation singled
   * that division out, and a lifter reading it has no way to tell it from one
   * that really was.
   */
  it('leaves the division off a row when only one division is shown', async () => {
    const table = tableCaptioned(await mount(), 'Classification standards');
    expect(table.querySelector('.division')).toBeNull();
    expect(rowLabels(table)).toEqual(['Class III', 'Class II', 'Class I']);
  });

  /**
   * P0: the matrix shows the record, and the two weights that take it are behind
   * the record a lifter taps.
   *
   * The most dangerous number on the old screen was the one leading a record row:
   * it was the weight that *takes* the record, and a reader who assumed it was
   * the record opened half a kilo light. In a matrix the cell has to be the
   * published fact -- a column of attempt weights under a heading reading
   * "National records" is worse than either -- so the attempts move into the
   * detail, where each is named with the condition it holds under.
   */
  it('shows the record in the cell and the weights that take it only once opened', async () => {
    const element = await mount();
    await showRecords(element);
    const table = tableCaptioned(element, 'National records');
    expect(figuresIn(table)).toEqual(['145 kg']);
    expect(text(element)).not.toContain('145.5');

    const detail = await openFirstRecord(element);
    expect(deepText(detail)).toContain('Current record');
    expect(deepText(detail)).toContain('145 kg');
    expect(
      [...detail.querySelectorAll('.attempt')].map((attempt) => ({
        label: only(attempt, '.attempt-label').textContent.trim(),
        weight: only(attempt, '.attempt-weight').textContent.trim(),
        basis: only(attempt, '.attempt-basis').textContent.trim(),
      })),
    ).toEqual([
      { label: 'Chip target', weight: '145.5 kg', basis: 'Exceeds the record by 0.5 kg' },
      { label: 'Full increment', weight: '147.5 kg', basis: 'Exceeds the record by 2.5 kg' },
    ]);
  });

  /**
   * P0: the rule is explained once.
   *
   * The audited page repeated two long rule sentences under all seventy records.
   * Here two records are on screen -- a state one and a national one -- and the
   * conditions appear nowhere until one of them is opened, at which point they
   * appear on that record and no other.
   */
  it('explains the record rule once above the matrices rather than on every record', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      classifications: null,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
    });
    await showRecords(element);
    expect(recordButtons(element).length).toBeGreaterThan(1);

    const folded = text(element);
    expect(occurrences(folded, 'Meet level affects the attempt needed to break a record.')).toBe(1);
    expect(text(element)).toContain('How record attempts work');
    expect(occurrences(folded, 'At a meet of this level or below')).toBe(0);
    expect(occurrences(folded, 'At a meet above this level')).toBe(0);

    await openFirstRecord(element);
    expect(occurrences(text(element), 'At a meet of this level or below')).toBe(1);
  });

  /**
   * Said in the fold and again in every record detail, on purpose -- the one
   * sentence in the tool that is deliberately repeated. A reader who opens a
   * record without reading the fold is about to plan an attempt, and the note
   * that this application does not adjudicate one has to be where the attempt is
   * chosen.
   */
  it('says who decides, both in the fold and on the record being planned', async () => {
    const element = await mount();
    await showRecords(element);
    const sentence =
      'Meet sanction level and eligibility decide which record attempt is permitted.';
    expect(occurrences(text(element), sentence)).toBe(1);

    await openFirstRecord(element);
    expect(occurrences(text(element), sentence)).toBe(2);
  });

  /** One at a time: several open folds push the matrices apart until the comparison is off screen. */
  it('opens one record at a time and closes the open one on the way past', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      classifications: null,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
    });
    await showRecords(element);
    const [first, second] = recordButtons(element);
    if (first === undefined || second === undefined) {
      throw new Error('Expected at least two records on screen.');
    }

    first.click();
    await element.updateComplete;
    expect(all(element, '.detail')).toHaveLength(1);
    expect(first.getAttribute('aria-expanded')).toBe('true');

    second.click();
    await element.updateComplete;
    expect(all(element, '.detail')).toHaveLength(1);
    expect(recordButtons(element).map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
    ]);
  });

  /** Tapping the open one again closes it, which is what the caret promises. */
  it('closes a record that is tapped a second time', async () => {
    const element = await mount();
    await showRecords(element);
    await openFirstRecord(element);
    const [button] = recordButtons(element);
    button?.click();
    await element.updateComplete;
    expect(all(element, '.detail')).toEqual([]);
  });

  /**
   * A detail belongs to a record in the lift and the target type that were on
   * screen. Left open across either bar it would draw somebody else's record
   * under a table it is not in.
   */
  it('closes an open record when the lift or the target type changes', async () => {
    const element = await mount();
    await showRecords(element);
    await openFirstRecord(element);
    await chooseSegment(element, 'lift', 'Bench press');
    expect(all(element, '.detail')).toEqual([]);

    await openFirstRecord(element);
    await chooseSegment(element, 'target-type', 'Classifications');
    expect(all(element, '.detail')).toEqual([]);
  });

  /**
   * P1. A cell in a table is announced with its row and column headings, but the
   * lift, the record scope and the division live in the caption and the bars
   * above it -- and a reader who reaches a button from a rotor or an element
   * list hears none of them. So a record cell carries the whole context.
   *
   * A classification cell carries one too, for the same reason and not because
   * the table failed to name it. Since goal selection landed, that cell is a
   * button -- and a button is exactly what a reader reaches from a rotor or an
   * element list, arriving with none of the caption, the bars or the row and
   * column headings that would otherwise have named it. "Class I, 56 kg: 150
   * kilograms" is the review's own worked example of what such a button has to
   * say. (Before it was selectable the cell was plain text, and a label on it
   * would have *replaced* the headings' reading with a hand-written string --
   * which is why the rule reads the other way round now.)
   *
   * The division follows the same rule the row headings follow -- named when the
   * report distinguishes on it, absent when it does not. Saying "Open" on a
   * report that shows only Open claims the federation singled that division out.
   */
  it('names a cell with the whole context it sits in', async () => {
    const element = await mount();
    await showRecords(element);
    expect(recordButtons(element).map((button) => button.getAttribute('aria-label'))).toEqual([
      'National record, Full power, 56 kg: 145 kilograms',
    ]);

    await chooseSegment(element, 'target-type', 'Classifications');
    expect(
      all(element, 'td [aria-label]').map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Class III, 56 kg: 100 kilograms',
      'Class II, 56 kg: 120 kilograms',
      'Class I, 56 kg: 150 kilograms',
    ]);
  });

  it('names the division in a record cell once the report distinguishes on one', async () => {
    const bothDivisions = bookOf([
      record('squat', { kilograms: 145 }),
      record('squat', { kilograms: 120, divisionId: 'masters-1' }),
    ]);
    const element = await mount({
      selection: FULLY_ANSWERED,
      classifications: null,
      reads: [ready(NATIONAL, bothDivisions)],
    });
    await showRecords(element);
    expect(recordButtons(element).map((button) => button.getAttribute('aria-label'))).toEqual([
      'National record, Full power, Masters 1, 56 kg: 120 kilograms',
      'National record, Full power, Open, 56 kg: 145 kilograms',
    ]);
  });

  /**
   * The comfortable floor rather than the 44 px minimum (§5.7 and tokens.css):
   * this is tapped repeatedly, one-handed, while reading.
   */
  it('gives a record cell a real tap target', async () => {
    const element = await mount();
    await showRecords(element);
    const [button] = recordButtons(element);
    expect(button?.getBoundingClientRect().height ?? 0).toBeGreaterThanOrEqual(48);
  });

  it('says who holds a record, with the date left unlocalised', async () => {
    const element = await mount();
    await showRecords(element);
    const detail = await openFirstRecord(element);
    expect(deepText(detail)).toContain('Robin Vance · 2024-05-18 · Example Winter Open');
    // `03/04/2022` is two different days depending on who is holding the phone,
    // and these tools are read wherever the federation runs meets.
    expect(
      [...detail.querySelectorAll('time')].map((time) => time.getAttribute('datetime')),
    ).toEqual(['2024-05-18']);
  });

  /**
   * The federation publishes each record twice on one row, in kilograms and in
   * pounds, and on a corpus this size the two sometimes disagree by more than
   * rounding can explain. Both figures are named, because a caution that only
   * said "this figure may be wrong" gives a lifter a reason to distrust a record
   * with no way to resolve it -- and the detail already links to the table where
   * the question can be settled.
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
    await showRecords(element);
    // The kilogram column still governs, in the cell and in the arithmetic:
    // nothing here is derived from 14.51.
    expect(figuresIn(tableCaptioned(element, 'National records'))).toEqual(['145 kg']);

    const detail = await openFirstRecord(element);
    expect(deepText(detail)).toContain(
      "The federation's table also prints this record as 32 lb, which is 14.51 kg.",
    );
    expect(
      [...detail.querySelectorAll('.attempt .attempt-weight')].map((weight) =>
        weight.textContent.trim(),
      ),
    ).toEqual(['145.5 kg', '147.5 kg']);
  });

  it('draws no caution when the source agrees with itself', async () => {
    // Which is nearly every row. Asserted because the caution is rendered from a
    // nullable field, and a template that drew it unconditionally would put a
    // contradiction notice under every record in the collection.
    const element = await mount();
    await showRecords(element);
    await openFirstRecord(element);
    expect(all(element, '.caution')).toEqual([]);
  });

  /**
   * Requirement 12, and the P1 that came with it. The link goes to the *table*
   * the record is published in -- no federation this project reads publishes a
   * per-record certificate -- and its accessible name carries the record's whole
   * scope. Seventy links all named "National record" is a link list with no way
   * to tell one from another.
   */
  it('links a record back to the table the federation publishes it in', async () => {
    const element = await mount();
    await showRecords(element);
    const detail = await openFirstRecord(element);
    const link = only(detail, '.source-link');
    expect(link.getAttribute('href')).toBe(
      'https://records.example.test/records?level=national&event=raw-full-power',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    // The referrer would carry the page a lifter is reading, and these tools are
    // embedded on third-party sites where that is the embedder's URL.
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-label')).toBe(
      'Published table for National record, Full power, 56 kg',
    );
  });

  /**
   * The tap-target floor applies to a link too (§5.7). It is reachable here only
   * because the link is its own line rather than a link inside a sentence --
   * vertical padding on an inline box grows the hit area without growing the
   * line, so a thumb aiming at the prose above would open a new tab.
   */
  it('gives a record link a real tap target', async () => {
    const element = await mount();
    await showRecords(element);
    const detail = await openFirstRecord(element);
    expect(only(detail, '.source-link').getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it('shows no link for a record the book lists no table for', async () => {
    // The state book lists no source table for its own scope, so the record is
    // shown and no link is -- rather than a link assembled from the axes, which
    // would resolve and show somebody else's category.
    const element = await mount({
      selection: FULLY_ANSWERED,
      classifications: null,
      reads: [ready(NORTH, STATE_BOOK)],
    });
    await showRecords(element);
    const detail = await openFirstRecord(element);
    expect(detail.querySelector('.source-link')).toBeNull();
  });

  /**
   * Requirement 4. Every event the federation contests, unasked, each as its own
   * heading over its own matrix. The old screen made a lifter pick one, which
   * narrowed the report to a third of what the data can say for an answer they
   * had no reason to have decided.
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
    await showRecords(element);
    await chooseSegment(element, 'lift', 'Bench press');
    expect(groupHeadings(element)).toEqual(['Full power', 'Bench only', 'Push pull']);
  });

  /** One event contesting a lift gets no heading: a heading over a lone matrix says nothing. */
  it('drops the event heading when only one event contests the lift', async () => {
    const element = await mount({ classifications: null });
    await showRecords(element);
    expect(groupHeadings(element)).toEqual([]);
    expect(captions(element)).toEqual(['National records']);
  });

  /**
   * Requirement 3. The records above a state are always shown; a state is
   * optional and adds a matrix rather than replacing one.
   */
  it('adds a state’s records to the national ones rather than swapping them', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
    });
    await showRecords(element);
    expect(captions(element)).toEqual(['North Example State records', 'National records']);
  });

  /**
   * A category the federation publishes nothing for says so, in the cell, in
   * words. Never zero, never a bare dash, and never a figure inferred from the
   * neighbouring column -- and the two absences are different sentences, because
   * "no standard is published" and "no record stands yet" are different facts
   * and only one of them is an invitation.
   */
  it('says what an empty cell means rather than leaving it blank', async () => {
    const element = await mount({ selection: FULLY_ANSWERED });
    // Every classification standard is published for both classes and both
    // divisions, so nothing in that matrix is empty -- which is what makes the
    // records matrix below a fair test of the empty cell rather than of a
    // fixture that happens to be sparse everywhere.
    expect(
      figuresIn(tableCaptioned(element, 'Classification standards')).filter(
        (figure) => !figure.endsWith(' kg'),
      ),
    ).toEqual([]);

    await showRecords(element);
    // One record in the whole matrix -- 56 kg Open. The masters row and the
    // comparison class are all empty, and each says which kind of empty it is.
    expect(figuresIn(tableCaptioned(element, 'National records'))).toEqual([
      'None yet',
      'None yet',
      'None yet',
      '145 kg',
    ]);
    // "None yet" rather than "Not published": a record nobody has set is an
    // invitation, and a standard the federation does not publish is not. The two
    // absences look identical in a table and mean opposite things.
    expect(text(element)).not.toContain('Not published');
  });

  /**
   * Requirement 7 and the entries together. A passed figure stays in the matrix,
   * dimmed: removing it would shorten the table under a thumb and move the next
   * row up into a finger already travelling, and a lifter needs to see what they
   * already have as much as what is ahead. The mark is a word, never a colour.
   */
  it('marks what a lifter has passed and what is next, without removing anything', async () => {
    const element = await mount({ entries: typed({ squat: '125' }) });
    const table = tableCaptioned(element, 'Classification standards');
    expect(bodyRows(table)).toHaveLength(3);
    expect(
      [...table.querySelectorAll('tbody td')].map((cell) => cell.classList.contains('reached')),
    ).toEqual([true, true, false]);
    // Only the first figure ahead is flagged. Flagging every unreached one would
    // make "next" mean "not yet", which the undimmed rows already say.
    expect([...table.querySelectorAll('.flag')].map((flag) => flag.textContent.trim())).toEqual([
      'Reached',
      'Reached',
      'Next',
    ]);
  });

  it('marks nothing when nothing has been entered', async () => {
    const element = await mount();
    expect(all(element, '.flag')).toEqual([]);
    expect(all(element, '.reached')).toEqual([]);
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
    expect(text(loading)).toContain('Updating the classification standards…');
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
    expect(text(element)).toContain('Updating North Example State records…');
    // The national records that did arrive are drawn meanwhile. A report that
    // waited for the last read would be blank for the whole time a phone on gym
    // signal is doing the work.
    await showRecords(element);
    expect(captions(element)).toEqual(['National records']);

    const broken = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), { partition: NORTH, status: 'failed', book: null }],
    });
    expect(text(broken)).toContain('The North Example State records could not be loaded.');
    expect(noticesIn(broken).map((notice) => notice.tone)).toEqual(['error']);
  });

  /**
   * A failed read is offered the one action that can change it, and the action
   * is a retry rather than a reload.
   *
   * "Reload the page to try again" was the old sentence and it was the wrong
   * instruction twice over on the device this is built for: a reload on gym
   * signal discards the shell and every artifact that *did* arrive, and it takes
   * the context, the lift, the target type and the open detail with it -- so
   * retrying one failed partition cost re-answering the whole report.
   */
  it('offers a retry beside a failed read rather than telling a lifter to reload', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), { partition: NORTH, status: 'failed', book: null }],
    });
    expect(text(element)).not.toContain('Reload the page');

    const seen: Event[] = [];
    const listener = (event: Event): void => {
      seen.push(event);
    };
    // On the body rather than on the element: the transport listens on the
    // tool's host, so a listener on the element itself would hold even for an
    // event that never left the shadow root.
    document.body.addEventListener(REFRESH_REQUEST_EVENT, listener);
    teardown.push(() => {
      document.body.removeEventListener(REFRESH_REQUEST_EVENT, listener);
    });

    const retry = only(root(element), '.failure ptk-button');
    if (!(retry instanceof HTMLElement)) {
      throw new Error('The retry rendered as something other than an element.');
    }
    retry.click();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.composed).toBe(true);
  });

  /**
   * A failed partition is drawn in the error tone and the levels beside it are
   * not, which is the reason the reads are kept separate at all.
   *
   * One status for the lot would render a failed state read as a federation that
   * keeps no state records -- a real answer, and one nobody investigates.
   */
  it('names the level that failed without colouring the rest of the report', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), { partition: NORTH, status: 'failed', book: null }],
    });
    expect(text(element)).toContain('The North Example State records could not be loaded.');
    expect(noticesIn(element).map((notice) => notice.tone)).toEqual(['error']);
    // The level that did answer is still drawn in full underneath.
    await showRecords(element);
    expect(captions(element)).toContain('National records');
  });

  /**
   * "No published target was found" is a *finding*, and printing it while the
   * artifact that would contradict it is still on the wire is the tool asserting
   * something it has not established. On gym signal that window is seconds long
   * and it lands on the reader least able to check: they read that their
   * category is empty, put the phone away, and never see the figures arrive.
   */
  it('draws a skeleton rather than claiming nothing is published while a read is in flight', async () => {
    const element = await mount({ classifications: null, classificationsStatus: 'loading' });
    expect(text(element)).toContain('Updating targets…');
    expect(text(element)).not.toContain('No published target was found');
    // Grey bars have nothing to announce; the sentence above them carries the
    // whole meaning for anyone not looking at the layout.
    expect(only(root(element), '.skeleton').getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * The tick between a lifter pressing Show targets and the transport issuing
   * the reads. Treating an empty read map as settled makes the first paint of
   * every visit assert that the category is empty -- a resolved selection always
   * asks for the world and national partitions, so no entries at all means the
   * watcher has not run rather than that this federation keeps no records.
   */
  it('does not call a category empty before the record reads have been issued', async () => {
    const element = await mount({ reads: [] });
    await showRecords(element);
    expect(text(element)).toContain('Updating targets…');
    expect(text(element)).not.toContain('No published record was found');
  });

  /**
   * Reported, never resolved by document order. Two records for one category
   * cannot both be current, and showing the first is a plausible figure that is
   * wrong half the time with nothing on screen to indicate it.
   *
   * Reported *in the panel it arises in*, too: a conflict in the records must
   * not blank the classifications, which are read from a different artifact and
   * are not in doubt.
   */
  it('reports a conflict in the published data instead of choosing', async () => {
    const element = await mount({
      reads: [
        ready(
          NATIONAL,
          bookOf([record('squat', { kilograms: 145 }), record('squat', { kilograms: 150 })]),
        ),
      ],
    });
    expect(captions(element)).toEqual(['Classification standards']);

    await showRecords(element);
    expect(text(element)).toContain(
      'More than one National record is published for Open Full power, so none can be shown.',
    );
    expect(tables(element)).toEqual([]);
  });

  it('has no accessibility violations showing classifications', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
      entries: typed({ squat: '125' }),
    });
    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  /**
   * And again with a record open, because that is where the interactive parts
   * are: the cell buttons carry `aria-expanded` and `aria-controls`, and the
   * panel they name has to exist and be reachable.
   */
  it('has no accessibility violations showing a record in full', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
    });
    await showRecords(element);
    const detail = await openFirstRecord(element);
    expect(only(root(element), 'button[aria-expanded="true"]').getAttribute('aria-controls')).toBe(
      detail.id,
    );

    const results = await axe.run(element, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  /**
   * The widest the report gets, in the narrowest column it has to fit: two
   * classes, two divisions, two partitions and an open record at 320 px. §5.7's
   * case, and the reason the tables are `table-layout: fixed` with wrapping
   * text -- the worst case has to be an ugly two-line number rather than a
   * document that scrolls sideways.
   */
  it('fits a 320 pixel column at its widest', async () => {
    const element = await mount({
      selection: FULLY_ANSWERED,
      reads: [ready(NATIONAL, BOOK), ready(NORTH, STATE_BOOK)],
    });
    await showRecords(element);
    await openFirstRecord(element);

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
