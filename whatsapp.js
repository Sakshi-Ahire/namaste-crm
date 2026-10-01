// WhatsApp Cloud API (Meta). Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
// With no WA_TOKEN set, the app runs in DRY RUN: messages are recorded in the CRM but not sent.
const db = require("./db");
const { waNumber, nowIso, tplSafe } = require("./util");

const TOKEN = process.env.WA_TOKEN || "";
const PHONE_ID = process.env.WA_PHONE_NUMBER_ID || "";
const API_VER = process.env.WA_API_VERSION || "v23.0";
const LANG = process.env.WA_TEMPLATE_LANG || "en";
const DRY_RUN = !TOKEN || !PHONE_ID || process.env.WA_DRY_RUN === "1";
const STORE = process.env.STORE_NAME || "Namaste Mobile";

// Message templates. Business-started messages (outside the customer's 24-hour window) MUST use a template
// that Meta has approved. The text here mirrors what you submit in WhatsApp Manager (see TEMPLATES.md);
// {{1}}, {{2}}… are filled from `params`, in order.
const TEMPLATES = {
  enquiry_greeting: { category: "UTILITY", text: "Namaste {{1}}, thank you for your enquiry at " + STORE + ". {{2}} will help you with the best price, exchange and EMI options. Reply here any time." },
  lead_assigned: { category: "UTILITY", text: "New enquiry for you, {{1}}: {{2}} ({{3}}), interested in {{4}}. Source: {{5}}. Please contact them within 30 minutes." },
  staff_daily_followups: { category: "UTILITY", text: "Good morning {{1}}. Follow-ups due today: {{2}}. Overdue: {{3}}. Start with: {{4}}. Open the CRM for the full list." },
  manager_daily_summary: { category: "UTILITY", text: "Namaste Mobile sales summary for {{1}}. Enquiries: {{2}}. Sold: {{3}}. Lost: {{4}}. Follow-ups pending: {{5}}. Team (new/sold/pending): {{6}}. Open the CRM for details." },
  customer_followup: { category: "MARKETING", text: "Namaste {{1}}, this is {{2}} from " + STORE + ". Are you still looking for the {{3}}? We can share today's best price, exchange value and EMI options. Just reply to this message." },
  purchase_thanks: { category: "UTILITY", text: "Thank you {{1}} for buying your {{2}} from " + STORE + ". For any help with your phone, accessories or service, reply here." },
};

function fill(text, params) {
  return text.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
}

function record({ leadId = null, to, kind, template = null, body, waId = null, status, error = null }) {
  const r = db.prepare(`INSERT INTO messages (lead_id, direction, to_phone, kind, template, body, wa_id, status, error, at)
    VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, ?)`).run(leadId, to, kind, template, body, waId, status, error, nowIso());
  return r.lastInsertRowid;
}

async function callApi(payload) {
  const res = await fetch(`https://graph.facebook.com/${API_VER}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error || {};
    throw new Error(`${e.code || res.status}: ${e.message || "WhatsApp API error"}${e.error_data?.details ? " - " + e.error_data.details : ""}`);
  }
  return json.messages?.[0]?.id || null;
}

/** Free-form text. Only delivered if the recipient messaged us in the last 24 hours. */
async function sendText(to, body, leadId = null) {
  const num = waNumber(to);
  if (DRY_RUN) { record({ leadId, to: num, kind: "text", body, status: "dry-run" }); return { ok: true, dryRun: true }; }
  try {
    const id = await callApi({ to: num, type: "text", text: { body, preview_url: false } });
    record({ leadId, to: num, kind: "text", body, waId: id, status: "sent" });
    return { ok: true, id };
  } catch (err) {
    record({ leadId, to: num, kind: "text", body, status: "failed", error: err.message });
    console.error("[whatsapp] text to", num, "failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Approved template message; works any time. */
async function sendTemplate(to, name, params, leadId = null) {
  const t = TEMPLATES[name];
  if (!t) throw new Error("Unknown template " + name);
  const safe = params.map((p) => tplSafe(p));
  const body = fill(t.text, safe);
  const num = waNumber(to);
  if (DRY_RUN) { record({ leadId, to: num, kind: "template", template: name, body, status: "dry-run" }); return { ok: true, dryRun: true }; }
  try {
    const id = await callApi({
      to: num, type: "template",
      template: { name, language: { code: LANG }, components: [{ type: "body", parameters: safe.map((text) => ({ type: "text", text })) }] },
    });
    record({ leadId, to: num, kind: "template", template: name, body, waId: id, status: "sent" });
    return { ok: true, id };
  } catch (err) {
    record({ leadId, to: num, kind: "template", template: name, body, status: "failed", error: err.message });
    console.error("[whatsapp] template", name, "to", num, "failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/** Customer within the 24h window → free text (cheaper, personal); otherwise the template. */
function windowOpen(lead) {
  return lead.last_inbound_at && Date.now() - Date.parse(lead.last_inbound_at) < 23.5 * 3600e3;
}
async function sendToCustomer(lead, templateName, params, freeText) {
  if (windowOpen(lead) && freeText) return sendText(lead.phone, freeText, lead.id);
  return sendTemplate(lead.phone, templateName, params, lead.id);
}

module.exports = { TEMPLATES, DRY_RUN, sendText, sendTemplate, sendToCustomer, windowOpen, fill };
