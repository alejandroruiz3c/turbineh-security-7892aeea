# TurbineH Security

Domain security diagnostics with ownership verification, AI-assisted reporting,
PDF delivery and a Stripe payment flow. Built with TanStack Start, React,
TypeScript and Supabase Edge Functions.

## Status

This is the implementation repository. `turbineh-security` currently contains
only a project placeholder. This repository is connected to Lovable: preserve
the repository URL and published history until that integration is migrated.

Application code, 17 Edge Function entry points and 10 database migrations are
present. Local verification on 26 September 2026 passes frontend types/build,
all Edge Function type checks, 23 network-safety tests and two PDF/scoring tests.
ESLint reports no errors (six existing component-export warnings remain).
CI reproduces these checks without production credentials. This does not certify
live payments, ownership verification or delivery integrations.
The historical [launch checklist](docs/GO-LIVE.md) mixes mock and Stripe phases;
verify actual deployed settings before using it as an operations runbook.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/routes/` | Landing, verification, processing, reports and legal pages |
| `src/components/`, `src/i18n/` | UI and language support |
| `src/integrations/supabase/` | Browser and server clients |
| `supabase/functions/` | Diagnostics, verification, reports, payments, recovery and analytics |
| `supabase/functions/_shared/` | Fetch restrictions, scoring, quotas, rate limits and delivery helpers |
| `supabase/migrations/` | Database, access policies, quotas and payment state |
| `docs/GO-LIVE.md` | Historical deployment checklist; revalidate before launch |

## Local development

Use Bun with the committed `bun.lock` and `bunfig.toml`. The minimum package
release age is intentional; do not bypass it to make an install succeed.

```sh
bun install --frozen-lockfile
bun run dev
bun run lint
bun run typecheck
bun run test
bun run check:edge  # requires Deno 2
bun run test:edge
bun run build
```

Use a dedicated Supabase development project. Configure the public client values
used by `src/integrations/supabase/client.ts` through the existing Lovable/Vite
integration. Backend secrets belong in Supabase secrets, never in browser
variables: `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`, `RESEND_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET` and `IP_HASH_SALT`.
Other runtime settings are documented where each Edge Function reads them.
Use Stripe test mode for development; do not exercise live payment or email
recovery flows as a smoke test.

## Next engineering gates

- Integration tests for quota concurrency and paid-provider failure recovery.
- Integration tests for ownership verification, webhook idempotency and report access.
- Verify the hosted CI result before merging; local checks are not a hosted result.
- A current launch runbook separating implemented code from verified deployment state.

See [contribution guidance](CONTRIBUTING.md) and [security handling](SECURITY.md).
Public source visibility does not grant an open-source licence; no such licence
has been selected.
