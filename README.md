# Lagrange Points

An interactive website about Lagrange points in a Sun-Earth system, shown in a rotating reference frame. You can move a test particle and inspect acceleration vectors from the Sun (`g_sun`), Earth (`g_earth`), the centrifugal term, and their vector sum, while tracking where `L1`-`L5` appear for different mass ratios.

## Website

## [https://lagrange-points.thesmirnov.com](https://lagrange-points.thesmirnov.com)

## What You Can Do

- Move the test particle around the scene and inspect local vector balance.
- Lock/unlock the particle to freeze a point and compare vectors precisely.
- Change the Earth mass using the slider.
- Use quick presets for Earth and Jupiter-like mass ratios.
- Toggle grid, Lagrange points, force vectors, and orbit overlays.

## Notes

- This is an educational, normalized model intended for intuition and visual exploration.
- Labels `Sun` and `Earth` are used as intuitive naming to make the scene immediately readable; physically this is just a two-body system where one body is more massive than the other.
- `CM` means center of mass.
- The default Earth mass is set to `25%` of the Sun mass on purpose to keep the visualization readable. With realistic Sun-Earth ratios, the mass contrast is so extreme that many effects become hard to notice at a glance.

## Controls

Mouse / touch:

- Move pointer to move the particle (when unlocked).
- Click/tap canvas to lock or unlock the particle.

Keyboard hotkeys:

- `1` Toggle `g_sun`
- `2` Toggle `g_earth`
- `3` Toggle centrifugal
- `4` Toggle vector sum
- `L` Toggle Lagrange points
- `G` Toggle grid
- `Space` Lock/unlock particle
- `O` Toggle Sun-Earth orbit
- `C` Toggle CM-Earth orbit
- `R` Reset state

## Why This Exists

One night around 2 a.m., I was already half asleep when my brain suddenly resurrected a random podcast fragment from about two weeks earlier: Lagrange points. Naturally, that was the perfect moment to become curious.

I started digging in. `L1`, `L2`, and `L3` clicked pretty quickly, but `L4` and `L5` still felt slippery. The equilateral-triangle part looked almost like cheating, and the fact that these points stay in place regardless of the two-body mass ratio felt like pure mathematical black magic.

So instead of sleeping like a reasonable person, I built this visualization to see the vector balance with my own eyes. It finally made everything click. Then I went to bed.

Next day I was tired. Absolute mystery.
