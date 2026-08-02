# Console and app backdrop

The same file sits behind **every console view and every app screen**
(`public/console/img/backdrop.webp`, `public/app/img/backdrop.webp`), fixed so
it does not scroll. On the console it starts right of the sidebar; the sidebar
keeps its own solid surface and sits above it.

It is the app-icon lion — the same photograph as the home-screen icon —
processed so dark text can sit on it.

## Regenerating it

    node scripts/backdrop-from-icon.js public/app/icons/icon-512.png <outDir> [strength]

`strength` is the mark's opacity x1000. Installed at **700**.

| strength | darkest pixel | navy text | grey text |
|---|---|---|---|
| 420 | rgb(201,186,161) | 7.05:1 | 2.80:1 |
| 550 | rgb(187,169,138) | 5.83:1 | 2.32:1 |
| **700** | **rgb(171,149,111)** | **4.61:1** | 1.83:1 |
| 850 | rgb(154,128,85) | 3.58:1 | fails |
| 1000 | rgb(138,108,58) | fails | fails |

Two alternates are in `docs/`: `backdrop-alt-lion-fainter.webp` (420) and
`backdrop-alt-lion-stronger.webp` (850, **navy fails AA at 3.58:1** — only for a
page with no loose text on it).

## How the processing works, and why

The icon is a bright lion on a near-black surround. Painting it directly is
impossible: dark type cannot sit on a dark photograph at any strength you would
actually see. Measured on eight ordinary photographs, the strongest any could be
shown while text still cleared 4.5:1 was **3-4%**.

So the script uses the icon's own **brightness as the mark's opacity**, painting
in warm tan on cream. The lion's mane and face become the mark; the black
surround resolves to paper exactly. Two consequences worth knowing:

- there is no rectangle edge to feather away, and no seam when the page crops it
- the output's darkest pixel is a number you choose, not one you inherit

Fill the canvas **black** before drawing, not cream. Brightness becomes ink, so
untouched margins must start at zero or they come out as solid tan bars.

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
