// api/notify-order.js
// ─────────────────────────────────────────────────────────────
// After a paid order:
//   1) Owner gets a kitchen alert (Reply-To = customer)
//   2) Customer gets an order confirmation email
//
// ENV (Vercel + .env):
//   STRIPE_SECRET_KEY
//   OWNER_EMAIL     → kitchen inbox (default info@thehatchkitchen.com)
//   SMTP_HOST       → e.g. smtp.gmail.com
//   SMTP_PORT       → 587 (default) or 465
//   SMTP_USER       → mailbox login
//   SMTP_PASS       → app password / SMTP password
//   SMTP_FROM       → optional From display name
// ─────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'info@thehatchkitchen.com';

module.exports = async function handler(req, res) {
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

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { paymentIntentId, order } = req.body || {};

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }
    if (!order || typeof order !== 'object') {
      return res.status(400).json({ error: 'Missing order details' });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment has not succeeded' });
    }

    const paidCents = intent.amount_received || intent.amount;
    const paidFormatted = `$${(paidCents / 100).toFixed(2)}`;
    const currency = (intent.currency || 'usd').toUpperCase();
    const ctx = { order, paidFormatted, currency, paymentIntentId };

    const transporter = createTransporter();
    const from = process.env.SMTP_FROM || `Hatch Kitchen <${process.env.SMTP_USER}>`;

    // 1) Kitchen alert
    await transporter.sendMail({
      from,
      to: OWNER_EMAIL,
      replyTo: order.customerEmail
        ? (order.customerName
          ? `"${String(order.customerName).replace(/"/g, '')}" <${order.customerEmail}>`
          : order.customerEmail)
        : undefined,
      subject: `[Hatch Kitchen] New ${order.type || 'order'} — ${paidFormatted}`,
      text: buildOwnerText(ctx),
      html: buildOwnerHtml(ctx),
    });

    // 2) Customer confirmation
    if (order.customerEmail) {
      const firstName = (order.customerName || '').trim().split(/\s+/)[0] || 'there';
      await transporter.sendMail({
        from,
        to: order.customerEmail,
        replyTo: OWNER_EMAIL,
        subject: `Your Hatch Kitchen order is confirmed — ${paidFormatted}`,
        text: buildCustomerText({ ...ctx, firstName }),
        html: buildCustomerHtml({ ...ctx, firstName }),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[notify-order]', err.message);
    return res.status(500).json({ error: err.message || 'Could not send order email' });
  }
};

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP not configured (need SMTP_HOST, SMTP_USER, SMTP_PASS)');
  }

  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function itemLines(order) {
  return (order.items || []).map((item) => {
    const amt = typeof item.amount === 'number' ? `$${item.amount.toFixed(2)}` : '';
    const disc = item.discount ? ` (discount -$${Number(item.discount).toFixed(2)})` : '';
    return {
      label: item.label || '',
      detail: item.detail || '',
      amt,
      disc,
      amountNum: typeof item.amount === 'number' ? item.amount : null,
      discountNum: item.discount ? Number(item.discount) : 0,
    };
  });
}

function buildOwnerText({ order, paidFormatted, currency, paymentIntentId }) {
  const lines = itemLines(order)
    .map((i) => `  • ${i.label}${i.detail ? ` — ${i.detail}` : ''}  ${i.amt}${i.disc}`)
    .join('\n');

  return [
    `NEW PAID ORDER — Hatch Kitchen`,
    ``,
    `Type: ${order.type || 'Order'}`,
    `Amount paid: ${paidFormatted} ${currency}`,
    `Payment ID: ${paymentIntentId}`,
    ``,
    `CUSTOMER`,
    `Name: ${order.customerName || '—'}`,
    `Email: ${order.customerEmail || '—'}`,
    `Phone: ${order.customerPhone || '—'}`,
    order.extraContact ? `Also: ${order.extraContact}` : null,
    ``,
    order.camp ? `Camp: ${order.camp}` : null,
    order.week ? `Week: ${order.week}` : null,
    order.children ? `Children: ${order.children}` : null,
    order.allergies ? `Allergies / diet: ${order.allergies}` : null,
    order.specialRequests ? `Special requests: ${order.specialRequests}` : null,
    ``,
    `ITEMS`,
    lines || '  (no line items)',
    ``,
    order.notes ? `Notes:\n${order.notes}` : null,
  ]
    .filter((row) => row != null)
    .join('\n');
}

