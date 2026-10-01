# Ataa – Autonomous Bid Desk

Ataa is a proof of concept (POC) for an AI-assisted proposal workspace. It turns a Request for Quotation (RFQ) into a reviewed solution baseline, with an engineer in control of the final decision.

## Problem

Preparing industrial proposals involves reading RFQs, identifying requirements, selecting products, estimating service hours and searching past projects. These tasks are often manual and spread across different tools.

Ataa brings these steps into one workspace to demonstrate how AI and reusable project data could support faster, more consistent proposal preparation.

## Architecture

The POC has two ways to run:

| Version | How it works | Data storage |
| --- | --- | --- |
| Hosted Demo | React runs sample workflows and generates downloads in the browser. No backend or API key is needed. | Browser localStorage |
| Local Demo / Live AI | React connects to a Node.js/Express backend. Live AI calls Azure OpenAI. | SQLite for projects, revisions and audit history; local folders for RFQs and PDFs |

Both use synthetic product catalogs, historical projects and service rules. Hosted and local workspaces store data separately.

## Demo

1. Create a bid and load the sample Alpha Energy RFQ.
2. Analyse the RFQ and review the extracted scope.
3. Confirm the scope and choose Architect, Accelerator or Expert Tool.
4. Review the results and record an engineer’s approval.
5. Download the proposal PDF or project JSON snapshot.

The PDF includes available BOM, architecture and service-hour results, plus approval details and the audit trail. Reference-based workflows identify where further engineering is required.

The **Live AI toggle remains visible**. Actual AI calls and custom RFQ uploads are available when running locally with Azure configured.

## Technology

- **Frontend:** React, Vite and React Flow for architecture diagrams.
- **Local backend:** Node.js 24 and Express.
- **AI:** Azure OpenAI with separate prompts for each agent stage.
- **Validation:** JSON schemas and deterministic pricing/service calculations.
- **Storage:** Browser localStorage for the hosted demo; SQLite and local files for local runs.
- **PDF export:** PDFKit.

## Agent workflow

The Scope Agent extracts structured requirements from the RFQ. After human confirmation, the user chooses a path:

| Path | Purpose |
| --- | --- |
| Architect | Runs BOM, Plant Architecture and Service Estimation stages to prepare a new solution baseline. |
| Accelerator | Ranks three historical references for selection as a starting point. |
| Expert Tool | Ranks five historical references for comparison and engineer selection. |

All paths lead to human review and approval. Demo mode uses sample agent outputs. Historical matching uses weighted rules, while prices and service hours are calculated in code.

## How to run locally

Install **Node.js 24.x**. Open a terminal in `ataa-prototype`, the folder containing `package.json`, and run:

```bash
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). This starts the frontend and local backend. Demo mode needs no API key.

To enable Live AI, copy `.env.example` to `.env` and set:

```dotenv
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
ENABLE_LIVE_AI=true
```

Restart `npm run dev`, then switch on **Live AI**. Keep `.env` private and never add a `VITE_` prefix to secrets.

For the hosted demo, build with `npm run build` and deploy `dist`. On Vercel, use the Vite preset, `npm ci` as the install command and the folder containing `package.json` as the root. No environment variables are required. Built versions run the browser demo; use `npm run dev` for local Live AI.

## Limitations

- This is a single-user POC, not a production proposal system.
- Catalogs, prices, service rules and historical projects are synthetic.
- Demo mode supports the bundled scenario; scanned RFQs need OCR before Live AI upload.
- Historical BOMs are retained as references and are not automatically resized.
- Browser data is device/site-specific and is lost if site data is cleared.
- Authentication, enterprise integrations, vector search, GraphRAG and LangGraph are not implemented.

## Future roadmap

- Connect approved CRM, ERP, pricing and product data.
- Add OCR and richer document extraction.
- Explore semantic retrieval, GraphRAG and MCP connectors.
- Add model routing, stronger workflow orchestration and automated evaluations.
- Introduce shared cloud storage, role-based access and authenticated approvals.

## Responsible AI

AI outputs are drafts that require engineering review. Ataa validates structured outputs, highlights open questions and records review decisions in an audit trail. Approval in this POC is self-attested, not a verified digital signature.

Live AI sends RFQ text and relevant solution data to the configured Azure deployment. Use only documents you are authorised to process. Generated proposals must be checked before customer use, especially for pricing, safety and technical compliance.
