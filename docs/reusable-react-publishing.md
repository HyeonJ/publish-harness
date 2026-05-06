# Reusable React publishing guide

The output of publish-harness should be maintainable React, not a one-off page
dump. Pixel similarity matters, but the final project must also have clear
ownership boundaries and reusable components.

For empty-directory Figma React publishing, this is not an optional strategy to
ask the user about. Reusable React structure, Figma assets, tokenized CSS,
per-route baselines/anchors, per-route quality gates, and final verifier are
the default required path.

Publishing is not complete until `node scripts/assert-completion-contract.mjs`
exits 0. Build/lint/typecheck and route 200 checks are useful smoke checks, but
they are not completion. If `.publish-harness/INCOMPLETE.json` exists, the final
response must start with `BLOCKED/INCOMPLETE: publish-harness completion
contract failed.` Blocked/incomplete is an intermediate failure state, not a
final answer. Do not end the turn in that state unless an external blocker
prevents all further local fixes or the user explicitly asks you to stop.
Otherwise keep diagnosing, fixing, rerunning gates, and updating logs until the
completion contract passes.

## Required Structure

For Vite React projects:

```text
src/
  App.tsx
  data/
  components/
    layout/
    ui/
    sections/
  pages/
  styles/
    base.css
    typography.css
    components/
    pages/
    responsive.css
```

For multi-page Figma files, `App.tsx` must define routes and stay small. Use
`src/pages/*Page.tsx` for route-level composition and `src/components/layout`
for shared Header/Footer/SiteLayout.

## Extraction Rules

- Repeated across all pages: `src/components/layout`.
- Repeated across 2+ pages or 3+ sections: `src/components/ui` or a domain
  folder such as `src/components/product`.
- Page-specific large blocks: `src/components/sections/<page>/`.
- Lists of cards/items: data array + reusable item component.
- Brand marks, buttons, tags, badges, and decorative dividers should not be
  reimplemented inline in every section.
- `src/styles/index.css` should compose imports only. Put reusable component
  rules in `src/styles/components/*`, route-specific rules in
  `src/styles/pages/*`, and cross-route responsive rules in
  `src/styles/responsive.css`.
- Variants such as button tone or footer tone should use modifier classes
  (`brand-button--dark`, `footer--caramel`) instead of inline `style` objects.
- Figma hug-content controls such as pills, chips, tags, badges, and small
  labels must not stretch to the parent column. Use `inline-flex`,
  `width: fit-content`, `white-space: nowrap`, and start self-alignment unless
  the Figma node is explicitly full width.
- Remove scaffold placeholders such as `src/routes/HomePlaceholder.tsx` before
  publishing.
- Decorative images must live behind content with explicit layer rules. Use a
  layout-owned decor layer or set decorative assets to `z-index: 0` and
  `pointer-events: none`, with header/main/footer content above them.
  Do not delete, hide, make transparent, bury behind the page background, or
  translate offscreen visible Figma decorative assets.
- If a visible Figma asset overlaps the nav/main boundary, starts above the
  main content, or has a negative y-position, implement it as root/page decor
  rather than a normal-flow child. The page shell should establish the stacking
  context (`position: relative`, `isolation: isolate`), decor should sit at
  `z-index: 0`, and content should sit above it.
- Figma anchors are part of the implementation contract. Required anchors from
  `baselines/<Page>/anchors-*.json` must exist in the DOM with exact
  `data-anchor` values. Shared layout components should accept a page id so
  route-specific anchors can be rendered without duplicating layout JSX.
- For nav/buttons/tabs, distinguish the outer control bbox from the inner label
  text bbox. Attach anchors to the element whose browser bbox represents the
  corresponding Figma node.
- Footer wordmarks should be full-size reusable elements. Do not attach a
  large wordmark anchor to a small nested span.
- Repeated exhibit/case-study image stacks should follow manifest bbox order
  and bbox height/ratio. Use bbox-driven height and `object-fit` when natural
  image ratios would accumulate vertical drift.
