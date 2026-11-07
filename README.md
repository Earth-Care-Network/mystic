# Mystic

**Your team of AI agents. Free and open source, on any key you bring.**
By [Earth Care Network](https://www.earthcare.network). MIT.

*Earth Care · People Care · Future Care · Fair Share*

**[Download for Mac](https://github.com/Earth-Care-Network/mystic/releases/latest/download/Mystic.dmg)** · [Website](https://earth-care-network.github.io/mystic/) · [All downloads](https://github.com/Earth-Care-Network/mystic/releases/latest)

## Install on a Mac

The quickest way. Open Terminal and paste:

```sh
curl -fsSL https://earth-care-network.github.io/mystic/install.sh | sh
```

It downloads the latest release, checks it against the release's SHA-256
checksums, and puts Mystic in Applications ([the script](scripts/install.sh)).

Or [download Mystic.dmg](https://github.com/Earth-Care-Network/mystic/releases/latest/download/Mystic.dmg)
and drag Mystic to Applications. Mystic isn't notarized by Apple yet, so the first
time you open it macOS may say it can't check the app: open **System Settings ›
Privacy & Security** and click **Open Anyway**.

Apple silicon and Intel, macOS 12 or newer.

Mystic is a desktop app for Mac (Windows and Linux build too). You start with a
**Chief of Staff**; tell it about your work and it sets up an agent for each part
of the job (outreach, writing, research, operations, an engineer). Each agent has
its own model, instructions and memory, hands tasks to the others, runs on a
schedule you say in plain words, and **asks before it acts**: anything that
changes something pauses with **Refuse · Allow once · Always allow**, and sending,
posting, paying, signing or deleting always asks.

## Any key

Add as many as you like in **Settings · Models & keys**. Each agent picks its own,
and can switch mid-conversation without losing its job or memory.

| | |
|--|--|
| OpenRouter | every model on one key |
| Anthropic, OpenAI, Google Gemini, xAI Grok, Groq, Mistral, DeepSeek | your own key |
| Ollama, LM Studio | models on your Mac, no key |
| Anything OpenAI-compatible | paste the endpoint |

Keys live in your OS keychain, never in a file, and go only to the provider they
belong to.

## Earth Care Network

**Sign in to Earth Care Network** (Settings · Earth Care Network) and your agents
can use your enterprise's context and tools — contacts, deals, journal drafts,
sites, events — through Earth Care Network's MCP server, on any model.

**Earth Care Cloud** runs an agent on Jaguar, Earth Care Network's own agent,
with your enterprise's context, tools and AI, on its Pro plan (trial included).
Pick it as the agent's model. Without Pro, Mystic keeps working on your own keys.

The sign-in card names the server it uses. Earth Care Cloud for Mystic is live on
TEST (`test.earthcare.network`) first; choose it under **Server** to try the cloud
before it reaches `www.earthcare.network`. A sign-in belongs to the server that issued
it and is never sent to another one.

## Your folder

Everything is plain files in `~/Mystic`: `agents/`, `chats/`, `notes/`,
`routines.json`, `settings.json`. Open it from Settings · Your folder.

## Built on OpenDuet

Mystic takes its approval gate, its tenant-package format and its AG-UI wire from
[CopilotKit's OpenDuet](https://github.com/CopilotKit/OpenDuet) /
[OpenBot](https://github.com/CopilotKit/openbot) (MIT). **Settings · Your folder ·
Export** writes your team as an OpenDuet tenant package (`brand.yaml`,
`agents.yaml`, `model.yaml`, `skills.yaml`, `channels.yaml`) to run the same
agents on a self-hosted OpenDuet server.

## Updates

Mystic checks its signed release feed at launch and installs a new version only
when you say so.

## Mystic on iPhone and iPad

Mystic on iPhone runs your agents on **Earth Care Cloud**: sign in to Earth Care
Network, and it opens for an enterprise on Pro (owner, admin or member seat). It
has no bring-your-own-key and sells nothing in the app; an owner starts Pro on
earthcare.network. Sign-in goes through Safari and comes back to the app through
`network.earthcare.mystic:/oauth/callback` (RFC 8252, PKCE).

```sh
bun run tauri ios dev                         # in the simulator, hot reload
bun run tauri ios build --target aarch64-sim  # a simulator build
```

On your own iPhone or iPad: add your Apple ID in Xcode (Settings → Accounts; a free
account works), plug the device in and turn on Developer Mode, then:

```sh
APPLE_DEVELOPMENT_TEAM=<your team id> sh scripts/ios-device.sh
```

## Contributing and security

- How to contribute, and who can merge: [CONTRIBUTING.md](CONTRIBUTING.md)
- Report a vulnerability privately: [SECURITY.md](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

## Develop

Needs [Bun](https://bun.sh) and [Rust](https://rustup.rs).

```sh
bun install
bun run app:dev      # the desktop app, hot reload
bun run dev          # the UI alone in a browser (localStorage stands in for the keychain)
bun run test         # core tests
bun run typecheck
cd src-tauri && cargo test
bun run app:build    # a signed build needs TAURI_SIGNING_PRIVATE_KEY
```

`src/core/` is the app (providers, agent loop, approvals, schedules, Earth Care
Network sign-in, MCP) as plain TypeScript with no UI, tested with `bun test`.
`src-tauri/` is the shell: keychain, `~/Mystic`, the sign-in loopback, HTTP,
updater. `src/ui/` is React.

## Brand

Mystic wears Earth Care Network brand kit v3: the leaf mark in Dusk (`#9362c4`),
Bricolage Grotesque and Inter, Paper and Night. See [brand/BRAND.md](brand/BRAND.md).
