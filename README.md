# code-analyzers

A universal interface around existing code-analysis tools. It gives every tool — linter, coverage,
type checker, scanner — the **same shape**, so each emits a uniform, provenance-bearing **proof** artifact
that humans, coding agents, CI/CD, and auditing harnesses can consume and reason about in relation to each
other. It produces evidence *for* downstream inference; it contains **no LLM hop** of its own.

- **What it is and why** → [ARCHITECTURE.md](ARCHITECTURE.md) (the durable truth)
- **House style** → [CONVENTIONS.md](CONVENTIONS.md) (project-agnostic conventions)

> Status: **greenfield.** Not yet built — the docs describe intent.

## Ports — none

v1 is a **CLI + library** with no listening services, so it claims **no port block** (see
[CONVENTIONS.md](CONVENTIONS.md) §Ports — divergence noted in [ARCHITECTURE.md](ARCHITECTURE.md)). If a
service form (e.g. a future auditing service) is added, it will claim a block here.
