# Engineering agent stack — revision 2026-11-20

A reproducible OpenCode v2 configuration with one agent source and per-machine model profiles. OpenChamber remains the UI; OpenCode is the execution engine. Codex can share the engineering rules and explicitly installed skills, but the OpenCode agent YAML and translator are not Codex plugins.

## Install or update

Keep the complete checkout. The install scripts now share one canonical source for the owned policy, agents and translator; they are no longer standalone single-file installers. Use Node.js 22+ (24.15+ if testing Context Mode), npm, Git and stable OpenCode >=2.2.5 and <3. Linux/WSL requires Linux Node/npm and curl. OpenCode itself is not installed by these scripts. Back up the existing OpenCode configuration and stop active sessions before migration.

macOS/Linux/WSL:

```bash
bash bin/install-all.sh --profile work
```

Windows PowerShell (from the checkout):

```powershell
& .\bin\install-all.ps1 --profile home
```

The scripts install/update Playwright CLI, Superpowers, LiteLLM, Plannotator, Subagent Intervene, Status Line, Context7, Serena, ProjectMem, and RTK; deploy the global policy, all 18 agents with the selected profile's models and the local translator; preserve the translator's existing settings; and attempt to remove the legacy Ponytail, DCP and Beads package registrations if present. Beads databases/CLI and old skill folders are not deleted. Native RTK integration is initialized when the binary and standard config directory are available. Existing Serena idle timeout is preserved; otherwise the original 5-minute default is applied. Existing provider credentials are not replaced. Package updates use the existing upstream update mechanism; this is not a fully pinned dependency lock.

If OpenCode is absent, only Playwright CLI is updated. To deploy only the owned configuration without reinstalling tools or touching providers:

```bash
node bin/deploy-config.mjs --profile work
```

Profile resolution is `--profile work|home`, then `AGENT_STACK_PROFILE`, then `<config>/stack-profile`. Deployment persists the resolved name for subsequent runs. Missing, empty or unknown profiles fail rather than guessing; the corresponding `profiles/<name>.json` must exist. The skills installer uses the same resolver and accepts `--profile` and `--config-dir` too.

```text
myagents/             # 18 authored Markdown agents, no model frontmatter
profiles/work.json    # litellm/* model map
profiles/home.json    # openai/*#effort model map
skills.json           # explicit skill manifest; optional profiles: ["work"]
```

Use `--config-dir /actual/opencode/config` when needed. The deploy helper backs up changed existing files under `stack-backups/<timestamp>-<pid>/` inside that config directory. It updates a managed block in global `AGENTS.md`, replacing the exact original policy from the supplied archive or preserving unrelated global text. Review any preserved older rules for contradictions. Models are injected before the closing frontmatter delimiter. The 18 managed agent files are intentionally replaced; `<config>/agents/.agent-stack-deployed.json` records their names. Only stale files in that previous list are pruned and backed up; unlisted user agents survive. An old untracked `vision-gemini.md` must be reviewed manually, not guessed to be managed. The local plugin directory is auto-discovered by OpenCode. Do not add a second copy of the same plugin.

## Skills: declarative Vercel Skills CLI (explicit install)

**The main `bin/install-all.sh` and `bin/install-all.ps1` never install or update skills.** They manage apps, plugins, MCP, agents and the translator. Skill installation is an independent explicit step. The existing Matt Pocock `.skill-lock.json` and Superpowers upstream installation are untouched.

