import { bm25Search, buildBm25, clip, extractDates, fuseRanks, sentencesOf, tokenize } from "@/lib/rag/corpus";
import type { Analysis, Chunk, Citation, Conflict, Mode, PriorTurn, RankedChunk, SourceDoc } from "@/lib/rag/types";

export type Facet = { id: string; label: string; terms: string[] };

export const FACETS: Facet[] = [
  { id: "cost", label: "Program cost", terms: ["cost", "budget", "contingency", "premium"] },
  { id: "schedule", label: "Schedule", terms: ["opening", "completion", "summer", "schedule", "months", "season"] },
  { id: "jobs", label: "Jobs", terms: ["jobs", "employment", "permanent", "crews"] },
  { id: "environment", label: "Environment", terms: ["marsh", "wetland", "dredge", "flounder", "mitigation", "acres", "crab", "impact", "minor", "moderate", "habitat"] },
  { id: "engineering", label: "Foundations", terms: ["clay", "pile", "till", "seismic", "meters", "boring"] },
  { id: "funding", label: "Funding", terms: ["local match", "appropriated", "earmark", "federal", "grant", "pidp"] },
  { id: "revenue", label: "Ferry revenue", terms: ["ferry", "ridership", "revenue", "receipts", "boardings"] },
  { id: "process", label: "Public record", terms: ["packet", "hearing", "vote", "circulated", "clerk", "testified"] },
];

function hasTerm(hay: string, term: string): boolean {
  if (term.includes(" ")) return hay.includes(term);
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay);
}

const PAIRS: [RegExp, RegExp][] = [
  [/\bminor\b/i, /\bmoderate\b|\bmajor\b/i],
  [/\bfull program cost\b|\btotal cost\b/i, /\bexcludes\b/i],
  [/\balready appropriated\b/i, /\bnot been voted\b|\bonly \$/i],
  [/\bpermanent\b/i, /\bconstruction crews\b/i],
  [/\bfully mitigated\b/i, /\bnot adopt\b|\bwill not replace\b/i],
];

type Evidence = {
  doc: SourceDoc;
  chunk: Chunk;
  sentence: string;
  score: number;
  figures: string[];
};

export type LocalPlan = {
  intent: string;
  queries: string[];
  facets: Facet[];
  docFocus: string[];
};

function questionTerms(question: string): string[] {
  return [...new Set(tokenize(question))].slice(0, 10);
}

function matchFacets(hay: string): Facet[] {
  return FACETS.filter((facet) => facet.terms.some((term) => hasTerm(hay, term)) || hay.includes(facet.label.toLowerCase()));
}

const FOLLOW_LEAD = /^(and|also|but|so|then|what about|how about|and what|what of|more on|same for|does that|is that|are those|why is that|which one)\b/i;
const ANAPHORA = /\b(that|those|this|it|they|them|the same|you said|earlier|previous|above)\b/i;

export function isFollowUp(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/);
  if (FOLLOW_LEAD.test(trimmed)) return true;
  if (words.length <= 5) return true;
  return ANAPHORA.test(trimmed) && words.length <= 16;
}

export function planLocal(mode: Mode, question: string, docs: SourceDoc[], history: PriorTurn[] = []): LocalPlan {
  const prior = history.at(-1);
  const follow = mode === "chat" && Boolean(prior) && isFollowUp(question);
  const hay = question.toLowerCase();
  const matched = matchFacets(hay);
  const inherited = follow && prior && !matched.length ? matchFacets(prior.question.toLowerCase()) : [];
  let facets: Facet[];
  if (mode === "brief") {
    facets = (matched.length >= 2 ? matched : FACETS.filter((facet) => ["cost", "schedule", "jobs", "environment", "funding", "revenue"].includes(facet.id))).slice(0, 6);
  } else if (mode === "conflicts") {
    facets = (matched.length ? matched : FACETS.filter((facet) => ["cost", "jobs", "schedule", "funding", "environment"].includes(facet.id))).slice(0, 5);
  } else if (mode === "compare") {
    facets = (matched.length ? matched : FACETS.slice(0, 4)).slice(0, 4);
  } else if (mode === "timeline") {
    facets = matched.slice(0, 3);
  } else if (mode === "chat") {
    facets = (matched.length ? matched : inherited).slice(0, 3);
  } else {
    facets = matched.slice(0, 4);
  }
  const priorTerms = follow && prior && !matched.length ? questionTerms(prior.question) : [];
  const terms = [...questionTerms(question), ...priorTerms].slice(0, 10);
  if (!facets.length) {
    facets = [{ id: "question", label: "Question", terms: terms.slice(0, 6) }];
  }

  const content = terms.slice(0, 8).join(" ");
  const queries = [content || question.trim()];
  for (const facet of facets) {
    if (facet.id === "question") continue;
    queries.push(`${facet.terms.slice(0, 4).join(" ")} ${content}`.trim());
  }
  const unique = [...new Set(queries.map((query) => query.replace(/\s+/g, " ").trim()))].filter(Boolean).slice(0, 5);
  const focusHits = docs.filter((doc) => hay.includes(doc.short.toLowerCase()) || hay.includes(doc.kicker.toLowerCase()));
  const labels = facets.filter((facet) => facet.id !== "question").map((facet) => facet.label.toLowerCase());
  const intent = follow
    ? labels.length
      ? `Follow-up. Look for ${labels.join(", ")}.`
      : "Follow-up. Search the previous question together with these words."
    : labels.length
      ? `Look for ${labels.join(", ")}.`
      : "Search the question's own words across every source.";
  return { intent, queries: unique, facets, docFocus: focusHits.map((doc) => doc.id) };
}

