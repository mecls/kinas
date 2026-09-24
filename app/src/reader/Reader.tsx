import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  openExternal,
  type ReaderRender,
  type ReaderShow,
  onReaderChanged,
  readerAllowClick,
  readerClose,
  readerConfirm,
  readerErrorOf,
  readerExport,
  readerListDir,
  readerOpen,
  readerOpenInEditor,
  readerPrint,
  readerReadImage,
  readerReadText,
  readerRendered,
  type ReaderSide,
} from "../api.ts";
import { focusTerminal } from "../shell/focus.ts";
import { NOTICE_MS } from "../shell/notice.ts";
import { CLIPBOARD_MAX_BYTES, writeClipboard } from "../terminal/clipboard.ts";
import { onThemeChange } from "../theme.ts";
import type { FrontmatterView } from "./frontmatter.ts";
import { Header, type View } from "./Header.tsx";
import { highlightCode, shouldHighlight } from "./highlight.ts";
import { languageFor } from "./language.ts";
import { classifyLink } from "./links.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { cachedSvg, diagramsNeedRedrawing, renderDiagram } from "./mermaid.ts";
import { PREVIEW_SANDBOX, renderPreview } from "./preview.ts";
import { downloadLabel } from "./labels.ts";
import { type Rendered, renderMarkdown } from "./render.ts";
import { drawnWidth, edgeDrag, sectionButton, sectionPlace, SIDE_DEFAULT, SIDE_MAX_PX, SIDE_MIN_PX, type SectionState } from "./side.ts";
import { renderImage, renderSource } from "./source.ts";
import { FileTree } from "./tree.tsx";
import { Button } from "../ui/index.ts";

// The reader (tasks/prd-kinas-open.md): the file `kinas open` named, in the panel on the right of the window. It only
// reads. Opening, reloading and confirming never move keyboard focus (R34), and a reload replaces the page in one
// step, keeping every diagram and image that did not change (R30).

/**
 * What the shell asks the reader to do. `seq` makes two identical requests distinct.
 *
 * - `show`: an accepted `kinas open`, exactly as Rust sent it.
 * - `follow`: a click on a file or a folder outside the reader — the sidebar's tree, a pin, a recent row. It takes the same
 *   path as a click on the reader's own tree: `follow()`, the human-click door (`reader_allow_click`), which keeps
 *   the open folder and carries no `received_at_ms`, so it adds no line to the log the 200 ms gate counts. A click
 *   must never be dressed up as a `show` (three-column shell §6.14).
 */
export type ReaderRequest = ({ type: "show" } & ReaderShow & { seq: number }) | { type: "follow"; path: string; seq: number };

interface Doc {
  path: string;
  displayPath: string;
  root: string;
  hash: string;
  lines: number;
  /** How Rust said to show it (R2), kept so a reload renders the same way without asking again. */
  render: ReaderRender;
  /** The lowercased extension, for the highlighter's language. */
  ext: string;
  /** The file's text, kept so the Preview/Source toggle re-renders it without reading the file again. */
  text: string;
  rendered: Rendered;
}

/**
 * One document, rendered the way Rust said to (R2).
 *
 * Rust decides the mode, because `"html"` is the difference between escaping text and executing code; this only
 * dispatches on the answer. Every branch returns the same `Rendered` shape, which is why `swapBody`, `hydrate`,
 * the layout effect and the Contents gate need no knowledge of modes at all.
 */
function renderDoc(text: string, render: ReaderRender, ext: string, path: string): Rendered {
  switch (render) {
    // Markdown as its own text is the source view with the markdown grammar: the text is already in hand, so the
    // toggle reads nothing. It never goes through `splitFrontmatter`, so the `---` block shows as the text it is.
    case "markdown":
      return views.markdown === "rendered" ? renderMarkdown(text) : renderSource(text, "markdown");
    case "image":
      return renderImage(path);
    // Rust decides *that* a file is HTML (R3); the toggle only chooses which of its two views this session shows.
    case "html":
      return views.html === "rendered" ? renderPreview(text) : renderSource(text, languageFor(ext));
    case "source":
      return renderSource(text, languageFor(ext));
  }
}

interface Pending {
  mode: "new" | "reload";
  fragment?: string | null;
  scrollTop?: number;
  receivedAt?: number;
}

const STATUS_MS = NOTICE_MS;
const OPENING_AFTER_MS = 150;
const BACK_CAP = 50;
const NARROW_PX = 640;
const FOLLOW_TAIL_PX = 48;

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** Every status line this session, for the debug-only `readerStatusLog` hook. */
const statusLog: string[] = [];

/** The kinds of file with two ways to be shown. Everything else has one, and no toggle. */
type ViewKind = "markdown" | "html";

const viewKindOf = (render: ReaderRender): ViewKind | null => (render === "markdown" || render === "html" ? render : null);

/**
 * Whether a markdown or an HTML file shows rendered, or as its own text. Session state, never a setting (R21).
 *
 * Module-level on purpose: "the choice sticks for the session" (Miguel, 2026-09-16) explicitly does not mean
 * surviving relaunch, and `reader_width_pct`'s path through `get_ui_prefs`/`set_reader_width` already exists for
 * things that do. A module variable dies with the process, which is exactly the requirement — and it keeps this
 * work's promise of adding no new `Store::conn()` access, whose non-reentrant mutex froze the whole window once.
 *
 * One choice **per kind**, not one for both (three-column shell §6.6): with a single variable, looking at an HTML
 * page's markup would make the next `kinas open plan.md` arrive as raw markdown.
 */
