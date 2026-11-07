# PUBLIVRA AI - Frontend Dashboard

Evidence-based brand compliance and governance dashboard for **CodeNexus India 2026 (Round 2: The Build)**, Team Code Crusaders.

The live rule engine runs in the browser, so flags appear instantly as you type and the app still works if the backend is offline. **Run AI audit** adds a Gemini audit from the FastAPI backend, based on your approved sources.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
npm run preview    # serve the production bundle
npm run package    # writes ../frontend.zip (source only, no node_modules)
```

Requires Node.js 20.19+ (Vite 7).

## Stack

| Layer | Library |
| --- | --- |
| Build | Vite 7, `@vitejs/plugin-react` |
| UI | React 19, Tailwind CSS 4 (`@tailwindcss/vite`) |
| Icons | `lucide-react` |
| PDF text extraction | `pdfjs-dist` (loaded on demand, text layer only) |
| PDF export | Built-in, dependency-free writer (`src/lib/pdfExport.js`) |

## Workflow

1. **Input**: choose **Upload PDF Content** (drag and drop a `.pdf`, `.tex` or `.txt` file) or **Use Inbuilt Text Editor**. Text is extracted in the browser. Images and graphics are counted but not parsed; that is Round 3 scope.
2. **Live audit**: the AI Compliance Analytics Panel re-scans 450 ms after each edit and flags each claim:
   - 🟢 **VERIFIED**: matches an approved fact or statement (the source is shown).
   - 🟡 **UNVERIFIED**: no approved source exists. This is the default state; a claim is never assumed true.
   - 🔴 **CONTRADICTED**: breaks a policy rule, or an approved source says otherwise.
3. **Persona and tone auditor**: scores tone out of 10 against the tone in your policy. If the policy has no tone, it falls back to the default internal compliance tone (Professional).
4. **Risk banner**: rolls everything up into **HIGH**, **MEDIUM** or **LOW RISK**, with a score out of 100 and the reasons.
5. **Suggestions queue**: work through each flag. You can accept the fix, edit the sentence by hand, or override the flag with a reason that gets logged. **Accept all** applies every safe fix at once.
6. **Publish Verification Engine**:
   - **LOW or MEDIUM**: a "Ready to Publish" prompt appears. Confirming downloads a formatted PDF.
   - **HIGH**: a red safety modal appears. You must type `confirm` by hand (paste is blocked) before the PDF downloads. The PDF then carries the disclaimer *"PUBLIVRA AI will not be held responsible for compliance breaches."* on every page.
7. **Human Verification Required**: a six-item checklist plus the approver's name and role. This closes the project and records the sign-off in the Audit Trail.

## Project structure

```
src/
  App.jsx                     state, workflow orchestration
  main.jsx, index.css         entry + Tailwind theme + Word-style editor styles
  data/
    defaultPolicy.js          global policy checklist, approved facts, tone profiles
    sampleContent.js          demo proposal that triggers every flag type
  lib/
    policyEngine.js           mock audit engine (rules → fact matching → tone → risk)
    editorUtils.js            map sentences to DOM ranges, apply/locate fixes, sanitize
    fileParser.js             PDF (pdf.js), TeX and text extraction
    pdfExport.js              DOM → formatted A4 PDF + audit certificate
    api.js                    FastAPI client (VITE_API_URL) + AI finding mapper
  components/
    Drawer.jsx                slide-out navigation drawer
    TopBar.jsx                top bar with drawer toggle, risk pill, publish
    RichTextEditor.jsx        Word-style ribbon + contentEditable page
    AnalyticsPanel.jsx        live flags, filters, tabs
    AiAuditCard.jsx           Gemini deep-audit control + provenance
    SuggestionsQueue.jsx      accept / edit / override queue
    ToneAuditor.jsx           persona & tone score with fallback notice
    RiskBanner.jsx            HIGH / MEDIUM / LOW banner
    PublishModals.jsx         Ready-to-publish + high-risk "confirm" modal
    HumanVerification.jsx     mandatory sign-off checklist
    StartScreen.jsx           content + policy upload, common-mistakes guide
    PolicyBar.jsx             shows/changes the content and policy being checked
    TopIssues.jsx             grouped 'fix these first' warnings
    AuditTrail.jsx            publications + who/what/when activity log
    Stepper.jsx, ui.jsx       shared UI
scripts/package-zip.mjs       dependency-free archiver for frontend.zip
```

## Content + policy

The start screen takes **your content** and **your policy** together. You don't need a separate policy library.

- **The policy** (a PDF, TXT or MD file, or pasted text) is sent in full to the AI audit, where it's indexed in Qdrant and cited by page.
- **Simple rules** found in the policy are applied live as you type. For example:
  - `Use "A" instead of "B"`
  - `Avoid "x", "y"`
  - `must not exceed 60 days`
  - `Tone must be formal`
- **Without a policy**, the built-in rules still check personal data, absolute promises, unsourced numbers, hype and tone.
- **The policy can also be written or pasted** instead of uploaded, on the start screen or from the **Against** bar in the workspace.
- **To change the policy later**, use the **Against** bar in the workspace.

## Top issues

The dashboard groups every open flag into plain-language problem types: personal data, absolute promises, contradicted figures, timelines, restricted words, unsourced numbers, "best/fastest" claims and tone. They're sorted so that problems which block publishing come first. Each card has **Review**, which opens the matching fixes, and **Fix all**. The start screen shows the same problem types as a "common mistakes" guide.

## Backend connection

The dashboard is linked to the FastAPI backend in `../backend`.

- `src/lib/api.js` reads `VITE_API_URL`. Locally that comes from `.env.development` (`http://localhost:8000`). In production, set it in Vercel's Environment Variables or in `.env.production`.
- The top bar shows the backend's status (online, waking, offline). Render's free tier sleeps, so the first request can take about 50 seconds.
- **Run AI audit**, in the analytics panel, sends the document, the built-in rules and your uploaded policy to `POST /api/audit`. Gemini's findings appear next to the live rule flags with an "AI" tag and can be accepted, edited or overridden in the same way.
- Publishing calls `POST /api/publications`, and the human sign-off calls `POST /api/publications/{id}/verify`. Both are stored in Neon.
- If the backend can't be reached, the app still works on the in-browser rule engine.

## Deploy on Vercel

Use `frontend` as the root directory. Vite is detected automatically (`vercel.json` is included). Add `VITE_API_URL=https://<your-render-service>.onrender.com`.

## AI and external-service disclosure

- The live flags come from an in-browser rule engine. The optional deep audit calls the PUBLIVRA backend, which uses Google Gemini for the audit and for embeddings, and Neon to store records.
- Fonts load from Google Fonts. If they can't load, the app falls back to system fonts.
- Parts of this frontend were written with AI assistance (Claude), as the event rules require us to disclose.
