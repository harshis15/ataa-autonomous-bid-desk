# Ataa v3 validation

Verified on 1 October 2026 with Node 24.19.0, against the source in this package.

## Passed

- `npm run build`: Vite production bundle generated.
- `npm test`: **14 tests passed**.
  - Existing schemas/reference checks, ranked retrieval, deterministic effort, missing/invalid rules/products and PDF contents.
  - API scope/approval/mode gates and mocked Azure request construction.
  - Transactional legacy import, rollback on duplicate legacy IDs, repeat-import prevention and unchanged original JSON.
  - Optimistic revision conflict rollback, preserved historical snapshots, content integrity verification and local process lock.
  - Abrupt process kill after BOM completion, recovery in the new server process, blocked edits while interrupted, resume without rerunning BOM, final approval and byte-identical archived PDF after restart.
  - Uploaded RFQ original bytes retained after mode change and recovered from a complete offline backup.
  - Interrupted Live run acknowledgment requirement, changed deployment/code rejection, and discard behavior; no Azure call is made in that test.
- **5 headless Chromium checks passed** (the four existing workflows plus the new data screen check):
  1. Architect: scope, all design stages, 11 diagram nodes, 195.8-hour sample, approval and direct project-named PDF download.
  2. Accelerator: top three references, selected baseline, cabinet delta, approval and PDF.
  3. Expert Tool: top five, comparison, lower-ranked selection, approval and PDF.
  4. Mobile overview without horizontal document overflow; explicit unavailable Live AI configuration.
  5. Project files/revisions/run history, original RFQ attachment download and Data & storage screen.
- New storage overview screenshot inspected visually.

## Limits

No user-owned Azure resource or real API key was supplied. Live inference quality, deployment compatibility and actual Azure billing behavior were not tested. The Azure adapter request is mocked in tests; Demo mode exercises the complete local workflow.

This validates local single-process behavior. It does not establish distributed execution, tenant isolation, authenticated approval, production security, engineering suitability, model quality, or resilience to every disk/power/OS failure. No cloud resources were provisioned. No real customer dataset is bundled.

## Reproduce

Use Node 24.x:

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

The browser harness starts a backend on port 3099 with a fresh `runtime/e2e-run-*` data store per invocation. Screenshots remain there; downloaded test PDFs go to `runtime/e2e`. Stop any service already using 3099. Unit/API tests use temporary directories and remove them afterward. To run only the new screen test on macOS/Linux: `ATAA_TEST_FILTER=Storage npm run test:ui`.
