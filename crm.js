// Core CRM rules: assignment, stages, follow-ups, and the WhatsApp messages they trigger.
const db = require("./db");
const wa = require("./whatsapp");
const { today, addDays, nowIso, cleanPhone, fmtDay } = require("./util");

const STATUSES = ["New", "Contacted", "Interested", "Price Shared", "Negotiation", "Booked", "Sold", "Lost", "No Response"];
const CLOSED = new Set(["Sold", "Lost"]);
const WARM = new Set(["Interested", "Price Shared", "Negotiation", "Booked"]);
const SOURCES = ["WhatsApp", "Walk-in", "Phone call", "Instagram", "Facebook", "Website", "Referral", "Other"];
const LOST_REASONS = ["Price too high", "Bought elsewhere", "Model not in stock", "Just enquiring", "Not reachable", "Other"];
const NEXT_GAP = { New: 0, Contacted: 1, Interested: 1, "Price Shared": 1, Negotiation: 1, Booked: 1, "No Response": 3 };

const getLead = (id) => db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
const getUser = (id) => db.prepare("SELECT id, name, phone, role, active FROM users WHERE id = ?").get(id);
const userName = (id) => (id && getUser(id)?.name) || "Unassigned";

function log(leadId, by, text) {
  db.prepare("INSERT INTO activity (lead_id, at, by, text) VALUES (?, ?, ?, ?)").run(leadId, nowIso(), by, String(text).slice(0, 1000));
}

/** Active salesperson with the fewest open enquiries, then fewest received today. */
function pickAssignee() {
  const row = db.prepare(`
    SELECT u.id,
      (SELECT COUNT(*) FROM leads l WHERE l.assignee_id = u.id AND l.status NOT IN ('Sold','Lost')) AS open_n,
      (SELECT COUNT(*) FROM leads l WHERE l.assignee_id = u.id AND l.created_day = ?) AS today_n
    FROM users u WHERE u.active = 1 AND u.role = 'sales'
    ORDER BY open_n ASC, today_n ASC, u.name ASC LIMIT 1`).get(today());
  return row ? row.id : null;
}

function findOpenByPhone(phone) {
  return db.prepare("SELECT * FROM leads WHERE phone = ? AND status NOT IN ('Sold','Lost') ORDER BY id DESC LIMIT 1").get(cleanPhone(phone));
}

/**
 * Create an enquiry. Sends: greeting to the customer (unless they are walk-in / told otherwise)
 * and a WhatsApp alert to the assigned salesperson.
 */
async function createLead(input, by = "System", opts = {}) {
  const now = new Date();
  const phone = cleanPhone(input.phone);
  if (phone.length < 10) throw Object.assign(new Error("Enter a valid 10-digit mobile number"), { status: 400 });
  const assignee = input.assignee_id ? Number(input.assignee_id) : pickAssignee();
  const source = SOURCES.includes(input.source) ? input.source : "Other";
  const info = db.prepare(`INSERT INTO leads (name, phone, source, model, budget, exchange, emi, notes, status, assignee_id,
      next_follow_up, created_at, created_day, last_inbound_at, unread, updated_at)
    VALUES (@name, @phone, @source, @model, @budget, @exchange, @emi, @notes, 'New', @assignee, @nfu, @created_at, @created_day, @lin, @unread, @created_at)`).run({
    name: String(input.name || "").trim().slice(0, 80), phone, source,
    model: String(input.model || "").trim().slice(0, 80), budget: Number(input.budget) || 0,
    exchange: input.exchange ? 1 : 0, emi: input.emi ? 1 : 0, notes: String(input.notes || "").trim().slice(0, 1000),
    assignee, nfu: today(), created_at: now.toISOString(), created_day: today(),
    lin: opts.inbound ? now.toISOString() : null, unread: opts.inbound ? 1 : 0,
  });
  const id = info.lastInsertRowid;
  log(id, by, `Enquiry added from ${source}, assigned to ${userName(assignee)}`);
  const lead = getLead(id);

  if (opts.onCreated) opts.onCreated(lead);
  // 1) greeting to the customer
  const sendGreeting = opts.greet ?? (source !== "Walk-in");
  if (sendGreeting) {
    const staff = assignee ? userName(assignee) : "Our team";
    const first = lead.name ? lead.name.split(" ")[0] : "";
    const text = `Namaste${first ? " " + first : ""}, thank you for contacting ${process.env.STORE_NAME || "Namaste Mobile"}! ${staff} will get back to you shortly with the best price, exchange and EMI options${lead.model ? " for the " + lead.model : ""}.`;
    await wa.sendToCustomer(lead, "enquiry_greeting", [first || "there", staff], text);
    log(id, "WhatsApp", "Greeting sent to customer");
  }
  // 2) alert to the salesperson
  if (assignee) await alertAssignee(lead, assignee);
  return getLead(id);
}

