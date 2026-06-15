# Architecture

The durable truth of **code-analyzers**: what it is, and why it is shaped this way. House style (layout,
ports, wiring, tooling) lives in [CONVENTIONS.md](CONVENTIONS.md); this file is what is specific and
durable to *this* system. Transient plans/proposals live in `_local/` and are **not** the source of truth
— this file is. Sections marked *(to design)* describe intent, not settled detail.

---

## Why this exists

Code is increasingly **generated** by AI agents, fast. The bottleneck moves from *writing* code to
**proving it is good** — and giving both humans and coding agents that same confidence at velocity.

code-analyzers gives every code-analysis tool the **same shape**. When a linter, a coverage tool, a type
checker, a security scanner — anything — wears one uniform interface and emits one uniform evidence
artifact, then humans, agents, CI/CD, and auditing harnesses all invoke them identically and get back
**commensurable evidence**. Once shape is unified, the open decisions stop being integration plumbing and
become **economic**: for this change, which tools are worth running, at what cost, for what confidence —
**budget vs. value**. And harnesses compose these **simple primitives** and swap or upgrade the
implementation behind any one of them without being rewritten.

**What it refuses to do:**

- **It never manufactures evidence with an LLM.** This tool contains **no inference hop**. It is a
  *producer* of evidence artifacts that something downstream (an agentic harness, a reviewer, a gate)
  feeds to an LLM. The single short inference hop lives in the *consumer*, not here.
- **It does not impose absolute "better/worse" scores.** It guides attention; it does not grade.

## The evidence model — everything serves it

**Deterministic tools are proof.** Their output is fact, not opinion: a type error exists or it does not;
coverage is 84% or it is not. LLMs are valuable but, as non-deterministic black boxes, have a ceiling on
the trust their judgements can carry. So we do not ask an LLM to *fabricate* evidence. The trust argument
is one of **chain length**: `source → many inference hops → conclusion` is low-trust; shortening it to
`deterministic evidence → a single inference hop → conclusion` (performed downstream, by the consumer)
keeps the rubric-based judgement while making it trustworthy. **Short chain = higher trust.** This is *not*
a "don't trust the AI" posture — it is buying the last yard grace by feeding inference hard inputs.

### We wrap SARIF; we do not reinvent it

Findings are not ours to redefine. **SARIF** (the OASIS Static Analysis Results Interchange Format) is the
industry standard for analysis findings — GitHub code scanning, semgrep, CodeQL, gitleaks and many tools
emit or consume it. So findings ride in a **native SARIF log**, one `run` per analyzer. Egress is then
lossless (hand back the embedded SARIF) and any SARIF-emitting tool ingests directly.

But SARIF is a *diagnostics* format, and it structurally cannot carry the two things this project's thesis
hinges on. So our artifact is a thin **wrapper around SARIF**, the `EvidenceReport`, adding exactly what
SARIF lacks:

