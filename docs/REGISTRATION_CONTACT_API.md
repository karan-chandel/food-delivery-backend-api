# API Documentation - Contact Us, Restaurant & Rider Registration

## Overview
This document provides detailed information about the newly created APIs for:
1. **Contact Us** - Customer inquiries and support
2. **Restaurant Registration** - Multi-step restaurant onboarding
3. **Rider Registration** - Multi-step rider onboarding

---

## 1. CONTACT US ENDPOINTS

### Base URL
```
https://your-api-domain/api/v1/contact-us
```

### 1.1 Submit Contact Us Form (Public)

**Endpoint:** `POST /api/v1/contact-us`

**Description:** Submit a basic contact us form without file attachment

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "subject": "Issue with my order",
  "message": "I ordered food but it arrived cold",
  "category": "complaint"
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | String | Yes | Sender's full name |
| email | String | Yes | Valid email address |
| phone | String | Yes | Phone number (min 10 digits) |
| subject | String | Yes | Subject of the inquiry |
| message | String | Yes | Detailed message |
| category | String | No | complaint, suggestion, partnership, support, general, other |

**Success Response (201):**
```json
{
  "success": true,
  "message": "Thank you for contacting us. We will get back to you soon.",
  "data": {
    "contactUsId": "507f1f77bcf86cd799439011",
    "status": "new"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Name, email, phone, subject, and message are required"
}
```

---

### 1.2 Submit Contact Us Form With Attachment

**Endpoint:** `POST /api/v1/contact-us/with-attachment`

**Description:** Submit contact us form with file attachment (image, PDF, etc.)

**Authentication:** Not required (Public)

**Request Type:** `multipart/form-data`

**Form Fields:**
- name (String, required)
- email (String, required)
- phone (String, required)
- subject (String, required)
- message (String, required)
- category (String, optional)
- attachment (File, optional)  

**Allowed File Types:**
- Images: JPG, JPEG, PNG
- Documents: PDF, DOC, DOCX

**File Size Limit:** 5MB

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/v1/contact-us/with-attachment \
  -F "name=John Doe" \
  -F "email=john@example.com" \
  -F "phone=9876543210" \
  -F "subject=Support Request" \
  -F "message=I need help with something" \
  -F "category=support" \
  -F "attachment=@/path/to/file.pdf"
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Thank you for contacting us. We will get back to you soon.",
  "data": {
    "contactUsId": "507f1f77bcf86cd799439011",
    "status": "new",
    "attachment": "/uploads/menu-items/menu-1708332800000-123456789.pdf"
  }
}
```

---

### 1.3 Get Contact Us Message (Admin Only)

**Endpoint:** `GET /api/v1/contact-us/:id`

**Description:** Retrieve a specific contact us message

**Authentication:** Required (Admin/Super-Admin)

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>"
}
```

**URL Parameters:**
| Parameter | Type | Required |
|-----------|------|----------|
| id | String | Yes |

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "9876543210",
    "subject": "Issue with my order",
    "message": "I ordered food but it arrived cold",
    "category": "complaint",
    "status": "new",
    "attachment": null,
    "adminReply": null,
    "createdAt": "2024-02-18T10:30:00Z",
    "updatedAt": "2024-02-18T10:30:00Z"
  }
}
```

---

### 1.4 Get All Contact Us Messages (Admin Only)

**Endpoint:** `GET /api/v1/contact-us`

**Description:** Get all contact us messages with pagination and filtering

**Authentication:** Required (Admin/Super-Admin)

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| status | String | - | Filter by status: new, read, replied, closed |
| category | String | - | Filter by category |
| page | Number | 1 | Page number |
| limit | Number | 20 | Items per page |
| sortBy | String | createdAt | Sort field |
| sortOrder | String | desc | asc or desc |

**Example Request:**
```
GET /api/v1/contact-us?status=new&category=complaint&page=1&limit=10
```

**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "9876543210",
      "subject": "Issue with my order",
      "message": "I ordered food but it arrived cold",
      "category": "complaint",
      "status": "new",
      "createdAt": "2024-02-18T10:30:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalMessages": 98,
    "hasNext": true,
    "hasPrev": false,
    "limit": 20
  }
}
```

---

### 1.5 Reply to Contact Us Message (Admin Only)

**Endpoint:** `PUT /api/v1/contact-us/:id/reply`