export function retrieveLocal(chunks: Chunk[], queries: string[], docFocus: string[], limit: number): RankedChunk[] {
  if (!chunks.length) return [];
  const index = buildBm25(chunks);
  const lists = queries.map((query) => bm25Search(index, query, 16));
  const fused = fuseRanks(lists, Math.max(limit, 8));
  if (!docFocus.length) return fused.slice(0, limit);
  const boosted = fused
    .map((hit) => (docFocus.includes(hit.chunk.docId) ? { ...hit, score: hit.score * 1.2 } : hit))
    .sort((a, b) => b.score - a.score);
  return boosted.slice(0, limit);
}

export function semanticRerank(
  lexical: RankedChunk[],
  queryVectors: Float32Array[],
  vectors: Map<string, Float32Array>,
  pool: Chunk[],
  limit: number,
): RankedChunk[] {
  if (!queryVectors.length) return lexical.slice(0, limit);
  const scored: RankedChunk[] = [];
  for (const chunk of pool) {
    const vector = vectors.get(chunk.id);
    if (!vector) continue;
    let best = 0;
    for (const query of queryVectors) {
      let dot = 0;
      let na = 0;
      let nb = 0;
      const n = Math.min(vector.length, query.length);
      for (let i = 0; i < n; i++) {
        dot += vector[i] * query[i];
        na += vector[i] * vector[i];
        nb += query[i] * query[i];
      }
      const cosine = !na || !nb ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
      if (cosine > best) best = cosine;
    }
    if (best > 0.15) scored.push({ chunk, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  const lists = [lexical, scored.slice(0, 16)];
  return fuseRanks(lists, limit);
}

function figuresFor(facet: Facet, sentence: string): string[] {
  const found: string[] = [];
  const push = (values: RegExpMatchArray | null) => {
    if (!values) return;
    for (const value of values) found.push(value.replace(/\s+/g, " ").trim());
  };
  if (facet.id === "cost" || facet.id === "funding" || facet.id === "revenue") {
    push(sentence.match(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion))?|\d[\d,]*(?:\.\d+)?\s?(?:million|billion)|\d+(?:\.\d+)?\s?percent/gi));
  } else if (facet.id === "jobs") {
    if (!/job/i.test(sentence)) return [];
    for (const match of sentence.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{2,5})\b/g)) {
      const raw = match[1];
      const value = Number(raw.replace(/,/g, ""));
      if (value < 50 || value > 20000 || (value >= 1900 && value <= 2099)) continue;
      const after = sentence.slice((match.index ?? 0) + raw.length, (match.index ?? 0) + raw.length + 14);
      if (/^\s*(million|billion|percent|meters|acres)/i.test(after)) continue;
      found.push(raw);
    }
  } else if (facet.id === "schedule") {
    push(sentence.match(/\b(?:spring|summer|fall|autumn|winter|january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b|\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b|\b(?:five|six|seven|eight|nine|ten|\d+)\s+months\b/gi));
  } else if (facet.id === "environment") {
    push(sentence.match(/\b\d[\d,]*(?:\.\d+)?\s?acres|\b\d[\d,]*(?:\.\d+)?\s?cubic yards|\b(?:minor|moderate|long-duration)\b/gi));
  } else if (facet.id === "engineering") {
    push(sentence.match(/\b\d{1,3}\s?meters|\bseismic class\s+[A-E]\b|\bclass\s+[A-E]\b|\$\s?\d[\d,]*(?:\s?million)?/gi));
  } else {
    push(sentence.match(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?million)?|\b\d+(?:\.\d+)?\s?percent/gi));
  }
  return [...new Set(found)];
}

