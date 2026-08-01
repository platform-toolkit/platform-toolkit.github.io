import { DataSourceError, type DataSource } from '@platform-toolkit/data-access';
import type { CategoryCatalog } from '@platform-toolkit/data-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PtkTargetCategories } from './ptk-target-categories.js';
import { createPlatformTargetsView } from './view.js';

/** Invented figures. Real boundaries belong in published data. */
const CATALOG: CategoryCatalog = {
  id: 'example',
  label: 'Example Federation',
  equipment: [{ id: 'raw', label: 'Raw' }],
  weightClassLadders: [
    {
      id: 'example-female',
      label: 'Female classes',
      sex: 'female',
      classes: [{ id: 'f-56', label: '56 kg', maximumKilograms: 56 }],
    },
  ],
  ageDivisions: {
    id: 'example-divisions',
    label: 'Divisions',
    basis: 'age-on-meet-date',
    divisions: [{ id: 'open', label: 'Open', minimumAge: null, maximumAge: null }],
  },
};

/** A source that answers only `getCategoryCatalog`; nothing else is read yet. */
function sourceThat(
  answer: () => Promise<CategoryCatalog | null>,
): DataSource & { federations: string[] } {
  const federations: string[] = [];
  return {
    kind: 'static',
    federations,
    getDataMeta: () => Promise.reject(new Error('not used by this view')),
    getCategoryCatalog: (federationId: string) => {
      federations.push(federationId);
      return answer();
    },
    getRecords: () => Promise.resolve(null),
  };
}

const teardown: (() => void)[] = [];

afterEach(() => {
  for (const dispose of teardown.splice(0)) {
    dispose();
  }
  vi.restoreAllMocks();
});

function mount(source: DataSource): PtkTargetCategories {
  const element = createPlatformTargetsView({ source });
  document.body.append(element);
  teardown.push(() => {
    element.remove();
  });
  return element;
}

describe('createPlatformTargetsView', () => {
  it('returns something with a height before the read finishes', async () => {
    // The embed route posts its height to the parent as soon as it can. An
    // element that renders nothing until the catalogue lands reports zero and
    // then jumps, which is worse for the embedding page than a stable box.
    const element = mount(sourceThat(() => new Promise<CategoryCatalog | null>(() => undefined)));

    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain('Loading');
  });

  it('shows the questions once the catalogue arrives', async () => {
    const element = mount(sourceThat(() => Promise.resolve(CATALOG)));

    await vi.waitFor(() => {
      expect(element.shadowRoot?.querySelectorAll('ptk-choice-group').length).toBe(4);
    });
  });

  it('asks for the federation the route is for', () => {
    const source = sourceThat(() => Promise.resolve(CATALOG));
    mount(source);
    expect(source.federations).toEqual(['uspa']);
  });

  it('treats an unpublished federation as an answer, not as a failure', async () => {
    // Telling a reader to reload a page that will never load is worse than
    // saying plainly that nothing is published for them yet.
    const element = mount(sourceThat(() => Promise.resolve(null)));

    await vi.waitFor(() => {
      expect(element.shadowRoot?.textContent).toContain('have not been published');
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
      expect(element.shadowRoot?.textContent).toContain('could not be loaded');
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
