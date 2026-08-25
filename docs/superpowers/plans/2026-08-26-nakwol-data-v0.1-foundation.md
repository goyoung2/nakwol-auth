# NAKWOL DATA v0.1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build independently deployable `nakwol-data` Worker/D1 Foundation with permanent-data schema, AUTH-backed identity verification, deny-by-default DATA scopes, game-account foundation and Registry reads.

**Architecture:** DATA lives in `services/data/` as its own package with Wrangler config/migrations. It validates opaque AUTH tokens through AUTH `/me`, never AUTH D1. DATA authorization is local app scope keyed by AUTH-verified client ID.

**Tech Stack:** Cloudflare Workers, D1/SQLite, Hono, TypeScript, node:test/tsx, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-26-nakwol-data-v0.1-design.md`

## Constraints
Service `0.1.0`, schema `1`, Worker/D1 `nakwol-data`; no AUTH D1 access; browser Origin delegated to AUTH; no scope by default; breakthrough 0..5; promotion >=0; equipment stat/trait 1..2; deck positions 1..3; tactic slots 1..2; normal DATA deploy never recreates D1.

### Task 1 — Schema/domain
- [x] Failing tests for tables/constraints/version/scope/IDs.
- [x] RED verified.
- [x] Migration/domain implemented.
- [x] Real SQLite GREEN.

### Task 2 — AUTH principal/DATA scope
- [x] Failing tests for bearer/client, AUTH delegation, Origin forwarding, subject mirror, default deny.
- [x] RED verified.
- [x] Principal/store implemented.
- [x] GREEN.

### Task 3 — HTTP Foundation
- [x] Failing tests for health/schema/preflight/me/account/Registry scopes.
- [x] RED verified.
- [x] Hono adapter + pure handlers implemented.
- [x] GREEN.

### Task 4 — Independent deployment
- [x] Deployment-contract tests written RED.
- [x] Independent package/config/bootstrap/deploy implemented.
- [x] Local contract GREEN.
- [ ] PR CI: npm install/test/typecheck/Wrangler dry-run.

### Task 5 — Documentation/integration
- [x] DATA/root docs and changelog updated.
- [x] Local Node 22 integration: 18/18 PASS.
- [ ] One DATA Verify PR run.
- [ ] Merge after green.
- [ ] Explicit production bootstrap after merge.
