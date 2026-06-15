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

## The proof model — everything serves it

**Deterministic tools are proof.** Their output is fact, not opinion: a type error exists or it does not;
coverage is 84% or it is not. LLMs are valuable but, as non-deterministic black boxes, have a ceiling on
the trust their judgements can carry. So we do not ask an LLM to *fabricate* evidence. The trust argument
is one of **chain length**: `source → many inference hops → conclusion` is low-trust; shortening it to
`deterministic proofs → a single inference hop → conclusion` (performed downstream, by the consumer) keeps
the rubric-based judgement while making it trustworthy. **Short chain = higher trust.** This is *not* a
"don't trust the AI" posture — it is buying the last yard grace by feeding inference hard inputs.

A **proof primitive** is the irreducible artifact. It is a claim plus a deterministic measurement against
it, carrying enough provenance and scope to be trusted and combined with others:

- `claim` — what was asserted.
- `result` — the deterministic measure.
- `provenance` — `tool` + `version` + `config` + `inputsHash`, plus `method`
  (`deterministic` | `inferred`). v1 analyzers always emit `deterministic`. The enum is reserved now so a
  future LLM-backed analyzer slots in without a dialect-breaking change, and so a downstream reasoner can
  **never mistake an inferred result for hard fact**.
- `scope` — the sub-object of the codebase the proof addresses.
- `metrics` — named numeric measures (`{ name → value }`), first-class **time-series** citizens: graphable
  over time, diffable across versions of the code.

A tool emits a **set** of proofs, each addressed to a sub-object — not one verdict for the whole repo.

### Normalized addressing

For proofs from different tools to be reasoned about *at the same level and in relation to each other*,
their scopes resolve to a shared **hierarchical coordinate**: `repo → path → symbol/range`. Coarse tools
attach at the path level, fine tools at symbol/range; a parent **aggregates its children**, which is what
enables **rollups** and **same-codebase comparison**.

**Canonical addressing is deceptively hard, and is deliberately deferred.** The wrapping layer normalizes
**best-effort**; because the last yard is handled downstream by a foundation model, residual imprecision
is absorbed there. We invest in addressing precision **empirically** — once real wrapped tools give us
artifacts to compare — rather than designing a perfect coordinate system up front.

### Comparability over scoring

v1 emits reports that **guide attention** ("hot zones" for human/agent review), not absolute scores or
better/worse verdicts. Two reasons:

1. **The lens will change rapidly.** A lens is best judged by holding the subject constant — *same
   codebase, same moment, different lens*. Comparability comes from same-codebase-same-time, not from a
   universal scale; baking in absolute scores would mostly measure the lens's own noise.
2. **Attention-focusing is the value floor.** Hot zones never *lose* value as the tools and process
   evolve, so they are the safest thing to ship first.

### The dialect

Every emitted artifact is JSON stamped with a **`dialect` version**. The schema is *expected* to churn
(v1 → v3–4 during solo iteration before anyone else is looped in), so versioning the envelope from line
one de-risks every change.

## System shape

Per [CONVENTIONS.md](CONVENTIONS.md) (language-first roots), with the divergences noted below. **Library
first, CLI thin** — the durable artifact is a well-documented exported class; the CLI is a thin wrapper so
the tool composes across CI/CD, agentic harnesses, ad-hoc runs against any repo, and a future company-wide
auditing service.

- **`ts/core`** — the contract: the dialect-versioned proof schema (incl. `provenance.method`), normalized
  address types, named-metric types, and the `Analyzer` interface. **Language-neutral** — TypeScript is
  the first *analyzed* language, but the contract never assumes it (polyglot is a goal).
- **`ts/lib`** — the exported orchestration class: walk the repo → run the registered analyzers →
  normalize addresses → assemble proofs → derive deterministic hot zones. Plays the `api` role (domain
  logic) but as an **in-process library, not an HTTP service**.
- **`ts/cli`** — a thin wrapper over `ts/lib`. Plays the `app` role; the user-facing surface is a **CLI,
  not a web app**.
- **Analyzers behind a stable `Analyzer` interface at a single wiring point.** v1 registers **coverage**
  (the strategic primitive — compounding downstream work) and **lint**. Adding an analyzer = a module plus
  a case at the wiring point; nothing else changes.

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

The **proof dialect (v1)** — shapes are illustrative, not yet frozen; `ts/core` is the source of truth
once written.

```
Proof {
  claim:      string            // what was asserted
  result:     <deterministic measure>
  scope:      Address           // the sub-object addressed
  metrics?:   { [name]: number } // named, time-series-friendly
  provenance: {
    tool:       string
    version:    string
    config:     <serializable>
    inputsHash: string
    method:     "deterministic" | "inferred"   // v1 always "deterministic"
  }
}

Address {                        // normalized hierarchical coordinate
  repo:    string
  path:    string
  symbol?: string                // e.g. "AuthService.login"
  range?:  { start: number, end: number }
}

Report {
  dialect:  string               // dialect version stamp
  proofs:   Proof[]
  hotZones: <attention-guiding rollup, deterministic>
}
```
