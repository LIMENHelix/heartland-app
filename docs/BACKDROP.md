# Console backdrop

The same file sits behind **every console view and every app screen**
(`public/console/img/backdrop.webp` and `public/app/img/backdrop.webp`), so the
two halves of the product share a room. It sits behind every console view, right of the
sidebar, fixed so it does not scroll.

## Swapping it

Copy any of the alternates over it and redeploy:

    cp docs/backdrop-alt-abstract.webp public/console/img/backdrop.webp
    vercel deploy --prod --yes

| file | what it is |
|---|---|
| *(installed)* | bright clinic waiting room, high-key |
| `backdrop-alt-linen.webp` | cream linen and a gold thread, high-key. Calmest |
| `backdrop-alt-couple-light.webp` | couple outdoors, washed out, high-key |
| `backdrop-alt-clinic-dark.webp` | clinic interior, oak and navy. **Too dark to show above 3%** |
| `backdrop-alt-abstract.webp` | brass and cream stone. **Too dark to show above 4%** |
| `backdrop-alt-couple.webp` | couple at dusk. **Too dark to show above 3%** |
| `backdrop-alt-road.webp` | runner at dawn. **Too dark to show above 3%** |

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

Measured at 0.28 — the image showing at 72% — against the DARKEST pixel in it,
across every console view: worst pair **6.03:1**, against a 4.5:1 requirement.

## Making new ones

    node scripts/backdrop-generate.js <outDir>

Uses `XAI_API_KEY` from the LIMEN repo's `.env.local` and the
`grok-imagine-image` model. Roughly $0.07 an image. Output is 1280x720 JPEG;
convert to WebP before installing — at this veil it never needs to be sharp,
and 1280 wide at quality 0.72 lands around 12kb.
