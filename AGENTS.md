# Agent instructions

Vendor-neutral agent guide for **code-analyzers**. (`CLAUDE.md` is a symlink to this file for native Claude
Code pickup.)

- **What this system is and why** — read [ARCHITECTURE.md](ARCHITECTURE.md). It is the durable source of
  truth; build from it.
- **How we structure things** — follow [CONVENTIONS.md](CONVENTIONS.md): language-first roots, the `core`
  contract, single-wiring-point implementations, forward-only migrations, Biome + Lefthook, fail-closed
  gates.
- **Transient plans/proposals** live in `_local/` (gitignored) and are *not* the source of truth. If a
  plan and `ARCHITECTURE.md` disagree, `ARCHITECTURE.md` wins or gets corrected — never silently.

Keep this file a thin pointer. Durable design belongs in `ARCHITECTURE.md`; house style in
`CONVENTIONS.md`.
