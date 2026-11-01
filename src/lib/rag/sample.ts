import type { SourceDoc } from "@/lib/rag/types";

const NOW = 1_746_000_000_000;

function doc(partial: Omit<SourceDoc, "addedAt" | "note">): SourceDoc {
  return { ...partial, addedAt: NOW, note: "" };
}

export const SAMPLE_DOCS: SourceDoc[] = [
  doc({
    id: "sample-council",
    title: "Northline Harbor Council Briefing",
    short: "Council briefing",
    filename: "council-briefing.md",
    kicker: "Council",
    dateLabel: "12 Mar 2025",
    text: `# Northline Harbor Council Briefing

## Packet
This briefing is dated 12 March 2025 and is the version placed in the public council packet.

## Cost and schedule
The Northline Harbor program is presented with a total cost of $186 million and a target opening in summer 2027.

Staff tell Council the figure is the full program cost and that construction can finish in time for a summer 2027 opening.

## Environment
Staff describe the wetland effect as minor and fully mitigated by plantings that begin the same season as construction.

## Jobs and ferry revenue
The briefing projects 1,400 jobs and ferry receipts of $22 million a year.

The ferry projection reuses the 2019 ridership study without a new count.

## Foundations
The pile design in this packet assumes bearing at 24 meters.

## Process
A Council vote is scheduled for 4 June 2025.

The public packet for this briefing does not include the January geotechnical addendum.

Parking relocation for Pier 4 vendors is a separate municipal item and is not part of the harbor program cost.
`,
  }),
  doc({
    id: "sample-estuary",
    title: "Northline Estuary Assessment",
    short: "Estuary assessment",
    filename: "estuary-assessment.md",
    kicker: "Assessment",
    dateLabel: "2 Apr 2025",
    text: `# Northline Estuary Assessment

## Record
This assessment is dated 2 April 2025 and covers the channel bend at Northline Harbor.

## Marsh
This assessment finds that 18.4 acres of salt marsh will be disturbed.

The assessment classifies the impact as moderate and long-duration, not minor.

The assessment does not adopt the council phrase fully mitigated.

## Dredge
Dredging is estimated at 640,000 cubic yards along the channel bend.

## Fish
Winter flounder use the bend as spawning habitat from April through June.

The assessment recommends that in-water work avoid April through June.

Mitigation plantings will not replace marsh function for about three years after they are installed.
`,
  }),
  doc({
    id: "sample-audit",
    title: "Independent Cost Note",
    short: "Cost note",
    filename: "independent-cost-note.md",
    kicker: "Audit",
    dateLabel: "19 May 2025",
    text: `# Independent Cost Note

## Record
This note is dated 19 May 2025 and reviews the March council briefing and the April federal application.

## Program cost
The likely program cost is $241 million to $268 million, not the $186 million in the March council briefing.

The $186 million figure excludes soft costs and the clay-layer foundation premium.

Contingency is set at 4 percent, while peer waterfront projects carry 12 to 15 percent.

## Ferry revenue
Ferry revenue in the briefing reuses 2019 ridership, but 2024 actual boardings are 31 percent lower.

## Local match
The federal application claims a $112 million local match, yet only $61 million is appropriated.

The other $51 million is a state earmark that has not been voted.
`,
  }),
  doc({
    id: "sample-geo",
    title: "Pier 4 Geotechnical Addendum",
    short: "Pier 4 addendum",
    filename: "pier-4-addendum.md",
    kicker: "Engineering",
    dateLabel: "28 Jan 2025",
    text: `# Pier 4 Geotechnical Addendum

## Record
This addendum is dated 28 January 2025 and reports borings along Pier 4.

## Soils
Borings show soft clay from 14 to 22 meters, and piles must reach glacial till at about 38 meters.

The council briefing pile schedule assumes 24 meters and does not reach till.

## Foundation premium
The foundation premium for reaching glacial till is about $27 million and about five months on the marine package.

The site is seismic class E.

## Circulation
This addendum was not circulated in the March council packet.
`,
  }),
  doc({
    id: "sample-hearing",
    title: "Harbor Public Hearing Transcript",
    short: "Hearing transcript",
    filename: "hearing-transcript.md",
    kicker: "Hearing",
    dateLabel: "7 May 2025",
    text: `# Harbor Public Hearing Transcript

## Record
This hearing was held on 7 May 2025 at Northline city hall.

## Fishers
The fisher cooperative testified that the crab grounds sit on the channel bend and that the dredge window hits the spring migration.

## Jobs
Developer counsel testified that the 1,400 jobs figure counts construction crews.

Developer counsel testified that permanent jobs are closer to 220 jobs.

## Schedule
A resident testified that a summer 2027 opening conflicts with two seasons of the April through June in-water work ban.

## Packet
The city clerk stated that the engineering addendum was not in the public packet before the hearing.
`,
  }),
  doc({
    id: "sample-grant",
    title: "Federal PIDP Application Excerpt",
    short: "PIDP application",
    filename: "pidp-application.md",
    kicker: "Grant",
    dateLabel: "30 Apr 2025",
    text: `# Federal PIDP Application Excerpt

## Record
This excerpt is dated 30 April 2025 and is the city PIDP submission for Northline Harbor.

## Request
The application requests $74 million in federal PIDP funds.

## Match
The application states that a $112 million local match is already appropriated.

## Schedule
Substantial completion is scheduled for December 2028.

The schedule in this application does not match the summer 2027 opening in the council briefing.

## Jobs
The application reports 860 average annual jobs, not 1,400 jobs.
`,
  }),
];

export const INQUIRIES: { mode: "ask" | "brief" | "compare" | "conflicts" | "timeline"; label: string; question: string }[] = [
  {
    mode: "ask",
    label: "Cost",
    question: "What does the harbor program actually cost, and which figures are totals rather than line items?",
  },
  {
    mode: "conflicts",
    label: "Conflicts",
    question: "Where do these sources contradict each other on cost, jobs, schedule, and the local match?",
  },
  {
    mode: "timeline",
    label: "Timeline",
    question: "Lay the dossier out in time, from the geotechnical addendum through the council vote.",
  },
  {
    mode: "compare",
    label: "Jobs",
    question: "Compare every jobs figure and what each source is actually counting.",
  },
  {
    mode: "brief",
    label: "Brief",
    question: "Brief a council member on what not to take at face value from the March packet.",
  },
  {
    mode: "ask",
    label: "Marsh",
    question: "What environmental limits does the council briefing leave out of the wetland story?",
  },
];
