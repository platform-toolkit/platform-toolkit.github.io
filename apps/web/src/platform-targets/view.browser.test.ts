import { DataSourceError, type DataSource } from '@platform-toolkit/data-access';
import type { CategoryCatalog, ClassificationBook } from '@platform-toolkit/data-contracts';
import type { PtkChoiceGroup } from '@platform-toolkit/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PtkPlatformTargets } from './ptk-platform-targets.js';
import type { SelectionField } from './selection.js';
import { createPlatformTargetsView } from './view.js';

/** Invented figures. Real boundaries belong in published data. */
const CATALOG: CategoryCatalog = {
  id: 'example',
  label: 'Example Federation',
  equipment: [
    { id: 'raw', label: 'Raw' },
    { id: 'single-ply', label: 'Single-ply' },
  ],
  weightClassLadders: [
    {
      id: 'example-female',
      label: 'Female classes',
      sex: 'female',
      classes: [{ id: 'f-56', label: '56 kg', maximumKilograms: 56 }],
    },
    {
      id: 'example-male',
      label: 'Male classes',
      sex: 'male',
      classes: [{ id: 'm-75', label: '75 kg', maximumKilograms: 75 }],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [{ id: 'open', label: 'Open', minimumAge: null, maximumAge: null }],
  },
};

const BOOK: ClassificationBook = {
  id: 'example',
  label: 'Example Federation',
  tables: [
    {
      id: 'example-squat',
      label: 'Squat',
      scope: {
        sex: 'female',
        lift: 'squat',
        equipmentId: null,
        weightClassId: null,
        divisionId: null,
        tested: null,
      },
      standards: [{ id: 'first', label: 'Class I', rank: 0, requiredKilograms: 100 }],
    },
  ],
};

/**
 * A source that records what it was asked for.
 *
 * Records and conversion charts are not read by this view, so those methods
 * answer `null` rather than throwing: a stub that threw would turn "nothing asks
 * for this" into a failure the day something does, which is a worse way to find
 * out.
 */
function sourceThat(
  answer: () => Promise<CategoryCatalog | null>,
  classifications: () => Promise<ClassificationBook | null> = () => Promise.resolve(BOOK),
): DataSource & { federations: string[]; partitions: string[] } {
  const federations: string[] = [];
  const partitions: string[] = [];
  return {
    kind: 'static',
    federations,
    partitions,
    getDataMeta: () => Promise.reject(new Error('not used by this view')),
    getCategoryCatalog: (federationId: string) => {
      federations.push(federationId);
      return answer();
    },
    getRecords: () => Promise.resolve(null),
    getConversionChart: () => Promise.resolve(null),
    getClassifications: (query) => {
      partitions.push(`${query.federationId} ${query.sex} ${query.equipmentId}`);
      return classifications();
    },
  };
}

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
  vi.restoreAllMocks();
});

/** Not a real federation: the point is that the view asks for what it was given. */
const FEDERATION_ID = 'example-federation';

