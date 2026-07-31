# 📋 Prioritized Task Backlog — Initial Sprint

**Location:** `docs/TASK_BACKLOG.md`

## Priority: High

1. **Package cleanup & dependency hygiene** (0.5d)
   - Remove `cookie-parse` typo, decide between `bcrypt` vs `bcryptjs`, update `package.json`, run `npm install`.
   - Files: `package.json`
   - Acceptance: `npm start` and `npm run dev` run correctly; no unused packages in `package.json`.

2. **Harden file uploads (images only for menu items)** (1d)
   - Restrict `middlewares/upload.js` to images only (jpeg/png/webp) for menu items; create separate endpoint for docs if needed.
   - Add tests to assert mime-type rejection and size limit.
   - Files: `middlewares/upload.js`, `routes/menu.js`, `tests/upload.test.js`.

3. **OpenAPI spec for core endpoints** (1.5d)
   - Expand `docs/openapi.yaml` to include all endpoints, response examples, and error schemas.
   - Files: `docs/openapi.yaml`

4. **Order creation tests (unit & integration)** (2d)
   - Validate subtotal/total calculation, route building, socket emits (mock `io`).
   - Files: `routes/order.js`, `tests/order.test.js`.

5. **Add CI (GitHub Actions)** (1d)
   - Run lint, tests, and basic build on PRs and main merges.
   - Files: `.github/workflows/ci.yml`

## Priority: Medium

6. **Dockerfile & docker-compose** (1d)
   - Multi-stage Dockerfile, compose with MongoDB for local and volume for `uploads/`.
   - Files: `Dockerfile`, `docker-compose.yml`

7. **Rate limiting and CORS tightening** (1.5d)
   - Implement `express-rate-limit`, configure allowed origins in `middlewares/cors.js`.
   - Files: `middlewares/cors.js`, `server.js`.

8. **Add health checks & readiness endpoints** (0.5d)
   - Add `/healthz` and readiness endpoints for orchestration.
   - Files: `app.js`

## Priority: Low

9. **Observability & structured logging** (1d)
   - Switch to structured logs, add request-id middleware, setup sample APM config.

10. **Docs & CONTRIBUTING.md** (0.5d)
    - Add `CONTRIBUTING.md`, `ISSUE_TEMPLATE.md`, and `PR_TEMPLATE.md`.

---

If this looks good, I can start implementing the top-priority tasks and open PRs with descriptive commit messages and tests.
