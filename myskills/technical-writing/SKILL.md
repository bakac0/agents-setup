---
name: technical-writing
description: Write and review accurate developer documentation, READMEs, runbooks, API references, RFCs, and technical explanations. Use when documentation is requested or changed as part of a development task. Apply the project's rules and keep agent-internal notes in .projectmem/.
---

# Technical writing

Write documentation that an engineer can use without guessing. Inspect the actual code, interfaces, examples, and repository conventions before making factual claims. Use this skill on demand; do not create extra documentation for a minor code change unless it is required.

## Choose the document's job

Choose the reader and one primary mode. The four Diataxis modes are:

- **Tutorial**: lead a newcomer through working steps with observable outcomes.
- **How-to**: give a competent reader the shortest correct procedure for a goal. State prerequisites and recovery steps when needed.
- **Reference**: describe exact APIs, commands, configuration, limits, errors, and types. Distinguish required and optional values.
- **Explanation**: describe how or why a bounded system works, including trade-offs and decisions.

Do not turn every brief task into a formal plan or require approval of an outline unless the user requests one or a material decision remains unresolved. Follow existing document structure over introducing a new framework.

## Verify before writing

1. Read the applicable repository `AGENTS.md` and one representative document if available.
2. Inspect source code, tests, CLI help, schemas, or actual tool output for every important technical claim. When you cannot verify something, label it as unverified rather than inventing it.
3. Prefer real commands and paths. Do not invent version numbers, API endpoints, examples, screenshots, successful test results, or performance figures.
4. Keep one authoritative location per fact. Link to established documentation rather than duplicating it.
5. If a documented behavior conflicts with code, describe the mismatch and escalate consequential decisions. Do not silently weaken a normative contract.

## Write for the reader

- Lead with the action or answer. Use direct commands for procedures, present tense, concrete names, and actual flags and file names.
- Make each step testable. State the expected outcome, a condition, or a failure recovery action when useful.
- Prefer short, specific sentences and one unambiguous name per concept. Avoid marketing language, empty assurances, vague attributions, and filler.
- Choose headings and examples that match the existing repository. Keep code blocks copyable and formatting faithful to the project's conventions; do not force tabs or unrelated style rules.
- Preserve exact identifiers, quotations, legal wording, attribution, and citations.
- A PR description or commit message is not a tutorial. Follow repository conventions and keep it short and factual; Git Manager owns actual commits.

## Editing and quality

- If the user requests an anti-slop or voice-editing pass, load `better-writing` as a separate, focused skill. It is optional for a routine technical change, not a requirement to invoke on every file.
- Check links or local references when practical, validate examples and snippets, and review the diff for irrelevant rewrites.
- Do not change implementation code just to make existing documentation appear true without explicit task scope.
- Prefer a focused update to an existing page over creating several near-duplicate pages.

## ProjectMem routing

- `docs/`, `README.md`, and user-facing pages are for product documentation.
- Internal plans, drafts, troubleshooting attempts, agent research, handoffs, and temporary diagram exports belong under `.projectmem/` according to the repository's `AGENTS.md`.
- Durable internal design decisions and documentation for agents can live in `.projectmem/knowledge/` or `.projectmem/work/<feature>/`; publish into `docs/` only when the material is ready for its human audience.
- When no project repository exists, use the user's requested output path; do not create `.projectmem/` in an unrelated directory.

Reference inspiration: Cursor pstack `technical-writing` (MIT, Lauren Tan, 2026). This version is intentionally shorter and tailored to OpenCode/Codex and ProjectMem.
