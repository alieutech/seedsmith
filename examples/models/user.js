const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
