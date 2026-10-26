# 🍔 ZEWITO PLATFORM — SYSTEM ARCHITECTURE & SCALING BLUEPRINT

**Location:** `FoodBE/docs/ARCHITECTURE.md`  
**System Version:** 2.0.0 (Decoupled Microservices Architecture)  
**Author:** Principal Engineering Team  

---

## 🏛️ 1. Architecture Overview: Microservices Fleet Topology

The Zewito Backend is structured as an **Enterprise 5-Service Microservices Architecture** orchestrated by a Central API Gateway:

```
                              ┌────────────────────────────────────────┐
                              │            Clients                     │
                              │  - Web Admin / Restaurant / Delivery   │
                              │  - Flutter Web & Mobile (Android/iOS)  │
                              └───────────────────┬────────────────────┘
                                                  │
                                                  ▼ (Port 8000)
                              ┌────────────────────────────────────────┐
                              │           zewito-api-gateway           │
                              │  (Central Routing, CORS, Keep-Alive)   │
                              └───────┬─────┬───────┬─────┬───────┬────┘
                                      │     │       │     │       │
                  ┌───────────────────┘     │       │     │       └───────────────────┐
                  ▼ (Port 4001)             ▼(5052) │     ▼ (5051)                    ▼ (Port 5050)
  ┌───────────────────────────────┐ ┌─────────────┐ │ ┌───────────────────────┐ ┌───────────────────────────────┐
  │    zewito-catalog-service     │ │zewito-auth- │ │ │zewito-logistics-servic│ │     zewito-order-service      │
  │   (`zewito-catalog-service`)  │ │service      │ │ │(Payout/Tracking Engine│ │          (`FoodBE`)           │
  ├───────────────────────────────┤ ├─────────────┤ │ ├───────────────────────┤ ├───────────────────────────────┤
  │ • Restaurant Discovery & Info │ │• Central IAM│ │ │• Realtime Redis GEO   │ │ • Order State Machine         │
  │ • Menus & Categories (Dishes) │ │• Rotatable  │ │ │• High-freq Geopings   │ │ • Socket.io Live GPS Tracking │
  │ • Restaurant Onboarding & KYC │ │  Tokens     │ │ │• Double-Entry Wallet  │ │ • Razorpay Payments & Ledgers │
  │ • Shopping Cart (CRUD)        │ │• SMSCloud   │ │ │• Distance Slabs Payout│ │ • Customer Order History      │
  │ • Restaurant Coupons          │ │  DLT Gateway│ │ └───────────┬───────────┘ └───────────────┬───────────────┘
  └───────────────┬───────────────┘ └─────┬───────┘ │             │                              │
                  │                       │         ▼ (5053)      │                              │
                  │                       │  ┌──────────────┐     │                              │
                  │                       │  │zewito-admin- │     │                              │
                  │                       │  │service       │     │                              │
                  │                       │  ├──────────────┤     │                              │
                  │                       │  │• Audit Logs  │     │                              │
                  │                       │  │• KYC Approval│     │                              │
                  │                       │  │• CRM Tickets │     │                              │
                  │                       │  └──────┬───────┘     │                              │
                  ▼                       ▼         ▼             ▼                              ▼
         [DB: zewito-catalog]      [DB: zewito-auth] [DB: zewito-admin] [DB: zewito-logistics]   [DB: food-delivery]
```

### Active Repositories in Production:
* **API Gateway (`zewito-api-gateway`) (Port 8000)**: Single entry point, CORS, and 9 AM - 6 PM IST Smart Anti-Sleep Heartbeat.
* **Catalog Service (`zewito-catalog-service`) (Port 4001)**: Restaurant discovery, KYC submissions, menus, and carts.
* **Core Order Engine (`FoodBE`) (Port 5050)**: Order state machine, payments, and real-time Socket.io dispatch rooms.
* **Auth & IAM (`zewito-auth-service`) (Port 5052)**: User registration, OTP generation/verification (SMSCloud), and JWT lifecycle.
* **Logistics & Tracking (`zewito-logistics-service`) (Port 5051)**: Rider GPS tracking, Redis geospatial index, and automated payouts.
* **Admin Governance (`zewito-admin-service`) (Port 5053)**: Partner verification approvals, customer support tickets, and audit trails.
* **Deprecated**: `FoodBE_Customer` (monolithic prototype; not deployed).

---


## 🔒 2. Security Audit & Vulnerability Hardening (Loophole Assessment)

To ensure bank-grade security, the following security layers are enforced and audited:

### 2.1 Defense-in-Depth Middleware Suite
1. **Security Headers (`middlewares/security.js`)**:
   - `X-Content-Type-Options: nosniff` (prevents MIME type spoofing).
   - `X-Frame-Options: SAMEORIGIN` (prevents clickjacking attacks).
   - `X-XSS-Protection: 1; mode=block` (legacy XSS filtering).
   - `Referrer-Policy: strict-origin-when-cross-origin`.
   - Stripping `X-Powered-By: Express` to hide runtime fingerprints.

2. **NoSQL Injection Sanitizer (`sanitizeObject`)**:
   - Recursively strips malicious operator keys (starting with `$` or containing `.`) from `req.body`, `req.query`, and `req.params`.

