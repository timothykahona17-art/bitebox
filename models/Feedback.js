const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  name:      { type: String, default: 'Anonymous', maxlength: 100 },
  email:     { type: String, default: '', maxlength: 200 },
  message:   { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