const views: Record<ViewKind, View> = { markdown: "rendered", html: "rendered" };

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
const mimeOf = (path: string) => MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

/** Builds the new page off-screen and swaps it in one step, keeping unchanged diagrams and images (R30). */
function swapBody(body: HTMLElement, scroller: HTMLElement, rendered: Rendered, reload: boolean) {
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= FOLLOW_TAIL_PX;
  const top = scroller.scrollTop;
  const template = document.createElement("template");
  template.innerHTML = rendered.html;
  const fresh = template.content;

  const oldBlocks = new Map<string, HTMLElement>();
  const oldImages = new Map<string, HTMLImageElement>();
  // The preview frame is kept, not rebuilt: a fresh iframe would restart the page's scripts *and* jump the
  // layout, and R17 only accepts the first of those.
  const oldFrame = reload ? body.querySelector<HTMLIFrameElement>("iframe.reader-preview-frame") : null;
  if (reload) {
    for (const block of body.querySelectorAll<HTMLElement>(".mermaid-block")) oldBlocks.set(block.dataset.index ?? "", block);
    for (const img of body.querySelectorAll<HTMLImageElement>("img[data-src][data-loaded]")) oldImages.set(img.dataset.src ?? "", img);
  }
  for (const block of fresh.querySelectorAll<HTMLElement>(".mermaid-block")) {
    const hash = block.dataset.hash ?? "";
    const old = oldBlocks.get(block.dataset.index ?? "");
    if (old && old.dataset.hash === hash && old.dataset.drawn === hash) {
      // The same node, so the diagram is not redrawn.
      block.replaceWith(old);
      continue;
    }
    const svg = cachedSvg(hash);
    if (svg !== undefined) {
      block.innerHTML = svg;
      block.dataset.drawn = hash;
    } else if (old?.firstElementChild) {
      // The previous drawing holds the place until the changed one is drawn.
      block.append(old.firstElementChild.cloneNode(true));
    }
  }
  for (const img of fresh.querySelectorAll<HTMLImageElement>("img[data-src]")) {
    const old = oldImages.get(img.dataset.src ?? "");
    if (old) {
      img.replaceWith(old);
      oldImages.delete(img.dataset.src ?? "");
    }
  }
  // Moved into the new placeholder rather than replaced, so `hydrate` finds the same element and only has to
  // reassign `srcdoc`. Switching to Source has no placeholder, so the frame is simply dropped.
  const slot = fresh.querySelector(".reader-preview");
  if (oldFrame && slot) slot.append(oldFrame);
  body.replaceChildren(fresh);
  if (reload) scroller.scrollTop = atBottom ? scroller.scrollHeight : top;
}

