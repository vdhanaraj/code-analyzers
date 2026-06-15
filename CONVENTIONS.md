# Conventions

> **Conventions v1** — project-agnostic house style. These are *independent, individually-liftable*
> conventions: adopt some, all, or none. Nothing here is specific to any one project. Project-specific
> choices, the domain model, and any deliberate *divergences from these conventions* live in that
> project's `ARCHITECTURE.md`.
>
> This file is meant to be **invariant across projects** and managed from a single canonical source (the
> `bootstrap` skill, which drops it in and diffs it). A project copy that has drifted should be reconciled,
> not silently overwritten — surface the diff and resolve it, in either direction.

---

## Repository layout — language-first roots

Top-level directories are **language roots**; services live inside them, named by **role**, not by
technology or deployment target (`app`/`api`, never `web`/`server`). A repo has exactly one `api`. The
language root is always present even for a single language, so adding a second later is cheap and nothing
cross-contaminates (each root keeps its own native tooling; CI runs per-root).

```
<repo>/
  _local/          # gitignored workspace (see §_local)
  <lang>/          # a language root (e.g. ts/) — a workspace if it has >1 package
    app/           #   user-facing surface       (@<repo>/app)
    api/           #   backend service           (@<repo>/api)
    core/          #   shared contract           (@<repo>/core)
```

## The contract layer

**`core` is the contract within a language root; OpenAPI is the contract across language roots.** In a
single-language repo, `core` is shared directly by `app` and `api`: request/response shapes and domain
types live there and are imported by both sides, so there is no hand-mirrored client. Whether `core` is
types-only or also carries its validation schemas is a project choice (stated in `ARCHITECTURE.md`). If a
second language root is added, OpenAPI becomes the cross-root contract at that boundary.

## Multi-implementation & wiring

When a capability has more than one implementation, each hides behind a **stable interface selected at a
single wiring point** via configuration — never chosen ad-hoc elsewhere. External drivers and SDKs live
only in the implementation layer (e.g. `api/src/<capability>/`), never imported by routers or domain
logic. Adding an implementation means adding a module and a case at the wiring point; nothing else
changes.

## Dependency rules

```
app   ← imports the contract from core; talks to api over HTTP/SSE only
api   ← imports the contract from core; uses implementation layers for all external systems
core  ← the contract; depends on nothing (or only its validation library)
```

Nothing outside the implementation layers imports an external driver/SDK directly. The user-facing
surface never imports backend code and never holds secrets.

## Testing

Tests live next to the code they exercise, classified by **what they touch**, run with the root's native
runner:

- **Pure logic / services** → unit tests, dependencies mocked, no external infrastructure.
- **Infrastructure-touching** → integration tests against ephemeral, real infrastructure, with external
  services (LLMs, third-party APIs) mocked at their wiring seam so the suite is deterministic and offline.
- The `*.integration.*` suffix marks an integration test inside an otherwise-unit module.
- **Security- or correctness-critical paths** get explicit **negative** tests — malformed, expired,
  replayed, wrong-input cases must be proven to be rejected.

## Tooling & quality gates

- **Lint + format: Biome**, one config per language root. Formatting is **not a review topic** — the
  formatter decides, mechanically.
- **Git hooks: Lefthook** at the repo root, installed by a `prepare` script so hooks wire up on install.
  - **pre-commit** (staged files): Biome (autofix + re-stage) → typecheck.
  - **pre-push**: the affected unit suites.
- **Fail closed, fail fast.** A hook failure blocks the commit/push; `--no-verify` only in a genuine
  emergency, and say so. Hooks are a cheap *local* gate, not a substitute for CI.
- **CI runs the same checks** per root — the full suite, of which the pre-commit hook is the cheap subset.

## Migrations

Migrations are **forward-only**: no rollbacks; to undo, write a new migration. This keeps the audit trail
intact. The schema's source of truth and the migration runner are a **project choice** stated in
`ARCHITECTURE.md` (hand-written SQL bundle, or generated from a typed schema). Either way, applied
migrations are recorded and an existing database can be **baselined** without re-running, so adopting the
runner never destroys data.

## Deployment

Deployment is **Docker-based** and configuration is **environment-driven** (no hardcoded values; state in
mounted volumes survives restarts). The specific topology — a single multi-stage image, or compose plus
dev servers — is a **project choice** stated in `ARCHITECTURE.md`, and may differ by phase.

## Ports

A project claims a **contiguous block of 10 ports**, all **environment-variable driven** (no hardcoded
ports). Within the block, the **last digit signals role**:

- `0` — primary user entrypoint (public)
- `1`–`4` — services with a public port
- `5`–`9` — backend/infra (LAN/VPC only)

The project's **specific block** is recorded in its `README.md` (project identity), not here. Block
allocation is human-managed: pick a free block by looking at what is already running.

## `_local`

`_local/` is a **gitignored workspace** for transient, personal artifacts — plans, proposals, scratch. It
stays present in the repo via a **self-ignoring** `.gitignore`:

```
# _local/.gitignore
*
!.gitignore
```

That ignores everything inside `_local/` except the `.gitignore` itself, which keeps the otherwise-empty
folder in a fresh clone. **Anything an agent needs to build the project must not live only here** — the
committed truth is `ARCHITECTURE.md` + this file. A proposal in `_local/` is private kickoff scratch;
decisions worth keeping migrate into `ARCHITECTURE.md`.

## Agent instructions

The agent-instructions file is **`AGENTS.md`** — the vendor-neutral standard, so any agent tool can read
it. `CLAUDE.md` is a **symlink to `AGENTS.md`** for native Claude Code pickup. Keep it a **thin pointer**:
follow `CONVENTIONS.md` for *how we structure*, and `ARCHITECTURE.md` for *what this system is and why*.

## Extension mechanism

Extension is via **forks and pull requests**, not a plugin registry. Interfaces are designed with clean
seams as if a plugin API will exist, but no dynamic loader is built until there is real demand.
