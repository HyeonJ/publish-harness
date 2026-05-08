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
  Full-section or full-card raster exports are not a substitute for React DOM.
  Product photos, decorative bitmap art, and complex non-text imagery are
  appropriate raster assets; visible text, buttons, cards, lists, and layout
  structure should be rendered as DOM/SVG/components.

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
- Use `data-anchor="<Page>/<id>"` for a single Figma anchor. When multiple
  duplicate section/background/frame anchors intentionally map to the same
  visible DOM box, use a whitespace-separated token list:
  `data-anchors="Home/section-4 Home/rectangle-170 Home/rectangle-170-2"`.
  Use `data-anchors` only on visible boxes whose browser bbox represents all of
  those Figma nodes. Do not mix text-label anchors and section/background
  anchors on the same element, and do not use hidden/dummy nodes.
- `data-anchor` and `data-anchors` are harness contract attributes, not debug
  residue. Keep them in publishing output unless a separate final-build strip
  step is explicitly configured.
- Do not lower G1 L1 diff by replacing a section with a Figma screenshot while
  hiding the real React content. The temporary page L1 budget may be 10% while
  the long-term target remains 5%; that relaxation is meant to allow honest DOM
  implementations, not to approve raster-backed sections. Set
  `G1_ENFORCE_L1_TARGET=1` to make the current target, 5%, the effective G1
  threshold when promoting from migration mode to final quality mode. The final
  verifier also rejects positive L1 `targetGap` values in that mode.
- If a section truly must be pixel-mirrored for a temporary review reason, make
  the debt explicit with `data-pixel-mirror="<Page>/<section-anchor>"` on the
  section root and add `data-pixel-mirror-reason="..."`. Prefer a shared
  `PixelMirrorSection` primitive with a namespaced prop such as
  `pixelMirrorReason`, and a `HiddenAnchorLayer` primitive instead of ad hoc
  `opacity: 0` anchor geometry. This is blocked by default in final G12; use
  `PUBLISH_HARNESS_ALLOW_PIXEL_MIRROR=1` only for a documented temporary review
  run, not for completion.
- Pixel-mirror opt-in is structural, not file-wide. Hidden anchors and
  full-section rasters are allowed only as descendants of the explicit
  `PixelMirrorSection` / `HiddenAnchorLayer` boundary. A pixel mirror in one
  section does not exempt unrelated sibling sections in the same file.
