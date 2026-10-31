# Demo video script (silent, about 2–3 minutes)

No voice needed. Record the screen with **⌘⇧5** (Record Selected Portion, around the browser
window). Add the captions afterwards as titles in iMovie, or skip them and send the step list in
the outreach message instead.

**Before recording**
- Use the Agentforce playground (it expires Nov 7). It already points at the hosted gate.
- Open two tabs: the agent preview, and **Agent Purchase Receipts → All Receipts**.
- Open a third tab ready for the block explorer (sepolia.basescan.org).
- The demo seller on Render sleeps when idle: do one throwaway lookup a minute before you start.
- Zoom the browser to 110–125% so text is readable in the video.

---

### Scene 1: The setup (5 seconds, no clicks)
Caption: **An AI agent in Salesforce buys data from outside vendors. It never holds money.
Every purchase goes through a gate that enforces the company's rules.**

### Scene 2: A normal purchase (20 seconds)
Type: *Look up company details for acme.com*
Caption: **Approved seller, within limits: paid $0.005 automatically.**
Switch to the receipts tab, refresh, open the new receipt for a second.
Caption: **Every attempt becomes a receipt in Salesforce.**

### Scene 3: A seller that isn't approved (15 seconds)
Type: *Look up acme.com using seller cheapdata*
Caption: **Seller not on the approved list: blocked. Nothing paid.**

### Scene 4: Too expensive (15 seconds)
Type: *Look up acme.com using seller demo-enrich-premium*
Caption: **Price above the company's limit: refused before anything was signed.**

### Scene 5: Bad data (20 seconds)
Type: *Look up mismatch-co.com*
Caption: **The seller returned the wrong company. The data never reaches the agent, and the
receipt records a refund owed.**

### Scene 6: Needs a human (40 seconds)
Type: *Look up acme.com using seller demo-enrich-plus*
Caption: **Above the approval threshold: nothing bought yet. It waits for a person.**
Go to receipts → **Awaiting Approval** → open it → Edit → Decision = **Approved** → Save.
Wait about 10 seconds, refresh.
Caption: **Approved in Salesforce: the gate re-checks the rules and pays. Same receipt, now paid.**

### Scene 7: Proof (15 seconds)
Copy the transaction ID from the receipt, paste it into sepolia.basescan.org.
Caption: **The payment is real and publicly verifiable (on a test network, with test money).**

### Closing card (5 seconds)
Caption: **Agent Spend Gate: approved sellers, limits, approvals, result checks, and a receipt
for every attempt. Built on Salesforce Agentforce.**

---

**Tips**
- If something goes wrong mid-recording, keep going; cut it later in iMovie.
- Don't show the Setup → Named Credentials pages: they hold the gate key.
- Export at 1080p. Keep it under 3 minutes; people stop watching after that.
