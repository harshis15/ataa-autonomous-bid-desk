# PDF download update

The approved bid's button now says **Download proposal PDF**. It fetches a generated PDF and saves it directly, without opening a print dialog.

The filename is `<project name> - Ataa Proposal.pdf` (characters forbidden in filenames are replaced).

The report includes project/customer details, generation mode, BOM and selection basis, vector plant architecture, component details and connection schedule, service hours/calculations/exclusions, requirements and review items, human approval and audit trail. Historical-reference workflows identify sections that were not generated instead of inventing a design or estimate.

## Upgrade your existing local copy

1. Stop the running app.
2. Extract this ZIP to a separate folder.
3. Copy your existing `.env` and `runtime` folder into the new `ataa-prototype` folder to retain Azure configuration and saved bids. Keep these files local.
4. In the new folder run `npm ci`, then `npm run dev`.
5. Open an approved bid and click **Download proposal PDF**. Existing saved bids are supported.

A new Node dependency (`pdfkit`) generates the PDF on the backend; Python and printer software are not required. The ZIP also includes a rebuilt frontend.
