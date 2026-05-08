# AGENTS.md - Codex guide for publish-harness

This repository is a section-unit publishing harness. Codex should use the same
source of truth and gates as Claude, but without relying on Claude-specific
skills or subagent frontmatter.

## Core Rules

0. Completion contract: do not report "completed", "done", "finished",
   "implemented", "published", or any Korean completion claim listed in
   `.publish-harness/INCOMPLETE.json`, and do not create a completion commit,
   unless `node scripts/assert-completion-contract.mjs` exits 0. Build, lint,
   typecheck, route HTTP 200, and partial `measure-quality.sh` output are not
   completion. If `.publish-harness/INCOMPLETE.json` exists or the contract
   fails, the final response must begin with:
   `BLOCKED/INCOMPLETE: publish-harness completion contract failed.`
   Blocked/incomplete is an intermediate failure state, not a final answer.
   Do not end the turn in that state unless an external blocker prevents all
   further local fixes or the user explicitly asks you to stop. Otherwise keep
   diagnosing, fixing, rerunning gates, and updating logs until the completion
   contract passes.
1. Work unit is a section or component. One unit should map to one focused
   commit after gates pass.
2. Do not edit `PROGRESS.md` directly. Use `node scripts/progress-update.mjs`
   and then render with `node scripts/progress-render.mjs` when needed.
3. Before starting work, run or inspect:
   - `node scripts/why.mjs --json`
   - `node scripts/status.mjs --json` when more context is needed
   - `node scripts/next.mjs --json` to identify the next unit
4. Design tokens are the source of truth. Use `src/styles/tokens.css` and avoid
   raw hex colors except the allowlisted neutrals enforced by G4.
5. On Windows PowerShell, use `npm.cmd` and `npx.cmd` explicitly. For background
   servers use `Start-Process -FilePath "npm.cmd" ...`; do not launch
   `Start-Process npm` or `Start-Process npx`.
6. Do not modify write-protected source-of-truth files during section work:
   `tokens.css`, `fonts.css`, `tailwind.config.*`, `docs/components-spec.md`,
   and any path listed in `scripts/write-protected-paths.json`.
7. Do not commit until the relevant gates pass through
   `npm.cmd run quality -- <section> <section-dir>` on Windows PowerShell or
   `npm run quality -- <section> <section-dir>` elsewhere.
   Gate order is shared with Claude:
   `G10 -> G4 -> G11 -> G12 -> G5 -> G6/G8 -> G7 -> G1`.
   G1 visual regression runs last against the finished preview.
   Before reporting completion, run
   `node scripts/verify-publishing-complete.mjs`; missing gate results are
   failures, not optional omissions. Every non-skipped page/section in
   `progress.json` must be `done` with its own `tests/quality/<section>.json`.
   Route-level build/lint/smoke checks are not a publishing completion
   substitute. `measure-quality.sh` must be run with the discovered
   route/page section names from `progress.json`; do not replace them with a
   synthetic aggregate such as `site-pages`. G7 Lighthouse is required by
   default and missing preview routes or dependencies are gate failures. Use
   final verifier `--allow-g7-skip` only for an explicit local exception after
   a failing quality run has been documented.
8. In figma mode, use Figma REST scripts for screenshots/assets. In spec mode,
   do not call Figma; use `docs/components-spec.md`, reference HTML, and tokens.
9. If screenshot review finds a visual defect that gates missed, maintain
   `docs/defect.md` with root cause, fix plan, verification, and harness
   follow-up.
10. Visible Figma decorative assets must remain visible. Put them behind
    content; do not hide, delete, bury, or move them offscreen to satisfy
    z-index rules.
11. In figma mode, required anchors from `baselines/<Page>/anchors-*.json`
    must exist in the DOM. Fix `anchorsMatched: 0` before touching visual
    spacing.
12. Treat overlapping/negative-y Figma decor as a root/page decor layer with
    explicit stacking order. Keep nav/main/footer above it.
13. Repeated logo/brand cards must normalize optical logo size. Use a fit box
    with `object-fit: contain` plus per-item bbox/size metadata or `--logo-*`
    variables; do not rely only on `logoClassName` or each asset's natural
    `width: 100%; height: auto`.

## Codex Workflow

For each publishing request:

1. Empty-directory Figma React publishing has a fixed default strategy:
   reusable React structure, Figma asset export, tokenized CSS, per-route
   baselines/anchors, per-route quality gates, and final verifier. Do not ask
   the user to approve this implementation strategy. Ask only when credentials,
   required assets, or an explicitly requested output style make the default
   impossible.
2. Determine state with `why/status/next`.
3. If bootstrap is required, run `scripts/bootstrap.sh` with the requested mode
   and `--agent codex` or `--agent both`.
4. If decomposition is required in figma mode, first run
   `node scripts/discover-figma-pages.mjs --file-key <fileKey> --out docs/figma-pages.md --apply`.
   Treat top-level route SECTIONs such as `Home`, `/about`, and `/find-us` as
   separate pages, not as sections of one page.
5. Register remaining sections/components through `progress-update`.
6. For implementation, follow `docs/codex-section-worker.md`.
7. For React targets, follow `docs/reusable-react-publishing.md`: routes in
   `src/pages`, shared layout in `src/components/layout`, reusable UI/domain
   components before repeated sections, a small routing-only `App.tsx`, and CSS
   split by ownership boundary (`src/styles/components/*`,
   `src/styles/pages/*`).
8. Maintain `docs/publishing-log.md` from the template, including route
   discovery, reuse plan, root causes, and follow-ups.
9. New publishing projects must start with `bootstrap.sh` in an empty
   directory. Existing projects must be adopted with
   `node <publish-harness>/scripts/adopt-existing-project.mjs`; direct template
   copy is not a completed harness workflow.
10. Record gate results with `progress-update record-gate-result` when a result
   JSON exists, then render `PROGRESS.md`.
11. Commit only the completed unit and its isolated assets/docs.

## Model Policy

Use `docs/codex-model-policy.md` for delegation choices. The default worker
model should be cost-conscious; reserve the strongest model for decomposition,
ambiguous visual reasoning, and repeated gate failures.

## Claude Compatibility

`.claude/` is Claude-specific. Do not edit it while doing normal Codex section
work unless the task is explicitly about changing Claude support. Shared logic
belongs in scripts, templates, docs, and gates.
