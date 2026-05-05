# Reusable React publishing guide

The output of publish-harness should be maintainable React, not a one-off page
dump. Pixel similarity matters, but the final project must also have clear
ownership boundaries and reusable components.

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
- Reusable logo/icon cards need normalization metadata when assets have
  different viewBox or whitespace. Prefer `logoScale`, `logoClassName`,
  `logoFit`, or `--logo-*` CSS variables over one-size-fits-all image rules.
- Fix mojibake before shipping. Strings such as `�`, `챕`, `짤`, or `?셫` in
  React/data files are publishing defects, not acceptable approximations.

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
- Project/logo cards that treat every logo asset as visually equivalent.
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
- warnings for stretched pill/chip/tag/badge/label controls that should hug
  contents
