import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUpDown, BookOpen, Clock, FileText, Library, MessageCircle, MessageSquare, Plus, Scale, Search, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { chunkDocument } from "@/lib/rag/corpus";
import { filterAndSortDocs, type DocSortMode } from "@/lib/rag/desk-utils";
import { INQUIRIES, SAMPLE_DOCS } from "@/lib/rag/sample";
import { embedMissing, executeReading, type GrokGate } from "@/lib/rag/run";
import { parseFile, parsePaste } from "@/lib/rag/parse";
import { useDesk } from "@/lib/rag/store";
import type { Analysis, ChatMessage, Mode, PriorTurn, SourceDoc, TraceStep } from "@/lib/rag/types";
import { MarkdownBlock, RichText } from "@/components/argus/markdown";

const MODES: { id: Mode; label: string; icon: typeof MessageSquare; hint: string }[] = [
  { id: "ask", label: "Ask", icon: MessageSquare, hint: "Ask across the desk" },
  { id: "brief", label: "Brief", icon: FileText, hint: "Write a short brief" },
  { id: "compare", label: "Compare", icon: ArrowLeftRight, hint: "Compare the sources" },
  { id: "conflicts", label: "Conflicts", icon: Scale, hint: "Find disagreements" },
  { id: "timeline", label: "Timeline", icon: Clock, hint: "Lay out the dates" },
  { id: "chat", label: "Chat", icon: MessageCircle, hint: "Ask, then follow up" },
];

