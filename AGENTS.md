# LM App — Coding Agent Instructions

These instructions apply to every AI coding agent working in this repository, regardless of model/provider.

## Required Reading Before Changes

Before modifying code, read the documents relevant to the task. At minimum:

1. `docs/PRD.md`
2. `docs/BUSINESS_RULES.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SECURITY_AND_MAINTENANCE.md`
5. `docs/MANUAL_BOOK.md` for current operational behavior

For payment/security work, also inspect the relevant migrations, API handlers, audit logic and `docs/payment-security-cron.md` before proposing changes.

## Product Source of Truth

- The approved PRD defines product direction.
- `BUSINESS_RULES.md` defines canonical business invariants.
- Existing code and `MANUAL_BOOK.md` describe current implementation and may contain legacy behavior.
- If code conflicts with approved business rules, do not silently choose one. Surface the conflict in the plan/PR.
- Do not invent business rules, prices, SLA, roles, canonical statuses or financial behavior.

## Development Workflow

For non-trivial work:

1. Inspect the relevant code and documentation.
2. State the intended change and affected domains.
3. Identify risk level (L1–L4 from `docs/PRD.md`).
4. Work on an isolated branch/worktree.
5. Make the smallest coherent change.
6. Run appropriate lint/tests/type/build validation.
7. Review the diff for unrelated changes and secrets.
8. Document migrations/config/env changes explicitly.
9. Open a Pull Request for human review.

Do not push directly to `main` as the normal AI workflow.

## Protected Areas

Treat these as high-risk:

- payment verification/webhooks/reconciliation
- deposit and customer balance
- authentication/authorization/passwords
- finance/accounting/void
- production database migrations
- secrets and deployment credentials

Changes in these areas require explicit human review. Preserve existing security/idempotency/audit guarantees unless an approved design intentionally replaces them.

## Mandatory Safety Rules

Never:

- commit secrets, tokens, passwords or production credentials
- expose `SUPABASE_SERVICE_ROLE_KEY` or equivalent privileged keys to the browser
- trust client state as proof of payment
- bypass server authorization for privileged operations
- hard-delete financial transactions as a routine workflow
- remove audit/idempotency protection to make a feature easier
- run destructive production database commands
- deploy production automatically unless an explicitly approved deployment automation governs that action
- invent a new canonical order/payment status without updating and approving business rules

If a secret is found in Git history, treat it as compromised and recommend rotation. Removing it from the current file is not sufficient remediation.

## Architecture Direction

Prefer this dependency direction:

`UI → API/server boundary → domain/service layer → business rules → data access → Supabase/Postgres`

Do not add new duplicated business-rule arrays/calculations inside UI when a shared domain/configuration source should exist.

Refactor incrementally. Do not perform a broad rewrite merely because a cleaner architecture is possible.

## Database Changes

For schema changes:

- use a new reviewed migration
- explain data/backfill impact
- consider RLS/grants and service-role boundaries
- avoid destructive migration patterns when a safe staged migration is possible
- preserve auditability of money-related records

Do not assume a migration has been applied to production simply because the SQL file exists in Git.

## Testing Expectations

Use validation appropriate to the change. At minimum consider:

- lint/type/build
- focused unit/integration tests where available
- payment idempotency for payment changes
- authorization failure paths for privileged API changes
- duplicate/race behavior for pickup/order conversion
- reporting behavior for void/cancelled transactions

If the repository lacks a needed test, state that limitation in the PR and add a targeted test when practical.

## External Integrations

Provider-specific behavior (payment, delivery, maps, messaging) should be isolated behind adapters/services where practical. Do not scatter provider credentials or raw provider rules through unrelated UI components.

## AI Behavior

AI is an implementation assistant, not the business owner. When a request conflicts with `BUSINESS_RULES.md`, security rules, or a protected invariant, surface the conflict and request/record the necessary product decision instead of silently bypassing the rule.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
