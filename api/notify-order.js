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

    console.log('[notify-order] Starting for PI:', paymentIntentId);

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') {
      console.error('[notify-order] Payment not succeeded, status:', intent.status);
      return res.status(400).json({ error: 'Payment has not succeeded' });
    }

    const paidCents = intent.amount_received || intent.amount;
    const paidFormatted = `$${(paidCents / 100).toFixed(2)}`;
    const currency = (intent.currency || 'usd').toUpperCase();
    const ctx = { order, paidFormatted, currency, paymentIntentId };

    // Create and verify SMTP connection
    const transporter = createTransporter();
    const from = process.env.SMTP_FROM || `Hatch Kitchen <${process.env.SMTP_USER}>`;

    // Verify SMTP credentials work BEFORE trying to send
    console.log('[notify-order] Verifying SMTP connection...');
    try {
      await transporter.verify();
      console.log('[notify-order] SMTP connection verified OK');
    } catch (verifyErr) {
      console.error('[notify-order] SMTP verification FAILED:', verifyErr.message);
      console.error('[notify-order] SMTP config: host=%s, port=%s, user=%s, pass-length=%d',
        process.env.SMTP_HOST,
        process.env.SMTP_PORT,
        process.env.SMTP_USER,
        (process.env.SMTP_PASS || '').length
      );
      return res.status(500).json({
        error: 'SMTP connection failed: ' + verifyErr.message,
      });
    }

    const results = { ownerEmail: null, customerEmail: null };

    // 1) Kitchen alert — send to owner
    console.log('[notify-order] Sending owner email to:', OWNER_EMAIL);
    try {
      const ownerResult = await sendWithRetry(transporter, {
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
      results.ownerEmail = 'sent';
      console.log('[notify-order] Owner email SENT, messageId:', ownerResult.messageId);
    } catch (ownerErr) {
      results.ownerEmail = 'failed: ' + ownerErr.message;
      console.error('[notify-order] Owner email FAILED:', ownerErr.message);
    }

    // 2) Customer confirmation — always attempt even if owner email failed
    if (order.customerEmail) {
      console.log('[notify-order] Sending customer email to:', order.customerEmail);
      const firstName = (order.customerName || '').trim().split(/\s+/)[0] || 'there';
      try {
        const custResult = await sendWithRetry(transporter, {
          from,
          to: order.customerEmail,
          replyTo: OWNER_EMAIL,
          subject: `Your Hatch Kitchen order is confirmed — ${paidFormatted}`,
          text: buildCustomerText({ ...ctx, firstName }),
          html: buildCustomerHtml({ ...ctx, firstName }),
        });
        results.customerEmail = 'sent';
        console.log('[notify-order] Customer email SENT, messageId:', custResult.messageId);
      } catch (custErr) {
        results.customerEmail = 'failed: ' + custErr.message;
        console.error('[notify-order] Customer email FAILED:', custErr.message);
      }
    } else {
      results.customerEmail = 'skipped (no email provided)';
      console.warn('[notify-order] No customer email provided, skipping customer confirmation');
    }

    // 3) Stamp for dashboard tracking
    try {
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          ...intent.metadata,
          dashboard_status: 'new',
          dashboard_ordered_at: new Date().toISOString(),
        },
      });
      console.log('[notify-order] Dashboard metadata updated OK');
    } catch (metaErr) {
      console.warn('[notify-order] Could not update dashboard metadata:', metaErr.message);
    }

    // Check if either email failed
    const anyFailed = results.ownerEmail !== 'sent' || (order.customerEmail && results.customerEmail !== 'sent');
    if (anyFailed) {
      console.error('[notify-order] One or more emails failed:', JSON.stringify(results));
      return res.status(207).json({
        ok: false,
        warning: 'Some emails may not have been delivered',
        results,
      });
    }

    console.log('[notify-order] All emails sent successfully');
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('[notify-order] UNHANDLED ERROR:', err.message, err.stack);
    return res.status(500).json({ error: err.message || 'Could not send order email' });
  }
};

/**
 * Send an email with up to 2 retries for transient errors.
 */
async function sendWithRetry(transporter, mailOptions, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[notify-order] Retry attempt ${attempt} for email to: ${mailOptions.to}`);
        await sleep(1000 * attempt); // 1s, then 2s backoff
      }
      const result = await transporter.sendMail(mailOptions);
      return result;
    } catch (err) {
      lastErr = err;
      console.warn(`[notify-order] Send attempt ${attempt + 1} failed:`, err.message);
      // Only retry on transient errors (connection issues, timeouts)
      const transient = /ECONN|ETIMEDOUT|ESOCKET|ECONNRESET|ECONNREFUSED|rate|try again/i.test(err.message);
      if (!transient) throw err; // Non-transient (auth, bad address, etc.) — fail immediately
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP not configured (need SMTP_HOST, SMTP_USER, SMTP_PASS)');
  }

  // Trim any whitespace/newline that may have crept in from .env
  const cleanPass = pass.trim();

  const port = Number(process.env.SMTP_PORT || 587);
  console.log('[notify-order] Creating SMTP transporter: host=%s, port=%d, user=%s, passLen=%d',
    host, port, user, cleanPass.length);

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: cleanPass },
    // Timeout settings to avoid hanging
    connectionTimeout: 10000,  // 10s to connect
    greetingTimeout: 10000,    // 10s for SMTP greeting
    socketTimeout: 15000,      // 15s for socket inactivity
    // Force TLS for port 587
    ...(port === 587 ? { requireTLS: true } : {}),
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
