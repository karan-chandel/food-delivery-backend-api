# 🍔 Hungry-Hub — Architecture Overview

**Location:** `docs/ARCHITECTURE.md`

## 🔧 System components

- **Clients**: Web/mobile apps (React / React Native) connect to REST API + Socket.io for realtime updates.
- **API Server**: Node.js + Express app (entry: `server.js`, app: `app.js`) exposing REST endpoints and initializing Socket.io.
- **Realtime**: Socket.io instance (admin UI enabled via `@socket.io/admin-ui`) for live order status, rider updates, and dashboard events.
- **Persistence**: MongoDB (access via Mongoose models in `models/`).
- **File Storage**: Local `uploads/` (paths: `uploads/menu-items/`, `uploads/riders/`, `uploads/admin/`). Consider S3/GCS for production.
- **Background/Extras**: Notification utilities (`utils/notificationHelper.js`), ticketing utilities, Twilio for OTP/SMS.

---

## 🏛️ High-level architecture (ASCII)

```
+-------------+     HTTPS/WS     +------------------+     +-----------+
|  Clients    | <--------------> | Express Server   | <-->| MongoDB   |
| (Web/Mobile)|                   | (REST + Socket)  |     | (Atlas)   |
+-------------+                   +------------------+     +-----------+
       |                                  |
       |                                  +--> Local Storage (`uploads/`)
       |                                  |
       |                                  +--> 3rd-party (Twilio, Maps API)
       |
       +--> Optional: CDN / Image Storage (S3)
```

---

## 🔁 Typical request flows

1. **Order placement**
   - Client POST `/api/v1/orders` -> Server validates, calculates totals -> create `Order` document -> clear user's cart -> emit socket events to `restaurant_{id}`, `user_{id}`, `riders_room` -> create notifications.

2. **Rider live location**
   - Rider client emits location via Socket.io -> server updates `Order.riderLocation` and emits to `user_{id}` and `restaurant_{id}`.

3. **File uploads**
   - Menu images are uploaded via multipart endpoints using `middlewares/upload.js` -> stored under `uploads/menu-items/` and served at `/uploads/...`.

---

## 🚀 Deployment & infra notes

- **Local / Dev**: Run via `npm run dev` (nodemon), ensure `.env` with `MDB_URI`, `PORT`, `JWT_SECRET`, `TWILIO_*`.
- **Containerization**: Add a multi-stage `Dockerfile` and `docker-compose.yml` for local testing. Mount `uploads/` as a volume or switch to cloud storage in production.
- **Scaling**: Use horizontal scaling with stateless API servers; Socket.io requires sticky sessions or a message broker (Redis adapter) when scaling multiple instances.
- **Monitoring**: Add structured logs, request IDs, and APM (Datadog / NewRelic) in production.

---

## 🔒 Security & hardening quick checklist

- Validate and sanitize all user inputs (use `validator` where possible).
- Enforce strict MIME/type checks for uploads and size limits.
- Use rate limiting (e.g., `express-rate-limit`) for auth and sensitive endpoints.
- Ensure JWT tokens have sensible expiration and refresh strategy.
- Tighten CORS (reduce to allowed origins) instead of wildcard.
- Move sensitive config to secrets manager in production (Azure KeyVault / AWS Secrets Manager).

---

## ✅ Next steps (short)
- Finalize OpenAPI spec (`docs/openapi.yaml`).
- Create `Dockerfile` + `docker-compose.yml` and a deployment guide (pick cloud provider).
- Add CI workflow to run tests and lint on PRs.

*This file is an initial design; we can convert the ASCII diagram to Draw.io/SVG if you prefer a visual diagram.*
