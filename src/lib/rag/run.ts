import { decodeVector, encodeVector } from "@/lib/rag/corpus";
import { answerWithGrok, embedTexts, planWithGrok } from "@/lib/rag/grok.functions";
import { catalogOf, composeLocal, missingFacets, planLocal, retrieveLocal, semanticRerank } from "@/lib/rag/local";
import type { Analysis, Chunk, Mode, PriorTurn, RankedChunk, SourceDoc, TraceStep } from "@/lib/rag/types";

export type GrokGate = { blocked: boolean };

const TRACE: TraceStep[] = [
  { id: "plan", label: "Planner", detail: "Splitting the question into searches", state: "run" },
  { id: "retrieve", label: "Retriever", detail: "Waiting on the plan", state: "wait" },
  { id: "critic", label: "Critic", detail: "Waiting on passages", state: "wait" },
  { id: "scribe", label: "Scribe", detail: "Waiting on coverage", state: "wait" },
];

function steps(patch: Partial<Record<TraceStep["id"], Partial<TraceStep>>>): TraceStep[] {
  return TRACE.map((step) => ({ ...step, ...patch[step.id] }));
}

function questionTerms(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length > 2)
    .slice(0, 10) ?? [];
}

function parseRaw(value: string): RawAnalysis | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RawAnalysis) : null;
  } catch {
    return null;
  }
}

function noteFor(engine: "grok" | "local", failure: string): string {
  if (engine === "grok") return "Written by Grok from the passages the retriever opened. Each number opens that passage.";
  if (/credit/i.test(failure)) {
    return "Grok is out of credits, so the local reader searched the desk and quoted matching sentences. Each number opens that passage.";
  }
  if (failure) return `${failure} The local reader searched the desk and quoted matching sentences.`;
  return "The local reader searched the desk and quoted matching sentences. Each number opens that passage.";
}

type RawAnalysis = Record<string, unknown>;

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function fromGrok(raw: RawAnalysis, opened: RankedChunk[], docs: SourceDoc[], queries: string[], hop: number, engineNote: string): Analysis | null {
  const markdown = typeof raw.markdown === "string" ? raw.markdown.trim() : "";
  const lede = asString(raw.lede, 500);
  if (!markdown && !lede) return null;
  const chunkById = new Map(opened.map((hit) => [hit.chunk.id, hit.chunk]));
  const docById = new Map(docs.map((doc) => [doc.id, doc]));
  const cited = Array.isArray(raw.citations) ? raw.citations : [];
  const citations = cited
    .map((item, index) => {
      const row = item as { n?: unknown; chunkId?: unknown; quote?: unknown };
      const chunkId = asString(row.chunkId, 80);
      const byNumber = typeof row.n === "number" ? opened[row.n - 1]?.chunk : undefined;
      const chunk = chunkById.get(chunkId) ?? byNumber;
      if (!chunk) return null;
      const quote = asString(row.quote, 320);
      const usable = quote && chunk.text.includes(quote) ? quote : chunk.text.slice(0, 180);
      const n = typeof row.n === "number" ? row.n : index + 1;
      return { n, chunkId: chunk.id, docId: chunk.docId, quote: usable };
    })
    .filter((item): item is Analysis["citations"][number] => Boolean(item))
    .slice(0, 16);
  if (!citations.length) return null;

  const coverageRaw = asString(raw.coverage, 20);
  const coverage: Analysis["coverage"] = coverageRaw === "sufficient" || coverageRaw === "insufficient" ? coverageRaw : "partial";

  const comparison = parseComparison(raw.comparison, docById);
  const timeline = parseTimeline(raw.timeline);
  const conflicts = parseConflicts(raw.conflicts, docById);

  return {
    title: asString(raw.title, 140) || "Reading",
    lede: lede || "Grok answered from the retrieved passages.",
    markdown: markdown || lede,
    citations,
    caveats: Array.isArray(raw.caveats) ? raw.caveats.map((item) => asString(item, 240)).filter(Boolean).slice(0, 4) : [],
    coverage,
    comparison,
    timeline,
    conflicts,
    engine: "grok",
    engineNote,
    queries,
    passageCount: opened.length,
    hop,
  };
}

