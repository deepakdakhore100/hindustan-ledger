# Hindustan Operations MVP

Development branch: `feature/pipes-inventory-bbq-pos`. Accounting dashboard remains available at `/`; new operations UI is at `/operations.html`.

## Setup
1. Use the Neon database `hindustan_ledger` in the existing Neon project.
2. Apply `sql/operations.sql` to this database (schema was also applied to the connected Neon project during development).
3. Configure `DATABASE_URL` securely in the runtime environment; NEVER commit credentials.
4. Run `npm install` then `npm start`.
5. After secure authentication is implemented, browse `/operations.html`.

## Module workflow
- Pipes: set quantities for raw materials, define **client-verified** recipes through `PUT /api/operations/pipes/products/:id/recipe`, create batch, progress from dry curing to underwater curing to ready to warehouse. Warehouse lots associate batch and zone. Dry and water curing duration checks are **not yet automated**.
- Restaurant: create menu items, enter dine-in/takeaway/manual online orders, advance kitchen statuses NEW → PREPARING → READY → COMPLETED. Orders are not integrated with payment gateways, GST calculation, printers, or live Zomato API.

## Important limits / launch blockers
- **Do not deploy publicly**: existing accounting API and operations APIs have no authentication or role-based authorization. Organization access and data are not protected. Add authentication, staff roles, input escaping, access logging, and tests first.
- A production run deducts recipe materials transactionally; zero or insufficient stock blocks the batch.
- Recipes require factory confirmation. No manufacturing formulas are assumed or seeded.
- POS MVP UI supports one item per order; REST API supports multiple.
- No GST/tax engine, sale invoice generation, production dispatch, wastage/rejection, stock reconciliation, backups, automated tests, or user accounts yet.
- App uses the PostgreSQL `pg` client; hosting must support Node.js and provide the correct `DATABASE_URL`.
- Existing accounting behavior is preserved; no changes to current accounting tables were made.

## Verification
- Confirm DB tables with `SELECT table_name FROM information_schema.tables WHERE table_schema='public';`
- Verify application with an authenticated testing environment, a test database/branch, and representative fixtures before shipping.
