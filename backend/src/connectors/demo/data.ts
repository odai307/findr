import type { DocumentType } from '../types.js';

/**
 * A fictional company, Tamarind Labs (logistics software, ~40 people), used so anyone can try
 * Findr without connecting real accounts. The hand-written documents contain specific facts
 * (dates, amounts, decisions) that the phase 2 evaluation set will ask about. The generated
 * filler adds realistic noise so search has something to rank against.
 */

export type DemoAccess =
  /** Everyone in the Findr workspace. */
  | 'workspace'
  /** Only the person who connected the demo data (like their own inbox). */
  | 'owner'
  /** A private group nobody in the workspace belongs to yet. Must never show up in results. */
  | 'leadership';

export interface DemoDoc {
  id: string;
  type: DocumentType;
  title: string;
  author: { name: string; email: string };
  container: string;
  date: string;
  access: DemoAccess;
  format: 'plain' | 'markdown';
  text: string;
}

const people = {
  ama: { name: 'Ama Mensah', email: 'ama@tamarind.example' },
  kofi: { name: 'Kofi Boateng', email: 'kofi@tamarind.example' },
  esi: { name: 'Esi Owusu', email: 'esi@tamarind.example' },
  daniel: { name: 'Daniel Reyes', email: 'daniel@tamarind.example' },
  priya: { name: 'Priya Nair', email: 'priya@tamarind.example' },
  tomas: { name: 'Tomás Silva', email: 'tomas@tamarind.example' },
  harbor: { name: 'Lena Brandt', email: 'lena.brandt@harborlogistics.example' },
};

