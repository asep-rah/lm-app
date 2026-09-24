# LM App (Laundrivery)

Operational system of record for an end-to-end multi-outlet laundry business. LM App connects customer ordering, pickup and delivery, outlet/POS operations, production, payments, customer service, CRM/loyalty, finance, and management analytics in one platform.

This is the development entry point. For product direction read `docs/PRD.md`; for canonical business rules read `docs/BUSINESS_RULES.md`; for target architecture read `docs/ARCHITECTURE.md`.

## Main User Portals

The application is a mobile-first Progressive Web App (PWA) with role-oriented surfaces:

| Portal | Primary routes | Users |
|--------|----------------|-------|
| Customer | `/customer/*` | Customer / member |
| POS / Cashier | `/pos` | Cashier / outlet crew |
| Customer Service | `/cs`, `/cs/workspace`, `/cs/dashboard`, `/cs/care` | CS Care, Head CS |
| Driver | `/driver` | Internal couriers |
| Owner / Management | `/owner`, `/owner/reports`, `/owner/system-health` | Owner, finance, supervisor |
| Other management | `/investor`, `/admin`, `/history`, `/aktivitas`, `/workspace` | Role-dependent management surfaces |

Authorization must be explicit and enforced server-side for sensitive operations. UI visibility is not authorization.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend / API | Next.js App Router + TypeScript (React 19) |
| Styling | Tailwind CSS + daisyUI |
| Database & Realtime | Supabase (Postgres + RLS + Realtime) |
| Payments | Mayar (QRIS) webhook + polling + cron |
| Maps / Location | Leaflet + Nominatim; Google Maps deep links / outlet rating |
| Push Notifications | Web Push (VAPID) |
| AI features | Gemini / OpenAI via `@google/genai` and server routes |
| Deploy / Scheduling | Vercel (+ cron in `vercel.json`) |

Exact dependency versions are pinned in `package.json` (`package-lock.json` is committed).

## Repository Structure

```
app/                 Next.js App Router pages (portals) and API routes (app/api)
components/          Reusable React UI components, grouped by portal/domain
lib/                 Shared application logic, domain services, payment/finance helpers
utils/               Small cross-cutting helpers (printing, CSV, SLA evaluator)
scripts/             Standalone scripts (e.g. finance backfill dry-run)
supabase/migrations/ Reviewed SQL migrations (order matters; see docs)
docs/                Product and operational documentation (see below)
public/              Static assets, PWA manifest/icon, service worker
vercel.json          Vercel cron schedules
docker-compose.yml   Optional external Evolution API messaging sidecar (not the LM app runtime)
```

## Local Development Prerequisites

- Node.js and npm. The repository does **not** pin a Node version (`package.json` has no `engines` field), so verify against the Next.js version in use (`next@16.3.0`).
- Access to a Supabase project (URL, anon/public key, and — for server-side/privileged routes — the service-role key). Migrations live in `supabase/migrations` and must be applied in order; see `docs/SECURITY_AND_MAINTENANCE.md`.
- For features that hit live providers (Mayar QRIS, Google maps, push, AI), the matching provider keys. Most are optional for a basic local run, but see below.

## Local Setup

**Uncertainty:** the repository contains **no** `.env.example` or committed env sample (all `.env*` files are gitignored). Secrets and Supabase project values must be obtained from the team / project configuration. The production env checklist is documented in `docs/SECURITY_AND_MAINTENANCE.md` §1 and `docs/MANUAL_BOOK.md` §5.3; many of those variables are also the ones read by the code.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local env file (e.g. `.env.local`) with at minimum the Supabase values the app reads, for example `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, plus `SUPABASE_SERVICE_ROLE_KEY` for server-side routes. Do not invent values; source them from a real Supabase project.

3. Run the development server:

   ```bash
   npm run dev
   ```

   The app serves on the Next.js default port (`http://localhost:3000`), which is also the fallback app URL used in several routes.

4. Optional: a mock-payment flag (`NEXT_PUBLIC_ENABLE_MOCK_PAYMENTS` / `ENABLE_MOCK_PAYMENTS`) exists in `lib/mayar.ts` for local testing without a live gateway.

Notes:

- Payment, deposit, manual mark-paid, resync and diagnosis endpoints enforce a `PAYMENT_OPS_SECRET` / `CRON_SECRET`-style ops auth and fail hard in production without the service-role key. Do not rely on dev fallbacks for production behavior.
- The source contains some hardcoded dev fallback credentials. The security docs list rotating previously committed publishable keys as a roadmap item; production must use real secret values, never these fallbacks.

Do not run destructive database commands or production migrations locally.

### Validation Scripts (`package.json`)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run start` | Serve a production build |
| `npm run lint` | ESLint |
| `npm test` | Node unit tests (finance recognition/statements via tsx) |
| `npm run finance:paid-at-dry-run` | Finance backfill dry-run script |

## Required Documentation

Read these before modifying code (AI coding agents **must** read at least the first five):

1. `docs/PRD.md` — product requirements, vision, risk levels (L1–L4)
2. `docs/BUSINESS_RULES.md` — canonical business invariants and order lifecycle
3. `docs/ARCHITECTURE.md` — target layering and architectural constraints
4. `docs/SECURITY_AND_MAINTENANCE.md` — env requirements, SQL/migrations, daily safety
5. `docs/MANUAL_BOOK.md` — current operational behavior (portals, workflows, troubleshooting)
6. `docs/payment-security-cron.md` — payment verification/cron/reconciliation details (required for payment work)
7. `AGENTS.md` — mandatory instructions for coding agents (mirrored by `CLAUDE.md`)

## Development Workflow

Standard flow (do not push directly to `main`):

```text
branch/worktree → make the smallest coherent change → local validation
→ lint/tests/build → pull request → human review → merge
```

Risk levels and minimum gates (from `docs/PRD.md` §10):

| Level | Typical Change | Minimum Gate |
|-------|----------------|--------------|
| L1 | Copy / small UI | PR |
| L2 | Feature / workflow | PR + validation/tests |
| L3 | API / database / shared business rule | PR + explicit technical review |
| L4 | Payment / auth / finance / security | Mandatory human approval + targeted testing |

## High-Risk Changes Require Extra Review

Payment verification/webhooks/reconciliation, deposit and customer balance, authentication/authorization/passwords, finance/accounting/void, production database migrations, and secrets/deployment credentials are **protected areas** (see `AGENTS.md`). Changes there:

- require explicit human review;
- must preserve existing security, idempotency and audit guarantees;
- use reviewed, reversible migrations with documented data/backfill impact;
- must not remove audit/idempotency protection, hard-delete financial records, or weaken soft-void behavior.

If a requested change conflicts with `docs/BUSINESS_RULES.md`, surface the conflict rather than silently bypassing the rule.

## Do Not Commit Secrets

Never commit secrets, tokens, passwords, production credentials, the `SUPABASE_SERVICE_ROLE_KEY` (or equivalent privileged keys), or the ops/cron secrets to the repository. Production secrets belong in deployment/VPS secret management or env configuration only. If a secret appears in Git history, treat it as compromised: rotation, not just removal from the current file, is the required remediation.

## Related Documents

- `docs/payment-security-cron.md`
- `docs/sql/VERIFY_AFTER_RESET.md`