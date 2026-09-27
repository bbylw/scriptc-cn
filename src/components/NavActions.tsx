import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  CaretRight,
  List,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import type { DocNavItem } from "../consts";

type Hit = {
  path: string;
  title: string;
  group: string;
  heading?: string;
  anchor?: string;
  excerpt: string;
  score: number;
};

type IndexEntry = {
  path: string;
  title: string;
  group: string;
  description: string;
  headings: { text: string; slug: string }[];
  body: string;
};

const WEIGHT = { title: 8, heading: 4, body: 1 };

function scoreEntry(entry: IndexEntry, terms: string[]): Hit[] {
  const hay = {
    title: entry.title.toLowerCase(),
    headings: entry.headings.map((h) => h.text.toLowerCase()),
    body: entry.body.toLowerCase(),
  };
  let score = 0;
  for (const term of terms) {
    if (hay.title.includes(term)) score += WEIGHT.title;
    if (hay.headings.some((h) => h.includes(term))) score += WEIGHT.heading;
    if (hay.body.includes(term)) score += WEIGHT.body;
  }
  if (score === 0) return [];

  const matchedHeading = entry.headings.find((h) =>
    terms.some((t) => h.text.toLowerCase().includes(t)),
  );
  const anchor = matchedHeading ? `#${matchedHeading.slug}` : undefined;
  const source = matchedHeading ? matchedHeading.text : entry.description;

  return [
    {
      path: entry.path,
      title: entry.title,
      group: entry.group,
      heading: matchedHeading?.text,
      anchor,
      excerpt: source,
      score,
    },
  ];
}

export default function NavActions({
  items,
  githubPath,
  repoUrl,
}: {
  items: DocNavItem[];
  githubPath: string;
  repoUrl: string;
}) {
  const [openSearch, setOpenSearch] = useState(false);
  const [openMenu, setOpenMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openSearch || index) return;
    setStatus("loading");
    fetch("/search.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<IndexEntry[]>;
      })
      .then(setIndex)
      .catch(() => setStatus("error"));
  }, [openSearch, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenMenu(false);
        setOpenSearch((v) => !v);
      }
      if (e.key === "Escape") {
        setOpenSearch(false);
        setOpenMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (openSearch) inputRef.current?.focus();
  }, [openSearch]);

  useEffect(() => setCursor(0), [query]);

  const hits = useMemo<Hit[]>(() => {
    if (!index) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return index
      .flatMap((entry) => scoreEntry(entry, terms))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [index, query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenSearch(true)}
        className="flex items-center gap-2 rounded-control border border-line bg-ink-900 px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg active:scale-[0.98]"
      >
        <MagnifyingGlass size={15} weight="bold" aria-hidden />
        <span className="hidden sm:inline">搜索文档</span>
        <kbd className="hidden rounded border border-line bg-ink-850 px-1 font-mono text-[10px] text-fg-subtle sm:inline">
          Ctrl K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        aria-expanded={openMenu}
        aria-label="打开导航菜单"
        className="flex items-center rounded-control border border-line p-2 text-fg-muted transition-colors hover:border-line-strong hover:text-fg md:hidden"
      >
        {openMenu ? <X size={16} aria-hidden /> : <List size={16} aria-hidden />}
      </button>

      {openMenu && (
        <div className="fixed inset-x-0 top-16 z-30 border-b border-line bg-ink-950 px-5 pb-6 pt-3 md:hidden">
          <nav aria-label="移动导航" className="flex flex-col gap-1">
            <a href="/" className="flex items-center gap-2 py-2 text-sm text-fg">
              <CaretRight size={14} aria-hidden />
              概览
            </a>
            {items.map((item) => (
              <a
                key={item.path}
                href={item.path}
                className="flex items-center gap-2 py-2 text-sm text-fg-muted"
              >
                <CaretRight size={14} aria-hidden />
                {item.title}
              </a>
            ))}
            <a
              href={repoUrl}
              rel="noopener"
              target="_blank"
              aria-label="源码仓库（GitHub）"
              className="mt-2 flex items-center gap-2 border-t border-line py-3 text-sm text-fg-muted"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d={githubPath} />
              </svg>
              源码仓库
            </a>
          </nav>
        </div>
      )}

      {openSearch && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/80 px-4 pt-[12vh] backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="搜索文档"
          onClick={() => setOpenSearch(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-panel border border-line bg-ink-900 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <MagnifyingGlass size={16} className="text-fg-subtle" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0)));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(c - 1, 0));
                  }
                  if (e.key === "Enter" && hits[cursor]) {
                    window.location.href = hits[cursor].path + (hits[cursor].anchor ?? "");
                  }
                }}
                placeholder="搜索文档、命令、API"
                aria-label="搜索关键词"
                className="w-full bg-transparent py-4 text-[15px] text-fg outline-none placeholder:text-fg-subtle"
              />
              <button
                type="button"
                onClick={() => setOpenSearch(false)}
                aria-label="关闭搜索"
                className="rounded border border-line p-1 text-fg-subtle transition-colors hover:text-fg"
              >
                <X size={13} aria-hidden />
              </button>
            </div>

            <div className="max-h-[46vh] overflow-y-auto p-2">
              {status === "error" && (
                <p className="px-3 py-6 text-sm text-fg-muted">
                  索引加载失败，请关闭后重试，或直接浏览左侧目录。
                </p>
              )}
              {index === null && status !== "error" && (
                <ul aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <li
                      key={i}
                      className="my-1 h-12 animate-pulse rounded-control bg-ink-850"
                      style={{ animationDelay: `${i * 90}ms` }}
                    />
                  ))}
                </ul>
              )}
              {index !== null && query.trim() === "" && (
                <div className="px-3 py-6">
                  <p className="mb-3 text-xs uppercase tracking-wider text-fg-subtle">
                    常用入口
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {items.slice(0, 6).map((item) => (
                      <li key={item.path}>
                        <a
                          href={item.path}
                          className="flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[13px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                        >
                          <BookOpenText size={13} aria-hidden />
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {index !== null && query.trim() !== "" && hits.length === 0 && (
                <p className="px-3 py-6 text-sm text-fg-muted">
                  没有匹配 “{query.trim()}” 的条目。试试更短的关键词，例如 emit、wasi、ffi。
                </p>
              )}
              {hits.map((hit, i) => (
                <a
                  key={`${hit.path}${hit.anchor ?? ""}`}
                  href={hit.path + (hit.anchor ?? "")}
                  onMouseEnter={() => setCursor(i)}
                  className={[
                    "flex items-start gap-3 rounded-control px-3 py-2.5 transition-colors",
                    i === cursor ? "bg-ink-850" : "hover:bg-ink-850/60",
                  ].join(" ")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {hit.heading ?? hit.title}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">
                      {hit.group}
                      {hit.heading ? ` · ${hit.title}` : ""}
                    </span>
                  </span>
                  <ArrowRight
                    size={14}
                    className={i === cursor ? "mt-1 text-accent" : "mt-1 text-fg-subtle"}
                    aria-hidden
                  />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
