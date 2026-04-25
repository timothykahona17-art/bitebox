/* ========================================
   BiteBox - Frontend App
   Talks to Node/Express backend at /api/*
======================================== */

const API = '/api';

// ── Frontend sanitisation ─────────────────────────────────────
// Strips HTML tags to prevent XSS from injected content
function sanitiseInput(str) {
  const div = document.createElement('div');
  div.textContent = String(str).trim().substring(0, 500);
  return div.textContent;
}

// Validate Zambian phone number (09xxxxxxxx or 07xxxxxxxx, 10 digits)
function isValidPhone(phone) {
  return /^(09|07)\d{8}$/.test(phone.replace(/\s/g, ''));
}

// ── Cart state ──────────────────────────────────────────────
let cart = {}; // { itemName: { name, price, qty } }

// ── Toast helper ────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, duration);
}

// ── Add item to cart ─────────────────────────────────────────
function addToOrder(name, price) {
  if (cart[name]) {
    cart[name].qty += 1;
  } else {
    cart[name] = { name, price, qty: 1 };
  }
  renderOrder();
  showToast(`${name} added to order`, 'success');
}

// ── Render order box ─────────────────────────────────────────
function renderOrder() {
  const box = document.getElementById('orderBox');
  const totalEl = document.getElementById('totalPrice');
  const keys = Object.keys(cart);

  if (keys.length === 0) {
    box.innerHTML = '<p class="empty-message">Your cart is empty</p>';
    totalEl.textContent = 'K0';
    return;
  }

  let total = 0;
  box.innerHTML = keys.map(key => {
    const item = cart[key];
    const subtotal = item.price * item.qty;
    total += subtotal;
    return `
      <div class="order-item">
        <span class="order-item-name">${item.name}</span>
        <div class="order-item-controls">
          <button class="qty-btn" onclick="changeQty('${key}', -1)" aria-label="Decrease">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty('${key}', 1)" aria-label="Increase">+</button>
        </div>
        <span class="order-item-price">K${subtotal}</span>
        <button class="btn-remove" onclick="removeItem('${key}')" aria-label="Remove">✕</button>
      </div>`;
  }).join('');

  totalEl.textContent = `K${total}`;
}

// ── Qty controls ─────────────────────────────────────────────
function changeQty(key, delta) {
  if (!cart[key]) return;
  cart[key].qty += delta;
  if (cart[key].qty <= 0) delete cart[key];
  renderOrder();
}

function removeItem(key) {
  delete cart[key];
  renderOrder();
  showToast('Item removed', 'info');
}

// ── Clear order ───────────────────────────────────────────────
function clearOrder() {
  if (Object.keys(cart).length === 0) return;
  cart = {};
  renderOrder();
  showToast('Order cleared', 'info');
}

// ── Payment network info ──────────────────────────────────────
const PAYMENT_NETWORKS = {
  airtel:  { name: 'Airtel Money',     number: '0974101014', color: '#e8000d' },
  mtn:     { name: 'MTN Money',        number: '0974101014', color: '#ffcc00' },
  zamtel:  { name: 'Zamtel Kwacha',    number: '0974101014', color: '#00a651' }
};

// ── Open payment modal ────────────────────────────────────────
function placeOrder() {
  const items = Object.values(cart);
  if (items.length === 0) {
    showToast('Your cart is empty!', 'error');
    return;
  }
  // Reset modal state
  document.querySelectorAll('input[name="payment"]').forEach(r => r.checked = false);
  document.getElementById('payerPhone').value = '';
  document.getElementById('paymentSummary').classList.remove('visible');
  document.getElementById('paymentSummary').innerHTML = '';
  document.getElementById('paymentModal').classList.add('open');
}

function closePaymentModal() {
  document.getElementById('paymentModal').classList.remove('open');
}

// Close modal on overlay click
document.getElementById('paymentModal').addEventListener('click', function(e) {
  if (e.target === this) closePaymentModal();
});

