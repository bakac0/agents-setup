---
name: projectmem-migrate
description: Inspect and migrate existing agent work and references into a project's .projectmem workspace when requested.
---

# Migrate agent work to ProjectMem

Identify the project root from the user's workspace and instructions; Git is optional. Read project instructions and inventory existing `.projectmem/`, `.scratch/`, `.superpowers/`, `docs/agents/`, domain files, research and plans. Inspect contents and references before proposing moves. Product documentation and Playwright output stay in their existing appropriate locations.

Map agent-owned specs, plans and tickets to `.projectmem/work/<feature>/`, domain glossary and ADRs to `.projectmem/knowledge/`, research to `.projectmem/research/`, handoffs to `.projectmem/handoffs/`, and agent configuration to `.projectmem/config/`. Preserve feature structure and existing content. Never migrate ProjectMem's native event log or generated summaries by editing them directly.

Present a preview listing source, destination, references needing updates, conflicts and files excluded. Resolve ambiguous ownership and destination collisions with the user. Execute the reviewed migration only when the request authorizes it; a preview-only request makes no changes. Do not overwrite or delete conflicting files. Update affected links and instructions, verify moved content and references, and report remaining conflicts and changes. Do not relocate browser profiles or secrets.
