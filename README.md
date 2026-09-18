# LoomDesk

> Local-first desktop client for coding agents.
> Connect Claude Code, Codex & more via ACP, chat directly or run structured workflows, with IM notifications & remote approvals on the go.

LoomDesk brings your local coding agents — Claude Code, Codex, and other ACP-compatible CLIs — into a single desktop app. Talk to an agent directly, or run structured multi-step tasks through workflows. Long-running tasks keep moving with IM notifications and remote approvals, so you don't have to sit at your desk.

## Features

- **Direct chat** — pick an agent and work in a continuous conversation with streaming output
- **Agent management** — detect installed CLIs, configure launch commands, env vars, and run environment diagnostics
- **ACP-native** — agents connect via the Agent Client Protocol (stdio + JSON-RPC), no proprietary protocol lock-in
- **Resumable sessions** — conversation history persisted locally (SQLite) and restored via ACP `session/load`
- **Permission approvals** — review and approve agent permission requests with desktop notifications
- **Attachments** — drag & drop files, paste images into the conversation
- **Usage tracking** — token usage and elapsed time per session
- **IM integration** *(planned)* — task notifications and remote approvals from Lark / DingTalk / WeCom
- **Structured workflows** *(planned)* — plan → execute → verify pipelines with artifact-based acceptance

## Status

⚠️ **Early development** — the project is under active construction. APIs and data formats will change without notice.

## Roadmap

- **M0** — ACP client prototype: streaming, permission requests, session resume
- **M1** — Desktop MVP: direct chat, agent management, session persistence, attachments
- **M2** — IM notifications & remote approvals; one-click setup for local agent CLIs
- **M3** — Structured workflows with artifact-grounded acceptance

## Development

```bash
npm install
npm run dev
```

> Detailed contribution and architecture docs are coming as the project takes shape.

## License

TBD
