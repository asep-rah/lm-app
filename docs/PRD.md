# LM App — Product Requirements Document

**Status:** TO-BE v0.1 — approved baseline  
**Date:** 2026-09-18  
**Product:** Laundrivery / LM App  
**Scope:** Multi-outlet laundry operations platform

## 1. Product Vision

LM App is the operational system of record for an end-to-end multi-outlet laundry business. It connects customer ordering, pickup and delivery, outlet/POS operations, production, payments, customer service, CRM/loyalty, finance, and management analytics in one platform.

The product must evolve incrementally from the current application. A full rewrite is not the default strategy.

## 2. Primary Objectives

1. Provide one traceable order journey from customer request through completion.
2. Standardize operational rules across outlets and user portals.
3. Keep financial and payment operations auditable and resistant to accidental manipulation.
4. Support internal drivers and third-party delivery providers.
5. Give management a control-tower view of operational, customer, and financial health.
6. Make the repository safe and understandable for AI-assisted development without making any AI model the source of business truth.

## 3. Users and Portals

| User / Role | Primary Surface | Main Purpose |
|---|---|---|
| Customer | `/customer/*` | Order, location, payment, tracking, history, loyalty, profile |
| Cashier / Outlet Crew | `/pos/*` | POS transaction, production queue, cash/closing, outlet operations |
| Customer Service | `/cs/*` | Live chat, pickup dispatch, complaint handling, payment support |
| Driver | `/driver/*` | Attendance, pickup/delivery jobs, navigation, proof |
| Owner / Management | `/owner/*` | Finance, approvals, employees, settings, CRM, KPI, system health |
| Investor / Supervisor / Finance / Admin Ops | Role-dependent management surfaces | Reporting, supervision, approvals, finance and operational controls |

Role authorization must be explicit and enforced server-side for sensitive operations.

## 4. Core Product Domains

LM App consists of the following product domains:

- Customer and CRM
- Order Management
- Outlet and Capacity
- Dispatch and Delivery
- Driver Management
- POS
- Production Queue and Quality Control
- Payment and Deposit
- Loyalty and Promotion
- Customer Service and Complaint Management
- Expense, Requisition and Approval
- Finance and Accounting Reports
- Owner / Management Control Tower
- Notifications
- Audit and System Health
- Analytics and AI Insights

## 5. Canonical Customer Journey

Target journey:

`Customer → Order → Outlet Selection → CS/Dispatch → Pickup → Outlet/POS → Production → QC → Ready → Delivery → Customer → Review/Loyalty`

Every significant transition must be traceable. Interfaces may present friendlier labels, but the underlying lifecycle must use a controlled status model defined in `BUSINESS_RULES.md`.

## 6. Functional Requirements

### 6.1 Customer and Order

The customer must be able to create and review an order, provide a service address and coordinates, select supported service/payment options, and see meaningful order/payment status. The system should recommend or assign an appropriate outlet using configured operational rules such as service coverage, opening status, distance, and capacity.

### 6.2 Dispatch and Driver

CS must be able to manage pickup/delivery demand and assign eligible internal drivers. Internal drivers must be on duty and valid for the relevant operational context. When an internal driver is unavailable, the system may use an approved third-party provider. Delivery providers should be abstracted behind a common delivery/dispatch domain rather than scattering provider-specific rules across UI components.

### 6.3 POS and Production

POS is responsible for outlet transaction processing and operational handoff. Conversion from pickup to POS must be protected from duplicate claims. Production must provide a traceable queue and controlled stage progression. Quality control becomes an explicit target stage before an order is ready for delivery.

### 6.4 Payments

Existing hardened payment behavior is a protected domain. QRIS/gateway confirmation, deposit mutation, manual verification, reconciliation, idempotency, audit trails and soft-void behavior must not be weakened during refactoring.

Payment providers must be encapsulated so that changing or adding a gateway does not require rewriting all customer/POS workflows.

