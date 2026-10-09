# VISITE — A Journey Into Nature

A complete illustrated nature landing page inspired by the supplied Notosan video reference.

## Run locally

Requires Node.js 22.13+ and pnpm 11.25+.

```sh
pnpm install
pnpm dev
```

Production build: `pnpm build`.

The application uses React 19, Next.js-compatible App Router components through Vinext, TypeScript, Tailwind CSS 4, GSAP ScrollTrigger, and Lenis. The supplied Sites integration deploys to a Cloudflare Worker. The source is not a static screenshot and does not embed the reference recording.

## Reference analysis

The supplied recording is 402 × 306 pixels and approximately 12.65 seconds long. It shows about ten seconds of website footage followed by playback-end UI. Three actual page scenes can be identified:

- 0–1.0s: violet/gold mountain landscape, very large white serif VISITE title on the left, red-cloaked traveler on the right, small fixed navigation.
- 1.3–3.8s: Tranquility section; pale vertical waterfall on the left, copy on the right, seated traveler below, birds flying across the composition.
- 4.3–6.5s: Biodiversity section; copy on the left, waterfall on the right, spotted deer and flowers at the bottom.
- 6.7–7.8s: rapid upward scroll back through the scenes.
- 8.0–9.8s: the hero is visible again.

The design preserves the overall composition and illustration language of those three scenes. The original font files, layered source artwork, exact scroll timings, and complete original page are not included in the recording; these have been reconstructed. Artwork was newly generated from the supplied reference frames and recomposed separately for mobile. It is not the original website artwork and is not a pixel-identical copy.

## Full-page structure

1. Fixed responsive navigation and cinematic VISITE hero.
2. Tranquility waterfall scene, animated stream, birds, and expanded story dialog.
3. Biodiversity forest scene, wildlife/flora/water hotspots and field notes.
4. Editorial reflection section with scroll-linked text emphasis.
5. Three visual chapter cards and a personal journey planner.
6. Responsible exploration guide with accessible native disclosure controls.
7. Full-screen closing call to action.
8. Complete footer, accessibility information, and privacy controls.

Sections four onward extend the reference's style: they are not claimed to be visible in the recording.

## Interactions

- Smooth wheel scrolling with native touch scrolling.
- GSAP parallax for scenery and foreground foliage, staggered hero text and scroll reveals.
- CSS bird, waterfall, light, and particle motion. Below-fold effects pause out of view.
- Fixed chapter controls, hover details, and a mobile navigation dialog.
- Working nature hotspots and detailed story dialogs with Escape and native keyboard focus behavior.
- A journey planner storing an optional first name and preferred chapter in localStorage (`visite-journey-v1`).
- A generated text download of the visitor's field notes. No actual trip booking or account is implied.
- Ambient sound synthesized locally with Web Audio, off by default and enabled only by a user gesture.
- Reduced-motion support, skip navigation, keyboard focus indicators, meaningful labels, and responsive portrait artwork.

## Living paintings

Each scene painting is redrawn every frame by a WebGL layer (`components/nature/living/`) that sits over the still image, plus an SVG layer of flying birds:

- Waterfalls flow (flow-map animation with falling streaks and rising mist); lakes and pools shimmer, glint and ripple where you click.
- Grass, plants, the traveler's scarf and cloak, and the fisherman's straw cape move in a shared wind that gusts, and that picks up when you scroll fast or sweep the cursor through it.
- Clouds billow and thin wisps drift; the sunlit peak breathes and a slow light sweep crosses it; valley fog drifts; stars twinkle; light rays shimmer with floating dust.
- Mouse (or idle drift, and scroll) moves a depth-mapped camera, so near grass, mid mountains and far peaks separate in 3D.
- Characters are rigged: the traveler breathes and his hat rocks in the wind; the fisherman breathes, swings his feet, gets bites (rod dips, line follows, ripples spread) and looks up when you come close; the painted doves flutter, and new doves fly through.
- The deer's head and neck are a cut-out, skinned mesh over a clean plate: it lowers its head to eat from the bush, chews, lifts up to look at you, flicks its ears and tail and blinks. Hover near it and it stops eating to watch you.
- The painted cranes are replaced by an animated flock that flies on across the sky and veers around the cursor.

It respects `prefers-reduced-motion` (stays the still painting), pauses off-screen, boots each scene only when it is about a screen away, lowers its render resolution automatically on slow GPUs, and falls back to the image if WebGL is unavailable. `?living-realtime` keeps simulated time in step with the clock when testing on software GL.

The control maps, clean plates and deer sprites in `public/art/live/` and `components/nature/living/art-manifest.ts` are generated from the paintings by `scripts/living-art/build.py` (Python 3 with numpy, pillow and opencv-contrib-python). Region and rig coordinates live in that script; run `python scripts/living-art/build.py --preview` after changing artwork and check the overlays written to `.tmp/living-preview/`.

## Code map

- `app/page.tsx` — route.
- `app/layout.tsx` — metadata and document shell.
- `app/globals.css` — visual system, responsive layouts, and lightweight motion.
- `components/nature/NatureExperience.tsx` — full page and scene content.
- `components/nature/useNatureMotion.ts` — GSAP and Lenis lifecycle/cleanup.
- `components/nature/Atmosphere.tsx` — vector birds, reeds, particles, and water.
- `components/nature/ExperienceDialog.tsx` — accessible native modal.
- `components/nature/JourneyPlanner.tsx` — saved preferences and downloadable field notes.
- `public/art/` — all six optimized, self-contained desktop/mobile illustrations.

## Artwork

Generated with the built-in image generation tool, then encoded as optimized WebP. No external image service is required to run the site.

Prompt direction: faithfully reconstruct the supplied illustration frames without their typography/UI; use angular gouache-style golden mountains, violet skies, red-cloaked straw-hat travelers, lavender waterfalls, spotted deer, and indigo plants. Separate portrait compositions keep negative space for text and preserve key subjects on narrow screens.

Files: hero.webp, waterfall.webp, forest.webp, hero-mobile.webp, waterfall-mobile.webp, forest-mobile.webp. Total artwork payload approximately 1.21 MB (a device loads its matching scene sources).

## Validation

- TypeScript no-emit check passed.
- Production build passed.
- React server rendering passed.
- All 21 rendered internal anchor targets resolved.
- All six referenced scene artwork assets exist.
- Responsive breakpoints and reduced-motion behavior reviewed in source.
- Interactive browser/device QA was unavailable in the build session. Live visual rendering, mobile browser behavior, and animation frame rates still require a browser pass.
