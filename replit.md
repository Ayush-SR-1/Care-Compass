# CareCompass

A patient-support and hospital-navigation app that helps people find services, prepare for visits, and organize information already present in their documents. It is not a diagnostic tool.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server on the configured port
- `pnpm --filter @workspace/carecompass run dev` — run the CareCompass web app
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API server
- `pnpm --filter @workspace/carecompass run typecheck` — typecheck the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Optional secret: `ANTHROPIC_API_KEY` — enables live Claude requests; without it the navigator returns a clear setup error.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- AI: Claude Messages API, called only from the API server
- CareCompass requests do not use a database; text, documents, and results are processed in memory only.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API request and response contract
- `artifacts/api-server/src/routes/carecompass.ts` — in-memory Claude request handling and response validation
- `artifacts/carecompass/src/App.tsx` and `src/index.css` — CareCompass UI and visual system

## Architecture decisions

- The browser calls the shared API server; Claude credentials stay server-side.
- Patient requests, document contents, and generated plans are never persisted by CareCompass.
- Navigator responses are validated against generated Zod schemas before the API returns them.
- Emergency language is surfaced immediately in the interface, independently of the AI request.

## Product

CareCompass includes a landing page, a patient navigator with document and pasted-text support, a department directory, visit-preparation guidance, FAQs, and contact guidance. Plans organize department suggestions, explicitly stated document details, a visit checklist, a plain-language summary, and questions for a doctor.

## User preferences

- Never diagnose or recommend, stop, or change medicines or doses.
- Do not persist patient data; process it in memory only.

## Gotchas

- If the API contract changes, run `pnpm --filter @workspace/api-spec run codegen` before using updated generated types.
- The live navigator requires `ANTHROPIC_API_KEY` in Replit Secrets; never put it in frontend code.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
