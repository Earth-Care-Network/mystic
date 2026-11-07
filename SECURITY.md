# Security

Mystic holds people's model keys and their Earth Care Network sign-in, and it
acts for them. We take reports seriously and answer quickly.

## Report a vulnerability

**Privately**, through GitHub:
[Report a vulnerability](https://github.com/Earth-Care-Network/mystic/security/advisories/new).
Please don't open a public issue, pull request or discussion about it.

We'll acknowledge within 3 working days, tell you what we found within 10, and
credit you in the advisory unless you'd rather we didn't.

## In scope

- Keys or tokens leaving the OS keychain, appearing in files, logs or chats, or
  reaching any host other than the provider they belong to
- Ways around the approval gate (an agent sending, posting, paying, signing or
  deleting without the person's yes), including through prompt injection
- The Earth Care Network sign-in (OAuth state, PKCE, the loopback listener)
- Reading or writing outside the `~/Mystic` folder
- The updater: installing anything not signed with Mystic's release key
- The release pipeline and this repository's settings

## How Mystic is built to be safe

- Keys and the Earth Care Network sign-in live in the OS keychain only.
- Every action an agent takes passes one gate: reads run; anything else asks
  (Refuse · Allow once · Always allow); sending, deleting and destructive calls
  always ask.
- Updates are signed (minisign, Tauri updater) and checked before install.
- `main` and `test` accept changes only through pull requests with passing
  checks, a maintainer's approval and an admin's merge; nobody pushes to them
  directly; force-pushes and deletions are blocked; release tags and the
  release environment (which alone holds the signing secret) are admin-only.
- Dependabot watches bun, Cargo and Actions; GitHub Actions are pinned to
  commit SHAs; secret scanning and push protection are on.

## Supported versions

The latest release. Mystic updates itself; please stay current.
