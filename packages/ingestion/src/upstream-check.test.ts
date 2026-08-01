import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { checkUpstream, type UpstreamSource } from './upstream-check.js';

const CHECKED_AT = '2026-01-01T00:00:00.000Z';

const BODY = '{"data":[]}';
const BODY_DIGEST = createHash('sha256').update(BODY).digest('hex');

function source(overrides: Partial<UpstreamSource> = {}): UpstreamSource {
  return {
    id: 'example',
    document: 'data/sources/example.json',
    sha256: BODY_DIGEST,
    url: 'https://example.test/standards.json',
    ...overrides,
  };
}

/** A `fetch` that answers every request the same way. */
function serving(body: string, init: ResponseInit = {}): typeof fetch {
  return () => Promise.resolve(new Response(body, init));
}

function refusing(error: Error): typeof fetch {
  return () => Promise.reject(error);
}

describe('checkUpstream', () => {
  it('matches when upstream still serves the pinned bytes', async () => {
    const report = await checkUpstream([source()], CHECKED_AT, serving(BODY));

    expect(report.checkedAt).toBe(CHECKED_AT);
    expect(report.findings).toEqual([
      {
        id: 'example',
        document: 'data/sources/example.json',
        status: 'matched',
        expectedSha256: BODY_DIGEST,
        actualSha256: BODY_DIGEST,
        detail: null,
      },
    ]);
  });

  it('reports drift with both digests rather than adopting the new bytes', async () => {
    const [finding] = (await checkUpstream([source()], CHECKED_AT, serving('{"data":[1]}')))
      .findings;

    // Both, because the pinned one is what shipped and the new one is what a
    // maintainer will paste into the mapping once they have read the diff.
    expect(finding?.status).toBe('drifted');
    expect(finding?.expectedSha256).toBe(BODY_DIGEST);
    expect(finding?.actualSha256).not.toBe(BODY_DIGEST);
  });

  it('distinguishes an unwatched source from an unchanged one', async () => {
    const [finding] = (await checkUpstream([source({ url: null })], CHECKED_AT, serving(BODY)))
      .findings;

    // The whole reason `url` is a required nullable rather than optional. A
    // source nobody is watching must not read as a source that has not changed.
    expect(finding?.status).toBe('manual');
    expect(finding?.actualSha256).toBeNull();
  });

  it('treats an error response as unreachable, not as drift', async () => {
    const [finding] = (
      await checkUpstream([source()], CHECKED_AT, serving('nope', { status: 503 }))
    ).findings;

    // Digesting an error page would report drift and send somebody to read a
    // diff between the standards and a maintenance notice.
    expect(finding?.status).toBe('unreachable');
    expect(finding?.actualSha256).toBeNull();
    expect(finding?.detail).toContain('503');
  });

  it('treats an empty body as unreachable', async () => {
    const [finding] = (await checkUpstream([source()], CHECKED_AT, serving(''))).findings;

    expect(finding?.status).toBe('unreachable');
  });

  it('keeps the URL out of the detail it reports', async () => {
    const url = 'https://example.test/standards.json';
    const [finding] = (
      await checkUpstream(
        [source({ url })],
        CHECKED_AT,
        refusing(new Error(`connect ECONNREFUSED ${url}`)),
      )
    ).findings;

    // This text is committed and pasted into a public issue. A report that
    // quotes URLs back is one somebody eventually pastes a credentialed one into.
    expect(finding?.detail).toBe('connect ECONNREFUSED <url>');
  });

  it('checks the rest after one source fails', async () => {
    let call = 0;
    const alternating: typeof fetch = () => {
      call += 1;
      return call === 1 ? Promise.reject(new Error('down')) : Promise.resolve(new Response(BODY));
    };

    const report = await checkUpstream(
      [source({ id: 'a' }), source({ id: 'b' })],
      CHECKED_AT,
      alternating,
    );

    expect(report.findings.map((finding) => finding.status)).toEqual(['unreachable', 'matched']);
  });

  it('sorts findings, so an unchanged week produces an unchanged report', async () => {
    const report = await checkUpstream(
      [source({ id: 'z' }), source({ id: 'a' })],
      CHECKED_AT,
      serving(BODY),
    );

    // The report is committed. Source order reaching the file would make every
    // run a diff and every diff meaningless.
    expect(report.findings.map((finding) => finding.id)).toEqual(['a', 'z']);
  });

  it('refuses a body larger than the cap instead of buffering it', async () => {
    const huge = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const [finding] = (
      await checkUpstream([source()], CHECKED_AT, () => Promise.resolve(new Response(huge)))
    ).findings;

    expect(finding?.status).toBe('unreachable');
    expect(finding?.detail).toContain('more than');
  });
});
