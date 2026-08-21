# 🍔 HUNGRY-HUB FOOD DELIVERY BACKEND - PROJECT ARCHITECTURE & BLUEPRINT

**Project Name:** Hungry-Hub Food Delivery Backend  
**Version:** 1.0.0  
**Type:** Real-time Food Delivery Management System  
**Framework:** Node.js + Express.js  
**Database:** MongoDB  
**Real-time Communication:** Socket.io  
**Author:** Karan Kumer-svg  

---

## 📋 TABLE OF CONTENTS

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [System Architecture](#system-architecture)
4. [Database Schema & Models](#database-schema--models)
5. [API Endpoints & Routes](#api-endpoints--routes)
6. [Real-time Features (Socket.io)](#real-time-features-socketio)
7. [Middleware Stack](#middleware-stack)
8. [File Structure & Organization](#file-structure--organization)
9. [Key Features](#key-features)
10. [Data Flow Diagrams](#data-flow-diagrams)
11. [Authentication & Authorization](#authentication--authorization)
12. [Deployment & Configuration](#deployment--configuration)

---

## 🎯 PROJECT OVERVIEW

Hungry-Hub is a comprehensive food delivery backend system that manages:

- **Customers:** Browse restaurants, place orders, track deliveries
- **Restaurants:** Manage menu items, accept/reject orders, track deliveries
- **Riders:** Accept delivery jobs, real-time GPS tracking, earning management
- **Admins:** System-wide monitoring, user management, ticket support
- **Super Admins:** Full system control, analytics, super-admin features

**Key Differentiators:**
- Real-time order tracking with live GPS coordinates
- Socket.io integration for instant updates
- Multi-role authentication system
- Support ticket system with role-based access
- Delivery route optimization
- Image upload management for menu items, riders, admins

---

## 🛠️ TECHNOLOGY STACK

### Backend Framework
```
├── Node.js Runtime
├── Express.js ^5.1.0 - HTTP server & routing
├── Socket.io ^4.8.1 - Real-time communication
└── Morgan ^1.10.1 - HTTP request logging
```

### Database & ORM
```
├── MongoDB - NoSQL database
├── Mongoose ^8.19.1 - MongoDB object modeling
└── Connection: MDB_URI (from .env)
```

### Authentication & Security
```
├── jsonwebtoken ^9.0.2 - JWT token generation
├── bcrypt ^6.0.0 - Password hashing
├── bcryptjs ^3.0.2 - Alternative bcrypt
├── cors ^2.8.5 - Cross-origin resource sharing
└── cookie-parser ^1.4.7 - Cookie handling
```

### File Handling & Validation
```
├── multer ^2.0.2 - File upload handling (use strict MIME/type checks)
├── validator ^13.15.15 - Data validation & sanit
ization
└── fs & path - Local file operations (development)
```

**Recommendations & Notes:**

- **Menu/image uploads:** Restrict menu-item uploads to image MIME types only (e.g., `image/png`, `image/jpeg`, `image/webp`). Do not accept generic documents for menu images — create a separate route for document uploads (rider docs, admin docs) if needed.
- **Size limits & scanning:** Enforce size limits (5MB default) and scan uploads for malware in production workflows (or use managed scanners).
- **Storage strategy:** For production, prefer object storage (S3/GCS/Azure Blob) behind a CDN. For local/dev, keep `uploads/` but add a migration path to cloud storage.
- **Serving uploads:** App already exposes `GET /uploads/*` (see `app.js`) — ensure proper caching headers and origin policies when serving files.
- **Metadata & sanitization:** Store upload metadata (filename, path, size, mimetype, uploaderId) in DB and sanitize filenames to avoid path traversal.
- **Tests & validation:** Add unit/integration tests that assert rejected MIME types, max size errors, and that accepted uploads are accessible at `/uploads/*`.

> Action items (see `docs/TASK_BACKLOG.md`): update `middlewares/upload.js` to enforce image-only for menu items and add tests to validate behavior.


### Third-party Services


```
├── twilio ^5.10.2 - SMS/OTP delivery
└── dotenv ^17.2.3 - Environment configuration
```

### Development Tools
```
├── figlet ^1.9.3 - ASCII art banner
├── chalk-animation ^2.0.3 - Colored terminal output
└── nodemon - Auto-reload during development
```

---

## 🏗️ SYSTEM ARCHITECTURE

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATIONS                         │
│  (Web: 3000, 3001, 3002, 3003 | Mobile: Netlify)                   │
└────────────┬──────────────────────────────────────────────────────┬─┘
             │                                                        │
    ┌────────▼─────────┐                          ┌────────────────▼──┐
    │    REST API      │                          │   Socket.io       │
    │   HTTP Routes    │                          │ Real-time Events  │
    └────────┬─────────┘                          └────────────┬──────┘
             │                                                 │
    ┌────────▼──────────────────────────────────────────────┬─┘
    │                   Express.js Server                    │
    │                    (Port: 5000)                        │
    └────────┬──────────────────────────────────────────────┘
             │
    ┌────────▼──────────────────────────────────────────────┐
    │              Middleware Stack                          │
    │  ├─ CORS Middleware                                   │
    │  ├─ Authentication Middleware                         │
    │  ├─ Error Handler Middleware                          │
    │  ├─ File Upload Handler (Multer)                      │
    │  └─ Socket.io Handler                                 │
    └────────┬──────────────────────────────────────────────┘
             │
    ┌────────▼──────────────────────────────────────────────┐
    │          API Routes & Controllers                      │
    │  ├─ /api/v1/auth                                      │
    │  ├─ /api/v1/restaurants                               │
    │  ├─ /api/v1/menu                                      │
    │  ├─ /api/v1/orders                                    │
    │  ├─ /api/v1/cart                                      │
    │  ├─ /api/v1/rider                                     │
    │  ├─ /api/v1/notifications                             │
    │  ├─ /api/v1/tickets                                   │
    │  └─ /api/v1/super-admin                               │
    └────────┬──────────────────────────────────────────────┘
             │
    ┌────────▼──────────────────────────────────────────────┐
    │           Mongoose Models & Schemas                    │
    │  ├─ User (Base user collection)                        │
    │  ├─ Customer                                           │
    │  ├─ Rider                                              │
    │  ├─ Restaurant                                         │
    │  ├─ RestaurantUser                                     │
    │  ├─ Admin                                              │
    │  ├─ Order                                              │
    │  ├─ MenuItem                                           │
    │  ├─ Cart                                               │
    │  ├─ Notification                                       │
    │  ├─ Ticket                                             │
    │  ├─ OTP                                                │
    │  └─ Notification                                       │
    └────────┬──────────────────────────────────────────────┘
             │
    ┌────────▼──────────────────────────────────────────────┐
    │              MongoDB Database                          │
    │  (Collections for each Model)                          │
    └───────────────────────────────────────────────────────┘
```

### Application Layers

```
┌─────────────────────────────────┐
│    Presentation Layer            │ (HTTP/WebSocket Endpoints)
│  - REST API Routes               │
│  - Socket.io Event Handlers      │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│    Business Logic Layer          │ (Controllers, Utilities)
│  - Order Management              │
│  - Delivery Tracking             │
│  - Notification System           │
│  - Ticket Support System         │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│    Data Access Layer             │ (Models & Schemas)
│  - Mongoose ODM                  │
│  - Database Operations           │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│    Database Layer                │ (MongoDB)
│  - Collections                   │
│  - Indexes                       │
│  - Relationships                 │
└─────────────────────────────────┘
```

---

## 📊 DATABASE SCHEMA & MODELS

### 1. **User Model** (Base Collection)
Stores common user data across all roles

```javascript
{
  _id: ObjectId,
  name: String (required),
  email: String (lowercase),
  phone: String (unique, required),
  profilePicture: String,
  role: String ['customer', 'rider', 'restaurant'],
  isVerified: Boolean (default: false),
  isActive: Boolean (default: true),
  lastLogin: Date,
  timestamps: { createdAt, updatedAt }
}
```

**Purpose:** Base authentication and profile info for all users

---

### 2. **Customer Model**
Extended customer-specific information

```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  favoriteRestaurants: [ObjectId],
  addresses: [{
    type: String ['home', 'work', 'other'],
    addressLine1, addressLine2,
    city, state, pincode,
    landmark,
    latitude, longitude
  }],
  totalOrders: Number,
  totalSpent: Number,
  ratings: Number,
  preferences: { vegetarian, nonVeg, spicy },
  isBlocked: Boolean,
  blockedUntil: Date,
  timestamps
}
```

**Purpose:** Customer-specific data and preferences

---

### 3. **Restaurant Model**
Restaurant information and menu management

```javascript
{
  _id: ObjectId,
  name: String (required),
  description: String,
  cuisine: [String],
  address: {
    addressLine1, addressLine2, city, state, pincode,
    geolocation: { latitude, longitude }
  },
  contact: { phone (required), email },
  images: [String] (URLs/paths),
  rating: {
    average: Number (0-5),
    reviews: [{
      customerId, orderId, rating (1-5), review,
      createdAt
    }]
  },
  operatingHours: {
    monday: { open, close },
    ... (all days)
  },
  deliveryTime: { min, max },
  minimumOrderValue: Number,
  deliveryCharge: Number,
  isOpen: Boolean,
  isActive: Boolean,
  totalOrders: Number,
  timestamps
}
```

**Purpose:** Restaurant profile, hours, ratings, and operating info

---

### 4. **MenuItem Model**
Menu items offered by restaurants

```javascript
{
  _id: ObjectId,
  restaurantId: ObjectId (ref: Restaurant, required),
  name: String (required),
  description: String,
  price: Number (required),
  discountedPrice: Number,
  discount: Number (percentage),
  image: String (URL/path),
  category: String (veg, non-veg, dessert, beverage),
  isVeg: Boolean,
  isActive: Boolean,
  preparationTime: Number (minutes),
  ratings: [{
    customerId, orderId, rating (1-5), comment
  }],
  averageRating: Number,
  totalOrders: Number,
  timestamps
}
```

**Purpose:** Individual food items available for ordering

---

### 5. **Order Model** ⭐ COMPLEX
Main order tracking with real-time delivery information

```javascript
{
  _id: ObjectId,
  orderId: String (unique, default: ORDxxxx),
  customerId: ObjectId (ref: Customer, required),
  restaurantId: ObjectId (ref: Restaurant, required),
  riderId: ObjectId (ref: Rider),
  
  // Delivery Tracking
  deliveryInfo: {
    assignedAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    estimatedDeliveryTime: Date,
    actualDeliveryTime: Date,
    deliveryFee: Number,
    riderEarnings: Number,
    distance: Number (km),
    trackingUrl: String
  },
  
  // Real-time Location
  riderLocation: {
    lat, lng, address,
    updatedAt
  },
  
  // Route Information
  route: {
    restaurantLocation: { lat, lng, geolocation, address },
    customerLocation: { lat, lng, address },
    polyline: String (for map rendering)
  },
  
  // Order Items
  items: [{
    menuItemId, name, price, quantity, itemTotal,
    specialInstructions, isVeg
  }],
  
  // Pricing
  subtotal: Number (required),
  deliveryFee: Number,
  tax: Number,
  finalAmount: Number (required),
  
  // Delivery Address
  deliveryAddress: {
    type, addressLine1, addressLine2,
    city, state, pincode, landmark,
    latitude, longitude
  },
  
  // Order Status
  orderStatus: String ['pending', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered', 'cancelled'],
  paymentStatus: String ['pending', 'completed', 'failed', 'refunded'],
  
  // Additional Details
  specialInstructions: String,
  contactlessDelivery: Boolean,
  returnURL: String (for payment)
}

---

## 📦 RESTAURANT USER API – CURL EXAMPLES

### 1) Send OTP (Restaurant)
`POST /api/v1/auth/send-otp`
```bash
curl -X POST http://localhost:3000/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","role":"restaurant"}'
```

### 2) Verify OTP (Restaurant)
`POST /api/v1/auth/verify-otp`
```bash
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","otp":"123456","name":"John Doe","email":"john@tastybites.com","additionalData":{"businessName":"Tasty Bites","gstNumber":"22AAAAA0000A1Z5"}}'
```

### 3) Restaurant Registration Complete
`POST /api/v1/register/restaurant/complete`
```bash
curl -X POST http://localhost:3000/api/v1/register/restaurant/complete \
  -F "businessName=Tasty Bites" \
  -F "ownerName=John Doe" \
  -F "phone=9876543210" \
  -F "email=john@tastybites.com" \
  -F "cuisines=Indian,Chinese" \
  -F "addressLine1=123 Main St" \
  -F "city=Bangalore" \
  -F "state=Karnataka" \
  -F "pincode=560001" \
  -F "gstNumber=22AAAAA0000A1Z5" \
  -F "fssaiNumber=12345678901234" \
  -F "minOrderAmount=100" \
  -F "deliveryFee=20" \
  -F "deliveryTime=30-45 mins" \
  -F "bankAccountNumber=123456789012" \
  -F "bankIFSC=HDFC0001234" \
  -F "upiId=johndoe@upi" \
  -F "gstCertificate=@/path/to/gst_certificate.pdf"
```

### 4) Get Profile (Restaurant)
`GET /api/v1/auth/profile`
```bash
curl -X GET http://localhost:3000/api/v1/auth/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
``````

**Purpose:** Tracks complete order lifecycle with real-time delivery data

---

### 6. **Rider Model**
Delivery rider information

```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  vehicleType: String ['bike', 'car', 'bicycle'],
  vehicleNumber: String,
  licenseNumber: String,
  aadharNumber: String,
  bankDetails: {
    accountHolder, accountNumber, ifscCode
  },
  documents: [String] (file paths),
  rating: {
    average: Number,
    reviews: [...]
  },
  totalDeliveries: Number,
  totalEarnings: Number,
  walletBalance: Number,
  status: String ['available', 'busy', 'offline'],
  currentLocation: { lat, lng },
  isVerified: Boolean,
  isActive: Boolean,
  assignedOrders: [ObjectId] (ref: Order)
}
```

**Purpose:** Rider profile, verification, and earnings tracking

---

### 7. **Cart Model**
Shopping cart management

```javascript
{
  _id: ObjectId,
  customerId: ObjectId (ref: Customer, required),
  restaurantId: ObjectId (ref: Restaurant, required),
  items: [{
    menuItemId: ObjectId,
    quantity: Number,
    price: Number,
    specialInstructions: String
  }],
  subtotal: Number,
  updatedAt: Date
}
```

**Purpose:** Persistent shopping cart for customers

---

### 8. **Notification Model**
System notifications

```javascript
{
  _id: ObjectId,
  recipientId: ObjectId,
  recipientRole: String ['customer', 'rider', 'restaurant', 'admin'],
  type: String ['order_update', 'delivery_status', 'promo', 'support'],
  title: String,
  message: String,
  data: Object (contextual data),
  isRead: Boolean (default: false),
  createdAt: Date
}
```

**Purpose:** Push notifications for all users

---

### 9. **Ticket Model** 🎫
Support ticket system

```javascript
{
  _id: ObjectId,
  ticketId: String (unique),
  userId: ObjectId (ref: User),
  userRole: String ['customer', 'rider', 'restaurant'],
  category: String ['order_issue', 'delivery_problem', 'payment_issue', 'other'],
  subject: String,
  description: String,
  priority: String ['low', 'medium', 'high', 'critical'],
  status: String ['open', 'in_progress', 'resolved', 'closed'],
  assignedTo: ObjectId (ref: Admin),
  messages: [{
    senderId, senderRole, message, timestamp, attachments
  }],
  resolution: String,
  createdAt, resolvedAt
}
```

**Purpose:** Customer support and issue tracking

---

### 10. **Admin Model**
Admin user information

```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  role: String ['admin', 'super-admin', 'support-admin'],
  permissions: [String],
  assignedTickets: [ObjectId],
  isActive: Boolean,
  lastLogin: Date
}
```

**Purpose:** Admin access control and permissions

---

### 11. **RestaurantUser Model**
Staff members for restaurants

```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  restaurantId: ObjectId (ref: Restaurant),
  role: String ['manager', 'staff'],
  permissions: [String],
  isActive: Boolean
}
```

**Purpose:** Restaurant staff management

---

### 12. **OTP Model**
One-time passwords for verification

```javascript
{
  _id: ObjectId,
  phone: String (required),
  email: String,
  otp: String (required),
  otpType: String ['sms', 'email'],
  expiresAt: Date,
  attempts: Number,
  isUsed: Boolean (default: false)
}
```

**Purpose:** OTP storage for phone/email verification

---

## 🔗 API ENDPOINTS & ROUTES

### API Versioning
- **Base URL:** `http://localhost:5000/api/v1`
- **API Version:** v1 (configurable via ENV)

### Route Structure

```
/api/v1/
├── /auth
│   ├── POST /register
│   ├── POST /login
│   ├── POST /verify-otp
│   ├── POST /logout
│   └── POST /refresh-token
│
├── /restaurants
│   ├── GET / (list all)
│   ├── GET /:id (get single)
│   ├── POST / (create - admin)
│   ├── PUT /:id (update)
│   ├── DELETE /:id (delete - admin)
│   └── GET /:id/menu (get menu items)
│
├── /menu
│   ├── GET / (list items)
│   ├── GET /:id (get single item)
│   ├── POST / (create - restaurant)
│   ├── PUT /:id (update - restaurant)
│   └── DELETE /:id (delete - restaurant)
│
├── /cart
│   ├── GET / (get cart)
│   ├── POST / (add to cart)
│   ├── PUT /:itemId (update quantity)
│   └── DELETE /:itemId (remove item)
│
├── /orders
│   ├── POST / (create order)
│   ├── GET / (list orders)
│   ├── GET /:orderId (get single order)
│   ├── PUT /:orderId/status (update status)
│   ├── GET /:orderId/track (track delivery)
│   └── POST /:orderId/review (submit review)
│
├── /rider
│   ├── GET / (list riders - admin)
│   ├── GET /:id (get rider profile)
│   ├── PUT /:id (update profile)
│   ├── GET /earnings (get rider earnings)
│   ├── POST /location/update (update location)
│   └── GET /available-orders (get available deliveries)
│
├── /notifications
│   ├── GET / (get notifications)
│   ├── PUT /:id/read (mark as read)
│   └── DELETE /:id (delete notification)
│
├── /tickets
│   ├── POST / (create ticket)
│   ├── GET / (list tickets)
│   ├── GET /:ticketId (get single ticket)
│   ├── PUT /:ticketId/status (update status)
│   ├── POST /:ticketId/messages (add message)
│   └── POST /:ticketId/close (close ticket)
│
├── /admin/tickets
│   ├── GET / (admin ticket list)
│   ├── GET /:ticketId (admin view)
│   ├── PUT /:ticketId/assign (assign ticket)
│   └── PUT /:ticketId/resolve (resolve ticket)
│
└── /super-admin
    ├── GET /users (list all users)
    ├── GET /analytics (system analytics)
    ├── GET /reports (generate reports)
    ├── PUT /users/:id/block (block user)
    └── GET /super-admin/tickets (all tickets)
```

---

## 🔌 REAL-TIME FEATURES (Socket.io)

### Socket Events Architecture

```
┌─────────────────────────────────┐
│   Socket.io Server (Port 5000)  │
└────────────┬────────────────────┘
             │
    ┌────────▼──────────────────────┐
    │  Connected Users Registry     │
    │  ├─ customers: Map()          │
    │  ├─ riders: Map()             │
    │  ├─ restaurants: Map()        │
    │  ├─ admins: Map()             │
    │  └─ supportAdmins: Map()      │
    └────────┬──────────────────────┘
             │
    ┌────────▼──────────────────────┐
    │  Socket Event Handlers        │
    └────────┬──────────────────────┘
             │
    ┌────────┴────────┬────────────┬──────────┐
    │                 │            │          │
```

### Key Socket Events

#### **1. Connection & Authentication**
```javascript
socket.on('connect')
  ├─ socket.emit('user:login', { token, role })
  │   └─ Server: Verify token, add to connectedUsers
  │
  ├─ socket.on('user:logout')
  │   └─ Server: Remove from connectedUsers
  │
  └─ socket.on('disconnect')
      └─ Server: Clean up resources
```

#### **2. Order Events** 🚀
```javascript
// Customer creates order
socket.emit('order:create', { orderId, customerId, restaurantId })
  ├─ Server: Update order in DB
  ├─ Emit to restaurant: 'order:new'
  ├─ Emit to admin: 'order:new'
  └─ Emit to customer: 'order:created'

// Restaurant accepts order
socket.emit('order:accepted', { orderId })
  ├─ Server: Update status to 'confirmed'
  ├─ Emit to customer: 'order:accepted'
  ├─ Emit to admin: 'order:accepted'
  └─ Trigger rider assignment

// Order ready for pickup
socket.emit('order:ready', { orderId })
  ├─ Server: Update status to 'ready'
  ├─ Emit to rider: 'order:ready_for_pickup'
  └─ Emit to customer: 'order:ready'

// Rider picks up order
socket.emit('order:picked', { orderId })
  ├─ Server: Update deliveryInfo.pickedUpAt
  ├─ Emit to customer: 'order:picked_up'
  └─ Start delivery tracking

// Rider in transit
socket.emit('order:in_transit', { orderId, location })
  ├─ Server: Update riderLocation in DB
  ├─ Emit to customer: 'rider:location_update'
  └─ Emit to restaurant: 'delivery:in_progress'

// Order delivered
socket.emit('order:delivered', { orderId })
  ├─ Server: Update status, payment status
  ├─ Emit to customer: 'order:delivered'
  ├─ Update rider earnings
  └─ Send completion notification
```

#### **3. Rider Location Tracking** 📍
```javascript
socket.emit('rider:location', { orderId, lat, lng })
  ├─ Server: Update Order.riderLocation in real-time
  ├─ Emit to customer: 'rider:location_update'
  ├─ Calculate ETA using distance & speed
  └─ Emit to customer: 'rider:eta_update'

socket.emit('rider:available', { riderId, location })
  ├─ Server: Mark rider as available
  └─ Add to available riders pool

socket.emit('rider:busy', { riderId, orderId })
  ├─ Server: Mark rider as busy
  └─ Remove from available pool
```

#### **4. Notification Events** 📬
```javascript
socket.emit('notification:new', { recipientId, message })
  ├─ Server: Save to Notification collection
  └─ Emit to recipient: 'notification:receive'

socket.emit('notification:read', { notificationId })
  ├─ Server: Mark as read
  └─ Update Notification.isRead
```

#### **5. Ticket/Support Events** 🎫
```javascript
socket.emit('ticket:create', { ticketData })
  ├─ Server: Create ticket in DB
  ├─ Emit to support admins: 'ticket:new'
  └─ Emit to user: 'ticket:created'

socket.emit('ticket:message', { ticketId, message })
  ├─ Server: Add message to ticket
  ├─ Emit to assigned admin: 'ticket:new_message'
  └─ Emit to user: 'ticket:message_received'

socket.emit('ticket:assigned', { ticketId, adminId })
  ├─ Server: Assign ticket to admin
  ├─ Emit to admin: 'ticket:assigned'
  └─ Emit to user: 'ticket:assigned'

socket.emit('ticket:resolved', { ticketId, resolution })
  ├─ Server: Mark ticket as resolved
  ├─ Emit to user: 'ticket:resolved'
  └─ Save resolution text
```

#### **6. Admin Real-time Dashboard** 👁️
```javascript
socket.emit('admin:dashboard:subscribe')
  ├─ Receive: 'dashboard:order_update'
  ├─ Receive: 'dashboard:rider_update'
  ├─ Receive: 'dashboard:ticket_update'
  └─ Receive: 'dashboard:system_stats'
```

### Socket Authentication Flow
```
1. Client connects: socket.on('connect')
2. Client sends token: socket.emit('user:login', { token, role })
3. Server verifies JWT
4. Server finds user in appropriate collection (User, Customer, Rider, etc.)
5. Server stores in connectedUsers[role][userId] = socketId
6. Server broadcasts: 'user:online' to relevant parties
7. On disconnect: Clean up from connectedUsers
```

---

## 🔐 MIDDLEWARE STACK

### Middleware Processing Order

```
Request
   │
   ▼
┌─────────────────────────────────┐
│ CORS Middleware                 │ (corsMiddleware.js)
│ - Handle cross-origin requests  │
│ - Allow whitelisted origins     │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ Morgan Logger                   │ (Built-in)
│ - Log all HTTP requests         │
│ - Request/response timing       │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ Body Parser                     │ (Built-in)
│ - Parse JSON body               │
│ - Parse URL-encoded data        │
│ - Parse cookies                 │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ Static Files Server             │ (Built-in)
│ - Serve uploads from /uploads   │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ Route Handler                   │
│ - Match route pattern           │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ Authentication Middleware       │ (auth.js)
│ - Verify JWT token              │
│ - Load user from DB             │
│ - Check role & permissions      │
│ - Attach user to req object     │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ File Upload Middleware          │ (upload.js)
│ - Handle multipart/form-data    │
│ - Validate file types           │
│ - Save to uploads directory     │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ Route Logic (Controller)        │
│ - Process request               │
│ - Query database                │
│ - Emit socket events            │
│ - Return response               │
└─────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────┐
│ Error Handler Middleware        │ (errorHandler.js)
│ - Catch all errors              │
│ - Format error response         │
│ - Log errors                    │
│ - Return 4xx/5xx status         │
└─────────────────────────────────┘
   │
   ▼
Response

```

### Middleware Details

#### **1. CORS Middleware** (cors.js)
```javascript
Purpose: Enable cross-origin requests from whitelisted origins
Whitelist:
  - http://localhost:5000
  - http://localhost:3000
  - http://localhost:3001
  - http://localhost:3002
  - http://localhost:3003
  - https://fooddhubbb.netlify.app/
```

#### **2. Authentication Middleware** (auth.js)
```javascript
const authenticateToken = async (req, res, next) => {
  - Extract token from Authorization header
  - Verify JWT signature
  - Identify user role (customer/rider/restaurant/admin)
  - Load user from appropriate collection
  - Check if account is active
  - Attach user object to req
  - Call next() or return 401 Unauthorized
}
```

#### **3. File Upload Middleware** (upload.js)
```javascript
using multer:
  - Disk storage configuration
  - Destination: /uploads/{category}
  - Filename: uuid + original extension
  - File size limit: (configured in upload.js)
  - Allowed MIME types:
    * image/jpeg
    * image/png
    * image/webp
    * (configurable per route)
```

#### **4. Error Handler Middleware** (errorHandler.js)
```javascript
const errorHandler = (err, req, res, next) => {
  - Standardize error format
  - Log error with context
  - Return JSON error response
  - Never expose sensitive info in production
}
```

#### **5. Socket.io Middleware** (socket.js)
```javascript
- Authenticate socket connections
- Manage connected users registry
- Handle room management
- Broadcast events to specific users/roles
- Clean up on disconnect
```

---

## 📂 FILE STRUCTURE & ORGANIZATION

```
food-delivery-CBE/
│
├── 🌍 ROOT CONFIGURATION
│   ├── server.js ..................... Server entry point
│   ├── app.js ........................ Express app configuration
│   ├── package.json .................. Dependencies & scripts
│   ├── README.md ..................... Project documentation
│   └── .env .......................... Environment variables (not in repo)
│
├── ⚙️ CONFIG/ (Configuration & Permissions)
│   ├── config.js ..................... App configuration (PORT, DB_URI, API_VERSION)
│   └── adminPermissions.js ........... Admin role-based permissions
│
├── ⚙️ CONTROLLERS/ (Decoupled Business Logic)
│   ├── authController.js ............. Auth, verification, registration, profile & ratings
│   ├── cartController.js ............. Cart operations & coupon application
│   ├── contactUsController.js ........ User inquiry & query handling logic
│   ├── couponController.js ........... Coupon creation, validation & management
│   ├── orderController.js ............ Order creation, checkout, status tracking & reviews
│   ├── riderController.js ............ Rider profile, availability, locations & deliveries
│   └── superAdminController.js ....... System verifications, dashboard analytics & tickets
│
├── 🛡️ MIDDLEWARES/ (Request Processing)
│   ├── auth.js ....................... JWT verification & user loading
│   ├── cors.js ....................... CORS policy enforcement
│   ├── errorHandler.js ............... Global error handling
│   ├── socket.js ..................... Socket.io initialization & events (1019 lines)
│   └── upload.js ..................... Multer file upload configuration
│
├── 📦 MODELS/ (Database Schemas - Mongoose)
│   ├── User.js ....................... Base user collection
│   ├── Customer.js ................... Customer-specific data
│   ├── Restaurant.js ................. Restaurant profile & info
│   ├── MenuItem.js ................... Menu items for restaurants
│   ├── Order.js ...................... Complex order tracking (171 lines)
│   ├── Rider.js ...................... Delivery rider information
│   ├── Cart.js ....................... Shopping cart management
│   ├── Notification.js ............... System notifications
│   ├── Ticket.js ..................... Support ticket management
│   ├── OTP.js ........................ One-time password storage
│   ├── Admin.js ...................... Admin user information
│   └── RestaurantUser.js ............. Restaurant staff management
│
├── 🚀 ROUTES/ (API Endpoint Mappings)
│   ├── auth.js ....................... Route definitions pointing to authController.js
│   ├── cart.js ....................... Route definitions pointing to cartController.js
│   ├── menu.js ....................... Menu item management (mapped to controllers)
│   ├── order.js ...................... Route definitions pointing to orderController.js
│   ├── restaurants.js ................ Restaurant listing & info
│   ├── rider.js ...................... Route definitions pointing to riderController.js
│   ├── notificationRoutes.js ......... Notification endpoints
│   ├── tickets.js .................... User support tickets routes
│   ├── super-admin.js ................ Route definitions pointing to superAdminController.js
│   │
│   └── 📁 admin/ (Admin-specific routes)
│       └── tickets.js ................ Admin ticket management routes
│
│   └── 📁 super-admin/ (Super admin routes)
│       └── tickets.js ................ Super admin ticket management routes
│
├── 📥 UPLOADS/ (File Storage)
│   ├── menu-items/ ................... Menu item images
│   ├── riders/ ....................... Rider documents
│   └── admin/ ........................ Admin uploads
│
├── 🛠️ UTILS/ (Utility Functions)
│   ├── deliveryUtils.js .............. Delivery calculation functions
│   ├── imageUtils.js ................. Image processing & validation
│   ├── ticketHelper.js ............... Ticket management utilities
│   └── ticketUserHelper.js ........... Ticket user helper functions
│
└── 📋 PROJECT DOCS
    ├── PROJECT_ARCHITECTURE.md ....... This file!
    └── Other documentation
```

---

## ✨ KEY FEATURES

### 1. **Multi-Role User System** 👥
```
├─ Customer
│  ├─ Browse restaurants
│  ├─ Place orders
│  ├─ Track deliveries in real-time
│  ├─ Rate & review
│  ├─ Manage favorite restaurants
│  └─ Support tickets
│
├─ Rider
│  ├─ Accept delivery jobs
│  ├─ Real-time GPS tracking
│  ├─ Earnings tracking
│  ├─ Document management
│  └─ Status management (available/busy/offline)
│
├─ Restaurant
│  ├─ Manage menu items
│  ├─ Accept/reject orders
│  ├─ View order details
│  ├─ Manage staff users
│  └─ Track ratings & reviews
│
├─ Admin
│  ├─ Manage users (block/unblock)
│  ├─ Manage restaurants
│  ├─ Manage riders
│  ├─ Support ticket assignment
│  └─ System monitoring
│
└─ Super Admin
   ├─ Full system control
   ├─ All admin permissions
   ├─ Analytics & reports
   ├─ User blocking/verification
   └─ System-wide configuration
```

### 2. **Real-time Order Tracking** 📍
- Live GPS coordinates of rider
- Real-time ETA calculation
- Order status updates via Socket.io
- Polyline route visualization
- Distance calculation

### 3. **Support Ticket System** 🎫
- Multi-category tickets (order issues, delivery, payment, etc.)
- Priority levels (low, medium, high, critical)
- Admin assignment & tracking
- Message-based resolution thread
- Ticket status workflow

### 4. **Shopping Cart Management** 🛒
- Persistent cart storage
- Multi-item selection
- Special instructions per item
- Cart summary (subtotal, tax, delivery fee)

### 5. **Payment Integration Ready** 💳
- Order payment status tracking
- Return URL for payment gateway
- Refund support in Order model

### 6. **File Management** 📸
- Menu item images
- Restaurant images
- Rider documents
- Admin uploads
- Organized in separate directories

### 7. **OTP Verification** 🔐
- SMS/Email OTP support via Twilio
- OTP expiration handling
- Attempt limiting
- Phone & email verification

### 8. **Notification System** 📬
- Order updates
- Delivery status changes
- Promotional notifications
- Support responses
- Real-time via Socket.io

### 9. **Rating & Reviews** ⭐
- Separate ratings for restaurants and menu items
- Linked to specific orders
- Average rating calculation
- Customer review text

### 10. **Delivery Management** 🚚
- Distance calculation
- Delivery fee calculation
- Rider earnings tracking
- Multi-delivery route support
- Contactless delivery option

---

## 📊 DATA FLOW DIAGRAMS

### Order Creation Flow

```
Customer (Frontend)
   │
   ├─ POST /api/v1/orders
   │   │ { items[], restaurantId, deliveryAddress, specialInstructions }
   │
   ▼ (Express Router)
Order Route Handler
   │
   ├─ Verify JWT token (authenticateToken middleware)
   ├─ Create Order document in MongoDB
   ├─ Update MenuItem sold count
   ├─ Clear customer cart
   │
   ▼ (Socket.io Emission)
   │
   ├─ Emit 'order:new' to Restaurant
   ├─ Emit 'order:new' to Admins
   └─ Emit 'order:created' to Customer (with orderId)

Restaurant Accepts Order:
   │
   ├─ POST /api/v1/orders/:orderId/accept
   ▼
   ├─ Update Order.orderStatus = 'confirmed'
   ├─ Emit 'order:accepted' to Customer
   ├─ Start rider assignment algorithm
   │
   ▼ (Find Available Rider)
   │
   ├─ Query Rider collection for status = 'available'
   ├─ Calculate distance to restaurant
   ├─ Select nearest available rider
   ├─ Assign order to rider
   │
   ▼ (Socket.io)
   │
   ├─ Emit 'order:assigned' to Rider
   └─ Emit 'delivery:assigned' to Customer

Rider Picks Up Order:
   │
   ├─ Socket: 'order:picked' with { orderId, riderLocation }
   ▼
   ├─ Update deliveryInfo.pickedUpAt
   ├─ Update Order.orderStatus = 'on_way'
   │
   ▼ (Real-time Tracking)
   │
   ├─ Socket: 'rider:location' emitted periodically
   ├─ Update Order.riderLocation with lat, lng
   ├─ Calculate distance to customer
   ├─ Calculate ETA
   ├─ Emit 'rider:location_update' to Customer
   │
   ▼ (Order Delivered)
   │
   ├─ Socket: 'order:delivered'
   ├─ Update Order.orderStatus = 'delivered'
   ├─ Update deliveryInfo.deliveredAt
   ├─ Update Order.paymentStatus = 'completed'
   ├─ Add riderEarnings to Rider.totalEarnings
   ├─ Emit 'order:delivered' to Customer
   └─ Create Notification for Customer
```

### Payment Flow (Integration Point)

```
Order Created
   │
   ├─ Return returnURL to frontend
   │
   ▼ (Frontend redirects to payment gateway)
   │
Payment Gateway (Stripe/Razorpay/etc)
   │
   ├─ User enters card details
   │
   ▼
   │
Payment Status Webhook (From Payment Gateway)
   │
   ├─ POST /api/v1/payments/webhook
   ├─ Verify webhook signature
   ├─ Update Order.paymentStatus
   │
   ├─ If success:
   │  ├─ paymentStatus = 'completed'
   │  ├─ Emit 'payment:successful' to Restaurant
   │  └─ Order proceeds normally
   │
   └─ If failed:
       ├─ paymentStatus = 'failed'
       ├─ Emit 'payment:failed' to Customer
       └─ Allow retry or cancellation
```

### Support Ticket Flow

```
Customer Creates Ticket
   │
   ├─ POST /api/v1/tickets
   │   { category, subject, description, priority }
   │
   ▼
   ├─ Create Ticket document
   ├─ Assign ticketId
   ├─ Set status = 'open'
   │
   ▼ (Socket.io)
   │
   ├─ Emit 'ticket:new' to Support Admins
   ├─ Emit 'ticket:created' to Customer
   └─ Create Notification for Admins

Admin Assigns Ticket
   │
   ├─ PUT /api/v1/admin/tickets/:ticketId/assign
   │   { adminId }
   │
   ▼
   ├─ Set Ticket.assignedTo = adminId
   ├─ Set Ticket.status = 'in_progress'
   │
   ▼ (Socket.io)
   │
   ├─ Emit 'ticket:assigned' to Admin
   └─ Emit 'ticket:assigned' to Customer

Customer/Admin Exchange Messages
   │
   ├─ POST /api/v1/tickets/:ticketId/messages
   │   { message, senderId, senderRole }
   │
   ▼
   ├─ Push message to Ticket.messages array
   ├─ Update Ticket.updatedAt
   │
   ▼ (Socket.io)
   │
   ├─ Emit 'ticket:new_message' to other party
   └─ Send notification to other party

Admin Resolves Ticket
   │
   ├─ PUT /api/v1/admin/tickets/:ticketId/resolve
   │   { resolution }
   │
   ▼
   ├─ Set Ticket.resolution = resolution text
   ├─ Set Ticket.status = 'resolved'
   ├─ Set Ticket.resolvedAt = now
   │
   ▼ (Socket.io)
   │
   ├─ Emit 'ticket:resolved' to Customer
   ├─ Emit 'ticket:closed' to Admin
   └─ Send completion notification
```

---

## 🔐 AUTHENTICATION & AUTHORIZATION

### JWT Token Structure

```javascript
Payload: {
  userId: "ObjectId",
  email: "user@example.com",
  phone: "919876543210",
  role: "customer" | "rider" | "restaurant" | "admin" | "super-admin",
  restaurantId?: "ObjectId" (for restaurant users),
  adminId?: "ObjectId" (for admin users)
}

Algorithm: HS256
Secret: JWT_SECRET (from .env)
Expiration: (typically 7 days or configurable)
```

### Authentication Flow

```
1. User submits phone/email + password/OTP

2. POST /api/v1/auth/register (or login)
   │
   ├─ Validate input (phone, email format)
   ├─ Hash password with bcrypt
   ├─ Create User document
   ├─ Create role-specific collection entry (Customer/Rider/etc)
   │
   ▼

3. Server generates JWT token
   │
   ├─ Payload: { userId, email, phone, role }
   ├─ Sign with JWT_SECRET
   │
   ▼

4. Return token to client
   │
   ├─ Client stores in localStorage/sessionStorage
   ├─ Client includes in Authorization header: "Bearer {token}"
   │
   ▼

5. For subsequent requests:
   │
   ├─ Client sends token in header
   ├─ Server middleware extracts token
   ├─ Server verifies signature
   ├─ Server decodes payload
   ├─ Server loads user from DB based on role
   ├─ Server attaches user to req object
   ├─ Route handler can access via req.user or req.admin
   │
   ▼

6. If token invalid/expired:
   │
   ├─ Return 401 Unauthorized
   ├─ Client can refresh or re-authenticate
```

### Role-Based Access Control (RBAC)

```javascript
Customer:
  ├─ Can view restaurants & menu items
  ├─ Can create & manage orders
  ├─ Can view own order history
  ├─ Can track deliveries
  ├─ Can rate & review
  ├─ Can create support tickets
  └─ Can't: Access admin features, modify other users

Rider:
  ├─ Can view available deliveries
  ├─ Can accept delivery jobs
  ├─ Can update location
  ├─ Can view earnings
  ├─ Can create support tickets
  └─ Can't: Modify orders, access admin features

Restaurant:
  ├─ Can manage menu items
  ├─ Can view & accept orders
  ├─ Can update order status
  ├─ Can view ratings & reviews
  ├─ Can manage staff users
  └─ Can't: Access admin features, view other restaurants

Admin:
  ├─ Can manage all users
  ├─ Can assign support tickets
  ├─ Can view all orders
  ├─ Can generate reports
  ├─ Can block/unblock users
  └─ Can't: Full system control (that's super-admin)

Super Admin:
  ├─ Full system access
  ├─ Can manage admins
  ├─ Can access analytics
  ├─ Can modify system settings
  └─ Can do everything
```

---

## 🚀 DEPLOYMENT & CONFIGURATION

### Environment Variables (.env)

```
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MDB_URI=mongodb://username:password@host:port/database

# API
API_VERSION=v1

# JWT & Security
JWT_SECRET=your_super_secret_jwt_key_here

# Third-party Services
TWILIO_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number

# File Upload
MAX_FILE_SIZE=5242880 (5MB)
UPLOAD_DIR=/uploads

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,https://example.com
```

### Development Setup

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Fill in environment variables

# Start development server (with auto-reload)
npm run dev

# Or start production server
npm start

# Server runs on http://localhost:5000
# API available at http://localhost:5000/api/v1
```

### Production Deployment

```bash
# Build (if needed)
npm run build

# Start server
npm start

# Use process manager (PM2)
pm2 start server.js --name "hungry-hub-api"
pm2 save
pm2 startup

# Environment
NODE_ENV=production
PORT=5000 (or reverse proxy)
JWT_SECRET=<strong-secret>
MDB_URI=<production-mongodb-uri>
```

### Server Health Endpoints

```
GET http://localhost:5000/
Response:
{
  "message": "Hungry-Hub Food Delivery API",
  "version": "v1",
  "status": "active",
  "endpoints": {
    "auth": "/api/v1/auth",
    "restaurants": "/api/v1/restaurants",
    "orders": "/api/v1/orders"
  },
  "timestamp": "2026-01-24T..."
}
```

### Memory Monitoring

In development mode (NODE_ENV=development):
- Server logs memory usage every 10 minutes
- Shows: RSS, Heap Total, Heap Used, External, ArrayBuffers
- Helps identify memory leaks early

---

## 📈 SCALABILITY CONSIDERATIONS

### Current Architecture Limitations
1. **Socket.io Store:** Currently in-memory (connectedUsers Map)
   - **Issue:** Doesn't work with multiple server instances
   - **Solution:** Use Redis adapter for clustering

2. **File Storage:** Local disk
   - **Issue:** Not suitable for multiple servers
   - **Solution:** Use cloud storage (S3, Azure Blob, etc.)

3. **Database Indexing:** May need optimization
   - **Recommendation:** Create indexes on frequently queried fields

### Recommended Improvements for Scale

```javascript
// 1. Redis Adapter for Socket.io Clustering - use when running multiple API instances
//    - Use `@socket.io/redis-adapter` and a managed Redis (or self-hosted) to enable pub/sub across nodes.
const redisClient = redis.createClient({ url: REDIS_URL });
io.adapter(createAdapter(redisClient));

// 2. Sticky Sessions (if not using adapter)
//    - If you prefer not to use the Redis adapter, configure your LB (Nginx/ALB) for sticky sessions so Socket.io clients remain on the same backend.

// 3. Message Queue for Async Ops (e.g., emails, notifications, heavy tasks)
const Bull = require('bull');
const orderQueue = new Bull('orders', REDIS_URL);

// 4. Caching Layer for hot reads
const redis = new Redis(REDIS_URL);
await redis.setex(`order:${orderId}`, 3600, JSON.stringify(order));

// 5. Database Connection Pooling
mongoose.connect(MDB_URI, { maxPoolSize: 50 });

// 6. API Rate Limiting & Throttling (protect auth & payment endpoints)
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// 7. Static file storage & CDN (recommended for production)
//    - Move `uploads/` to object storage (S3/GCS/Blob) and serve via CDN (CloudFront/Cloudflare).
//    - Keep local `uploads/` for dev but add migration scripts and signed URLs for secure access.
```

---

## 🧩 Deployment & Configuration (quick guide)

- **Local / Dev:** Use `npm run dev` and `.env` values; mount `uploads/` as a volume if using Docker.
- **Containerization:** Add a multi-stage `Dockerfile` and `docker-compose.yml` (see `docs/TASK_BACKLOG.md` for tasks). Keep `uploads/` as a named volume for local testing and plan to replace with object storage in production.
- **CI/CD:** Add a GitHub Actions workflow to run lint, tests, and build images on PRs. Protect `main` branch and use PR reviews.
- **Health & Readiness:** Add `/healthz` and `/readyz` endpoints for orchestration and load balancer checks. Ensure `/` returns API & version info (already implemented in `app.js`).
- **Socket.io Admin UI:** Admin UI is enabled (via `@socket.io/admin-ui`) — avoid exposing it in production or protect it behind authentication.
- **OpenAPI & Backlog:** The initial OpenAPI draft and prioritized tasks are added to `docs/openapi.yaml` and `docs/TASK_BACKLOG.md` respectively — expand the spec and link to it in docs and API reference.

> Next actions: implement `Dockerfile`, CI workflow, and add health/readiness endpoints (see `docs/TASK_BACKLOG.md` items).


---

## 🔍 MONITORING & DEBUGGING

### Logging Points
1. **Authentication:** Every login/token verification
2. **Orders:** Creation, status updates, delivery tracking
3. **Errors:** Caught by errorHandler middleware
4. **Database:** Mongoose query logs (in development)
5. **Socket:** Connection/disconnection events

### Debug Mode
```bash
# Run with detailed logging
NODE_ENV=development npm run dev

# Shows:
# - SQL/query execution times
# - Memory usage every 10 minutes
# - HTTP request/response logging
# - Socket connection details
```

---

## 📚 QUICK START GUIDE FOR NEW DEVELOPERS

### Step 1: Understanding the Flow
1. Read this document
2. Understand the models (especially Order model)
3. Review Socket.io events in socket.js

### Step 2: Local Setup
```bash
git clone <repo>
cd food-delivery-CBE
npm install
cp .env.example .env
# Fill in MongoDB URI and other vars
npm run dev
```

### Step 3: Testing APIs
```bash
# Use Postman or REST Client
# 1. Register: POST /api/v1/auth/register
# 2. Login: POST /api/v1/auth/login (get token)
# 3. Add token to Authorization header
# 4. Create order: POST /api/v1/orders
# 5. Check WebSocket events in console
```

### Step 4: Making Changes
1. Create new route in routes/
2. Create/update model in models/
3. Add Socket.io events in middlewares/socket.js if real-time needed
4. Test both REST and Socket.io functionality

---

## 🎓 LEARNING PATH FOR THIS PROJECT

### Week 1: Foundation
- [ ] Understand Express.js routing
- [ ] Learn MongoDB & Mongoose
- [ ] Review all models
- [ ] Understand JWT authentication

### Week 2: Core Features
- [ ] Study Order model in depth
- [ ] Understand real-time order flow
- [ ] Learn Socket.io event handling
- [ ] Review payment integration points

### Week 3: Advanced Features
- [ ] Support ticket system
- [ ] Delivery tracking with GPS
- [ ] Rating & review system
- [ ] File upload management

### Week 4: Deep Dive
- [ ] Multi-role authorization
- [ ] Error handling strategy
- [ ] Caching & optimization
- [ ] Security best practices

---

## 📞 SUPPORT & RESOURCES

### File Locations Quick Reference
- **Configuration:** `config/config.js`
- **Database Models:** `models/*.js`
- **API Routes:** `routes/*.js`
- **Real-time Logic:** `middlewares/socket.js`
- **Authentication:** `middlewares/auth.js`
- **Error Handling:** `middlewares/errorHandler.js`

### Common Tasks

**Add new API endpoint:**
1. Create route in routes/
2. Add model if needed
3. Update Socket.io events if real-time

**Add new database field:**
1. Update model schema in models/
2. Handle migration in route handler
3. Update Socket.io events if affects real-time

**Debug Socket.io issue:**
1. Check socket.js middleware
2. Verify token authentication
3. Check client-side socket event names
4. Review console logs for connection status

---

## ✅ PROJECT CHECKLIST

- [x] Multi-role authentication system
- [x] Real-time order tracking
- [x] Support ticket system
- [x] File upload management
- [x] Shopping cart
- [x] Rating & reviews
- [x] Delivery tracking with GPS
- [x] Socket.io integration
- [x] Error handling
- [x] Middleware stack
- [ ] Payment gateway integration (ready for implementation)
- [ ] SMS notifications via Twilio (OTP implemented)
- [ ] Advanced analytics dashboard
- [ ] Admin analytics & reports

---

**Document Last Updated:** January 24, 2026  
**Project Status:** Active Development  
**Next Review Date:** Q2 2026

---

*For questions or clarifications about this architecture, refer to the inline code comments and the specific route/model files.*