function scoreSentence(sentence: string, terms: string[], qTerms: string[]): number {
  const hay = sentence.toLowerCase();
  let score = 0;
  let hits = 0;
  for (const term of terms) {
    if (!term || !hasTerm(hay, term)) continue;
    score += term.length >= 5 ? 2 : 1;
    hits += 1;
  }
  if (!hits) return 0;
  for (const term of qTerms) if (term.length > 3 && hay.includes(term)) score += 1.25;
  if (/\d/.test(sentence)) score += 1.5;
  if (/opening|substantial completion|program cost|likely program|jobs figure|local match|salt marsh|wetland effect|foundation premium|average annual jobs|permanent jobs/i.test(sentence)) {
    score += 2.5;
  }
  if (sentence.length < 48) score -= 2;
  if (sentence.length > 340) score -= 1;
  return score;
}

function topByDoc(docs: SourceDoc[], chunks: Chunk[], facet: Facet, qTerms: string[], limit: number): Evidence[] {
  const out: Evidence[] = [];
  for (const doc of docs) {
    const ranked: Evidence[] = [];
    for (const chunk of chunks) {
      if (chunk.docId !== doc.id) continue;
      for (const sentence of sentencesOf(chunk.text)) {
        const score = scoreSentence(sentence, facet.terms, qTerms);
        if (score < 3) continue;
        ranked.push({ doc, chunk, sentence, score, figures: figuresFor(facet, sentence) });
      }
    }
    ranked.sort((a, b) => b.score - a.score);
    const picked: Evidence[] = [];
    for (const item of ranked) {
      if (picked.some((prev) => prev.sentence.slice(0, 48) === item.sentence.slice(0, 48))) continue;
      picked.push(item);
      if (picked.length >= limit) break;
    }
    out.push(...picked);
  }
  return out.sort((a, b) => b.score - a.score);
}

function familyOf(figure: string): string {
  const value = figure.toLowerCase();
  if (/percent/.test(value)) return "percent";
  if (/million|billion|\$/.test(value)) return "money";
  if (/acre|cubic/.test(value)) return "area";
  if (/meter/.test(value)) return "length";
  if (/month/.test(value)) return "duration";
  if (/minor|moderate|long-duration/.test(value)) return "grade";
  if (/spring|summer|fall|winter|january|february|march|april|may|june|july|august|september|october|november|december|20\d{2}/.test(value)) return "date";
  if (/class/.test(value)) return "class";
  return "count";
}

function normFigure(figure: string): string {
  return figure.toLowerCase().replace(/[$,]/g, "").replace(/\s+/g, " ").trim();
}

class CiteBook {
  citations: Citation[] = [];
  private index = new Map<string, number>();

  mark(chunk: Chunk, quote: string): number {
    const key = `${chunk.id}:${quote}`;
    const existing = this.index.get(key);
    if (existing) return existing;
    const n = this.citations.length + 1;
    this.citations.push({ n, chunkId: chunk.id, docId: chunk.docId, quote });
    this.index.set(key, n);
    return n;
  }
}

function titleFor(mode: Mode, question: string, facets: Facet[]): string {
  if (mode === "timeline") {
    if (/timeline|in time|chronolog|sequence|\blay\b/i.test(question) || !facets.length || facets[0].id === "question" || facets[0].id === "process") return "Timeline";
    return `Timeline · ${facets[0].label}`;
  }
  if (mode === "conflicts") return "Where the record splits";
  if (mode === "compare") return `Comparison · ${facets.map((facet) => facet.label).slice(0, 3).join(", ")}`;
  if (mode === "brief") return "Cross-document brief";
  if (mode === "chat") {
    const named = facets.filter((facet) => facet.id !== "question").map((facet) => facet.label);
    if (named.length) return named.slice(0, 2).join(" and ");
  }
  const words = question.replace(/[?]/g, "").split(/\s+/).slice(0, 12).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function buildConflicts(groups: { facet: Facet; evidence: Evidence[] }[], book: CiteBook): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const group of groups) {
    if (group.evidence.length < 2) continue;
    const primaries = group.evidence.map((item) => item.figures[0]).filter(Boolean) as string[];
    const byFamily = new Map<string, Set<string>>();
    for (const figure of primaries) {
      const family = familyOf(figure);
      const set = byFamily.get(family) ?? new Set<string>();
      set.add(normFigure(figure));
      byFamily.set(family, set);
    }
    const splitLabels: string[] = [];
    for (const figure of primaries) {
      const family = familyOf(figure);
      if ((byFamily.get(family)?.size ?? 0) >= 2) splitLabels.push(figure.replace(/\s+/g, " "));
    }
    const qualitative = PAIRS.some(([left, right]) => {
      const hasLeft = group.evidence.some((item) => left.test(item.sentence));
      const hasRight = group.evidence.some((item) => right.test(item.sentence) && !left.test(item.sentence));
      return hasLeft && hasRight;
    });
    if (!splitLabels.length && !qualitative) continue;
    const seen = new Set<string>();
    const chosen: Evidence[] = [];
    for (const item of group.evidence) {
      if (seen.has(item.doc.id)) continue;
      seen.add(item.doc.id);
      chosen.push(item);
    }
    for (const item of group.evidence) {
      const lead = item.figures[0];
      if (!lead || chosen.includes(item)) continue;
      if (chosen.some((side) => side.figures[0] && normFigure(side.figures[0]) === normFigure(lead))) continue;
      chosen.push(item);
    }
    const sides = chosen.slice(0, 6).map((item) => ({
      docId: item.doc.id,
      docTitle: item.doc.short,
      position: item.sentence,
      n: book.mark(item.chunk, item.sentence),
    }));
    const lead = [...new Set(splitLabels)].slice(0, 4);
    conflicts.push({
      issue: lead.length >= 2 ? `${group.facet.label} — ${lead.join(" vs ")}` : group.facet.label,
      sides,
    });
  }
  return conflicts.slice(0, 6);
}

