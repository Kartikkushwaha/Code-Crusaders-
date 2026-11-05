import { useRef, useState } from "react";
import { FileText, FileUp, ImageOff, LoaderCircle, PenLine, Sparkles, CloudUpload } from "lucide-react";
import { Button } from "./ui.jsx";

/** Split landing: "Upload PDF Content" vs "Use Inbuilt Text Editor". */
export default function InputChooser({ onFile, onStartEditor, onLoadSample, parsing }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <div className="fade-in mx-auto max-w-6xl">
      <div className="mb-8 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-indigo-300">
          <Sparkles className="h-3.5 w-3.5" /> Pre-publication co-pilot
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">What are we auditing today?</h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-400">
          Every claim is checked against your approved guidelines and facts, labelled Verified, Unverified or Contradicted, and explained with its
          source. Nothing is published without a human.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Upload path */}
        <section
          className={`group relative flex flex-col rounded-2xl border-2 border-dashed p-6 transition-all ${
            dragging ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 bg-slate-900/60 hover:border-slate-500"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          aria-label="Upload PDF content"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-500/15 p-2.5">
              <FileUp className="h-6 w-6 text-blue-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Upload PDF Content</h2>
              <p className="text-xs text-slate-400">PDF, TeX or plain text · parsed in your browser</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={parsing}
            className="mt-5 flex flex-1 flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/50 px-6 py-10 text-center transition-colors hover:bg-slate-950/80"
          >
            {parsing ? (
              <>
                <LoaderCircle className="h-10 w-10 animate-spin text-indigo-400" />
                <span className="mt-3 text-sm font-semibold text-slate-200">Extracting text… {parsing.progress}%</span>
                <span className="mt-1 text-xs text-slate-500">{parsing.name}</span>
              </>
            ) : (
              <>
                <CloudUpload className="h-10 w-10 text-slate-500 transition-colors group-hover:text-indigo-400" />
                <span className="mt-3 text-sm font-semibold text-slate-200">Drag & drop a file here</span>
                <span className="mt-1 text-xs text-slate-500">or click to browse · .pdf · .tex · .txt</span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.tex,.txt,.md,application/pdf"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-800/50 px-3 py-2 text-[11px] text-slate-400">
            <ImageOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Text layer only. Images and graphics inside files are skipped — visual consistency parsing arrives in Round 3.
          </div>
        </section>

        {/* Editor path */}
        <section className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-6 transition-all hover:border-slate-600">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-indigo-500/15 p-2.5">
              <PenLine className="h-6 w-6 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Use Inbuilt Text Editor</h2>
              <p className="text-xs text-slate-400">Write or paste copy · audited live as you type</p>
            </div>
          </div>

          <div className="mt-5 flex-1 rounded-xl border border-slate-800 bg-white/95 p-5 text-left text-slate-700 shadow-inner">
            <div className="mb-3 flex gap-1.5 border-b border-slate-200 pb-2">
              {["B", "I", "U", "H1", "H2", "•", "≡"].map((t) => (
                <span key={t} className="rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-bold text-slate-500">
                  {t}
                </span>
              ))}
            </div>
            <div className="h-2.5 w-2/3 rounded bg-slate-300" />
            <div className="mt-3 h-2 w-full rounded bg-slate-200" />
            <div className="mt-1.5 h-2 w-5/6 rounded bg-slate-200" />
            <div className="mt-1.5 flex items-center gap-1">
              <div className="h-2 w-1/3 rounded bg-slate-200" />
              <div className="h-2 w-1/4 rounded bg-rose-300" />
              <div className="h-2 w-1/5 rounded bg-slate-200" />
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <div className="h-2 w-1/4 rounded bg-emerald-300" />
              <div className="h-2 w-1/2 rounded bg-slate-200" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={onStartEditor} className="flex-1">
              <PenLine className="h-4 w-4" /> Open blank editor
            </Button>
            <Button variant="secondary" onClick={onLoadSample} className="flex-1">
              <FileText className="h-4 w-4" /> Load sample proposal
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
