import { describe, expect, it } from 'vitest';

import { CategorySourceError, buildCategoryCatalog } from './category-catalog.js';

/**
 * Every figure below is invented. Real class boundaries live in
 * `data/sources/`, and a test asserting them would be a second place they are
 * written down -- so the day a federation moved one, the test would fail for
 * being correct.
 */
function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'example',
    label: 'Example Federation',
    provenance: {
      id: 'example-categories',
      label: 'Example categories',
      document: 'Example Technical Rules 1999v1',
      url: 'https://example.invalid/rules',
      sections: ['Item 1'],
      retrievedAt: '1999-01-01T00:00:00.000Z',
    },
    equipment: [{ id: 'raw', label: 'Raw' }],
    weightClassLadders: [
      {
        id: 'example-female',
        label: 'Women',
        sex: 'female',
        classes: [
          { id: 'f-40', maximumKilograms: 40 },
          { id: 'f-47.5', maximumKilograms: 47.5 },
          { id: 'f-open', maximumKilograms: null },
        ],
      },
    ],
    ageDivisions: {
      id: 'example-divisions',
      label: 'Example divisions',
      basis: 'age-on-meet-date',
      divisions: [
        { id: 'open', label: 'Open', minimumAge: 13, maximumAge: null },
        { id: 'master-1', label: 'Master 1', minimumAge: 40, maximumAge: 44 },
      ],
    },
    ...overrides,
  };
}

/** The problems reported by a build that should have failed. */
function problemsFrom(candidate: unknown): readonly string[] {
  try {
    buildCategoryCatalog(candidate);
  } catch (error) {
    if (error instanceof CategorySourceError) {
      return error.problems;
    }
    throw error;
  }
  throw new Error('Expected the document to be rejected, but it was accepted.');
}

