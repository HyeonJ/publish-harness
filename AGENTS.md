# AGENTS.md - Codex guide for publish-harness

This repository is a section-unit publishing harness. Codex should use the same
source of truth and gates as Claude, but without relying on Claude-specific
skills or subagent frontmatter.

## Core Rules

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
5. Do not modify write-protected source-of-truth files during section work:
   `tokens.css`, `fonts.css`, `tailwind.config.*`, `docs/components-spec.md`,
   and any path listed in `scripts/write-protected-paths.json`.
6. Do not commit until the relevant gates pass through
   `bash scripts/measure-quality.sh <section> <section-dir>`.
7. In figma mode, use Figma REST scripts for screenshots/assets. In spec mode,
   do not call Figma; use `docs/components-spec.md`, reference HTML, and tokens.

## Codex Workflow

For each publishing request:

1. Determine state with `why/status/next`.
2. If bootstrap is required, run `scripts/bootstrap.sh` with the requested mode
   and `--agent codex` or `--agent both`.
3. If decomposition is required in figma mode, first run
   `node scripts/discover-figma-pages.mjs --file-key <fileKey> --out docs/figma-pages.md --apply`.
   Treat top-level route SECTIONs such as `Home`, `/about`, and `/find-us` as
   separate pages, not as sections of one page.
4. Register remaining sections/components through `progress-update`.
5. For implementation, follow `docs/codex-section-worker.md`.
6. For React targets, follow `docs/reusable-react-publishing.md`: routes in
   `src/pages`, shared layout in `src/components/layout`, reusable UI/domain
   components before repeated sections, a small routing-only `App.tsx`, and CSS
   split by ownership boundary (`src/styles/components/*`,
   `src/styles/pages/*`).
7. Maintain `docs/publishing-log.md` from the template, including route
   discovery, reuse plan, root causes, and follow-ups.
8. New publishing projects must start with `bootstrap.sh` in an empty
   directory. Existing projects must be adopted with
   `node <publish-harness>/scripts/adopt-existing-project.mjs`; direct template
   copy is not a completed harness workflow.
9. Record gate results with `progress-update record-gate-result` when a result
   JSON exists, then render `PROGRESS.md`.
10. Commit only the completed unit and its isolated assets/docs.

## Model Policy

Use `docs/codex-model-policy.md` for delegation choices. The default worker
model should be cost-conscious; reserve the strongest model for decomposition,
ambiguous visual reasoning, and repeated gate failures.

## Claude Compatibility

`.claude/` is Claude-specific. Do not edit it while doing normal Codex section
work unless the task is explicitly about changing Claude support. Shared logic
belongs in scripts, templates, docs, and gates.
