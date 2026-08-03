#!/usr/bin/env node
/**
 * Writes a CycloneDX software bill of materials for the installed dependency
 * tree.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE LICENCE CHECK
 *
 * `check-dependency-licenses.mjs` answers "may we ship this?" and answers it for
 * us, now. An SBOM answers "what did you ship?" and answers it for somebody
 * else, later -- an embedder running a vulnerability scan, a lifter's employer
 * with a supply-chain policy, or whoever has to work out in two years whether a
 * newly disclosed advisory touched this build. Those are different questions and
 * the second one is only answerable if the artifact was produced at build time,
 * from the tree that was actually installed, rather than reconstructed
 * afterwards from a manifest that has moved on.
 *
 * WHY IT IS DETERMINISTIC
 *
 * The serial number is derived from the component list rather than randomly
 * generated, and the timestamp honours SOURCE_DATE_EPOCH. Two builds of the same
 * lockfile therefore produce byte-identical documents, which is what lets anyone
 * check the SBOM against the source instead of trusting it. A random UUID would
 * make every rebuild look like a different bill of materials for the same
 * software.
 *
 * The `reach` property on each component records whether it ends up in a user's
 * browser or only in this repository's toolchain. Most SBOM consumers care about
 * exactly that distinction and most SBOMs cannot express it.
 *
 * USAGE
 *
 *   node scripts/generate-sbom.mjs [output-path]     default: sbom.cdx.json
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUTPUT = fileURLToPath(new URL('../sbom.cdx.json', import.meta.url));

/**
 * Encodes a package name for a package URL.
 *
 * A scope is two path segments (`@scope/name` -> `%40scope/name`), and the slash
 * between them must survive, so this cannot be a single `encodeURIComponent`.
 *
 * @param {string} name
 * @returns {string}
 */
function purlName(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

/**
 * @param {boolean} productionOnly
 * @returns {Record<string, Array<{ name: string, versions?: string[], homepage?: string, description?: string }>>}
 */
function readLicenses(productionOnly) {
  const args = ['licenses', 'list', '--json'];
  if (productionOnly) args.push('--prod');
  return JSON.parse(
    execFileSync('pnpm', args, {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

async function main() {
  const output = process.argv[2] ?? DEFAULT_OUTPUT;

  const grouped = readLicenses(false);
  const shipped = new Set(
    Object.values(readLicenses(true))
      .flat()
      .map((entry) => entry.name),
  );

  /** @type {Array<Record<string, unknown>>} */
  const components = [];
  for (const [license, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      // One package can be installed at several versions. Each is its own
      // component, because an advisory applies to a version and not a name.
      for (const version of entry.versions ?? []) {
        components.push({
          type: 'library',
          'bom-ref': `pkg:npm/${purlName(entry.name)}@${version}`,
          name: entry.name,
          version,
          purl: `pkg:npm/${purlName(entry.name)}@${version}`,
          scope: shipped.has(entry.name) ? 'required' : 'excluded',
          // "Unknown" is pnpm's own bucket for a package with no licence field.
          // Recorded as-is: an SBOM that invents a licence is worse than one
          // that admits it does not know, and the licence gate refuses to build
          // in that case anyway.
          licenses: license === 'Unknown' ? [] : [{ license: { id: license } }],
          ...(entry.description === undefined ? {} : { description: entry.description }),
          properties: [
            {
              name: 'platform-toolkit:reach',
              value: shipped.has(entry.name) ? 'shipped' : 'build',
            },
          ],
        });
      }
    }
  }
  components.sort((left, right) => String(left.purl).localeCompare(String(right.purl)));

  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  // Derived, not random: the same tree must produce the same document. A UUID
  // has 32 hex digits and the shape 8-4-4-4-12, so a truncated digest fits
  // exactly, with the version and variant nibbles pinned to make it a
  // well-formed v4-shaped identifier rather than an arbitrary hex string.
  const digest = createHash('sha256').update(JSON.stringify(components)).digest('hex');
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');

  const epoch = process.env['SOURCE_DATE_EPOCH'];
  const timestamp = new Date(
    epoch === undefined ? Date.now() : Number.parseInt(epoch, 10) * 1000,
  ).toISOString();

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${uuid}`,
    version: 1,
    metadata: {
      timestamp,
      tools: { components: [{ type: 'application', name: 'scripts/generate-sbom.mjs' }] },
      component: {
        type: 'application',
        'bom-ref': 'platform-toolkit',
        name: 'platform-toolkit',
        version: String(manifest.version),
        description: String(manifest.description),
        licenses: [{ license: { id: 'Apache-2.0' } }],
      },
      licenses: [{ license: { id: 'Apache-2.0' } }],
    },
    components,
  };

  await writeFile(output, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
  console.log(
    `SBOM written to ${output}: ${String(components.length)} components, ${String(shipped.size)} shipped.`,
  );
}

await main();
