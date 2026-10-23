# Hindustan Group — PPT Implementation Tracker

Based on `Hindustan Pipes architecture design.pdf` supplied by the client, slides 1–12.

## Code implemented in development branch
- 3 separate organization records in Neon **staging**: Hindustan Pipes, BBQ Pav Bhaji Chain, Hindustan Graphics. Hindustan Graphics still needs expense/inventory setup.
- Accounting foundation: separate organizations, accounts, vouchers, balances and authenticated access.
- Pipe 300/450/600 mm plain/socket catalog, raw stock and inventory movements.
- Factory-approved per-pipe recipe API/UI and transactional material consumption.
- Pre-casting production jobs: iron fabrication, precast setup, die filling, casting complete, transition audit notes, optional machine/die reference.
- Completed fabrication jobs can create dry-curing batches with transactional inventory deduction.
- Curing requires >=24 hours before underwater stage and >=120 hours underwater before READY; explicit staff-confirmed quality acknowledgement. Final technical sign-off process is not yet implemented.
- Warehouse zones and **manually generated** unique lot bundles: 300mm×3, 450mm×2, 600mm×1, partial bundles labelled.
- Paving block and jointer SKU catalog; inventory stock movements are pending.
- Factory analytical API/UI: staged pipe quantity by diameter/end type, warehouse zone totals, weekly and monthly material consumption, fabrication job stage totals.
- BBQ menu, multi-item order, ticket pipeline NEW/PREPARING/READY/COMPLETED, manual online entry, opt-in kitchen sound and polling alerts.
- Responsive web application and basic PWA manifest/service worker (network-first, no sensitive data cached).
- Unit and security test suites in GitHub CI; isolated SQL scenarios done on staging, **not** full browser E2E.

## Still required before a customer production launch
1. Verify recipes/bowl units and material usage and record client/supervisor acceptance; advanced adjustments for actual consumption and scrap.
2. End-to-end iron fabrication/gauge-wise material consumption and physical QC approval by authorized named staff with audit trail.
3. Warehouse bundle lifecycle: dispatch, returns, reservations, receipts and reconciliation (bundle ID generation alone does not ship goods).
4. Finished-good stock ledger and production for paving blocks and jointers.
5. Factory procurement PO, detailed income/expense heads and automatic cross-module accounting posting, searchable reports.
6. BBQ receipt/KOT printing, payment reconciliation, tax treatment and final billing reports.
7. Zomato: live integration depends on official authorized partner access/credentials, callback validation and sandbox UAT; manual entry only for now.
8. Full verified user onboarding (Pipes: 2 admins + 1 operator, BBQ: 3–4) and scoped accounts for Graphics.
9. Installability and mobile UX testing; PWA assets are scaffolding, no native Android/iOS app.
10. Integration tests with an actual staging database, concurrency, backup/restore, security audit, load tests, data migration, training and client UAT.

## Deployment — do NOT use production DB
- GitHub `main` must remain unchanged; develop only on `feature/pipes-inventory-bbq-pos`.
- Isolated Neon staging branch: `staging-hindustan-integration-20261022` / `br-hidden-resonance-ahvj3ar4`.
- Apply additive `sql/ppt-expansion.sql` in staging before deploying this branch. Already applied to the isolated staging branch for development.
- Render staging service exists but its current build command includes one-time `npm run create-owner`. Restore to `npm install --no-audit --no-fund && npm test` first.
- Render DATABASE_URL was previously pointed at the **Neon main** database. Replace with staging Neon connection string and verify its branch/database via secure configuration; do not paste secrets into chat or GitHub.
- Staging currently needs initial owner user. Do not expose or test with production credentials.
- Never trigger Render deploy or merge until correct staging database URL and credentials are verified.

This file documents implementation state, not a promise of production readiness.
