# Codex section worker guide

This guide is the Codex equivalent of Claude's `section-worker`. It is not a
separate runtime agent; it is the procedure Codex follows for one section or
component.

## Inputs

Collect these before implementation:

- `mode`: `figma` or `spec`
- `template`: `vite-react-ts`, `html-static`, or `nextjs-app-router`
- `section_name`
- preview route or output path
- required imports from Phase 2, if any
- previous failures, if retrying

Read:

- `CLAUDE.md` if present for shared harness rules
- `AGENTS.md` for Codex-specific rules
- `docs/workflow.md`
- `docs/reusable-react-publishing.md`
- `docs/project-context.md`
- `docs/token-audit.md`
- `PROGRESS.md` or `progress.json`
- `docs/components-spec.md` in spec mode
- `docs/figma-pages.md` in figma mode when it exists

When a figma URL has no `node-id`, do not choose one representative frame.
Run `node scripts/discover-figma-pages.mjs --file-key <fileKey> --out docs/figma-pages.md --apply`
and implement each discovered route page (`Home`, `/about`, `/find-us`, etc.)
through the normal progress queue.

## Step 1: Research

For figma mode:

- Export the section baseline with `scripts/figma-rest-image.sh`.
- Prefer existing `docs/page-structure.md`, `docs/text-content.md`, and anchor
  manifests over large design-context calls.
- Use leaf image node exports for assets. Do not export whole frames as images
  unless the script explicitly permits that case.

For spec mode:

- Treat `docs/components-spec.md` as the source of truth.
- Read the exact spec section, including Purpose, Props, Variants, States,
  Tokens, Example, and Don't sections.
- Use reference HTML only as a visual and structural reference. Rewrite the
  production implementation for the selected template.
- Do not call Figma.

Write a short `plan/<section>.md` only when it helps avoid ambiguity. Keep it to
component tree, assets, tokens, and known risks.

## Step 2: Assets

- Put assets under the section namespace:
  - Vite: `src/assets/<section>/`
  - html-static and Next: `public/assets/<section>/`
- Check downloaded images before using them when asset correctness affects the
  section.
- Prefer tokens, CSS, inline SVG, and existing components over rasterized text.

## Step 3: Implementation

- Edit only the files owned by the current unit.
- On Windows PowerShell, run package-manager commands as `npm.cmd` and
  `npx.cmd`. For background dev servers use
  `Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WindowStyle Hidden`.
- Use `required_imports` instead of recreating shared components.
- For multi-page React output, create route page components in `src/pages`,
  shared layout in `src/components/layout`, and keep `src/App.tsx` limited to
  routing/provider composition.
- Split CSS by ownership boundary. Keep `src/styles/index.css` as imports only,
  put reusable component/layout rules under `src/styles/components`, and put
  route-specific rules under `src/styles/pages`.
- Remove scaffold placeholders before finishing. `src/routes/HomePlaceholder.tsx`
  must not remain in published React output.
- Keep decorative images behind content. Give decorative layers
  `pointer-events: none`, avoid positive z-index above content, and verify that
  Figma foreground/background order matches the browser screenshot.
- Normalize reusable logo/icon cards. If assets vary in viewBox or whitespace,
  add metadata such as `logoScale`, `logoClassName`, or `--logo-*` CSS variables.
- Fix broken text encoding before gates. Mojibake in React/data strings is a
  defect.
- Extract repeated cards, buttons, wordmarks, badges, and dividers before
  implementing dependent page sections. Use data arrays plus item components for
  repeated lists.
- Do not copy Header/Footer JSX into multiple pages. Build `SiteLayout`,
  `Header`, and `Footer` once and reuse them.
- Respect template-specific output paths:
  - Vite sections: `src/components/sections/**`
  - Vite primitives: `src/components/{ui,brand,foundation}/**`
  - html-static: `public/__preview/<section>/index.html` plus scoped CSS/assets
  - Next: route/page files under `src/app/**` and preview under
    `src/app/__preview/<section>/page.tsx`
- Keep layout responsive for desktop, tablet, and mobile even when only desktop
  design exists.
- Avoid layout escapes unless the Figma topology requires them and the allowed
  escape is documented.

## Step 4: Gates

Run the harness gate entrypoint:

```bash
bash scripts/measure-quality.sh <section> <section-dir>
```

Fail fast on:

- G10 write-protected path edits
- G4 token drift
- G11 layout escapes
- G5 semantic/a11y failures
- G6 rasterized text
- G8 missing real text
- G1 visual drift when strict baseline exists
- G12 reusability failures

Do not create a baseline from the implemented preview screenshot. In figma mode,
baseline PNG and anchor manifests must come from `prepare-baseline.mjs --mode
figma`, which uses Figma REST exports. In spec mode, use a human-reviewed
handoff/reference baseline when available. `--update-baseline` is not a Codex
worker action and is blocked unless `UPDATE_BASELINE_ALLOWED=1` is explicitly
set for a reviewed baseline update.

If a gate produces a JSON result under `tests/quality/`, record it:

```bash
node scripts/progress-update.mjs record-gate-result --section <section> --result-file tests/quality/<section>.json
node scripts/progress-render.mjs
```

Commit only after the relevant gates pass.

## Publishing Log

Maintain `docs/publishing-log.md` during the run. Record route discovery, reuse
plan, gate results, and issues with root cause and follow-up. If a wrong port,
wrong app, missing node-id, or manual workaround occurs, log it as a harness
learning rather than only as a local fix.

Maintain `docs/defect.md` when a screenshot review finds an issue that gates did
not catch. Include root cause, fix plan, verification, and a harness follow-up.

Do not skip harness initialization. For an empty target directory run
`bootstrap.sh`; for an existing React project run
`node <publish-harness>/scripts/adopt-existing-project.mjs` before
implementation. A copied template without progress, scripts, and docs is
incomplete.

## Retry Policy

- First failure: fix the reported category directly.
- Second failure in the same category: change approach, not just values.
- Repeated G1/G11 failures: escalate to the stronger model policy in
  `docs/codex-model-policy.md` or split the section.
- When blocked, mark the section with `progress-update set-section` rather than
  editing `PROGRESS.md`.