export const handwrittenDocs: DemoDoc[] = [
  {
    id: 'email-alpha-timeline',
    type: 'email',
    title: 'Delivery timeline for Project Alpha',
    author: people.ama,
    container: 'Inbox',
    date: '2026-02-02T10:14:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Hi Lena,

Following our call this morning, we can confirm delivery of the Project Alpha route-planning module on March 15, 2026.

This date assumes Harbor Logistics provides the final warehouse dataset by February 20. If the dataset arrives later, delivery moves by the same number of days.

The delivery includes the route optimizer, the dispatcher dashboard and two days of on-site training for your operations team.

Best,
Ama Mensah
Product Manager, Tamarind Labs`,
  },
  {
    id: 'slack-alpha-confirmed',
    type: 'message_thread',
    title: 'Client confirmed March 15',
    author: people.ama,
    container: '#project-alpha',
    date: '2026-02-03T09:02:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Ama Mensah: Harbor Logistics confirmed March 15 for the Alpha delivery 🎉
Kofi Boateng: Great. That means we need an API freeze by February 27 to leave time for load testing.
Ama Mensah: Agreed. I'll put the freeze date in the plan.
Esi Owusu: Reminder that the budget sign-off is still pending, I'll have it by the 10th.`,
  },
  {
    id: 'doc-alpha-plan',
    type: 'page',
    title: 'Project Alpha – Plan',
    author: people.ama,
    container: 'Projects/Alpha',
    date: '2026-02-04T15:30:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Project Alpha – Plan

## Goal
Deliver a route-planning module to Harbor Logistics that cuts their average delivery route length by at least 12%.

## Milestones

| Milestone | Date | Owner |
| --- | --- | --- |
| Warehouse dataset received | 2026-02-20 | Harbor Logistics |
| API freeze | 2026-02-27 | Kofi Boateng |
| Load testing complete | 2026-03-06 | Kofi Boateng |
| Delivery and training | 2026-03-15 | Ama Mensah |

## Risks
- The warehouse dataset may arrive late; delivery slips day for day.
- The dispatcher dashboard depends on the new map tiles provider, which is still in trial.

## Budget
Total budget is $84,000, including a 10% contingency. See Esi's approval email.`,
  },
  {
    id: 'email-alpha-budget',
    type: 'email',
    title: 'Re: Project Alpha budget',
    author: people.esi,
    container: 'Inbox',
    date: '2026-02-10T16:45:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Hi Ama,

Finance has approved the Project Alpha budget of $84,000. This includes a 10% contingency ($7,636) that needs my sign-off before it is spent.

Invoices from the map tiles provider should be coded to cost center ENG-ALPHA.

Thanks,
Esi Owusu
Finance Lead`,
  },
  {
    id: 'email-alpha-change-request',
    type: 'email',
    title: 'Re: Delivery timeline for Project Alpha',
    author: people.harbor,
    container: 'Inbox',
    date: '2026-03-02T08:20:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Hi Ama,

Our warehouse team has asked whether delivery could move to March 22 so it doesn't overlap with our quarter-end stock count.

Lena

---

Hi Lena,

We will keep the March 15 delivery date, but we can do a staged rollout: the route optimizer goes live on March 15 and the dispatcher dashboard on March 22. Training will happen the week of March 22.

Ama`,
  },
  {
    id: 'slack-inc-2041',
    type: 'message_thread',
    title: 'INC-2041 database outage',
    author: people.kofi,
    container: '#engineering',
    date: '2026-01-21T03:12:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Kofi Boateng: 🚨 INC-2041: primary database is not accepting writes. Customers can't create shipments.
Tomás Silva: Looking. Disk on db-primary-1 is at 100%.
Kofi Boateng: WAL archive folder is huge, archiving to the backup bucket has been failing since yesterday.
Tomás Silva: Failing over to db-replica-2 now.
Kofi Boateng: Writes are back as of 03:59. Total impact 47 minutes. Postmortem doc to follow.`,
  },
  {
    id: 'doc-postmortem-2041',
    type: 'page',
    title: 'Postmortem: INC-2041 primary database failover',
    author: people.kofi,
    container: 'Engineering/Postmortems',
    date: '2026-01-23T11:00:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Postmortem: INC-2041

## Summary
On January 21, 2026 the primary database stopped accepting writes for 47 minutes (03:12–03:59 UTC). Customers could not create or update shipments.

## Root cause
WAL archiving to the CloudKeep backup bucket had been failing for 26 hours because the bucket credentials expired. Unarchived WAL files filled the disk on db-primary-1.

## What went well
- Failover to db-replica-2 worked as documented.

## Action items
1. Alert when WAL archiving fails for more than 15 minutes (owner: Tomás Silva).
2. Rotate backup credentials automatically every 60 days (owner: Kofi Boateng).
3. Add disk usage alert at 80% on all database hosts (owner: Tomás Silva).`,
  },
  {
    id: 'doc-onboarding',
    type: 'page',
    title: 'Engineering onboarding guide',
    author: people.tomas,
    container: 'Engineering',
    date: '2026-01-08T09:00:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Engineering onboarding guide

## Your first week
- Get your laptop from IT and enable full-disk encryption.
- Ask Kofi to add you to the GitHub organization and the on-call tool.
- Pair with your onboarding buddy on at least two pull requests.

## Code review
Every pull request needs two approvals, one of them from a code owner. Keep pull requests under 400 changed lines where possible.

## Deploys
We deploy to production on Tuesdays and Thursdays before 15:00. No deploys on Fridays unless it is a hotfix approved by the on-call lead.

## On-call
New engineers join the on-call rotation after six weeks. Rotations are one week long, Monday to Monday.`,
  },
  {
    id: 'doc-leave-policy',
    type: 'page',
    title: 'Vacation and leave policy',
    author: people.esi,
    container: 'People/Policies',
    date: '2025-12-15T09:00:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Vacation and leave policy

Everyone gets 25 days of paid vacation per year, plus public holidays.

## Carry-over
Up to 5 unused days can be carried into the next year. Carried-over days expire on March 31.

## Requesting time off
Request vacation in the HR portal at least two weeks in advance. For more than 10 consecutive days, also tell your manager a month ahead.

## Sick leave
Sick leave is separate from vacation. For absences longer than three days, send a doctor's note to people@tamarind.example.`,
  },
  {
    id: 'doc-okrs-q1',
    type: 'page',
    title: 'Q1 2026 OKRs',
    author: people.tomas,
    container: 'Company',
    date: '2026-01-05T10:00:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Q1 2026 OKRs

## Objective 1: Deliver Project Alpha on time
- KR1: Route optimizer live at Harbor Logistics by March 15
- KR2: Average route length reduced by 12% in the first month

## Objective 2: Make the platform more reliable
- KR1: Uptime of 99.9% or better
- KR2: Zero incidents caused by expired credentials

## Objective 3: Grow revenue
- KR1: 15 new Pro plan customers
- KR2: Net revenue retention above 110%`,
  },
  {
    id: 'email-pricing-pro',
    type: 'email',
    title: 'Pricing decision: Pro plan',
    author: people.daniel,
    container: 'Inbox',
    date: '2026-01-28T14:05:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Team,

After last week's review we've decided on Pro plan pricing:

- $49 per seat per month, billed monthly
- 15% discount for annual billing
- Minimum of 5 seats

Existing customers on the old Team plan keep their price until their next renewal. The new pricing goes live on February 15.

Daniel Reyes
Head of Sales`,
  },
  {
    id: 'slack-harbor-renewal',
    type: 'message_thread',
    title: 'Harbor Logistics renewal',
    author: people.daniel,
    container: '#sales',
    date: '2026-02-18T13:40:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Daniel Reyes: Harbor Logistics renewal is due May 1. They're asking for a 10% discount because of the Alpha delays last year.
Ama Mensah: Alpha is on track this time, delivery is March 15. I'd hold off on discounts until after delivery.
Daniel Reyes: Makes sense. I'll offer a 3-year term at the current price instead.`,
  },
  {
    id: 'doc-beacon-spec',
    type: 'page',
    title: 'Project Beacon – Mobile app spec',
    author: people.priya,
    container: 'Projects/Beacon',
    date: '2026-02-12T10:30:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Project Beacon – Mobile app spec

## Summary
Beacon is a mobile app for delivery drivers: today's route, stop details and proof of delivery.

## Platform
Built with React Native so iOS and Android share one codebase.

## Offline mode
Drivers often lose signal. The app stores the full day's route on the device and syncs proof-of-delivery photos when the connection returns.

## Launch
Target launch is June 2026, starting with a pilot of 20 drivers at Harbor Logistics.`,
  },
  {
    id: 'email-beacon-design-review',
    type: 'email',
    title: 'Beacon design review notes',
    author: people.priya,
    container: 'Inbox',
    date: '2026-02-19T17:10:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Hi all,

Notes from today's Beacon design review:

1. The stop list needs larger tap targets; drivers use the app with gloves.
2. Proof of delivery will support photo and signature. Barcode scanning moves to v2.
3. We will test dark mode with night-shift drivers in March.

Priya`,
  },
  {
    id: 'slack-design-palette',
    type: 'message_thread',
    title: 'New color palette',
    author: people.priya,
    container: '#design',
    date: '2026-02-24T11:15:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Priya Nair: Sharing the new palette for Beacon and the dashboard. All text colors meet a 4.5:1 contrast ratio.
Kofi Boateng: Do the status colors work for color-blind users?
Priya Nair: Yes, every status also has an icon, so color is never the only signal.`,
  },
  {
    id: 'email-cloudkeep-contract',
    type: 'email',
    title: 'Vendor contract: CloudKeep backup storage',
    author: people.tomas,
    container: 'Inbox',
    date: '2026-01-15T09:30:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Hi Esi,

I've signed the CloudKeep contract for database backup storage:

- 3-year term starting February 1, 2026
- $1,200 per month
- Renewal requires 60 days' written notice to cancel

Please set up the monthly payment.

Tomás`,
  },
  {
    id: 'doc-access-reviews',
    type: 'page',
    title: 'Security policy: access reviews',
    author: people.tomas,
    container: 'Security',
    date: '2026-01-12T09:00:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Security policy: access reviews

- Multi-factor authentication is required on every company account.
- Managers review their team's system access every quarter.
- When someone leaves, all of their access is removed within 24 hours.
- Production database access requires approval from the CTO and expires after 7 days.`,
  },
  {
    id: 'slack-office-move',
    type: 'message_thread',
    title: 'Office move',
    author: people.esi,
    container: '#general',
    date: '2026-03-05T10:00:00Z',
    access: 'workspace',
    format: 'plain',
    text: `Esi Owusu: 📦 We're moving offices! From April 6 we'll be at 14 Riverside Walk, 3rd floor.
Daniel Reyes: Is there parking?
Esi Owusu: Bike storage yes, car parking no. The new office is a 5-minute walk from the train station.`,
  },
  {
    id: 'doc-hiring-plan',
    type: 'page',
    title: 'Hiring plan 2026',
    author: people.tomas,
    container: 'People',
    date: '2026-01-06T09:00:00Z',
    access: 'workspace',
    format: 'markdown',
    text: `# Hiring plan 2026

| Role | Count | Hiring manager | Target start |
| --- | --- | --- | --- |
| Backend engineer | 3 | Kofi Boateng | Q2 |
| Mobile engineer | 1 | Kofi Boateng | Q2 |
| Product designer | 1 | Priya Nair | Q3 |

Kofi leads all engineering interviews. Every candidate does a take-home exercise of at most 3 hours.`,
  },
  {
    id: 'email-owner-1on1',
    type: 'email',
    title: 'My notes: 1:1 with Kofi',
    author: people.ama,
    container: 'Inbox',
    date: '2026-02-26T12:00:00Z',
    access: 'owner',
    format: 'plain',
    text: `Private notes from my 1:1 with Kofi.

- Kofi wants to move toward a staff engineer role by the end of the year.
- He'd like to mentor the two new backend hires.
- Follow up: ask Tomás about the staff engineer promotion criteria.`,
  },
  {
    id: 'doc-board-update',
    type: 'page',
    title: 'Board update – February 2026',
    author: people.tomas,
    container: 'Leadership',
    date: '2026-02-27T18:00:00Z',
    access: 'leadership',
    format: 'markdown',
    text: `# Board update – February 2026

## Runway
Current runway is 18 months at the planned hiring pace.

## Fundraising
We are preparing for a Series A in Q3 2026, led by the Harbor Logistics expansion story.`,
  },
  {
    id: 'slack-leadership-comp',
    type: 'message_thread',
    title: 'Compensation review',
    author: people.tomas,
    container: '#leadership',
    date: '2026-03-03T16:30:00Z',
    access: 'leadership',
    format: 'plain',
    text: `Tomás Silva: Proposal for the compensation review: a 6% total increase pool, applied in April.
Esi Owusu: Finance can support 6%. Anything above that needs board approval.`,
  },
];

// ---------------------------------------------------------------------------
// Generated filler: standups, pipeline emails and small talk. Deterministic (seeded).
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const standupItems = [
  'reviewed pull requests for the shipment API',
  'fixed a flaky test in the billing service',
  'paired on the route optimizer caching layer',
  'updated the dispatcher dashboard filters',
  'investigated slow queries on the tracking page',
  'worked on the Beacon offline sync prototype',
  'wrote docs for the webhooks endpoint',
  'upgraded the Node.js version in CI',
  'triaged support tickets from the weekend',
  'added metrics for the label printing service',
  'cleaned up unused feature flags',
  'improved error messages in the import tool',
];
const blockers = [
  'no blockers',
  'waiting on design for the empty states',
  'blocked on staging database access',
  'need a review on the migration pull request',
];
const engineers = [people.kofi, people.tomas, people.priya];

function* weekdays(fromIso: string, toIso: string) {
  for (let d = new Date(fromIso); d <= new Date(toIso); d = new Date(d.getTime() + 86_400_000)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) yield d;
  }
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

export function generatedDocs(): DemoDoc[] {
  const rand = mulberry32(2026);
  const docs: DemoDoc[] = [];

  for (const day of weekdays('2026-01-05', '2026-03-13')) {
    const date = day.toISOString().slice(0, 10);
    const lines = engineers.map(
      (p) =>
        `${p.name}: Yesterday I ${pick(rand, standupItems)}. Today I'm continuing with what's left of that. Status: ${pick(rand, blockers)}.`,
    );
    docs.push({
      id: `standup-${date}`,
      type: 'message_thread',
      title: `Standup ${date}`,
      author: people.kofi,
      container: '#eng-standup',
      date: `${date}T09:30:00Z`,
      access: 'workspace',
      format: 'plain',
      text: lines.join('\n'),
    });
  }

  const prospects = ['Northgate Freight', 'Bluewater Ports', 'Atlas Couriers', 'Meridian Cargo'];
  for (const [i, monday] of [...weekdays('2026-01-05', '2026-03-09')]
    .filter((d) => d.getUTCDay() === 1)
    .entries()) {
    const date = monday.toISOString().slice(0, 10);
    const rows = prospects.map(
      (p) =>
        `- ${p}: ${pick(rand, ['demo scheduled', 'proposal sent', 'negotiating', 'waiting on legal', 'trial started'])}`,
    );
    docs.push({
      id: `pipeline-${date}`,
      type: 'email',
      title: `Sales pipeline update – week ${i + 2}`,
      author: people.daniel,
      container: 'Inbox',
      date: `${date}T08:00:00Z`,
      access: 'workspace',
      format: 'plain',
      text: `Hi team,\n\nThis week's pipeline:\n\n${rows.join('\n')}\n\nDaniel`,
    });
  }

  return docs;
}

export function allDemoDocs(): DemoDoc[] {
  return [...handwrittenDocs, ...generatedDocs()];
}