function mount(source: DataSource): PtkPlatformTargets {
  const element = createPlatformTargetsView({ source, federationId: FEDERATION_ID });
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

function categories(element: PtkPlatformTargets): ShadowRoot {
  const found = element.shadowRoot?.querySelector('ptk-target-categories')?.shadowRoot;
  if (found === null || found === undefined) {
    throw new Error('The questions have not rendered.');
  }
  return found;
}

function standards(element: PtkPlatformTargets): ShadowRoot {
  const found = element.shadowRoot?.querySelector('ptk-target-standards')?.shadowRoot;
  if (found === null || found === undefined) {
    throw new Error('The standards panel has not rendered.');
  }
  return found;
}

/** Answers one question the way a visitor does: by clicking the radio. */
async function choose(
  element: PtkPlatformTargets,
  field: SelectionField,
  value: string,
): Promise<void> {
  const group = categories(element).querySelector<PtkChoiceGroup>(
    `ptk-choice-group[data-field="${field}"]`,
  );
  const radios = group?.shadowRoot?.querySelectorAll('input[type="radio"]') ?? [];
  for (const radio of radios) {
    if (radio instanceof HTMLInputElement && radio.value === value) {
      radio.click();
      await element.updateComplete;
      return;
    }
  }
  throw new Error(`No option "${value}" in the "${field}" group.`);
}

/** Every question answered, in order, so a partition can be named. */
async function answerEverything(element: PtkPlatformTargets): Promise<void> {
  await choose(element, 'sex', 'female');
  await choose(element, 'equipment', 'raw');
  await choose(element, 'weightClass', 'f-56');
  await choose(element, 'division', 'open');
  await choose(element, 'tested', 'tested');
}

describe('createPlatformTargetsView', () => {
  it('returns something with a height before the read finishes', async () => {
    // The embed route posts its height to the parent as soon as it can. An
    // element that renders nothing until the catalogue lands reports zero and
    // then jumps, which is worse for the embedding page than a stable box.
    const element = mount(sourceThat(() => new Promise<CategoryCatalog | null>(() => undefined)));

    await element.updateComplete;
    expect(categories(element).textContent).toContain('Loading');
  });

  it('shows the questions once the catalogue arrives', async () => {
    const element = mount(sourceThat(() => Promise.resolve(CATALOG)));

    await vi.waitFor(() => {
      expect(categories(element).querySelectorAll('ptk-choice-group').length).toBe(5);
    });
  });

  it('shows a field for every lift alongside the questions', async () => {
    const element = mount(sourceThat(() => Promise.resolve(CATALOG)));

    await vi.waitFor(() => {
      expect(standards(element).querySelectorAll('ptk-number-field').length).toBe(4);
    });
  });

  it('asks for the federation the page declared, and no other', () => {
    // A federation the code has never heard of, so a view that fell back to a
    // constant would fail here rather than pass by coincidence -- which is the
    // whole reason the option is required instead of defaulted.
    const source = sourceThat(() => Promise.resolve(CATALOG));
    mount(source);
    expect(source.federations).toEqual([FEDERATION_ID]);
  });

  it('treats an unpublished federation as an answer, not as a failure', async () => {
    // Telling a reader to reload a page that will never load is worse than
    // saying plainly that nothing is published for them yet.
    const element = mount(sourceThat(() => Promise.resolve(null)));

    await vi.waitFor(() => {
      expect(categories(element).textContent).toContain('have not been published');
    });
  });

  it('says the read failed, and says nothing more than the reason', async () => {
    // Not swallowed -- a page that silently shows "loading" forever is the worst
    // of the options. Not the error object either: its cause is whatever the
    // transport threw, and a console expands a cause chain, which is where a
    // request URL would appear.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const element = mount(
      sourceThat(() => Promise.reject(new DataSourceError('categories-uspa', 'http', 404))),
    );

    await vi.waitFor(() => {
      expect(categories(element).textContent).toContain('could not be loaded');
    });
    expect(reported).toHaveBeenCalledWith(
      'Platform Targets could not load the category catalogue: http.',
    );
  });

  it('reports an unrecognised failure without letting its text through', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(sourceThat(() => Promise.reject(new Error('https://data.example.invalid/secret'))));

    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledWith(
        'Platform Targets could not load the category catalogue: unexpected.',
      );
    });
  });
});

