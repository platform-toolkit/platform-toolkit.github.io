# Third-party notices

Platform Toolkit itself is licensed under the Apache License 2.0. This file covers the third-party
software distributed **with** it — the code that ends up inside the built site and inside the
published npm packages, and whose licences therefore travel to everyone who receives them.

It is deliberately short. The full installed tree, including the several hundred packages that exist
only to build and test this repository and reach no user, is listed in
[docs/dependency-licenses.md](docs/dependency-licenses.md) and emitted as a CycloneDX SBOM by
`scripts/generate-sbom.mjs`. Development tooling is not redistributed, so it is reported for
transparency rather than reproduced for attribution.

## Lit

Bundled into the built site and into `@platform-toolkit/ui`. Comprises the packages `lit`,
`lit-html`, `lit-element`, `@lit/reactive-element` and `@lit-labs/ssr-dom-shim`, all under the same
terms.

```
BSD 3-Clause License

Copyright (c) 2017 Google LLC. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Clause 3 is the reason no page, package description or README in this repository presents the
toolkit as a Lit product or implies Google's endorsement. It is used as a library and named as one.

## Valibot

Bundled wherever runtime schema validation happens at a trust boundary:
`@platform-toolkit/data-contracts`, `data-access`, `configuration`, `preferences` and `ingestion`.

```
MIT License

Copyright (c) Fabian Hiller

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## TypeScript

Reachable from the production closure only as an optional peer dependency of Valibot, which uses it
for type-level inference. No TypeScript code is bundled into any artifact this project distributes.
Recorded here because `pnpm licenses list --prod` reports it, and a notices file that quietly drops
something the tooling reports is a notices file nobody can check.

TypeScript is licensed under the Apache License 2.0, the same licence this project uses; its full
text is in [LICENSE](LICENSE).

```
Copyright (c) Microsoft Corporation.
```

## Federation data

Records, classification standards, weight classes and rule details published by powerlifting
federations are facts, independently encoded here from publicly available sources rather than
copied. Provenance for each dataset is recorded in `data/sources/`. See [NOTICE](NOTICE) for the
full statement. Federation names and marks belong to their owners; no federation has reviewed,
approved or endorsed this project.
