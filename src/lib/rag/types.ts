export type Mode = "ask" | "brief" | "compare" | "conflicts" | "timeline" | "chat";

export type SourceDoc = {
  id: string;
  title: string;
  short: string;
  filename: string;
  kicker: string;
  dateLabel: string;
  text: string;
  addedAt: number;
  note: string;
};

export type Chunk = {
  id: string;
  docId: string;
  index: number;
  section: string;
  text: string;
};

export type Citation = {
  n: number;
  chunkId: string;
  docId: string;
  quote: string;
};

export type Comparison = {
  aspects: string[];
  columns: { docId: string; docTitle: string; cells: string[] }[];
};

export type TimelineEvent = {
  when: string;
  sort: number;
  event: string;
  n: number;
};

export type Conflict = {
  issue: string;
  sides: { docId: string; docTitle: string; position: string; n: number }[];
};

export type Analysis = {
  title: string;
  lede: string;
  markdown: string;
  citations: Citation[];
  caveats: string[];
  coverage: "sufficient" | "partial" | "insufficient";
  comparison: Comparison | null;
  timeline: TimelineEvent[] | null;
  conflicts: Conflict[] | null;
  engine: "grok" | "local";
  engineNote: string;
  queries: string[];
  passageCount: number;
  hop: number;
};

export type TraceStep = {
  id: string;
  label: string;
  detail: string;
  state: "wait" | "run" | "done";
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode: Mode;
  trace: TraceStep[];
  analysis: Analysis | null;
  error: string;
  createdAt: number;
};

export type PriorTurn = {
  question: string;
  title: string;
  gist: string;
};

export type RankedChunk = {
  chunk: Chunk;
  score: number;
};
