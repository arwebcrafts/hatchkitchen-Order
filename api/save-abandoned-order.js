// api/save-abandoned-order.js
// ─────────────────────────────────────────────────────────────
// Captures form data when a user fills out the village order form
// but leaves without completing payment.
//
// Stores as a Stripe Customer with metadata — zero extra infrastructure.
// POST /api/save-abandoned-order (also accepts sendBeacon format)
// ─────────────────────────────────────────────────────────────

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'info@thehatchkitchen.com';

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const {
      residentInfo = {},
      contactInfo = {},
      items = [],
      total = 0,
      itemCount = 0,
      week = '',
      step = 1,
    } = body;

    // Must have at least some identifying info
    const hasResident = !!(residentInfo.first || residentInfo.last);
    const hasContact = !!(contactInfo.email || contactInfo.phone);
    const hasMeals = itemCount > 0;

    if (!hasResident && !hasContact) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'No identifying info' });
    }

    // Check for duplicate: don't create if same email already abandoned recently
    const email = contactInfo.email || '';
    if (email) {
      try {
        const existing = await stripe.customers.search({
          query: `email:"${email}" AND metadata["type"]:"abandoned-village-order"`,
          limit: 1,
        });
        if (existing.data.length > 0) {
          const existingCustomer = existing.data[0];
          const createdAt = existingCustomer.created * 1000;
          const hoursSince = (Date.now() - createdAt) / (1000 * 60 * 60);
          // Don't create duplicate if abandoned within last 2 hours
          if (hoursSince < 2) {
            // Update existing instead
            await stripe.customers.update(existingCustomer.id, {
              metadata: {
                ...existingCustomer.metadata,
                items: items.map((i) => i.label || i.name).join('; ').slice(0, 500),
                total: String(total),
                item_count: String(itemCount),
                step_reached: String(step),
                updated_at: new Date().toISOString(),
              },
            });
            return res.status(200).json({ ok: true, updated: existingCustomer.id });
          }
        }
      } catch (_) {
        /* search may fail, continue to create new */
      }
    }

    // Create Stripe Customer to track the abandoned order
    const customerName = [residentInfo.first, residentInfo.last].filter(Boolean).join(' ') || 'Unknown';
    const contactName = [contactInfo.first, contactInfo.last].filter(Boolean).join(' ') || '';

    const customer = await stripe.customers.create({
      name: customerName,
      email: email || undefined,
      phone: contactInfo.phone || residentInfo.phone || undefined,
      metadata: {
        type: 'abandoned-village-order',
        resident_name: customerName,
        contact_name: contactName,
        contact_email: email,
        contact_phone: contactInfo.phone || '',
        resident_phone: residentInfo.phone || '',
        allergies: (residentInfo.allergies || '').slice(0, 500),
        special_requests: (residentInfo.requests || '').slice(0, 500),
        week: week,
        items: items.map((i) => i.label || i.name).join('; ').slice(0, 500),
        total: String(total),
        item_count: String(itemCount),
        step_reached: String(step),
        abandoned_at: new Date().toISOString(),
        followed_up: 'false',
      },
    });

    // Send email notification to owner (async, don't block response)
    sendAbandonedNotification({
      customerName,
      contactName,
      email,
      phone: contactInfo.phone || residentInfo.phone || '',
      week,
      items,
      total,
      itemCount,
      step,
    }).catch((err) => console.warn('[abandoned-email]', err.message));

    return res.status(200).json({ ok: true, id: customer.id });
  } catch (err) {
    console.error('[save-abandoned-order]', err.message);
    // Don't fail the response — this is best-effort tracking
    return res.status(200).json({ ok: false, error: err.message });
  }
};

async function sendAbandonedNotification(data) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return;

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const from = process.env.SMTP_FROM || `Hatch Kitchen <${user}>`;
  const stepLabel = ['', 'Menu Selection', 'Resident Info', 'Payment'][data.step] || `Step ${data.step}`;

  await transporter.sendMail({
    from,
    to: OWNER_EMAIL,
    subject: `[Hatch Kitchen] Abandoned order — ${data.customerName} ($${Number(data.total).toFixed(2)})`,
    text: [
      `ABANDONED ORDER ALERT`,
      ``,
      `A customer started an order but left without paying.`,
      ``,
      `Resident: ${data.customerName}`,
      `Contact: ${data.contactName || '—'}`,
      `Email: ${data.email || '—'}`,
      `Phone: ${data.phone || '—'}`,
      `Week: ${data.week || '—'}`,
      `Got to: ${stepLabel}`,
      `Items: ${data.itemCount}`,
      `Cart total: $${Number(data.total).toFixed(2)}`,
      ``,
      data.items.length
        ? `Selected meals:\n${data.items.map((i) => `  • ${i.label || i.name} — $${Number(i.amount || 0).toFixed(2)}`).join('\n')}`
        : '',
      ``,
      `Consider reaching out with a discount or reminder.`,
      `View in dashboard: https://www.thehatchkitchen.com/dashboard.html`,
    ]
      .filter((r) => r != null)
      .join('\n'),
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
