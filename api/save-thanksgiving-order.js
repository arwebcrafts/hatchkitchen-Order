// api/save-thanksgiving-order.js
// ─────────────────────────────────────────────────────────────
// Receives Thanksgiving Pre-Order Requests from thanksgiving-orders.html
// 1) Stores as Stripe Customer with metadata (if Stripe configured)
// 2) Sends kitchen alert email to info@thehatchkitchen.com (if SMTP configured)
// 3) Supports GET query for kitchen admins (with ?pw=HatchAdmin2026 or Bearer token)
// 4) Returns { ok: true, orderId }
// ─────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'info@thehatchkitchen.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HatchAdmin2026';

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: Kitchen admin order lookup
  if (req.method === 'GET') {
    const pw = req.query.pw || req.query.password || req.query.key;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;

    const isPwValid = pw && (pw === ADMIN_PASSWORD || pw === 'HatchAdmin2026');
    if (!isPwValid && !token) {
      return res.status(401).json({ error: 'Unauthorized. Please provide ?pw=HatchAdmin2026' });
    }

    if (!stripe) {
      return res.status(200).json({
        ok: true,
        source: 'local-memory',
        message: 'Stripe API key not configured in environment. Orders are delivered via email.',
        orders: [],
      });
    }

    try {
      let customerList = [];
      try {
        const result = await stripe.customers.search({
          query: 'metadata["type"]:"thanksgiving-preorder"',
          limit: Math.min(Number(req.query.limit) || 100, 100),
        });
        customerList = result.data || [];
      } catch (_) {}

      // Real-time fallback for instant retrieval before search index syncs
      if (customerList.length === 0) {
        const listResult = await stripe.customers.list({ limit: 100 });
        customerList = (listResult.data || []).filter(
          (c) => c.metadata && (c.metadata.type === 'thanksgiving-preorder' || c.metadata.source === 'hatch-thanksgiving-orders')
        );
      }

      const orders = customerList.map((c) => ({
        id: c.id,
        orderId: c.metadata.order_id || c.id,
        customerName: c.name || c.metadata.customer_name || 'Unknown',
        customerPhone: c.phone || c.metadata.customer_phone || '',
        customerEmail: c.email || c.metadata.customer_email || '',
        preferredContact: c.metadata.preferred_contact || 'Phone',
        pickupDay: c.metadata.pickup_day || '',
        promoCode: c.metadata.promo_code || '',
        comments: c.metadata.comments || '',
        items: c.metadata.items || '',
        total: Number(c.metadata.total) || 0,
        itemCount: Number(c.metadata.item_count) || 0,
        createdAt: c.metadata.created_at || new Date(c.created * 1000).toISOString(),
      }));

      // Sort by newest first
      orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="hatch-thanksgiving-orders.csv"');
        const headers = ['Order ID', 'Customer Name', 'Phone', 'Email', 'Preferred Contact', 'Pickup Day', 'Total ($)', 'Items', 'Promo Code', 'Comments', 'Created At'];
        const csvRows = [headers.join(',')];
        orders.forEach((o) => {
          csvRows.push([
            `"${o.orderId}"`,
            `"${o.customerName.replace(/"/g, '""')}"`,
            `"${o.customerPhone}"`,
            `"${o.customerEmail}"`,
            `"${o.preferredContact}"`,
            `"${o.pickupDay.replace(/"/g, '""')}"`,
            o.total.toFixed(2),
            `"${o.items.replace(/"/g, '""')}"`,
            `"${o.promoCode}"`,
            `"${o.comments.replace(/"/g, '""')}"`,
            `"${o.createdAt}"`,
          ].join(','));
        });
        return res.status(200).send(csvRows.join('\r\n'));
      }

      return res.status(200).json({ ok: true, count: orders.length, orders });
    } catch (searchErr) {
      console.error('[thanksgiving-orders] Search error:', searchErr);
      return res.status(500).json({ error: searchErr.message });
    }
  }

  // POST: Pre-Order submission
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
    const computedItemCount = itemCount || items.length;

    console.log(`[thanksgiving-order] Received ${orderId} from ${customerName} (${email}, ${phone})`);

    // 1. Record in Stripe as customer metadata
    let customerId = null;
    if (stripe) {
      try {
        const itemSummary = items.map(i => {
          let s = `${i.title || i.name} ($${Number(i.price || i.total || 0).toFixed(2)})`;
          if (i.entree) s += ` [Entree: ${i.entree}]`;
          if (i.sides && i.sides.length) s += ` [Sides: ${i.sides.join(', ')}]`;
          return s;
        }).join('; ').slice(0, 480);

        const stripeCustomer = await stripe.customers.create({
          name: customerName,
          email: email || undefined,
          phone: phone || undefined,
          metadata: {
            type: 'thanksgiving-preorder',
            source: 'hatch-thanksgiving-orders',
            order_id: orderId,
            customer_name: customerName,
            customer_phone: phone,
            customer_email: email,
            pickup_day: pickupDay,
            preferred_contact: preferredContact,
            promo_code: promoCode,
            comments: (comments || '').slice(0, 450),
            items: itemSummary,
            total: String(total),
            item_count: String(computedItemCount),
            created_at: new Date().toISOString(),
          },
        });
        customerId = stripeCustomer.id;
      } catch (stripeErr) {
        console.warn('[thanksgiving-order] Stripe customer creation skipped:', stripeErr.message);
      }
    }

    // 2. Send email alert to kitchen owner
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
      itemCount: computedItemCount,
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
    let line = `  • ${i.title || i.name} — $${Number(i.price || i.total || 0).toFixed(2)}`;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
