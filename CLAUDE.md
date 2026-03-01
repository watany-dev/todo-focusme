# CLAUDE.md - Development Guidelines for todo-focusme

## Project Overview

Personal Todo app running entirely on Cloudflare's edge infrastructure.
Stack: Hono + Cloudflare Pages Functions + D1 (SQLite) + Vanilla JS frontend.

## Architecture

- `src/app.ts` - Hono app with all routes and middleware
- `functions/[[route]].ts` - Pages Functions catch-all entry point
- `public/` - Static HTML/JS frontend (served by Cloudflare Pages)
- `migrations/` - D1 SQL migration files

## Development Commands

```bash
npm run dev              # Local development server (http://localhost:8788)
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint
npm run lint:fix         # ESLint with auto-fix
npm run format           # Prettier format
npm run format:check     # Prettier check
npm run test             # Vitest (unit tests)
npm run test:coverage    # Vitest with coverage (95% threshold enforced)
npm run test:e2e         # Playwright (e2e tests)
npm run knip             # Dead code / unused dependency detection
npm run check            # Run all checks (typecheck + lint + format + knip)
npm run d1:migrate       # Apply D1 migrations locally
npm run d1:migrate:remote # Apply D1 migrations to production
```

## Code Conventions

- TypeScript strict mode with additional strict options (noUncheckedIndexedAccess, exactOptionalPropertyTypes, etc.)
- ESLint: strictTypeChecked + stylisticTypeChecked (type-aware linting)
- All functions must have explicit return types (`@typescript-eslint/explicit-function-return-type`)
- Use `type` imports for type-only imports (`import type { ... }`)
- Double quotes, semicolons, 2-space indentation (see .prettierrc)
- Cloudflare Workers runtime (no Node.js APIs)
- Use `c.json()` for API responses, always include `{ ok: boolean }`
- Authentication via Cloudflare Zero Trust (JWT in `Cf-Access-Jwt-Assertion` header)
- All API routes under `/api/*` with auth middleware applied

## Quality Requirements

- **Coverage minimum: 95%** (statements, branches, functions, lines)
- All PRs must pass: typecheck, lint, format check, knip, unit tests with coverage
- No `any` types allowed (`@typescript-eslint/no-explicit-any: error`)
- No floating promises (`@typescript-eslint/no-floating-promises: error`)
- Strict boolean expressions required (`@typescript-eslint/strict-boolean-expressions: error`)

## Type System

- Bindings typed via `Hono<AppEnv>` where AppEnv defines `DB: D1Database`
- Use `@cloudflare/workers-types` for D1, KV, R2 types
- `tsconfig.json` targets ES2022 with WebWorker lib

## Testing

- Unit tests: Vitest with `@cloudflare/vitest-pool-workers` (runs in Workers runtime)
- E2E tests: Playwright against local wrangler dev server
- Test files: `test/**/*.test.ts` (unit), `e2e/**/*.spec.ts` (e2e)
- Coverage: v8 provider, 95% minimum threshold enforced in CI
- Coverage reports: text (console), lcov, json-summary

## Database

- D1 (SQLite) with migration files in `migrations/`
- Always use parameterized queries (`.bind()`)
- Timestamps in ISO 8601 format

## Deployment

- Push to `main` triggers CI/CD (GitHub Actions)
- CI: typecheck → lint → format check → knip → unit tests → e2e tests
- CD: D1 migrations → Cloudflare Pages deploy
- Required GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
