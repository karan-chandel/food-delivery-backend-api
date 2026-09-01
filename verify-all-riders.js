const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const Rider = require('./models/Rider');

const MDB_URI = process.env.MDB_URI;

if (!MDB_URI) {
  console.error("MDB_URI not found in environment variables.");
  process.exit(1);
}

async function run() {
  try {
    console.log("Connecting to database...");
    await mongoose.connect(MDB_URI);
    console.log("Connected successfully!");

    // Verify all riders in User collection
    const userUpdate = await User.updateMany({ role: 'rider' }, { isVerified: true });
    console.log(`Verified riders in User collection: ${userUpdate.modifiedCount} modified.`);

    // Verify all riders in Rider collection
    const riderUpdate = await Rider.updateMany({}, { isVerified: true });
    console.log(`Verified riders in Rider collection: ${riderUpdate.modifiedCount} modified.`);

  } catch (err) {
    console.error("Error running script:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from database.");
  }
}

run();
