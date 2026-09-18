# LM App — Target Architecture

**Status:** v0.1 target architecture  
**Date:** 2026-09-18

## 1. Architecture Goal

Evolve the existing Next.js/Supabase application incrementally into clearly bounded product domains without disrupting working operational workflows. The architecture must support both human developers and interchangeable AI coding agents.

## 2. Current Platform Baseline

LM App currently uses a Next.js App Router application with TypeScript and Supabase/Postgres, with role-oriented application surfaces such as Customer, POS, CS, Driver and Owner. External integrations include payment, maps/location, push/notifications and operational services.

The existing application remains the migration baseline. This document does not authorize a rewrite.

## 3. Target Layering

Preferred dependency direction:

```text
UI / Role Portals
       ↓
API Route / Server Boundary
       ↓
Domain / Application Services
       ↓
Canonical Business Rules
       ↓
Repositories / Data Access
       ↓
Supabase / Postgres
       ↓
External Integrations where required
```

UI components may format data and manage presentation state but should not become the sole authority for cross-application business rules.

## 4. Domain Boundaries

Target domains:

- `customer`
- `order`
- `outlet`
- `dispatch`
- `driver`
- `pos`
- `production`
- `payment`
- `deposit`
- `crm`
- `loyalty`
- `complaint`
- `finance`
- `requisition`
- `management`
- `notification`
- `audit`
- `analytics`

These are logical boundaries. Existing folder structure does not need to be reorganized all at once.

## 5. Order Domain

Order becomes the primary operational aggregate linking customer, outlet, pickup/delivery, production and payment references.

Operational status must follow `docs/BUSINESS_RULES.md`. Legacy statuses should be migrated/mapped progressively rather than replaced blindly.

## 6. Delivery Provider Abstraction

Target interface concept:

```text
Dispatch Service
  ├── Internal Driver Provider
  ├── Lalamove Adapter
  ├── Grab Adapter (when integrated)
  └── Gojek Adapter (when integrated)
```

Each provider adapter owns provider-specific request/response/status translation. The order/dispatch domain works with a normalized provider/job model.

## 7. Payment Architecture

Payment is a protected boundary.

```text
Customer/POS
    ↓
Payment API / Service
    ├── Gateway Adapter (Mayar currently)
    ├── Deposit Service
    ├── Cash Recording
    └── Manual Verification (authorized)
             ↓
      Idempotent payment state
             ↓
        Audit / Finance
```

Webhook, polling/check-status and scheduled reconciliation should converge on common server-side verification/update logic where possible.

A future gateway can be introduced through an adapter without changing every role portal.

## 8. Data and Supabase

- Postgres/Supabase remains the primary operational datastore unless a separately approved architecture decision changes it.
- Schema changes use reviewed migrations.
- Privileged operations use server-side credentials only.
- RLS/grants remain defense-in-depth for sensitive tables.
- Realtime is appropriate for chat/queue/status experiences but should not replace authoritative transactional validation.
- Financial records favor append/audit/soft-void patterns over destructive deletion.

## 9. Authentication and Authorization

Authentication and authorization must be treated separately.

Target direction:

1. Authenticate user/session securely.
2. Resolve authoritative role/permissions server-side for privileged actions.
3. Avoid trusting role strings supplied only by the client.
4. Progressively review legacy client/localStorage session behavior and migrate sensitive access toward stronger server-verifiable session mechanisms.

Authentication refactoring is high risk and should be incremental with regression testing.

## 10. Configuration and Business Rules

Centralize shared configuration for:

- service catalog
- price and speed multipliers
- SLA
- loyalty/tier configuration
- order lifecycle
- delivery eligibility/provider rules
- role permissions
- finance mappings where appropriate

Avoid multiple hard-coded arrays/calculations in unrelated UI files.

## 11. Observability

Critical integrations and money operations should expose sufficient structured evidence for diagnosis:

- audit logs
- webhook logs
- error logs
- payment pending/reconciliation visibility
- actor/action/entity context

Management system-health surfaces should consume server-authorized summaries rather than exposing privileged raw data publicly.

## 12. Performance Principles

- Bound large queries by period/limit/pagination.
- Defer large images/evidence until requested.
- Avoid duplicating heavy owner/dashboard implementations.
- Keep realtime subscriptions scoped to operationally useful data.
- Prefer server aggregation for management dashboards where raw client fetching becomes expensive.

## 13. Secret Management

Production secrets must be supplied through deployment/VPS secret or environment management and never committed to Git.

Examples of protected secrets include service-role database keys, payment gateway secrets, cron secrets, ops authorization secrets, Evolution/API credentials and database passwords.

Any secret found in public Git history must be treated as compromised and rotated; deleting it from the latest file alone is insufficient.

## 14. Deployment Model

Current application deployment may continue on Vercel while the AI development orchestrator runs independently on a controlled VPS.

The coding agent does not need production deployment credentials to perform normal development.

Target development flow:

```text
Instruction
  ↓
AI Orchestrator
  ↓
Read repository docs
  ↓
Create isolated branch/worktree
  ↓
Implement
  ↓
Lint / tests / build
  ↓
Commit
  ↓
Pull Request
  ↓
Human review / approval
  ↓
Merge
  ↓
Existing deployment process
```

## 15. AI Orchestrator Boundary

The VPS orchestrator should be model-provider independent. It may route a task to Claude, OpenAI or another approved coding model while GitHub documentation remains the durable project context.

Recommended components:

- task intake (initially dashboard/CLI; n8n/WhatsApp may be added)
- task classifier/risk level
- repository manager
- isolated worktree/container
- model adapter
- command runner with allowlists/timeouts
- test/build validator
- Git commit/PR publisher
- audit/task log
- human approval gate

## 16. AI Sandbox and Permissions

Default coding workspace:

Allowed:
- repository source
- repository documentation
- development/test environment values
- branch/PR creation
- lint/test/build commands

Not available by default:
- production DB service key
- production payment secrets
- unrestricted VPS root credentials
- direct `main` push
- automatic production deployment

Higher-risk tasks may receive temporary narrowly scoped capabilities only after explicit approval.

## 17. Migration Strategy

Refactor in slices:

1. Document and protect current behavior.
2. Add tests/validation around critical paths.
3. Extract one shared business rule/domain service at a time.
4. Update callers to use the shared service.
5. Remove obsolete duplicate logic only after validation.
6. Avoid simultaneous broad rewrites of payment, auth, POS and order flows.

## 18. Architecture Decision Rule

Major changes such as replacing Supabase, changing payment architecture, replacing authentication/session strategy, or performing a full framework rewrite require an explicit Architecture Decision Record (ADR) and human approval before implementation.
