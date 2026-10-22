# Staging validation — 2026-10-22

Neon project `neon-gray-notebook`, database `hindustan_ledger`, isolated branch `staging-hindustan-integration-20261022`.

SQL-level tests completed on the isolated branch only:
- POS: item priced at INR 125, quantity 2, order INR 250. Order changed NEW -> PREPARING -> READY; totals reconciled.
- Pipes: 300mm plain batch, quantity 3, test cement recipe 2 per pipe. Cement stock changed 50 -> 44 and the warehouse lot has 3 pipes after stage transitions.

These tests validate database operations, not end-to-end application HTTP routes. Test prices and recipes are illustrative, not approved manufacturing parameters. Main Neon branch was not modified by these tests.

Railway connection was verified but project creation failed: `Deploys have been paused due to an upstream issue`. No live deployment has been confirmed.

To deploy when available: create a private Railway staging project sourcing `jaykahate78/hindustan-ledger`, branch `feature/pipes-inventory-bbq-pos`; configure Neon staging `DATABASE_URL` as an encrypted hosting variable, and run application integration tests and security review before production use. No secrets belong in GitHub.
