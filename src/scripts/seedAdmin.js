const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const User = require('../models/User');

// Load env vars from server root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

const seedAdmin = async () => {
  try {
    await connectDB();

    // Check if admin already exists
    const adminExists = await User.findOne({ email: 'admin@amptiles.com.au' });

    if (adminExists) {
      console.log('Admin user already exists');
      process.exit();
    }

    // Create admin user
    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@amptiles.com.au',
      password: 'admin@amptiles.com.au', // Change this in production!
      role: 'admin',
    });

    console.log('Admin user created successfully');
    console.log('Email: admin@amptiles.com.au');
    console.log('Password: admin@amptiles.com.au');
    console.log('\n⚠️  IMPORTANT: Change the password after first login!');

    process.exit();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

seedAdmin();
