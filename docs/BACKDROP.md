# Console backdrop

`public/console/img/backdrop.webp` sits behind every console view, right of the
sidebar, fixed so it does not scroll.

## Swapping it

Copy any of the alternates over it and redeploy:

    cp docs/backdrop-alt-abstract.webp public/console/img/backdrop.webp
    vercel deploy --prod --yes

| file | what it is |
|---|---|
| *(installed)* | clinic interior — oak, navy, brass, empty chair |
| `backdrop-alt-abstract.webp` | brass and cream stone, fully out of focus. Calmest behind data |
| `backdrop-alt-couple.webp` | couple on a porch at dusk |
| `backdrop-alt-road.webp` | runner on a tree-lined road at dawn |

## The veil

`--backdrop-veil` in `console.css` is how much cream sits over the image.
`0.93` means 7% of the photograph shows through. Lower it and the image gets
stronger; measure text contrast afterwards, because this is working UI and the
type sits directly on it.

Measured at 0.93, across every view, the worst text-on-backdrop pair is
**4.82:1** (the muted eyebrow labels) against a 4.5:1 requirement.

## Making new ones

    node scripts/backdrop-generate.js <outDir>

Uses `XAI_API_KEY` from the LIMEN repo's `.env.local` and the
`grok-imagine-image` model. Roughly $0.07 an image. Output is 1280x720 JPEG;
convert to WebP before installing — at this veil it never needs to be sharp,
and 1280 wide at quality 0.72 lands around 12kb.
