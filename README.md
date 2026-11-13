<div align="center">

# 🛡️ PUBLIVRA AI

### Check before you publish.

**An AI co-pilot that checks text, images and short videos against your brand policy, guides the fixes, and locks publishing behind manager and legal approval.**

[**🌐 Live demo: publivraai.xyz**](https://publivraai.xyz)

Built by **Team Code Crusaders** for **CODENEXUS INDIA 2026** · Round 3 — The Finish · Problem statement by **Inkloom AI**

</div>

---

## 📑 Contents

- [The problem](#-the-problem)
- [Our solution](#-our-solution)
- [How it works](#-how-it-works)
- [Complete feature list](#-complete-feature-list)
- [Roles and approval](#-roles-and-approval)
- [Improvements since Round 2](#-improvements-since-round-2)
- [Architecture](#-architecture)
- [Run it yourself](#%EF%B8%8F-run-it-yourself)
- [Reliability](#-reliability)
- [Known limitations](#-known-limitations)
- [Roadmap](#-roadmap)
- [AI disclosure](#-ai-disclosure)

---

## 💡 The problem

Every brand has rules: words it never uses, claims it can't make, a tone it must keep, a logo that must not be altered, and personal data that must never be published. Today those rules sit in a PDF that nobody reads at 6 pm before a campaign goes out.

The result is off-brand messaging, unproven claims ("100% guaranteed!"), exposed customer data and, in many industries, real legal risk.

## ✨ Our solution

PUBLIVRA AI reads **your content** and **your policy** side by side, then tags every claim:

- ✅ **Verified:** backed by your policy or approved sources
- 🟡 **Unverified:** a claim nobody has proven yet
- ❌ **Contradicted:** breaks a rule in your policy

Every problem comes with **what's wrong**, **the exact policy line it breaks** (page and line number), **a suggested rewrite** and **a recommendation**. Nothing is published without a human signing off.

---

## 🚀 How it works

| Step | What happens |
| --- | --- |
| **1. Add content** | Upload a PDF, TeX or text file, write in the built-in Word-style editor, or upload an image or a short video. |
| **2. Add your policy** | Upload brand guidelines as PDF, TXT or MD, or paste them in. Tables are read row by row, and scanned pages are read with OCR. |
| **3. Instant check** | Problems are highlighted as you type: restricted words, personal data, absolute promises, unproven numbers and tone. |
| **4. AI deep audit** | The AI reads the document against the policy and explains each issue, citing the exact policy line. |
| **5. Fix** | Accept a one-click fix, edit by hand, apply every safe fix at once, or override a flag with a logged reason. |
| **6. Approve** | The creator submits to the manager, who approves, forwards to a legal approver, or rejects with a reason. |
| **7. Publish** | Low or medium risk: confirm and download a PDF with an audit certificate. High risk: type `confirm` by hand, and the PDF carries a disclaimer on every page. |
| **8. Human sign-off** | A six-item checklist with the approver's name and role closes the project. Everything is saved to the history. |

---

## 🌟 Complete feature list

### 📥 Content and policy input

- Upload a PDF, TeX or text file, or write in the built-in Word-style editor.
- Upload a policy as PDF, TXT or MD, or paste it. Tables are read row by row.
- Pages that are pictures of text are read with OCR in the browser.
- The policy is remembered between checks and across page reloads.

### ⚡ Live text checks

These run in the browser, so they keep working even when the backend is offline.

- Re-scans 450 ms after each edit and tags every claim Verified, Unverified or Contradicted.
- Built-in rules catch personal data (PAN, Aadhaar, phone, email), absolute guarantees, unsourced numbers, hype words and tone.
- Simple rules are pulled from the policy automatically: "use A instead of B", banned words, day limits and required tone.
- Tone is scored out of 10 against the policy's tone profile.

### 🧠 AI deep audit (text)

- Sends the document and policy to an LLM: Groq first, Gemini as fallback, skipping retired models automatically.
- Short policies are sent in full; long ones go through Qdrant retrieval.
- Each finding has the problem, the exact policy line (page and line number), a suggested rewrite and a recommendation.
- Citations are checked against the real policy text, and findings not found in the document are dropped.

### 🖼️ Image and graphics audit

- **Logo check:** finds the reference logo and flags missing, altered, stretched or recoloured versions.
- **Brand colours:** compares the image's main colours with the hex codes in the policy.
- **Text in the image (OCR):** brand name and motto must match exactly; the rest goes through the rule checks and AI audit.

### 🎬 Video audit

- Accepts an MP4, MOV or WebM clip up to 20 seconds and 40 MB.
- Checks on-screen text, spoken words, audio and music, colour theme, logo, visuals, tone, personal data and claims.
- Every finding has a timestamp and a green, yellow or red tag, shown on a clickable timeline.
- Contradicted findings link to the policy line; without a real line they are downgraded to Unverified.
- Also returns a summary, a transcript, the text read from the video and the dominant colours.

### 🧰 Fixing issues

- Accept a one-click fix, edit the sentence by hand, or override a flag with a logged reason.
- "Accept all" applies every safe fix at once.
- Top issues are grouped by type and sorted so publish-blocking ones come first.
- A policy viewer shows the policy line by line and jumps to the cited line.

### 🚦 Risk and publishing

- A risk banner shows HIGH, MEDIUM or LOW with a score out of 100 and the reasons.
- Publishing is locked until the content is approved.
- Low or medium risk: a confirmation, then a formatted PDF with an audit certificate downloads.
- High risk: you must type `confirm` by hand, and the PDF carries a disclaimer on every page.
- A six-item human sign-off checklist with approver name and role closes the project.

### 📊 Analytics and history

- Bar charts of average risk for Tone, Logo, Data & Privacy and Others, before and after publication, with the most repeated issues on hover.
- A common graph for everyone and a company-filtered graph for managers.
- History of AI audits, publications and sign-offs, with search and a session activity log.
- Every audit, publication, override and sign-off is logged to Neon.

---

## 👥 Roles and approval

PUBLIVRA AI follows the approval hierarchy real marketing teams use.

| Level | Role | What they do |
| --- | --- | --- |
| 1 | **Creator** | Sends content, fixes, image audit and AI score to the manager. |
| 2 | **Manager** | Approves as manager and legal together, forwards to a separate legal approver, or rejects with a reason. |
| 3 | **Legal Approver** | Accepts or rejects forwarded submissions. |

Editing after approval locks publishing again until the content is re-submitted.

---

## ✅ Improvements since Round 2

The three improvements we committed to at Round 2:

| # | Commitment | What ships now |
| --- | --- | --- |
| 1 | **Logo and graphics checks** | Logo integrity check, brand-colour match against policy hex codes, and OCR audit of text inside images. |
| 2 | **Analytics bar charts** | Average-risk charts by category, before and after publication, with a common view and a company view for managers. |
| 3 | **Multi-level access** | Creator → Manager → Legal Approver chain with reject reasons, re-lock on edit and human sign-off. |

Also added since Round 2:

- Video audit with a timestamped, colour-tagged timeline.
- Neon cloud database, so history is available without a local machine running.
- Groq as the primary LLM with Gemini as automatic fallback.

---

## 🧱 Architecture

| Part | Technology |
| --- | --- |
| Frontend | React, Vite, Tailwind CSS (hosted on Vercel) |
| Backend | Python FastAPI (hosted on Render, sized for the 512 MB free tier) |
| Database | Neon (cloud PostgreSQL) |
| AI | Groq with Google Gemini as fallback, via LangChain |
| Policy search | Qdrant vector search |
| In-browser | Rule engine, OCR and PDF export |

**How an audit flows**

1. The browser runs the rule engine on every edit and extracts simple rules from the policy.
2. For a deep audit, the frontend sends the document and policy to the FastAPI backend.
3. Short policies go to the LLM in full; long ones are retrieved through Qdrant.
4. The backend verifies each citation against the real policy text and drops findings it cannot ground.
5. Results, publications, overrides and sign-offs are logged to Neon.

**Reference policy (publicly available):** Proclinical — [view on Google Drive](https://drive.google.com/file/d/1hQAi_aujf5iD-SEwWpfxyZeBYa28CYXp/view?usp=drive_link)

---

## 🖥️ Run it yourself

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev
```

The backend needs a free [Groq API key](https://console.groq.com/keys) and a [Neon](https://neon.tech) database. A Google Gemini API key enables the fallback model and the video audit. Copy `backend/.env.example` to `backend/.env` and fill them in. More detail is in [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md).

---

## 🛟 Reliability

| Situation | What the product does |
| --- | --- |
| Database is down | Audits still return results. |
| Embeddings fail | The audit falls back to the full policy text. |
| Backend is offline | Live text checks keep running in the browser. |
| Page is refreshed | The policy is remembered. |
| Video is over 20 seconds or 40 MB | The upload is refused. |
| Content is edited after approval | Publishing locks until it is re-submitted. |
| AI cites a line that is not in the policy | The finding is dropped or downgraded to Unverified. |

---

## ⚠️ Known limitations

- Approvals and roles live in one browser, with no logins, so reviewers on other devices do not see submissions and anyone can switch role.
- The backend has no authentication.
- Video results are not attached to the submission sent to the manager.
- Videos longer than 20 seconds are refused.

---

## 🔭 Roadmap

- 🔐 Sign-in for every role, backend authentication and approvals synced across devices
- 🎬 Video findings attached to the manager submission, and support for longer clips
- 🌐 Support for more languages
- 🔗 Integrations with Google Docs, Notion and CMS platforms

---

## 📢 AI disclosure

As the CODENEXUS INDIA 2026 rules require: this project uses **Groq** and **Google Gemini** language models to analyse content, and parts of the code were written with help from AI assistants (Claude). All final decisions in the product are made by a human reviewer.

---

<div align="center">

**Team Code Crusaders** · CODENEXUS INDIA 2026

*Publish with confidence.*

</div>
