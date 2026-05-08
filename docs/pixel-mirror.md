# Pixel Mirror Sections

Pixel mirror sections are an explicit technical-debt escape hatch for debugging
and migration work. A pixel mirror renders a Figma section raster as the visible
layer while keeping React DOM only for anchors or semantic structure. It is not
valid final React publishing output by default.

Use this pattern sparingly. Visible text inside a pixel mirror is raster-baked,
not real DOM. It will not behave like normal content for editing, translation,
text resizing, forced colors, copy/paste, or design-system reuse.

## Temporary Opt-In

If a temporary review build truly needs a pixel mirror, it must declare:

```tsx
<section
  data-anchor="Home/section-3"
  data-pixel-mirror="Home/section-3"
  data-pixel-mirror-reason="temporary strict visual parity; replace with DOM layout"
>
```

Prefer a shared `PixelMirrorSection` primitive that renders these attributes and
requires a namespaced reason prop such as `pixelMirrorReason`. Do not use a
generic `reason` prop for this policy; it is too easy to confuse with unrelated
component APIs. Hidden anchor geometry should be isolated in a `HiddenAnchorLayer`
primitive so the debt is searchable.

The opt-in is structural, not file-wide. It is still blocked in final quality
unless `PUBLISH_HARNESS_ALLOW_PIXEL_MIRROR=1` is explicitly set for a temporary
review run. One `PixelMirrorSection` must not exempt unrelated sibling sections
in the same file.

## Harness Policy

- `data-anchor` / `data-anchors` on real visible DOM are allowed.
- Product photos, decorative images, and complex non-text bitmaps are allowed.
- Full-section `figma-section-*.png` backdrops fail G12 by default, even inside
  `PixelMirrorSection`. A reason only documents temporary debt; it does not make
  the page complete.
- Hidden anchor layers and `FigmaAnchorOverlay` fail G12 by default. Required
  anchors must attach to visible DOM boxes in reusable implementation code.
- CSS rules that use `figma-section-*` as a full-section backdrop must carry an
  explicit `pixel-mirror-reason: ...` declaration in that rule, or they fail
  G12. A selector name containing `pixel-mirror` is not enough.
- Hidden anchor elements outside a pixel-mirror boundary fail G12.
- String-concat style evasion such as `("abs" + "olute")` fails G12.
- Pixel mirror count is a final blocker by default. The target is zero.

The current page L1 budget can be temporarily relaxed to 10% while the long-term
target remains 5%. That relaxation is meant to make reusable DOM
implementations feasible; it is not permission to replace sections with
screenshots.

Use `G1_ENFORCE_L1_TARGET=1` when the project is ready to promote the long-term
target. In that mode G1 uses the target threshold, currently 5%, as the
effective L1 gate, and the final verifier rejects quality JSON that still has a
positive L1 `targetGap`.
