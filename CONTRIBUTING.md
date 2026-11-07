# Contributing to Mystic

Thank you for helping. Mystic is free and open source (MIT) and is stewarded by
[Earth Care Network](https://www.earthcare.network). We work by four shared
ethics: **Earth Care, People Care, Future Care, Fair Share.**

## How changes get in

1. **Open an issue first** for anything bigger than a typo, so we can agree on
   the shape before you write code.
2. **Fork, then branch** from `test`: `fix/<short-name>` or `feat/<short-name>`.
3. **Open a pull request into `test`.** Keep it to one change.
4. **CI must pass** (`app` and `shell`), **a maintainer must approve** it, and
   every review thread must be resolved. An admin merges it (squash); nobody
   pushes to `test` or `main` directly, admins included.
5. Maintainers promote `test` to `main` for a release, and only maintainers
   create release tags.

### Who can do what

| | Contributors | Maintainers (`@Earth-Care-Network/mystic-maintainers`) | Admins |
|--|--|--|--|
| Open issues and pull requests | yes | yes | yes |
| Approve a pull request | — | yes | yes |
| Merge into `test` / `main` | — | — | yes, through a pull request with passing checks |
| Push directly to `test` / `main` | never | never | never |
| Force-push or delete `test` / `main` | never | never | never |
| Create `v*` tags, approve a release | — | — | yes |

These rules are enforced by repository rulesets, not by trust.

## Develop

Needs [Bun](https://bun.sh) 1.3+ and [Rust](https://rustup.rs) (stable).

```sh
bun install
bun run app:dev        # the desktop app with hot reload
bun run test           # core tests
bun run typecheck
cd src-tauri && cargo test
```

`src/core/` is the app's logic as plain TypeScript (providers, the agent loop,
approvals, schedules, Earth Care Network sign-in, MCP), tested with `bun test`.
`src-tauri/` is the shell (keychain, the `~/Mystic` folder, the sign-in
loopback, HTTP, the updater). `src/ui/` is React.

## Rules that keep people safe

- **Never commit a key, token or personal data** — not in code, tests, fixtures,
  screenshots or issue text. Use made-up names (`person@example.com`).
- **The approval gate is not optional.** Anything that sends, posts, pays,
  signs or deletes goes through `src/core/approvals.ts`. A change that weakens
  it needs a maintainer from the security list in `SECURITY.md`.
- **New network hosts or Tauri permissions** (`src-tauri/capabilities/`) need a
  sentence in the pull request saying why.
- **Pin GitHub Actions to a full commit SHA**, with the version in a comment.
- **Plain words in the app.** Say what happened and the one next step. Never
  claim something was done when it wasn't.

## Code of conduct

Everyone taking part agrees to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

By contributing you agree your work is released under the [MIT License](LICENSE).