describe('loading the standards for a category', () => {
  async function answered(
    source: DataSource & { partitions: string[] },
  ): Promise<PtkPlatformTargets> {
    const element = mount(source);
    await vi.waitFor(() => {
      expect(categories(element).querySelectorAll('ptk-choice-group').length).toBe(5);
    });
    await answerEverything(element);
    return element;
  }

  it('reads nothing until the lifter has named a sex and an equipment category', async () => {
    // Those two choose the artifact. Reading before both are answered would
    // fetch a partition for a category the lifter has not identified.
    const source = sourceThat(() => Promise.resolve(CATALOG));
    const element = mount(source);
    await vi.waitFor(() => {
      expect(categories(element).querySelectorAll('ptk-choice-group').length).toBe(5);
    });

    await choose(element, 'sex', 'female');
    expect(source.partitions).toEqual([]);

    await choose(element, 'equipment', 'raw');
    expect(source.partitions).toEqual([`${FEDERATION_ID} female raw`]);
  });

  it('does not read again for an answer that cannot change the partition', async () => {
    // One shard holds every lift, weight class and division for a sex and
    // equipment category. Re-reading on each answer would issue a request per
    // click for a file already in hand.
    const source = sourceThat(() => Promise.resolve(CATALOG));
    await answered(source);

    expect(source.partitions).toEqual([`${FEDERATION_ID} female raw`]);
  });

  it('reads the other partition when the equipment category changes', async () => {
    const source = sourceThat(() => Promise.resolve(CATALOG));
    const element = await answered(source);

    await choose(element, 'equipment', 'single-ply');

    expect(source.partitions).toEqual([
      `${FEDERATION_ID} female raw`,
      `${FEDERATION_ID} female single-ply`,
    ]);
  });

  it('reads the other partition when the sex category changes', async () => {
    const source = sourceThat(() => Promise.resolve(CATALOG));
    const element = await answered(source);

    await choose(element, 'sex', 'male');

    expect(source.partitions).toEqual([`${FEDERATION_ID} female raw`, `${FEDERATION_ID} male raw`]);
  });

  it('places a lift once the standards have arrived', async () => {
    const source = sourceThat(() => Promise.resolve(CATALOG));
    const element = await answered(source);

    const field = standards(element).querySelector('ptk-number-field[data-lift="squat"]');
    const input = field?.shadowRoot?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('The squat field rendered no input.');
    }
    input.value = '120';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    await vi.waitFor(() => {
      expect(standards(element).textContent).toContain('Class I.');
    });
  });

  it('says the standards failed to load without naming what it asked for', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = sourceThat(
      () => Promise.resolve(CATALOG),
      () => Promise.reject(new DataSourceError('classifications-example-female-raw', 'http', 404)),
    );
    const element = await answered(source);

    await vi.waitFor(() => {
      expect(standards(element).textContent).toContain('could not be loaded');
    });
    expect(reported).toHaveBeenCalledWith(
      'Platform Targets could not load the classification standards: http.',
    );
  });

  it('treats a category with no published standards as an answer', async () => {
    // Real today: several published divisions have no standards at all. A
    // failure notice would send someone to reload a page that will never change.
    const source = sourceThat(
      () => Promise.resolve(CATALOG),
      () => Promise.resolve(null),
    );
    const element = await answered(source);

    await vi.waitFor(() => {
      expect(standards(element).textContent).toContain('publishes no standards');
    });
    expect(standards(element).textContent).not.toContain('could not be loaded');
  });

  it('never lets a slow read for an abandoned category win', async () => {
    // Two partitions in flight can settle out of order. The loser would paint
    // the panel with standards for the equipment category the lifter just left
    // -- a plausible table, tens of kilograms out, with nothing to indicate it.
    const settle: ((book: ClassificationBook | null) => void)[] = [];
    const source = sourceThat(
      () => Promise.resolve(CATALOG),
      () =>
        new Promise<ClassificationBook | null>((resolve) => {
          settle.push(resolve);
        }),
    );
    const element = await answered(source);
    await choose(element, 'equipment', 'single-ply');

    const [first, second] = settle;
    if (first === undefined || second === undefined) {
      throw new Error('Expected two reads to be in flight.');
    }
    // The second partition answers first, then the abandoned first one answers.
    second({ ...BOOK, label: 'Single-ply standards' });
    first({ ...BOOK, label: 'Raw standards' });
    await vi.waitFor(() => {
      expect(element.book?.label).toBe('Single-ply standards');
    });
    expect(element.book?.label).toBe('Single-ply standards');
  });
});