- **Numeric measurements** — SARIF has no first-class metric. `coverage = 84%`, `duplication = 3%` are
  named `measurements` (`{ name, value, unit?, address, analyzer }`): first-class **time-series** citizens,
  graphable over time and diffable across versions. (Burying them in SARIF property bags would forfeit the
  interop that motivated SARIF, and we'd still be defining a dialect — just an untyped one.)
- **The determinism disclosure** — `analyzers[].method` is `deterministic | inferred`, per analyzer (a
  tool is uniformly one or the other). All current analyzers are `deterministic`; `inferred` is reserved so
  a future LLM-backed analyzer slots in without a schema-breaking change, and so a downstream reasoner
  **never mistakes an inferred result for hard fact**. It is mirrored into `run.properties` so emitted
  SARIF stays self-describing.

SARIF's own `result.kind` (`pass | fail | informational | …`) already covers pass/fail checks, so a
"coverage report missing" or "below threshold" is a native SARIF `fail`, not a bespoke shape.

### Normalized addressing

For findings and measurements from different tools to be reasoned about *in relation to each other*, they
resolve to a shared coordinate. Findings address files via the SARIF artifact `uri` (repo-relative);
measurements carry an `Address` on the `repo → path → symbol/range` hierarchy. Commensurability comes from
this shared coordinate plus the hot-zone rollup — **not** from findings and measurements sharing one type
(they are genuinely different kinds of evidence).

**Canonical addressing is deceptively hard, and is deliberately deferred.** The wrapping layer normalizes
**best-effort**; because the last yard is handled downstream by a foundation model, residual imprecision
is absorbed there. We invest in addressing precision **empirically** rather than up front.

### Comparability over scoring

Reports **guide attention** ("hot zones" — files where flagging SARIF results land, ranked by how many
distinct tools agree), not absolute scores. Two reasons:

1. **The lens will change rapidly.** A lens is best judged by holding the subject constant — *same
   codebase, same moment, different lens*. Comparability comes from same-codebase-same-time, not a
   universal scale; baking in absolute scores would mostly measure the lens's own noise.
2. **Attention-focusing is the value floor.** Hot zones never *lose* value as the tools evolve.

### The schema version

The `EvidenceReport` wrapper is stamped with a **`schemaVersion`** (the embedded SARIF carries its own
`version: "2.1.0"`). The wrapper schema is *expected* to churn (v2 → v3–4 during solo iteration before
anyone else is looped in), so versioning the envelope from line one de-risks every change. Findings stay
SARIF-isomorphic so egress remains a mechanical mapping as the wrapper evolves.

### Renderers — one report, many projections

The single canonical `EvidenceReport` is projected for different consumers: **`report`** (full JSON — the
robust form for foundation models), **`simple`** (flattened, low-token JSON — for small local models),
**`sarif`** (the embedded SARIF verbatim — for GitHub code scanning and existing viewers), and **`human`**
(a terminal attention guide).

## System shape

Per [CONVENTIONS.md](CONVENTIONS.md) (language-first roots), with the divergences noted below. **Library
first, CLI thin** — the durable artifact is a well-documented exported class; the CLI is a thin wrapper so
the tool composes across CI/CD, agentic harnesses, ad-hoc runs against any repo, and a future company-wide
auditing service.

- **`ts/core`** — the contract: the `EvidenceReport` schema (`schemaVersion`), the SARIF 2.1.0 subset,
  `Measurement`, `AnalyzerRun` (incl. `method`), normalized address types, and the `Analyzer` interface
  (`analyze → { run, measurements, method }`). **Language-neutral** — TypeScript is the first *analyzed*
  language, but the contract never assumes it (polyglot is a goal).
- **`ts/lib`** — the exported orchestration class: run the registered analyzers → aggregate their SARIF
  runs and measurements → derive deterministic hot zones → assemble an `EvidenceReport`. Plays the `api`
  role (domain logic) but as an **in-process library, not an HTTP service**.
- **`ts/cli`** — a thin wrapper over `ts/lib`. Plays the `app` role; the user-facing surface is a **CLI,
  not a web app**.
- **Analyzers behind a stable `Analyzer` interface at a single wiring point.** Registered: **coverage**
  (the strategic primitive — compounding downstream work), **lint** (wraps Biome), and **duplication**
  (wraps jscpd — token-based clone detection, language-agnostic). Each normalizes its tool's output to a
  SARIF run; tools that already emit SARIF pass through. Adding an analyzer = a module plus a registry
  line; nothing else changes.

## Divergences from CONVENTIONS

- **No `app`/`api` web split.** v1 is **library + thin CLI**, not a user-facing web surface over an HTTP
  backend. `ts/lib` carries the domain logic as an in-process library; `ts/cli` is the user surface.
  Reason: composability — the value is being embeddable in CI/CD and agentic harnesses, which a library +
  CLI serves better than a service. (A service form, e.g. the future auditing service, may wrap the same
  library later.)
- **No ports.** As a CLI/library with no listening services, v1 claims **no port block**. Recorded in
  [README.md](README.md) as "none".
- **No inference / LLM dependency.** Unlike LLM-shaped systems, this tool deliberately contains no model
  call; it produces artifacts *for* downstream inference. (See "Why this exists".)

## Data model

The **EvidenceReport schema (v2)** — `ts/core` is the source of truth; this is the shape.

```
EvidenceReport {
  schemaVersion: "2"             // wrapper version stamp
  repo:          string
  sarif:         SarifLog        // findings, native SARIF 2.1.0 (one run per analyzer)
  measurements:  Measurement[]   // what SARIF can't carry (see below)
  analyzers:     AnalyzerRun[]   // per-analyzer provenance + determinism
  hotZones:      HotZone[]       // attention rollup over flagging SARIF results
}

Measurement {                    // a named numeric, time-series-friendly
  name:     string               // e.g. "coverage.statements.pct"
  value:    number
  unit?:    string
  address:  Address              // the sub-object measured
  analyzer: string               // which analyzer produced it
}

AnalyzerRun {
  tool:    string                // = SARIF run tool.driver.name
  version: string
  method:  "deterministic" | "inferred"   // all current analyzers deterministic
}

Address {                        // normalized coordinate (measurements + hot zones)
  repo:    string
  path:    string                // repo-relative POSIX; "" = repo-level
  symbol?: string                // e.g. "AuthService.login"
  range?:  { unit: "line"|"byte", start: number, end: number }
  level:   "repo" | "path" | "symbol" | "range"
}

// Findings live in `sarif` as native SARIF results: ruleId, level
// (none|note|warning|error), kind (pass|fail|informational|…),
// message.text, locations[].physicalLocation (artifactLocation.uri + region).
// `method` is mirrored into run.properties so emitted SARIF self-describes.
```
