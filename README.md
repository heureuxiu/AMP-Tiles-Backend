# AMP Tiles Admin Backend

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env` file

3. Start the server:
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## API Endpoints

### Authentication Routes

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "Admin User",
  "email": "admin@amptiles.com.au",
  "password": "password123"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@amptiles.com.au",
  "password": "password123"
}
```

#### Get Current User
```http
GET /api/auth/me
Authorization: Bearer <token>
```

#### Update User Details
```http
PUT /api/auth/updatedetails
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "New Name",
  "email": "newemail@example.com"
}
```

#### Update Password
```http
PUT /api/auth/updatepassword
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword"
}
```

#### Logout
```http
POST /api/auth/logout
Authorization: Bearer <token>
```

## Environment Variables

```
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
JWT_EXPIRE=7d
NODE_ENV=development
CLIENT_URL=http://localhost:3000
```

## Database Schema

### User Model
- name (String, required)
- email (String, required, unique)
- password (String, required, hashed)
- role (String, enum: ['admin', 'user'], default: 'admin')
- isActive (Boolean, default: true)
- timestamps (createdAt, updatedAt)