function collectTimeline(chunks: Chunk[], docs: SourceDoc[], qTerms: string[]): { when: string; sort: number; event: string; score: number; chunk: Chunk; sentence: string }[] {
  const events: { when: string; sort: number; event: string; score: number; chunk: Chunk; sentence: string }[] = [];
  const docOf = new Map(docs.map((doc) => [doc.id, doc]));
  for (const chunk of chunks) {
    const doc = docOf.get(chunk.docId);
    if (!doc) continue;
    for (const sentence of sentencesOf(chunk.text)) {
      const dates = extractDates(sentence);
      if (!dates.length) continue;
      const overlap = qTerms.reduce((score, term) => (sentence.toLowerCase().includes(term) ? score + 1 : score), 0);
      const dated = dates[0];
      events.push({
        when: dated.label,
        sort: dated.sort,
        event: `${doc.short}: ${sentence}`,
        score: overlap + (/is dated|was held|is scheduled|scheduled for|substantial completion/i.test(sentence) ? 3 : 0),
        chunk,
        sentence,
      });
    }
  }
  const narrowed = events.length > 16 && qTerms.length && events.filter((event) => event.score >= 1).length >= 4 ? events.filter((event) => event.score >= 1) : events;
  const pool = (narrowed.length > 16 ? [...narrowed].sort((a, b) => b.score - a.score).slice(0, 16) : narrowed).sort((a, b) => a.sort - b.sort || b.score - a.score);
  const seen = new Set<string>();
  const perLabel = new Map<string, number>();
  const unique = [];
  for (const event of pool) {
    const key = `${event.sort}:${event.event.slice(0, 80)}`;
    if (seen.has(key)) continue;
    const count = perLabel.get(event.when) ?? 0;
    if (count >= 2) continue;
    seen.add(key);
    perLabel.set(event.when, count + 1);
    unique.push(event);
  }
  return unique;
}

export function missingFacets(facets: Facet[], docs: SourceDoc[], chunks: Chunk[], qTerms: string[]): string[] {
  return facets
    .filter((facet) => facet.id !== "question" && topByDoc(docs, chunks, facet, qTerms, 1).length === 0)
    .map((facet) => facet.terms.slice(0, 4).join(" "));
}

