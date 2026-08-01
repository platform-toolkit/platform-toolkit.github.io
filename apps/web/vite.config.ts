import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Directives GitHub Pages can actually enforce through a meta tag.
 *
 * `frame-ancestors` is deliberately absent. Public embedding is an intended
 * feature of this project, and in any case browsers ignore `frame-ancestors` in
 * a meta-delivered policy -- including it would be decorative, and would imply a
 * protection that is not there.
 *
 * `X-Content-Type-Options`, `Permissions-Policy`, and `Referrer-Policy` are
 * response headers with no meta equivalent. GitHub Pages cannot set custom
 * headers, so they are unavailable here. They are defence in depth rather than
 * load-bearing, and become available unchanged if this ever moves to a host with
 * header control.
 */
function buildContentSecurityPolicy(connectSrc: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Injects the Content Security Policy into built HTML only.
 *
 * The dev server serves CSS by injecting style elements from JavaScript, which a
 * policy without `unsafe-inline` correctly blocks. Rather than weaken the real
 * policy to accommodate a development-only mechanism, the policy is applied to
 * the production output and verified there by the end-to-end tests, which run
 * against the built site.
 */
function contentSecurityPolicy(policy: string): Plugin {
  return {
    name: 'ptk-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return {
          html,
          tags: [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content: policy,
              },
              injectTo: 'head-prepend',
            },
          ],
        };
      },
    },
  };
}

/**
 * `base` is the one host-specific setting in the build.
 *
 * The production target is an organisation *user* site, served from the root, so
 * that is the default. A GitHub Pages *project* site is served from a subpath
 * (/<repo>/), as is most shared static hosting; rather than hard-code either, the
 * deployment workflow supplies it. This is the whole of the coupling between the
 * application and its host, which is what makes the documented fallback to
 * another static host a configuration change rather than a rewrite.
 *
 * Links between pages are written relative rather than root-absolute for the same
 * reason -- see the note in `src/tools.ts`.
 */
const base = process.env['PTK_BASE_PATH'] ?? '/';

/**
 * Where the published data lives, and therefore what `connect-src` has to allow.
 *
 * Unset means same-origin: JSON published beside the site, which is the whole
 * arrangement today. Setting it to an https origin points the application at a
 * separate host -- a data-only bucket, or eventually an API -- and widens the
 * policy by exactly that one origin.
 *
 * This exists now because `connect-src 'self'` is the single directive that
 * would silently break the move. A request to a new origin fails in the browser
 * with a policy violation rather than an error the application can report, and
 * finding that out during a migration is worse than spending fifteen lines on it
 * beforehand.
 */
function readDataOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('PTK_DATA_ORIGIN must be an absolute https origin.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('PTK_DATA_ORIGIN must use https.');
  }
  // A CSP source expression is an origin. A path would be ignored by the
  // browser while reading as though it constrained something, so refuse it
  // rather than accept a policy that is narrower on paper than in effect.
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('PTK_DATA_ORIGIN must be an origin with no path, query, or fragment.');
  }
  return parsed.origin;
}

const dataOrigin = readDataOrigin(process.env['PTK_DATA_ORIGIN']);
const dataBaseUrl = dataOrigin === undefined ? `${base}data/` : `${dataOrigin}/`;
const CONTENT_SECURITY_POLICY = buildContentSecurityPolicy(
  dataOrigin === undefined ? "'self'" : `'self' ${dataOrigin}`,
);

export default defineConfig({
  base,
  appType: 'mpa',
  plugins: [contentSecurityPolicy(CONTENT_SECURITY_POLICY)],
  // Named one at a time, never by prefix. Vite's `envPrefix` would inline every
  // matching variable into the bundle, and the deploy workflow puts
  // `PTK_PROHIBITED_TOKENS` -- a repository secret -- in the same environment as
  // the build. An explicit list cannot publish something nobody listed.
  define: {
    __PTK_DATA_BASE_URL__: JSON.stringify(dataBaseUrl),
  },
  build: {
    target: 'es2022',
    // Public source maps are off by default: they would republish readable
    // application source on a production origin without anyone asking for it.
    sourcemap: false,
    rolldownOptions: {
      // One entry per page. Every tool in the collection contributes its own
      // entries, which is what makes a page load only the tool it is showing --
      // embedding one tool ships none of the others.
      input: {
        hub: here('index.html'),
        'platform-targets': here('platform-targets/index.html'),
        'platform-targets-embed': here('platform-targets/embed/uspa/index.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});

export { CONTENT_SECURITY_POLICY };
