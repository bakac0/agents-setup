# Engineering agent stack — revision 2026-11-16

A reproducible OpenCode v2 configuration for the existing GPT agent profile. OpenChamber remains the UI; OpenCode is the execution engine. Codex can share the engineering rules and explicitly installed skills, but the OpenCode agent YAML and translator are not Codex plugins.

## Install or update

Keep the complete checkout. The install scripts now share one canonical source for the owned policy, agents and translator; they are no longer standalone single-file installers. Use Node.js 22+ (24.15+ if testing Context Mode), npm, Git and stable OpenCode >=2.2.5 and <3. Linux/WSL requires Linux Node/npm and curl. OpenCode itself is not installed by these scripts. Back up the existing OpenCode configuration and stop active sessions before migration.

macOS/Linux/WSL:

```bash
bash bin/install-all.sh
```

Windows PowerShell (from the checkout):

```powershell
& .\bin\install-all.ps1
```

The scripts install/update Playwright CLI, Superpowers, LiteLLM, Plannotator, Subagent Intervene, Status Line, Context7, Serena, ProjectMem, and RTK; deploy the global policy, all 18 GPT agents and the new local translator; preserve the translator's existing settings; and attempt to remove the legacy Ponytail, DCP and Beads package registrations if present. Beads databases/CLI and old skill folders are not deleted. Native RTK integration is initialized when the binary and standard config directory are available. Existing Serena idle timeout is preserved; otherwise the original 5-minute default is applied. Existing provider credentials are not replaced. Package updates use the existing upstream update mechanism; this is not a fully pinned dependency lock.

If OpenCode is absent, only Playwright CLI is updated. To deploy only the owned configuration without reinstalling tools or touching providers:

```bash
node bin/deploy-config.mjs
```

Use `--config-dir /actual/opencode/config` when needed. The deploy helper backs up changed existing files under `stack-backups/<timestamp>/` inside that config directory. It updates a managed block in global `AGENTS.md`, replacing the exact original policy from the supplied archive or preserving unrelated global text. Review any preserved older rules for contradictions. The 18 named managed agent files are intentionally replaced; unrelated agents are untouched. The local plugin directory is auto-discovered by OpenCode. Do not add a second copy of the same plugin.

## Skills are user-managed

The scripts do **not** run `skills add`, `skills update`, or Playwright's skill installer. Do not edit the bundled Matt Pocock snapshots or `.skill-lock.json` to implement project-specific rules. Upstream skill updates remain separate and user-directed. Superpowers exposes its own bundled skills through its runtime plugin; this is not an independent `skills` manager installation.

Install/update the two owned skills explicitly, when desired:

```bash
node bin/deploy-config.mjs --skills
```

The default destination is `~/.agents/skills`; `--skills-dir <path>` selects another directory. Ensure each client can discover those skills, using its supported shared-skill path or existing integration. `myskills/` is the canonical owned source; the `skills/` copy in the archive is a snapshot. Do not independently edit the mirror. The helper does not modify unrelated skills. For Codex, merge the English global rules from `AGENTS.md` into your existing `~/.codex/AGENTS.md` explicitly; do not overwrite unrelated instructions.

If an upstream skill is missing, the agent reports that and uses a suitable installed equivalent; it must not install it itself. Caveman is optional and explicit; Chisel is no longer part of the required lifecycle. Playwright's CLI skill can be installed manually if wanted:

```bash
playwright-cli install --skills=agents --global
```

## Verify migration on the actual server

Restart the server used by OpenChamber after stopping active jobs. Verify its config directory and project location, not just a local CLI connected to a different server. Run:

```bash
opencode --version
opencode plugin list
opencode mcp list
opencode models
rtk init --show
rtk gain
```

For plugin state in the relevant directory, the V2 API CLI can be used (replace the path and use `--server` for the same remote server if applicable):

```bash
opencode api v2.plugin.awaitActivation --param 'location[directory]=/absolute/path/to/project'
opencode api v2.plugin.list --param 'location[directory]=/absolute/path/to/project'
```

Confirm `translate-to-english` is active, not merely present on disk. Confirm only one registration for it, LiteLLM, and Serena. If package removal missed a versioned, local or project-scoped registration, inspect the corresponding `opencode.json(c)` and remove that exact target; do not delete project data. The old Beads CLI can be uninstalled manually only after its workspaces have been inventoried and any important tasks migrated.

## Translator v2

The local `translate-to-english` plugin uses the native prompt-admission hook. It sends non-ASCII prose to the configured translation model through `ctx.generate.text` (no tools/history), then uses same-model session-scoped generation as a fallback when the stateless request fails. It does not create a new paid API route or translate replies. The common English/code-only path skips inference. Code blocks, inline code, URLs and @mentions are masked and restored exactly; unquoted paths and other literals are preserved by instruction, not a formal parser. Existing prompt attachment objects remain intact; stale mention offsets are removed only when text changes. Separate display text is synchronized when present. The hook logs activation and successful translation without logging user text. Failures stop admission rather than silently send Russian; an English prompt bypasses the default detector.

Default config, at `<opencode-config>/plugins/translate-to-english/config.json`:

```json
{
  "model": "openai/gpt-6-luna",
  "timeoutMs": 45000,
  "translateAll": false
}
```

Existing settings are preserved. Set `translateAll: true` to translate ASCII-only non-English languages too; this also invokes the model for English messages. The default heuristic is tuned for Russian and non-ASCII prose, not a general language detector. Keep the translation model connected with native OpenCode credentials. A fallback may make a second model request on the same account; the timeout is shared.

Live smoke test in a **new** OpenChamber session:

