# PUBLIVRA AI - Frontend Dashboard

Evidence-based brand compliance and governance dashboard for **CodeNexus India 2026 (Round 2: The Build)**, Team Code Crusaders.

The live rule engine runs in the browser, so flags appear instantly as you type and the app still works if the backend is offline. **Run AI audit** adds an LLM audit (Groq, with Gemini as fallback) from the FastAPI backend, judged against your policy.

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
| PDF text extraction | `pdfjs-dist` (loaded on demand); tables keep their columns (` | `) |
| OCR | `tesseract.js`, only for policy pages whose text is stored as pictures (loaded on demand) |
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
    AiAuditCard.jsx           AI deep-audit control, provenance, out-of-date notice
    SuggestionsQueue.jsx      accept / edit / override queue
    ToneAuditor.jsx           persona & tone score with fallback notice
    RiskBanner.jsx            HIGH / MEDIUM / LOW banner
    PublishModals.jsx         Ready-to-publish + high-risk "confirm" modal
    HumanVerification.jsx     mandatory sign-off checklist
    StartScreen.jsx           content + policy upload, common-mistakes guide
    PolicyBar.jsx             shows/changes the content and policy being checked
    FindingDetails.jsx        Problem → Policy says (line link) → Recommendation
    PolicyViewer.jsx          numbered policy viewer that jumps to a cited line
    TopIssues.jsx             grouped 'fix these first' warnings
    AuditTrail.jsx            History: Neon audits + publications (table on desktop, cards on phones)
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
- **The policy is kept between checks**, and in the browser across reloads. When you start a new check you choose **Use the current policy** or **Upload a new policy**.
- **Your policy is the knowledge base.** When you supply one, the AI judges the content only against it, plus universal safety rules (personal data, absolute guarantees, unsourced numbers, tone). The default PUBLIVRA guidelines are used only when no policy is given.

## AI results stay current

The AI only reports problems found in the text it was sent. Findings that can't be located in the document are dropped. As soon as you edit, the old AI summary and recommendations are hidden, and AI flags on sentences you changed are removed. Re-run the AI audit to check the new version.

## Explanations with policy citations

Every flag is explained in three parts:
- **Problem:** what's wrong and why.
- **Policy says:** the exact line of your policy, with a `p.2 · line 14 ↗` link. The link opens the policy viewer and highlights that line.
- **Recommendation:** what to do about it.

The fix card also shows the **Solution** as a one-click rewrite.

Where the citations come from:
- **Live rule flags** taken from your policy carry their source line from the moment the policy is read.
- **AI findings** cite the numbered policy line they rely on. The backend checks each quote against the real policy text, so a citation is only marked as matched when the quote is really there.
- **Same issue found by both:** the live rule flag keeps its instant fix and gains the AI's citation and recommendation.

**View** in the Against bar opens the whole policy, numbered line by line. Line numbers are computed the same way in `src/lib/policyLines.js` and `backend/policy_index.py`.

## Policies with tables or image pages

- **Tables:** Word tables such as `Restricted Term | Approved Alternative | Reason` are read row by row. Each row becomes a live rule, and plurals ("clients", "deals") are matched too.
- **Image pages:** some Word exports store styled boxes and tables as **pictures of text**. Those pages are rendered and read with OCR in the browser. The policy card says which pages were read this way.
- **OCR download:** the language data is downloaded the first time OCR runs, so it needs internet once.
- **If OCR can't run**, the app tells you which pages to paste in instead.

## Capital letters

Capitals used to highlight a word ("NEW employers") are treated as normal emphasis. Only a sentence written mostly in capitals is flagged as shouting. Single all-caps words are flagged only if your policy explicitly says to avoid capitals or all caps.

## History

The **History** page loads your saved records from Neon:
- **AI audits** (`document_compliance`): audit #, document, date, result, risk, tone, model, source and summary.
- **Publications & sign-offs** (`publications`): record #, document, PDF, date, risk, score, release type, linked audit, sign-off status, approver and sign-off date.

It also shows totals, a search box, publications still waiting for sign-off, and this session's activity log. Tables become cards on phones.

## Top issues

