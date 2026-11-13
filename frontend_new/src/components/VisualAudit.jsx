import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ImagePlus, LoaderCircle, Palette, Plus, RotateCcw, ScanSearch, Sparkles, Trash2, Type, Upload, X } from "lucide-react";
import { Button, RISK_STYLE, VerdictBadge } from "./ui.jsx";
import { effectiveKit, loadSavedKit, normHex, saveKit } from "../lib/brandKit.js";
import { auditContentLogo, auditImage, fileToDataUrl, loadImage, logoDataUrl } from "../lib/visualAudit.js";
import VideoAudit from "./VideoAudit.jsx";

const MAX_IMAGES = 6;
const GROUPS = [
  { id: "Logo", label: "Logo check", icon: ScanSearch },
  { id: "Brand colours", label: "Brand colours", icon: Palette },
  { id: "Brand name & motto", label: "Brand name & motto (must be identical)", icon: Type },
  { id: "ad", label: "Ad text - AI deep audit", icon: Sparkles },
];

function Swatch({ hex, size = "h-5 w-5" }) {
  return <span className={`inline-block shrink-0 rounded border border-white/20 ${size}`} style={{ background: hex }} title={hex.toUpperCase()} />;
}

function FindingRow({ f }) {
  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={f.verdict} />
        {f.swatch && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Swatch hex={f.swatch} size="h-3.5 w-3.5" />
            {f.expected && (
              <>
                → <Swatch hex={f.expected} size="h-3.5 w-3.5" />
              </>
            )}
          </span>
        )}
        <span className="min-w-0 break-words font-medium text-slate-200">{f.match}</span>
      </div>
      <p className="mt-1.5 break-words text-slate-300">{f.explanation}</p>
      {f.recommendation && <p className="mt-1 break-words text-emerald-300/90">Fix: {f.recommendation}</p>}
      {f.policyQuote && <p className="mt-1 break-words text-[11px] text-slate-500">Policy: “{f.policyQuote}”</p>}
    </li>
  );
}

