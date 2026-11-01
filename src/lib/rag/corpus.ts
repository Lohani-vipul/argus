import type { Chunk, SourceDoc } from "@/lib/rag/types";

const STOP = new Set(
  `a an the of to and or for in on at by from with as is are was were be been being it this that these those into over after before about than then so if we you they their its our your do does did what where when who how which`.split(
    " ",
  ),
);

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function hash32(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/(\d),(?=\d)/g, "$1").replace(/[$%]/g, " ");
  const raw = normalized.match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
  return raw.filter((token) => token.length > 1 && !STOP.has(token));
}

export function chunkDocument(doc: Pick<SourceDoc, "id" | "text">): Chunk[] {
  const lines = doc.text.split(/\n/);
  let section = "Document";
  const blocks: { section: string; text: string }[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    buffer = [];
    if (text) blocks.push({ section, text });
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flush();
      section = heading[2].trim();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buffer.push(line.trim());
  }
  flush();

  const chunks: Chunk[] = [];
  let packed: { section: string; text: string } | null = null;
  const pushPacked = () => {
    if (!packed) return;
    const index = chunks.length;
    chunks.push({
      id: `${doc.id}:${index}:${hash32(packed.text)}`,
      docId: doc.id,
      index,
      section: packed.section,
      text: packed.text,
    });
    packed = null;
  };

  for (const block of blocks) {
    if (!packed) {
      packed = { ...block };
      continue;
    }
    if (packed.section === block.section && packed.text.length + block.text.length < 900) {
      packed.text = `${packed.text} ${block.text}`;
    } else {
      pushPacked();
      packed = { ...block };
    }
  }
  pushPacked();
  return chunks;
}

export function sentencesOf(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  return flat
    .split(/(?<=[.?!])\s+(?=[A-Z0-9"])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 40);
}

type Bm25Index = {
  docs: { chunk: Chunk; tf: Map<string, number>; len: number }[];
  df: Map<string, number>;
  avg: number;
  n: number;
};

export function buildBm25(chunks: Chunk[]): Bm25Index {
  const df = new Map<string, number>();
  const docs = chunks.map((chunk) => {
    const tokens = tokenize(`${chunk.section} ${chunk.text}`);
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    return { chunk, tf, len: tokens.length || 1 };
  });
  const avg = docs.reduce((sum, doc) => sum + doc.len, 0) / (docs.length || 1);
  return { docs, df, avg, n: docs.length };
}

export function bm25Search(index: Bm25Index, query: string, limit: number): { chunk: Chunk; score: number }[] {
  const terms = tokenize(query);
  if (!terms.length || !index.n) return [];
  const k1 = 1.4;
  const b = 0.65;
  const scored: { chunk: Chunk; score: number }[] = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const term of terms) {
      const freq = doc.tf.get(term) ?? 0;
      if (!freq) continue;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      const norm = freq + k1 * (1 - b + (b * doc.len) / index.avg);
      score += (idf * freq * (k1 + 1)) / norm;
    }
    if (score > 0) scored.push({ chunk: doc.chunk, score });
  }
  scored.sort((a, c) => c.score - a.score);
  return scored.slice(0, limit);
}

export function fuseRanks(lists: { chunk: Chunk; score: number }[][], limit: number): { chunk: Chunk; score: number }[] {
  const byId = new Map<string, { chunk: Chunk; score: number }>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const add = 1 / (60 + rank + 1);
      const prev = byId.get(hit.chunk.id);
      if (prev) prev.score += add;
      else byId.set(hit.chunk.id, { chunk: hit.chunk, score: add });
    });
  }
  return [...byId.values()].sort((a, c) => c.score - a.score).slice(0, limit);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function encodeVector(values: number[]): string {
  const floats = new Float32Array(values);
  const bytes = new Uint8Array(floats.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeVector(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return new Float32Array(buffer);
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const SEASONS: Record<string, number> = { spring: 4, summer: 7, fall: 10, autumn: 10, winter: 1 };

export type DatedSentence = { label: string; sort: number; sentence: string };

export function extractDates(sentence: string): { label: string; sort: number }[] {
  const hits: { start: number; end: number; label: string; sort: number }[] = [];
  const claim = (start: number, end: number, label: string, sort: number) => {
    if (hits.some((hit) => start < hit.end && end > hit.start)) return;
    hits.push({ start, end, label, sort });
  };
  const month = "(January|February|March|April|May|June|July|August|September|October|November|December)";

  for (const match of sentence.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${month}\\s+(20\\d{2})\\b`, "gi"))) {
    const day = Number(match[1]);
    const mon = MONTHS[match[2].toLowerCase()];
    const year = Number(match[3]);
    claim(match.index ?? 0, (match.index ?? 0) + match[0].length, match[0], year * 10000 + mon * 100 + day);
  }
  for (const match of sentence.matchAll(new RegExp(`\\b${month}\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "gi"))) {
    const mon = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    claim(match.index ?? 0, (match.index ?? 0) + match[0].length, match[0], year * 10000 + mon * 100 + day);
  }
  for (const match of sentence.matchAll(new RegExp(`\\b${month}\\s+(20\\d{2})\\b`, "gi"))) {
    const mon = MONTHS[match[1].toLowerCase()];
    const year = Number(match[2]);
    claim(match.index ?? 0, (match.index ?? 0) + match[0].length, match[0], year * 10000 + mon * 100);
  }
  for (const match of sentence.matchAll(/\b(spring|summer|fall|autumn|winter)\s+(20\d{2})\b/gi)) {
    const season = SEASONS[match[1].toLowerCase()];
    const year = Number(match[2]);
    claim(match.index ?? 0, (match.index ?? 0) + match[0].length, match[0], year * 10000 + season * 100);
  }
  return hits.map(({ label, sort }) => ({ label, sort }));
}

export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}
