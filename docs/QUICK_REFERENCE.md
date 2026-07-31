# Quick Reference & Testing Guide

## Quick API Reference

### Contact Us

```bash
# 1. Submit Contact Form (Public)
POST /api/v1/contact-us
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "subject": "Issue with order",
  "message": "Food arrived late",
  "category": "complaint"
}
```

```bash
# 2. Submit with Attachment (Public)
POST /api/v1/contact-us/with-attachment
Content-Type: multipart/form-data

name=John Doe&email=john@example.com&phone=9876543210&subject=Issue&message=Problem&attachment=<file>
```

```bash
# 3. Get All Messages (Admin)
GET /api/v1/contact-us?status=new&page=1&limit=20
Authorization: Bearer <token>
```

```bash
# 4. Get Specific Message (Admin)
GET /api/v1/contact-us/:id
Authorization: Bearer <token>
```

```bash
# 5. Reply to Message (Admin)
PUT /api/v1/contact-us/:id/reply
Authorization: Bearer <token>
Content-Type: application/json

{
  "reply": "Thank you for your feedback..."
}
```

```bash
# 6. Update Status (Admin)
PUT /api/v1/contact-us/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "closed"
}
```

```bash
# 7. Delete Message (Admin)
DELETE /api/v1/contact-us/:id
Authorization: Bearer <token>
```

---

## Restaurant Registration

```bash
# Step 1: Initial Registration
POST /api/v1/register/restaurant/initial
Content-Type: application/json

{
  "businessName": "Pizza Palace",
  "ownerName": "Raj Kumar",
  "phone": "9876543210",
  "email": "raj@pizzapalace.com",
  "cuisines": "Italian,Continental",
  "city": "Delhi",
  "minOrderAmount": 250
}
```

```bash
# Step 2: Complete Registration
POST /api/v1/register/restaurant/complete
Content-Type: multipart/form-data

businessName=Pizza Palace
ownerName=Raj Kumar
phone=9876543210
email=raj@pizzapalace.com
cuisines=Italian,Continental
addressLine1=123 Main Street
addressLine2=Shop No. 5
city=Delhi
state=Delhi
pincode=110001
latitude=28.7041
longitude=77.1025
gstNumber=18AABCT1234H1Z0
fssaiNumber=1234567890123456
minOrderAmount=250
deliveryFee=50
deliveryTime=30-45 mins
bankAccountNumber=1234567890
bankIFSC=SBIN0001234
upiId=raj@upi
gstCertificate=<file>
```

```bash
# Check Status
GET /api/v1/register/registration-status/9876543210
```

---

## Rider Registration

```bash
# Step 1: Initial Registration
POST /api/v1/register/rider/initial
Content-Type: application/json

{
  "phone": "9876543210",
  "name": "Amit Singh",
  "email": "amit@example.com"
}
```

```bash
# Step 2: Verify OTP (using existing auth endpoint)
POST /api/v1/auth/verify-otp
Content-Type: application/json

{
  "phone": "9876543210",
  "otp": "123456"
}
```

```bash
# Step 3: Complete Registration
POST /api/v1/register/rider/complete
Content-Type: multipart/form-data

phone=9876543210
name=Amit Singh
email=amit@example.com
vehicleType=bike
vehicleNo=DL01AB1234
licenseNumber=DL1234567890
aadharNumber=123456789012
bankAccountNumber=1234567890
bankIFSC=SBIN0001234
licensePhoto=<file>
vehiclePhoto=<file>
```

```bash
# Check Status
GET /api/v1/register/registration-status/9876543210
```

```bash
# Resend OTP
POST /api/v1/register/resend-otp
Content-Type: application/json

{
  "phone": "9876543210",
  "role": "rider"
}
```

---

## Postman Collection Format

```json
{
  "info": {
    "name": "Food Delivery - Contact & Registration APIs",
    "version": "1.0.0"
  },
  "item": [
    {
      "name": "Contact Us",
      "item": [
        {
          "name": "Submit Contact Form",
          "request": {
            "method": "POST",
            "url": "{{baseUrl}}/api/v1/contact-us",
            "header": [
              {"key": "Content-Type", "value": "application/json"}
            ],
            "body": {
              "mode": "raw",
              "raw": "{\"name\": \"John\", \"email\": \"john@example.com\", \"phone\": \"9876543210\", \"subject\": \"Test\", \"message\": \"Test message\", \"category\": \"general\"}"
            }
          }
        }
      ]
    },
    {
      "name": "Restaurant Registration",
      "item": [
        {
          "name": "Initial Registration",
          "request": {
            "method": "POST",
            "url": "{{baseUrl}}/api/v1/register/restaurant/initial"
          }
        }
      ]
    },
    {
      "name": "Rider Registration",
      "item": [
        {
          "name": "Initial Registration",
          "request": {
            "method": "POST",
            "url": "{{baseUrl}}/api/v1/register/rider/initial"
          }
        }
      ]
    }
  ]
}
```

---

## Response Format Examples

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Test Name"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

### Pagination Response
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalItems": 98,
    "hasNext": true,
    "hasPrev": false,
    "limit": 20
  }
}
```

---

## Common HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET/PUT request |
| 201 | Created | Successful POST request (new resource) |
| 400 | Bad Request | Invalid input/validation error |
| 401 | Unauthorized | Missing or invalid token |
| 403 | Forbidden | Not authorized for operation |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Unexpected server error |

---

## URL Parameters & Query Strings

### Contact Us List Filtering
```
GET /api/v1/contact-us?status=new&category=complaint&page=1&limit=20&sortBy=createdAt&sortOrder=desc
```

**Parameters:**
- `status`: new, read, replied, closed
- `category`: general, complaint, suggestion, partnership, support, other
- `page`: 1-based page number
- `limit`: Items per page (default: 20)
- `sortBy`: Field to sort by
- `sortOrder`: asc or desc

---

## File Upload Guidelines

### Allowed File Types
- **Images:** JPG, JPEG, PNG
- **Documents:** PDF, DOC, DOCX

### File Size Limits
- Maximum: 5MB per file

### Upload Fields
```
Content-Type: multipart/form-data

