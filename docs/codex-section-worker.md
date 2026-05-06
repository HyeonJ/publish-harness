# Codex section worker guide

This guide is the Codex equivalent of Claude's `section-worker`. It is not a
separate runtime agent; it is the procedure Codex follows for one section or
component.

## Default Strategy

For empty-directory Figma React publishing requests, do not ask the user to
choose or approve an implementation strategy. The harness-required default is
reusable React structure, Figma asset export, tokenized CSS, per-route
baselines/anchors, per-route quality gates, and final verifier. Ask only when
credentials, required assets, or an explicitly requested output style make this
default impossible.

## Completion Contract

Do not report "completed", "done", "finished", "implemented", "published", or
any Korean completion claim listed in `.publish-harness/INCOMPLETE.json` unless
this command exits 0:

```bash
node scripts/assert-completion-contract.mjs
```

Build, lint, typecheck, route HTTP 200, and partial `measure-quality.sh` output
are not completion. If the command fails or `.publish-harness/INCOMPLETE.json`
exists, the final response must begin with:

```text
BLOCKED/INCOMPLETE: publish-harness completion contract failed.
```

Blocked/incomplete is an intermediate failure state, not a final answer. Do not
end the turn in that state unless an external blocker prevents all further
local fixes or the user explicitly asks you to stop. Otherwise keep diagnosing,
fixing, rerunning gates, and updating logs until the completion contract passes.
Include the verifier failure summary while continuing the fix loop instead of
writing a completion summary.

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
- In figma mode, read `baselines/<Page>/anchors-desktop.json` before marking a
  page done. Every `required: true` anchor must have a matching DOM
  `data-anchor="<Page>/<id>"`. Shared layout components should accept `pageId`
  so `SiteLayout`, `Nav`, and `Footer` can render page-specific anchors such as
  `Home/root`, `Home/nav`, and `Home/footer`.
- Split CSS by ownership boundary. Keep `src/styles/index.css` as imports only,
  put reusable component/layout rules under `src/styles/components`, and put
  route-specific rules under `src/styles/pages`.
- Remove scaffold placeholders before finishing. `src/routes/HomePlaceholder.tsx`
  must not remain in published React output.
- Keep decorative images behind content. Give decorative layers
  `pointer-events: none`, avoid positive z-index above content, and verify that
  Figma foreground/background order matches the browser screenshot.
  Do not delete, hide, make transparent, bury behind the page background, or
  translate offscreen decorative assets that are visible in Figma.
- If a Figma image bbox overlaps the nav/main boundary, starts above `main`, or
  has negative `y`, treat it as page decor rather than normal document flow.
  Use a root/page decor layer with `position: absolute`, `z-index: 0`, and
  `pointer-events: none`; put nav/main/footer/content on explicit higher
  stacking layers.
- For nav, tabs, buttons, and similar controls, keep separate anchors for the
  outer control bbox and the inner text label when the manifest contains both.
  Do not put a control-sized anchor on the label or a label-sized anchor on the
  control.
- Footer wordmarks must be real full-size wordmark elements. Put the wordmark
  anchor on the large visual text/mark, not on a small internal span.
- For repeated case-study/exhibit image stacks, follow manifest bbox order and
  bbox height/ratio. Do not rely on asset array order or `height: auto` when it
  creates cumulative anchor drift.
- Normalize reusable logo/icon cards. If assets vary in viewBox or whitespace,
  add bbox/size metadata such as `logoScale`, `logoFit`, `logoWidth`,
  `logoHeight`, `logoBBox`, or `--logo-*` CSS variables.
  `logoClassName` alone is not normalization.
  The thumbnail/card frame can be uniform, but the visible mark should be sized
  from the Figma bbox or an optical-size token. Do not let every logo use
  `width: 100%; height: auto` from its natural asset ratio.
  Logo media should sit inside an explicit fit box with `object-fit: contain`
  and per-item overrides when the Figma marks have intentionally different
  optical sizes.
- Preserve Figma hug-content behavior for pills, chips, tags, badges, and small
  labels. Use `inline-flex`, `width: fit-content`, `white-space: nowrap`, and
  start self-alignment; do not let these controls stretch across a grid column
  unless the Figma node is explicitly full width.
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

`measure-quality.sh` runs gates in this order for both Codex and Claude:

```text
G10 -> G4 -> G11 -> G12 -> G5 -> G6/G8 -> G7 -> G1
```

G1 visual regression is the final gate. It compares the finished preview
against the Figma/spec baseline after static, structural, semantic, content,
and Lighthouse checks have run.

Fail on:

- G10 write-protected path edits
- G4 token drift
- G11 layout escapes
- G12 reusability failures
- G5 semantic/a11y failures
- G6 rasterized text
- G8 missing real text
- G7 Lighthouse failures when the environment is available
- G1 visual drift when strict baseline exists

When G1 fails, fix categories in this order:

1. required anchor missing or `anchorsMatched: 0`
2. decorative image in normal flow, then decorative z-index/layer order
3. wrong anchor target, especially nav control/text and footer wordmark
4. repeated image stack height drift and section height explosion
5. typography/text metric mismatch
6. remaining L1 pixel diff

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

Before reporting completion, run the final verifier:

```bash
node scripts/verify-publishing-complete.mjs
```

The verifier treats missing `tests/quality/*.json`, missing G1/G12 results,
missing Figma baselines/anchors, scaffold placeholders, and incomplete
`docs/defect.md` entries as failures.
It also requires every non-skipped `progress.json` page and section to be
`done`. Building multiple routes in one pass does not satisfy the harness until
each discovered page/section has its own `measure-quality.sh` result and
recorded gate result. A `verify:publishing` failure is workflow incomplete; do
not report it as "only a harness issue" or "not a code issue".
G7 Lighthouse is required for final verification by default. New projects
include `lighthouse` and `@lhci/cli`; install dependencies before running
quality gates. Missing Lighthouse dependencies, missing dev server, or missing
`/__preview/<section>` route are quality-gate failures.
Use final verifier `--allow-g7-skip` only as an explicit local exception after
the failed quality result is recorded and documented.

Run quality gates with the discovered route/page section names from
`progress.json`. Do not invent a synthetic aggregate such as `site-pages` to
cover multiple Figma routes in one measurement. Multi-page Figma projects need
one quality JSON per discovered route/page.

Commit only after the relevant gates pass.

## Publishing Log

Maintain `docs/publishing-log.md` during the run. Record route discovery, reuse
plan, gate results, and issues with root cause and follow-up. If a wrong port,
wrong app, missing node-id, or manual workaround occurs, log it as a harness
learning rather than only as a local fix.

Maintain `docs/defect.md` when a screenshot review finds an issue that gates did
not catch. Include root cause, fix plan, verification, and a harness follow-up.

When independent asset exports do not match the Figma baseline pixels, prefer
baseline-consistent crops over manual recreation:

```bash
node scripts/export-baseline-assets.mjs --section <section> --ids <anchor-id> --out-dir src/assets/<section>
```

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

