'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Niseko Village Bus — automatic emails (Resend API, no extra dependency)
//
//   received   → to the guest/staff right after booking (pending)
//   confirmed  → to the guest/staff when status becomes 'confirmed'
//   cancelled  → to the guest/staff when status becomes 'cancelled'
//   team       → internal notice for every new reservation / cancellation request
//
// Env vars (Railway → Variables):
//   RESEND_API_KEY   required to send — without it emails are skipped (logged only)
//   MAIL_FROM        e.g. "Niseko Village Bus <bookings@nisekovillagebus.com>"
//   MAIL_REPLY_TO    optional — where guests' replies go (Moxy / Ritz replies go only to their own team email)
//   TEAM_EMAILS      comma-separated — notices for Hilton, Hinode, Hilton NV Staff, Niseko Village Staff
//   TEAM_EMAIL_MOXY  comma-separated — only Moxy guests + Moxy Staff
//   TEAM_EMAIL_RITZ  comma-separated — only Ritz-Carlton guests + Ritz Carlton Staff
//   (if MOXY / RITZ is empty, their notices fall back to TEAM_EMAILS so nothing is lost)
// ═══════════════════════════════════════════════════════════════════════════

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM      = process.env.MAIL_FROM || 'Niseko Village Bus <onboarding@resend.dev>';

