# CLAUDE.md - Development Guidelines for todo-focusme

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal Todo app running entirely on Cloudflare's edge infrastructure.
Stack: Hono + Cloudflare Pages Functions + D1 (SQLite) + Vanilla JS frontend.

## Architecture

- `src/app.ts` - Hono app with all routes and middleware
- `functions/[[route]].ts` - Pages Functions catch-all entry point
- `public/` - Static HTML/JS frontend (served by Cloudflare Pages)
- `migrations/` - D1 SQL migration files
- `test/` - Unit tests (Vitest + cloudflare vitest pool workers)

## Common Commands

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

## Completion Requirements

Before committing, **must** run `npm run check` and `npm run test:coverage` to execute all checks that CI will run:

```bash
npm run check && npm run test:coverage
```

This runs the following (matching the GitHub Actions pipeline exactly):

1. `typecheck` — TypeScript type check
2. `lint` — ESLint (strictTypeChecked)
3. `format:check` — Prettier formatting
4. `knip` — unused export / dependency detection
5. `test:coverage` — Vitest with 95% coverage threshold

**Do not skip any of these steps.** CI failures on push are caused by missing checks locally.

## プロジェクト基本方針

### 目的

Cloudflare のエッジインフラだけで動く、ほぼ無料の個人用 Todo アプリ。

### 技術方針

- **最小依存**: Hono + Cloudflare Workers Types のみに依存し、軽量で高速な実装を維持
- **エッジファースト**: 全処理を Cloudflare Edge で完結。Node.js API は使用不可
- **テスト品質**: カバレッジ95%以上を維持。D1 はモック、E2E は Playwright でテスト
- **段階的リリース**: 基本 CRUD → アーカイブ → インライン編集 → 通知等を段階的に対応

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
- Coverage: istanbul provider (v8 incompatible with Workers runtime), 95% minimum threshold enforced in CI
- Coverage reports: text (console), lcov, json-summary

## Database

- D1 (SQLite) with migration files in `migrations/`
- Always use parameterized queries (`.bind()`)
- Timestamps in ISO 8601 format

## Deployment

- Push to `main` triggers CI/CD (GitHub Actions)
- CI: typecheck → lint → format check → knip → unit tests with coverage → e2e tests
- CD: D1 migrations → Cloudflare Pages deploy
- Required GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

## TDDサイクル

各機能は以下のサイクルで実装します:

1. **Red**: テストを書く（失敗する）
2. **Green**: 最小限の実装でテストを通す
3. **Refactor**: コードを改善する

## Tidy First? (Kent Beck)

機能変更の前に、まずコードを整理（tidy）するかを検討します:

**原則**:

- **構造的変更と機能的変更を分離する**: tidying は別コミットで行う
- **小さく整理してから変更する**: 大きなリファクタリングより、小さな整理を積み重ねる
- **読みやすさを優先**: 次の開発者（未来の自分を含む）のために整理する

**Tidying パターン**:

1. **Guard Clauses**: ネストを減らすために早期リターンを使う
2. **Dead Code**: 使われていないコードを削除
3. **Normalize Symmetries**: 似た処理は同じ形式で書く
4. **Extract Helper**: 再利用可能な部分を関数に抽出
5. **One Pile**: 散らばった関連コードを一箇所にまとめる
6. **Explaining Comments**: 理解しにくい箇所にコメントを追加
7. **Explaining Variables**: 複雑な式を説明的な変数に分解

**タイミング**:

- 変更対象のコードが読みにくい → Tidy First
- 変更が簡単にできる状態 → そのまま実装
- Tidying のコストが高すぎる → 機能変更後に検討

## イテレーション単位

機能を最小単位に分割し、各イテレーションで1つの機能を完成させます。各イテレーションでコミットを行います。