- When independently exported assets cannot match the Figma baseline pixels,
  crop implementation media from the authoritative baseline with
  `scripts/export-baseline-assets.mjs` instead of hand-recreating gradients or
  relying on visually different MCP renders.
- Reusable logo/icon cards need normalization metadata when assets have
  different viewBox or whitespace. Prefer bbox/size metadata such as
  `logoScale`, `logoFit`, `logoWidth`, `logoHeight`, `logoBBox`, or `--logo-*`
  CSS variables over one-size-fits-all image rules.
  `logoClassName` alone is not enough; it must map to explicit Figma-bbox or
  optical-size dimensions.
  Card media frames may share a uniform size, but the visible logo should use a
  Figma-bbox or optical-size fit box with `object-fit: contain`. Avoid
  `width: 100%; height: auto` as the only sizing rule for repeated brand marks.
- Fix mojibake before shipping. Replacement characters (U+FFFD) or obvious
  mojibake sequences in React/data files are publishing defects, not acceptable
  approximations.

## Anti-Patterns

- One large `App.tsx` containing every page and section.
- Anchor links standing in for actual routes when the Figma source has route
  pages such as `/about` and `/find-us`.
- Repeated Header/Footer JSX copied into each page.
- CSS for all pages in one huge page stylesheet.
- `index.css` containing hundreds of lines of rules instead of imports.
- Inline style objects used for reusable variants that should be CSS classes.
- Pill/chip/tag/badge/label controls using `width: 100%`, `flex: 1`, stretch
  self-alignment, or block/flex display without fit-content behavior.
- Bootstrap placeholder routes left in `src/routes`.
- Absolute decorative images with positive z-index above page content.
- Visible Figma decorative assets hidden with `display:none`, `opacity:0`,
  excessive negative `z-index`, or offscreen transforms.
- Required Figma anchors missing from the DOM, especially after baseline
  manifests have been generated.
- Nav/button anchors attached to the wrong node, such as a label anchor on an
  outer button or a control anchor on an inner span.
- Footer wordmark anchors attached to small text spans.
- Repeated exhibit images rendered with `height:auto` when Figma bbox heights
  require explicit sizing.
- Project/logo cards that treat every logo asset as visually equivalent.
- Project/logo card images that rely on natural asset ratio instead of an
  explicit contain fit box and per-logo sizing metadata.
- Mojibake or broken encoding in visible strings.
- Large components with embedded data, layout, and repeated item markup mixed
  together.

## Gate

`scripts/check-react-reusability.mjs` is run by `measure-quality.sh` as G12 for
React templates. It blocks the most expensive structural mistakes:

- multi-page progress without React routes
- missing shared layout components
- missing route page components
- missing component/page stylesheet boundaries for multi-page React output
- monolithic or oversized React files
- monolithic or oversized CSS files
- scaffold placeholders and mojibake text
- warnings for suspicious decorative z-index and unnormalized logo cards
- failures for logo/card media that uses natural `height:auto` sizing without a
  fit box, component-owned logo CSS outside `src/styles`, or ProjectCard logo
  rendering without bbox/size normalization metadata
- warnings for logo/card media missing `object-fit: contain`
- warnings for hidden or offscreen decorative assets
- warnings for stretched pill/chip/tag/badge/label controls that should hug
  contents
- strict visual diagnostics for required anchors, decorative flow drift,
  repeated stack drift, repeated logo scale drift, section height explosion,
  and likely wrong anchor targets

Set `G12_STRICT=1` when warning-class defects should fail the gate during
review or smoke runs.

For multi-page Figma projects, run `measure-quality.sh` once per discovered
route/page section. A single aggregate section such as `site-pages` is not a
valid replacement for per-route quality JSON. Final Figma quality also requires
strict G1 baselines and a reachable `__preview/<section>` route for G7; `LITE=1`
and missing preview routes are failures.