// Accepts "a@x.com, b@y.com", "a@x.com; b@y.com", quotes or spaces — keeps only valid addresses
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
function list(v, name) {
  const parts = String(v || '').split(/[,;\s]+/).map(s => s.replace(/^mailto:/i, '').replace(/^["'<(\[]+|["'>)\].]+$/g, '')).filter(Boolean);
  const bad = parts.filter(e => !EMAIL_RE.test(e));
  if (bad.length && name) console.warn(`mail: ignoring invalid address(es) in ${name}: ${bad.join(' ')}`);
  return parts.filter(e => EMAIL_RE.test(e));
}
const MAIL_REPLY_TO = list(process.env.MAIL_REPLY_TO, 'MAIL_REPLY_TO')[0];
// Startup check — shows in the Railway log which version runs and what it understood
const mask = a => a.replace(/^(.).*(@.*)$/, '$1***$2');
console.log(`mail v2: key=${RESEND_API_KEY ? 'set' : 'MISSING'} · from=${MAIL_FROM} · reply_to=${MAIL_REPLY_TO ? mask(MAIL_REPLY_TO) : 'none'}`
  + ` · team=${list(process.env.TEAM_EMAILS, 'TEAM_EMAILS').length} · moxy=${list(process.env.TEAM_EMAIL_MOXY, 'TEAM_EMAIL_MOXY').length}`
  + ` · ritz=${list(process.env.TEAM_EMAIL_RITZ, 'TEAM_EMAIL_RITZ').length}`);
if (/@(gmail|googlemail|yahoo|outlook|hotmail|icloud)\./i.test(MAIL_FROM))
  console.warn('mail: MAIL_FROM uses a public mailbox domain — Resend only sends from your verified domain (e.g. bookings@nisekovillagebus.com)');

// Each notice goes ONLY to its own team: guest bookings by hotel, staff bookings by property
function teamRecipients(r) {
  const isMoxy = r.property ? r.property === 'Moxy Staff'         : r.hotel === 'Moxy';
  const isRitz = r.property ? r.property === 'Ritz Carlton Staff' : r.hotel === 'Ritz-Carlton Reserve';
  const own = isMoxy ? list(process.env.TEAM_EMAIL_MOXY, 'TEAM_EMAIL_MOXY') : isRitz ? list(process.env.TEAM_EMAIL_RITZ, 'TEAM_EMAIL_RITZ') : [];
  return own.length ? own : list(process.env.TEAM_EMAILS, 'TEAM_EMAILS');
}

// Guest replies go ONLY to their own hotel: Moxy → Moxy, Ritz → Ritz, everyone else → MAIL_REPLY_TO
function replyTo(r) {
  const isMoxy = r.property ? r.property === 'Moxy Staff'         : r.hotel === 'Moxy';
  const isRitz = r.property ? r.property === 'Ritz Carlton Staff' : r.hotel === 'Ritz-Carlton Reserve';
  const own = isMoxy ? list(process.env.TEAM_EMAIL_MOXY, 'TEAM_EMAIL_MOXY') : isRitz ? list(process.env.TEAM_EMAIL_RITZ, 'TEAM_EMAIL_RITZ') : [];
  return own.length ? own : (MAIL_REPLY_TO ? [MAIL_REPLY_TO] : undefined);
}

// ── Bus timetable (copy of BUSES_* / STOPS_* in nisekovillagebus.html — keep in sync) ──
const BUS_TIMES = {
  A1:['14:30'], A2:['13:15'], A3:['15:00'], A2b:['13:15'],
  B1a:['7:10','7:15','7:20'], B1b:['7:10','7:15','7:20'], B2:['9:30','9:35','9:40'], B1c:['7:10','7:15','7:20'],
};
const DEPARTURE_STOP = { 'Hilton Niseko Village':0, 'Moxy':0, 'Ritz-Carlton Reserve':1, 'Hinode Hills':2 };
const STOP_NAMES = ['Hilton Niseko Village & Moxy', 'Ritz-Carlton Reserve', 'Hinode Hills'];

function pickup(r) {
  const times = BUS_TIMES[r.bus];
  if (!times) return null;
  if (r.dir === 'arrival') return `${times[0]} · New Chitose Airport (International Terminal) (Bus Stop 98)`;
  const i = DEPARTURE_STOP[r.hotel];
  return i === undefined ? null : `${times[i]} · ${STOP_NAMES[i]}`;
}

// ── Formatting helpers ────────────────────────────────────────────────────
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const busLabel = id => String(id || '').replace(/[a-z]$/, '');       // B1b → B1
const route = dir => dir === 'arrival' ? 'New Chitose Airport → Niseko Village' : 'Niseko Village → New Chitose Airport';
function fmtDate(d) {
  if (!d) return '';
  if (d instanceof Date) {                                            // pg DATE → local midnight
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return String(d).slice(0, 10);
}

function rows(pairs) {
  return pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e6ebf2;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7a8799;white-space:nowrap;vertical-align:top">${esc(k)}</td>
      <td style="padding:10px 0 10px 16px;border-bottom:1px solid #e6ebf2;font-size:15px;color:#1b2a41;text-align:right">${esc(v)}</td>
    </tr>`).join('');
}

function layout({ title, accent, intro, table, outro }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f6fa">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Helvetica,Arial,sans-serif">
        <tr><td style="background:#1a3fa8;padding:22px 32px;color:#ffffff;font-size:12px;letter-spacing:.32em;text-transform:uppercase">Niseko Village Bus</td></tr>
        <tr><td style="padding:32px 32px 8px">
          <div style="font-family:Georgia,serif;font-size:28px;color:#1a3fa8;line-height:1.2">${esc(title)} <em style="color:#c49a4a">${esc(accent)}</em></div>
          <p style="font-size:15px;line-height:1.7;color:#4a5668;margin:16px 0 8px">${intro}</p>
        </td></tr>
        <tr><td style="padding:8px 32px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${table}</table></td></tr>
        <tr><td style="padding:16px 32px 32px;font-size:14px;line-height:1.7;color:#4a5668">${outro || ''}</td></tr>
        <tr><td style="padding:18px 32px;background:#f7f9fc;font-size:12px;color:#7a8799;line-height:1.6">Niseko Village · Hokkaido, Japan<br>This is an automatic message about your shuttle reservation.</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function bookingRows(r) {
  const staff = !!r.property;
  return rows([
    ['Reference', '#' + String(r.id || '').toUpperCase()],
    ['Name', `${r.first} ${r.last}`],
    ['Route', `${busLabel(r.bus)} · ${route(r.dir)}`],
    ['Date', fmtDate(r.date)],
    ['Pickup', pickup(r)],
    ['Hotel', r.hotel],
    [staff ? 'Passengers' : 'Guests', r.guests],
    [staff ? 'Staff ID' : 'Hotel Reservation ID', r.reservation_id ?? r.reservationId],
    ['Property', r.property],
    ['Flight', r.flight],
  ]);
}

// ── Templates ─────────────────────────────────────────────────────────────
const TEMPLATES = {
  received: r => ({
    subject: `Reservation received · ${busLabel(r.bus)} · ${fmtDate(r.date)}`,
    html: layout({
      title: 'Reservation', accent: 'received',
      intro: `Dear ${esc(r.first)}, thank you for your request. Your seat has been registered and our team will confirm it by email shortly.`,
      table: bookingRows(r),
      outro: 'Please keep your reference number — you will need it if you want to cancel. If anything is incorrect, simply reply to this email.',
    }),
  }),
  confirmed: r => ({
    subject: `Reservation confirmed · ${busLabel(r.bus)} · ${fmtDate(r.date)}`,
    html: layout({
      title: 'Reservation', accent: 'confirmed',
      intro: `Dear ${esc(r.first)}, your seat on the Niseko Village Bus is confirmed. Here are your reservation details:`,
      table: bookingRows(r),
      outro: 'Please be at the pickup point 10 minutes before departure. We look forward to welcoming you on board.',
    }),
  }),
  cancelled: r => ({
    subject: `Reservation cancelled · ${busLabel(r.bus)} · ${fmtDate(r.date)}`,
    html: layout({
      title: 'Reservation', accent: 'cancelled',
      intro: `Dear ${esc(r.first)}, the following reservation has been cancelled.`,
      table: bookingRows(r),
      outro: 'If you did not request this cancellation or would like to book another bus, please reply to this email or make a new reservation on our website.',
    }),
  }),
  teamReservation: r => ({
    subject: `New ${r.property ? 'STAFF' : 'guest'} reservation · ${busLabel(r.bus)} · ${fmtDate(r.date)} · ${r.first} ${r.last}`,
    html: layout({
      title: 'New', accent: r.property ? 'staff reservation' : 'reservation',
      intro: 'A new reservation is waiting for confirmation in the admin panel.',
      table: bookingRows(r) + rows([['Email', r.email], ['Phone', r.phone], ['Notes', r.notes]]),
    }),
  }),
  teamCancellation: c => ({
    subject: `Cancellation request · ${c.ref} · ${c.first} ${c.last}`,
    html: layout({
      title: 'Cancellation', accent: 'request',
      intro: 'A guest asked to cancel a reservation. Review it in the admin panel → Cancellations.',
      table: rows([['Reference', c.ref], ['Name', `${c.first} ${c.last}`], ['Email', c.email],
                   ['Date', fmtDate(c.date)], ['Hotel', c.hotel], ['Reason', c.reason]]),
    }),
  }),
};

// ── Sending ───────────────────────────────────────────────────────────────
async function send(to, { subject, html }, reply_to = MAIL_REPLY_TO) {
  to = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!to.length) return;
  if (!RESEND_API_KEY) { console.log(`[mail skipped — no RESEND_API_KEY] ${subject} → ${to.join(', ')}`); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html, reply_to }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()} (reply_to=${JSON.stringify(reply_to)})`);
}

// Fire-and-forget: an email problem must never break a booking or an admin action.
// Sends go one by one (Resend allows ~2 requests/second), so "Confirm all" doesn't hit the limit.
let queue = Promise.resolve();
const pause = ms => new Promise(r => setTimeout(r, ms));
function notify(kind, record, to, reply) {
  const msg = TEMPLATES[kind](record);
  queue = queue
    .then(() => send(to, msg, reply))
    .catch(e => console.error(`mail ${kind} failed:`, e.message))
    .then(() => pause(600));
}

module.exports = {
  reservationReceived:  r => { notify('received', r, r.email, replyTo(r)); notify('teamReservation', r, teamRecipients(r), r.email); },
  reservationConfirmed: r => notify('confirmed', r, r.email, replyTo(r)),
  reservationCancelled: r => notify('cancelled', r, r.email, replyTo(r)),
  cancellationRequested: c => notify('teamCancellation', c, teamRecipients(c)),
  _templates: TEMPLATES,
  _replyTo: replyTo,
  _teamRecipients: teamRecipients,   // for previews/tests
};
