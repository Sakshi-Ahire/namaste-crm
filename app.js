(() => {
const CLOSED = new Set(["Sold", "Lost"]);
const WARM = new Set(["Interested", "Price Shared", "Negotiation", "Booked"]);
const ST_CLS = { "New": "new", "Contacted": "con", "Interested": "int", "Price Shared": "price", "Negotiation": "neg", "Booked": "book", "Sold": "sold", "Lost": "lost", "No Response": "nr" };
const S = { me: null, users: [], statuses: [], sources: [], lostReasons: [], live: false, leads: [], loaded: false,
  tab: "dash", f: { q: "", status: "", owner: "", source: "", due: "open" }, limit: 150, openId: null, detail: null, todayStr: "" };

// ---------- utils ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dayOf(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayOf(d); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (s) => { if (!s) return "—"; if (s === today()) return "Today"; if (s === addDays(1)) return "Tomorrow"; if (s === addDays(-1)) return "Yesterday"; return `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`; };
const fmtTime = (iso) => { const d = new Date(iso); return `${fmtDay(dayOf(d))}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`; };
const rupees = (n) => (n ? "₹" + Number(n).toLocaleString("en-IN") : "");
const cleanPhone = (p) => { let d = String(p || "").replace(/\D/g, "").replace(/^0+/, ""); if (d.length === 12 && d.startsWith("91")) d = d.slice(2); return d; };
const fmtPhone = (p) => { const d = cleanPhone(p); return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : p || ""; };
const pill = (k) => `<span class="pill" style="background:var(--c-${ST_CLS[k] || "new"}-bg);color:var(--c-${ST_CLS[k] || "new"})">${esc(k)}</span>`;
const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || "Unassigned";
const initials = (n) => String(n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const isOpen = (l) => !CLOSED.has(l.status);
const isOverdue = (l) => isOpen(l) && l.next_follow_up && l.next_follow_up < today();
const isDue = (l) => isOpen(l) && l.next_follow_up === today();
const isMgr = () => S.me && S.me.role === "manager";
let toastT; const toast = (m) => { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3000); };

async function api(path, opts = {}) {
  const res = await fetch(path, { method: opts.method || (opts.body ? "POST" : "GET"), headers: opts.body ? { "Content-Type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: "same-origin" });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.noAuthRedirect) { showAuth(false); throw new Error("Please log in"); }
  if (!res.ok) throw new Error(json.error || "Something went wrong");
  return json;
}
async function act(fn, ok) { try { const r = await fn(); if (ok) toast(ok); await refresh(); return r || true; } catch (e) { toast(e.message); return false; } }

// ---------- auth ----------
function showAuth(needsSetup) {
  $("#appRoot").hidden = true;
  $("#authRoot").innerHTML = `<div class="auth"><form class="auth-card" id="authForm">
    <div class="brand"><div class="mark">न</div><div><h1>${esc(document.title)}</h1></div></div>
    <h2>${needsSetup ? "Set up the manager account" : "Log in"}</h2>
    <p>${needsSetup ? "This is the first start. Create the manager login; you add salespeople after this." : "Use your mobile number and PIN."}</p>
    ${needsSetup ? `<div class="field"><label for="aName">Your name</label><input id="aName" required maxlength="60"></div>` : ""}
    <div class="field"><label for="aPhone">Mobile number</label><input id="aPhone" required inputmode="tel" maxlength="14" autocomplete="username"></div>
    <div class="field"><label for="aPin">PIN (4–8 digits)</label><input id="aPin" required inputmode="numeric" type="password" maxlength="8" autocomplete="current-password"></div>
    <div class="err" id="aErr"></div>
    <button class="btn primary" type="submit">${needsSetup ? "Create account" : "Log in"}</button></form></div>`;
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(needsSetup ? "/api/setup" : "/api/login", { body: { name: needsSetup ? $("#aName").value : undefined, phone: $("#aPhone").value, pin: $("#aPin").value }, noAuthRedirect: true });
      $("#authRoot").innerHTML = ""; boot();
    } catch (err) { $("#aErr").textContent = err.message; }
  };
}

// ---------- shell ----------
function setTab(t) {
  if (t === "team" && !isMgr()) t = "dash";
  S.tab = t; try { localStorage.setItem("nm.tab", t); } catch {}
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  ["dash", "leads", "team"].forEach((v) => ($("#view-" + v).hidden = v !== t));
  render();
}
function render() {
  const od = S.leads.filter(isOverdue).length;
  const b = $("#overdueBadge"); b.hidden = !od; b.textContent = od;
  if (S.tab === "dash") renderDash();
  if (S.tab === "leads") renderLeads();
  if (S.tab === "team") renderTeam();
  $("#fab").hidden = S.tab === "team";
}
async function refresh() {
  const r = await api("/api/leads");
  S.leads = r.leads; S.loaded = true;
  render();
  if (S.openId) await loadDetail(S.openId, true);
}
async function loadMe() {
  const r = await api("/api/me");
  Object.assign(S, { me: r.me, users: r.users, statuses: r.statuses, sources: r.sources, lostReasons: r.lostReasons, live: r.whatsappLive });
  $("#whoLine").textContent = `${r.me.name} · ${r.me.role === "manager" ? "Manager" : "Sales"}`;
  $("#teamTab").hidden = !isMgr();
  $("#waState").innerHTML = `<span class="status-dot" style="background:${S.live ? "#1f9d55" : "var(--warn)"}"></span>${S.live ? "WhatsApp live" : "WhatsApp test mode"}`;
}

// ---------- dashboard ----------
function renderDash() {
  const el = $("#view-dash"); const t = today(), mk = t.slice(0, 7);
  if (!S.loaded) { el.innerHTML = `<div class="empty"><b>Loading enquiries…</b></div>`; return; }
  const L = S.leads;
  const todayLeads = L.filter((l) => l.created_day === t), due = L.filter(isDue), over = L.filter(isOverdue);
  const nr = L.filter((l) => l.status === "No Response"), warm = L.filter((l) => WARM.has(l.status));
  const soldToday = L.filter((l) => l.status === "Sold" && l.closed_day === t);
  const monthLeads = L.filter((l) => (l.created_day || "").startsWith(mk));
  const monthSold = L.filter((l) => l.status === "Sold" && (l.closed_day || "").startsWith(mk));
  const conv = monthLeads.length ? Math.round((monthSold.length / monthLeads.length) * 100) : 0;
  const unread = L.filter((l) => l.unread > 0).length;
  const kpi = (key, lbl, val, sub, cls = "") => `<button class="kpi ${cls}" data-go="${key}" type="button"><span class="lbl">${lbl}</span><span class="val num">${val}</span><span class="sub">${sub}</span></button>`;
  let html = `<div class="dash-head"><h2>${isMgr() ? "Today at the store" : "Your day"}</h2><span class="date">${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span></div>
  ${unread ? `<div class="banner"><b>${unread}</b> enquir${unread === 1 ? "y has" : "ies have"} new WhatsApp messages. <button class="link" data-go="unread">Show them</button></div>` : ""}
  <div class="kpis">
    ${kpi("today", "Today's enquiries", todayLeads.length, "received today")}
    ${kpi("due", "Follow-ups today", due.length, "due today", due.length ? "warn" : "")}
    ${kpi("overdue", "Overdue", over.length, "missed follow-ups", over.length ? "alert" : "")}
    ${kpi("nr", "No response", nr.length, "not reachable yet")}
    ${kpi("warm", "Interested", warm.length, "interested to booked")}
    ${kpi("sold", "Converted", soldToday.length, "sold today", soldToday.length ? "good" : "")}
  </div>`;
  const z = (v) => (v ? v : `<span class="zero">0</span>`);
  const sales = S.users.filter((u) => u.role === "sales");
  const rows = sales.map((u) => {
    const mine = L.filter((l) => l.assignee_id === u.id);
    const ml = mine.filter((l) => (l.created_day || "").startsWith(mk)).length;
    const ms = mine.filter((l) => l.status === "Sold" && (l.closed_day || "").startsWith(mk)).length;
    return { u, open: mine.filter(isOpen).length, due: mine.filter(isDue).length, over: mine.filter(isOverdue).length, today: mine.filter((l) => l.created_day === t).length, ms, conv: ml ? Math.round((ms / ml) * 100) : 0 };
  }).filter((r) => r.u.active || r.open).sort((a, b) => b.over - a.over || b.due - a.due || a.u.name.localeCompare(b.u.name));
  const teamTable = rows.length ? `<div class="tablewrap"><table><thead><tr><th>Salesperson</th><th class="n">New today</th><th class="n">Open</th><th class="n">Due today</th><th class="n">Overdue</th><th class="n">Sold (month)</th><th class="n">Conv.</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="click" data-owner="${r.u.id}"><td>${esc(r.u.name)}${r.u.active ? "" : ' <span class="zero">(off)</span>'}</td><td class="n">${z(r.today)}</td><td class="n">${z(r.open)}</td><td class="n">${z(r.due)}</td><td class="n ${r.over ? "hot" : ""}">${z(r.over)}</td><td class="n">${z(r.ms)}</td><td class="n">${r.conv}%</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="help">Add salespeople in Team &amp; WhatsApp to share out enquiries.</p>`;
  const bySrc = S.sources.map((s) => ({ s, n: monthLeads.filter((l) => l.source === s).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const maxS = Math.max(1, ...bySrc.map((x) => x.n));
  const srcBars = bySrc.length ? `<div class="bars">${bySrc.map((x) => `<div class="bar-row"><span>${esc(x.s)}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.n / maxS) * 100}%"></div></div><span class="num" style="text-align:right">${x.n}</span></div>`).join("")}</div>` : `<p class="help">No enquiries this month yet.</p>`;
  const stages = S.statuses.filter((s) => !CLOSED.has(s)).map((s) => ({ k: s, n: L.filter((l) => l.status === s).length }));
  const maxP = Math.max(1, ...stages.map((x) => x.n));
  const pipe = `<div class="bars">${stages.map((x) => `<div class="bar-row"><span>${esc(x.k)}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.n / maxP) * 100}%;background:var(--c-${ST_CLS[x.k]})"></div></div><span class="num" style="text-align:right">${x.n}</span></div>`).join("")}</div>`;
  html += `<div class="grid2"><div class="panel"><h3>${isMgr() ? "Who owns the pending work" : "Your numbers"}</h3>${isMgr() ? teamTable : `<div class="month"><div><b class="num">${L.filter(isOpen).length}</b><span>open enquiries</span></div><div><b class="num">${monthSold.length}</b><span>sold this month</span></div><div><b class="num">${conv}%</b><span>conversion</span></div></div>`}</div>
    <div class="panel"><h3>This month</h3><div class="month"><div><b class="num">${monthLeads.length}</b><span>enquiries</span></div><div><b class="num">${monthSold.length}</b><span>sold</span></div><div><b class="num">${conv}%</b><span>conversion</span></div></div>
    <h3>Where enquiries come from</h3>${srcBars}<h3 style="margin-top:16px">Open pipeline</h3>${pipe}</div></div>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
    const g = b.dataset.go; const f = { q: "", status: "", owner: "", source: "", due: "open" };
    if (g === "today") f.due = "today"; if (g === "due") f.due = "due"; if (g === "overdue") f.due = "overdue"; if (g === "unread") f.due = "unread";
    if (g === "nr") f.status = "No Response"; if (g === "warm") f.due = "warm"; if (g === "sold") { f.status = "Sold"; f.due = "all"; }
    S.f = f; setTab("leads");
  }));
  el.querySelectorAll("[data-owner]").forEach((r) => (r.onclick = () => { S.f = { q: "", status: "", owner: Number(r.dataset.owner), source: "", due: "open" }; setTab("leads"); }));
}

// ---------- leads ----------
function filtered() {
  const f = S.f, q = f.q.trim().toLowerCase(), t = today();
  return S.leads.filter((l) => {
    if (f.owner && l.assignee_id !== f.owner) return false;
    if (f.status && l.status !== f.status) return false;
    if (f.source && l.source !== f.source) return false;
    if (f.due === "open" && !isOpen(l)) return false;
    if (f.due === "due" && !isDue(l)) return false;
    if (f.due === "overdue" && !isOverdue(l)) return false;
    if (f.due === "today" && l.created_day !== t) return false;
    if (f.due === "warm" && !WARM.has(l.status)) return false;
    if (f.due === "closed" && isOpen(l)) return false;
    if (f.due === "unread" && !l.unread) return false;
    if (q) { const hay = `${l.name} ${l.phone} ${l.model} ${l.notes}`.toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  }).sort((a, b) => {
    if (!!b.unread !== !!a.unread) return b.unread ? 1 : -1;
    const ao = isOpen(a), bo = isOpen(b); if (ao !== bo) return ao ? -1 : 1;
    if (ao) { const af = a.next_follow_up || "9999", bf = b.next_follow_up || "9999"; if (af !== bf) return af < bf ? -1 : 1; }
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}
function renderLeads() {
  const el = $("#view-leads"), f = S.f;
  const focusId = document.activeElement && document.activeElement.id;
  const xs = filtered();
  const chips = [["open", "Open"], ["unread", "New messages"], ["due", "Due today"], ["overdue", "Overdue"], ["today", "New today"], ["warm", "Interested"], ["closed", "Closed"], ["all", "All"]];
  el.innerHTML = `<div class="toolbar"><input type="search" id="fQ" placeholder="Search name, mobile number or model" value="${esc(f.q)}" aria-label="Search">
    ${isMgr() ? `<select id="fOwner" aria-label="Salesperson"><option value="">All salespeople</option>${S.users.filter((u) => u.role === "sales").map((u) => `<option value="${u.id}" ${f.owner === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>` : ""}
    <select id="fStatus" aria-label="Stage"><option value="">All stages</option>${S.statuses.map((s) => `<option ${f.status === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    <select id="fSource" aria-label="Source"><option value="">All sources</option>${S.sources.map((s) => `<option ${f.source === s ? "selected" : ""}>${s}</option>`).join("")}</select>
    ${isMgr() ? `<a class="btn small" href="/api/export.csv">Export CSV</a>` : ""}</div>
    <div class="chips">${chips.map(([k, l]) => `<button class="chip" type="button" data-due="${k}" aria-pressed="${f.due === k}">${l}</button>`).join("")}
    ${f.owner ? `<button class="chip" type="button" id="clearOwner" aria-pressed="true">${esc(userName(f.owner))} ✕</button>` : ""}
    <span style="margin-left:auto;color:var(--muted);font-size:13px;align-self:center" class="num">${xs.length} enquir${xs.length === 1 ? "y" : "ies"}</span></div>
    <div class="list" id="leadList"></div>`;
  const list = $("#leadList");
  if (!xs.length) list.innerHTML = S.leads.length ? `<div class="empty"><b>Nothing here</b>No enquiries match these filters.</div>` : `<div class="empty"><b>No enquiries yet</b>WhatsApp messages to your business number appear here by themselves. Tap + New enquiry for walk-ins and calls.</div>`;
  else list.innerHTML = xs.slice(0, S.limit).map((l) => {
    const cls = isOverdue(l) ? "overdue" : isDue(l) ? "due" : "";
    const fu = !isOpen(l) ? `<span class="fu">${l.status} ${fmtDay(l.closed_day)}</span>` : l.next_follow_up ? `<span class="fu ${isOverdue(l) ? "over" : isDue(l) ? "today" : ""}">${isOverdue(l) ? "Overdue · " : "Follow up "}${fmtDay(l.next_follow_up)}</span>` : `<span class="fu over">No follow-up set</span>`;
    return `<button class="lead ${cls}" type="button" data-id="${l.id}">
      <div><div class="nm">${esc(l.name || "Unnamed")} ${l.unread ? `<span class="unread">${l.unread}</span>` : ""}</div><div class="ph num">${esc(fmtPhone(l.phone))}</div></div>
      <div class="c2"><div class="md">${esc(l.model || "—")}${l.budget ? ` · ${rupees(l.budget)}` : ""}</div><div class="meta">${esc(l.source)} · ${fmtDay(l.created_day)}</div></div>
      <div class="c3 meta">${esc(userName(l.assignee_id))}</div><div class="right">${pill(l.status)}${fu}</div></button>`;
  }).join("") + (xs.length > S.limit ? `<button class="btn" id="more" type="button" style="align-self:center">Show more (${xs.length - S.limit} left)</button>` : "");
  const q = $("#fQ"); let t; q.oninput = () => { S.f.q = q.value; clearTimeout(t); t = setTimeout(renderLeads, 150); };
  if (focusId === "fQ") { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  const o = $("#fOwner"); if (o) o.onchange = () => { S.f.owner = Number(o.value) || ""; renderLeads(); };
  $("#fStatus").onchange = (e) => { S.f.status = e.target.value; if (CLOSED.has(e.target.value)) S.f.due = "all"; renderLeads(); };
  $("#fSource").onchange = (e) => { S.f.source = e.target.value; renderLeads(); };
  el.querySelectorAll("[data-due]").forEach((c) => (c.onclick = () => { S.f.due = c.dataset.due; S.limit = 150; renderLeads(); }));
  const co = $("#clearOwner"); if (co) co.onclick = () => { S.f.owner = ""; renderLeads(); };
  list.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => openLead(Number(b.dataset.id))));
  const m = $("#more"); if (m) m.onclick = () => { S.limit += 150; renderLeads(); };
}

// ---------- team & automation (manager) ----------
function renderTeam() {
  const el = $("#view-team");
  const sorted = S.users.slice().sort((a, b) => b.active - a.active || (a.role === "manager" ? -1 : 1) || a.name.localeCompare(b.name));
  el.innerHTML = `<p class="help">New enquiries go automatically to the active salesperson with the fewest open enquiries. Each person logs in with their mobile number and PIN, and gets WhatsApp alerts on that number.</p>
  <form class="add-member" id="addMember"><input id="mName" placeholder="Name" required maxlength="60"><input id="mPhone" placeholder="Mobile (WhatsApp)" required inputmode="tel" maxlength="14"><input id="mPin" placeholder="PIN for login" required inputmode="numeric" maxlength="8"><select id="mRole" style="padding:8px;border:1px solid var(--line);border-radius:9px;background:var(--surface)"><option value="sales">Salesperson</option><option value="manager">Manager</option></select><button class="btn primary" type="submit">Add</button></form>
  <div class="team-list">${sorted.map((u) => { const open = S.leads.filter((l) => l.assignee_id === u.id && isOpen(l)).length;
    return `<div class="member ${u.active ? "" : "off"}"><div class="av">${esc(initials(u.name))}</div><div class="info"><b>${esc(u.name)}</b><span class="num">${u.role === "manager" ? "Manager" : `${open} open`} · ${esc(fmtPhone(u.phone))}${u.active ? "" : " · turned off"}</span></div>
      ${u.id !== S.me.id ? `<button class="btn small" type="button" data-toggle="${u.id}" data-active="${u.active}">${u.active ? "Turn off" : "Turn on"}</button>` : ""}
      <button class="btn small" type="button" data-pin="${u.id}">Reset PIN</button>
      ${open ? `<button class="btn small" type="button" data-redist="${u.id}">Turn off &amp; move ${open} open</button>` : ""}</div>`; }).join("")}</div>
  <h2 class="sec">Automatic WhatsApp messages</h2>
  <p class="help">${S.live ? "WhatsApp is connected. These run every day by themselves (Indian time)." : "Test mode: no WhatsApp keys are set, so messages are saved in each enquiry's chat but not sent. Add the keys from the setup guide to go live."}</p>
  <div class="auto-list">
    <div class="auto-item"><div><b>Instant greeting + enquiry created</b><span>When a customer messages your WhatsApp number, or fills the website form</span></div></div>
    <div class="auto-item"><div><b>Alert to salesperson</b><span>Whenever an enquiry is assigned or reassigned to them</span></div></div>
    <div class="auto-item"><div><b>Morning follow-up list · 9:30 am</b><span>Each salesperson gets their due and overdue enquiries</span></div><button class="btn small" type="button" data-run="reminders">Send now</button></div>
    <div class="auto-item"><div><b>Customer follow-up · 11:00 am</b><span>Interested, Price Shared, Negotiation or No Response, quiet for 2+ days; at most 2 per customer, 3 days apart</span></div><button class="btn small" type="button" data-run="followups">Send now</button></div>
    <div class="auto-item"><div><b>Thank-you after sale</b><span>When an enquiry is marked Sold</span></div></div>
    <div class="auto-item"><div><b>Manager's daily summary · 8:30 pm</b><span>Enquiries, sales, lost, overdue and each salesperson's numbers</span></div><button class="btn small" type="button" data-run="summary">Send now</button></div>
  </div>`;
  $("#addMember").onsubmit = async (e) => { e.preventDefault();
    const ok = await act(() => api("/api/users", { body: { name: $("#mName").value, phone: $("#mPhone").value, pin: $("#mPin").value, role: $("#mRole").value } }), `${$("#mName").value} added`);
    if (ok) { await loadMe(); render(); } };
  el.querySelectorAll("[data-toggle]").forEach((b) => (b.onclick = async () => { await act(() => api(`/api/users/${b.dataset.toggle}`, { method: "PATCH", body: { active: b.dataset.active !== "1" } }), "Updated"); await loadMe(); render(); }));
  el.querySelectorAll("[data-pin]").forEach((b) => (b.onclick = () => pinSheet(Number(b.dataset.pin))));
  el.querySelectorAll("[data-redist]").forEach((b) => (b.onclick = async () => { const r = await act(() => api(`/api/users/${b.dataset.redist}/reassign`, { body: {} })); if (r) toast(`${r.moved} enquiries moved; ${userName(Number(b.dataset.redist))} is turned off`); await loadMe(); render(); }));
  el.querySelectorAll("[data-run]").forEach((b) => (b.onclick = async () => { b.disabled = true; const r = await act(() => api(`/api/jobs/${b.dataset.run}/run`, { body: {} })); b.disabled = false; if (r) toast(`Done · ${r.sent ?? 0} message${r.sent === 1 ? "" : "s"}${S.live ? " sent" : " recorded (test mode)"}`); }));
}
function pinSheet(uid) {
  sheetFrame(`New PIN for ${esc(userName(uid))}`, `<form id="pinF" class="form"><div class="field full"><label for="newPin">New PIN (4–8 digits)</label><input id="newPin" required inputmode="numeric" maxlength="8"></div></form>`,
    `<button class="btn" type="button" id="pinCancel">Cancel</button><button class="btn primary" type="submit" form="pinF">Save PIN</button>`);
  $("#pinCancel").onclick = closeSheet;
  $("#pinF").onsubmit = async (e) => { e.preventDefault(); if (await act(() => api(`/api/users/${uid}`, { method: "PATCH", body: { pin: $("#newPin").value } }), "PIN changed")) closeSheet(); };
}

// ---------- sheets ----------
function closeSheet() { S.openId = null; S.detail = null; $("#sheetRoot").innerHTML = ""; render(); }
function sheetFrame(title, body, foot) {
  $("#sheetRoot").innerHTML = `<div class="scrim" id="scrim"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${title}</h2><button class="x" id="xBtn" type="button" aria-label="Close">×</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ""}</aside>`;
  $("#scrim").onclick = closeSheet; $("#xBtn").onclick = closeSheet;
}
function newLead() {
  const sales = S.users.filter((u) => u.active && u.role === "sales");
  if (!sales.length && isMgr()) { toast("Add a salesperson first"); setTab("team"); return; }
  S.openId = null;
  sheetFrame("New enquiry", `<form class="form" id="nf">
    <div class="field"><label for="nName">Customer name</label><input id="nName" required maxlength="80" autocomplete="off"></div>
    <div class="field"><label for="nPhone">Mobile number</label><input id="nPhone" required inputmode="tel" maxlength="16" placeholder="98765 43210" autocomplete="off"></div>
    <div class="field full" id="dupBox" hidden></div>
    <div class="field"><label for="nSource">Came from</label><select id="nSource">${S.sources.map((s) => `<option>${s}</option>`).join("")}</select></div>
    <div class="field"><label for="nModel">Interested in</label><input id="nModel" maxlength="80" placeholder="e.g. iPhone 16, Galaxy S25"></div>
    <div class="field"><label for="nBudget">Budget (₹)</label><input id="nBudget" inputmode="numeric" maxlength="9" placeholder="25000"></div>
    ${isMgr() ? `<div class="field"><label for="nOwner">Assign to</label><select id="nOwner"><option value="">Automatic (fewest open)</option>${sales.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></div>` : ""}
    <div class="field full checks"><label><input type="checkbox" id="nEx"> Old phone in exchange</label><label><input type="checkbox" id="nEmi"> Wants EMI / finance</label><label><input type="checkbox" id="nGreet" checked> Send WhatsApp greeting</label></div>
    <div class="field full"><label for="nNotes">Notes</label><textarea id="nNotes" maxlength="1000" placeholder="Colour, storage, what they asked…"></textarea></div>
  </form>`, `<button class="btn" type="button" id="cancelN">Cancel</button><button class="btn primary" type="submit" form="nf" id="saveN">Save enquiry</button>`);
  $("#cancelN").onclick = closeSheet; $("#nName").focus();
  $("#nSource").onchange = () => { $("#nGreet").checked = $("#nSource").value !== "Walk-in"; };
  $("#nPhone").oninput = () => {
    const p = cleanPhone($("#nPhone").value), box = $("#dupBox");
    const dup = p.length >= 10 ? S.leads.find((l) => cleanPhone(l.phone) === p && isOpen(l)) : null;
    box.hidden = !dup;
    if (dup) { box.innerHTML = `<div class="warnbox">This number already has an open enquiry: <b>${esc(dup.name)}</b>, ${esc(dup.model || "no model")}, with ${esc(userName(dup.assignee_id))}. <button class="link" type="button" id="openDup">Open it instead</button></div>`; $("#openDup").onclick = () => openLead(dup.id); }
  };
  $("#nf").onsubmit = async (e) => { e.preventDefault(); $("#saveN").disabled = true;
    const body = { name: $("#nName").value, phone: $("#nPhone").value, source: $("#nSource").value, model: $("#nModel").value, budget: String($("#nBudget").value).replace(/\D/g, ""),
      exchange: $("#nEx").checked, emi: $("#nEmi").checked, notes: $("#nNotes").value, greet: $("#nGreet").checked, assignee_id: $("#nOwner") ? Number($("#nOwner").value) || undefined : undefined };
    const r = await act(() => api("/api/leads", { body }));
    $("#saveN") && ($("#saveN").disabled = false);
    if (r) { toast(`Saved and assigned to ${userName(r.lead.assignee_id)}`); closeSheet(); }
  };
}
async function openLead(id) { S.openId = id; await loadDetail(id); }
async function loadDetail(id, quiet) {
  try { S.detail = await api(`/api/leads/${id}`); } catch (e) { if (!quiet) toast(e.message); return; }
  if (S.detail.lead.unread) { api(`/api/leads/${id}`, { method: "PATCH", body: { unread: 0 } }).then(() => { const l = S.leads.find((x) => x.id === id); if (l) l.unread = 0; render(); }).catch(() => {}); }
  renderLeadSheet();
}
function renderLeadSheet() {
  const { lead: l, activity, messages, windowOpen } = S.detail;
  const keep = { note: $("#noteIn")?.value || "", wa: $("#waIn")?.value || "", focus: document.activeElement?.id, scroll: document.querySelector(".sheet-body")?.scrollTop || 0 };
  const quick = [["Today", 0], ["Tomorrow", 1], ["In 2 days", 2], ["In 3 days", 3], ["Next week", 7]];
  const chat = messages.length ? messages.map((m) => `<div class="bubble ${m.direction} ${m.status === "failed" ? "failed" : ""}">${esc(m.body)}<small>${m.direction === "out" ? (m.kind === "template" ? "Auto · " : "") : ""}${fmtTime(m.at)}${m.direction === "out" ? ` · ${m.status === "dry-run" ? "test mode, not sent" : esc(m.status)}` : ""}${m.error ? " · " + esc(m.error) : ""}</small></div>`).join("") : `<p class="help" style="margin:0">No WhatsApp messages yet.</p>`;
  sheetFrame(esc(l.name || "Unnamed"), `
    <div class="contact"><span class="phone">${esc(fmtPhone(l.phone))}</span><a class="btn small" href="tel:+91${esc(cleanPhone(l.phone))}">Call</a>${pill(l.status)}</div>
    <dl class="facts"><dt>Interested in</dt><dd>${esc(l.model || "—")}${l.budget ? ` · budget ${rupees(l.budget)}` : ""}</dd>
      <dt>Extras</dt><dd>${[l.exchange ? "Exchange" : "", l.emi ? "EMI / finance" : ""].filter(Boolean).join(", ") || "—"}</dd>
      <dt>Came from</dt><dd>${esc(l.source)} · ${fmtDay(l.created_day)}</dd><dt>Calls tried</dt><dd class="num">${l.attempts}</dd>
      ${l.notes ? `<dt>Notes</dt><dd>${esc(l.notes)}</dd>` : ""}${l.lost_reason ? `<dt>Lost because</dt><dd>${esc(l.lost_reason)}</dd>` : ""}</dl>
    <div><p class="section-t">WhatsApp</p><div class="chat" id="chat">${chat}</div>
      ${windowOpen ? `<div class="note-row" style="margin-top:8px"><input id="waIn" maxlength="1000" placeholder="Reply on WhatsApp" value="${esc(keep.wa)}"><button class="btn small wa" type="button" id="waSend">Send</button></div>`
        : `<p class="help" style="margin:8px 0 0">The customer hasn't messaged in the last 24 hours, so WhatsApp only allows the approved follow-up message.</p><button class="btn small wa" type="button" id="waTpl" style="margin-top:6px">Send follow-up message</button>`}</div>
    <div><p class="section-t">Log a call or visit</p><div class="quick"><button class="btn small" type="button" data-act="answered">Called, spoke</button><button class="btn small" type="button" data-act="noanswer">Called, no answer</button><button class="btn small" type="button" data-act="visit">Visited store</button></div></div>
    <div><p class="section-t">Stage</p><div class="stage-row">${S.statuses.map((s) => `<button class="stage-btn" type="button" data-st="${s}" aria-pressed="${l.status === s}" style="color:var(--c-${ST_CLS[s]});background:var(--c-${ST_CLS[s]}-bg);border-color:transparent">${s}</button>`).join("")}</div>
      <div id="lostBox" hidden style="margin-top:10px"><div class="field"><label for="lostSel">Reason it was lost</label><select id="lostSel">${S.lostReasons.map((r) => `<option>${r}</option>`).join("")}</select></div><button class="btn small" type="button" id="lostOk" style="margin-top:8px">Mark as lost</button></div></div>
    ${isOpen(l) ? `<div><p class="section-t">Next follow-up · ${l.next_follow_up ? `<span class="${isOverdue(l) ? "hot" : ""}">${fmtDay(l.next_follow_up)}</span>` : "not set"}</p><div class="quick">${quick.map(([t, n]) => `<button class="btn small" type="button" data-fu="${n}">${t}</button>`).join("")}<input type="date" id="fuDate" value="${esc(l.next_follow_up || "")}" aria-label="Pick a date" style="padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg)"></div></div>` : ""}
    ${isMgr() ? `<div class="field"><label for="ownerSel">Salesperson</label><select id="ownerSel">${S.users.filter((u) => u.role === "sales").map((u) => `<option value="${u.id}" ${l.assignee_id === u.id ? "selected" : ""}>${esc(u.name)}${u.active ? "" : " (off)"}</option>`).join("")}${l.assignee_id ? "" : '<option selected value="">Unassigned</option>'}</select></div>` : ""}
    <div><p class="section-t">History</p><div class="note-row"><input id="noteIn" maxlength="500" placeholder="Add a note, e.g. wants 256GB in blue" value="${esc(keep.note)}"><button class="btn small primary" type="button" id="noteBtn">Add</button></div>
      <ul class="log" style="margin-top:12px">${activity.map((e) => `<li><time>${esc(fmtTime(e.at))} · ${esc(e.by)}</time>${esc(e.text)}</li>`).join("")}</ul></div>`, "");
  document.querySelector(".sheet-body").scrollTop = keep.scroll;
  const c = $("#chat"); c.scrollTop = c.scrollHeight;
  if (keep.focus && $("#" + keep.focus)) $("#" + keep.focus).focus();
  const id = l.id;
  const ws = $("#waSend"); if (ws) { const send = async () => { const v = $("#waIn").value.trim(); if (!v) return; if (await act(() => api(`/api/leads/${id}/whatsapp`, { body: { text: v } }), "Sent on WhatsApp")) { $("#waIn") && ($("#waIn").value = ""); } }; ws.onclick = send; $("#waIn").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }; }
  const wt = $("#waTpl"); if (wt) wt.onclick = () => act(() => api(`/api/leads/${id}/whatsapp`, { body: { template: "customer_followup" } }), "Follow-up sent on WhatsApp");
  document.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => act(() => api(`/api/leads/${id}/action`, { body: { act: b.dataset.act } }), "Logged")));
  document.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => {
    const st = b.dataset.st; if (st === l.status) return;
    if (st === "Lost") { $("#lostBox").hidden = false; return; }
    act(() => api(`/api/leads/${id}/status`, { body: { status: st } }), st === "Sold" ? "Marked as sold · thank-you sent on WhatsApp" : `Moved to ${st}`);
  }));
  const lo = $("#lostOk"); if (lo) lo.onclick = () => act(() => api(`/api/leads/${id}/status`, { body: { status: "Lost", lostReason: $("#lostSel").value } }), "Marked as lost");
  document.querySelectorAll("[data-fu]").forEach((b) => (b.onclick = () => act(() => api(`/api/leads/${id}`, { method: "PATCH", body: { next_follow_up: addDays(Number(b.dataset.fu)) } }), `Follow-up: ${fmtDay(addDays(Number(b.dataset.fu)))}`)));
  const fd = $("#fuDate"); if (fd) fd.onchange = () => fd.value && act(() => api(`/api/leads/${id}`, { method: "PATCH", body: { next_follow_up: fd.value } }), `Follow-up: ${fmtDay(fd.value)}`);
  const os = $("#ownerSel"); if (os) os.onchange = () => os.value && act(() => api(`/api/leads/${id}`, { method: "PATCH", body: { assignee_id: Number(os.value) } }), `Assigned to ${userName(Number(os.value))}`);
  const addNote = async () => { const v = $("#noteIn").value.trim(); if (!v) return; if (await act(() => api(`/api/leads/${id}/note`, { body: { text: v } }), "Note added")) $("#noteIn") && ($("#noteIn").value = ""); };
  $("#noteBtn").onclick = addNote; $("#noteIn").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addNote(); } };
}

// ---------- boot ----------
let poll;
async function boot() {
  try { await loadMe(); } catch { return; }
  $("#appRoot").hidden = false;
  let t = null; try { t = localStorage.getItem("nm.tab"); } catch {}
  setTab(["dash", "leads", "team"].includes(t) ? t : "dash");
  await refresh().catch((e) => toast(e.message));
  clearInterval(poll);
  poll = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 20000);
}
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$("#fab").onclick = newLead;
$("#logoutBtn").onclick = async () => { await api("/api/logout", { body: {} }).catch(() => {}); clearInterval(poll); showAuth(false); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#sheetRoot").innerHTML) closeSheet(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.me) refresh().catch(() => {}); });
fetch("/api/state").then((r) => r.json()).then((s) => {
  document.title = s.store + " CRM"; $("#storeName").textContent = s.store;
  if (s.needsSetup) showAuth(true); else if (!s.loggedIn) showAuth(false); else boot();
});
})();