function buildCustomerText({ order, paidFormatted, currency, paymentIntentId, firstName }) {
  const lines = itemLines(order)
    .map((i) => `  • ${i.label}${i.detail ? ` — ${i.detail}` : ''}  ${i.amt}`)
    .join('\n');

  const isVillage = String(order.type || '').toLowerCase().includes('village');

  return [
    `Hi ${firstName},`,
    ``,
    `Thanks for ordering with Hatch Kitchen. Your payment of ${paidFormatted} is confirmed and your order is on our calendar.`,
    ``,
    isVillage
      ? `Pickup: Meals at the Village refrigerator (#303).`
      : `Your camp lunches will be delivered on the days you selected.`,
    ``,
    order.camp ? `Camp: ${order.camp}` : null,
    order.week ? `Week: ${order.week}` : null,
    order.children ? `Children: ${order.children}` : null,
    ``,
    `YOUR ORDER`,
    lines || '  (see receipt)',
    ``,
    `Total paid: ${paidFormatted} ${currency}`,
    `Order / payment ID: ${paymentIntentId}`,
    ``,
    `Questions? Reply to this email or contact us:`,
    `Email: ${OWNER_EMAIL}`,
    `Phone: (424) 455-3195`,
    ``,
    `Hatch Kitchen`,
    `Feel-Good Fuel`,
  ]
    .filter((row) => row != null)
    .join('\n');
}