function FrontmatterCard({ view }: { view: FrontmatterView }) {
  if (!view.ok) {
    return (
      <section className="reader-frontmatter is-problem">
        <p className="reader-frontmatter-error">Frontmatter could not be read: {view.error}</p>
        <pre>{view.raw}</pre>
      </section>
    );
  }
  return (
    <section className="reader-frontmatter">
      {view.title && <h2 className="reader-frontmatter-title">{view.title}</h2>}
      {view.rows.length > 0 && (
        <dl>
          {view.rows.map((row) => (
            <div key={row.key} className="reader-frontmatter-row">
              <dt>{row.key}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** What the reader is showing, for the shell's sidebar: the open file, and the folder opened with `kinas open <dir>`. */
export interface ReaderNav {
  doc: { path: string; displayPath: string } | null;
  folder: string | null;
}

export function Reader({
  request,
  onClose,
  expanded,
  onExpand,
  onNav,
  treeInSidebar,
  pinned,
  onPin,
  onUnpin,
  notice,
  side,
  onSide,
}: {
  request: ReaderRequest | null;
  onClose: () => void;
  /** Whether the panel has the whole stage. The shell owns it: expanding is a layout matter, not a reading one. */
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  /**
   * Told whenever the open file or folder changes. The reader stays the single owner of what is open — the back
   * stack, the generation counter, the folder — and the sidebar only mirrors it. Must be referentially stable.
   */
  onNav: (nav: ReaderNav) => void;
  /**
   * The sidebar is showing, so the file tree lives there and the reader draws neither it nor a Files button. With
   * the sidebar hidden (⌘S) the tree comes back here, or a folder with no README would show "Choose a file" and
   * nothing to choose from.
   */
  treeInSidebar: boolean;
  /** Whether the open file is pinned. The shell owns the pins; the reader only offers the menu item. */
  pinned: boolean;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  /** Something the shell wants said here, where the reader says things. `seq` makes a repeat a new notice. */
  notice: { text: string; seq: number } | null;
  /**
   * Whether Files and Contents show beside the text while the reader is wide, and the column's width
   * (reader-layout PRD rule 4). The shell owns it, because it is read at boot and stored; one call per gesture.
   */
  side: ReaderSide;
  onSide: (side: ReaderSide) => void;
}) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [problem, setProblem] = useState<{ displayPath: string; message: string } | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const folderRef = useRef<string | null>(null);
  folderRef.current = folder;
  const [confirm, setConfirm] = useState<{ path: string; root: string } | null>(null);
  /** Several files matched a name: listed newest first, none opened until one is clicked (R1b). */
  const [picks, setPicks] = useState<{ paths: string[]; root: string } | null>(null);
  const [status, setStatus] = useState<{ text: string; sticky: boolean } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [back, setBack] = useState<{ path: string; scrollTop: number }[]>([]);
  const [tall, setTall] = useState(false);
  const [narrow, setNarrow] = useState(false);
  /** The reader's width, for the column's: the text keeps 320 px of it (reader-layout PRD rule 6). */
  const [readerWidth, setReaderWidth] = useState(0);
  /** The column's width while its edge is dragged; null otherwise, when the stored width decides. */
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<"files" | "contents" | null>(null);
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);

  const frame = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const docRef = useRef<Doc | null>(null);
  const pending = useRef<Pending | null>(null);
  const generation = useRef(0);
  const blobs = useRef(new Set<string>());
  const statusTimer = useRef<number | undefined>(undefined);

  const say = useCallback((text: string, sticky = false) => {
    // Debug builds only: e2e reads what was said, since a 6 s line can come and go between two slow driver lookups.
    if (import.meta.env.TAURI_ENV_DEBUG === "true") statusLog.push(text);
    window.clearTimeout(statusTimer.current);
    setStatus({ text, sticky });
    if (!sticky) statusTimer.current = window.setTimeout(() => setStatus(null), STATUS_MS);
  }, []);

  const scrollToId = useCallback((id: string) => {
    const target = body.current?.querySelector(`[id="${CSS.escape(id)}"]`);
    if (target && scroller.current) scroller.current.scrollTop += target.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top;
  }, []);

  const show = useCallback(
    async function show(path: string, opts: { push: boolean; fragment?: string | null; scrollTop?: number; receivedAt?: number }): Promise<void> {
      const gen = ++generation.current;
      const timer = window.setTimeout(() => {
        if (gen === generation.current && !docRef.current) setOpening(baseName(path));
      }, OPENING_AFTER_MS);
      try {
        const opened = await readerOpen(path);
        if (gen !== generation.current) return;
        // An image before the no-text check: `reader_open` sends an image's mode and no text, and without this
        // every `.png` named on the command line would open the file tree instead of the image.
        if (opened.kind === "file" && opened.render === "image") {
          const previous = docRef.current;
          if (opts.push && previous && previous.path !== opened.path) {
            setBack((b) => [...b, { path: previous.path, scrollTop: scroller.current?.scrollTop ?? 0 }].slice(-BACK_CAP));
          }
          pending.current = { mode: "new", fragment: null, scrollTop: opts.scrollTop, receivedAt: opts.receivedAt };
          const next: Doc = {
            path: opened.path,
            displayPath: opened.display_path,
            root: opened.root,
            hash: opened.path,
            lines: 0,
            render: "image",
            ext: opened.ext,
            text: "",
            rendered: renderDoc("", "image", opened.ext, opened.path),
          };
          docRef.current = next;
          setDoc(next);
          setProblem(null);
          setOpening(null);
          setStatus((s) => (s?.sticky ? null : s));
          return;
        }
        if (opened.kind === "dir" || !opened.text) {
          await openFolder(opened.path);
          return;
        }
        const previous = docRef.current;
        if (opts.push && previous && previous.path !== opened.path) {
          const scrollTop = scroller.current?.scrollTop ?? 0;
          setBack((b) => [...b, { path: previous.path, scrollTop }].slice(-BACK_CAP));
        }
        pending.current = { mode: "new", fragment: opts.fragment ?? null, scrollTop: opts.scrollTop, receivedAt: opts.receivedAt };
        // A file always carries a mode; only a folder has none, and that returned above.
        const render = opened.render ?? "source";
        const next: Doc = {
          path: opened.path,
          displayPath: opened.display_path,
          root: opened.root,
          hash: opened.text.hash,
          lines: opened.text.text.split("\n").length,
          render,
          ext: opened.ext,
          text: opened.text.text,
          rendered: renderDoc(opened.text.text, render, opened.ext, opened.path),
        };
        docRef.current = next;
        setDoc(next);
        setProblem(null);
        setOpening(null);
        setStatus((s) => (s?.sticky ? null : s));
      } catch (e) {
        if (gen !== generation.current) return;
        const error = readerErrorOf(e);
        setOpening(null);
        // `not_markdown` joins these: a binary clicked in the tree must say so and stay said. A six-second status
        // line that vanishes would leave the reader blank with no explanation of why.
        if (error.code === "too_large" || error.code === "not_utf8" || error.code === "not_markdown") {
          docRef.current = null;
          setDoc(null);
          setProblem({ displayPath: path, message: error.message });
        } else {
          say(error.message);
        }
      } finally {
        window.clearTimeout(timer);
      }
    },
    // openFolder is hoisted below and only reads refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say],
  );

  async function openFolder(path: string) {
    try {
      const listing = await readerListDir(path);
      setFolder(path);
      setOverlay(null);
      const readme =
        listing.entries.find((e) => e.kind === "file" && e.name === "README.md") ?? listing.entries.find((e) => e.kind === "file" && e.name.toLowerCase() === "readme.md");
      if (readme) {
        await show(readme.path, { push: true });
      } else {
        generation.current++;
        docRef.current = null;
        setDoc(null);
        setProblem(null);
      }
    } catch (e) {
      say(readerErrorOf(e).message);
    }
  }

  const follow = useCallback(
    async (path: string, fragment: string | null) => {
      try {
        const target = await readerAllowClick(path);
        if (target.kind === "dir") await openFolder(target.path);
        else await show(target.path, { push: true, fragment });
      } catch (e) {
        const message = readerErrorOf(e).message;
        // A click in the sidebar can open the panel with nothing in it yet — a pin whose file has since gone, say.
        // A status line that fades after six seconds would leave an open, empty panel with no explanation, so the
        // reason takes the page instead. With something already showing, it stays and the status line says why.
        if (!docRef.current && !folderRef.current) setProblem({ displayPath: baseName(path), message });
        else say(message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, show],
  );

  const loadImage = useCallback(async (img: HTMLImageElement, current: Doc) => {
    const src = img.dataset.src ?? "";
    const target = classifyLink(src, current.path, current.root);
    const fallBack = () => {
      img.dataset.failed = "1";
      img.hidden = true;
      const label = document.createElement(target.kind === "external" ? "a" : "span");
      label.className = "reader-image-alt";
      label.textContent = img.alt || src;
      if (target.kind === "external") label.setAttribute("href", target.url);
      img.after(label);
    };
    // Remote images are never fetched (R20).
    if (target.kind !== "file") return fallBack();
    try {
      const bytes = await readerReadImage(target.path);
      if (!img.isConnected) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(target.path) }));
      blobs.current.add(url);
      img.src = url;
      img.dataset.loaded = "1";
    } catch {
      fallBack();
    }
  }, []);

  // Draws what the swap could not reuse, then reports how long the open took.
  const hydrate = useCallback(
    async (current: Doc, receivedAt: number | undefined) => {
      const el = body.current;
      if (!el) return;
      const gen = generation.current;
      const blocks = [...el.querySelectorAll<HTMLElement>(".mermaid-block")].filter((b) => b.dataset.drawn !== b.dataset.hash);
      const images = [...el.querySelectorAll<HTMLImageElement>("img[data-src]:not([data-loaded]):not([data-failed])")];
      // Source blocks and markdown fences alike (R10). Highlighted here, after the swap, never in the pure
      // renderer, so render.ts and source.ts stay DOM-free and bun-testable.
      const code = [...el.querySelectorAll<HTMLElement>('pre > code[class^="language-"]:not([data-highlighted]):not([data-highlight])')];
      // The HTML preview (R12, R13). Built here rather than in the pure renderer, and never through `innerHTML`:
      // the document is assigned to `srcdoc` as a *property*, on an element made with `createElement`.
      const slot = el.querySelector(".reader-preview");
      const previewDoc = current.rendered.preview;
      await Promise.all([
        ...(slot && previewDoc !== undefined
          ? [
              (async () => {
                const existing = slot.querySelector<HTMLIFrameElement>("iframe.reader-preview-frame");
                // An unchanged document on the same element: nothing to do, so the page is not restarted.
                if (existing && existing.dataset.hash === current.hash) return;
                const frame = existing ?? document.createElement("iframe");
                if (!existing) {
                  frame.className = "reader-preview-frame";
                  // `allow-scripts` and nothing else: with `allow-same-origin` beside it the framed document could
                  // remove its own sandbox attribute, and the isolation would be worth nothing (R12).
                  frame.setAttribute("sandbox", PREVIEW_SANDBOX);
                  frame.setAttribute("title", "Preview");
                }
                const loaded = new Promise<void>((resolve) => {
                  frame.addEventListener("load", () => resolve(), { once: true });
                  // A page that never fires `load` must not hang the open's measurement.
                  window.setTimeout(resolve, 3000);
                });
                frame.srcdoc = previewDoc;
                frame.dataset.hash = current.hash;
                if (!existing) slot.append(frame);
                await loaded;
              })(),
            ]
          : []),
        ...blocks.map(async (block) => {
          const diagram = current.rendered.diagrams[Number(block.dataset.index)];
          if (!diagram || diagram.hash !== block.dataset.hash) return;
          const result = await renderDiagram(diagram.hash, diagram.source);
          if (!block.isConnected || block.dataset.hash !== diagram.hash) return;
          if ("svg" in result) {
            block.innerHTML = result.svg;
          } else {
            const line = document.createElement("p");
            line.className = "mermaid-error";
            line.textContent = result.error;
            const source = document.createElement("pre");
            source.textContent = diagram.source;
            block.replaceChildren(line, source);
          }
          block.dataset.drawn = diagram.hash;
        }),
        ...images.map((img) => loadImage(img, current)),
        ...code.map(async (el) => {
          const text = el.textContent ?? "";
          const id = /language-([\w-]+)/.exec(el.className)?.[1] ?? "";
          if (!shouldHighlight(text)) {
            // A minified bundle is one enormous line: plain monospace is the honest rendering of it.
            el.dataset.highlight = "skipped";
            return;
          }
          const html = await highlightCode(text, id);
          // A reload can swap the body while the grammar's chunk is still loading.
          if (html === null || !el.isConnected) return;
          el.innerHTML = html;
          el.dataset.highlighted = "";
        }),
      ]);
      if (gen !== generation.current || docRef.current !== current) return;
      article.current?.setAttribute("data-rendered", "");
      if (receivedAt !== undefined) void readerRendered(current.lines, current.rendered.diagrams.length, Math.max(0, Date.now() - receivedAt)).catch(() => {});
    },
    [loadImage],
  );

  // The ground turned (Settings → Appearance, or macOS): everything else follows the tokens by itself, but a diagram's
  // colours are baked into its SVG. Each one is redrawn where it stands, the old drawing staying up until the new one
  // is ready, so the page does not jump.
  useEffect(
    () =>
      onThemeChange(() => {
        diagramsNeedRedrawing();
        const current = docRef.current;
        if (!body.current || !current) return;
        for (const block of body.current.querySelectorAll<HTMLElement>(".mermaid-block")) delete block.dataset.drawn;
        void hydrate(current, undefined);
      }),
    [hydrate],
  );

  // The DOM swap happens before paint, in the same frame as the header and frontmatter card.
  useLayoutEffect(() => {
    const el = body.current;
    const sc = scroller.current;
    const p = pending.current;
    pending.current = null;
    if (!el || !sc) return;
    if (!doc) {
      el.replaceChildren();
      article.current?.removeAttribute("data-rendered");
      return;
    }
    if (!p) return;
    if (p.mode === "new") article.current?.removeAttribute("data-rendered");
    swapBody(el, sc, doc.rendered, p.mode === "reload");
    if (p.mode === "new") {
      sc.scrollTop = p.scrollTop ?? 0;
      if (p.fragment) scrollToId(p.fragment);
    }
    const inUse = new Set([...el.querySelectorAll("img")].map((i) => i.src));
    for (const url of blobs.current) {
      if (!inUse.has(url)) {
        URL.revokeObjectURL(url);
        blobs.current.delete(url);
      }
    }
    void hydrate(doc, p.receivedAt);
  }, [doc, hydrate, scrollToId]);

  // A request from the shell: a `kinas open`, or a click on a file outside the reader.
  useEffect(() => {
    if (!request) return;
    if (request.type === "follow") {
      void follow(request.path, null);
      return;
    }
    if (request.pick && request.pick.length > 0) {
      setPicks({ paths: request.pick, root: request.root });
      return;
    }
    setPicks(null);
    if (request.confirm) {
      setConfirm({ path: request.path, root: request.root });
      return;
    }
    if (request.kind === "dir") {
      void openFolder(request.path);
    } else {
      setFolder(null);
      void show(request.path, { push: true, receivedAt: request.received_at_ms });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Live reload (R29, R30): Rust watches the open file's folder and names the file that changed.
  useEffect(() => {
    const stop = onReaderChanged(async ({ path }) => {
      const current = docRef.current;
      if (!current || current.path !== path) return;
      try {
        const text = await readerReadText(path);
        const latest = docRef.current;
        if (!latest || latest.path !== path) return;
        setStatus((s) => (s?.sticky ? null : s));
        if (text.hash === latest.hash) return;
        pending.current = { mode: "reload" };
        // The same mode the open used: a `.sql` saved in the pane beside the reader must not come back as markdown.
        const next: Doc = {
          ...latest,
          hash: text.hash,
          lines: text.text.split("\n").length,
          text: text.text,
          rendered: renderDoc(text.text, latest.render, latest.ext, latest.path),
        };
        docRef.current = next;
        setDoc(next);
      } catch (e) {
        const error = readerErrorOf(e);
        if (error.code === "missing") say(`${baseName(path)} was removed; showing the last version`, true);
        else say(error.message);
      }
    });
    return () => void stop.then((u) => u());
  }, [say]);

  // The shell speaks through the reader's status line: a pin's result, or Rust's reason for refusing one.
  useEffect(() => {
    if (notice) say(notice.text);
    // Keyed on the notice alone: `say` is stable, and a new `seq` is a new thing to say.
  }, [notice, say]);

  // The shell's sidebar mirrors what is open. One effect, keyed on what it reports, so a reload tells it nothing.
  const docPath = doc?.path ?? null;
  const docDisplayPath = doc?.displayPath ?? null;
  useEffect(() => {
    onNav({ doc: docPath !== null && docDisplayPath !== null ? { path: docPath, displayPath: docDisplayPath } : null, folder });
  }, [onNav, docPath, docDisplayPath, folder]);

  // The Files overlay belongs to the reader's own tree; when the tree moves to the sidebar it has nothing to show.
  useEffect(() => {
    if (treeInSidebar) setOverlay((o) => (o === "files" ? null : o));
  }, [treeInSidebar]);

  // Contents only for a page taller than the reader (R28); the side column folds away when the reader is narrow (R33).
  useEffect(() => {
    const sc = scroller.current;
    const el = body.current;
    const box = frame.current;
    if (!sc || !el || !box) return;
    const measure = () => {
      setTall(sc.scrollHeight > sc.clientHeight + 1);
      setNarrow(box.clientWidth > 0 && box.clientWidth < NARROW_PX);
      setReaderWidth(box.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(sc);
    observer.observe(el);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // The column's edge (reader-layout PRD rule 5). The controller outlives renders, so it saves through refs to the
  // current side and callback: a drag that starts on one render ends on another.
  const sideNow = useRef(side);
  sideNow.current = side;
  const onSideNow = useRef(onSide);
  onSideNow.current = onSide;
  const edge = useRef<ReturnType<typeof edgeDrag> | null>(null);
  edge.current ??= edgeDrag({ live: setLiveWidth, save: (width) => onSideNow.current({ ...sideNow.current, width }) });
  const edgeMove = (clientX: number) => {
    const box = main.current?.getBoundingClientRect();
    if (box) edge.current!.move(clientX - box.left, box.width);
  };
  const edgeRelease = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released, or a synthetic pointer (the e2e) that never had capture.
    }
  };

  const frameRequest = useRef(0);
  const onScroll = () => {
    if (frameRequest.current) return;
    frameRequest.current = requestAnimationFrame(() => {
      frameRequest.current = 0;
      const sc = scroller.current;
      const current = docRef.current;
      if (!sc || !current) return;
      const line = sc.getBoundingClientRect().top + 16;
      let slug: string | null = null;
      for (const heading of current.rendered.headings) {
        const el = body.current?.querySelector(`[id="${CSS.escape(heading.slug)}"]`);
        if (el && el.getBoundingClientRect().top <= line) slug = heading.slug;
      }
      setCurrentSlug(slug);
    });
  };

  // Every link click is the reader's: the webview never navigates (R19, R21).
  const onClickCapture = (event: React.MouseEvent) => {
    const anchor = (event.target as Element).closest?.("a");
    if (!anchor || !body.current?.contains(anchor)) return;
    event.preventDefault();
    const current = docRef.current;
    if (!current) return;
    const target = classifyLink(anchor.getAttribute("href"), current.path, current.root);
    if (target.kind === "fragment") scrollToId(target.id);
    else if (target.kind === "external") void openExternal(target.url).catch((e) => say(readerErrorOf(e).message));
    else if (target.kind === "file") void follow(target.path, target.fragment);
  };

  const goBack = () => {
    const last = back.at(-1);
    if (!last) return;
    setBack((b) => b.slice(0, -1));
    void show(last.path, { push: false, scrollTop: last.scrollTop });
  };

  // R37: a new Herdr pane with the editor; on success the keys go to the terminal, where that pane now is.
  const openInEditor = async () => {
    const current = docRef.current;
    if (!current) return;
    try {
      await readerOpenInEditor(current.path);
      focusTerminal();
    } catch (e) {
      say(readerErrorOf(e).message);
    }
  };

  const close = () => {
    generation.current++;
    void readerClose().catch(() => {});
    docRef.current = null;
    setDoc(null);
    setFolder(null);
    setBack([]);
    setConfirm(null);
    setProblem(null);
    setStatus(null);
    setOverlay(null);
    // The shell gives the terminal the keys afterwards, when the Work page is showing (App.tsx, closeReader).
    onClose();
  };

  const openConfirmed = async () => {
    const pendingPath = confirm?.path;
    if (!pendingPath) return;
    setConfirm(null);
    try {
      await readerConfirm(pendingPath, true);
      await show(pendingPath, { push: true });
    } catch (e) {
      say(readerErrorOf(e).message);
    }
  };

  const dismiss = () => {
    const pendingPath = confirm?.path;
    setConfirm(null);
    if (pendingPath) void readerConfirm(pendingPath, false).catch(() => {});
    if (!docRef.current && !folder && !problem) onClose();
  };

  /**
   * Rendered ⇄ Source for the open markdown or HTML file (R21, amended 2026-09-18 to cover markdown).
   *
   * Sets the module-level session choice for this file's kind and re-renders from the text already in hand: no new
   * Tauri command, no stored setting, and no second read of the file. Two buttons with `aria-pressed` say which
   * view is showing; the old single button, whose label named the view it would switch *to*, is gone.
   */
  const changeView = (next: View) => {
    const current = docRef.current;
    const kind = current ? viewKindOf(current.render) : null;
    if (!current || !kind || views[kind] === next) return;
    views[kind] = next;
    pending.current = { mode: "new", fragment: null, scrollTop: 0 };
    const rerendered: Doc = { ...current, rendered: renderDoc(current.text, current.render, current.ext, current.path) };
    docRef.current = rerendered;
    setDoc(rerendered);
  };

  // A copy of the file, wherever Miguel says in the macOS save sheet. The page names the file and nothing else; the
  // sheet, the read and the write are all Rust's (reader/export.rs). Cancelling the sheet is not an event: it says
  // nothing. A refusal is shown in Rust's own words.
  const download = async () => {
    const current = docRef.current;
    if (!current) return;
    try {
      const result = await readerExport(current.path);
      if (result.status === "saved") say(`Saved ${result.name}`);
    } catch (e) {
      say(readerErrorOf(e).message);
    }
  };

  // The macOS print sheet, where "Save as PDF" lives. Nothing is set up here and nothing is undone afterwards: the
  // sheet gives no signal when it closes, so the print stylesheet alone decides what prints.
  const print = async () => {
    try {
      await readerPrint();
    } catch (e) {
      say(readerErrorOf(e).message);
    }
  };

  // The file's text as Rust read it (UTF-8, a leading BOM removed), whichever view is showing.
  const copy = async () => {
    const current = docRef.current;
    if (!current) return;
    if (current.text === "") return say("Nothing to copy");
    if (new TextEncoder().encode(current.text).length > CLIPBOARD_MAX_BYTES) return say("Too large to copy (over 1 MiB)");
    say((await writeClipboard(current.text)) ? "Copied" : "Could not copy");
  };

  // Debug builds only: e2e proves a reload keeps the diagram's node (R30), and can see where focus went (R34).
  useEffect(() => {
    if (import.meta.env.TAURI_ENV_DEBUG !== "true") return;
    const focusLog: string[] = [];
    const describe = (target: EventTarget | null) =>
      target === window ? "window" : target instanceof Element ? `${target.tagName.toLowerCase()}${typeof target.className === "string" && target.className ? `.${target.className.trim().split(/\s+/).join(".")}` : ""}` : String(target);
    const record = (event: Event) => {
      focusLog.push(`${Date.now()} ${event.type} ${describe(event.target)} related=${describe((event as FocusEvent).relatedTarget ?? null)}`);
      focusLog.splice(0, Math.max(0, focusLog.length - 60));
    };
    for (const type of ["focusin", "focusout"]) document.addEventListener(type, record, true);
    for (const type of ["focus", "blur"]) window.addEventListener(type, (e) => e.target === window && record(e));

    // R19, and debug builds only. The probe's proof that a preview's inline script ran arrives by postMessage,
    // the only channel an opaque-origin frame has. A release build that listens has handed the preview a channel
    // into the app, which is why this lives inside the gate above and nowhere else.
    //
    // The payload is never read. A count is all the probe needs — it only has to distinguish "the page ran" from
    // "the frame rendered nothing" — and interpreting a message from a sandboxed document is the exact thing the
    // isolation exists to prevent. The source must also be a frame in this document: any other window's message
    // is ignored rather than counted.
    let previewMessages = 0;
    const onPreviewMessage = (event: MessageEvent) => {
      const source = event.source as unknown;
      if ([...document.querySelectorAll("iframe")].some((f) => (f.contentWindow as unknown) === source)) previewMessages += 1;
    };
    window.addEventListener("message", onPreviewMessage);

    void import("../testHooks.ts").then(({ registerTestHooks }) =>
      registerTestHooks({
        readerFocusLog: () => focusLog.join("\n"),
        readerStatusLog: () => statusLog.join("\n"),
        readerPreviewMessages: () => previewMessages,
        readerMarkDiagram: () => {
          const svg = body.current?.querySelector(".mermaid-block svg") as (Element & { __kinasMark?: number }) | null;
          if (!svg) return false;
          svg.__kinasMark = 1;
          return true;
        },
        readerDiagramMarked: () => Boolean((body.current?.querySelector(".mermaid-block svg") as (Element & { __kinasMark?: number }) | null)?.__kinasMark),
      }),
    );
    return () => window.removeEventListener("message", onPreviewMessage);
  }, []);

  const headings = doc?.rendered.headings ?? [];
  const contents = Boolean(doc) && tall && headings.length >= 2;
  /** The tree is the reader's to draw only while the sidebar is not there to draw it. */
  const ownTree = folder !== null && !treeInSidebar;
  // Wide, each section shows as the captain last left it; narrow, it is a peek over the text that changes nothing
  // remembered (reader-layout PRD rules 2–3).
  const filesState: SectionState = { name: "Files", offered: ownTree, narrow, shown: side.files, overlayOpen: overlay === "files" };
  const contentsState: SectionState = { name: "Contents", offered: contents, narrow, shown: side.contents, overlayOpen: overlay === "contents" };
  const filesPlace = sectionPlace(filesState);
  const contentsPlace = sectionPlace(contentsState);
  const sideShown = filesPlace !== null || contentsPlace !== null;
  const toggle = (section: "files" | "contents") => () => {
    if (narrow) setOverlay((o) => (o === section ? null : section));
    else onSide({ ...side, [section]: !side[section] });
  };
  const filesButton = sectionButton(filesState);
  const contentsButton = sectionButton(contentsState);
  const columnWidth = liveWidth ?? drawnWidth(side.width, readerWidth);

  const viewKind = doc ? viewKindOf(doc.render) : null;
  const noFile = doc ? null : "Open a file first";
  // What the print sheet gets is this document laid out for paper (styles/print.css). An image is not text to lay
  // out, and a rendered HTML page is a sandboxed frame, which prints as the clipped box it is — its source prints.
  const cannotPrint = noFile ?? (doc?.render === "image" ? "Images can't be printed from here" : doc?.render === "html" && views.html === "rendered" ? "Switch to Source to print" : null);
  // An item is listed once it exists: nothing here is a placeholder for a later phase.
  const menu: MenuItem[] = [
    { id: "download", label: downloadLabel(doc ? baseName(doc.path) : ""), disabledReason: noFile, onSelect: () => void download() },
    { id: "print", label: "Print as PDF", disabledReason: cannotPrint, onSelect: () => void print() },
    { id: "editor", label: "Open in editor", disabledReason: noFile, onSelect: () => void openInEditor() },
    // The open file. A folder is pinned from its header in the sidebar, where the folder is.
    { id: "pin", label: pinned ? "Unpin" : "Pin", disabledReason: noFile, onSelect: () => doc && (pinned ? onUnpin(doc.path) : onPin(doc.path)) },
  ];

  return (
    <div className="reader-frame" ref={frame}>
      <Header
        displayPath={doc?.displayPath ?? problem?.displayPath ?? (folder ? baseName(folder) : "")}
        title={doc?.path ?? folder ?? ""}
        showBadge={Boolean(doc)}
        canGoBack={back.length > 0}
        onBack={goBack}
        view={viewKind ? views[viewKind] : null}
        onView={changeView}
        files={filesButton && { ...filesButton, onToggle: toggle("files") }}
        contents={contentsButton && { ...contentsButton, onToggle: toggle("contents") }}
        copyDisabledReason={!doc ? noFile : doc.render === "image" ? "Images can't be copied as text" : null}
        onCopy={() => void copy()}
        menu={menu}
        menuResetKey={doc?.path ?? folder ?? ""}
        expanded={expanded}
        onExpand={onExpand}
        onClose={close}
      />
      {status && (
        <p className="reader-status" role="status">
          {status.text}
        </p>
      )}
      <div className="reader-main" ref={main} data-narrow={narrow ? "" : undefined} data-dragging={liveWidth !== null ? "" : undefined}>
        {sideShown && (
          <div
            className="reader-side"
            data-overlay={narrow ? "" : undefined}
            // Narrow, the overlay is 220 px whatever wide remembers (PRD rule 3), so the width is set only beside the text.
            style={narrow ? undefined : ({ "--reader-side-w": `${columnWidth}px` } as React.CSSProperties)}
          >
            {folder && filesPlace && (
              <section className="reader-files" aria-label="Files">
                <h2 className="reader-label">Files</h2>
                <FileTree root={folder} selected={doc?.path ?? null} onOpen={(path) => void follow(path, null)} />
              </section>
            )}
            {contentsPlace && (
              <nav className="reader-contents" aria-label="Contents">
                <h2 className="reader-label">Contents</h2>
                <ol>
                  {headings.map((heading) => (
                    <li key={heading.slug} data-level={heading.level}>
                      {/* The whole heading on hover: a narrower column cuts more of them short (PRD rule 8). */}
                      <button type="button" title={heading.text} aria-current={heading.slug === currentSlug ? "true" : undefined} onClick={() => scrollToId(heading.slug)}>
                        {heading.text}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </div>
        )}
        {sideShown && !narrow && (
          <div
            className="reader-side-edge"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the reader's side column"
            aria-valuemin={SIDE_MIN_PX}
            aria-valuemax={SIDE_MAX_PX}
            aria-valuenow={columnWidth}
            title="Drag to resize; double-click for the default width"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // A synthetic pointer (the e2e) has no capture; its move and up events still reach the edge.
              }
              edge.current!.down(columnWidth);
            }}
            onPointerMove={(e) => edgeMove(e.clientX)}
            onPointerUp={(e) => {
              edgeRelease(e);
              edgeMove(e.clientX);
              edge.current!.end();
            }}
            onPointerCancel={(e) => {
              edgeRelease(e);
              edge.current!.end();
            }}
            onDoubleClick={() => onSide({ ...side, width: SIDE_DEFAULT.width })}
          />
        )}
        <div className="reader-scroll" ref={scroller} onClickCapture={onClickCapture} onScroll={onScroll}>
          {confirm && (
            <div className="reader-confirm" role="group" aria-label="Open a file outside the projects root">
              <p className="reader-confirm-title">Open a file outside {confirm.root}?</p>
              <code className="reader-confirm-path">{confirm.path}</code>
              <div className="reader-confirm-actions">
                <Button kind="primary" className="button" onClick={() => void openConfirmed()}>
                  Open
                </Button>
                <Button className="button" onClick={dismiss}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
          {picks && (
            <div className="reader-picks" role="group" aria-label="Several files match that name">
              <p className="reader-picks-title">Which one? {picks.paths.length} files match, most recently changed first.</p>
              <ul>
                {picks.paths.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="reader-pick"
                      title={path}
                      onClick={() => {
                        setPicks(null);
                        void show(path, { push: true });
                      }}
                    >
                      {path.startsWith(`${picks.root}/`) ? path.slice(picks.root.length + 1) : path}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {opening && !doc && <p className="reader-note">Opening {opening}…</p>}
          {problem && <p className="reader-problem">{problem.message}</p>}
          {!doc && !problem && !opening && folder && <p className="reader-note">Choose a file</p>}
          {/* data-render carries the mode to the stylesheet (source and images are not capped at a prose measure)
              and to the e2e, which asserts how a file opened. */}
          <article className="reader-doc" data-render={doc?.render} ref={article} hidden={!doc}>
            {doc?.rendered.frontmatter && <FrontmatterCard view={doc.rendered.frontmatter} />}
            <div className="reader-body" ref={body} />
          </article>
        </div>
      </div>
    </div>
  );
}
