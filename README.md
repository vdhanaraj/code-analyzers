# code-analyzers

A universal interface around existing code-analysis tools. It gives every tool — linter, coverage,
type checker, scanner — the **same shape**, so each emits a uniform, provenance-bearing **proof** artifact
that humans, coding agents, CI/CD, and auditing harnesses can consume and reason about in relation to each
other. It produces evidence *for* downstream inference; it contains **no LLM hop** of its own.

- **What it is and why** → [ARCHITECTURE.md](ARCHITECTURE.md) (the durable truth)
- **House style** → [CONVENTIONS.md](CONVENTIONS.md) (project-agnostic conventions)

> Status: **v1 (dialect v1).** Coverage + lint analyzers behind one shape, a
> deterministic hot-zone report, and a thin CLI over the `CodeAnalyzer` library.
> The proof dialect is expected to churn (v1 → v3–4) during early iteration.

## Quickstart

```bash
cd ts && pnpm install          # workspace deps (run `pnpm install` at root for hooks too)
pnpm -C ts build               # compile core/lib/cli
pnpm run analyze:self          # build + coverage + run the CLI against this repo

# General use (library is the durable surface; CLI is a thin wrapper):
node ts/cli/dist/index.js <repo> \
  --coverage-report <path/to/coverage-final.json> \
  --lint-cwd <dir> --lint-bin <path/to/biome> [--json]
node ts/cli/dist/index.js --help
```

The CLI emits a dialect-versioned proof report (`--json`) or a human-readable
attention guide (default). It contains **no LLM hop** — the artifacts are
evidence *for* a downstream consumer's single inference hop.

## Ports — none

v1 is a **CLI + library** with no listening services, so it claims **no port block** (see
[CONVENTIONS.md](CONVENTIONS.md) §Ports — divergence noted in [ARCHITECTURE.md](ARCHITECTURE.md)). If a
service form (e.g. a future auditing service) is added, it will claim a block here.
