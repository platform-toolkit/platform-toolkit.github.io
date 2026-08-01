/**
 * Every tool published by this site.
 *
 * Adding a tool means an entry here, an entry in `vite.config.ts`, and the pages
 * themselves. Nothing else in the site needs to know the list.
 *
 * Paths are relative on purpose. The site is normally served from the root, but
 * `PTK_BASE_PATH` lets it deploy under a subpath on another host, and a relative
 * href resolves correctly under either without the page having to know which.
 */
export interface Tool {
  /** Directory segment, and the tool's stable identifier in message payloads. */
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Present when the tool offers a route intended to be framed by other sites. */
  readonly embedPath?: string;
}

export const TOOLS: readonly Tool[] = [
  {
    id: 'platform-targets',
    name: 'Platform Targets',
    summary:
      'Classifications, records, and meet qualification standards for one lifter, on one screen.',
    embedPath: 'platform-targets/embed/uspa/',
  },
];
