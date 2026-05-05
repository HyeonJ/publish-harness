# Codex model policy

Use stronger models for judgment and recovery, not for every repetitive
publishing unit.

## Defaults

| Role | Default | Reasoning | Use |
|---|---|---|---|
| Orchestrator | GPT-5.5 | medium | Phase 2 decomposition, ordering, escalation decisions |
| Section worker | GPT-5.4 | medium | Normal sections and components |
| Explorer | GPT-5.4-Mini | medium | File search, token lookup, gate log summaries |
| Reviewer | GPT-5.4 | medium | Retry review after a failed worker attempt |
| Escalation worker | GPT-5.5 | high | Repeated failures, ambiguous visual reasoning, integration conflicts |

## Escalation Triggers

Escalate from the default section worker when any of these happens:

- Same section fails twice.
- G1 visual drift repeats after a targeted fix.
- G11 layout escape repeats after a targeted fix.
- Figma/spec interpretation is ambiguous.
- The section has scattered layout, complex transforms, or mixed asset types.
- Page integration requires reconciling multiple completed sections.

## Cost Rule

Do not start every unit on GPT-5.5. Most publishing work is structured,
gate-driven implementation. Use GPT-5.5 where the work is mainly judgment,
decomposition, or failure recovery.
