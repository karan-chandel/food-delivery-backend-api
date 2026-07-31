# Deployment & Testing Checklist

## Pre-Deployment Checklist

### Database Setup
- [ ] MongoDB instance is running
- [ ] Database connection string is configured in `.env`
- [ ] Collections for ContactUs, Restaurant, RestaurantUser, Rider exist
- [ ] Indexes are created (done automatically via Mongoose)
- [ ] Database user has write permissions

### File System Setup
- [ ] `/uploads` directory exists
- [ ] `/uploads/riders` directory exists
- [ ] `/uploads/menu-items` directory exists
- [ ] `/uploads/contact-us` directory exists (will be created on first request)
- [ ] Write permissions are set correctly
- [ ] Enough disk space for file uploads

### Environment Variables
- [ ] `.env` file is created
- [ ] `PORT` is set
- [ ] `MDB_URI` is configured
- [ ] `API_VERSION` is set (default: v1)
- [ ] `JWT_SECRET` is configured
- [ ] Node environment is set (`NODE_ENV`)

### Dependencies
- [ ] `npm install` completed successfully
- [ ] No peer dependency warnings
- [ ] All packages are compatible with Node version

### Code Review
- [ ] All files created and modified
- [ ] No syntax errors
- [ ] Routes registered in `app.js`
- [ ] Models include new fields
- [ ] Error handling is comprehensive

### Security
- [ ] JWT middleware is properly configured
- [ ] File upload validation is in place
- [ ] Input validation is implemented
- [ ] SQL injection prevention (using Mongoose)
- [ ] Rate limiting considered (optional)
- [ ] CORS is configured properly

---

## Testing Checklist

### Unit Testing
- [ ] Test ContactUs model creation
- [ ] Test Restaurant model creation with new fields
- [ ] Test Rider model creation with new fields
- [ ] Test RestaurantUser model creation with new fields

### Integration Testing

#### Contact Us Endpoints
- [ ] **POST /contact-us** - Submit basic form
  - [ ] Valid input returns 201
  - [ ] Missing fields returns 400
  - [ ] Invalid email returns 400
  - [ ] Invalid phone returns 400
  - [ ] Data saved to database

- [ ] **POST /contact-us/with-attachment** - Submit with file
  - [ ] Valid form with file returns 201
  - [ ] Large file (>5MB) returns 400
  - [ ] Invalid file type returns 400
  - [ ] File is saved correctly
  - [ ] Database has file path

- [ ] **GET /contact-us** - Admin list
  - [ ] Without auth returns 401
  - [ ] With invalid role returns 403
  - [ ] Returns paginated results
  - [ ] Filters work correctly
  - [ ] Sorting works correctly

- [ ] **GET /contact-us/:id** - Get specific
  - [ ] Invalid ID returns 404
  - [ ] Valid ID returns data
  - [ ] Message marked as "read"

- [ ] **PUT /contact-us/:id/reply** - Reply
  - [ ] Sets status to "replied"
  - [ ] Stores reply text
  - [ ] Records admin ID
  - [ ] Records reply timestamp

- [ ] **PUT /contact-us/:id/status** - Update status
  - [ ] Status changes correctly
  - [ ] Invalid status returns 400
  - [ ] Updates database

- [ ] **DELETE /contact-us/:id** - Delete
  - [ ] Message deleted from database
  - [ ] File deleted from filesystem
  - [ ] Returns 200 success

#### Restaurant Registration Endpoints
- [ ] **POST /register/restaurant/initial** - Initial
  - [ ] Valid input returns 200
  - [ ] Missing fields returns 400
  - [ ] Duplicate phone returns 400

- [ ] **POST /register/restaurant/complete** - Complete
  - [ ] Valid form returns 201
  - [ ] Creates Restaurant document
  - [ ] Creates RestaurantUser document
  - [ ] Creates User document with role 'restaurant'
  - [ ] File is saved
  - [ ] Status is 'pending'
  - [ ] isVerified is false

- [ ] **GET /register/registration-status/:phone** - Status
  - [ ] Returns existing user status
  - [ ] Returns 404 for non-existent
  - [ ] Shows verification status

#### Rider Registration Endpoints
- [ ] **POST /register/rider/initial** - Initial
  - [ ] Valid input returns 200
  - [ ] Missing fields returns 400
  - [ ] Duplicate phone returns 400

- [ ] **POST /register/rider/complete** - Complete
  - [ ] Valid form returns 201
  - [ ] Creates Rider document
  - [ ] Creates User document with role 'rider'
  - [ ] Files are saved
  - [ ] Status is 'pending'
  - [ ] isVerified is false

