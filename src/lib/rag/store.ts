import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uid } from "@/lib/rag/corpus";
import type { ChatMessage, Mode, SourceDoc } from "@/lib/rag/types";

type DeskState = {
  hydrated: boolean;
  docs: SourceDoc[];
  messages: ChatMessage[];
  vectors: Record<string, string>;
  mode: Mode;
  running: boolean;
  embedState: "idle" | "running" | "error";
  embedError: string;
  grokBlocked: boolean;
  activeDocId: string;
  focus: { messageId: string; n: number } | null;
  mobilePane: "library" | "desk" | "evidence";
  uploadError: string;
  setHydrated: () => void;
  setMode: (mode: Mode) => void;
  setPane: (pane: DeskState["mobilePane"]) => void;
  setActiveDoc: (id: string) => void;
  setFocus: (focus: DeskState["focus"]) => void;
  setUploadError: (message: string) => void;
  addDocs: (docs: SourceDoc[]) => void;
  removeDoc: (id: string) => void;
  pushExchange: (question: string, mode: Mode) => { assistantId: string };
  updateMessage: (id: string, partial: Partial<Pick<ChatMessage, "trace" | "analysis" | "error">>) => void;
  clearChat: () => void;
  setRunning: (running: boolean) => void;
  setVectors: (vectors: Record<string, string>) => void;
  setEmbedState: (state: DeskState["embedState"], error?: string) => void;
  setGrokBlocked: (blocked: boolean) => void;
};

export const useDesk = create<DeskState>()(
  persist(
    (set) => ({
      hydrated: false,
      docs: [],
      messages: [],
      vectors: {},
      mode: "ask",
      running: false,
      embedState: "idle",
      embedError: "",
      grokBlocked: false,
      activeDocId: "",
      focus: null,
      mobilePane: "desk",
      uploadError: "",
      setHydrated: () => set({ hydrated: true }),
      setMode: (mode) => set({ mode }),
      setPane: (mobilePane) => set({ mobilePane }),
      setActiveDoc: (activeDocId) => set({ activeDocId }),
      setFocus: (focus) => set({ focus }),
      setUploadError: (uploadError) => set({ uploadError }),
      addDocs: (incoming) =>
        set((state) => {
          const ids = new Set(state.docs.map((doc) => doc.id));
          const next = [...state.docs];
          for (const doc of incoming) {
            if (ids.has(doc.id) || next.length >= 10) continue;
            ids.add(doc.id);
            next.push({ ...doc, text: doc.text.slice(0, 60_000) });
          }
          return { docs: next, uploadError: "", activeDocId: state.activeDocId || next[0]?.id || "" };
        }),
      removeDoc: (id) =>
        set((state) => {
          const docs = state.docs.filter((doc) => doc.id !== id);
          const vectors = Object.fromEntries(Object.entries(state.vectors).filter(([key]) => !key.startsWith(`${id}:`)));
          return { docs, vectors, activeDocId: state.activeDocId === id ? docs[0]?.id ?? "" : state.activeDocId };
        }),
      pushExchange: (question, mode) => {
        const assistantId = uid();
        const now = Date.now();
        const user: ChatMessage = {
          id: uid(),
          role: "user",
          text: question,
          mode,
          trace: [],
          analysis: null,
          error: "",
          createdAt: now,
        };
        const assistant: ChatMessage = {
          id: assistantId,
          role: "assistant",
          text: "",
          mode,
          trace: [],
          analysis: null,
          error: "",
          createdAt: now + 1,
        };
        set((state) => ({ messages: [...state.messages, user, assistant].slice(-24), running: true }));
        return { assistantId };
      },
      updateMessage: (id, partial) =>
        set((state) => ({
          messages: state.messages.map((message) => (message.id === id ? { ...message, ...partial } : message)),
        })),
      clearChat: () => set({ messages: [], focus: null }),
      setRunning: (running) => set({ running }),
      setVectors: (vectors) => set({ vectors }),
      setEmbedState: (embedState, embedError = "") => set({ embedState, embedError }),
      setGrokBlocked: (grokBlocked) => set({ grokBlocked }),
    }),
    {
      name: "argus-desk-v1",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({
        docs: state.docs,
        messages: state.messages.slice(-20),
        vectors: state.vectors,
        mode: state.mode,
      }),
    },
  ),
);
