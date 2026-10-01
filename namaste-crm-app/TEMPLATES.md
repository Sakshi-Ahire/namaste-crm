# WhatsApp message templates

WhatsApp only lets a business start a conversation with an **approved template**. Create each one below in **WhatsApp Manager → Message templates → Create template**, exactly as written:

- **Name:** as shown (lowercase, with underscores)
- **Category:** as shown. Meta may move a template to Marketing if it reads as promotional; that only changes the per-message price.
- **Language:** English (code `en`). If you choose English (US) or English (UK), set `WA_TEMPLATE_LANG` to `en_US` or `en_GB` instead.
- **Body:** the text. Meta asks for a sample value for each {{n}}; use the samples given.

Until a template is approved, sending it fails and the CRM shows the error under that message.

If you change any wording in WhatsApp Manager, change the same text in `src/whatsapp.js` so the CRM shows what was actually sent, then run `node scripts/templates-doc.js`.

## enquiry_greeting

- **Category:** UTILITY
- **Sent:** To customers from the website/Instagram/Facebook form and enquiries added by staff. A customer who messages you first gets a normal reply instead (no template needed).

**Body**

```
Namaste {{1}}, thank you for your enquiry at Namaste Mobile. {{2}} will help you with the best price, exchange and EMI options. Reply here any time.
```

**Samples:** {{1}} = Amit · {{2}} = Ravi

## lead_assigned

- **Category:** UTILITY
- **Sent:** To the salesperson, each time an enquiry is assigned or reassigned to them.

**Body**

```
New enquiry for you, {{1}}: {{2}} ({{3}}), interested in {{4}}. Source: {{5}}. Please contact them within 30 minutes.
```

**Samples:** {{1}} = Ravi · {{2}} = Amit Joshi · {{3}} = 9876543210 · {{4}} = iPhone 16 · {{5}} = WhatsApp

## staff_daily_followups

- **Category:** UTILITY
- **Sent:** To each salesperson at 9:30 am, if they have follow-ups due or overdue.

**Body**

```
Good morning {{1}}. Follow-ups due today: {{2}}. Overdue: {{3}}. Start with: {{4}}. Open the CRM for the full list.
```

**Samples:** {{1}} = Ravi · {{2}} = 4 · {{3}} = 2 · {{4}} = Amit Joshi (iPhone 16), Pooja Rane (Galaxy S25)

## manager_daily_summary

- **Category:** UTILITY
- **Sent:** To each manager at 8:30 pm.

**Body**

```
Namaste Mobile sales summary for {{1}}. Enquiries: {{2}}. Sold: {{3}}. Lost: {{4}}. Follow-ups pending: {{5}}. Team (new/sold/pending): {{6}}. Open the CRM for details.
```

**Samples:** {{1}} = 1 Oct 2026 · {{2}} = 52 · {{3}} = 9 · {{4}} = 6 · {{5}} = 14 · {{6}} = Ravi 6/2/1; Sneha 5/1/0

## customer_followup

- **Category:** MARKETING
- **Sent:** To quiet customers at 11:00 am, and when a salesperson taps "Send follow-up message".

**Body**

```
Namaste {{1}}, this is {{2}} from Namaste Mobile. Are you still looking for the {{3}}? We can share today's best price, exchange value and EMI options. Just reply to this message.
```

**Samples:** {{1}} = Amit · {{2}} = Ravi · {{3}} = iPhone 16

## purchase_thanks

- **Category:** UTILITY
- **Sent:** To the customer when an enquiry is marked Sold (a normal reply is used if they messaged in the last 24 hours).

**Body**

```
Thank you {{1}} for buying your {{2}} from Namaste Mobile. For any help with your phone, accessories or service, reply here.
```

**Samples:** {{1}} = Amit · {{2}} = iPhone 16