The **editable source of truth** for the extra global skills is [`skills.json`](skills.json). It declares both target agents (`opencode` and `codex`), the desired skills and where they come from. The thin wrapper calls the **official [Vercel Skills CLI](https://github.com/vercel-labs/skills)** (`skills@1.9.0` pinned in the manifest); it does **not** clone GitHub repositories or maintain its own vendor copies. Vercel manages its own global lockfile and the shared `~/.agents/skills/` + agent integrations.

Requires **Node.js >=22.20.0** and npm/npx. To preview and install on macOS, Linux or WSL:

```bash
bash bin/install-skills.sh --dry-run
bash bin/install-skills.sh --migrate-legacy   # first upgrade from our old custom installer
bash bin/install-skills.sh                    # subsequent updates, applies skills.json
```

On Windows PowerShell:

```powershell
.\bin\install-skills.ps1 --dry-run
.\bin\install-skills.ps1 --migrate-legacy  # first upgrade only
.\bin\install-skills.ps1
```

`--migrate-legacy` is necessary **only if** the previous custom installer left untracked skill directories/symlinks. Without it, the wrapper stops rather than silently overwriting them. Migration backs up only conflicting named entries to `~/.agents/skill-migration-backups/<timestamp>/`; unrelated user skills are not touched. Run `--dry-run` first to see which entries conflict. **No deletions by default**: removing a skill from `skills.json` preserves the former install. To remove entries that *this wrapper previously installed* and are no longer listed, run `bash bin/install-skills.sh --prune` (or PowerShell equivalent) after inspecting the plan with `--dry-run --prune`.

| Skill | Origin | Owner |
|---|---|---|
| `code-simplifier` | `getsentry/skills` | Vercel downloads upstream |
| `better-writing` | `forjd/better-writing` | Vercel downloads upstream |
| `technical-writing` | `myskills/technical-writing/` | Our locally adapted skill; installed by Vercel |
| `drawio` | Official `jgraph/drawio-mcp` skill | Vercel downloads upstream |

The manifest currently contains **four** entries; it is unchanged. The earlier six-entry documentation included `external-research-handoff` and `projectmem-migrate`, neither of which is installed by this manifest. Entries may opt into one or both machine profiles with a non-empty `profiles` array; absent means both. `--dry-run` and `--list` print excluded entries with the profile reason. Switching profiles skips installation, but does not uninstall existing skill files.

### Per-machine skill on/off

```bash
node bin/skills-toggle.mjs off drawio
node bin/skills-toggle.mjs status
node bin/skills-toggle.mjs on drawio
```

All commands accept `--config-dir DIR`. State lives in `<config>/skill-toggles.json`; disabling adds an exact `skill`/name/`deny` entry to the global `permissions` array in `opencode.json` (or the existing `opencode.jsonc`). Enabling removes that exact deny tuple only, preserving unrelated and extended rules. An unrelated wildcard deny can still prevent access. The first configuration write saves an original backup under `stack-backups/`; JSONC edits preserve comments and unrelated text. This requires `jsonc-parser`, installed by `install-all` under `<config>/cli-packages/`. Skill files are never moved or changed; these toggles enforce OpenCode permissions, not Codex permissions.

For day-to-day checks:

```bash
bash bin/install-skills.sh --list           # Vercel: skills ls -g
bash bin/install-skills.sh --check          # Vercel: skills check
bash bin/install-skills.sh --dry-run        # Preview manifest application
bash bin/install-skills.sh                  # Reapply list, update sources
```

`skills.json` is **our small global manifest**, because Vercel's `experimental_sync` uses project-local `package.json` and `.agents/skills/`, not your global skill installation. We deliberately use the **stable `skills add -g`** for the global setup. Vercel's own global lockfile may live in `~/.local/state/skills/.skill-lock.json` (depending on XDG configuration) or `~/.agents/.skill-lock.json` on older versions. The wrapper stores only the names it manages in `~/.agents/.vercel-skillstack.json`, so optional pruning never deletes unrelated skills. The repository's `.skill-lock.json` is the independent Matt Pocock metadata and is not modified.

The `myskills/` contents, including adapted Technical Writing, are not overwritten by upstream updates. Their changes are applied on the next explicit installer run. Existing Superpowers skills keep the original plugin update path; **do not install a duplicate copy of Superpowers via this manifest**.

Mermaid in Markdown remains the default for small diagrams. `drawio` generates editable diagrams on demand; it does **not** install Draw.io Desktop or the optional official Draw.io MCP. Install native applications with their own installers when required, and follow [Draw.io MCP documentation](https://github.com/jgraph/drawio-mcp/blob/main/mcp-tool-server/README.md#opencode) if you want it.

For Codex, merge the relevant global rules from `AGENTS.md` into `~/.codex/AGENTS.md` deliberately, without overwriting unrelated instructions. Agents do not install missing skills autonomously. Caveman remains opt-in. Playwright has its own native skill setup and is not managed by this manifest:

```bash
playwright-cli install --skills=agents --global
```

The first installation has **not** been run against your actual OpenCode/Codex installation. The offline test suite checks manifest validation, CLI arguments, non-destructive first-run migration, repeat runs and pruning; actual GitHub/npm downloads require a normal environment with internet access and Node >=22.20.0.

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

Work model IDs below have the `litellm/` prefix; home IDs have `openai/`. Agent bodies and permissions are shared; only models vary.

| Agent | Work model | Home model | Purpose |
|---|---|---|---|
| `orchestrator` | deepseek-v4.1-flash-1017 | gpt-6-luna#medium | Delegation and coordination |
| `planner` | claude-opus-5-5 | gpt-6.1-terra#medium | Ordinary complex-ticket plan |
| `planner-hard` | gpt-6.1-sol | gpt-6.1-sol#high | High-risk planning |
| `builder-simple` | deepseek-v4.1-flash-1017 | gpt-6.1-terra#low | Small isolated changes |
| `builder-medium` | gpt-6.1-sol | gpt-6.1-terra#medium | Multi-file features |
| `builder-hard` | kimi-k3.1-pro | gpt-6.1-sol#high | Complex implementation/debugging |
| `builder-expert` | claude-opus-5-5 | gpt-6-astra#high | Exceptional evidenced blockers |
| `reviewer-fast` | minimax-m3.1-flash | gpt-6-luna#medium | Low-risk checks |
| `reviewer` | kimi-k3.1-pro | gpt-6.1-sol#high | Substantive review |
| `reviewer-independent` | gpt-6.1-sol | gpt-6-astra#medium | Independent high-risk review |
| `analyst` | deepseek-v4.1-flash-1017 | gpt-6-luna#medium | Requirements evidence |
| `research` | deepseek-v4.1-flash-1017 | gpt-6-luna#medium | Primary-source research |
| `repo-scout` | deepseek-v4.1-flash-1017 | gpt-6-luna#low | Repository discovery |
| `tester` | deepseek-v4.1-flash-1017 | gpt-6-luna#low | Test evidence |
| `vision` | gpt-6-luna | gpt-6.1-terra#medium | Visual evidence |
| `vision-second-opinion` | gemini-3.8-flash | gpt-6.1-sol#high | Independent visual evidence |
| `workflow` | minimax-m3.1-flash | gpt-6.1-terra#low | Authorized workflow operations |
| `git-manager` | gpt-6-luna | gpt-6-luna#medium | Authorized Git operations |

Models/effort are assignments, not a benchmark. Check actual IDs/variants and quota availability on each machine. Reviewer edit permission is denied, but shell remains available for tests; this is not a hard read-only sandbox.

**Subagent whitelist.** The orchestrator denies wildcard subagent dispatch, then explicitly allows all 18 names above, including `git-manager`, `planner-hard` and `vision-second-opinion`. Its edit tool is denied and shell is restricted to read-only Git inspection and `rg`. Leaf agents and both planners cannot spawn children; the primary session owns coordination.

**Code Mode.** `execute` is allowed for every agent and is the default tool path: batch independent calls in one script, return only needed evidence, and use a direct tool for a single call. Denying `execute` flattens its reachable tools into direct definitions in every request; it is not a context-saving switch.

**Reading `.env*`.** Builders and Tester may read environment files to learn key names; other roles remain denied. Values must never be printed, echoed, logged, committed, copied into a file, or sent through chat or subagent prompts. Commands that need credentials load the environment without exposing values; accidental capture is reported as `[secret]`. This is a behavioral guard, not value-level redaction.

**Model debate.** Architecture-level or high-risk decisions trigger a primary-session-coordinated panel: one written proposal, 2–3 reviewers on different models, then a second round showing each other's verdicts. State the trigger in one line; cap at two rounds and 300 words per verdict; never use it for routine implementation. Work uses Planner/Opus, Reviewer/Kimi and Independent Reviewer/Sol; home uses Reviewer/Sol, Independent Reviewer/Astra and Planner Hard/Sol. Record the outcome and dissent in an ADR under the consuming project's `.projectmem/knowledge/`.

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