- [ ] **POST /register/resend-otp** - Resend OTP
  - [ ] Valid input returns 200 OTP
  - [ ] Missing fields returns 400
  - [ ] Creates/updates OTP record

#### Integration with Existing Auth
- [ ] OTP verification works with new registrations
- [ ] JWT tokens are issued correctly
- [ ] Auth middleware recognizes new roles
- [ ] Role-based access control works

### Load Testing

- [ ] API handles 100+ concurrent requests
- [ ] File upload queue processes correctly
- [ ] Database queries remain fast
- [ ] Memory usage is acceptable

### Error Testing

- [ ] Network error handling
- [ ] File system error handling
- [ ] Database error handling
- [ ] Invalid JSON handling
- [ ] Malformed request handling

### Security Testing

- [ ] File upload tries to upload malicious files
- [ ] SQL injection attempts fail
- [ ] XSS attempts are prevented
- [ ] CSRF protection (if applicable)
- [ ] Invalid token access denied
- [ ] Expired token access denied

---

## Specific Test Cases

### Contact Us Test Case
```javascript
// Test 1: Create contact message
POST /api/v1/contact-us
{
  "name": "Test User",
  "email": "test@example.com",
  "phone": "9876543210",
  "subject": "Test Subject",
  "message": "Test message",
  "category": "general"
}
// Expected: 201 with contactUsId

// Test 2: Get all messages (as admin)
GET /api/v1/contact-us
Headers: Authorization: Bearer <admin_token>
// Expected: 200 with paginated list

// Test 3: Reply to message (as admin)
PUT /api/v1/contact-us/:id/reply
Headers: Authorization: Bearer <admin_token>
{
  "reply": "Thank you for your message"
}
// Expected: 200 with updated message
```

### Restaurant Registration Test Case
```javascript
// Test 1: Initial registration
POST /api/v1/register/restaurant/initial
{
  "businessName": "Test Restaurant",
  "ownerName": "Test Owner",
  "phone": "9876543210",
  "email": "test@restaurant.com",
  "city": "Delhi"
}
// Expected: 200 with confirmation

// Test 2: Complete registration
POST /api/v1/register/restaurant/complete
Form Data:
  businessName: "Test Restaurant"
  ownerName: "Test Owner"
  phone: "9876543210"
  addressLine1: "123 Main St"
  city: "Delhi"
  state: "Delhi"
  pincode: "110001"
  gstNumber: "18AABCT1234H1Z0"
  gstCertificate: <file>
// Expected: 201 with restaurantId

// Test 3: Check status
GET /api/v1/register/registration-status/9876543210
// Expected: 200 with pending status
```

### Rider Registration Test Case
```javascript
// Test 1: Initial registration
POST /api/v1/register/rider/initial
{
  "phone": "9876543210",
  "name": "Test Rider",
  "email": "test@rider.com"
}
// Expected: 200 with confirmation

// Test 2: Verify OTP
POST /api/v1/auth/verify-otp
{
  "phone": "9876543210",
  "otp": "123456",
  "name": "Test Rider",
  "email": "test@rider.com"
}
// Expected: 200 with JWT token

// Test 3: Complete registration
POST /api/v1/register/rider/complete
Form Data:
  phone: "9876543210"
  name: "Test Rider"
  vehicleType: "bike"
  vehicleNo: "DL01AB1234"
  licenseNumber: "DL1234567890"
  licensePhoto: <file>
  vehiclePhoto: <file>
// Expected: 201 with riderId

// Test 4: Check status
GET /api/v1/register/registration-status/9876543210
// Expected: 200 with pending status
```

---

## Manual Testing Steps

### Step 1: Start the Server
```bash
npm install
npm run dev
# Expected: Server running at http://localhost:5000
```

### Step 2: Test Contact Us Form
```bash
# Via cURL
curl -X POST http://localhost:5000/api/v1/contact-us \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test",
    "email": "test@example.com",
    "phone": "9876543210",
    "subject": "Test",
    "message": "Message",
    "category": "general"
  }'

# Expected: 201 response with contactUsId
```

### Step 3: Test Admin Get All
```bash
# First, get admin token by logging in
# Then use it to get all contact messages
curl -X GET http://localhost:5000/api/v1/contact-us \
  -H "Authorization: Bearer <admin_token>"

# Expected: 200 response with array of messages
```

