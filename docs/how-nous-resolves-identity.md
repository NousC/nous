# How Nous resolves identity

Your prospects and customers show up everywhere. A reply in Gmail, a HubSpot row, a LinkedIn message, a Fireflies transcript, an Apollo export, a calendar invite. The same person often appears in several of these under a different email, a different name spelling, or a different profile link. Identity resolution is how Nous folds all of that into one account record for each real person, so your team and your agents act on one trustworthy view instead of scattered fragments.

This page explains the approach. It uses a few examples to make it concrete. It does not list every rule.

## One person, many identifiers

Nous treats the person as the thing that matters. Their email addresses, LinkedIn profile, phone number, and the IDs your tools assign (HubSpot, Apollo, Stripe) all attach to that one person. A person can carry several of each. Two emails and a work and personal address are normal, and Nous keeps them together on a single record rather than splitting them into lookalikes.

Every fact on the record carries its source, its confidence, and how fresh it is. That way you can see where a job title or company came from and how much to trust it.

## How a match is made

When a new signal arrives, Nous looks for the person it belongs to using the strongest available evidence first.

1. Stable identifiers win. A LinkedIn member id, a known email, or a CRM record id maps straight to the right person. These rarely change, so they are the most reliable anchors.
2. When the strong signals miss, Nous corroborates before it links. A shared name alone is never enough, because two different people can share a name. Nous looks for a second signal such as a matching company, a matching email domain, or a known profile before it attaches anything.
3. When nothing confident matches, Nous creates a new record rather than guessing. A duplicate can be cleaned up later. Merging two different people is far harder to undo, so Nous leans toward caution.

## Meetings connect people through the calendar

A meeting is an event, not just an email and a name. When a Fireflies transcript arrives, Nous can match it to the booking on your calendar by time and title, then attach the meeting to the person who was actually in that invite. This means a call reaches the right record even when the attendee joined with an address you had never seen. When that happens, Nous quietly learns the new address and adds it to the person, so the next signal from that email already knows who they are.

## LinkedIn handles resolve to the real profile

LinkedIn sometimes hands us an encoded member link rather than a person's public handle. Before deciding a LinkedIn message is from someone new, Nous resolves that encoded link to the person's real profile and checks again. So a message from someone you already imported lands on their existing record instead of starting a second one.

## Enrichment adds, it never erases

When Nous enriches a record from a provider like Prospeo or Apollo, it fills the gaps and leaves your good data alone. Anything you set by hand stays exactly as you set it. Provider data is treated as helpful, not as the final word, because it can be out of date or describe a side role rather than someone's main one.

A few things follow from this.

1. New email addresses are added as alternates. Nous never throws away a verified address and never silently swaps your primary one.
2. A person can hold more than one role. Nous shows the primary on the record and keeps the others in the background for your agents to draw on.
3. A personal mailbox such as a gmail address is never recorded as a company. The address stays on the person, and the company field is reserved for a real employer.

## Built to avoid the costly mistake

The expensive failure in any customer graph is fusing two real people into one. Nous is tuned to avoid that. It links only when the evidence is strong, it flags the uncertain cases for a human instead of forcing a guess, and the links it does make can be reversed. When Nous is unsure, it keeps people apart and tells you, rather than quietly blending two histories.

## A few examples

These illustrate the approach. They are a sample, not the full set.

Someone you have in HubSpot under their work email replies from a personal Gmail. Nous recognizes the reply belongs to the same person through the surrounding context and keeps both addresses on the one record.

You connect with a prospect on LinkedIn who already exists from an earlier import. Nous resolves the LinkedIn link to their real profile, sees the match, and adds the conversation to the record you already had.

A founder shows up in enrichment as a coach at a second company. Nous keeps the founder role and company you already trust as the primary, and stores the second role in the background instead of overwriting the first.

## What you get

The result is one clean record per person that gathers every touch across Gmail, LinkedIn, HubSpot, Apollo, Fireflies, and your calendar. Your team reads one history. Your agents act on one set of facts. And the record gets sharper over time as more signals arrive.