The dashboard groups every open flag into plain-language problem types: personal data, absolute promises, contradicted figures, timelines, restricted words, unsourced numbers, "best/fastest" claims and tone. They're sorted so that problems which block publishing come first. Each card has **Review**, which opens the matching fixes, and **Fix all**. The start screen shows the same problem types as a "common mistakes" guide.

## Backend connection

The dashboard is linked to the FastAPI backend in `../backend`.

- `src/lib/api.js` reads `VITE_API_URL`. Locally that comes from `.env.development` (`http://localhost:8000`). In production, set it in Vercel's Environment Variables or in `.env.production`.
- The top bar shows the backend's status (online, waking, offline). Render's free tier sleeps, so the first request can take about 50 seconds.
- **Run AI audit**, in the analytics panel, sends the document, the built-in rules and your uploaded policy to `POST /api/audit`. The AI's findings appear next to the live rule flags with an "AI" tag and can be accepted, edited or overridden in the same way.
- Publishing calls `POST /api/publications`, and the human sign-off calls `POST /api/publications/{id}/verify`. Both are stored in Neon.
- If the backend can't be reached, the app still works on the in-browser rule engine.

## Deploy on Vercel

Use `frontend` as the root directory. Vite is detected automatically (`vercel.json` is included). Add `VITE_API_URL=https://<your-render-service>.onrender.com`.

## AI and external-service disclosure

- The live flags come from an in-browser rule engine. The optional deep audit calls the PUBLIVRA backend, which uses Groq (with Google Gemini as a fallback) for the audit, Gemini for embeddings, and Neon to store records.
- Fonts load from Google Fonts. If they can't load, the app falls back to system fonts.
- Parts of this frontend were written with AI assistance (Claude), as the event rules require us to disclose.

## Round 3

**Enterprise sign-in.** Step 1: parent company (e.g. *Publivra Corp* → `@publivra.com`). Step 2: pick a role
(Creator, Manager or Legal Approver) and sign in with a company ID ending in that domain - or use **Autofill demo ID**.
The top bar shows the company, ID and role badge; **Switch account** / **Logout** are in the account menu.
Each company only sees its own submissions. The creator's open document stays in place while you switch roles.
(Demo sign-in: no password; data is kept in the browser.)

- **Creator panel** - check text, PDFs and images. Publishing stays **locked** until the content is approved.
  "Send to Manager" sends the content, the fixes applied, the visual audit and the AI score.
  Rejections show the reason and the required improvements; approval shows "Ready to Publish" and unlocks
  Publish & sign-off. Editing after approval locks publishing again until it is re-submitted.
- **Manager panel** - approval requests with the full content, open issues, fixes, visual audit and history.
  Approve as **Manager + Legal** (tick both boxes), **forward** to a separate legal approver, or **reject** with a reason.
  Insights shows the **Common graph** and the manager-only **Company graph**.
- **Legal approver panel** - submissions forwarded by the manager: accept (unlocks publishing) or reject with a reason.
- **History & sign-off** - every submission's (1) AI audit and (2) approvals, publication and sign-off, with a full timeline.

**Images & graphics audit (Creator panel).** Add ads, posters or social graphics:
- *Logo check* - finds the reference logo from the brand kit; flags missing, altered, stretched or recoloured logos.
- *Brand colours* - main colours must match the policy colours (hex codes are read from the policy automatically).
- *Text inside the image* (OCR) - brand name and motto must be 100% identical to the policy; the rest of the ad text
  goes through the rule checks and the AI deep audit (Contradicted / Unverified / Verified).
Image findings count towards the risk score, go to the manager, and feed the **Logo** bars in Insights.

**Upload Video (Creator panel).** Upload an MP4 / MOV / WEBM or click **Load Sample Ad Video**. Frames are sampled
across the whole video and each is checked for the brand watermark (logo), brand colours and on-screen captions
(brand name & motto must be identical; other captions go to the AI deep audit). Every finding has a timestamp -
click it to jump the player there. Spoken voiceover is not transcribed yet, so it is flagged for a reviewer.
Video findings count towards the risk score and are sent to the Manager / Legal approver.

**Insights** - the same dashboard (Common graph + Company graph, repeated-issues popups) in all three panels.

> Note: approvals are stored in the browser for this demo, so all roles must use the same browser.
> A shared database table and logins are needed for reviewers on different devices.