**Description:** Send a reply to a contact us message

**Authentication:** Required (Admin/Super-Admin)

**Request Body:**
```json
{
  "reply": "Thank you for your feedback. We will improve our delivery process."
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Reply sent successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "adminReply": {
      "reply": "Thank you for your feedback. We will improve our delivery process.",
      "repliedAt": "2024-02-18T11:00:00Z",
      "repliedBy": "507f1f77bcf86cd799439012"
    },
    "status": "replied"
  }
}
```

---

### 1.6 Update Contact Us Status (Admin Only)

**Endpoint:** `PUT /api/v1/contact-us/:id/status`

**Description:** Update the status of a contact us message

**Authentication:** Required (Admin/Super-Admin)

**Request Body:**
```json
{
  "status": "closed"
}
```

**Valid Status Values:**
- `new` - New message
- `read` - Read by admin
- `replied` - Reply sent
- `closed` - Conversation closed

**Success Response (200):**
```json
{
  "success": true,
  "message": "Status updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "closed"
  }
}
```

---

### 1.7 Delete Contact Us Message (Admin Only)

**Endpoint:** `DELETE /api/v1/contact-us/:id`

**Description:** Delete a contact us message permanently

**Authentication:** Required (Admin/Super-Admin)

**Success Response (200):**
```json
{
  "success": true,
  "message": "Contact us message deleted successfully"
}
```

---

## 2. RESTAURANT REGISTRATION ENDPOINTS

### Base URL
```
https://your-api-domain/api/v1/register
```

### 2.1 Initial Restaurant Registration

**Endpoint:** `POST /api/v1/register/restaurant/initial`

**Description:** Start restaurant registration with basic information

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "businessName": "Pizza Palace",
  "ownerName": "Raj Kumar",
  "phone": "9876543210",
  "email": "raj@pizzapalace.com",
  "cuisines": "Italian, Continental",
  "city": "Delhi",
  "minOrderAmount": 250
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| businessName | String | Yes | Restaurant business name |
| ownerName | String | Yes | Owner's full name |
| phone | String | Yes | Phone number (min 10 digits) |
| email | String | No | Email address |
| cuisines | String | No | Cuisines served (comma-separated) |
| city | String | Yes | City |
| minOrderAmount | Number | No | Minimum order amount |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Initial registration data received. Please complete restaurant details.",
  "data": {
    "phone": "9876543210",
    "businessName": "Pizza Palace",
    "role": "restaurant"
  }
}
```

---

### 2.2 Complete Restaurant Registration

**Endpoint:** `POST /api/v1/register/restaurant/complete`

**Description:** Complete restaurant registration with full details and GST certificate

**Authentication:** Not required (Public)

**Request Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| businessName | String | Yes | Restaurant business name |
| ownerName | String | Yes | Owner's full name |
| phone | String | Yes | Phone number |
| email | String | No | Email address |
| cuisines | String | No | Cuisines (comma-separated) |
| addressLine1 | String | Yes | Street address |
| addressLine2 | String | No | Additional address |
| city | String | Yes | City |
| state | String | Yes | State |
| pincode | String | Yes | Postal code |
| latitude | Number | No | Geographic latitude |
| longitude | Number | No | Geographic longitude |
| gstNumber | String | No | GST registration number |
| fssaiNumber | String | No | FSSAI license number |
| minOrderAmount | Number | No | Minimum order amount |
| deliveryFee | Number | No | Delivery fee |
| deliveryTime | String | No | Estimated delivery time (e.g., "30-45 mins") |
| bankAccountNumber | String | No | Bank account number |
| bankIFSC | String | No | Bank IFSC code |
| upiId | String | No | UPI ID for payments |
| gstCertificate | File | No | GST certificate (PDF/Image) |

**File Size Limit:** 5MB

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/v1/register/restaurant/complete \
  -F "businessName=Pizza Palace" \
  -F "ownerName=Raj Kumar" \
  -F "phone=9876543210" \
  -F "email=raj@pizzapalace.com" \
  -F "cuisines=Italian,Continental" \
  -F "addressLine1=123 Main Street" \
  -F "addressLine2=Shop No. 5" \
  -F "city=Delhi" \
  -F "state=Delhi" \
  -F "pincode=110001" \
  -F "latitude=28.7041" \
  -F "longitude=77.1025" \
  -F "gstNumber=18AABCT1234H1Z0" \
  -F "minOrderAmount=250" \
  -F "deliveryFee=50" \
  -F "deliveryTime=30-45 mins" \
  -F "bankAccountNumber=123456789" \
  -F "bankIFSC=SBIN0001234" \
  -F "upiId=rajkumar@upi" \
  -F "gstCertificate=@/path/to/gst_certificate.pdf"
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Restaurant registration completed successfully. Waiting for admin approval.",
  "data": {
    "restaurantId": "507f1f77bcf86cd799439011",
    "restaurantUserId": "507f1f77bcf86cd799439012",
    "businessName": "Pizza Palace",
    "phone": "9876543210",
    "verificationStatus": "pending",
    "city": "Delhi"
  }
}
```

