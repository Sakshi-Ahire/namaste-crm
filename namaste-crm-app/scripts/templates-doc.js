// Regenerates TEMPLATES.md from src/whatsapp.js:  node scripts/templates-doc.js
const fs = require("fs");
const path = require("path");
const { TEMPLATES } = require("../src/whatsapp.js");
const samples = {
  enquiry_greeting: ["Amit", "Ravi"],
  lead_assigned: ["Ravi", "Amit Joshi", "9876543210", "iPhone 16", "WhatsApp"],
  staff_daily_followups: ["Ravi", "4", "2", "Amit Joshi (iPhone 16), Pooja Rane (Galaxy S25)"],
  manager_daily_summary: ["1 Oct 2026", "52", "9", "6", "14", "Ravi 6/2/1; Sneha 5/1/0"],
  customer_followup: ["Amit", "Ravi", "iPhone 16"],
  purchase_thanks: ["Amit", "iPhone 16"],
};
const when = {
  enquiry_greeting: "To customers from the website/Instagram/Facebook form and enquiries added by staff. A customer who messages you first gets a normal reply instead (no template needed).",
  lead_assigned: "To the salesperson, each time an enquiry is assigned or reassigned to them.",
  staff_daily_followups: "To each salesperson at 9:30 am, if they have follow-ups due or overdue.",
  manager_daily_summary: "To each manager at 8:30 pm.",
  customer_followup: "To quiet customers at 11:00 am, and when a salesperson taps \"Send follow-up message\".",
  purchase_thanks: "To the customer when an enquiry is marked Sold (a normal reply is used if they messaged in the last 24 hours).",
};
let o = `# WhatsApp message templates

WhatsApp only lets a business start a conversation with an **approved template**. Create each one below in **WhatsApp Manager → Message templates → Create template**, exactly as written:

- **Name:** as shown (lowercase, with underscores)
- **Category:** as shown. Meta may move a template to Marketing if it reads as promotional; that only changes the per-message price.
- **Language:** English (code \`en\`). If you choose English (US) or English (UK), set \`WA_TEMPLATE_LANG\` to \`en_US\` or \`en_GB\` instead.
- **Body:** the text. Meta asks for a sample value for each {{n}}; use the samples given.

Until a template is approved, sending it fails and the CRM shows the error under that message.

If you change any wording in WhatsApp Manager, change the same text in \`src/whatsapp.js\` so the CRM shows what was actually sent, then run \`node scripts/templates-doc.js\`.

`;
for (const [k, t] of Object.entries(TEMPLATES)) {
  o += `## ${k}\n\n- **Category:** ${t.category}\n- **Sent:** ${when[k]}\n\n**Body**\n\n\`\`\`\n${t.text}\n\`\`\`\n\n**Samples:** ${samples[k].map((s, i) => `{{${i + 1}}} = ${s}`).join(" · ")}\n\n`;
}
fs.writeFileSync(path.join(__dirname, "..", "TEMPLATES.md"), o);
console.log("TEMPLATES.md written");
