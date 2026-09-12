# Global AI Engineering Workflow

These rules apply to all projects unless a project-level AGENTS.md
provides more specific instructions.

## Core workflow

Use this lifecycle for substantial development work:

DISCOVER
→ DESIGN
→ SIMPLIFY
→ SPECIFY
→ PLAN
→ IMPLEMENT
→ REVIEW
→ VERIFY

Do not jump directly from an ambiguous request to implementation.


## Discovery

For new, ambiguous, or product-level work prefer:

- `grill-with-docs`
- `domain-modeling`

Clarify:

- purpose
- users
- constraints
- success criteria
- domain terminology
- important edge cases

If project-specific CONTEXT.md exists, use it as the domain vocabulary
source of truth.


## Architecture

Use:

- `codebase-design` for module/interface/boundary design
- Context7 when current third-party API/framework behaviour matters
- `prototype` when an important technical assumption needs evidence

Before accepting substantial architecture, use:

- `chisel`

Specifically look for unnecessary:

- services
- managers
- adapters
- layers
- interfaces
- queues
- databases
- abstractions
- indirection

Prefer the simplest architecture that satisfies known requirements.


## Specification

Do not create documentation ceremony for small tasks.

If work is expected to span multiple sessions, use:

- `to-spec`
- `to-tickets`

Use `wayfinder` only for genuinely large long-horizon work.


## Planning and implementation

Superpowers owns execution discipline.

Prefer:

- explicit implementation plans for non-trivial work
- isolated git worktrees where useful
- TDD
- small coherent changes
- parallel subagents only for independent work
- systematic debugging instead of speculative fixes

Do not silently change agreed architecture during implementation.

If implementation exposes an architectural contradiction,
escalate it before continuing.


## Agent roles

Use specialized agents where appropriate:

- Architect
- Researcher
- Implementer
- Reviewer
- Verifier

Do not let the same agent both implement a substantial change
and act as its only reviewer.


## Review

Review separately:

1. requirements/spec compliance
2. architecture compliance
3. correctness
4. regression risk
5. security
6. missing tests
7. unnecessary complexity
8. maintainability

Reviewer should report findings rather than fixing its own findings.


## Verification

Never claim completion without fresh verification evidence.

Run applicable:

- unit tests
- integration tests
- typecheck
- lint
- build
- acceptance tests

For web applications, verify important user flows with Playwright CLI.

A successful command from earlier in the session is not fresh evidence
after subsequent code changes.


## External documentation

When exact behaviour of a third-party framework/library/API matters,
consult current documentation via Context7 before coding.

Do not use external documentation unnecessarily for ordinary business logic.


## Communication

Implementation, research, and verification reports should be concise.

Caveman-style output is appropriate for:

- implementation summaries
- researcher summaries
- test reports
- subagent reports

Do not aggressively compress:

- requirements interviews
- architectural trade-off discussions
- ADRs
- security decisions


## Safety

Architect and Reviewer should be read-only whenever the harness permits it.

Do not:

- push
- merge
- publish
- release
- delete important data
- perform irreversible operations

without explicit user approval.


## Project overrides

Project-level AGENTS.md files may define:

- build/test commands
- architecture constraints
- framework conventions
- repository-specific workflow
- project-specific verification requirements

Project rules take precedence over these global defaults.
