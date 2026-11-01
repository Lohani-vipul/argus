import test from "node:test";
import assert from "node:assert/strict";

import { filterAndSortDocs } from "./desk-utils.ts";

const docs = [
  {
    id: "doc-2",
    title: "Harbor jobs outlook",
    short: "Jobs outlook",
    filename: "jobs.txt",
    kicker: "Economic forecast",
    dateLabel: "2024-04-02",
    text: "Jobs wide open.",
    addedAt: 22,
    note: "Labor estimates",
  },
  {
    id: "doc-1",
    title: "Northline impact memo",
    short: "Impact memo",
    filename: "impact.md",
    kicker: "Public record",
    dateLabel: "2023-11-18",
    text: "The project totals are uncertain.",
    addedAt: 10,
    note: "Budget and cost",
  },
  {
    id: "doc-3",
    title: "Wetland risk review",
    short: "Risk review",
    filename: "wetland.csv",
    kicker: "Environmental review",
    dateLabel: "2024-05-14",
    text: "Impact is moderate.",
    addedAt: 30,
    note: "Habitat drift",
  },
] as const;

test("filterAndSortDocs matches query across key fields and sorts by recency", () => {
  const filtered = filterAndSortDocs(docs, "impact", "recent");

  assert.deepEqual(filtered.map((doc) => doc.id), ["doc-3", "doc-1"]);
  assert.equal(filtered[0].short, "Risk review");
  assert.equal(filtered[1].short, "Impact memo");
});

test("filterAndSortDocs falls back to title ordering when sorting by title", () => {
  const filtered = filterAndSortDocs(docs, "", "title");

  assert.deepEqual(filtered.map((doc) => doc.id), ["doc-1", "doc-2", "doc-3"]);
});
