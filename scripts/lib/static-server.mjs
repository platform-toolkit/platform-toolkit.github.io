// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * A static file server for the checks that run against a build.
 *
 * Shared because there are now three of them -- the narrow-layout pass, the
 * story smoke check, and the PWA check -- and the interesting part is the
 * traversal guard. A copy of a security check is a copy that gets fixed in two
 * places out of three.
 *
 * Not a general-purpose server, and must not become one: it binds to loopback on
 * an ephemeral port, serves one directory, and is closed by the caller.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';

/**
 * Enough to serve a site build and a Storybook build.
 *
 * An unknown extension is served with no content type rather than a guess.
 * Guessing is how a `.json` ends up announced as HTML, and the browser's
 * response to that is to do something surprising rather than to fail.
 */
const CONTENT_TYPES = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.map', 'application/json'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
  ['.woff2', 'font/woff2'],
]);

/**
 * Serves `root` on an ephemeral loopback port.
 *
 * The path is resolved and then checked to be inside the output directory. A
 * request for `/../../.commit-identity.local` is a real thing a browser can be
 * made to send, and this server is trivially reachable while it runs.
 *
 * A trailing slash resolves to `index.html`, which is what the deployed host
 * does and therefore what the routes under test assume.
 *
 * @param {string} root
 * @returns {Promise<{ server: import('node:http').Server, origin: string }>}
 */
export async function serveDirectory(root) {
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(requested.pathname);
    if (pathname.endsWith('/')) {
      pathname += 'index.html';
    }
    const file = resolve(root, `.${pathname}`);
    const inside = relative(root, file);
    if (inside.startsWith(`..${sep}`) || inside === '..') {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (body) => {
        const type = CONTENT_TYPES.get(extname(file));
        response.writeHead(200, type === undefined ? {} : { 'content-type': type });
        response.end(body);
      },
      () => {
        response.writeHead(404).end();
      },
    );
  });
  await new Promise((ready) => {
    server.listen(0, '127.0.0.1', ready);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The static server did not report a port.');
  }
  return { server, origin: `http://127.0.0.1:${String(address.port)}` };
}
