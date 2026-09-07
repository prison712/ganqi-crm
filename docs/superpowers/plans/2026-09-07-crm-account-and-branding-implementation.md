# CRM Account and Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add self-service password changes, super/sub-admin identities, editable and soft-deletable sales accounts, and CRM company branding without changing existing customer workflows.

**Architecture:** Extend the existing SQLite `users` row with backward-compatible flags instead of changing the established `admin`/`sales` role contract. Keep all authorization and transactions in Express, expose only public user fields, and adapt the existing React account page and layout rather than introducing a new UI framework.

**Tech Stack:** Node.js, Express, node:sqlite, bcryptjs, JWT, React, React Router, Ant Design, Vitest, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-07-crm-account-and-branding-design.md`

## Global Constraints

- Perform all work directly in `D:\codex项目\crm-full`; do not create or suggest a git worktree.
- Preserve the existing `admin` and `sales` role values and all customer, follow-up, Excel, dashboard, logging, and document behavior.
- Enforce every authorization rule on the backend; frontend visibility is presentation only.
- Migrate existing SQLite databases automatically and idempotently.
- Keep the existing deep-blue/orange theme and mobile layout.
- The current `.git` pointer is invalid, so commits are deferred; do not access the old worktree path.

---

### Task 1: Backward-compatible user identity and password rules

**Files:**
- Create: `server/src/users/validation.js`
- Modify: `server/src/db.js`
- Modify: `server/src/modules/auth.js`
- Modify: `server/src/middleware/auth.js`
- Modify: `server/test/helpers.js`
- Test: `server/test/auth-users.test.js`

**Interfaces:**
- Produces `validateUsername(value)`, `validateDisplayName(value)`, and `validatePassword(value)` which return normalized values or throw Chinese `AppError` responses.
- Produces public user fields `isSuperAdmin` and keeps `role` compatible.

- [ ] Add failing tests proving the initial administrator is super admin, all logged-in roles can change passwords, and letter/number password rules reject weak values.
- [ ] Run `npm --workspace server test -- auth-users.test.js` and confirm failures are caused by missing fields/rules.
- [ ] Add idempotent `is_super_admin`, `deleted_at`, and `deleted_by` migrations; promote the oldest existing admin only when no super admin exists.
- [ ] Extract shared account validators and apply the password validator to password changes.
- [ ] Exclude deleted users from login and authentication; expose `isSuperAdmin` safely.
- [ ] Re-run the focused server tests and confirm they pass.

### Task 2: Administrator child accounts and backend permission enforcement

**Files:**
- Modify: `server/src/modules/users.js`
- Modify: `server/test/helpers.js`
- Test: `server/test/auth-users.test.js`

**Interfaces:**
- `POST /api/users` accepts `{ username, displayName, password, role?: 'sales'|'admin' }`.
- `GET /api/users` returns active, non-deleted account records with `role` and `isSuperAdmin`.
- Only `req.user.is_super_admin` may create an `admin` account.

- [ ] Add failing tests for super-admin child creation, child-admin use of ordinary admin APIs, and rejection when a child admin creates another admin.
- [ ] Run the focused server tests and confirm the expected authorization failures.
- [ ] Extend account creation and listing with backend-only super-admin enforcement and safe public fields.
- [ ] Use the shared username/display-name/password validators and preserve duplicate username errors.
- [ ] Re-run the focused tests and confirm all administrator cases pass.

### Task 3: Sales editing and transactional soft deletion

**Files:**
- Modify: `server/src/modules/users.js`
- Test: `server/test/auth-users.test.js`

**Interfaces:**
- `PATCH /api/users/:id` accepts `{ username, displayName }` for non-deleted sales users.
- `DELETE /api/users/:id` soft-deletes only sales users, releases all owned customers, and writes `release` plus `account_deleted` logs in one transaction.

- [ ] Add failing tests for login-name editing, duplicate-name rejection, sales-only deletion, login denial after deletion, released customers, preserved follow-ups, and retained audit rows.
- [ ] Run the focused server tests and confirm failures reflect missing edit/delete behavior.
- [ ] Implement username editing and transactional soft deletion without physically deleting user rows.
- [ ] Guard edit/reset/toggle/delete routes against deleted accounts and non-sales targets.
- [ ] Re-run the focused tests and confirm they pass.

### Task 4: Personal-center password UI and account-management UI

**Files:**
- Create: `client/src/components/PasswordChangeModal.jsx`
- Modify: `client/src/layout/AppLayout.jsx`
- Modify: `client/src/pages/UsersPage.jsx`
- Modify: `client/src/pages/OperationLogsPage.jsx`
- Modify: `client/src/pages/DashboardPage.jsx`
- Test: `client/src/test/auth-routing.test.jsx`
- Test: `client/src/test/admin-pages.test.jsx`

**Interfaces:**
- `PasswordChangeModal` accepts `{ open, forced, loading, onSubmit, onCancel }`.
- Account UI sends the server interfaces from Tasks 2 and 3 and never treats hidden buttons as permission enforcement.

- [ ] Add failing component tests for the personal-center entry, shared password validation, role tags, super-only administrator creation, editable sales username, and delete confirmation.
- [ ] Run the focused client tests and confirm missing UI behavior causes the failures.
- [ ] Extract the current forced password form into the reusable modal and add a right-header personal-center entry for every user.
- [ ] Expand account management for role-aware creation, username editing, identity tags, and high-risk soft-delete confirmation.
- [ ] Add `account_deleted` labels to logs and dashboard activity.
- [ ] Re-run the focused client tests and confirm they pass.

### Task 5: CRM copy and company logo assets

**Files:**
- Create: `client/public/company-logo.png` from the user-provided source image.
- Modify: `client/index.html`
- Modify: `client/src/pages/LoginPage.jsx`
- Modify: `client/src/layout/AppLayout.jsx`
- Modify: `client/src/styles.css`
- Modify: `server/src/server.js`
- Modify: `README.md`
- Modify: `用户操作说明书.md`
- Test: relevant client tests from Task 4.

**Interfaces:**
- `/company-logo.png` is the single deployable logo URL for favicon, login branding, and sidebar branding.

- [ ] Add failing UI assertions for CRM title/brand text and semantic logo images.
- [ ] Run the focused client tests and confirm existing ERP/G output fails them.
- [ ] Copy the supplied logo into `client/public`, reference it from the login screen, sidebar, and favicon, and add responsive `object-fit: contain` styling.
- [ ] Replace user-visible ERP product copy with CRM while leaving database/API semantics unchanged.
- [ ] Re-run focused tests and search source for remaining user-visible ERP text.

### Task 6: Full regression, production build, and runtime verification

**Files:**
- Modify only files needed to correct regressions discovered by the commands below.

**Interfaces:**
- Existing start commands and API routes remain compatible.

- [ ] Run `npm test` and require zero failing server or client tests.
- [ ] Run `npm run build` and require a successful Vite production bundle.
- [ ] Confirm the development server is listening on ports 5173 and 3001 and request the login page plus protected API boundary.
- [ ] Verify the login page has visible content, no framework error overlay, CRM copy, and the company logo; verify key authenticated flows if a valid test credential is available without changing production data.
- [ ] Review all requirements against the design and produce the exact changed-file list plus any environmental limitation.
