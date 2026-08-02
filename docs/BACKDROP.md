# Console backdrop

The same file sits behind **every console view and every app screen**
(`public/console/img/backdrop.webp` and `public/app/img/backdrop.webp`), so the
two halves of the product share a room. It sits behind every console view, right of the
sidebar, fixed so it does not scroll.

## Swapping it

Copy any of the alternates over it and redeploy:

    cp docs/backdrop-alt-abstract.webp public/console/img/backdrop.webp
    vercel deploy --prod --yes

| file | what it is | darkest pixel |
|---|---|---|
| *(installed)* | **lion in bright haze** | rgb(221,201,174) |
| `backdrop-alt-lion-faint.webp` | lion, barely there | rgb(230,214,187) |
| `backdrop-alt-lion-studio.webp` | lion on white, more defined | rgb(162,135,105) |
| `backdrop-alt-waitingroom.webp` | bright clinic waiting room | rgb(162,144,128) |
| `backdrop-alt-linen.webp` | cream linen and a gold thread | rgb(205,201,195) |
| `backdrop-alt-couple-light.webp` | couple outdoors, washed out | rgb(210,202,194) |
| `backdrop-alt-clinic-dark.webp` | clinic, oak and navy. **Unusable**, caps at 3% | rgb(19,18,23) |
| `backdrop-alt-abstract.webp` | brass and stone. **Unusable**, caps at 4% | rgb(85,60,30) |
| `backdrop-alt-couple.webp` | couple at dusk. **Unusable**, caps at 3% | rgb(32,24,20) |
| `backdrop-alt-road.webp` | runner at dawn. **Unusable**, caps at 3% | rgb(58,48,40) |

Anything whose darkest pixel is below about rgb(160,140,120) cannot be shown
above a few percent without dark text failing on it. That is the whole test.

## One thing to watch on the app

The home hero photograph is masked to transparent at its foot. It needs its own
opaque ground (`.hero2 { background: var(--cream) }`) or it dissolves into the
backdrop instead of into paper, and you get two photographs bleeding through
each other. That was a real bug: a sofa came through the couple.

## Why the image is high-key

A photograph with real shadows in it CANNOT sit behind dark text. Measured on
the four first-pass candidates, all of them ordinary photographs: the strongest
each could be shown while navy and grey text still cleared 4.5:1 was **3-4%**.
Not a matter of taste, just arithmetic — dark text needs a light ground, and a
shadow anywhere in the frame is where it fails.

The installed image is deliberately overexposed. Its darkest pixel is
rgb(162,144,128), which navy type clears at 4.5:1 with **no veil at all**.

The second thing that had to change: the small grey labels are the only text
that sits on raw photograph rather than on a card, and grey-on-photo fails
before anything else does. Outside a card they now wear navy. Inside a card, on
a known white surface, grey is still correct and stays.

## The veil

`--backdrop-veil` in `console.css` is how much cream sits over the image.
`0.93` means 7% of the photograph shows through. Lower it and the image gets
stronger; measure text contrast afterwards, because this is working UI and the
type sits directly on it.

Measured at 0.18 — the image showing at 82% — against the DARKEST pixel in it,
across every console view: worst pair **8.93:1**, against a 4.5:1 requirement.

## Making new ones

    node scripts/backdrop-generate.js <outDir>

Uses `XAI_API_KEY` from the LIMEN repo's `.env.local` and the
`grok-imagine-image` model. Roughly $0.07 an image. Output is 1280x720 JPEG;
convert to WebP before installing — at this veil it never needs to be sharp,
and 1280 wide at quality 0.72 lands around 12kb.
