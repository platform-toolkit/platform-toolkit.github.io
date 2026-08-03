# Developer Certificate of Origin

This project uses the Developer Certificate of Origin instead of a contributor licence agreement.
There is nothing to sign, no account to create, and no copyright to assign — you keep the copyright
in everything you write. You sign off each commit, and that sign-off is the certification reproduced
below.

## How to sign off

Add `-s` when you commit:

```
git commit -s -m "Your message"
```

Git appends one line:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and address must be ones you can be reached at — a real identity, not a pseudonym or an
anonymised forwarding address. That is the whole point of the certification: it records who is
making the statement.

If you forget, `git commit --amend -s` fixes the last commit, and `git rebase --signoff main` fixes
a branch.

## Why this and not a CLA

A contributor licence agreement asks you to grant the project rights beyond the licence, and a
copyright assignment asks you to hand over ownership outright. Both exist mainly so a project can
relicense your work later without asking you. This project does not want that power over your
contribution, so it does not ask for it. Everything here is inbound-equals-outbound: you contribute
under the Apache License 2.0, the same terms the project distributes under, and no maintainer can
change that for your code without your agreement.

The Apache License already grants a patent licence from every contributor (section 3), which is the
other thing CLAs are usually reached for.

## The certification

The text below is the Developer Certificate of Origin, version 1.1, reproduced verbatim from
<https://developercertificate.org/>. It is not this project's document and this project has not
altered it.

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

Note clause (d) in particular. Your sign-off, including the address in it, becomes part of a public
git history that is copied by everyone who clones the repository. It cannot be recalled later. Use
an address you are content to have published permanently.