export function composeLocal(input: {
  mode: Mode;
  question: string;
  docs: SourceDoc[];
  chunks: Chunk[];
  plan: LocalPlan;
  opened: RankedChunk[];
  hop: number;
}): Analysis {
  const qTerms = questionTerms(input.question);
  const book = new CiteBook();
  const groups = input.plan.facets
    .filter((facet) => facet.id !== "question" || input.plan.facets.length === 1)
    .map((facet) => ({ facet, evidence: topByDoc(input.docs, input.chunks, facet, qTerms, input.mode === "conflicts" ? 2 : 2) }));

  const conflicts = input.mode === "timeline" ? [] : buildConflicts(groups, book);
  const timelineAll = input.mode === "timeline" ? collectTimeline(input.chunks, input.docs, qTerms) : [];
  const timelineKept = timelineAll.slice(0, 12).map((event) => ({
    when: event.when,
    sort: event.sort,
    event: event.event,
    n: book.mark(event.chunk, event.sentence),
  }));

  const sections: string[] = [];
  for (const group of groups) {
    if (!group.evidence.length) continue;
    const lines = group.evidence.slice(0, 7).map((item) => {
      const n = book.mark(item.chunk, item.sentence);
      return `- **${item.doc.short}** [${n}]: ${item.sentence}`;
    });
    sections.push(`**${group.facet.label}**\n\n${lines.join("\n")}`);
  }

  if (!sections.length) {
    const fallback = input.opened.slice(0, 4);
    const lines = fallback.map((hit) => {
      const doc = input.docs.find((item) => item.id === hit.chunk.docId);
      const sentence = sentencesOf(hit.chunk.text)[0] ?? hit.chunk.text;
      const n = book.mark(hit.chunk, sentence);
      return `- **${doc?.short ?? "Source"}** [${n}]: ${sentence}`;
    });
    if (lines.length) sections.push(lines.join("\n"));
  }

  const citedDocs = new Set(book.citations.map((citation) => citation.docId));
  const coverage: Analysis["coverage"] =
    book.citations.length === 0 ? "insufficient" : conflicts.length || citedDocs.size < Math.min(2, input.docs.length) ? "partial" : "sufficient";

  let comparison: Analysis["comparison"] = null;
  if (input.mode === "compare" || input.mode === "brief") {
    const aspects = groups.filter((group) => group.evidence.length).map((group) => group.facet.label);
    const docIds = [...new Set(groups.flatMap((group) => group.evidence.map((item) => item.doc.id)))];
    comparison = {
      aspects,
      columns: docIds.map((docId) => {
        const doc = input.docs.find((item) => item.id === docId);
        return {
          docId,
          docTitle: doc?.short ?? "Source",
          cells: groups
            .filter((group) => group.evidence.length)
            .map((group) => {
              const item = group.evidence.find((entry) => entry.doc.id === docId);
              if (!item) return "—";
              const n = book.mark(item.chunk, item.sentence);
              const lead = item.figures[0] ?? clip(item.sentence, 90);
              return `${lead} [${n}]`;
            }),
        };
      }),
    };
    if (!comparison.aspects.length) comparison = null;
  }

  const lede = !book.citations.length
    ? "Nothing in the loaded documents answers this directly."
    : input.mode === "chat"
      ? conflicts.length
        ? "The sources do not agree. The lines below are quotations, not a paraphrase."
        : `Quoted from ${citedDocs.size} ${citedDocs.size === 1 ? "source" : "sources"}.`
      : conflicts.length
        ? `${citedDocs.size} sources are in the answer, and ${conflicts.length} ${conflicts.length === 1 ? "issue does" : "issues do"} not agree. The lines below are quotations, not a paraphrase.`
        : `${citedDocs.size} ${citedDocs.size === 1 ? "source speaks" : "sources speak"} to this. The lines below are quotations from the passages.`;

  const caveats: string[] = [];
  if (groups.some((group) => group.evidence.some((item) => /premium|exclud|line item|not part of/i.test(item.sentence)))) {
    caveats.push("Some money figures are totals and some are line items. They should not be added or averaged unless a source does that itself.");
  }
  if (coverage !== "sufficient") {
    caveats.push("Coverage is incomplete. Treat a silence in one document as silence, not as disagreement.");
  }
  if (input.mode === "timeline" && timelineKept.length === 0) {
    caveats.push("No dated sentences were found. Add dates in the form 12 March 2025 if you want them on the timeline.");
  }

  const showTimeline = timelineKept.length ? timelineKept : null;

  return {
    title: titleFor(input.mode, input.question, input.plan.facets),
    lede,
    markdown: sections.join("\n\n") || "No passage cleared the bar for this question.",
    citations: book.citations,
    caveats,
    coverage,
    comparison: input.mode === "compare" ? comparison : input.mode === "brief" ? comparison : null,
    timeline: showTimeline && showTimeline.length ? showTimeline : null,
    conflicts: input.mode === "timeline" ? null : conflicts.length ? conflicts : null,
    engine: "local",
    engineNote: "",
    queries: input.plan.queries,
    passageCount: input.opened.length,
    hop: input.hop,
  };
}

export function catalogOf(docs: SourceDoc[], chunks: Chunk[]): { id: string; title: string; summary: string }[] {
  return docs.map((doc) => {
    const text = chunks
      .filter((chunk) => chunk.docId === doc.id)
      .map((chunk) => chunk.text)
      .join(" ");
    return { id: doc.id, title: `${doc.short} — ${doc.title}`, summary: clip(text, 420) };
  });
}