function parseComparison(value: unknown, docs: Map<string, SourceDoc>): Analysis["comparison"] {
  if (!value || typeof value !== "object") return null;
  const row = value as { aspects?: unknown; columns?: unknown };
  const aspects = Array.isArray(row.aspects) ? row.aspects.map((item) => asString(item, 60)).filter(Boolean).slice(0, 6) : [];
  const columns = Array.isArray(row.columns)
    ? row.columns
        .map((item) => {
          const column = item as { docId?: unknown; docTitle?: unknown; cells?: unknown };
          const docId = asString(column.docId, 80);
          const cells = Array.isArray(column.cells) ? column.cells.map((cell) => asString(cell, 160)).slice(0, aspects.length || 6) : [];
          if (!docId || !cells.length) return null;
          return { docId, docTitle: asString(column.docTitle, 80) || docs.get(docId)?.short || "Source", cells };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 8)
    : [];
  if (!aspects.length || !columns.length) return null;
  return { aspects, columns };
}

function parseTimeline(value: unknown): Analysis["timeline"] {
  if (!Array.isArray(value)) return null;
  const events = value
    .map((item) => {
      const row = item as { when?: unknown; sort?: unknown; event?: unknown; n?: unknown };
      const when = asString(row.when, 40);
      const event = asString(row.event, 280);
      if (!when || !event) return null;
      return { when, sort: typeof row.sort === "number" ? row.sort : 0, event, n: typeof row.n === "number" ? row.n : 0 };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 12);
  return events.length ? events : null;
}

function parseConflicts(value: unknown, docs: Map<string, SourceDoc>): Analysis["conflicts"] {
  if (!Array.isArray(value)) return null;
  const conflicts = value
    .map((item) => {
      const row = item as { issue?: unknown; sides?: unknown };
      const issue = asString(row.issue, 140);
      const sides = Array.isArray(row.sides)
        ? row.sides
            .map((side) => {
              const entry = side as { docId?: unknown; docTitle?: unknown; position?: unknown; n?: unknown };
              const docId = asString(entry.docId, 80);
              const position = asString(entry.position, 320);
              if (!docId || !position) return null;
              return {
                docId,
                docTitle: asString(entry.docTitle, 80) || docs.get(docId)?.short || "Source",
                position,
                n: typeof entry.n === "number" ? entry.n : 0,
              };
            })
            .filter((side): side is NonNullable<typeof side> => Boolean(side))
            .slice(0, 4)
        : [];
      if (!issue || sides.length < 2) return null;
      return { issue, sides };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 6);
  return conflicts.length ? conflicts : null;
}

function missingFrom(raw: RawAnalysis): string[] {
  return Array.isArray(raw.missingQueries) ? raw.missingQueries.map((item) => asString(item, 160)).filter(Boolean).slice(0, 2) : [];
}

export async function executeReading(input: {
  mode: Mode;
  question: string;
  docs: SourceDoc[];
  chunks: Chunk[];
  vectors: Record<string, string>;
  history: PriorTurn[];
  gate: GrokGate;
  onTrace: (trace: TraceStep[]) => void;
}): Promise<Analysis> {
  const localPlan = planLocal(input.mode, input.question, input.docs, input.history);
  let queries = localPlan.queries;
  let docFocus = localPlan.docFocus;
  let intent = localPlan.intent;
  let failure = "";

  input.onTrace(steps({ plan: { state: "run", detail: "Splitting the question into searches" } }));
  await Promise.resolve();

  if (!input.gate.blocked) {
    const planned = await planWithGrok({
      data: {
        mode: input.mode,
        question: input.question,
        catalog: catalogOf(input.docs, input.chunks),
        history: input.history,
      },
    });
    if (planned.ok) {
      queries = planned.queries;
      docFocus = planned.docFocus.length ? planned.docFocus : docFocus;
      intent = planned.intent;
    } else {
      failure = planned.error;
      if (planned.code === "blocked" || planned.code === "unavailable") input.gate.blocked = true;
    }
  }

  input.onTrace(
    steps({
      plan: { state: "done", detail: intent },
      retrieve: { state: "run", detail: queries.join(" · ") },
    }),
  );

  const limit = input.mode === "brief" || input.mode === "compare" ? 12 : 8;
  let opened = retrieveLocal(input.chunks, queries, docFocus, limit);
  const vectorMap = new Map<string, Float32Array>();
  for (const [id, encoded] of Object.entries(input.vectors)) {
    if (!encoded) continue;
    try {
      vectorMap.set(id, decodeVector(encoded));
    } catch {
      /* ignore a bad cache entry */
    }
  }
  if (!input.gate.blocked && vectorMap.size) {
    const embedded = await embedTexts({ data: { kind: "query", texts: queries.slice(0, 4) } });
    if (embedded.ok) {
      const queryVectors = embedded.vectors.map((vector) => new Float32Array(vector));
      opened = semanticRerank(opened, queryVectors, vectorMap, input.chunks, limit);
    } else if (embedded.code === "blocked" || embedded.code === "unavailable") {
      input.gate.blocked = true;
      if (!failure) failure = embedded.error;
    }
  }

  const covered = new Set(opened.map((hit) => hit.chunk.docId));
  input.onTrace(
    steps({
      plan: { state: "done", detail: intent },
      retrieve: {
        state: "done",
        detail: `${opened.length} passages across ${covered.size} ${covered.size === 1 ? "document" : "documents"}`,
      },
      critic: { state: "run", detail: "Checking whether the facets are actually covered" },
    }),
  );
  await Promise.resolve();

  let hop = 0;
  const gaps = missingFacets(localPlan.facets, input.docs, opened.map((hit) => hit.chunk), questionTerms(input.question));
  if (gaps.length && input.mode !== "timeline") {
    const extra = retrieveLocal(input.chunks, gaps, [], 6);
    const seen = new Set(opened.map((hit) => hit.chunk.id));
    const merged = [...opened];
    for (const hit of extra) {
      if (seen.has(hit.chunk.id)) continue;
      seen.add(hit.chunk.id);
      merged.push(hit);
    }
    opened = merged.slice(0, 12);
    hop = 1;
  }

  input.onTrace(
    steps({
      plan: { state: "done", detail: intent },
      retrieve: { state: "done", detail: `${opened.length} passages across ${new Set(opened.map((hit) => hit.chunk.docId)).size} documents` },
      critic: {
        state: "done",
        detail: hop ? `Second search filled a gap: ${gaps.join("; ")}` : gaps.length ? "Gaps remain, but a second search was not useful" : "The opened passages cover the question's facets",
      },
      scribe: { state: "run", detail: input.gate.blocked ? "Quoting the passages locally" : "Writing from the passages" },
    }),
  );

  const finishLocal = (reason: string) => {
    const analysis = composeLocal({
      mode: input.mode,
      question: input.question,
      docs: input.docs,
      chunks: input.chunks,
      plan: { ...localPlan, queries },
      opened,
      hop,
    });
    analysis.queries = queries;
    analysis.engineNote = noteFor("local", reason);
    analysis.hop = hop;
    return analysis;
  };

  const prior =
    input.mode === "chat" && input.history.length
      ? `Previous question: ${input.history.at(-1)?.question ?? ""}. ${input.history.at(-1)?.gist ?? ""}`.trim()
      : "";

  if (!input.gate.blocked && opened.length) {
    const passages = opened.map((hit) => {
      const doc = input.docs.find((item) => item.id === hit.chunk.docId);
      return {
        chunkId: hit.chunk.id,
        docId: hit.chunk.docId,
        docTitle: doc?.short ?? "Source",
        section: hit.chunk.section,
        text: hit.chunk.text,
      };
    });
    const first = await answerWithGrok({ data: { mode: input.mode, question: input.question, passages, hop: 0, prior } });
    if (!first.ok) {
      if (first.code === "blocked" || first.code === "unavailable") input.gate.blocked = true;
      return finishLocal(first.error);
    }
    let raw = parseRaw(first.raw);
    if (!raw) return finishLocal("Grok replied in an unreadable shape.");
    const follow = missingFrom(raw);
    if (follow.length && hop === 0) {
      const extra = retrieveLocal(input.chunks, follow, docFocus, 6);
      const seen = new Set(opened.map((hit) => hit.chunk.id));
      for (const hit of extra) {
        if (seen.has(hit.chunk.id)) continue;
        seen.add(hit.chunk.id);
        opened.push(hit);
      }
      opened = opened.slice(0, 12);
      hop = 1;
      const second = await answerWithGrok({
        data: {
          mode: input.mode,
          question: input.question,
          hop: 1,
          prior,
          passages: opened.map((hit) => {
            const doc = input.docs.find((item) => item.id === hit.chunk.docId);
            return { chunkId: hit.chunk.id, docId: hit.chunk.docId, docTitle: doc?.short ?? "Source", section: hit.chunk.section, text: hit.chunk.text };
          }),
        },
      });
      if (second.ok) {
        const parsed = parseRaw(second.raw);
        if (parsed) raw = parsed;
      }
    }
    const analysis = fromGrok(raw, opened, input.docs, queries, hop, noteFor("grok", ""));
    if (analysis) {
      analysis.passageCount = opened.length;
      return analysis;
    }
    return finishLocal("Grok replied in an unreadable shape.");
  }

  return finishLocal(failure);
}

export async function embedMissing(chunks: Chunk[], vectors: Record<string, string>, gate: GrokGate): Promise<{ ok: true; vectors: Record<string, string> } | { ok: false; error: string; blocked: boolean }> {
  if (gate.blocked) return { ok: false, error: "Grok is paused for this session.", blocked: true };
  const missing = chunks.filter((chunk) => !vectors[chunk.id]).slice(0, 48);
  const next = { ...vectors };
  for (let i = 0; i < missing.length; i += 12) {
    const batch = missing.slice(i, i + 12);
    const result = await embedTexts({ data: { kind: "passage", texts: batch.map((chunk) => `${chunk.section}. ${chunk.text}`) } });
    if (!result.ok) {
      if (result.code === "blocked" || result.code === "unavailable") gate.blocked = true;
      return { ok: false, error: result.error, blocked: gate.blocked };
    }
    batch.forEach((chunk, index) => {
      const vector = result.vectors[index];
      if (vector?.length) next[chunk.id] = encodeVector(vector);
    });
  }
  return { ok: true, vectors: next };
}
