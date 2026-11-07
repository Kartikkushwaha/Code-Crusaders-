<div align="center">

# 🛡️ PUBLIVRA AI

### Check before you publish.

**An AI co-pilot that checks marketing and business content against your brand policy before it goes live.**

[**🌐 Live demo: publivraai.xyz**](https://publivraai.xyz)

Built by **Team Code Crusaders** for **CODENEXUS INDIA 2026** · Problem statement by **Inkloom AI**

</div>

---

## 💡 The problem

Every brand has rules: words it never uses, claims it can't make, a tone it must keep, and personal data that must never be published. Today those rules sit in a PDF that nobody reads at 6 pm before a campaign goes out.

The result is off-brand messaging, unproven claims ("100% guaranteed!"), exposed customer data and, in many industries, real legal risk.

## ✨ Our solution

PUBLIVRA AI reads **your content** and **your policy** side by side, then tells you, in plain language:

- ✅ **Verified:** backed by your policy or approved sources
- 🟡 **Unverified:** a claim nobody has proven yet
- ❌ **Contradicted:** breaks a rule in your policy

Every problem comes with **what's wrong**, **the exact line of your policy it breaks**, **a one-click fix** and **a recommendation**. Nothing is published without a human signing off.

---

## 🚀 How it works

| Step | What happens |
| --- | --- |
| **1. Add content** | Upload a PDF or text file, or write directly in the built-in editor. |
| **2. Add your policy** | Upload your brand guidelines (PDF or text) or paste them in. No policy? PUBLIVRA uses built-in safety rules. |
| **3. Instant check** | Problems are highlighted as you type: restricted words, personal data, absolute promises, unproven numbers and tone. |
| **4. AI deep audit** | The AI reads your whole policy and explains each issue, citing the exact policy line. |
| **5. Fix** | Apply fixes one by one, fix everything at once, or skip an item with a reason. |
| **6. Publish** | Low/medium risk → "Ready to publish" and a PDF download. High risk → you must type `confirm` to override, and a clear disclaimer is added. |
| **7. Human sign-off** | A final checklist and the approver's name close the project. Everything is saved to the history. |

---

## 🌟 Key features

- **📄 Policy-aware AI.** Your policy is the AI's only source of truth, and every finding links to the policy line it breaks.
- **⚡ Live checks as you type.** Rules picked up from your policy (including tables) apply instantly.
- **🔍 Reads difficult PDFs.** Pages saved as images are read with text recognition (OCR).
- **🚦 Clear risk level.** HIGH, MEDIUM or LOW, with the reasons in plain language.
- **🧰 "Fix these first."** The most common and most serious problems are grouped at the top of the dashboard.
- **🗣️ Tone check.** Measures how well the writing matches the tone your brand requires. Capitals used for emphasis aren't punished.
- **🔐 Privacy guard.** Catches PAN, Aadhaar, phone numbers, emails and API keys before they leak.
- **📜 Full history.** Every audit, publication and sign-off is stored in a cloud database.
- **👤 Human in control.** The AI suggests, people decide. Overrides are always recorded.
- **📱 Works on any device.** Desktop, tablet and phone.

---

## 🧱 Built with

| Part | Technology |
| --- | --- |
| Website | React, Vite, Tailwind CSS (hosted on Vercel) |
| Backend | Python FastAPI (hosted on Render) |
| AI | Groq (GPT-OSS / Qwen) with Google Gemini as a backup, via LangChain |
| Policy search | Qdrant vector search |
| Database | Neon (cloud PostgreSQL) |

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

The backend needs a free [Groq API key](https://console.groq.com/keys) and a [Neon](https://neon.tech) database. Copy `backend/.env.example` to `backend/.env` and fill them in. More detail is in [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md).

---

## 🔭 What's next

- 🖼️ Checking images, logos and visual brand consistency
- 🌐 Support for more languages
- 🔗 Integrations with Google Docs, Notion and CMS platforms
- 👥 Team workspaces with roles and approval chains

---

## 📢 AI disclosure

As the CODENEXUS INDIA 2026 rules require: this project uses **Groq** and **Google Gemini** language models to analyse content, and parts of the code were written with help from AI assistants (Claude). All final decisions in the product are made by a human reviewer.

---

<div align="center">

**Team Code Crusaders** · CODENEXUS INDIA 2026

*Publish with confidence.*

</div>
