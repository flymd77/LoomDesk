# ACP Support Matrix — Coding Agent CLIs

> Research notes for the LoomDesk agent integration layer (M0).
> Goal: decide which agents we ship with at launch, and how much adapter work each needs.
> Date: 2026-09-18. Web research; local verification pending (marked below).

## What is ACP

The [Agent Client Protocol](https://agentclientprotocol.com/) (originated by Zed, now with JetBrains as co-steward) standardizes how an editor/desktop client talks to a coding agent over **stdio + JSON-RPC**. Key methods on the client side:

- `initialize` — handshake, protocol version, client capabilities
- `session/new` / `session/load` — create a session or restore a previous one
- `session/prompt` — send a turn; agent streams back `session/update` notifications (message chunks, tool calls, plan, thoughts)
- `session/request_permission` — agent asks the user to approve an operation (our remote-approval wedge maps to this)
- `session/set_mode`, `session/set_model` — mode/model selection
- `elicitation/create` — structured questions from the agent

There is an official **TypeScript library** (`@zed-industries/agent-client-protocol`), which our Electron main process can build on.

## Support matrix

| CLI | Vendor | ACP status | How to launch | Notes |
|---|---|---|---|---|
| **Codex CLI** | OpenAI | ✅ via adapter [`@agentclientprotocol/codex-acp`](https://github.com/agentclientprotocol/codex-acp) | `npx @agentclientprotocol/codex-acp` | Adapter maintained under the official ACP org. Native ACP support in Codex itself is still an [open issue (#2785)](https://github.com/openai/codex/issues/2785). |
| **Claude Code** | Anthropic | ✅ via adapter [`@zed-industries/claude-code-acp`](https://www.npmjs.com/package/@zed-industries/claude-code-acp) | `npx @zed-industries/claude-code-acp` | Most mature path; huge user base. Adapter maintained under Zed. |
| **Qwen Code** | Alibaba | ✅ **native** (`--experimental-acp`) | `qwen --experimental-acp` | Gemini-CLI fork; ACP support is active (recent releases include ACP permission-queue fixes). Flag still marked experimental — verify stability locally. |
| **Kimi CLI** | Moonshot AI | ✅ **native** (`kimi acp`) | `kimi acp` | First-party docs page for the ACP subcommand; designed for Zed-style clients. |
| **iFlow CLI** | iFlow (心流) | ⚠️ partial/unclear | TBD | Official site markets an SDK that speaks ACP over WebSocket for sandbox scenarios; no confirmed plain-stdio ACP server mode for the CLI itself. Needs hands-on verification. |
| **GLM Coding Plan** | Zhipu (智谱) | ➖ not an agent | n/a | Not a CLI — it is an Anthropic-compatible API endpoint used **through Claude Code** (see [z.ai docs](https://docs.z.ai/scenario-example/develop-tools/claude)). From our side it is a Claude Code config preset (base URL + key), not a separate integration. |
| **Gemini CLI** | Google | ✅ native | `gemini --experimental-acp` | Included as ecosystem reference; not a China-ecosystem priority. |
| **Cursor CLI** | Cursor | ✅ native | `cursor-agent acp` | Reference; useful for compatibility testing since it uses `_meta` extensions. |
| **OpenCode** | SST | ✅ native | `opencode acp` | Popular open-source option; good secondary target. |
| **GitHub Copilot CLI** | GitHub | ✅ public preview | TBD | Announced 2026-01; watch for stability. |

## Launch recommendation

Ship M0/M1 with **three launch agents**:

1. **Codex CLI** (via `codex-acp`) — our primary agent.
2. **Claude Code** (via `claude-code-acp`) — the de-facto default; most users arrive with it already installed.
3. **Qwen Code** (native `--experimental-acp`) — the China-ecosystem flagship; open source, npm-installed, actively maintained.

Follow-up tier (M2+): Kimi CLI (native ACP, trivial to add once verified), OpenCode, iFlow (pending verification).

GLM Coding Plan users are served through Claude Code with a config preset — we should make this a first-class "provider preset" in agent setup, since it is the most common way Chinese users run Claude Code today (custom base URL + API key).

## Adapter vs native — implications for our ACP client

- Two launch shapes to support: **adapter-wrapped** (an npm package wraps the CLI; the CLI itself never speaks ACP) and **native** (the CLI has a built-in ACP mode/flag). Both are just "spawn this command, speak JSON-RPC over stdio" from our side — the difference only matters in setup UX (how we detect and validate the command).
- Auth differs per agent: Codex CLI uses its own auth (ChatGPT account or API key); Claude Code uses its subscription/API key; Qwen Code uses Qwen OAuth or API key; GLM presets inject env vars (`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`). Our agent config model needs: command, args, env, and a per-agent auth preset.
- `session/load` support must be verified **per agent** during M0 local testing — resume is core to our resumable-sessions promise, and adapters may not all implement it.

## Open items for local verification (M0 checklist)

- [ ] Spawn each launch agent and complete `initialize` handshake (protocol version pinned: v1)
- [ ] Streaming: message chunks, tool-call updates, plan updates render end-to-end
- [ ] `session/request_permission` round-trip (allow/deny both paths)
- [ ] `session/load` resume: works per agent? what breaks?
- [ ] Codex: confirm `codex-acp` adapter tracks upstream Codex releases without lag; note any version pinning needs
- [ ] Qwen Code: is `--experimental-acp` stable enough to default-recommend? Any flag rename pending?
- [ ] iFlow CLI: does it expose a plain stdio ACP server mode at all?
- [ ] Windows console-window behavior for spawned CLIs (hidden window, PATH discovery for `npm`/`npx` shims)
- [ ] Long-session stability: memory growth of adapter processes over a 1h+ session

## Sources

- Official agent list: https://agentclientprotocol.com/get-started/agents
- Protocol docs: https://agentclientprotocol.com/protocol/v1/overview
- codex-acp: https://github.com/agentclientprotocol/codex-acp
- claude-code-acp: https://www.npmjs.com/package/@zed-industries/claude-code-acp
- Qwen Code: https://github.com/QwenLM/qwen-code (+ ACP issue #88, release notes)
- Kimi CLI ACP docs: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html
- iFlow SDK ACP note: https://pypi.org/project/iflow-cli-sdk/
- GLM Coding Plan via Claude Code: https://docs.z.ai/scenario-example/develop-tools/claude
