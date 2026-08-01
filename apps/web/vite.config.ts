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
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/**
 * Injects the Content Security Policy into built HTML only.
 *
 * The dev server serves CSS by injecting style elements from JavaScript, which a
 * policy without `unsafe-inline` correctly blocks. Rather than weaken the real
 * policy to accommodate a development-only mechanism, the policy is applied to
 * the production output and verified there by the end-to-end tests, which run
 * against the built site.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'pt-content-security-policy',
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
                content: CONTENT_SECURITY_POLICY,
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
 * A GitHub Pages *project* site is served from a subpath (/<repo>/), while a user
 * site, a custom domain, or any other static host is served from the root. Rather
 * than hard-coding either, the deployment workflow supplies it. This is the whole
 * of the coupling between the application and its host, which is what makes the
 * documented fallback to another static host a configuration change rather than a
 * rewrite.
 */
const base = process.env['PT_BASE_PATH'] ?? '/';

export default defineConfig({
  base,
  appType: 'mpa',
  plugins: [contentSecurityPolicy()],
  build: {
    target: 'es2022',
    // Public source maps are off by default: they would republish readable
    // application source on a production origin without anyone asking for it.
    sourcemap: false,
    rolldownOptions: {
      input: {
        standalone: here('index.html'),
        embed: here('embed/uspa/index.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});

export { CONTENT_SECURITY_POLICY };
