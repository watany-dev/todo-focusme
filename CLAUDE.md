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
npm run test:e2e         # Playwright (e2e tests)
npm run knip             # Dead code / unused dependency detection
npm run check            # Run all checks (typecheck + lint + format + knip)
npm run d1:migrate       # Apply D1 migrations locally
npm run d1:migrate:remote # Apply D1 migrations to production
```

## Code Conventions

- TypeScript strict mode enabled
- Double quotes, semicolons, 2-space indentation (see .prettierrc)
- Cloudflare Workers runtime (no Node.js APIs)
- Use `c.json()` for API responses, always include `{ ok: boolean }`
- Authentication via Cloudflare Zero Trust (JWT in `Cf-Access-Jwt-Assertion` header)
- All API routes under `/api/*` with auth middleware applied

## Type System

- Bindings typed via `Hono<AppEnv>` where AppEnv defines `DB: D1Database`
- Use `@cloudflare/workers-types` for D1, KV, R2 types
- `tsconfig.json` targets ES2022 with WebWorker lib

## Testing

- Unit tests: Vitest with `@cloudflare/vitest-pool-workers` (runs in Workers runtime)
- E2E tests: Playwright against local wrangler dev server
- Test files: `test/**/*.test.ts` (unit), `e2e/**/*.spec.ts` (e2e)

## Database

- D1 (SQLite) with migration files in `migrations/`
- Always use parameterized queries (`.bind()`)
- Timestamps in ISO 8601 format

## Deployment

- Push to `main` triggers CI/CD (GitHub Actions)
- CI: typecheck → lint → format check → knip → unit tests → e2e tests
- CD: D1 migrations → Cloudflare Pages deploy
- Required GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
