# Console and app backdrop

The same file sits behind **every console view and every app screen**
(`public/console/img/backdrop.webp`, `public/app/img/backdrop.webp`), fixed so
it does not scroll. On the console it starts right of the sidebar; the sidebar
keeps its own solid surface and sits above it.

It is the app-icon lion — the same photograph as the home-screen icon —
processed so dark text can sit on it.

## Regenerating it

    node scripts/backdrop-from-icon.js public/app/icons/icon-512.png <outDir> [lo] [hi] [sat]

Installed at **188 252 3.6**.

| lo / hi / sat | darkest pixel | navy text | look |
|---|---|---|---|
| 168 251 2.4 | rgb(168,168,169) | 5.64:1 | deepest, visible grey halo |
| **188 252 3.6** | **rgb(205,202,200)** | **8.22:1** | installed |
| 196 252 3.2 | rgb(210,208,208) | 8.73:1 | softer |

Two alternates in `docs/`: `backdrop-alt-lion-softer.webp` and
`backdrop-alt-lion-deeper.webp`. Copy either over
`public/console/img/backdrop.webp` and `public/app/img/backdrop.webp`.

## How the processing works, and why

The icon is a bright lion on a near-black surround. Painting it directly is
impossible: dark type cannot sit on a dark photograph at any strength you would
actually see. Measured on eight ordinary photographs, the strongest any could be
shown while text still cleared 4.5:1 was **3-4%**.

An earlier version solved that by using the icon's brightness as an opacity mask
and painting the whole thing in a single tan. It worked and it threw the
photograph away: a monotone stencil, no golds, no amber eyes. **Keep the
colour.** Three steps, in this order:

1. **Saturation up.** Step 2 compresses the range and would otherwise leave
   everything grey.
2. **Compress luminance into a light band** (`lo`-`hi`). Relative colour and
   detail survive; the whole image lifts clear of dark type. The output's
   darkest pixel becomes a number you choose rather than one you inherit.
3. **Fade to paper radially**, weighted slightly by each pixel's original
   brightness. This is what makes the icon's square edge and its near-black
   surround disappear instead of leaving a rectangle or a grey halo.

Two traps in that third step. Weight the fade by brightness too hard (0.18 +
0.82L) and the shadow detail that gives the head its shape burns away, leaving
something that reads as fire rather than a lion; 0.72 + 0.28L holds. And leave
the floor too low and the near-black surround compresses to a grey ring around
the head, which is why `lo` sits near 190 rather than near 168.

Because the image now carries its own lightness, `--backdrop-veil` is **0**.

## Text on the backdrop

Grey fails on this at 1.83:1. Every text node that is a direct child of `#main`
has no card under it and so sits on the lion; those wear navy (`console.css`,
the `#main > ...` block). Inside a card, on a known white surface, grey is still
correct and stays.

Verified across all ten console views by walking each text node's ancestors to
find the background that actually paints under it: **25 nodes sit on the lion,
worst pair 5.16:1** against a 4.5:1 requirement.

A narrower check missed an "empty" placeholder reading 2.05:1, so the rule
covers the whole set of direct children rather than named selectors.

## The trap on the app

The home hero photograph is masked to transparent at its foot. It needs its own
opaque ground (`.hero2 { background: var(--cream) }`) or it dissolves into the
backdrop instead of into paper, and two photographs bleed through each other.
That was a real bug: a sofa came through the couple.

## The veil

`--backdrop-veil` (0.10) is a little cream over the top for headroom. The image
is already pre-lightened by the processing above, so this is softening, not the
thing making the page legible.
