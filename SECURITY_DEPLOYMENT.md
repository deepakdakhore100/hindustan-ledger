# Hindustan Ledger – Phase 2 security and deployment

Code is on the `feature/pipes-inventory-bbq-pos` branch (draft PR #1). **Do not merge or expose publicly before security and integration testing.**

## Current implementation
- Passwords use scrypt with per-user random salts. No default passwords or staff accounts are seeded.
- Login uses a random 256-bit token; only its SHA-256 hash is stored in PostgreSQL. Sessions expire after 12 hours. Cookies use HttpOnly, SameSite=Strict; Secure in NODE_ENV=production.
- Roles: OWNER (all businesses), ADMIN (assigned business), OPERATOR (assigned business), KITCHEN (assigned business).
- Accounting requires OPERATOR or higher to modify ledgers/vouchers. POS kitchen status may be changed by KITCHEN or higher for the assigned restaurant.
- Cross-organization access is blocked in both accounting APIs and manufacturing/POS routes. Same-origin enforcement for mutation requests.
- Manual login throttling on the Node process (10 failed attempts / 15 minutes). Deploy behind a network rate limit for multiple instances.

## Neon schema
Connected Neon project database: `hindustan_ledger`.
Authentication migration `sql/auth.sql` has been applied: `app_users`, `app_user_roles`, `app_sessions`.
No user logins, owner passwords or test transactions were created.

## Deploy/test steps
1. Install Node.js 20+ and run `npm ci` if a lockfile exists; otherwise `npm install`.
2. Configure secure `DATABASE_URL` for Neon database `hindustan_ledger` as a hosting environment variable; **never** paste credentials into GitHub or chats. Configure `NODE_ENV=production` and HTTPS before allowing real logins.
3. Execute `sql/auth.sql` (idempotent) on any additional deployment database.
4. Provision one owner via environment variables `ADMIN_USERNAME` and `ADMIN_PASSWORD` (14+ characters), then `npm run create-owner`. Remove the plaintext environment password immediately.
5. Provision staff with `STAFF_USERNAME`, `STAFF_PASSWORD`, `STAFF_ORGANIZATION` (Hindustan Pipes / BBQ Pav Bhaji Chain), `STAFF_ROLE` (ADMIN / OPERATOR / KITCHEN), then `npm run create-staff`. Remove the password environment variable after use. Do not run the script twice with the same username.
6. Run `npm test`. Additional HTTP integration and cross-organization security tests against a separate test database are still needed.
7. Test logins at `/login.html`, accounting at `/`, operations at `/operations.html`. Verify login failure, logout, role denial, CSRF denial, and POS/production transactions.

## Go-live limitations
- No working hosting deployment or end-to-end runtime smoke test verified here. Hosting account connection is not available.
- Existing accounting frontend renders user-input strings via innerHTML. **Stored XSS risk remains** and requires sanitization before deployment.
- There is no refresh/revoke-all session UI, audit trail for user access, or password reset flow; session limiter is process-local rather than distributed.
- Existing business features need GST, receipt/invoice, real Zomato integration, manufacturing quality checks, recipe review and dispatch support.
- Original accounting APIs were preserved as closely as possible; their DB flows require full compatibility/regression testing.
- A fork may be public. Do not add credentials, customer records or commercial private data to the repository.
