import { uid } from "@/lib/rag/corpus";
import type { SourceDoc } from "@/lib/rag/types";

const MAX = 60_000;

function titleFrom(text: string, filename: string): string {
  const heading = text.match(/^\s*#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 120);
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.length > 3);
  if (line) return line.slice(0, 120);
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function build(filename: string, kicker: string, text: string): Omit<SourceDoc, "addedAt"> & { addedAt: number } {
  const trimmed = text.replace(/\u0000/g, "").trim();
  const note = trimmed.length > MAX ? "Trimmed to 60,000 characters." : "";
  const body = trimmed.slice(0, MAX);
  const title = titleFrom(body, filename);
  return {
    id: uid(),
    title,
    short: title.length > 42 ? `${title.slice(0, 41)}…` : title,
    filename,
    kicker,
    dateLabel: "Uploaded",
    text: body,
    addedAt: Date.now(),
    note,
  };
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const count = Math.min(pdf.numPages, 40);
  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) pages.push(line);
  }
  if (pdf.numPages > 40) pages.push("Later pages were not imported.");
  return pages.join("\n\n");
}

async function readDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

export async function parseFile(file: File): Promise<SourceDoc> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.size > 12_000_000) throw new Error(`${file.name} is over 12 MB.`);
  if (extension === "pdf") {
    const text = await readPdf(file);
    if (text.replace(/\s+/g, "").length < 40) throw new Error(`${file.name} has no extractable text.`);
    return build(file.name, "PDF", text);
  }
  if (extension === "docx") {
    const text = await readDocx(file);
    if (!text.trim()) throw new Error(`${file.name} was empty.`);
    return build(file.name, "Word", text);
  }
  const raw = await file.text();
  if (extension === "html" || extension === "htm") return build(file.name, "HTML", htmlToText(raw));
  if (extension === "json") {
    try {
      return build(file.name, "JSON", JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      return build(file.name, "JSON", raw);
    }
  }
  const kicker = extension === "csv" ? "Table" : extension === "md" || extension === "markdown" ? "Notes" : "Text";
  return build(file.name, kicker, raw);
}

export function parsePaste(title: string, text: string): SourceDoc {
  const name = title.trim() || "Pasted note";
  return build(`${name}.txt`, "Pasted", text);
}
