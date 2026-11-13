import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser, FileText, Heading1, Heading2, Heading3,
  ImageOff, Italic, List, ListOrdered, Pilcrow, Redo2, RefreshCw, Strikethrough, Underline, Undo2,
} from "lucide-react";
import { sanitizeHtml } from "../lib/editorUtils.js";

const exec = (cmd, value = null) => document.execCommand(cmd, false, value);

function ToolBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors ${
        active ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

const Divider = () => <span className="mx-1 h-6 w-px bg-slate-300" aria-hidden="true" />;

/**
 * Word-inspired contentEditable editor.
 * `docKey` changes => content is replaced with `initialHtml`.
 */
export default function RichTextEditor({ editorRef, docKey, initialHtml, onChange, source, scanning, lastAnalyzed, onReplaceFile }) {
  const [state, setState] = useState({});
  const [block, setBlock] = useState("p");
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const savedRange = useRef(null);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const txt = el.innerText || "";
    setCounts({ words: (txt.match(/\b\w+\b/g) || []).length, chars: txt.replace(/\n/g, "").length });
    onChange();
  }, [editorRef, onChange]);

  // Load content when a new document is opened.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initialHtml || "<p><br></p>";
    try {
      exec("defaultParagraphSeparator", "p");
      exec("styleWithCSS", false);
    } catch {
      /* not supported everywhere */
    }
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Track toolbar state from the current selection.
  useEffect(() => {
    const update = () => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel?.rangeCount || !el.contains(sel.anchorNode)) return;
      savedRange.current = sel.getRangeAt(0).cloneRange();
      setState({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
        ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
        left: document.queryCommandState("justifyLeft"),
        center: document.queryCommandState("justifyCenter"),
        right: document.queryCommandState("justifyRight"),
        justify: document.queryCommandState("justifyFull"),
      });
      const fb = String(document.queryCommandValue("formatBlock") || "p").toLowerCase().replace(/[<>]/g, "");
      setBlock(["h1", "h2", "h3"].includes(fb) ? fb : "p");
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [editorRef]);

  const run = (cmd, value) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && (!sel.rangeCount || !el.contains(sel.anchorNode))) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    exec(cmd, value);
    emit();
  };
  const setBlockType = (tag) => run("formatBlock", `<${tag}>`);

  const onPaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) exec("insertHTML", sanitizeHtml(html));
    else exec("insertText", text);
    emit();
  };

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "b" || k === "i" || k === "u") {
      e.preventDefault();
      run({ b: "bold", i: "italic", u: "underline" }[k]);
    }
  };

  const ago = lastAnalyzed ? Math.max(0, Math.round((Date.now() - lastAnalyzed) / 1000)) : null;

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
      {/* Document header strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-2.5">
        <FileText className="h-4 w-4 text-indigo-400" />
        <span className="text-xs font-semibold text-slate-200">
          {source?.type === "upload" ? `${source.kind} viewer · ${source.name}` : "Inbuilt text editor"}
        </span>
        {source?.type === "upload" && (
          <>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
              {source.pages} page{source.pages === 1 ? "" : "s"} · text extracted · editable
            </span>
            {source.images > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300" title="Graphics parsing is planned for Round 3">
                <ImageOff className="h-3 w-3" /> {source.images} image{source.images > 1 ? "s" : ""} skipped (Round 3)
              </span>
            )}
            <button onClick={onReplaceFile} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white">
              <RefreshCw className="h-3 w-3" /> Replace file
            </button>
          </>
        )}
      </div>

      {/* Ribbon */}
      <div className="word-surface flex flex-wrap items-center gap-0.5 border-b border-slate-300 bg-slate-100 px-2 py-1.5" role="toolbar" aria-label="Formatting">
        <ToolBtn icon={Undo2} label="Undo (Ctrl+Z)" onClick={() => run("undo")} />
        <ToolBtn icon={Redo2} label="Redo (Ctrl+Y)" onClick={() => run("redo")} />
        <Divider />
        <select
          value={block}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setBlockType(e.target.value)}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          aria-label="Paragraph style"
        >
          <option value="p">Normal text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <ToolBtn icon={Heading1} label="Heading 1" active={block === "h1"} onClick={() => setBlockType("h1")} />
        <ToolBtn icon={Heading2} label="Heading 2" active={block === "h2"} onClick={() => setBlockType("h2")} />
        <ToolBtn icon={Heading3} label="Heading 3" active={block === "h3"} onClick={() => setBlockType("h3")} />
        <ToolBtn icon={Pilcrow} label="Normal paragraph" active={block === "p"} onClick={() => setBlockType("p")} />
        <Divider />
        <ToolBtn icon={Bold} label="Bold (Ctrl+B)" active={state.bold} onClick={() => run("bold")} />
        <ToolBtn icon={Italic} label="Italic (Ctrl+I)" active={state.italic} onClick={() => run("italic")} />
        <ToolBtn icon={Underline} label="Underline (Ctrl+U)" active={state.underline} onClick={() => run("underline")} />
        <ToolBtn icon={Strikethrough} label="Strikethrough" active={state.strike} onClick={() => run("strikeThrough")} />
        <Divider />
        <ToolBtn icon={List} label="Bulleted list" active={state.ul} onClick={() => run("insertUnorderedList")} />
        <ToolBtn icon={ListOrdered} label="Numbered list" active={state.ol} onClick={() => run("insertOrderedList")} />
        <Divider />
        <ToolBtn icon={AlignLeft} label="Align left" active={state.left} onClick={() => run("justifyLeft")} />
        <ToolBtn icon={AlignCenter} label="Center" active={state.center} onClick={() => run("justifyCenter")} />
        <ToolBtn icon={AlignRight} label="Align right" active={state.right} onClick={() => run("justifyRight")} />
        <ToolBtn icon={AlignJustify} label="Justify" active={state.justify} onClick={() => run("justifyFull")} />
        <Divider />
        <ToolBtn icon={Eraser} label="Clear formatting" onClick={() => { run("removeFormat"); setBlockType("p"); }} />
      </div>

      {/* Page */}
      <div className="word-surface relative flex-1 overflow-y-auto bg-slate-200/90 px-3 py-6 scrollbar-thin sm:px-8">
        {scanning && <div className="scan-line absolute inset-x-0 top-0 h-0.5" aria-hidden="true" />}
        <div className="mx-auto min-h-full max-w-[816px] rounded-sm bg-white px-8 py-10 shadow-[0_2px_18px_rgba(15,23,42,0.18)] sm:px-14 sm:py-14">
          <div
            ref={editorRef}
            className="doc-editor min-h-[480px]"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            aria-label="Document editor"
            data-placeholder="Start writing…"
            onInput={emit}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 border-t border-slate-800 bg-slate-900 px-4 py-1.5 text-[11px] text-slate-500">
        <span>{counts.words} words</span>
        <span>{counts.chars} characters</span>
        <span className="ml-auto flex items-center gap-1.5">
          {scanning ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" /> Scanning against policy…
            </>
          ) : ago !== null ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Audit up to date
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
