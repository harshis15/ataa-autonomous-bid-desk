# Ataa v3 — data and storage guide

## What runs where?

The browser displays the project and holds temporary UI state. The Node server owns the database and files. With the default local setup, both run on your laptop. If you move the server, the data belongs to that server's disk. An Azure AI key enables inference, not Azure database storage.

Default durable directory: `runtime/` in the app folder. Set the server-only `ATAA_DATA_DIR` to an absolute directory to keep data separate from app releases.

```dotenv
# Windows example
ATAA_DATA_DIR=C:/Ataa/data
# macOS example: use your actual home directory
# ATAA_DATA_DIR=/Users/yourname/Ataa/data
```

Restart after changing it. An empty path creates a new workspace; changing paths does not move existing data.

## Storage inventory

| Data | Location | Contents / lifecycle |
|---|---|---|
| Current bids | `ataa.sqlite` → `bids` | Project/customer, mode/status, document metadata/text, scope, confirmation, workflow, results, reference selection, approval, audit, active job and provenance |
| Previous saves | `bid_revisions` | Full bid JSON at each meaningful saved change; old scope/outputs remain after edits |
| Audit trail | `audit_events` | Sequence, action, timestamp and detail; appended with the matching revision |
| Agent jobs | `jobs` | Stage statuses, attempts, timing, errors, pinned inputs reference ID and deployment metadata |
| File metadata | `artifacts` | Artifact ID, bid ID, revision, kind, name, MIME type, object key, SHA-256, byte size and creation time |
| Catalog/rule/prompt snapshots | `reference_versions` | Full reference bundle keyed by its hash; old bundles remain available to resumed runs |
| Migration marker | `settings` | One-time legacy import marker |
| Original RFQ bytes and PDF reports | `objects/<first-two-hash-characters>/<sha256>` | Bytes stored outside the database; identical bytes share one object, with separate metadata records |
| SQLite transaction support | `ataa.sqlite-wal`, `ataa.sqlite-shm` | SQLite-managed files while open; never delete them while the app is running |
| Process lock | `server.lock` | Prevents a second local API process/backup from using the same directory concurrently |
| Azure secret/configuration | `.env` outside runtime, or process environment | Not stored in project JSON and not included by the backup command |
| Temporary UI state | Browser memory | Draft form edits, comparison selections and helper messages; unsaved state is lost on refresh |

Reference sources in the distribution: 20 synthetic products, 10 historical projects, 10 service rules; sample RFQ and demo Scope/BOM/Architecture fixtures. Historical records and prices are for demonstration. The repository stores a snapshot of those files and prompts when the server starts. Editing a source file takes effect after restart and creates a new reference version if contents changed. Existing jobs keep their pinned version.

## Main record structures

`bids` has columns `id`, `name`, `status`, `revision`, `updated_at`, `body` (JSON). Its body includes:

```json
{
  "id": "project-uuid",
  "revision": 8,
  "name": "SCADA Modernization",
  "mode": "demo",
  "document": {"name": "rfq.txt", "text": "Extracted text", "sample": true, "artifact_id": "file-uuid"},
  "scope": {},
  "results": {"bom": {}, "priced_bom": [], "architecture": {}, "service_plan": {}, "services": {}},
  "active_job_id": "job-uuid",
  "recovery_pending": false,
  "provenance": {"reference_id": "sha256-reference-bundle", "engine_version": "sha256-code"},
  "approval": null,
  "audit": []
}
```

This is a shortened illustration, not a valid agent schema. Exact model output schemas are in `shared/schemas.js`.

Keys and links:

- `bids.id` is the project UUID.
- `bid_revisions` uses `(bid_id, revision)` as its primary key.
- `audit_events` uses `(bid_id, sequence)`.
- Jobs and artifacts use their own UUIDs and a foreign key to the bid.
- `document.artifact_id` points to an original RFQ artifact.
- `approval.revision` points to the approved revision for new v3 approvals.
- `reference_id` identifies the entire input reference bundle, not a specific product SKU.
- Part numbers and requirement/node/rule IDs are validated inside structured agent JSON.

Project history is read-only through the API; restoring a previous revision into an editable project is not yet implemented. Create a new bid for revisions to an approved proposal.

## RFQ lifecycle

1. Upload PDF, DOCX, TXT or MD, maximum 5 MB.
2. Extract text in server memory. Accept 40 or more non-whitespace characters, maximum 70,000 characters. Scanned PDFs still need OCR before upload.
3. Write original bytes under their SHA-256 object key, using a temporary file followed by rename.
4. Commit file metadata, extracted text, audit and new project revision together in SQLite.
5. Run Scope using extracted text. The original bytes remain available under **Project data**.

Replacing an RFQ or switching Demo/Live clears the active scope/results as before. It does **not** erase earlier revisions or files. That preserves traceability; it is not a data-deletion operation. New sample loads also retain their original sample text file.

