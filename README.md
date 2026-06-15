# code-analyzers

A universal interface around existing code-analysis tools. It gives every tool — linter, coverage,
type checker, scanner — the **same shape**, so each emits a uniform, provenance-bearing **proof** artifact
that humans, coding agents, CI/CD, and auditing harnesses can consume and reason about in relation to each
other. It produces evidence *for* downstream inference; it contains **no LLM hop** of its own.

- **What it is and why** → [ARCHITECTURE.md](ARCHITECTURE.md) (the durable truth)
- **House style** → [CONVENTIONS.md](CONVENTIONS.md) (project-agnostic conventions)

> Status: **v2 (schema v2).** Analyzers behind one shape — **coverage, lint,
> duplication** (default) plus opt-in **secrets** (gitleaks) and
> **vulnerabilities** (osv-scanner) — emitting an `EvidenceReport` that **wraps
> SARIF** (native findings) and adds what SARIF can't carry: numeric
> measurements, a deterministic/inferred disclosure, and an external-reference
> note for tools that query live data. Plus a deterministic hot-zone rollup and
> four output projections, over a thin CLI. The wrapper schema is expected to
> churn (v2 → v3–4) during early iteration.

## Quickstart

```bash
cd ts && pnpm install          # workspace deps (run `pnpm install` at root for hooks too)
pnpm -C ts build               # compile core/lib/cli
pnpm run analyze:self          # build + run the CLI against this repo (no pre-steps)

# General use (library is the durable surface; CLI is a thin wrapper).
# coverage RUNS your tests with coverage itself — configure the command and where
# it writes the Istanbul report (or pass --coverage-skip-run to ingest an existing one):
node ts/cli/dist/index.js <repo> \
  --coverage-bin <test-runner> --coverage-args run,--coverage \
  --coverage-cwd <dir> --coverage-report <path/to/coverage-final.json> \
  --lint-cwd <dir> --lint-bin <path/to/biome> \
  --output <human|report|simple|sarif>
node ts/cli/dist/index.js --help
```

The CLI projects one canonical `EvidenceReport` by `--output`: **human** (default
attention guide), **report** (full JSON — for foundation models), **simple**
(flattened low-token JSON — for small local models), **sarif** (the embedded
SARIF log — for GitHub code scanning and viewers). It contains **no LLM hop** —
the artifacts are evidence *for* a downstream consumer's single inference hop.

## Ports — none

v1 is a **CLI + library** with no listening services, so it claims **no port block** (see
[CONVENTIONS.md](CONVENTIONS.md) §Ports — divergence noted in [ARCHITECTURE.md](ARCHITECTURE.md)). If a
service form (e.g. a future auditing service) is added, it will claim a block here.