---

### 2.3 Check Restaurant Registration Status

**Endpoint:** `GET /api/v1/register/registration-status/:phone`

**Description:** Check registration status by phone number

**Authentication:** Not required (Public)

**URL Parameters:**
| Parameter | Type | Required |
|-----------|------|----------|
| phone | String | Yes |

**Example Request:**
```
GET /api/v1/register/registration-status/9876543210
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "phone": "9876543210",
    "role": "restaurant",
    "isVerified": false,
    "isActive": false,
    "details": {
      "businessName": "Pizza Palace",
      "city": "Delhi"
    }
  }
}
```

---

## 3. RIDER REGISTRATION ENDPOINTS

### Base URL
```
https://your-api-domain/api/v1/register
```

### 3.1 Initial Rider Registration

**Endpoint:** `POST /api/v1/register/rider/initial`

**Description:** Start rider registration with basic information

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "phone": "9876543210",
  "name": "Amit Singh",
  "email": "amit@example.com"
}
```

**Request Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phone | String | Yes | Phone number (min 10 digits) |
| name | String | Yes | Rider's full name |
| email | String | No | Email address |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Initial registration data received. Please verify via OTP.",
  "data": {
    "phone": "9876543210",
    "role": "rider"
  }
}
```

---

### 3.2 Complete Rider Registration

**Endpoint:** `POST /api/v1/register/rider/complete`

**Description:** Complete rider registration with vehicle and document details

**Authentication:** Not required (Public)

**Request Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| phone | String | Yes | Phone number |
| name | String | Yes | Rider's full name |
| email | String | No | Email address |
| vehicleType | String | Yes | bike, scooter, or cycle |
| vehicleNo | String | Yes | Vehicle registration number |
| licenseNumber | String | Yes | Driving license number |
| licensePhoto | File | Yes | License photo (JPG/PNG/PDF) |
| vehiclePhoto | File | Yes | Vehicle photo (JPG/PNG/PDF) |
| aadharNumber | String | No | Aadhar number |
| bankAccountNumber | String | No | Bank account number |
| bankIFSC | String | No | Bank IFSC code |

**File Size Limit:** 5MB per file

**cURL Example:**
```bash
curl -X POST http://localhost:5000/api/v1/register/rider/complete \
  -F "phone=9876543210" \
  -F "name=Amit Singh" \
  -F "email=amit@example.com" \
  -F "vehicleType=bike" \
  -F "vehicleNo=DL01AB1234" \
  -F "licenseNumber=DL1234567890" \
  -F "aadharNumber=123456789012" \
  -F "bankAccountNumber=123456789" \
  -F "bankIFSC=SBIN0001234" \
  -F "licensePhoto=@/path/to/license.jpg" \
  -F "vehiclePhoto=@/path/to/vehicle.jpg"
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Rider registration completed successfully. Waiting for admin approval.",
  "data": {
    "riderId": "507f1f77bcf86cd799439011",
    "name": "Amit Singh",
    "phone": "9876543210",
    "verificationStatus": "pending"
  }
}
```

---

### 3.3 Check Rider Registration Status

**Endpoint:** `GET /api/v1/register/registration-status/:phone`

**Description:** Check registration status by phone number

**Authentication:** Not required (Public)

**URL Parameters:**
| Parameter | Type | Required |
|-----------|------|----------|
| phone | String | Yes |

**Example Request:**
```
GET /api/v1/register/registration-status/9876543210
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "phone": "9876543210",
    "role": "rider",
    "isVerified": false,
    "isActive": true,
    "details": {
      "name": "Amit Singh",
      "vehicleNo": "DL01AB1234",
      "documents": {
        "licensePhoto": true,
        "vehiclePhoto": true
      }
    }
  }
}
```

