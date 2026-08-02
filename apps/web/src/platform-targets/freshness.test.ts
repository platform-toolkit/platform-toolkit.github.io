import type { DataMeta, SourceFreshness } from '@platform-toolkit/data-contracts';
import { describe, expect, it } from 'vitest';

import { categoryPhrase, readFreshness, type FreshnessInput } from './freshness.js';

/**
 * The freshness line, as arithmetic rather than as a screen.
 *
 * Every figure below is invented (§5.1). What is being pinned is not a date but
 * an ordering of claims: which sentence wins when a device is offline *and* the
 * publisher was already behind, and that the tool never prints a verification
 * date it did not read.
 */

function source(overrides: Partial<SourceFreshness> = {}): SourceFreshness {
  return {
    id: 'example-records',
    label: 'Example records',
    retrievedAt: '2026-07-28T04:15:00.000Z',
    status: 'ok',
    ...overrides,
  };
}

function meta(sources: readonly SourceFreshness[]): DataMeta {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-31T06:00:00.000Z',
    // Copied rather than passed through: the contract's array is the output of a
    // valibot parse and is mutable, so handing it a `readonly` one is a type
    // error -- the same reason `bookOf` copies in `records-fixture.ts`.
    sources: [...sources],
    artifacts: {},
  };
}

function input(overrides: Partial<FreshnessInput> = {}): FreshnessInput {
  return {
    connection: 'online',
    meta: meta([source()]),
    metaStatus: 'ready',
    showingData: true,
    federationLabel: 'Example Federation',
    ...overrides,
  };
}

describe('readFreshness', () => {
  it('says when the data was last verified, quietly, when nothing is wrong', () => {
    expect(readFreshness(input())).toEqual({
      sentence: 'Last verified July 28, 2026.',
      verifiedOn: '2026-07-28',
      tone: 'quiet',
      // The ordinary case is not announced. See the field's note.
      announce: null,
    });
  });

  /**
   * The oldest of the sources, not the newest and not the build time. A line
   * saying the whole publication is as fresh as its fastest source is the
   * misreading the per-source shape exists to prevent.
   */
  it('reports the oldest source, so the line can only understate', () => {
    const state = readFreshness(
      input({
        meta: meta([
          source({ id: 'a', retrievedAt: '2026-07-30T23:00:00.000Z' }),
          source({ id: 'b', retrievedAt: '2026-07-24T01:00:00.000Z' }),
          source({ id: 'c', retrievedAt: '2026-07-28T12:00:00.000Z' }),
        ]),
      }),
    );
    expect(state.verifiedOn).toBe('2026-07-24');
    expect(state.sentence).toBe('Last verified July 24, 2026.');
  });

  it('labels a cached copy as offline, and announces it', () => {
    const state = readFreshness(input({ connection: 'offline' }));
    expect(state.sentence).toBe('Offline · Showing data last verified July 28, 2026.');
    expect(state.tone).toBe('caution');
    expect(state.announce).toBe(state.sentence);
  });

  /**
   * The state a lifter reaches by installing the application and then losing
   * signal before any category was read. It is the one state with nothing usable
   * on screen, so it says what would fix it.
   */
  it('says nothing is saved yet when offline and the index could not be read', () => {
    const state = readFreshness(
      input({ connection: 'offline', metaStatus: 'failed', meta: null, showingData: false }),
    );
    expect(state.sentence).toBe(
      'Targets have not been saved on this device yet. Reconnect once to load this Example Federation category.',
    );
    expect(state.tone).toBe('error');
    expect(state.announce).not.toBeNull();
  });

  /**
   * The flash this guard exists to stop: an offline visit that *does* have a
   * cached copy paints before the cache answers, and a line reading "nothing is
   * saved" in that instant is wrong and then gone.
   */
  it('stays quiet while an offline read is still in flight', () => {
    const state = readFreshness(
      input({ connection: 'offline', metaStatus: 'loading', meta: null, showingData: false }),
    );
    expect(state.sentence).toBeNull();
  });

  /**
   * Being offline is about this device. A degraded source is about the
   * publisher, and reconnecting will not fix it -- so the two never share a
   * sentence.
   */
  it('distinguishes a source the publisher could not refresh from being offline', () => {
    const state = readFreshness(
      input({
        meta: meta([source({ status: 'stale', note: 'The upstream table did not respond.' })]),
      }),
    );
    expect(state.sentence).toBe('Update unavailable · Showing data last verified July 28, 2026.');
    expect(state.tone).toBe('caution');
  });

  it('prefers the offline sentence when the device is offline and a source is stale', () => {
    const state = readFreshness(
      input({ connection: 'offline', meta: meta([source({ status: 'unavailable' })]) }),
    );
    expect(state.sentence).toBe('Offline · Showing data last verified July 28, 2026.');
  });

  it('says nothing at all before the first read settles', () => {
    expect(readFreshness(input({ meta: null, metaStatus: 'loading', showingData: false }))).toEqual(
      {
        sentence: null,
        verifiedOn: null,
        tone: 'quiet',
        announce: null,
      },
    );
  });

  /**
   * A read that failed while online is already explained where it failed -- the
   * categories panel, or the report's own notice. A second sentence in the
   * footer would be the same failure said twice in two wordings.
   */
  it('leaves an online failure to the panel that owns it', () => {
    expect(
      readFreshness(input({ metaStatus: 'failed', meta: null, showingData: false })).sentence,
    ).toBeNull();
  });

  /** Data on screen with an index that carries no readable date still says nothing false. */
  it('drops the date clause rather than inventing a date', () => {
    const state = readFreshness(
      input({
        connection: 'offline',
        meta: meta([source({ retrievedAt: '0000-99-99T00:00:00.000Z' })]),
      }),
    );
    expect(state.sentence).toBe('Offline · Showing the copy saved on this device.');
    expect(state.verifiedOn).toBeNull();
  });

  it('names no federation until the catalogue has been read', () => {
    const state = readFreshness(
      input({
        connection: 'offline',
        metaStatus: 'failed',
        meta: null,
        showingData: false,
        federationLabel: null,
      }),
    );
    expect(state.sentence).toBe(
      'Targets have not been saved on this device yet. Reconnect once to load this category.',
    );
  });
});

describe('categoryPhrase', () => {
  it('uses the published name when there is one', () => {
    expect(categoryPhrase('USPA')).toBe('this USPA category');
  });

  it('says nothing about a federation it has not read', () => {
    expect(categoryPhrase(null)).toBe('this category');
  });
});