async function alertAssignee(lead, userId) {
  const u = getUser(userId);
  if (!u || !u.phone) return;
  await wa.sendTemplate(u.phone, "lead_assigned", [u.name.split(" ")[0], lead.name || "Customer", lead.phone, lead.model || "not specified", lead.source], lead.id);
}

function touch(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = @${k}`).join(", ");
  db.prepare(`UPDATE leads SET ${set}, updated_at = @__u WHERE id = @__id`).run({ ...patch, __u: nowIso(), __id: id });
}

async function setStatus(id, status, by, lostReason) {
  const l = getLead(id);
  if (!l || !STATUSES.includes(status) || l.status === status) return l;
  const patch = { status };
  if (CLOSED.has(status)) { patch.closed_day = today(); patch.next_follow_up = null; }
  else { patch.closed_day = null; patch.lost_reason = null; patch.next_follow_up = addDays(NEXT_GAP[status] ?? 1); }
  if (status === "Lost") patch.lost_reason = LOST_REASONS.includes(lostReason) ? lostReason : "Other";
  touch(id, patch);
  log(id, by, `Stage: ${l.status} → ${status}${status === "Lost" ? ` (${patch.lost_reason})` : ""}`);
  if (status === "Sold" && process.env.AUTO_THANKS !== "0") {
    const lead = getLead(id);
    const first = lead.name ? lead.name.split(" ")[0] : "";
    await wa.sendToCustomer(lead, "purchase_thanks", [first || "", lead.model || "new phone"],
      `Thank you${first ? " " + first : ""} for buying your ${lead.model || "new phone"} from ${process.env.STORE_NAME || "Namaste Mobile"}! For any help with your phone, accessories or service, just message us here.`);
    log(id, "WhatsApp", "Thank-you message sent");
  }
  return getLead(id);
}

async function logAction(id, act, by) {
  const l = getLead(id);
  if (!l) return null;
  const later = l.next_follow_up && l.next_follow_up > today() ? l.next_follow_up : addDays(1);
  if (act === "answered") {
    touch(id, { attempts: 0, status: ["New", "No Response"].includes(l.status) ? "Contacted" : l.status, next_follow_up: later });
    log(id, by, "Called, spoke to customer");
  } else if (act === "noanswer") {
    const n = l.attempts + 1;
    const nr = n >= 3 && !CLOSED.has(l.status) && !WARM.has(l.status);
    touch(id, { attempts: n, status: nr ? "No Response" : l.status, next_follow_up: addDays(nr ? 3 : 1) });
    log(id, by, `Called, no answer (attempt ${n})${nr ? "; moved to No Response" : ""}`);
  } else if (act === "visit") {
    touch(id, { status: ["New", "Contacted", "No Response"].includes(l.status) ? "Interested" : l.status });
    log(id, by, "Customer visited the store");
  } else return l;
  return getLead(id);
}

/** Incoming WhatsApp message from a customer (from the webhook). */
async function handleInbound({ from, name, text, waId }) {
  const phone = cleanPhone(from);
  // A staff member writing to the business number: just record it, never create an enquiry.
  const staff = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
  const saveIn = (leadId) => db.prepare(`INSERT INTO messages (lead_id, direction, to_phone, kind, body, wa_id, status, at) VALUES (?, 'in', ?, 'text', ?, ?, 'received', ?)`)
    .run(leadId, phone, text || "[media]", waId || null, nowIso());
  let lead = staff ? null : findOpenByPhone(phone);
  if (!staff && !lead) {
    // record the customer's message first so the chat reads in order, then greet + alert
    lead = await createLead({ name: name || "", phone, source: "WhatsApp", notes: text ? `First message: ${text}` : "" }, "WhatsApp",
      { inbound: true, greet: true, onCreated: (l) => saveIn(l.id) });
    return getLead(lead.id);
  }
  saveIn(lead ? lead.id : null);
  if (lead) {
    touch(lead.id, { last_inbound_at: nowIso(), unread: lead.unread + 1, ...(lead.status === "No Response" ? { status: "Contacted", next_follow_up: today() } : {}) });
    if (lead.status === "No Response") log(lead.id, "WhatsApp", "Customer replied; moved back to Contacted");
  }
  return lead ? getLead(lead.id) : null;
}

module.exports = { STATUSES, CLOSED, WARM, SOURCES, LOST_REASONS, getLead, getUser, userName, log, pickAssignee, findOpenByPhone,
  createLead, alertAssignee, touch, setStatus, logAction, handleInbound, fmtDay };