describe('buildCategoryCatalog', () => {
  it('produces a catalogue and a freshness entry from a well-formed document', () => {
    const { catalog, freshness } = buildCategoryCatalog(document());

    expect(catalog.id).toBe('example');
    expect(catalog.equipment).toEqual([{ id: 'raw', label: 'Raw' }]);
    expect(catalog.ageDivisions.basis).toBe('age-on-meet-date');
    expect(freshness).toEqual({
      id: 'example-categories',
      label: 'Example categories (Example Technical Rules 1999v1)',
      // The date the document was read, not the date this test ran. A build
      // stamping its own clock here would report any transcription as current.
      retrievedAt: '1999-01-01T00:00:00.000Z',
      status: 'ok',
    });
  });

  it('derives each class caption from its boundary', () => {
    const { catalog } = buildCategoryCatalog(document());
    const [ladder] = catalog.weightClassLadders;

    expect(ladder?.classes.map((weightClass) => weightClass.label)).toEqual([
      // No trailing zero on a whole number, and the fraction preserved on the
      // one that has it.
      '40 kg',
      '47.5 kg',
      // Named for the class below it, which is the only thing that says what
      // "unbounded" means to a lifter reading the list.
      '47.5+ kg',
    ]);
    expect(ladder?.classes.at(-1)?.maximumKilograms).toBeNull();
  });

  it('rejects a ladder that does not ascend', () => {
    const problems = problemsFrom(
      document({
        weightClassLadders: [
          {
            id: 'example-female',
            label: 'Women',
            sex: 'female',
            classes: [
              { id: 'f-60', maximumKilograms: 60 },
              { id: 'f-50', maximumKilograms: 50 },
              { id: 'f-open', maximumKilograms: null },
            ],
          },
        ],
      }),
    );

    expect(problems).toEqual([
      'ladder "example-female": class "f-50" at 50 kg does not exceed the class below it at 60 kg',
    ]);
  });

  it('rejects a ladder whose heaviest class is bounded, because nobody above it has one', () => {
    const problems = problemsFrom(
      document({
        weightClassLadders: [
          {
            id: 'example-female',
            label: 'Women',
            sex: 'female',
            classes: [{ id: 'f-40', maximumKilograms: 40 }],
          },
        ],
      }),
    );

    expect(problems).toEqual([
      'ladder "example-female": the heaviest class is bounded at 40 kg, so a heavier lifter has no class',
    ]);
  });

  it('rejects an unbounded class that is not last, and one with nothing below it', () => {
    const problems = problemsFrom(
      document({
        weightClassLadders: [
          {
            id: 'example-female',
            label: 'Women',
            sex: 'female',
            classes: [
              { id: 'f-open', maximumKilograms: null },
              { id: 'f-40', maximumKilograms: 40 },
            ],
          },
        ],
      }),
    );

    expect(problems).toEqual([
      'ladder "example-female": class "f-open" is unbounded but is not the last class',
      'ladder "example-female": the unbounded class has no bounded class below it',
      'ladder "example-female": the heaviest class is bounded at 40 kg, so a heavier lifter has no class',
    ]);
  });

  it('refuses two ladders for one sex, because the interface asks the question once', () => {
    const ladder = {
      label: 'Women',
      sex: 'female',
      classes: [
        { id: 'f-40', maximumKilograms: 40 },
        { id: 'f-open', maximumKilograms: null },
      ],
    };
    const problems = problemsFrom(
      document({
        weightClassLadders: [
          { ...ladder, id: 'a' },
          { ...ladder, id: 'b', label: 'Women (second)' },
        ],
      }),
    );

    expect(problems).toContain('weight class ladders: female has more than one ladder');
  });

  it('refuses a weight class identifier reused across ladders', () => {
    const classes = [
      { id: 'shared', maximumKilograms: 40 },
      { id: 'open', maximumKilograms: null },
    ];
    const problems = problemsFrom(
      document({
        weightClassLadders: [
          { id: 'a', label: 'Women', sex: 'female', classes },
          { id: 'b', label: 'Men', sex: 'male', classes },
        ],
      }),
    );

    expect(problems).toEqual([
      'weight class: identifier "shared" is used more than once',
      'weight class: identifier "open" is used more than once',
    ]);
  });

  it('refuses two divisions with the same words on them', () => {
    // The shape a rulebook printing five divisions under one word arrives in.
    // Structurally fine, and unanswerable on screen.
    const problems = problemsFrom(
      document({
        ageDivisions: {
          id: 'example-divisions',
          label: 'Example divisions',
          basis: 'age-on-meet-date',
          divisions: [
            { id: 'junior-a', label: 'Junior', minimumAge: 13, maximumAge: 15 },
            { id: 'junior-b', label: 'Junior', minimumAge: 16, maximumAge: 17 },
          ],
        },
      }),
    );

    expect(problems).toEqual(['age division: label "Junior" is used more than once']);
  });

  it('refuses a division that admits nobody', () => {
    const problems = problemsFrom(
      document({
        ageDivisions: {
          id: 'example-divisions',
          label: 'Example divisions',
          basis: 'age-on-meet-date',
          divisions: [{ id: 'backwards', label: 'Backwards', minimumAge: 50, maximumAge: 40 }],
        },
      }),
    );

    expect(problems).toEqual(['age division "backwards": 50 to 40 admits nobody']);
  });

  it('reports every problem at once rather than the first', () => {
    const problems = problemsFrom(
      document({
        equipment: [
          { id: 'raw', label: 'Raw' },
          { id: 'raw', label: 'Raw again' },
        ],
        ageDivisions: {
          id: 'example-divisions',
          label: 'Example divisions',
          basis: 'age-on-meet-date',
          divisions: [{ id: 'backwards', label: 'Backwards', minimumAge: 50, maximumAge: 40 }],
        },
      }),
    );

    // A transcription is edited by a person working through a rulebook; one
    // problem per build costs one build per typo.
    expect(problems).toEqual([
      'equipment category: identifier "raw" is used more than once',
      'age division "backwards": 50 to 40 admits nobody',
    ]);
  });

  it('reports a malformed document by path and expectation, never by value', () => {
    const problems = problemsFrom(document({ weightClassLadders: [] }));

    expect(problems).toEqual(['weightClassLadders: expected >=1']);
  });

  it('ignores the comment keys a curated document explains itself with', () => {
    const { catalog } = buildCategoryCatalog(
      document({ $comment: ['why this file exists'], id: 'example' }),
    );

    expect(catalog).not.toHaveProperty('$comment');
  });
});