function buildItemRowsHtml(order, { showDiscount = false } = {}) {
  return itemLines(order)
    .map((item) => {
      const disc = showDiscount && item.discountNum
        ? `<br><span style="color:#b91c1c;font-size:12px;">Discount -$${item.discountNum.toFixed(2)}</span>`
        : '';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">
          <strong>${esc(item.label)}</strong>
          ${item.detail ? `<br><span style="color:#666;font-size:12px;">${esc(item.detail)}</span>` : ''}
          ${disc}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${esc(item.amt)}</td>
      </tr>`;
    })
    .join('');
}

function buildOwnerHtml({ order, paidFormatted, currency, paymentIntentId }) {
  const itemRows = buildItemRowsHtml(order, { showDiscount: true });
  const meta = [
    order.camp ? `<tr><td style="padding:4px 0;color:#666;">Camp</td><td style="padding:4px 0;">${esc(order.camp)}</td></tr>` : '',
    order.week ? `<tr><td style="padding:4px 0;color:#666;">Week</td><td style="padding:4px 0;">${esc(order.week)}</td></tr>` : '',
    order.children ? `<tr><td style="padding:4px 0;color:#666;">Children</td><td style="padding:4px 0;">${esc(order.children)}</td></tr>` : '',
    order.allergies ? `<tr><td style="padding:4px 0;color:#666;">Diet / allergies</td><td style="padding:4px 0;">${esc(order.allergies)}</td></tr>` : '',
    order.specialRequests ? `<tr><td style="padding:4px 0;color:#666;">Requests</td><td style="padding:4px 0;">${esc(order.specialRequests)}</td></tr>` : '',
  ].join('');

  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7f5f0;padding:24px;color:#121110;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e4da;">
    <div style="background:#121110;color:#F3C457;padding:18px 22px;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;">Hatch Kitchen</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">New ${esc(order.type || 'order')} paid</div>
    </div>
    <div style="padding:22px;">
      <div style="font-size:28px;font-weight:800;margin-bottom:4px;">${esc(paidFormatted)}</div>
      <div style="color:#666;font-size:13px;margin-bottom:18px;">${esc(currency)} · Payment ${esc(paymentIntentId)}</div>

      <h3 style="margin:0 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#888;">Customer</h3>
      <p style="margin:0 0 16px;line-height:1.5;">
        <strong>${esc(order.customerName || '—')}</strong><br>
        ${esc(order.customerEmail || '')}<br>
        ${esc(order.customerPhone || '')}
        ${order.extraContact ? `<br>${esc(order.extraContact)}` : ''}
      </p>

      ${meta ? `<table style="width:100%;margin-bottom:16px;font-size:14px;">${meta}</table>` : ''}

      <h3 style="margin:0 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#888;">Items</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${itemRows || '<tr><td style="padding:8px 0;color:#666;">No line items</td></tr>'}
        <tr>
          <td style="padding:12px;font-weight:800;">Total paid</td>
          <td style="padding:12px;text-align:right;font-weight:800;">${esc(paidFormatted)}</td>
        </tr>
      </table>

      ${order.notes ? `<p style="margin-top:16px;padding:12px;background:#f7f5f0;border-radius:8px;font-size:13px;"><strong>Notes</strong><br>${esc(order.notes)}</p>` : ''}
    </div>
  </div>
</body></html>`;
}

function buildCustomerHtml({ order, paidFormatted, currency, paymentIntentId, firstName }) {
  const itemRows = buildItemRowsHtml(order);
  const isVillage = String(order.type || '').toLowerCase().includes('village');
  const fulfillment = isVillage
    ? 'Pickup at the Village refrigerator (#303).'
    : 'Your camp lunches will be delivered on the days you selected.';

  const meta = [
    order.camp ? `<tr><td style="padding:4px 0;color:#666;">Camp</td><td style="padding:4px 0;">${esc(order.camp)}</td></tr>` : '',
    order.week ? `<tr><td style="padding:4px 0;color:#666;">Week</td><td style="padding:4px 0;">${esc(order.week)}</td></tr>` : '',
    order.children ? `<tr><td style="padding:4px 0;color:#666;">Children</td><td style="padding:4px 0;">${esc(order.children)}</td></tr>` : '',
  ].join('');

  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f7f5f0;padding:24px;color:#121110;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e4da;">
    <div style="background:#121110;color:#F3C457;padding:18px 22px;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;">Hatch Kitchen</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px;">Your order is confirmed</div>
    </div>
    <div style="padding:22px;">
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">Hi ${esc(firstName)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#333;">
        Thanks for ordering with Hatch Kitchen. Your payment of <strong>${esc(paidFormatted)}</strong> is confirmed
        and your order is on our calendar.
      </p>
      <p style="margin:0 0 18px;padding:12px 14px;background:#f7f5f0;border-radius:8px;font-size:14px;line-height:1.5;">
        ${esc(fulfillment)}
      </p>

      ${meta ? `<table style="width:100%;margin-bottom:16px;font-size:14px;">${meta}</table>` : ''}

      <h3 style="margin:0 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#888;">Your order</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${itemRows || '<tr><td style="padding:8px 0;color:#666;">Order details on file</td></tr>'}
        <tr>
          <td style="padding:12px;font-weight:800;">Total paid</td>
          <td style="padding:12px;text-align:right;font-weight:800;">${esc(paidFormatted)}</td>
        </tr>
      </table>

      <p style="margin:18px 0 0;font-size:12px;color:#888;">
        Order ID: ${esc(paymentIntentId)} · ${esc(currency)}
      </p>
      <p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#444;">
        Questions? Reply to this email, write <a href="mailto:${esc(OWNER_EMAIL)}" style="color:#4F6B3D;">${esc(OWNER_EMAIL)}</a>,
        or call <a href="tel:+14244553195" style="color:#4F6B3D;">(424) 455-3195</a>.
      </p>
      <p style="margin:18px 0 0;font-size:13px;color:#121110;">
        <strong>Hatch Kitchen</strong><br>
        <span style="color:#888;">Feel-Good Fuel</span>
      </p>
    </div>
  </div>
</body></html>`;
}