3. **Multi-Tier Rate Limiting**:
   - **Global Limiter**: 300 requests per 15-minute window per IP.
   - **OTP Limiter**: Strict 5 attempts per 5 minutes keyed on `IP + Phone Number` to prevent SMS pumping / OTP brute-force.

4. **Robust Cross-Origin Resource Sharing (CORS)**:
   - Dynamic regex matching for local development (`/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/`) to seamlessly support dynamic Flutter Web ports without wildcarding production origins.
   - Dynamic header reflection to avoid preflight drops on custom headers (`Accept`, `Authorization`, `X-Requested-With`).

---

### 2.2 Critical Vulnerabilities & Remediation Roadmap

| # | Vulnerability / Loophole | Risk Level | Threat Scenario | Remediation Status / Action |
|---|--------------------------|------------|-----------------|-----------------------------|
| 1 | **Client-Side WebSocket State Mutation** | 🔴 HIGH | Clients emitting raw `order_status_update` or `ui_payment_update` over WebSocket without database validation. | **Remediation**: Status mutations must only originate from verified REST endpoints (`PATCH /orders/:id/status`) and be broadcast via server `io.to()`. Disallow client-emitted mutations. |
| 2 | **In-Memory Rate Limiter in Multi-Instance** | 🟡 MEDIUM | `hits = new Map()` does not sync across horizontally scaled Node processes or PM2 cluster mode. | **Remediation**: Migrate from in-memory Map to `rate-limit-redis` backed by a shared Redis cluster. |
| 3 | **Socket.io Single-Node Memory Map** | 🟡 MEDIUM | Sockets stored in local process `connectedUsers = { customers: new Map() }`. If backend scales to 2+ instances, sockets on server A cannot message users on server B. | **Remediation**: Install `@socket.io/redis-adapter` so events publish across all cluster nodes. |
| 4 | **Inter-Service Timing Attack** | 🟡 MEDIUM | Direct string equality `secret !== INTERNAL_SERVICE_SECRET` leaks string character matching timing. | **Remediation**: Use `crypto.timingSafeEqual()` in `zewito-catalog-service/src/middlewares/internalAuth.js`. |
| 5 | **Double Order / Race Condition during Checkout** | 🔴 HIGH | Rapid concurrent POST requests to `/api/v1/orders` could place duplicate orders against a single cart. | **Remediation**: Use MongoDB atomic transactions (`session.withTransaction`) or a distributed Redis lock (`redlock`) keyed on `cart_${userId}` during order creation. |

---

## 📈 3. Scalability Roadmap: Zero-Loophole Production Architecture

To scale the platform to 100,000+ daily active users with 99.99% uptime:

```
[ DNS / Cloudflare WAF ]
          │
          ▼
[ Cloud Load Balancer (Nginx / AWS ALB) ] (SSL Termination)
          │
   ┌──────┴──────────────────────────┐
   ▼ /api/v1/customer/(menu|cart...) ▼ /api/v1/(orders|rider|auth...)
[ Catalog Service Cluster ]        [ Core Platform Cluster ]
(Node.js + PM2 on Port 4001)       (Node.js + PM2 on Port 5050)
   │                                 │
   ├──────────────────┬──────────────┤
   │                  │              │
   ▼                  ▼              ▼
[ Redis Cluster ]  [ MongoDB Atlas ] [ Cloudinary CDN ]
- Socket.io Adapter (Replica Set +   (Images & Documents)
- Shared Cache      Read Preference:
- Distributed Locks  secondaryPreferred)
```

### Key Scaling Pillars:
1. **Stateless API Processes**:
   - Zero file storage on local server disk (`/uploads`). All user uploads (menu items, rider documents, GST certificates) stream directly to Cloudinary or S3.
2. **Database Connection Pooling**:
   - Configure Mongoose connection pools: `maxPoolSize: 50, minPoolSize: 10, serverSelectionTimeoutMS: 5000`.
   - Add compound indexes for high-frequency queries:
     * `Order`: `{ customerId: 1, createdAt: -1 }`, `{ status: 1, restaurantId: 1 }`
     * `MenuItem`: `{ restaurantId: 1, isAvailable: 1 }`
3. **Socket.io Horizontal Scaling**:
   - Mount `@socket.io/redis-adapter`.
   - Enable sticky sessions on the load balancer for WebSocket handshakes.
4. **Environment Integrity**:
   - Production deployments MUST strictly enforce `NODE_ENV=production` and fail immediately if `JWT_SECRET`, `MDB_URI`, or `INTERNAL_SERVICE_SECRET` are missing or default fallback values.

---

## 🚀 4. Deployment & Ports Reference

| Service | Directory | Default Port | Primary Responsibilities |
|---------|-----------|--------------|--------------------------|
| **Core Platform** | `/FoodBE` | `5050` | Auth, Orders, Payments, GPS Sockets, Riders, Admin, Support |
| **Catalog Service** | `/zewito-catalog-service` | `4001` | Restaurants, Menus, Items, Cart, Coupons |
| **Admin Portal** | `/FoodFE/admin-portal-food` | `3000` | SuperAdmin & Operational Dashboard |
| **Restaurant Portal**| `/FoodFE/restaurent-portal`| `3001` | Merchant Menu & Order Acceptance UI |
| **Delivery Hub** | `/FoodFE/delivery-hub` | `3002` | Customer Web Portal |
| **Rider Portal** | `/FoodFE/rider-portal` | `3003` | Courier & Logistics Dispatch |
