import { cn } from "@/lib/cn";

export function RichText({ text, onCite, className }: { text: string; onCite?: (n: number) => void; className?: string }) {
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/g);
  return (
    <span className={className}>
      {parts.map((part, index) => {
        const cite = /^\[(\d+)\]$/.exec(part);
        if (cite) {
          const n = Number(cite[1]);
          return (
            <button
              key={index}
              type="button"
              onClick={() => onCite?.(n)}
              className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary/15 px-1 text-xs font-semibold text-primary"
            >
              {n}
            </button>
          );
        }
        const bold = /^\*\*([^*]+)\*\*$/.exec(part);
        if (bold) return <strong key={index} className="font-semibold text-fg">{bold[1]}</strong>;
        return <span key={index}>{part}</span>;
      })}
    </span>
  );
}

export function MarkdownBlock({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const bullets = lines.length > 0 && lines.every((line) => line.trim().startsWith("- "));
        if (bullets) {
          return (
            <ul key={index} className="space-y-2">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex} className="flex gap-2 text-sm leading-relaxed text-fg">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                  <RichText text={line.replace(/^\s*-\s*/, "")} onCite={onCite} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className={cn("text-sm leading-relaxed text-fg", lines[0]?.startsWith("**") && lines.length === 1 && "font-serif text-lg")}>
            <RichText text={lines.join(" ")} onCite={onCite} />
          </p>
        );
      })}
    </div>
  );
}
