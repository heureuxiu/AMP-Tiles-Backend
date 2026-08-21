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

const seedUsers = async () => {
  try {
    await connectDB();

    // 1. Seed Admin User
    let admin = await User.findOne({ email: 'admin@amptiles.com.au' });
    if (!admin) {
      admin = await User.create({
        name: 'Admin User',
        email: 'admin@amptiles.com.au',
        password: 'admin@amptiles.com.au',
        role: 'admin',
      });
      console.log('Admin user created successfully');
    } else {
      console.log('Admin user already exists');
    }

    // 2. Seed Employee User
    let employee = await User.findOne({ email: 'employee@amptiles.com.au' });
    if (!employee) {
      employee = await User.create({
        name: 'Employee User',
        email: 'employee@amptiles.com.au',
        password: 'employee@amptiles.com.au',
        role: 'employee',
      });
      console.log('Employee user created successfully');
    } else {
      // Ensure role is employee
      employee.role = 'employee';
      await employee.save();
      console.log('Employee user updated successfully');
    }

    console.log('\nUsers configured:');
    console.log('1. Admin: admin@amptiles.com.au / admin@amptiles.com.au');
    console.log('2. Employee: employee@amptiles.com.au / employee@amptiles.com.au');

    process.exit();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

seedUsers();