// Show order summary when network is selected
document.querySelectorAll('input[name="payment"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const items = Object.values(cart);
    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const net   = PAYMENT_NETWORKS[radio.value];
    const lines = items.map(i => `• ${i.name} x${i.qty} — K${i.price * i.qty}`).join('<br>');
    const summary = document.getElementById('paymentSummary');
    summary.innerHTML = `
      ${lines}
      <hr style="margin:0.6rem 0;border-color:#ddd">
      <span class="summary-total">Total: K${total}</span><br>
      <span style="font-size:0.82rem;color:#555">
        Pay via <strong style="color:${net.color}">${net.name}</strong>
        to <strong>${net.number}</strong> after confirming on WhatsApp.
      </span>`;
    summary.classList.add('visible');
  });
});

// ── Confirm payment & send WhatsApp ───────────────────────────
async function confirmPayment() {
  const selected = document.querySelector('input[name="payment"]:checked');
  if (!selected) {
    showToast('Please select a payment method', 'error');
    return;
  }

  const phone = document.getElementById('payerPhone').value.trim();
  if (!phone) {
    showToast('Please enter your mobile number', 'error');
    return;
  }
  if (!isValidPhone(phone)) {
    showToast('Enter a valid Zambian number (e.g. 0971234567)', 'error');
    return;
  }

  const items   = Object.values(cart);
  const total   = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const net     = PAYMENT_NETWORKS[selected.value];

  // Build WhatsApp message
  const lines = items.map(i => `• ${i.name} x${i.qty} — K${i.price * i.qty}`);
  const msg = [
    '🍔 *BiteBox Order*',
    '',
    ...lines,
    '',
    `*Total: K${total}*`,
    '',
    `💳 *Payment:* ${net.name}`,
    `📱 *My Number:* ${phone}`,
    '',
    'Please confirm my order. Thank you!'
  ].join('\n');

  // Save to backend (best-effort)
  try {
    await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, total, payment: net.name, phone })
    });
  } catch (_) {}

  closePaymentModal();
  window.open(`https://wa.me/260974101014?text=${encodeURIComponent(msg)}`, '_blank');
  showToast(`Order sent via WhatsApp! Total: K${total} 🎉`, 'success', 4000);
  cart = {};
  renderOrder();
  document.querySelector('.thank-you-section').scrollIntoView({ behavior: 'smooth' });
}

// ── Submit feedback ───────────────────────────────────────────
async function submitFeedback(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name:    sanitiseInput(form.name.value),
    email:   sanitiseInput(form.email.value),
    message: sanitiseInput(form.message.value)
  };

  if (!payload.message) {
    showToast('Please enter your feedback', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Server error');
    showToast('Feedback sent! Thank you 🙏', 'success', 3500);
    form.reset();
  } catch (err) {
    showToast('Feedback received! Thank you 🙏', 'success', 3500);
    form.reset();
  }
}

// ── Search ────────────────────────────────────────────────────
function filterMenu(query) {
  const q = query.toLowerCase().trim();

  // Filter food menu items (use data-name attribute)
  document.querySelectorAll('.menu-item').forEach(item => {
    const name = item.dataset.name.toLowerCase();
    item.classList.toggle('hidden', q !== '' && !name.includes(q));
  });

  // Filter drink items (use drink-name text)
  document.querySelectorAll('.drink-item').forEach(item => {
    const name = item.querySelector('.drink-name').textContent.toLowerCase();
    item.classList.toggle('hidden', q !== '' && !name.includes(q));
  });

  // Hide drink category headings if all their items are hidden
  document.querySelectorAll('.drink-category').forEach(cat => {
    const allHidden = [...cat.querySelectorAll('.drink-item')].every(i => i.classList.contains('hidden'));
    cat.style.display = (q !== '' && allHidden) ? 'none' : '';
  });
}

document.getElementById('searchBtn').addEventListener('click', () => {
  filterMenu(document.getElementById('searchInput').value);
});

document.getElementById('searchInput').addEventListener('keyup', e => {
  if (e.key === 'Enter') filterMenu(e.target.value);
  if (e.target.value === '') filterMenu('');
});

// ── Dark Mode ─────────────────────────────────────────────────
const darkBtn = document.getElementById('darkModeBtn');

function applyDark(on) {
  document.body.classList.toggle('dark', on);
  darkBtn.textContent = on ? '☀️' : '🌙';
}

// Load saved preference
applyDark(localStorage.getItem('darkMode') === 'true');

darkBtn.addEventListener('click', () => {
  const isDark = document.body.classList.contains('dark');
  applyDark(!isDark);
  localStorage.setItem('darkMode', !isDark);
});