- Hidden anchor geometry and `FigmaAnchorOverlay` are not acceptable final
  anchor solutions. Do not put `opacity: 0`, `visibility: hidden`, or
  `display: none` directly on anchor elements in normal reusable sections.
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
npm.cmd run quality -- <section> <section-dir>
```

`measure-quality.sh` runs gates in this order for both Codex and Claude. On
Windows PowerShell, call it through `npm.cmd run quality -- ...` so the Node
launcher can find a working Bash instead of a broken WSL shim:

```text
G10 -> G4 -> G11 -> G12 -> G5 -> G6/G8 -> G7 -> G1
```

G1 visual regression is the final gate. It compares the finished preview
against the Figma/spec baseline after static, structural, semantic, content,
and Lighthouse checks have run.
L1 masks matched text-like anchors after L2/text diagnostics have measured
their boxes and typography, so residual pixel diff should focus on media,
backgrounds, decor, and layout rather than text antialiasing.

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

If `anchorsMatched: 0` or required coverage is low, generate a mapping report
before editing:

```bash
node scripts/report-anchor-mapping.mjs --manifest baselines/<section>/anchors-desktop.json --quality tests/quality/<section>.json
```

Required anchors are blocking. Optional anchors are diagnostics; never add
hidden dummy nodes just to satisfy optional coverage.

When G1 fails, read the mapping report in this order:

1. Required coverage. If `requiredMatched` is `0`, map required anchors first.
   If `requiredMatched < requiredTotal`, finish required anchor mapping before
   visual tuning. Optional missing anchors are diagnostics, not blockers.
2. Section stack/gap. Read `Section / Root Deltas` and `Section Gap Deltas`.
   Large `heightDelta` explains local section height drift; large `gapDelta`
   explains normal-flow spacing drift between adjacent sections. Treat later
   section y deltas as downstream symptoms until the source pair is identified.
3. Repeated height. Read `Repeated Height Drift` for sibling rows/sections that
   share the same height delta, for example three product rows that are all
   `+120px`.
   Also read `Repeated Slot / Card Sequence Drift` before tuning individual
   card anchors in repeated rows. If Figma shows a fixed slot sequence, such as
   five review cards, but the DOM resolves to a centered grid with different
   item count, order, or x gaps, match the repeated item count/order/slot
   spacing first. Do not move one card anchor or tune card text while the row
   model itself differs. If repeated slot anchors include duplicate decorative
   variants, such as `rectangle-12` and `rectangle-12-2` sharing the same Figma
   bbox and visible image slot, collapse them to one visual slot for count/gap
   judgment and map them with `data-anchors` on that visible item.
4. Anchor target mismatch. Read `Anchor Target Mismatches` for text/control
   anchors whose measured bbox is much wider than Figma, such as a small text
   label anchored to a full-width block element. Move anchors to visible inner
   text only; do not add hidden or dummy anchors.
5. Section/background anchor target mismatch. Read
   `Full BBox Anchor Groups` and `Section / Background Anchor Target Mismatch`
   before text tuning. If a rectangle, frame, background, or section-sized
   anchor has actual text attached, treat it as a likely wrong target unless
   the Figma node is text. Move the anchor to the visible section/background
   DOM box or document missing visual mapping; do not tune the text. Duplicate
   full-bbox anchors that represent the same visible box may share one DOM
   element via `data-anchors`.
6. Text content/anchor mismatch. After anchor target mismatch is fixed, the
   same text anchor may still appear in `Top Deltas`. Read
   `Text Content / Anchor Mismatch` before text metric tuning. If the anchor
   id/name or Figma text does not match the DOM text, verify the content source
   or anchor mapping before changing font size, line-height, width, or
   placement. If `expected` is missing and the anchor name is generic, such as
   `a paragraph or two`, `paragraph`, `heading`, `copy`, or `description`, do
   not move the anchor from name mismatch alone; inspect surrounding context or
   improve expected text extraction first. These should appear as
   `Low Confidence Text Mismatches` / `reviewOnly=true`; they may remain in
   `Top Deltas`, but they are not a reason to change app copy, move the anchor,
   or tune text metrics before stronger structural diagnostics. Anchor names
   without expected text are weak hints: punctuation, quote marks, truncation,
   or a partial token match should point you toward placement/card order before
   moving the anchor. If review-only text mismatches are the only text content
   items left, move on to residual section/root drift or L1 visual diff
   investigation instead of treating expected text extraction as an app-code
   fix.
   If the only difference is a likely spelling typo in the Figma layer name,
   such as a repeated or missing character, do not change product copy to match
   the layer name. If the anchor name is semantic rather than content, such as
   `logoname`, `wordmark`, `brand`, or `handle`, treat it as low-confidence
   until expected text or overlapping text anchors confirm a wrong target.
7. Text metric/placement drift. Read `Text Metric / Placement Drift` to
   separate wrapping width, line-height, and placement issues from wrapper
   targeting. Wrapper mismatch is an anchor placement problem; text metric
   drift is typography, wrapping, or local layout. When a text item carries
   `anchor-name-spelling-typo` or `text-anchor-name-typo-match`, keep the app
   copy as the real content and tune only size, wrapping, or placement if the
   bbox still differs. When the report shows `text-bbox-too-small`,
   `text-size-too-small`, `wrapping-width-too-narrow`, or
   `text-line-height-too-small`, fix the visible text box, font size, or
   line-height before continuing placement-only tuning. When width and height
   ratios are already close to 1 and the report shows
   `text-micro-placement-drift` or `text-placement-residual`, defer that item
   until larger wrapping, sizing, wrapper-target, and layout issues are handled.
   Read signed `deltaY` values, not only absolute `dy`: when several text
   anchors share the same signed y offset, inspect upstream normal flow,
   section height, or gap propagation before applying individual transforms.
   The `Shared Text Y Offset` report section marks this as
   `downstream-text-placement-drift` / `text-flow-offset-propagation`. Compare
   `sectionDeltaY` with the group's signed `deltaY`: a large
   `residualVsSection` means the section root is comparatively stable and a
   common inner wrapper/content group is the better first suspect; a small
   residual means the text is likely following upstream section/root/gap flow.
8. Wrapper target mismatch. Read `Wrapper Target Mismatches` when a text,
   logo, or semantic anchor measures as a much larger section/wrapper box with
   unrelated long text. Move the anchor to the visible target element or
   document an intentional wrapper mapping; do not tune logo scale or text
   metrics against the wrapper bbox.
9. Duplicate text bbox groups. Read `Duplicate Text BBox Groups` when two or
   more text-ish anchors share the same Figma bbox. If they represent the same
   visible text layer or semantic duplicate, put all ids on that visible text
   element with `data-anchors`; do not add hidden/dummy anchors. If a wrapper
   target mismatch belongs to one of these groups, prefer the group’s
   `data-anchors` suggestion over per-anchor visual tuning.
10. Logo/brand scale drift. Read `Logo / Brand Scale Drift` before treating a
   logo or wordmark top delta as text content drift. Verify the anchor is on
   the intended visible logo/wordmark. If it is, tune the fit box, optical
   scale, or per-logo sizing metadata; do not infer a content mismatch unless
   expected text contradicts the rendered text.
11. Internal layout drift. Read `Internal Section Drift Groups` for sections
   where anchor target sizes are reasonable but section-relative placement is
   far from Figma. This often means a semantic grid does not match a Figma
   freeform/staggered layout.
   If `Layout Model Mismatches` reports `rewrite-required`, stop small
   margin/padding tuning for that section and switch to a section rewrite or
   explicit human decision. A semantic deviation waiver cannot be used for
   completion unless a person approves it and the affected section/anchors,
   rationale, and non-visual gate evidence are documented.
   If it reports `rewrite-effective-residual-offset`, the section's internal
   placement has likely converged and the remaining deltas share a common
   root-relative offset. Inspect upstream section stack/gap/root positioning
   before rewriting the same section again. Read `Section Offset Propagation`
   and `Shared Residual Offset Sources`: compare the previous section's
   `fromYDelta + fromHeightDelta + gapDelta` with the target section's shared
   offset. If they match, fix the source section height/root or the source pair
   gap before touching the target section again.
   If `Non-actionable Root Residuals` reports the target section with
   `residual=0` and `gapDelta=0` or near zero, do not move that target section.
   The offset is being propagated through an already-correct gap; inspect the
   upstream source or move to L1-dominant visual diff investigation.
12. Media/text metrics. Check media-size and typography categories after the
   structural causes above are understood.
13. L1 residual. Only tune residual pixels after required anchors, stack/gap,
   repeated height, target mismatch, and internal layout drift are addressed or
   explicitly documented. When `actionableRemaining=false` and L1 still fails,
   read `Section L1 Diff Hotspots` before editing. Rank the largest section
   hotspots by diff pixels/percent and classify the cause as asset/crop,
   missing decor, color/token/background, stacking, or resize artifact. If a
   hotspot reports `solid-background-color-drift`, fix the visible background
   or token source rather than moving anchors or section roots. Whole-section
   average color can be diluted by large product images, so compare
   `bgCurrent`, `bgBaseline`, and `bgDistance` before dismissing a background
   color issue. If it reports `image-content-mismatch-candidate` or
   `asset-order-mismatch-candidate`, compare the actual image assets, order,
   crop, and object-position for that section before changing layout. If the
   same hotspot reports `overlay-text-content-drift-candidate` or
   `overlay-text-order-mismatch-candidate`, inspect visible overlay copy,
   order, stacking, and overlap before treating the section as an image or
   background-only problem. Use `actionableTextSignals` as the primary evidence
   for overlay work. `reviewOnlyTextSignals` and generic `textSignals` are
   hints, not proof: expected-text-missing optional duplicates, semantic layer
   names, and generic layer names should stay review-only until surrounding
   context confirms a wrong target. A single text metric signal in a section
   that is otherwise an image/content/order hotspot is not enough to treat the
   section as an overlay text problem; the report may mark that as
   `text-signal-present-nonblocking`. When the hotspot prints `imageSignals`,
   inspect those anchors' asset files, array order, `object-fit`, crop, and
   `object-position` before changing section layout. If an image signal's
   width/height ratios are close to `1` but x/y deltas are large, suspect
   asset order or slot placement first. If width/height ratios are far from
   `1`, suspect crop, fit mode, object position, or media sizing first.

Do not create a baseline from the implemented preview screenshot. In figma mode,
baseline PNG and anchor manifests must come from `prepare-baseline.mjs --mode
figma`, which uses Figma REST exports. Figma REST 401/403 is an auth/access
blocker: stop and report the HTTP status instead of using a preview screenshot
as fallback. Figma baseline PNGs must have a sibling `.provenance.json` from
`figma-rest-image.sh`, and anchor manifests must come from the Figma node tree.
Root-only hand-authored manifests are invalid. In spec mode, use a
human-reviewed handoff/reference baseline when available. `--update-baseline`
is not a Codex worker action and is blocked unless `UPDATE_BASELINE_ALLOWED=1`
is explicitly set for a reviewed baseline update.

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
