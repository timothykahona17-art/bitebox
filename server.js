require('dotenv').config();

const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const cors      = require('cors');
const xss       = require('xss');
const mongoose  = require('mongoose');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const path      = require('path');

const Order    = require('./models/Order');
const Feedback = require('./models/Feedback');

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'bitebox-dev-secret';

// ── MongoDB ───────────────────────────────────────────────────
if (process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('<username>')) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB:', err.message));
} else {
  console.log('⚠️  No MongoDB URI set — running without database (orders/feedback stored in memory only)');
}

// ── Helmet ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https://images.unsplash.com"],
      connectSrc: ["'self'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    // Allow all origins in production (Render handles HTTPS)
    // For stricter control, set ALLOWED_ORIGIN env var
    if (!origin) return cb(null, true);
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    const allowed = [
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      process.env.ALLOWED_ORIGIN
    ].filter(Boolean);
    if (allowed.some(a => origin.startsWith(a))) return cb(null, true);
    // Allow same render domain
    if (origin.includes('onrender.com')) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Body parser ───────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ── Rate limiters ─────────────────────────────────────────────
const apiLimit      = rateLimit({ windowMs: 15*60*1000, max: 100, standardHeaders: true, legacyHeaders: false });
const orderLimit    = rateLimit({ windowMs: 15*60*1000, max: 20,  message: { error: 'Too many orders. Try again later.' } });
const feedbackLimit = rateLimit({ windowMs: 60*60*1000, max: 10,  message: { error: 'Too many submissions. Try again later.' } });
const loginLimit    = rateLimit({ windowMs: 15*60*1000, max: 10,  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

app.use('/api/', apiLimit);

// ── Static files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── Helpers ───────────────────────────────────────────────────
const clean = v => xss(String(v || '').trim()).substring(0, 500);

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return false;
  return items.every(i =>
    typeof i.name  === 'string' && i.name.trim().length > 0 &&
    typeof i.price === 'number' && i.price >= 0 &&
    typeof i.qty   === 'number' && i.qty >= 1 && i.qty <= 100
  );
}

// ── JWT middleware ────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorised — please log in.' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please log in again.' });
  }
}

// ════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════

// POST /api/admin/login
app.post('/api/admin/login', loginLimit, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required.' });

  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminHash = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('bitebox2026', 10);

  if (username !== adminUser || !bcrypt.compareSync(password, adminHash))
    return res.status(401).json({ error: 'Invalid username or password.' });

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  console.log('[ADMIN] Login successful');
  res.json({ success: true, token });
});

// Serve admin panel
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ════════════════════════════════════════
//  ORDER ROUTES
// ════════════════════════════════════════

// POST /api/orders  (public — customers place orders)
app.post('/api/orders', orderLimit, async (req, res) => {
  const { items, payment, phone } = req.body;

  if (!validateItems(items))
    return res.status(400).json({ error: 'Invalid order data.' });

  const cleanItems = items.map(i => ({
    name:  clean(i.name),
    price: Math.abs(parseFloat(i.price) || 0),
    qty:   Math.floor(Math.abs(parseInt(i.qty) || 1))
  }));

  const total = cleanItems.reduce((sum, i) => sum + i.price * i.qty, 0);

  try {
    const order = await Order.create({
      items: cleanItems, total,
      payment: clean(payment),
      phone:   clean(phone)
    });
    console.log(`[ORDER] #${order.orderId} — K${total} via ${order.payment || 'unspecified'}`);
    res.status(201).json({ success: true, orderId: order.orderId, message: 'Order received!' });
  } catch (err) {
    console.error('[ORDER ERROR]', err.message);
    res.status(500).json({ error: 'Could not save order.' });
  }
});

// GET /api/orders  (admin only)
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(200);
    res.json(orders);
  } catch {
    res.status(500).json({ error: 'Could not fetch orders.' });
  }
});

// PATCH /api/orders/:id/status  (admin only — update order status)
app.patch('/api/orders/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const allowed = ['received', 'preparing', 'ready', 'delivered'];
  if (!allowed.includes(status))
    return res.status(400).json({ error: 'Invalid status.' });
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ success: true, order });
  } catch {
    res.status(500).json({ error: 'Could not update order.' });
  }
});

// ════════════════════════════════════════
//  FEEDBACK ROUTES
// ════════════════════════════════════════

// POST /api/feedback  (public — customers submit feedback)
app.post('/api/feedback', feedbackLimit, async (req, res) => {
  const { name, email, message } = req.body;

  if (!message || message.trim().length < 3)
    return res.status(400).json({ error: 'Feedback message required (min 3 chars).' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });

  try {
    await Feedback.create({ name: clean(name), email: clean(email), message: clean(message) });
    res.status(201).json({ success: true, message: 'Feedback received, thank you!' });
  } catch (err) {
    res.status(500).json({ error: 'Could not save feedback.' });
  }
});

// GET /api/feedback  (admin only)
app.get('/api/feedback', requireAuth, async (req, res) => {
  try {
    const fb = await Feedback.find().sort({ createdAt: -1 }).limit(200);
    res.json(fb);
  } catch {
    res.status(500).json({ error: 'Could not fetch feedback.' });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// ── Catch-all → serve frontend ────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`\n🍔 BiteBox running → http://localhost:${PORT}`);
  console.log(`   Admin panel   → http://localhost:${PORT}/admin\n`);
});
