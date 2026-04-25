const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  name:  { type: String, required: true, maxlength: 200 },
  price: { type: Number, required: true, min: 0 },
  qty:   { type: Number, required: true, min: 1, max: 100 }
});

const orderSchema = new mongoose.Schema({
  orderId:   { type: Number, unique: true },
  items:     { type: [orderItemSchema], required: true },
  total:     { type: Number, required: true, min: 0 },
  payment:   { type: String, default: '', maxlength: 50 },
  phone:     { type: String, default: '', maxlength: 20 },
  status:    { type: String, enum: ['received', 'preparing', 'ready', 'delivered'], default: 'received' },
  createdAt: { type: Date, default: Date.now }
});

// Auto-increment orderId before saving
orderSchema.pre('save', async function (next) {
  if (this.isNew) {
    const last = await this.constructor.findOne({}, {}, { sort: { orderId: -1 } });
    this.orderId = last ? last.orderId + 1 : 1001;
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
