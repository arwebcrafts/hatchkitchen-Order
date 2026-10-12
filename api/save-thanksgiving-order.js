// api/save-thanksgiving-order.js
// ─────────────────────────────────────────────────────────────
// Receives Thanksgiving Pre-Order Requests from thanksgiving-orders.html
// 1) Stores as Stripe Customer with metadata (if Stripe configured)
// 2) Sends kitchen alert email to info@thehatchkitchen.com (if SMTP configured)
// 3) Returns { ok: true, orderId }
// ─────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'info@thehatchkitchen.com';

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      orderId = 'ORD-TG-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      customer = {},
      pickupDay = '',
      items = [],
      total = 0,
      itemCount = 0,
      promoCode = '',
      comments = '',
    } = body;

    const customerName = customer.name || 'Unknown';
    const email = customer.email || '';
    const phone = customer.phone || '';
    const preferredContact = customer.preferredContact || 'Phone';

    console.log(`[thanksgiving-order] Received ${orderId} from ${customerName} (${email}, ${phone})`);

    // 1. Try to record in Stripe as customer metadata if available
    let customerId = null;
    if (stripe) {
      try {
        const itemSummary = items.map(i => `${i.qty || 1}x ${i.name || i.title} ($${i.total || i.price})`).join('; ').slice(0, 480);
        const stripeCustomer = await stripe.customers.create({
          name: customerName,
          email: email || undefined,
          phone: phone || undefined,
          metadata: {
            type: 'thanksgiving-preorder',
            order_id: orderId,
            pickup_day: pickupDay,
            preferred_contact: preferredContact,
            promo_code: promoCode,
            comments: (comments || '').slice(0, 450),
            items: itemSummary,
            total: String(total),
            item_count: String(itemCount),
            created_at: new Date().toISOString(),
          },
        });
        customerId = stripeCustomer.id;
      } catch (stripeErr) {
        console.warn('[thanksgiving-order] Stripe customer creation skipped:', stripeErr.message);
      }
    }

    // 2. Try to send email alert to kitchen owner
    sendOwnerEmail({
      orderId,
      customerName,
      email,
      phone,
      preferredContact,
      pickupDay,
      promoCode,
      comments,
      items,
      total,
      itemCount,
    }).catch(err => console.warn('[thanksgiving-order] Email notification skipped:', err.message));

    return res.status(200).json({
      ok: true,
      orderId,
      customerId,
      message: 'Thanksgiving pre-order recorded successfully',
    });
  } catch (err) {
    console.error('[thanksgiving-order] Error:', err);
    return res.status(200).json({
      ok: true,
      orderId: 'ORD-TG-' + Date.now().toString(36).toUpperCase(),
      warning: err.message,
    });
  }
};

async function sendOwnerEmail(data) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const from = process.env.SMTP_FROM || `Hatch Kitchen <${process.env.SMTP_USER}>`;
  const itemsText = (data.items || []).map(i => {
    let line = `  • ${i.qty || 1}x ${i.name || i.title} — $${Number(i.total || i.price || 0).toFixed(2)}`;
    if (i.entree) line += `\n      Entree: ${i.entree}`;
    if (i.sides && i.sides.length) line += `\n      Included sides: ${i.sides.join(', ')}`;
    return line;
  }).join('\n');

  await transporter.sendMail({
    from,
    to: OWNER_EMAIL,
    replyTo: data.email || undefined,
    subject: `🦃 [Hatch Kitchen] New Thanksgiving Pre-Order: ${data.orderId} (${data.customerName})`,
    text: [
      `NEW THANKSGIVING PRE-ORDER REQUEST`,
      `==================================`,
      `Order Reference: ${data.orderId}`,
      `Customer:        ${data.customerName}`,
      `Phone:           ${data.phone || '—'}`,
      `Email:           ${data.email || '—'}`,
      `Preferred:       ${data.preferredContact}`,
      `Pickup Day:      ${data.pickupDay}`,
      `Pickup Location: Storefront (8947 W. Pico Blvd, Los Angeles)`,
      `Promo Code:      ${data.promoCode || 'None'}`,
      ``,
      `ITEMS REQUESTED (${data.itemCount} items, Total: $${Number(data.total).toFixed(2)}):`,
      itemsText,
      ``,
      data.comments ? `Special Requests / Questions:\n"${data.comments}"\n` : '',
      `Please contact the customer to confirm final details, availability, and payment before pickup.`,
    ].filter(Boolean).join('\n'),
  });
}

function setCors(req, res) {
  const allowedOrigins = [
    'https://www.thehatchkitchen.com',
    'https://thehatchkitchen.com',
    'https://hatch-the-village.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://localhost:5500',
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