File writes and database commits are not one cross-store transaction. A crash after writing bytes but before committing metadata can leave an unreferenced object. No automatic garbage collector is implemented, so such objects may consume disk space. Downloads verify byte count and hash; missing or damaged objects fail rather than returning mismatched files. Backups and filesystem integrity remain necessary.

## Agent data lifecycle

A completed stage atomically stores project output + revision + audit + job checkpoint. Checkpoint recovery skips committed stages. Unfinished runs pause after restart until the user resumes or discards. No model request is automatically repeated on restart. Live resumption requires acknowledgment of possible duplicate billing; exact-once external model execution is not guaranteed.

Per-stage timestamps and attempt counts are retained. Token usage, model cost, full provider response envelopes and actual deployed model versions are not yet collected. The API key is never placed in the job record.

## PDF lifecycle

The existing project-named PDF contains project scope, BOM, plant architecture and connections, service hours, review items, approval and audit. On first download for a revision, the server generates PDF bytes and archives them as an artifact for that revision. Repeated downloads reuse those bytes. Both the download button and stored-file link send a PDF attachment; no print dialog is used.

A PDF is archived **when first requested**, not automatically at approval time. The browser copy can be removed without affecting the server copy. Archiving is separate from the project approval transaction and does not create a new project revision.

## Upgrade from v2

1. Stop the old app.
2. Keep a copy of the entire old `runtime/` folder.
3. Extract the new ZIP into a separate folder; do not overwrite your backup.
4. Either copy the old `runtime/` folder into the new app folder, or set `ATAA_DATA_DIR` to the existing data directory.
5. Install dependencies and start v3 using Node 24.

On first startup with `bids.json` present, all valid legacy bids import in one transaction. A marker prevents a second import. The original JSON file is left unchanged. A duplicate/invalid record fails the import rather than silently dropping a project. Do not edit the marker to force a reimport into a nonempty database.

Imported bids receive an initial revision. Original v2 RFQ bytes, old PDFs that were only downloaded to the browser, previous intermediate revisions and completed in-memory job checkpoints cannot be reconstructed. Their extracted RFQ text, saved output, approval and audit are retained. An interrupted v2 job is unlocked for a fresh run.

If returning to v2, use your untouched old backup. v2 does not read the new SQLite records; later v3 changes will not appear in it.

## Backup

Stop Ataa first (`Ctrl+C`). From the app directory:

```bash
npm run data:backup -- /absolute/path/to/new-backup
```

Windows PowerShell example:

```powershell
npm run data:backup -- C:/Ataa/backups/2026-10-01
```

The destination must not already exist and must be outside the active data directory. The command takes the process lock, checkpoints SQLite, copies the database and object directory together, and writes `backup-manifest.json`. An active server is rejected. A failed command may leave a partial destination; do not treat it as a complete backup.

The backup may contain customer documents, extracted RFQ text, audit and proposal contents. Keep it private. `.env` is not included; preserve Azure configuration separately using an appropriate secret-management method. Keep the matching release ZIP and lockfile.

## Restore

1. Stop the app.
2. Keep the current data directory as a rollback copy.
3. Copy the complete backup into a separate restore directory. Do not merge it into an existing workspace.
4. Set `ATAA_DATA_DIR` to that restored directory and start the same compatible application release.
5. Open a saved project, download an RFQ/report and inspect its approved revision. Hash verification runs on file downloads.

The backup/restore integration test verifies that a retained uploaded RFQ remains byte-identical after restoring into a different directory. Full disaster recovery on a different operating system or machine should be rehearsed for your deployment.

## Retention, access and size

There is no automatic expiry, per-bid deletion or purge endpoint in this release. All files, reference versions, jobs and revisions are retained. To reset the entire workspace, stop the app, back it up, then point `ATAA_DATA_DIR` to a new empty directory. This preserves the old workspace for recovery. Deleting the old directory is a separate deliberate action.

Snapshots duplicate RFQ text and growing audit arrays, so storage grows faster than just original file size. There are no per-user quotas, application-level encryption, tenant boundaries, identity-based authorization or tamper-resistant audit controls. Keep the service bound to `127.0.0.1` for local use. A path override must point to local persistent disk, not a multi-server shared drive.

The process lock is PID-based on one machine. A stale lock normally clears after a crashed process exits. If a PID was reused or the lock is unreadable, stop all Ataa instances, verify no process uses the directory, then remove only `server.lock` and restart. Never remove the lock merely to allow concurrent API processes.

For production, move large originals and immutable outputs to a protected object store, use authenticated tenant/revision keys in a shared database, define retention/deletion policies, introduce distributed job leases and test joint database/object restores. See the phased plan in **ARCHITECTURE.md**.