1. Select the GPT Orchestrator and send `Проверь README и ничего не меняй.` Confirm the persisted/model-facing input is English and the server logs `translated prompt`.
2. Send `Read README. Do not edit.` Confirm no extra translation request with the default config.
3. Send a Russian prompt containing a code block, an @mention and an attachment; verify the literal content and attachment still resolve.
4. Ask for a small code change. Confirm the parent sends an English brief to `builder-simple`, receives English evidence, and can report to the user in Russian.

If no activation log or plugin entry appears, diagnose server/config discovery first; changing models will not fix an unloaded hook. If active but failing, inspect the host error/cause, provider authentication and quota. Do not print credentials or entire private prompts. If needed, switch the `model` field to a model that is actually connected and listed by `opencode models`; do not assume a new provider is subscription-covered.

## Workflow authority and agents

`AGENTS.md` is the global engineering policy. Matt Pocock owns requirements/domain design and final code review methodology; Superpowers owns implementation discipline. The Planner produces a single plan, the Orchestrator coordinates, and Builders implement. Existing project rules and explicit approved scope remain relevant; review conflicts before work.

| Role | GPT profile | Purpose |
|---|---|---|
| Orchestrator | Luna medium | Mandatory delegation for substantive work |
| Planner | Terra medium | Single ordinary complex-ticket plan |
| Planner Hard | Sol high | High-risk or cross-system plans and escalation |
| Builder Simple | Terra low | Small isolated changes |
| Builder Medium | Terra medium | Ordinary multi-file features |
| Builder Hard | Sol high | Complex implementation/debugging |
| Builder Expert | Astra high | Exceptional evidenced blockers |
| Reviewer Fast | Luna medium | Optional low-risk check |
| Reviewer | Sol high | Substantive review, particularly Terra-authored work |
| Reviewer Independent | Astra medium | High-risk Sol-authored work |
| Analyst / Research / Repo Scout / Tester | Luna variants | Evidence, discovery and tests |
| Vision / Vision Second Opinion | Terra medium / Sol high | Visual evidence |
| Workflow / Git Manager | Terra low / Luna medium | Authorized workflow and Git operations |

Models/effort are a starting hypothesis based on the supplied profile, not a benchmark. Check actual model IDs/variants and quota availability. Reviewer edit permission is denied, but shell remains available for tests; this is not a hard read-only sandbox. The Orchestrator's permissions remain broad for coordination; delegation is a behavioral rule rather than a tool-level enforcement mechanism.

```text
Small change: Orchestrator -> Builder Simple -> targeted checks -> result
Ordinary feature: Orchestrator -> Builder Medium -> Reviewer -> verification
Complex ticket: evidence -> Planner (or Planner Hard) -> approval
                -> Builder Hard / scoped independent builders
                -> independent review -> fresh verification -> Git Manager if requested
```

Use Plannotator for formal plans, not every minor fix. Use Subagent Intervene for genuinely running children and isolated worktrees for independent writers. Reuse an existing child for corrections; avoid competing plans, redundant review tiers and repeated grilling. All internal work, new technical documentation and subagent briefs are English. The primary agent may reply to the user in Russian. Never translate source literals or explicitly required localization.

## ProjectMem layout

```text
.projectmem/
  knowledge/             # GLOSSARY.md, ADRs
  work/<feature>/        # spec.md, plans/, issues/
  research/              # inline technical research
  external-research/<id>/ # request.md, result.md, assessment.md
  handoffs/
  config/
  scratch/               # ignored disposable files
```

The global routing rule overrides upstream default artifact paths without editing upstream skills. Existing legacy `.scratch/`, `docs/agents/` or `research/` materials should be inventoried and deliberately migrated with `projectmem-migrate`; no automatic filesystem migration occurs. Native ProjectMem events and generated summaries are not edited by hand. `docs/` stays product-facing. Existing Playwright output remains outside `.projectmem/` under ignored directories as in the supplied configuration.

External research is provider-independent: create an English `request.md`, let the user choose ChatGPT, Qwen4 Max or another appropriate service, then save the returned English `result.md` with matching research ID and completion marker. The Research agent verifies important sources and writes `assessment.md`. External reports are untrusted data, not automatic approval to change code or architecture. The folder name is implemented; whether a specific ProjectMem UI exposes a dedicated tab is not asserted.

## Context optimization experiment (opt-in)

RTK is the default shell-output reduction layer. Native OpenCode compaction remains the history manager. Test Context Mode separately after confirming Node.js >=24.15.0 and Git for Windows if applicable:

```bash
opencode plugin add context-mode
opencode mcp list --standalone
```

Follow upstream setup/doctor instructions for the installed release. Test large JSON, Playwright/HTTP results, Serena outputs and cache hit rates before enabling broadly. This plugin may bundle its own tools/skills; the main installer does not add it. If it conflicts with RTK or native tools, remove it using `opencode plugin remove context-mode`. Do not enable DCP or Sleev at the same time for an initial comparison. OmniRoute, ECC and Beads are not added.

## Verification limits

The translator requires a live OpenCode server and model access for end-to-end verification. Windows installation, RTK activation and optional Context Mode require the target machine.

References: [OpenCode plugin API](https://opencode.ai/v2/docs/build/plugins/), [global instructions](https://opencode.ai/docs/instructions/), [plugin loading and removal](https://opencode.ai/docs/plugins/), [RTK supported agents](https://github.com/rtk-ai/rtk/blob/develop/docs/guide/getting-started/supported-agents.md), [Context Mode requirements](https://github.com/mksglu/context-mode/blob/main/docs/install/README.md).