function ImageResult({ r, onRemove, onReRun, busy }) {
  const [open, setOpen] = useState(true);
  const [showText, setShowText] = useState(false);
  const all = [...r.findings, ...(r.adFindings || [])];
  const bad = all.filter((f) => f.verdict === "CONTRADICTED").length;
  const unv = all.filter((f) => f.verdict === "UNVERIFIED").length;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="flex items-center gap-3 p-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-white">
          <img src={r.thumb} alt="" className="h-full w-full object-contain" />
          {r.logo?.box && r.logo.score >= 0.5 && (
            <span
              className="absolute border-2 border-indigo-500"
              style={{ left: `${r.logo.box.x * 100}%`, top: `${r.logo.box.y * 100}%`, width: `${r.logo.box.w * 100}%`, height: `${r.logo.box.h * 100}%` }}
            />
          )}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-semibold text-slate-100">{r.name}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
            <span className={bad ? "text-rose-300" : ""}>{bad} contradicted</span>
            <span className={unv ? "text-amber-300" : ""}>{unv} unverified</span>
            <span>
              {r.width}×{r.height}
            </span>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={onReRun} disabled={busy} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-40" title="Re-run">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button onClick={onRemove} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300" title="Remove image">
            <Trash2 className="h-4 w-4" />
          </button>
          <button onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800" aria-label="Toggle details">
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-slate-800 p-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            Main colours:
            {r.colours.filter((c) => c.share >= 1).map((c) => (
              <span key={c.hex} className="inline-flex items-center gap-1">
                <Swatch hex={c.hex} size="h-3.5 w-3.5" />
                {c.share}%
              </span>
            ))}
          </div>
          {GROUPS.map((g) => {
            const items = g.id === "ad" ? r.adFindings || [] : r.findings.filter((f) => f.category === g.id);
            if (g.id === "ad" && !r.adText) return null;
            return (
              <div key={g.id}>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <g.icon className="h-3.5 w-3.5" />
                  {g.label}
                </div>
                {g.id === "ad" && r.adStatus === "running" ? (
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> AI deep audit of the ad text…
                  </p>
                ) : items.length ? (
                  <ul className="space-y-1.5">
                    {items.map((f) => (
                      <FindingRow key={f.id} f={f} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">
                    {g.id === "Brand name & motto"
                      ? r.ocrError
                        ? `Text could not be read: ${r.ocrError}`
                        : "Brand name and motto do not appear in this image."
                      : g.id === "ad"
                        ? r.adStatus === "done"
                          ? "No issues found in the ad text."
                          : r.adNote || "No issues found in the ad text."
                        : "Nothing to report."}
                  </p>
                )}
                {g.id === "ad" && r.adNote && (items.length > 0 || r.adStatus === "done") && <p className="mt-1 text-[11px] text-slate-500">{r.adNote}</p>}
              </div>
            );
          })}
          {r.ocrText && (
            <div>
              <button onClick={() => setShowText((s) => !s)} className="text-[11px] text-indigo-300 hover:underline">
                {showText ? "Hide" : "Show"} text read from the image ({r.ocrConfidence}% OCR confidence)
              </button>
              {showText && <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-2 text-[11px] text-slate-300">{r.ocrText}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BrandKit({ kit, saved, setSaved, toast }) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState("");
  const logoInput = useRef(null);
  const set = (patch) => {
    const next = { ...saved, ...patch };
    setSaved(next);
    if (!saveKit(next)) toast("Brand kit is too large to save in this browser. Use a smaller logo.", "danger");
  };
  const onLogo = async (file) => {
    try {
      const img = await loadImage(await fileToDataUrl(file));
      set({ logo: logoDataUrl(img), logoName: file.name });
      toast("Reference logo saved.", "success");
    } catch (e) {
      toast(e.message, "danger");
    }
  };
  const addColour = () => {
    const h = normHex(hex);
    if (!h) return toast("Enter a colour code like #4F46E5.", "danger");
    if (!kit.colors.some((c) => c.hex === h)) set({ colors: [...kit.colors, { hex: h, name: "" }] });
    setHex("");
  };
  const fromPolicy = kit.derived;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left">
        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-700 bg-white">
          {kit.logo ? <img src={kit.logo} alt="Reference logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-4 w-4 text-slate-500" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-100">Brand kit from your policy (colours, brand name, motto)</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
            {kit.logo ? "Reference logo set" : "No reference logo yet"} · {kit.colors.length} colour{kit.colors.length === 1 ? "" : "s"}
            {kit.colors.slice(0, 8).map((c) => (
              <Swatch key={c.hex} hex={c.hex} size="h-3 w-3" />
            ))}
            {kit.brandName && <> · “{kit.brandName}”</>}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-slate-800 p-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Reference logo</div>
            <div className="flex items-center gap-3">
              <div className="grid h-20 w-28 place-items-center overflow-hidden rounded-lg border border-dashed border-slate-700 bg-white">
                {kit.logo ? <img src={kit.logo} alt="Reference logo" className="max-h-full max-w-full object-contain p-1" /> : <span className="text-[11px] text-slate-400">None</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => logoInput.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> {kit.logo ? "Replace" : "Upload logo"}
                </Button>
                {kit.logo && (
                  <button onClick={() => set({ logo: null, logoName: "" })} className="text-left text-[11px] text-slate-400 hover:text-rose-300">
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onLogo(f);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">The approved logo file. Images are checked for it, its proportions and its colour.</p>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Brand colours
              <span className="font-normal normal-case tracking-normal">{fromPolicy.colors.length ? `${fromPolicy.colors.length} found in the policy` : "none found in the policy"}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {kit.colors.map((c) => (
                <span key={c.hex} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 py-0.5 pl-1 pr-1.5 text-[11px] text-slate-300">
                  <Swatch hex={c.hex} size="h-3.5 w-3.5" />
                  {c.hex.toUpperCase()}
                  {c.name && <span className="text-slate-500">{c.name}</span>}
                  <button onClick={() => set({ colors: kit.colors.filter((x) => x.hex !== c.hex) })} aria-label={`Remove ${c.hex}`} className="text-slate-500 hover:text-rose-300">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <input
                value={hex}
                onChange={(e) => setHex(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addColour()}
                placeholder="#4F46E5"
                className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
              />
              <Button size="sm" variant="secondary" onClick={addColour}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Brand name (exact)</span>
            <input
              value={kit.brandName}
              onChange={(e) => set({ brandName: e.target.value })}
              placeholder={fromPolicy.brandName || "e.g. PUBLIVRA AI"}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Motto / tagline (exact)</span>
            <input
              value={kit.motto}
              onChange={(e) => set({ motto: e.target.value })}
              placeholder={fromPolicy.motto || "e.g. Publish with confidence."}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-2">
            <p className="text-[11px] text-slate-500">Colours, brand name and motto are read from the policy automatically. Edit them here if the policy states them differently.</p>
            <button
              onClick={() => {
                const next = { logo: saved.logo, logoName: saved.logoName };
                setSaved(next);
                saveKit(next);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" /> Reset to policy values
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LogoSlot({ title, hint, image, name, tone, onFile, onRemove, emptyLabel, inputLabel }) {
  const input = useRef(null);
  return (
    <div
      className={`flex min-w-0 flex-col rounded-xl border p-3 ${tone}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = [...(e.dataTransfer.files || [])].find((x) => /^image\//.test(x.type));
        if (f) onFile(f);
      }}
    >
      <div className="text-xs font-semibold text-slate-100">{title}</div>
      <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="mt-2 grid h-28 w-full place-items-center overflow-hidden rounded-lg border border-dashed border-slate-600 bg-white hover:border-indigo-400"
        aria-label={inputLabel}
      >
        {image ? (
          <img src={image} alt={title} className="max-h-full max-w-full object-contain p-2" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px] text-slate-500">
            <ImagePlus className="h-5 w-5" /> {emptyLabel}
          </span>
        )}
      </button>
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{name || "No file"}</span>
        <Button size="sm" variant={image ? "secondary" : "primary"} onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" /> {image ? "Replace" : "Upload"}
        </Button>
        {image && (
          <button onClick={onRemove} className="text-[11px] text-slate-400 hover:text-rose-300">
            Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        aria-label={inputLabel}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * Logo check: the reference (approved) logo on the left, the logo used in the content on the right.
 * The content logo is compared with the reference for shape, proportions and colour. Images and
 * videos are also checked against the reference logo.
 */
function LogoCheck({ kit, contentLogo, busy, onReference, onRemoveReference, onContent, onRemoveContent }) {
  const result = contentLogo?.compare;
  const verdicts = contentLogo?.findings || [];
  const worst = verdicts.some((f) => f.verdict === "CONTRADICTED") ? "CONTRADICTED" : verdicts.some((f) => f.verdict === "UNVERIFIED") ? "UNVERIFIED" : "VERIFIED";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <ScanSearch className="h-3.5 w-3.5" /> Logo check
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <LogoSlot
          title="Reference logo (correct)"
          hint="The approved logo file from your brand guidelines."
          image={kit.logo}
          name={kit.logoName}
          tone={kit.logo ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/10"}
          emptyLabel="Upload the approved logo"
          inputLabel="Upload reference logo"
          onFile={onReference}
          onRemove={onRemoveReference}
        />
        <LogoSlot
          title="Logo used in your content (to test)"
          hint="The logo file you put in this ad, post or video."
          image={contentLogo?.thumb}
          name={contentLogo?.fileName}
          tone="border-indigo-500/40 bg-indigo-500/5"
          emptyLabel="Upload the logo to test"
          inputLabel="Upload content logo to test"
          onFile={onContent}
          onRemove={onRemoveContent}
        />
      </div>
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-xs text-indigo-200" aria-live="polite">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Comparing the logos…
        </p>
      )}
      {contentLogo && !busy && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <VerdictBadge verdict={worst} />
            {result ? (
              <span className="text-slate-300">
                Match with the reference: <b className="font-mono text-white">{result.score}%</b> · proportions {result.aspectChange >= 1 ? "+" : ""}
                {Math.round((result.aspectChange - 1) * 100)}%
                {result.refColour && result.testColour ? (
                  <span className="ml-1 inline-flex items-center gap-1">
                    · colour <Swatch hex={result.testColour} size="h-3.5 w-3.5" /> vs <Swatch hex={result.refColour} size="h-3.5 w-3.5" />
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-slate-400">Waiting for the reference logo.</span>
            )}
          </div>
          <ul className="space-y-1.5">
            {verdicts.map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Improvement 1 - images & graphics audit in the Creator panel.
 * images: audit results (lifted to App so they count towards risk and go to the manager).
 */
export default function VisualAudit({
  policyText,
  policyDoc,
  toneProfile,
  company,
  images,
  onImagesChange,
  videos = [],
  onVideosChange = () => {},
  onAuditAdText,
  onOpenRef,
  onEngineOnline,
  graphicsRisk,
  toast,
  log,
}) {
  const [saved, setSaved] = useState(loadSavedKit);
  const kit = useMemo(() => effectiveKit(policyText, saved), [policyText, saved]);
  const setKit = (patch) => {
    const next = { ...saved, ...patch };
    setSaved(next);
    if (!saveKit(next)) toast("Brand kit is too large to save in this browser. Use a smaller logo.", "danger");
  };
  // ---- logo check: reference logo vs the logo used in the content
  const contentLogoFile = useRef(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const contentLogo = images.find((i) => i.kind === "logo") || null;
  const pictures = images.filter((i) => i.kind !== "logo");
  const runContentLogo = async (file, k = kit) => {
    setLogoBusy(true);
    try {
      const entry = await auditContentLogo(file, k);
      const next = [...latest.current.filter((i) => i.kind !== "logo"), entry];
      latest.current = next;
      onImagesChange(next);
      if (entry.compare) log?.(`Logo check of ${file.name}: ${entry.compare.score}% match with the reference logo, ${entry.findings.filter((f) => f.verdict === "CONTRADICTED").length} problem(s)`, "AI");
    } catch (e) {
      toast(`Could not check ${file.name}: ${e.message}`, "danger");
    } finally {
      setLogoBusy(false);
    }
  };
  // a new document clears the results: forget the content logo file too
  useEffect(() => {
    if (!contentLogo && !logoBusy) contentLogoFile.current = null;
  }, [contentLogo, logoBusy]);
  const onContentLogo = (file) => {
    contentLogoFile.current = file;
    runContentLogo(file);
  };
  const onRemoveContentLogo = () => {
    contentLogoFile.current = null;
    const next = latest.current.filter((i) => i.kind !== "logo");
    latest.current = next;
    onImagesChange(next);
  };
  const onReferenceLogo = async (file) => {
    try {
      const img = await loadImage(await fileToDataUrl(file));
      const logo = logoDataUrl(img);
      setKit({ logo, logoName: file.name });
      log?.(`Reference logo set to ${file.name}`);
      // the content logo is re-checked at once; images and videos on request
      if (contentLogoFile.current) runContentLogo(contentLogoFile.current, { ...kit, logo, logoName: file.name });
      toast(pictures.length || videos.length ? "Reference logo saved. Re-run the images and videos to check them against it." : "Reference logo saved.", "success");
    } catch (e) {
      toast(e.message, "danger");
    }
  };
  const files = useRef(new Map());
  const [busy, setBusy] = useState(null); // { name, step }
  const [open, setOpen] = useState(true);
  const input = useRef(null);
  const latest = useRef(images);
  latest.current = images;

  const setImage = (name, patch) => {
    const next = latest.current.map((i) => (i.name === name ? { ...i, ...patch } : i));
    latest.current = next;
    onImagesChange(next);
  };

  const runOne = async (file) => {
    setBusy({ name: file.name, step: "Opening" });
    try {
      const r = await auditImage(file, kit, (step) => setBusy({ name: file.name, step }));
      const entry = { ...r, adFindings: [], adStatus: r.adText.trim().length >= 12 ? "running" : "none", adNote: r.adText.trim() ? "" : "No ad text found in this image." };
      const next = [...latest.current.filter((i) => i.name !== r.name), entry];
      latest.current = next;
      onImagesChange(next);
      log?.(`Visual audit of ${r.name}: ${r.findings.filter((f) => f.verdict === "CONTRADICTED").length} contradicted, ${r.findings.filter((f) => f.verdict === "UNVERIFIED").length} unverified`, "AI");
      if (entry.adStatus === "running") {
        setBusy({ name: file.name, step: "AI deep audit of the ad text" });
        const res = await onAuditAdText(r.adText, r.name, r.findings);
        setImage(r.name, { adFindings: res.findings, adStatus: "done", adNote: res.note || "" });
      } else if (r.adText.trim()) {
        setImage(r.name, { adNote: "Too little ad text for a deep audit." });
      }
    } catch (e) {
      toast(`Could not audit ${file.name}: ${e.message}`, "danger");
    }
  };

  const runAll = async (list) => {
    for (const f of list) await runOne(f);
    setBusy(null);
  };

  const onFiles = (list) => {
    const imgs = [...list].filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
    if (!imgs.length) return toast("Choose PNG, JPG, WEBP or SVG images.", "danger");
    const room = MAX_IMAGES - latest.current.filter((i) => i.kind !== "logo").length;
    const take = imgs.slice(0, Math.max(0, room));
    if (take.length < imgs.length) toast(`Up to ${MAX_IMAGES} images per check.`, "danger");
    take.forEach((f) => files.current.set(f.name, f));
    if (take.length) runAll(take);
  };

  // "Load Sample Ad Video": fill any empty parts of the brand kit with the sample brand, never overwrite yours
  const ensureSampleKit = async () => {
    const patch = {};
    if (!kit.logo) {
      const img = await loadImage("/sample-brand-logo.png");
      patch.logo = logoDataUrl(img);
      patch.logoName = "sample-brand-logo.png";
    }
    if (!kit.brandName) patch.brandName = "PUBLIVRA AI";
    if (!kit.motto) patch.motto = "Publish with confidence.";
    if (!kit.colors.length) patch.colors = [{ hex: "#4f46e5", name: "Indigo" }, { hex: "#eef2ff", name: "Mist" }];
    if (!Object.keys(patch).length) return kit;
    const next = { ...saved, ...patch };
    setSaved(next);
    saveKit(next);
    toast("Sample brand kit added where yours was empty (logo, colours, brand name, motto). Edit it any time.", "success");
    return { ...kit, ...patch };
  };

  const reRunAll = () => {
    if (contentLogoFile.current) runContentLogo(contentLogoFile.current);
    runAll(latest.current.filter((i) => i.kind !== "logo").map((i) => files.current.get(i.name)).filter(Boolean));
  };

  const totals = images.reduce(
    (a, i) => {
      [...i.findings, ...(i.adFindings || [])].forEach((f) => (a[f.verdict] = (a[f.verdict] || 0) + 1));
      return a;
    },
    { CONTRADICTED: 0, UNVERIFIED: 0, VERIFIED: 0 },
  );

  return (
    <>
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60" aria-label="Images and graphics audit">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="rounded-xl bg-indigo-500/15 p-2">
            <ScanSearch className="h-5 w-5 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
              Logo, images & graphics audit
              {graphicsRisk && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${RISK_STYLE[graphicsRisk.level].pill}`} title="Risk score of the logo & graphics checks">
                  Logo & graphics score {graphicsRisk.score}/100
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400">
              {images.length
                ? `${contentLogo ? `logo ${contentLogo.compare ? `${contentLogo.compare.score}% match` : "uploaded"} · ` : ""}${pictures.length} image${pictures.length === 1 ? "" : "s"} · ${totals.CONTRADICTED} contradicted · ${totals.UNVERIFIED} unverified · ${totals.VERIFIED} verified`
                : "Logo, brand colours and text inside images, checked against your policy"}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {images.length > 0 && (
            <Button size="sm" variant="secondary" onClick={reRunAll} disabled={!!busy || logoBusy}>
              <RotateCcw className="h-3.5 w-3.5" /> Re-run
            </Button>
          )}
          <Button size="sm" onClick={() => input.current?.click()} disabled={!!busy || pictures.length >= MAX_IMAGES}>
            <ImagePlus className="h-3.5 w-3.5" /> Add images
          </Button>
          <button onClick={() => setOpen((o) => !o)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800" aria-label="Toggle images audit">
            <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="hidden"
          aria-label="Upload images"
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {open && (
        <div className="space-y-3 border-t border-slate-800 p-4">
          <LogoCheck
            kit={kit}
            contentLogo={contentLogo}
            busy={logoBusy}
            onReference={onReferenceLogo}
            onRemoveReference={() => setKit({ logo: null, logoName: "" })}
            onContent={onContentLogo}
            onRemoveContent={onRemoveContentLogo}
          />
          <BrandKit kit={kit} saved={saved} setSaved={setSaved} toast={toast} />
          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200" aria-live="polite">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {busy.name}: {busy.step}…
            </div>
          )}
          <div className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <ImagePlus className="h-3.5 w-3.5" /> Ads, posters & social graphics
          </div>
          {pictures.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {pictures.map((r) => (
                <ImageResult
                  key={r.name}
                  r={r}
                  busy={!!busy}
                  onReRun={() => {
                    const f = files.current.get(r.name);
                    if (f) runAll([f]);
                    else toast("Upload the image again to re-run it.");
                  }}
                  onRemove={() => {
                    files.current.delete(r.name);
                    const next = latest.current.filter((i) => i.name !== r.name);
                    latest.current = next;
                    onImagesChange(next);
                  }}
                />
              ))}
            </div>
          ) : (
            <button
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
              }}
              className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-xs text-slate-400 hover:border-indigo-500/60 hover:bg-indigo-500/5"
            >
              <Upload className="h-5 w-5 text-slate-500" />
              <span className="font-semibold text-slate-200">Drop ads, posters or social graphics here</span>
              <span>PNG, JPG, WEBP or SVG · up to {MAX_IMAGES} images</span>
            </button>
          )}
        </div>
      )}
    </section>
    <VideoAudit
      kit={kit}
      policyDoc={policyDoc}
      toneProfile={toneProfile}
      company={company}
      videos={videos}
      onVideosChange={onVideosChange}
      ensureSampleKit={ensureSampleKit}
      onOpenRef={onOpenRef}
      onEngineOnline={onEngineOnline}
      toast={toast}
      log={log}
    />
    </>
  );
}