export function Desk() {
  const hydrated = useDesk((state) => state.hydrated);
  const docs = useDesk((state) => state.docs);
  const messages = useDesk((state) => state.messages);
  const vectors = useDesk((state) => state.vectors);
  const mode = useDesk((state) => state.mode);
  const running = useDesk((state) => state.running);
  const embedState = useDesk((state) => state.embedState);
  const embedError = useDesk((state) => state.embedError);
  const grokBlocked = useDesk((state) => state.grokBlocked);
  const activeDocId = useDesk((state) => state.activeDocId);
  const focus = useDesk((state) => state.focus);
  const mobilePane = useDesk((state) => state.mobilePane);
  const uploadError = useDesk((state) => state.uploadError);
  const setHydrated = useDesk((state) => state.setHydrated);
  const setMode = useDesk((state) => state.setMode);
  const setPane = useDesk((state) => state.setPane);
  const setActiveDoc = useDesk((state) => state.setActiveDoc);
  const setFocus = useDesk((state) => state.setFocus);
  const setUploadError = useDesk((state) => state.setUploadError);
  const addDocs = useDesk((state) => state.addDocs);
  const removeDoc = useDesk((state) => state.removeDoc);
  const pushExchange = useDesk((state) => state.pushExchange);
  const updateMessage = useDesk((state) => state.updateMessage);
  const clearChat = useDesk((state) => state.clearChat);
  const setRunning = useDesk((state) => state.setRunning);
  const setVectors = useDesk((state) => state.setVectors);
  const setEmbedState = useDesk((state) => state.setEmbedState);
  const setGrokBlocked = useDesk((state) => state.setGrokBlocked);

  const [draft, setDraft] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteBody, setPasteBody] = useState("");
  const [dragging, setDragging] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [sortMode, setSortMode] = useState<DocSortMode>("recent");
  const gate = useRef<GrokGate>({ blocked: false });
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.resolve(useDesk.persist.rehydrate()).finally(() => setHydrated());
  }, [setHydrated]);

  const chunks = useMemo(() => docs.flatMap((doc) => chunkDocument(doc)), [docs]);
  const passageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chunk of chunks) {
      counts.set(chunk.docId, (counts.get(chunk.docId) ?? 0) + 1);
    }
    return counts;
  }, [chunks]);
  const visibleDocs = useMemo(() => filterAndSortDocs(docs, libraryQuery, sortMode, passageCounts), [docs, libraryQuery, sortMode, passageCounts]);
  const activeDoc = docs.find((doc) => doc.id === activeDocId) ?? null;
  const activeChunks = chunks.filter((chunk) => chunk.docId === activeDoc?.id);
  const dossierLoaded = SAMPLE_DOCS.every((doc) => docs.some((item) => item.id === doc.id));
  const embedded = chunks.filter((chunk) => vectors[chunk.id]).length;
  const focusCitation = focus
    ? messages.find((message) => message.id === focus.messageId)?.analysis?.citations.find((citation) => citation.n === focus.n)
    : undefined;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!focusCitation) return;
    document.getElementById(`chunk-${focusCitation.chunkId}`)?.scrollIntoView({ block: "center" });
  }, [focusCitation]);

  async function ingest(files: File[]) {
    const parsed: SourceDoc[] = [];
    const errors: string[] = [];
    for (const file of files.slice(0, 6)) {
      try {
        parsed.push(await parseFile(file));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
    if (parsed.length) addDocs(parsed);
    setUploadError(errors.join(" "));
    if (parsed.length) setPane("library");
  }

  async function ask(question: string, nextMode: Mode = mode) {
    const trimmed = question.trim();
    if (!trimmed || running || !docs.length) return;
    const history = historyOf(useDesk.getState().messages);
    const { assistantId } = pushExchange(trimmed, nextMode);
    setDraft("");
    setPane("desk");
    try {
      const analysis = await executeReading({
        mode: nextMode,
        question: trimmed,
        docs: useDesk.getState().docs,
        chunks,
        vectors: useDesk.getState().vectors,
        history,
        gate: gate.current,
        onTrace: (trace) => updateMessage(assistantId, { trace }),
      });
      updateMessage(assistantId, { analysis });
      setGrokBlocked(gate.current.blocked);
      const first = analysis.citations[0];
      if (first) {
        setActiveDoc(first.docId);
        setFocus({ messageId: assistantId, n: first.n });
      }
    } catch (error) {
      updateMessage(assistantId, { error: error instanceof Error ? error.message : "The reading failed." });
    } finally {
      setRunning(false);
    }
  }

  async function buildIndex() {
    if (embedState === "running" || !chunks.length || running) return;
    setEmbedState("running");
    const result = await embedMissing(chunks, useDesk.getState().vectors, gate.current);
    setGrokBlocked(gate.current.blocked);
    if (result.ok) setEmbedState("idle");
    else setEmbedState("error", result.error);
    if (result.ok) setVectors(result.vectors);
  }

  function openCitation(messageId: string, n: number) {
    const message = useDesk.getState().messages.find((item) => item.id === messageId);
    const citation = message?.analysis?.citations.find((item) => item.n === n);
    if (!citation) return;
    setActiveDoc(citation.docId);
    setFocus({ messageId, n });
    setPane("evidence");
  }

  const indexLabel = embedded > 0 ? `Hybrid · ${embedded}/${chunks.length} embedded` : chunks.length ? `Lexical · ${chunks.length} passages` : "No passages yet";

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="shrink-0 border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 lg:px-5">
          <Mark />
          <div className="min-w-0">
            <h1 className="font-serif text-2xl leading-none tracking-tight">Argus</h1>
            <p className="mt-1 text-xs text-muted">Agentic research desk</p>
          </div>
          <p className="ml-auto hidden text-xs text-muted lg:block">
            {hydrated ? `${docs.length} ${docs.length === 1 ? "source" : "sources"} · ${indexLabel}` : "Opening the desk"}
          </p>
        </div>
        <div className="flex gap-1 overflow-x-auto px-4 pb-3 lg:px-5">
          {MODES.map((item) => {
            const Icon = item.icon;
            const selected = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMode(item.id)}
                className={cn(
                  "focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3 text-sm",
                  selected ? "bg-primary text-primary-fg" : "bg-surface text-muted hover:text-fg",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={cn("min-h-0 w-full flex-col border-border lg:flex lg:w-72 lg:border-r", mobilePane === "library" ? "flex" : "hidden")}>
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-xs uppercase tracking-wide text-faint">Library</h2>
            <span className="text-xs tabular-nums text-muted">{hydrated ? docs.length : "–"}/10</span>
          </div>
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
              <Search className="size-4 text-faint" aria-hidden />
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search sources"
                aria-label="Search library"
                className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-faint"
              />
              {libraryQuery ? (
                <button type="button" onClick={() => setLibraryQuery("")} className="focus-ring text-xs text-faint hover:text-fg">
                  Clear
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-faint">
                {visibleDocs.length} / {docs.length} visible
              </p>
              <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1 text-[10px] uppercase tracking-[0.12em] text-muted">
                {(["recent", "title", "passages"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSortMode(option)}
                    className={cn(
                      "focus-ring rounded-full px-2 py-1 transition",
                      sortMode === option ? "bg-primary text-primary-fg" : "text-muted hover:text-fg",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div
            className={cn("mx-4 rounded-2xl border border-dashed px-3 py-3", dragging ? "border-primary bg-raised" : "border-border")}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void ingest([...event.dataTransfer.files]);
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-raised text-sm text-fg">
                <Upload className="size-4" aria-hidden />
                Upload
              </button>
              <button type="button" onClick={() => setPasting((value) => !value)} className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-raised text-sm text-fg">
                <Plus className="size-4" aria-hidden />
                Paste
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx,text/plain"
              onChange={(event) => {
                const files = event.target.files ? [...event.target.files] : [];
                event.target.value = "";
                void ingest(files);
              }}
            />
            <button
              type="button"
              disabled={!hydrated || dossierLoaded}
              onClick={() => {
                addDocs(SAMPLE_DOCS);
                setPane("desk");
              }}
              className="focus-ring mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-primary px-3 text-sm font-medium text-primary-fg disabled:opacity-50"
            >
              {dossierLoaded ? "Northline dossier loaded" : "Add the Northline dossier"}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-faint">Text, Markdown, CSV, JSON, HTML, PDF, or Word. Ten sources, kept in this browser.</p>
          </div>
          {pasting ? (
            <form
              className="mx-4 mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (pasteBody.trim().length < 40) {
                  setUploadError("Paste at least a short paragraph.");
                  return;
                }
                addDocs([parsePaste(pasteTitle, pasteBody)]);
                setPasteTitle("");
                setPasteBody("");
                setPasting(false);
              }}
            >
              <input
                value={pasteTitle}
                onChange={(event) => setPasteTitle(event.target.value)}
                placeholder="Title"
                aria-label="Pasted document title"
                className="focus-ring h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none"
              />
              <textarea
                value={pasteBody}
                onChange={(event) => setPasteBody(event.target.value)}
                placeholder="Paste the document"
                aria-label="Pasted document text"
                rows={5}
                className="focus-ring w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none"
              />
              <button type="submit" className="focus-ring h-11 w-full rounded-xl bg-raised text-sm">
                Add to the desk
              </button>
            </form>
          ) : null}
          {uploadError ? <p className="mx-4 mt-3 text-xs leading-relaxed text-clay">{uploadError}</p> : null}
          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {hydrated && docs.length === 0 ? <p className="px-1 text-sm leading-relaxed text-muted">The desk is empty. Start with the harbor dossier, or bring your own set.</p> : null}
            {hydrated && visibleDocs.length === 0 ? <p className="rounded-2xl border border-border bg-surface px-3 py-3 text-sm leading-relaxed text-muted">No sources match “{libraryQuery}”. Try a broader keyword or clear the filter.</p> : null}
            {hydrated
              ? visibleDocs.map((doc) => {
                  const count = passageCounts.get(doc.id) ?? 0;
                  const selected = doc.id === activeDocId;
                  return (
                    <div key={doc.id} className={cn("rounded-2xl border px-3 py-3", selected ? "border-primary bg-raised" : "border-border bg-surface")}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDoc(doc.id);
                          setFocus(null);
                          setPane("evidence");
                        }}
                        className="focus-ring w-full text-left"
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-xs uppercase tracking-wide text-primary">{doc.kicker}</span>
                          <span className="text-xs tabular-nums text-faint">{doc.dateLabel}</span>
                        </span>
                        <span className="mt-1 block font-serif text-lg leading-snug">{doc.short}</span>
                        <span className="mt-1 block text-xs text-muted">
                          {count} {count === 1 ? "passage" : "passages"}
                          {doc.note ? ` · ${doc.note}` : ""}
                        </span>
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-raised px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-faint">
                          <ArrowUpDown className="size-3" aria-hidden />
                          {sortMode === "recent" ? "Newest" : sortMode === "title" ? "A–Z" : "Depth"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDoc(doc.id)}
                        className="focus-ring mt-2 inline-flex h-9 items-center gap-1 text-xs text-faint hover:text-fg"
                        aria-label={`Remove ${doc.short}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Remove
                      </button>
                    </div>
                  );
                })
              : null}
          </div>
          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => void buildIndex()}
              disabled={!chunks.length || embedState === "running" || running}
              className="focus-ring h-11 w-full rounded-xl border border-border text-sm text-fg disabled:opacity-50"
            >
              {embedState === "running" ? "Embedding passages…" : embedded === chunks.length && chunks.length ? "Semantic index ready" : "Build semantic index"}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              {embedError || "Retrieval is hybrid: BM25 first, then xAI embeddings when a semantic index exists. Questions fuse both."}
            </p>
            {grokBlocked ? (
              <button
                type="button"
                onClick={() => {
                  gate.current.blocked = false;
                  setGrokBlocked(false);
                  setEmbedState("idle");
                }}
                className="focus-ring mt-2 text-xs text-primary"
              >
                Try Grok again
              </button>
            ) : null}
          </div>
        </aside>

        <section className={cn("min-h-0 min-w-0 flex-1 flex-col", mobilePane === "desk" ? "flex" : "hidden lg:flex")}>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8">
            <div className="mx-auto flex max-w-3xl flex-col gap-8">
              {hydrated && messages.length === 0 ? (
                <EmptyDesk
                  hasDocs={docs.length > 0}
                  dossierLoaded={dossierLoaded}
                  onDossier={() => {
                    addDocs(SAMPLE_DOCS);
                    setPane("desk");
                  }}
                  onAsk={(itemMode, question) => {
                    setMode(itemMode);
                    void ask(question, itemMode);
                  }}
                  chat={mode === "chat"}
                />
              ) : null}
              {messages.map((message) =>
                message.role === "user" ? (
                  message.mode === "chat" ? (
                    <div key={message.id} className="flex justify-end">
                      <p className="max-w-lg rounded-2xl border border-border bg-surface px-4 py-3 text-base leading-relaxed">{message.text}</p>
                    </div>
                  ) : (
                    <h2 key={message.id} className="font-serif text-3xl leading-tight">
                      {message.text}
                    </h2>
                  )
                ) : (
                  <Answer key={message.id} message={message} onCite={(n) => openCitation(message.id, n)} />
                ),
              )}
            </div>
          </div>
          <form
            className="shrink-0 border-t border-border px-4 py-3 lg:px-8"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(draft);
            }}
          >
            {mode === "chat" && !running ? <FollowUps question={lastUserQuestion(messages)} dossier={dossierLoaded} disabled={!docs.length} onAsk={(question) => void ask(question, "chat")} /> : null}
            <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface p-2">
              <label className="sr-only" htmlFor="question">
                Question
              </label>
              <textarea
                id="question"
                value={draft}
                rows={2}
                disabled={!hydrated}
                placeholder={docs.length ? MODES.find((item) => item.id === mode)?.hint : "Add sources, then ask across them"}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask(draft);
                  }
                }}
                className="w-full resize-none bg-transparent px-2 py-1 text-base outline-none placeholder:text-faint"
              />
              <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <button type="button" onClick={clearChat} className="focus-ring text-xs text-faint hover:text-fg" disabled={!messages.length}>
                  {mode === "chat" ? "Clear chat" : "Clear readings"}
                </button>
                <button
                  type="submit"
                  disabled={running || !draft.trim() || !docs.length}
                  className="focus-ring inline-flex h-11 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-50"
                >
                  {running ? "Reading…" : mode === "chat" ? "Send" : "Read sources"}
                </button>
              </div>
            </div>
          </form>
        </section>

        <aside className={cn("min-h-0 w-full flex-col border-border lg:flex lg:w-96 lg:border-l", mobilePane === "evidence" ? "flex" : "hidden")}>
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-xs uppercase tracking-wide text-faint">Evidence</h2>
            {focusCitation ? (
              <button type="button" onClick={() => setFocus(null)} className="focus-ring inline-flex h-9 items-center gap-1 text-xs text-muted">
                <X className="size-3.5" aria-hidden />
                Clear mark
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            {activeDoc ? (
              <article>
                <p className="text-xs uppercase tracking-wide text-primary">{activeDoc.kicker}</p>
                <h2 className="mt-1 font-serif text-2xl leading-tight">{activeDoc.title}</h2>
                <p className="mt-1 text-xs text-faint">
                  {activeDoc.dateLabel}
                  {activeDoc.filename ? ` · ${activeDoc.filename}` : ""}
                </p>
                <div className="mt-4 space-y-3">
                  {activeChunks.map((chunk) => {
                    const marked = focusCitation?.chunkId === chunk.id;
                    return (
                      <section key={chunk.id} id={`chunk-${chunk.id}`} className={cn("rounded-2xl border px-3 py-3", marked ? "border-primary bg-raised" : "border-border")}>
                        <h3 className="text-xs uppercase tracking-wide text-faint">{chunk.section}</h3>
                        <Passage text={chunk.text} quote={marked ? focusCitation?.quote ?? "" : ""} active={marked} />
                      </section>
                    );
                  })}
                </div>
              </article>
            ) : (
              <div className="rounded-2xl border border-border bg-surface px-4 py-4">
                <BookOpen className="size-5 text-primary" aria-hidden />
                <p className="mt-3 font-serif text-xl leading-snug">Citations land on the sentence, not a summary.</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">When a reading is ready, each numbered mark opens the passage it came from.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <nav className="grid shrink-0 grid-cols-3 border-t border-border lg:hidden">
        {(
          [
            ["library", "Library", Library],
            ["desk", "Desk", MessageSquare],
            ["evidence", "Evidence", BookOpen],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPane(id)}
            className={cn("focus-ring inline-flex h-14 flex-col items-center justify-center gap-1 text-xs", mobilePane === id ? "text-primary" : "text-faint")}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function historyOf(messages: ChatMessage[]): PriorTurn[] {
  const pairs: PriorTurn[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.analysis) continue;
    const previous = messages[index - 1];
    if (previous?.role === "user") {
      pairs.push({ question: previous.text, title: message.analysis.title, gist: message.analysis.lede });
    }
  }
  return pairs.slice(-3);
}

function lastUserQuestion(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") return messages[index].text;
  }
  return "";
}

const CHAT_FOLLOWS = [
  "What about the jobs figures?",
  "Is the local match actually appropriated?",
  "What did the hearing add?",
  "And the wetland — minor or moderate?",
  "Which of those figures is a line item?",
];

const GENERIC_FOLLOWS = ["Where do the sources disagree on that?", "What is still missing?", "Which document is the outlier?"];

function followUps(question: string, dossier: boolean): string[] {
  const hay = question.toLowerCase();
  const pool = dossier ? CHAT_FOLLOWS : GENERIC_FOLLOWS;
  return pool
    .filter((item) => {
      const keys = item.toLowerCase().match(/[a-z]{5,}/g) ?? [];
      const overlap = keys.filter((word) => hay.includes(word)).length;
      return overlap < 2;
    })
    .slice(0, 3);
}

function FollowUps({ question, dossier, disabled, onAsk }: { question: string; dossier: boolean; disabled: boolean; onAsk: (question: string) => void }) {
  if (!question) return null;
  const items = followUps(question, dossier);
  if (!items.length) return null;
  return (
    <div className="mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(item)}
          className="focus-ring shrink-0 rounded-full border border-border bg-surface px-3 py-2 text-left text-xs text-muted hover:text-fg disabled:opacity-50"
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function EmptyDesk({
  hasDocs,
  dossierLoaded,
  chat,
  onDossier,
  onAsk,
}: {
  hasDocs: boolean;
  dossierLoaded: boolean;
  chat: boolean;
  onDossier: () => void;
  onAsk: (mode: Mode, question: string) => void;
}) {
  if (!hasDocs) {
    return (
      <div className="pt-6">
        <p className="text-xs uppercase tracking-wide text-primary">Multi-document reader</p>
        <h2 className="mt-2 max-w-xl font-serif text-4xl leading-tight">Read several documents as one record.</h2>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
          Argus plans the search, retrieves passages, checks whether they cover the question, and writes with a citation on every claim. A second hop runs when a facet is still missing.
        </p>
        <ol className="mt-6 grid gap-2 sm:grid-cols-4">
          {["Planner", "Retriever", "Critic", "Scribe"].map((label, index) => (
            <li key={label} className="rounded-2xl border border-border bg-surface px-3 py-3">
              <span className="text-xs tabular-nums text-primary">0{index + 1}</span>
              <p className="mt-1 font-serif text-lg">{label}</p>
            </li>
          ))}
        </ol>
        <button type="button" onClick={onDossier} className="focus-ring mt-6 inline-flex h-11 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-fg">
          {dossierLoaded ? "Dossier loaded" : "Add the Northline dossier"}
        </button>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-faint">
          Six sources on a fictional harbor project. They disagree on cost, jobs, the opening date, and the wetland. Or upload your own set from the library.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-primary">{chat ? "Chat" : "Ready to read"}</p>
      <h2 className="mt-2 font-serif text-3xl leading-tight">{chat ? "Ask, then keep going." : "What should the desk settle?"}</h2>
      {chat ? (
        <p className="mt-3 max-w-xl text-base leading-relaxed text-muted">
          A follow-up can say "what about the jobs?" The previous question only resolves what "that" means. The answer is still quoted from the sources.
        </p>
      ) : null}
      {chat && !dossierLoaded ? <p className="mt-4 text-sm text-faint">Type the first question below.</p> : (
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {(chat
          ? [
              { mode: "chat" as const, label: "Start", question: "What does the harbor program actually cost, and which figures are totals rather than line items?" },
              { mode: "chat" as const, label: "Then", question: "Where do these sources contradict each other?" },
            ]
          : INQUIRIES
        ).map((item) => (
          <button
            key={item.question}
            type="button"
            onClick={() => onAsk(item.mode, item.question)}
            className="focus-ring rounded-2xl border border-border bg-surface px-4 py-3 text-left hover:border-primary"
          >
            <span className="text-xs uppercase tracking-wide text-primary">{item.label}</span>
            <span className="mt-1 block text-sm leading-relaxed text-fg">{item.question}</span>
          </button>
        ))}
      </div>
      )}
    </div>
  );
}

function Answer({ message, onCite }: { message: ChatMessage; onCite: (n: number) => void }) {
  const analysis = message.analysis;
  const trace = message.trace;
  return (
    <article className="border-b border-border pb-8" aria-live="polite">
      {trace.length ? <Trace trace={trace} /> : null}
      {message.error ? <p className="mt-4 text-sm text-clay">{message.error}</p> : null}
      {!analysis && !message.error ? <p className="mt-4 text-sm text-muted">Working through the sources…</p> : null}
      {analysis ? <AnalysisView analysis={analysis} onCite={onCite} /> : null}
    </article>
  );
}

function Trace({ trace }: { trace: TraceStep[] }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {trace.map((step) => (
        <li key={step.id} className="rounded-xl border border-border bg-surface px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", step.state === "wait" ? "bg-faint" : "bg-primary", step.state === "run" && "animate-pulse")} />
            <span className={cn("text-xs uppercase tracking-wide", step.state === "wait" ? "text-faint" : "text-primary")}>{step.label}</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-muted">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}

function AnalysisView({ analysis, onCite }: { analysis: Analysis; onCite: (n: number) => void }) {
  const hasArtifact = Boolean(analysis.comparison || analysis.timeline);
  const coverage =
    analysis.coverage === "sufficient" ? "Covered" : analysis.coverage === "partial" ? "Partial" : "Thin";
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-2xl leading-tight">{analysis.title}</h3>
        <span className={cn("rounded-full px-2 py-1 text-xs", analysis.coverage === "insufficient" ? "bg-clay/15 text-clay" : "bg-primary/15 text-primary")}>{coverage}</span>
        <span className="rounded-full bg-raised px-2 py-1 text-xs text-muted">{analysis.engine === "grok" ? "Grok" : "Local reader"}</span>
      </div>
      <p className="mt-3 text-base leading-relaxed text-fg">
        <RichText text={analysis.lede} onCite={onCite} />
      </p>
      {analysis.comparison ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-xl border-collapse text-left">
            <thead>
              <tr>
                <th className="border-b border-border py-2 pr-3 text-xs font-medium text-faint">Facet</th>
                {analysis.comparison.columns.map((column) => (
                  <th key={column.docId} className="border-b border-border px-3 py-2 text-xs font-medium text-muted">
                    {column.docTitle}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.comparison.aspects.map((aspect, index) => (
                <tr key={aspect}>
                  <th className="border-b border-border py-3 pr-3 text-left align-top text-sm font-medium text-fg">{aspect}</th>
                  {analysis.comparison?.columns.map((column) => (
                    <td key={column.docId} className="border-b border-border px-3 py-3 align-top text-sm leading-relaxed text-muted">
                      <RichText text={column.cells[index] ?? "—"} onCite={onCite} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {analysis.timeline ? (
        <ol className="mt-5">
          {analysis.timeline.map((event) => (
            <li key={`${event.sort}-${event.n}-${event.event.slice(0, 24)}`} className="flex gap-4">
              <div className="w-36 shrink-0 pt-0.5 text-right text-xs font-medium text-primary">{event.when}</div>
              <div className="border-l border-border pb-4 pl-4">
                <p className="text-sm leading-relaxed text-fg">
                  <RichText text={`${event.event} [${event.n}]`} onCite={onCite} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {analysis.conflicts ? (
        <div className="mt-5 space-y-3">
          {analysis.conflicts.map((conflict) => (
            <section key={conflict.issue} className="rounded-2xl border border-border bg-surface px-4 py-4">
              <h4 className="font-serif text-lg leading-snug">{conflict.issue}</h4>
              <ul className="mt-3 space-y-3">
                {conflict.sides.map((side) => (
                  <li key={`${side.docId}-${side.n}`}>
                    <button type="button" onClick={() => onCite(side.n)} className="focus-ring text-xs uppercase tracking-wide text-primary">
                      {side.docTitle}
                    </button>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{side.position}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {hasArtifact ? (
        <details className="mt-5">
          <summary className="text-sm text-muted">Passage log</summary>
          <div className="mt-3">
            <MarkdownBlock text={analysis.markdown} onCite={onCite} />
          </div>
        </details>
      ) : (
        <div className="mt-5">
          <MarkdownBlock text={analysis.markdown} onCite={onCite} />
        </div>
      )}
      {analysis.caveats.length ? (
        <ul className="mt-4 space-y-1">
          {analysis.caveats.map((caveat) => (
            <li key={caveat} className="text-xs leading-relaxed text-muted">
              {caveat}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed text-faint">{analysis.engineNote}</p>
    </div>
  );
}

function Passage({ text, quote, active }: { text: string; quote: string; active: boolean }) {
  if (!active || !quote || !text.includes(quote)) {
    return <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>;
  }
  const index = text.indexOf(quote);
  return (
    <p className="mt-2 text-sm leading-relaxed text-muted">
      {text.slice(0, index)}
      <mark className="rounded bg-primary/20 px-0.5 text-fg">{quote}</mark>
      {text.slice(index + quote.length)}
    </p>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-9 shrink-0 text-primary" aria-hidden>
      <rect x="5" y="8" width="16" height="18" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x="10" y="5" width="16" height="18" rx="2" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="14" r="1.7" fill="currentColor" />
    </svg>
  );
}
