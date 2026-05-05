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

## Anti-Patterns

- One large `App.tsx` containing every page and section.
- Anchor links standing in for actual routes when the Figma source has route
  pages such as `/about` and `/find-us`.
- Repeated Header/Footer JSX copied into each page.
- CSS for all pages in one huge page stylesheet.
- Large components with embedded data, layout, and repeated item markup mixed
  together.

## Gate

`scripts/check-react-reusability.mjs` is run by `measure-quality.sh` as G12 for
React templates. It blocks the most expensive structural mistakes:

- multi-page progress without React routes
- missing shared layout components
- missing route page components
- monolithic or oversized React files
