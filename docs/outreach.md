# Outreach: asking for feedback, not selling

The goal of the first ten conversations is to learn whether this is a real problem and what
would stop a company from using it. Don't pitch. Ask, listen, take notes.

## Who to ask

- Salesforce admins and architects (Trailblazer Community groups, local user groups, LinkedIn)
- RevOps / Sales Ops people at companies that buy data (enrichment, leads, research)
- Agentforce consultants and partners: they hear what clients ask for
- Someone in finance or procurement, if you know one: they'd approve or block this

## Message (LinkedIn or email)

> Hi [name], I'm teaching myself backend development and Salesforce Agentforce, and I built a
> working prototype I'd love a practitioner's opinion on.
>
> It lets an Agentforce agent buy data from outside vendors without ever holding money: every
> purchase goes through a gate that enforces the company's rules (approved vendors, limits, a
> budget), holds bigger purchases for approval in Salesforce, withholds bad data, and saves a
> receipt for every attempt, including the ones it blocks.
>
> Here's a 3-minute silent demo: https://youtu.be/aprOw7Z5Uqc
>
> Would you be open to a 15-minute call, or even a few lines of reply? I'm trying to learn
> whether this solves a real problem and what would stop a team like yours from using it.
> No sales pitch; I'm not selling anything yet.

**Shorter version (for a community post or a cold DM)**

> Built a prototype: Agentforce agents buy data from outside vendors through a gate that
> enforces approved vendors, limits, approvals and receipts. The agent never holds money.
> 3-minute demo: https://youtu.be/aprOw7Z5Uqc. Would your team let an agent spend company money like this? What
> would stop you? Looking for honest feedback.

## The questions

Ask these in roughly this order. Let them talk; don't defend the idea.

1. **Today, how does your team buy data or small services? Who approves it?**
   (Shows you the current process you'd be replacing.)
2. **Would you let an agent buy something like this, if it worked the way you saw?**
   (Listen for "yes, but…": the "but" is the valuable part.)
3. **What would stop you?** (Security review? Finance? Legal? Crypto? Trust in vendors?)
4. **Who at your company would have to say yes?**
5. **If this existed today, what would you use it for first?**

Optional, if the conversation is going well:
- "Would a card-based version (no crypto) change your answer?"
- "Would you rather the vendor terms and contracts be handled for you?"

## After each conversation

Write down within the hour, in a simple table:
- Who (role, company size), and whether they'd use it
- The biggest objection, in their words
- Anything they asked for that you didn't have
- Whether they'd look at it again or introduce someone

After ten, look for the objection that keeps repeating. That's the next thing to build or solve.

### Notes

Keep names out of this file if the repository is ever made public; a role is enough.

| Date | Who | Where | Would use it? | Biggest objection, in their words | Asked for | Follow-up |
|---|---|---|---|---|---|---|
| 2026-11-03 | Salesforce services provider (commenter) | LinkedIn post | Positive: "the gate is the right shape" | "Make the approval reason visible to whoever reviews spend later, otherwise the person clicking approve becomes the weak point" | A recorded reason for each approval | Built same week (required Decision Reason + decision log); reply on the thread |

## Being straightforward about yourself

You don't need a long résumé. "I'm learning backend development and Agentforce, and I built
this" is honest and works well: people like helping someone who has built something real. The
working demo is your credibility.