### 6.5 CRM and Loyalty

Customer history, profile, tier, points/rewards and retention activity should be derived from authoritative transaction/customer data. Loyalty configuration should be centralized and configurable by authorized management users.

### 6.6 Finance

Financial reports must use controlled account/category mappings and exclude void transactions according to approved accounting rules while preserving the original records and audit trail. Destructive deletion of financial transactions is prohibited as a normal operational workflow.

### 6.7 Management Control Tower

Management should have a consolidated view of revenue, orders, pickup, production, delivery, complaints, cash/payment issues and outlet health. Management analytics should support drill-down to the underlying operational evidence.

### 6.8 AI Analytics

AI may summarize, detect patterns and recommend investigation or action. AI must not autonomously alter financial records, payment status, production data, user permissions or other critical production state unless a separately approved and auditable automation explicitly permits that action.

## 7. Architecture Requirements

Business rules must not exist only inside UI components. Target layering:

`UI → API / Server Boundary → Domain/Service Layer → Business Rules → Data Access → Supabase/Postgres`

Shared concepts such as service definitions, price calculation, SLA, order statuses, role permissions, payment states and delivery-provider behavior require a single source of truth.

## 8. Non-Functional Requirements

- Mobile-first PWA experience for operational roles where appropriate.
- Server-side enforcement for privileged operations.
- Auditability for money, permissions and destructive/override actions.
- Idempotent processing for payment and other retry-prone external events.
- Observable failures through system-health/error logging.
- Database migrations must be reviewable and reversible where practical.
- No production secret may be committed to the repository.
- Critical pages should avoid unbounded all-time queries and eager loading of large media.
- The system should degrade predictably when external providers are unavailable.

## 9. Development Strategy

Development follows incremental refactoring rather than a ground-up rewrite:

1. Protect working payment/finance controls.
2. Centralize business rules and lifecycle definitions.
3. Reduce business logic embedded in UI.
4. Introduce domain/service boundaries progressively.
5. Add automated validation around critical workflows.
6. Improve management visibility and operational automation.

## 10. AI-Assisted Development Requirements

GitHub is the durable source of project context. Before modifying code, an AI coding agent must read this PRD plus `BUSINESS_RULES.md`, `ARCHITECTURE.md`, `SECURITY_AND_MAINTENANCE.md`, and relevant existing documentation.

AI agents work through isolated branches and pull requests. They must not push directly to `main` or deploy production by default.

Risk levels:

| Level | Typical Change | Minimum Gate |
|---|---|---|
| L1 | Copy / small UI | PR |
| L2 | Feature / workflow | PR + validation/tests |
| L3 | API / database / shared business rule | PR + explicit technical review |
| L4 | Payment / auth / finance / security | Mandatory human approval and targeted testing |

## 11. Protected Invariants

The following must remain true unless the product owner explicitly approves a documented design change:

- Financial records are not silently hard-deleted.
- Payment confirmation cannot be trusted solely from client state.
- Deposit mutations are controlled server-side.
- Manual payment overrides are authorized and audited.
- External payment events are safe to retry/idempotent.
- AI cannot invent business rules or new canonical statuses.
- Production secrets do not belong in source control.
- Critical changes require review before production.

## 12. Success Criteria

LM App v2 is successful when operational teams can follow one consistent lifecycle, management can identify exceptions quickly, critical financial operations remain auditable, business rules are centralized, and an AI coding agent can safely understand and extend the system from repository documentation without depending on one specific model/provider.

## 13. Related Documents

- `docs/MANUAL_BOOK.md` — current operational/user documentation
- `docs/BUSINESS_RULES.md` — canonical domain rules and lifecycle constraints
- `docs/ARCHITECTURE.md` — target technical architecture
- `docs/SECURITY_AND_MAINTENANCE.md` — security and operational maintenance
- `AGENTS.md` — mandatory instructions for coding agents
