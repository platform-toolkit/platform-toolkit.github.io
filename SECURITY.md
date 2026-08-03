# Security policy

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository: the **Security** tab, then **Report
a vulnerability**. That creates a private thread visible only to the maintainer.

If that is unavailable to you, email <jason@smathe.rs> with `SECURITY` in the subject line.

You will get an acknowledgement within 7 days. If you do not, assume the message went astray and try
the other channel — a report that was never read is the worst outcome for both of us.

## What to expect

This is a one-maintainer project, so the honest timeline is:

- **Acknowledgement:** within 7 days.
- **Initial assessment:** within 14 days, including whether it is in scope and what severity it
  looks like.
- **Fix for a confirmed high-severity issue in shipped code:** as fast as possible, targeting 30
  days.
- **Disclosure:** coordinated with you. The default is a public advisory once a fix is deployed,
  crediting you unless you would rather not be named.

There is no bug bounty. There is no legal threat either: report anything you find in good faith and
you will be thanked, not pursued.

## Scope

The toolkit is a static site and a set of npm packages. There is no server, no account system, no
database, and no session. That shapes what a vulnerability can be here.

### In scope

- Cross-site scripting, or any path by which page content or published data becomes executable.
- Anything that lets an embedding page extract data a visitor entered, or lets the toolkit send it
  anywhere.
- A flaw in `postMessage` handling that lets a parent frame drive the widget beyond its documented
  interface, or lets a widget leak to its parent.
- A content-security-policy weakness, or a route that ships a weaker policy than intended.
- Prototype pollution, or a schema-validation bypass at a data trust boundary.
- Cache or service-worker poisoning: anything that makes a stale or attacker- influenced artifact
  persist on a visitor's device.
- Supply-chain problems in what this repository ships — a compromised dependency in the production
  closure, or a build step that can be influenced by repository content.
- Anything that causes personal data to be stored, logged or transmitted when the documented
  behaviour says it is not.

### Out of scope

- Missing headers that GitHub Pages does not permit a static site to set. The policy is delivered by
  meta tag where a meta tag can carry it; the rest is a platform limitation and is documented in the
  README.
- The absence of `X-Frame-Options` and `frame-ancestors`. Embedding is a supported feature, not an
  oversight — any site may frame these tools by design.
- Vulnerabilities in development-only dependencies that never reach a user. They are still worth
  telling us about; they are not treated as a security incident.
- Reports from automated scanners with no demonstrated impact.
- Denial of service against GitHub Pages.
- Social engineering, or physical access to a device.

## What this project promises about data

These are commitments, so a violation of one of them is a security issue and should be reported as
such:

- Nothing a visitor enters is sent to a server. There is no backend to send it to.
- Nothing identifying is written to storage by default, and there is no free-text preference type —
  the preference system cannot serialise arbitrary text, by construction rather than by policy.
- Imported athlete data and profile URLs are not persisted.
- Profile URLs and athlete names do not appear in logs, and athlete identity does not appear in any
  error report.
- There are no third-party analytics, advertising or tracking scripts, and no network request to any
  origin other than the site's own.
- Embedded widgets transmit no imported athlete information to the parent frame.

## Supported versions

The deployed site at <https://platform-toolkit.github.io> is the supported version, and it tracks
`main`. Fixes go to the current release; there are no maintained older branches.

Published npm packages are supported at their latest minor version within the current major.

## Verifying what you received

Each release has a CycloneDX SBOM generated from the installed tree (`pnpm run sbom`), and the full
dependency-licence inventory is committed at
[docs/dependency-licenses.md](docs/dependency-licenses.md). Both are deterministic: the same
lockfile produces the same document, so you can regenerate and compare rather than trust.