---

### 3.4 Resend OTP for Registration

**Endpoint:** `POST /api/v1/register/resend-otp`

**Description:** Resend OTP for phone verification during registration

**Authentication:** Not required (Public)

**Request Body:**
```json
{
  "phone": "9876543210",
  "role": "rider"
}
```

**Request Parameters:**
| Field | Type | Required | Valid Values |
|-------|------|----------|--------------|
| phone | String | Yes | Any phone number |
| role | String | Yes | customer, rider, restaurant |

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP resent successfully",
  "debug_otp": "123456"
}
```

---

## 4. COMPLETE REGISTRATION FLOW EXAMPLES

### Restaurant Registration Flow

```
Step 1: Send initial info
POST /api/v1/register/restaurant/initial
{
  "businessName": "Pizza Palace",
  "ownerName": "Raj Kumar",
  "phone": "9876543210",
  "email": "raj@pizzapalace.com",
  "city": "Delhi"
}

Step 2: Complete registration with documents
POST /api/v1/register/restaurant/complete
(multipart/form-data with all required fields)

Step 3: Check status
GET /api/v1/register/registration-status/9876543210

Step 4: Admin verifies and approves the restaurant
(Admin dashboard action)

Step 5: Restaurant can start using the platform
Login with OTP verification
```

### Rider Registration Flow

```
Step 1: Send initial info
POST /api/v1/register/rider/initial
{
  "phone": "9876543210",
  "name": "Amit Singh",
  "email": "amit@example.com"
}

Step 2: Verify OTP
POST /api/v1/auth/verify-otp
(as per auth.js implementation)

Step 3: Complete registration with documents
POST /api/v1/register/rider/complete
(multipart/form-data with vehicle and document details)

Step 4: Check status
GET /api/v1/register/registration-status/9876543210

Step 5: Admin verifies documents and approves
(Admin dashboard action)

Step 6: Rider can start riding
Login and start accepting deliveries
```

---

## 5. ERROR RESPONSES

### Common Error Responses

**401 Unauthorized:**
```json
{
  "success": false,
  "error": "Access token required"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "error": "Your rider account is pending verification. Please contact admin."
}
```

**404 Not Found:**
```json
{
  "success": false,
  "error": "Contact us message not found"
}
```

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Phone number already registered"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Internal Server Error"
}
```

---

## 6. MODELS UPDATED

### New Model: ContactUs
- Created in `models/ContactUs.js`
- Stores all contact us inquiries
- Supports admin replies and status tracking

### Updated Model: Restaurant
- Added: `gstNumber`, `fssaiNumber` fields

### Updated Model: RestaurantUser
- Added: `gstCertificate`, `bankAccountNumber`, `bankIFSC`, `upiId` fields

### Updated Model: Rider
- Added: `aadharNumber`, `bankAccountNumber`, `bankIFSC` fields

---

## 7. USAGE NOTES

1. **OTP Verification**: Riders and Restaurants must verify their phone via OTP before completing registration
2. **Admin Approval**: Riders and Restaurants require admin verification to become active
3. **File Uploads**: Maximum file size is 5MB; only specific file types are allowed
4. **Contact Us**: Public endpoint with optional admin replies and status management
5. **Registration Status**: Can be checked without authentication by providing phone number

---

## 8. ROUTES REGISTERED IN APP.JS

```javascript
app.use(`/api/${API_VERSION}/contact-us`, require('./routes/contactUs'));
app.use(`/api/${API_VERSION}/register`, require('./routes/register'));
```

---

## 9. INTEGRATION WITH EXISTING AUTH

The registration endpoints integrate with the existing OTP-based authentication system:
- Uses the same OTP model and generation logic
- Follows the same JWT token structure
- Compatible with existing auth middleware

---

## 10. ADMIN ENDPOINTS FOR MANAGEMENT

These endpoints are available for Admin/Super-Admin users:
- Get all contact us messages
- Read individual messages
- Reply to messages
- Update message status
- Delete messages
- Verify/approve pending rider registrations
- Verify/approve pending restaurant registrations

---

**API Version:** v1  
**Last Updated:** February 18, 2024  
**Created By:** Development Team
