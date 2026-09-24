# Lagrange Points

An interactive explorer of the five Lagrange points of a two-body system. The view spins with the Sun and Earth, so both stand still. Drag a probe around and watch three pulls act on it: the **Sun's pull**, **Earth's pull** and the **spin push** of the rotating frame. They are drawn tip to tail. Where the chain closes back on the probe, nothing is left over: a spacecraft could ride along with Earth there, engine off.

## Website

## [https://lagrange-points.thesmirnov.com](https://lagrange-points.thesmirnov.com)

## The one picture

All arrows share one scale, the rotating frame's natural scale 1/ω². At that scale the spin push drawn from the probe is an exact copy of the line from the centre of mass (CM) to the probe. So balance is something you can see without adding vectors in your head:

> **Balance means gravity lands on the centre of mass.**

The Sun's pull, then Earth's pull, chained from the probe, must end exactly on the target ring at the CM. The spin push then runs back along that same line and the loop closes.

This is also why L4 and L5 form an equilateral triangle for *any* masses. At distance *a* (the Sun–Earth distance) from a body, that body pulls you exactly its mass share of the way toward it. Mass shares always add up to the centre of mass, whatever the masses are. Stand at distance *a* from both, and gravity lands on the CM.

## What you can do

- **Find the balance.** On a first visit the five points are hidden. Drag the probe until the white *leftover* arrow vanishes; the probe snaps onto the exact point and the loop closes. Hints show up if you get stuck, and **Show all** is always there.
- **Does L4 move?** Predict, then watch the mass sweep from the real Earth to equal masses. The arrows change wildly, but the loop at L4 never opens.
- **Six short chapters** (the dots in the bottom bar): Find the balance, Why a triangle?, Three on the line, Real scale, Let go, Explore.
- **Real scale.** Jump to the real Sun–Earth ratio and zoom in on Earth to see L1 and L2 1.5 million km out, where SOHO and JWST live.
- **Let go.** Release the probe and simulate its motion (with the Coriolis effect) to see that balanced is not the same as stable: L4 holds below a mass ratio of about 4% (Jupiter's Trojans), L1–L3 never do.
- **Hold: real motion.** Stop the frame from spinning for a moment and watch everything circle the centre of mass together.
- **Share a view.** The ⋯ menu copies a link with the chapter, mass and probe position.
- **English and Russian.** The language follows your browser; switch with the EN/RU button (or the ⋯ menu on phones), or link to a language with `?lang=ru` / `?lang=en`.

## Controls

Mouse and touch:

- Press or tap anywhere to put the probe there, then drag. On touch screens the drag is relative (like a trackpad) so your finger never hides the arrows.
- Scroll or pinch to zoom; Shift-drag to pan. Hold Alt to turn off snapping.

Keyboard:

| Key | Action |
| --- | --- |
| Arrow keys | Move the probe (Shift: faster, Alt: finer) |
| `1`–`5` | Jump to L1–L5 (once found) |
| `[` `]` | Change the mass (Shift: next preset) |
| `S` | Sweep the mass |
| `Space` | Let go / catch the probe (chapter "Let go" and Explore) |
| `F` | Chain or fan arrows |
| `Z` / `0` | Zoom to Earth / fit view |
| `R` | Reset probe and mass (Shift+R: start over) |
| `PgUp` `PgDn` | Previous / next chapter |
| `?` or `H` | Help |
| `Esc` | Stop an animation |

## Notes on the model

- Circular restricted three-body problem in the co-rotating frame, in normalized units: G = 1, Sun–Earth distance *a* = 1, Sun mass 1, Earth mass *q*. The frame spins at ω² = 1 + *q*.
- The arrows show the acceleration of a probe **at rest** in the spinning frame. Coriolis only appears once the probe moves (chapter "Let go").
- "Sun" and "Earth" are just names for a heavier and a lighter body. The default mass (25% of the Sun) is exaggerated on purpose so every effect is easy to see; the slider's Earth tick is the real ratio (0.0003%), and the label next to the value says how exaggerated the current mass is.
- `CM` is the centre of mass.

## Development

No build step and no dependencies: the site is static HTML, CSS and ES modules.

```bash
python3 -m http.server 8000
```

```bash
npm test
```

Every push to `master` runs the tests and deploys the site to GitHub Pages (`.github/workflows/deploy.yml`).

The tests (Node's built-in runner) check the physics: all five points balance for every mass ratio, the equilateral property, the bullseye identity of the drawing, conservation of the Jacobi constant in the release simulation, and stability at L4 below and above Routh's limit.

Layout:

- `js/physics.js` pure physics (Lagrange points, accelerations, integrator). No DOM.
- `js/chain.js` geometry of the tip-to-tail chain, the shared scale and the target ring.
- `js/app.js` app context, render loop (renders on demand), probe, snapping, mass.
- `js/scene.js` core canvas layers. `js/ui.js` DOM overlay. `js/input.js` pointer, touch, keyboard.
- `js/story.js` chapter engine, mass sweep, predictions. `js/chapters/` one module per chapter.
- `js/features/` global features: mass shares and compass circles, axis profile, real-scale view, release simulation, real motion.

## Why This Exists

One night around 2 a.m., I was already half asleep when my brain suddenly resurrected a random podcast fragment from about two weeks earlier: Lagrange points. Naturally, that was the perfect moment to become curious.

I started digging in. `L1`, `L2`, and `L3` clicked pretty quickly, but `L4` and `L5` still felt slippery. The equilateral-triangle part looked almost like cheating, and the fact that these points stay in place regardless of the two-body mass ratio felt like pure mathematical black magic.

So instead of sleeping like a reasonable person, I built this visualization to see the vector balance with my own eyes. It finally made everything click. Then I went to bed.

Next day I was tired. Absolute mystery.
