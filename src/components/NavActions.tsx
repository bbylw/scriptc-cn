import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  BookOpenTextIcon,
  CaretRightIcon,
  ListIcon,
  MagnifyingGlassIcon,
  XIcon,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps query-term matches in <mark>; split with a capture group puts the
 *  matches on odd indices, so no manual bookkeeping is needed. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
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
  // macOS shows ⌘, everywhere else Ctrl. Resolved after mount so the
  // server render and the first client render agree (no hydration mismatch).
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/mac/i.test(navigator.platform) || /macintosh/i.test(navigator.userAgent)) {
      setModKey("⌘");
    }
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

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

  const closeSearch = useCallback(() => {
    setOpenSearch(false);
    setQuery("");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenMenu(false);
        setOpenSearch((v) => {
          if (v) {
            // Reopening through the shortcut must also hand focus back.
            restoreFocusRef.current?.focus();
          }
          return !v;
        });
      }
      if (e.key === "Escape") {
        if (openSearch) {
          closeSearch();
        } else {
          setOpenMenu(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch, closeSearch]);

  // Move focus into the dialog on open, hand it back to whatever had it on close,
  // and stop the page behind from scrolling underneath the overlay.
  useEffect(() => {
    if (!openSearch) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      restoreFocusRef.current?.focus();
    };
  }, [openSearch]);

  // Keep Tab inside the dialog while it is open.
  useEffect(() => {
    if (!openSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
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

  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const active = cursor < hits.length ? cursor : 0;
  const searching = index !== null && query.trim() !== "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenSearch(true)}
        aria-expanded={openSearch}
        aria-haspopup="dialog"
        aria-controls="search-dialog"
        className="flex items-center gap-2 rounded-control border border-line bg-ink-900 px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg active:scale-[0.98]"
      >
        <MagnifyingGlassIcon size={15} weight="bold" aria-hidden />
        <span className="hidden sm:inline">搜索文档</span>
        <kbd
          translate="no"
          className="hidden rounded border border-line bg-ink-850 px-1 font-mono text-[10px] text-fg-subtle sm:inline"
        >
          {modKey}&nbsp;K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        aria-expanded={openMenu}
        aria-label="打开导航菜单"
        className="flex items-center rounded-control border border-line p-2 text-fg-muted transition-colors hover:border-line-strong hover:text-fg lg:hidden"
      >
        {openMenu ? <XIcon size={16} aria-hidden /> : <ListIcon size={16} aria-hidden />}
      </button>

      {openMenu && (
        <div className="fixed inset-x-0 top-16 z-30 border-b border-line bg-ink-950 px-5 pb-6 pt-3 lg:hidden">
          <nav aria-label="移动导航" className="flex flex-col gap-1">
            <a href="/" className="flex items-center gap-2 py-2 text-sm text-fg">
              <CaretRightIcon size={14} aria-hidden />
              概览
            </a>
            {items.map((item) => (
              <a
                key={item.path}
                href={item.path}
                className="flex items-center gap-2 py-2 text-sm text-fg-muted"
              >
                <CaretRightIcon size={14} aria-hidden />
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
          onClick={closeSearch}
        >
          <div
            id="search-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="搜索文档"
            className="w-full max-w-xl overflow-hidden rounded-panel border border-line bg-ink-900 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4 transition-colors focus-within:border-accent">
              <MagnifyingGlassIcon size={16} className="text-fg-subtle" aria-hidden />
              <input
                ref={inputRef}
                id="search-input"
                type="text"
                role="combobox"
                aria-expanded={searching}
                aria-controls="search-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  searching && hits.length > 0 ? `search-hit-${active}` : undefined
                }
                aria-describedby="search-status"
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
                  if (e.key === "Enter" && hits[active]) {
                    window.location.href = hits[active].path + (hits[active].anchor ?? "");
                  }
                }}
                placeholder="搜索文档、命令、API"
                aria-label="搜索关键词"
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-transparent py-4 text-[15px] text-fg outline-none placeholder:text-fg-subtle"
              />
              <button
                type="button"
                onClick={closeSearch}
                aria-label="关闭搜索"
                className="rounded border border-line p-1 text-fg-subtle transition-colors hover:text-fg"
              >
                <XIcon size={13} aria-hidden />
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
                          <BookOpenTextIcon size={13} aria-hidden />
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {searching && hits.length === 0 && (
                <p className="px-3 py-6 text-sm text-fg-muted">
                  没有匹配 “{query.trim()}” 的条目。试试更短的关键词，例如 emit、wasi、ffi。
                </p>
              )}
              {searching && hits.length > 0 && (
                <ul id="search-results" role="listbox" aria-label="搜索结果">
                  {hits.map((hit, i) => (
                    <li key={`${hit.path}${hit.anchor ?? ""}`} role="presentation">
                      <a
                        id={`search-hit-${i}`}
                        role="option"
                        aria-selected={i === active}
                        href={hit.path + (hit.anchor ?? "")}
                        onMouseEnter={() => setCursor(i)}
                        className={[
                          "flex items-start gap-3 rounded-control px-3 py-2.5 transition-colors",
                          i === active ? "bg-ink-850" : "hover:bg-ink-850/60",
                        ].join(" ")}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-fg">
                            <Highlight text={hit.heading ?? hit.title} terms={terms} />
                          </span>
                          <span className="block truncate text-xs text-fg-subtle">
                            {hit.group}
                            {hit.heading ? ` · ${hit.title}` : ""}
                          </span>
                        </span>
                        <ArrowRightIcon
                          size={14}
                          className={i === active ? "mt-1 text-accent" : "mt-1 text-fg-subtle"}
                          aria-hidden
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p id="search-status" role="status" aria-live="polite" className="sr-only">
              {searching
                ? hits.length === 0
                  ? `没有找到与 ${query.trim()} 匹配的条目`
                  : `找到 ${hits.length} 条结果，当前第 ${active + 1} 条：${hits[active].heading ?? hits[active].title}`
                : ""}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