### Step 4: Test Restaurant Registration
```bash
# Initial
curl -X POST http://localhost:5000/api/v1/register/restaurant/initial \
  -H "Content-Type: application/json" \
  -d '{
    "businessName": "Pizza Palace",
    "ownerName": "Raj Kumar",
    "phone": "9876543210",
    "city": "Delhi"
  }'

# Complete (via Postman or form-based tool recommended)
# Due to file upload, use Postman or form submission
```

### Step 5: Test Rider Registration
```bash
# Initial
curl -X POST http://localhost:5000/api/v1/register/rider/initial \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "name": "Amit Singh"
  }'

# Complete (requires OTP verification first, then file upload)
```

---

## Browser Testing

### For Frontend Developers

Test these endpoints using your frontend application:

1. **Contact Form Page**
   - Submit form without attachment
   - Submit form with attachment
   - Test validation messages
   - Test success/error states

2. **Restaurant Registration Page**
   - Test Step 1: Initial form
   - Test Step 2: Complete form with file
   - Test field validation
   - Test file upload progress
   - Test status checking

3. **Rider Registration Page**
   - Test Step 1: Personal info
   - Test Step 2: OTP verification
   - Test Step 3: Complete form with files
   - Test field validation
   - Test multiple file uploads
   - Test status checking

---

## Database Testing

### Check Collections
```javascript
// Connect to MongoDB and run:
use fooddelivery;

// Check ContactUs
db.contactuses.findOne();
db.contactuses.count();

// Check Restaurants
db.restaurants.findOne();
db.restaurants.countDocuments({gstNumber: {$exists: true}});

// Check Riders
db.riders.findOne();
db.riders.countDocuments({licensePhoto: {$exists: true}});

// Check RestaurantUsers
db.restaurantusers.findOne();
```

---

## Performance Testing

### Check API Response Times
```bash
# time the response
time curl http://localhost:5000/api/v1/contact-us

# Expected: < 200ms for normal operations
```

### Monitor File Upload Speed
```bash
# Upload a 5MB file and check speed
# Expected: < 5 seconds for typical network

curl -X POST http://localhost:5000/api/v1/contact-us/with-attachment \
  -F "name=Test" \
  -F "email=test@example.com" \
  -F "phone=9876543210" \
  -F "subject=Test" \
  -F "message=Test" \
  -F "attachment=@large_file.pdf"
```

---

## Post-Deployment Verification

- [ ] All APIs respond correctly
- [ ] File uploads are accessible via `/uploads/`
- [ ] Database operations are successful
- [ ] Admin approval workflow works
- [ ] OTP verification integrates properly
- [ ] JWT tokens are issued correctly
- [ ] Error messages are clear
- [ ] Pagination works
- [ ] Filtering works
- [ ] Sorting works

---

## Rollback Plan

If issues occur after deployment:

1. **Immediate Rollback**
   - Stop the server
   - Revert code changes (git checkout)
   - Remove new routes from app.js
   - Restart server

2. **Database Rollback**
   - Keep backups of all collections
   - Remove ContactUs collection if needed
   - Restore Rider, Restaurant, RestaurantUser if corrupted
   - No data migration needed (backward compatible)

3. **File Cleanup**
   - Remove files from `/uploads/riders/`
   - Remove files from `/uploads/contact-us/`
   - Keep `/uploads/menu-items/` intact

---

## Monitoring & Maintenance

### Daily Checks
- [ ] Check server logs for errors
- [ ] Monitor file upload directory size
- [ ] Check database connection status
- [ ] Review pending registrations

### Weekly Checks
- [ ] Verify file integrity
- [ ] Check disk space usage
- [ ] Review admin dashboard
- [ ] Process pending approvals

### Monthly Analysis
- [ ] Total contact submissions
- [ ] Registration conversion rate
- [ ] Average response time
- [ ] File upload statistics

---

## Support & Troubleshooting

### Common Issues & Solutions

**Issue:** File upload returns 400 error
```
Solution: Check file type and size, ensure MIME type is allowed
```

**Issue:** Restaurant registration phone already exists
```
Solution: Phone already registered with different role, use different phone
```

**Issue:** Admin approval not working
```
Solution: Verify JWT token validity, check admin role in database
```

**Issue:** OTP verification fails
```
Solution: Check OTP expiry (10 minutes), ensure correct phone number
```

---

## Success Criteria

✅ All 13 API endpoints working
✅ File uploads functional
✅ Database operations successful
✅ Admin functions operational
✅ Integration with auth system complete
✅ Error handling comprehensive
✅ Documentation complete
✅ Performance acceptable
✅ Security measures in place
✅ Ready for production

---

**Date:** February 18, 2024  
**Status:** Ready for Testing & Deployment 🚀
