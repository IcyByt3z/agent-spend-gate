# "Before You Pay" — offer page, sample report and 3-week test plan

Draft for review. Nothing here has been published, sent or set up. "Before You Pay" is a placeholder name; check
for conflicts before using it.

---

## Part 1 — One-page offer (copy for a simple landing page)

### Got an invoice or a "we changed our bank details" email that feels off?

**Forward it to us before you pay. Within the hour, you'll get a plain-English read on the warning signs and
exactly what to do next.**

Fake invoices and fake bank-change requests are one of the most common ways small businesses lose money. They
often look exactly like the real thing, come from an email address that looks right, and arrive at a busy moment.
Once the money is sent, it's usually gone.

#### How it works

1. **Forward the email** (with its attachment) to **check@[yourdomain]**.
2. **We look at what you can't easily see:** whether the sender's address and domain are what they appear to be,
   how new the domain is, whether the email passed standard sender checks, whether the bank details differ from
   earlier invoices you've shared, and the usual signs of a redirection scam.
3. **You get a short report** with a clear level — *Low concern*, *Check before paying*, or *Do not pay yet* —
   the reasons in plain language, and the one call to make to confirm.

#### What we'll never do

- We'll **never tell you a payment is "safe."** No outside check can prove who owns a bank account. We tell you
  what we found and how to confirm it with your vendor.
- We **never** ask for your bank logins, never move money and never contact your vendor for you.
- We **don't keep your documents.** They're deleted within 7 days of your report.

#### Pricing

| | Price |
|---|---|
| Single check | **$9** |
| Small business: up to 10 checks a month | **$19 / month** |
| Bookkeepers and finance helpers: up to 50 checks a month across your clients | **$49 / month** |

First check free for bookkeepers trying it with a client.

#### Who's behind this

[One or two sentences in your own words: your background in payment-authorization and agent-security research,
and why you built this.]

*This service flags risk signals. It is not legal, financial or banking advice, and it does not guarantee that
any payment is legitimate. Always confirm bank-detail changes by calling your vendor on a number you already had.*

---

## Part 2 — Sample report (fictional data)

> **Before You Pay — check #0001**
> Received: Tue 10:14 · Report: Tue 10:41
>
> **Level: DO NOT PAY YET**
>
> **What you sent:** an email from "Hartwell Supply Accounts" saying their bank has changed, with invoice
> #4471 for $8,240.00.
>
> **What we found**
>
> 1. **The sender's domain is not your vendor's domain.** The email came from `hartwe11-supply.com`
>    (two number ones instead of "ll"). Your earlier invoices came from `hartwellsupply.com`.
> 2. **The domain is 6 days old.** Your vendor's real domain is 11 years old.
> 3. **The email failed sender verification** for the domain it claims to be from.
> 4. **The bank details changed.** Account ending 3390 at a different bank, compared with account ending 7712 on
>    the invoice you sent us from March.
> 5. **The amount and wording match a real past invoice**, which is typical of these scams: they copy a genuine
>    invoice and change only the bank details.
>
> **What to do**
>
> - Don't reply to the email and don't use any phone number in it.
> - **Call Hartwell Supply on the number you already had** (from your contacts or an older invoice) and ask whether
>   they changed their bank details.
> - If they didn't, report the email to your bank and forward it to the FBI's IC3 at ic3.gov.
>
> *We can't confirm who owns a bank account. This report lists warning signs; a phone call to a number you
> already trust is the confirmation.*

---

## Part 3 — Three-week test plan

### Goal

Find out whether people we don't know will **pay** for this, before building any automation.

### Setup (about 3 hours, near-zero cost)

| Item | Approach |
|---|---|
| Landing page | One page with the Part 1 copy (Carrd, a free page builder, or an artifact page) |
| Intake | A dedicated email address for forwarded messages |
| Payment | A payment link (Stripe or similar) per price tier; you set this up and own it |
| Delivery | Manual: you run the checks with agent help (domain lookup, domain age, email header authentication results, comparison with earlier invoices) and send the report using the Part 2 template |
| Privacy | Delete documents within 7 days; keep only the report text and payment record |
| Log | A simple spreadsheet: source, date, paid?, level given, minutes spent, customer feedback |

### Who to reach: bookkeepers first

Bookkeepers and part-time finance helpers handle many small businesses' payments, already worry about fake bank
changes, and are not going to build this themselves.

Where to find them (non-paid):
- Local bookkeeping and small-business groups (Facebook groups, LinkedIn, local chamber of commerce)
- Bookkeeper communities and forums (subreddits such as r/Bookkeeping, software user communities)
- Bookkeepers you or your network already know

Rules: follow each community's self-promotion rules, contact individuals one at a time, no bulk messages.

### Outreach message (draft)

> Hi [name] — quick question for someone who handles payments for small businesses.
>
> I've started a small service for one specific problem: fake invoices and "our bank details changed" emails.
> You forward a suspicious one, and within the hour you get a plain-English report on the warning signs (lookalike
> domains, brand-new domains, failed sender checks, changed bank details) and exactly what to do next.
>
> Here's a sample report with made-up data: [link]
>
> Would this be useful for your clients? Your first check is free if you want to try it on a real one. After that
> it's $9 a check, or $49/month for up to 50 checks across your clients.

### Daily routine (cap: 1 hour a day, 15 hours total)

- Up to 10 personal messages a day
- Answer replies and deliver checks within the hour during your working hours
- Log everything

### Success and stop rules (decided now)

| Outcome after 3 weeks | Decision |
|---|---|
| **5+ paid checks from people you didn't know before**, or **1 bookkeeper on a monthly plan** | Continue. Next step: automate the routine checks behind the same report |
| Free checks used but nobody pays | Stop or reprice once. The value isn't strong enough at this price |
| No one tries it | Stop. Either the channel or the need is wrong; don't build |
| Average delivery over 30 minutes per check | Simplify the report before scaling, whatever the sales |

### Risks to watch

- **False reassurance.** Never use the word "safe." Every report ends with the call-to-confirm step.
- **Sensitive data.** Invoices contain bank details. Store nothing beyond 7 days; never forward documents to
  anyone else.
- **Liability.** Keep the disclaimer on the page and in every report. Consider a short terms page before taking
  money; get it reviewed if the test succeeds.
- **Scope creep.** Only invoices and bank-change emails. Decline general scam questions politely during the test.

### What you'll have at the end

Either a few real paying customers and the exact checks they valued (the specification for automation and for
the agent supply chain behind it), or a clear, cheap answer that this isn't the opportunity.
