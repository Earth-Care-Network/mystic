# Mystic brand kit

Mystic is part of the Earth Care Network family. It follows Earth Care Network brand
kit v3: **one leaf, one colour, every brand.**

## Name

- In full: **Mystic by Earth Care Network**. Use the full name in a title, on a store page,
  and the first time Mystic appears on a page.
- After that, **Mystic**.
- The cloud is **Earth Care Cloud**. Earth Care Network's agent is **Jaguar**.
- Never "Mystic AI", "MysticGPT", or "the Mystic app".

## Mark

`mark.svg` is the Earth Care leaf. Inside it, four agents are joined into one
constellation along the rib: a team working as one.

| File | Use |
|--|--|
| `mark.svg` | Dusk, on Paper, White, Night and Night surface |
| `mark-ink.svg` | on light photographs |
| `mark-white.svg` | on dark photographs and on a Dusk surface |
| `app-icon.svg`, `app-icon.png` | the macOS and iOS app icon: Dusk mark on Paper (the OS draws the corners) |

- The mark is always transparent. Never put it on a disc, a tile or a badge, never on Dusk
  itself, and never add glows, shadows, outlines, gradients, stretching or recolouring.
  The app icon is the one exception: a square of Paper, because the OS requires one.
- Leave clear space of a quarter of the mark's width on every side.
- Smallest size: 16 px. Under 24 px, use the heavier strokes that `src/ui/Mark.tsx` draws.

## Colour

| Name | Hex | Paper | White | Night | Night surface |
|--|--|--|--|--|--|
| **Dusk** (Mystic) | `#9362c4` | 4.0 | 4.4 | 4.4 | 4.0 |
| Canopy (Earth Care Network) | `#2b885d` | 4.0 | 4.4 | 4.4 | 4.0 |
| Rose (Studio) | `#d04380` | | | | |
| Amber (Legal) | `#aa6a15` | | | | |
| Sky (Cloud) | `#3080a6` | | | | |

Dusk is one colour, the same in light and dark. Its contrast matches every sibling's.

Neutrals:

| | Paper (light) | Night (dark) |
|--|--|--|
| ground | `#f7f5f0` | `#0b100e` |
| surface | `#ffffff` | `#141a17` |
| ink | `#1f1d1a` | `#eef2ee` |
| muted | `#6b665e` | `#a3aea7` |
| line | `#e4dfd5` | `#27302b` |

**Where Dusk goes:** the mark, the word "Mystic" in a lockup, headlines of 24 px and up,
thin rules (the active agent, the selected tab, the focus ring). **Text, links and buttons
are ink.** A button is never filled with Dusk.

In the app, status keeps the family's colours: Canopy for done, Amber for "waiting for
you", and red only for an error.

## Type

- **Bricolage Grotesque** for display: headlines, lockups, the product word.
- **Inter** for body, labels and captions.
- Nothing under 12 px.
- Both ship inside the app (`@fontsource-variable`, SIL Open Font License), so Mystic never
  loads fonts from the network.

## Voice

Mystic speaks like Earth Care Network: plain, warm and exact.

- One sentence says what happened. The next says what to do.
- Say who decides. Every write waits for the person, and the words say so: "Allow once",
  "Refuse", "Waiting for you".
- No hype, no exclamation marks, and no "AI-powered".
- The shared ethics close the first screen: *Earth Care · People Care · Future Care · Fair Share.*

## Lockups

- **Horizontal:** the mark, then "Mystic" in Bricolage 600 Dusk, with "by Earth Care
  Network" under it in Inter 11 px muted. This is the app's sidebar.
- **Stacked:** the mark (88 px), "Mystic" in 44 px Dusk, and "by Earth Care Network" in
  13 px muted. This is the first screen and the website hero.