Boundary: ----WebKitFormBoundary7MA4YWxkTrZu0gW

Field 1: licensePhoto (file)
Field 2: vehiclePhoto (file)
Field 3: gstCertificate (file)
Field 4: attachment (file)

Plus all text fields
```

---

## Example JavaScript Fetch Requests

### Contact Us - Basic
```javascript
fetch('http://localhost:5000/api/v1/contact-us', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'John Doe',
    email: 'john@example.com',
    phone: '9876543210',
    subject: 'Issue with order',
    message: 'Food arrived late',
    category: 'complaint'
  })
})
.then(res => res.json())
.then(data => console.log(data));
```

### Contact Us - With File
```javascript
const formData = new FormData();
formData.append('name', 'John Doe');
formData.append('email', 'john@example.com');
formData.append('phone', '9876543210');
formData.append('subject', 'Issue');
formData.append('message', 'Complaint');
formData.append('attachment', fileInput.files[0]);

fetch('http://localhost:5000/api/v1/contact-us/with-attachment', {
  method: 'POST',
  body: formData
})
.then(res => res.json())
.then(data => console.log(data));
```

### Restaurant Registration - Complete
```javascript
const formData = new FormData();
formData.append('businessName', 'Pizza Palace');
formData.append('ownerName', 'Raj Kumar');
formData.append('phone', '9876543210');
formData.append('email', 'raj@pizzapalace.com');
formData.append('addressLine1', '123 Main Street');
formData.append('city', 'Delhi');
formData.append('state', 'Delhi');
formData.append('pincode', '110001');
formData.append('gstNumber', '18AABCT1234H1Z0');
formData.append('gstCertificate', gstFileInput.files[0]);

fetch('http://localhost:5000/api/v1/register/restaurant/complete', {
  method: 'POST',
  body: formData
})
.then(res => res.json())
.then(data => {
  if(data.success) {
    console.log('Restaurant registered:', data.data);
  }
});
```

### Rider Registration - Get Status
```javascript
fetch('http://localhost:5000/api/v1/register/registration-status/9876543210')
.then(res => res.json())
.then(data => {
  console.log('Registration Status:', data.data);
  console.log('Verified:', data.data.isVerified);
  console.log('Role:', data.data.role);
});
```

---

## Example React Component

### Contact Form Component
```jsx
function ContactForm() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
    category: 'general',
    attachment: null
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const form = new FormData();
    Object.keys(formData).forEach(key => {
      form.append(key, formData[key]);
    });

    try {
      const endpoint = formData.attachment ? 
        '/api/v1/contact-us/with-attachment' : 
        '/api/v1/contact-us';
      
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData.attachment ? form : JSON.stringify(formData),
        headers: formData.attachment ? {} : {'Content-Type': 'application/json'}
      });

      const data = await response.json();
      
      if(data.success) {
        alert('Message sent successfully!');
        setFormData({...formData, name: '', email: '', phone: '', subject: '', message: ''});
      } else {
        alert('Error: ' + data.error);
      }
    } catch(error) {
      alert('Error submitting form: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input 
        type="text" 
        placeholder="Name" 
        value={formData.name}
        onChange={(e) => setFormData({...formData, name: e.target.value})}
        required 
      />
      <input 
        type="email" 
        placeholder="Email" 
        value={formData.email}
        onChange={(e) => setFormData({...formData, email: e.target.value})}
        required 
      />
      <input 
        type="tel" 
        placeholder="Phone" 
        value={formData.phone}
        onChange={(e) => setFormData({...formData, phone: e.target.value})}
        required 
      />
      <input 
        type="text" 
        placeholder="Subject" 
        value={formData.subject}
        onChange={(e) => setFormData({...formData, subject: e.target.value})}
        required 
      />
      <textarea 
        placeholder="Message" 
        value={formData.message}
        onChange={(e) => setFormData({...formData, message: e.target.value})}
        required 
      />
      <select 
        value={formData.category}
        onChange={(e) => setFormData({...formData, category: e.target.value})}
      >
        <option value="general">General</option>
        <option value="complaint">Complaint</option>
        <option value="suggestion">Suggestion</option>
        <option value="partnership">Partnership</option>
        <option value="support">Support</option>
      </select>
      <input 
        type="file" 
        onChange={(e) => setFormData({...formData, attachment: e.target.files[0]})}
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
```

---

## Environment Variables Needed

```env
# Already existing
PORT=5000
MDB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname
API_VERSION=v1
JWT_SECRET=your_jwt_secret_key

# Optional (for SMS notifications)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1234567890
```

---

## Troubleshooting Guide

### File Upload Not Working
- Check file size (max 5MB)
- Verify file type is allowed
- Check uploads directory permissions
- Ensure Content-Type is multipart/form-data

### Registration Failed
- Verify phone number is unique
- Check if phone already exists with different role
- Ensure all required fields are provided
- Verify address and phone format

### Admin Operations Not Working
- Check Authorization header has valid JWT token
- Verify user has admin/super-admin role
- Check token expiration
- Verify X-Admin header if required

### Database Connection Issues
- Check MongoDB connection string
- Verify credentials
- Check network connectivity
- Ensure database is running

---

## API Rate Limiting Considerations

Current implementation has no rate limiting. For production:
```javascript
// Add rate limiting middleware
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

---

This quick reference should help you get started quickly! 🚀
