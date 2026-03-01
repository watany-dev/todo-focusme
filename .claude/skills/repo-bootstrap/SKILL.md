---
name: repo-bootstrap
description: 新規リポジトリの開発基盤を一括セットアップ。設定ファイル・厳格なガードレール・テスト基盤・CI/CD・開発メソドロジーを構築する。
---

# リポジトリ開発基盤のブートストラップ

新規プロジェクトまたは設定が未整備のリポジトリに対して、開発基盤を体系的にセットアップする。

ultrathink

---

## Phase 1: 現状調査

### Step 1-1: リポジトリの状態を把握

```bash
# 既存ファイルの確認
ls -la
git log --oneline -5

# 既存の設定ファイルを確認
ls package.json tsconfig.json .eslintrc* eslint.config.* .prettierrc* \
   .editorconfig .nvmrc .node-version vitest.config.* playwright.config.* \
   Makefile Dockerfile .github/workflows/*.yml CLAUDE.md 2>/dev/null
```

確認事項:

- README やソースコードから技術スタックを特定する
- パッケージマネージャを特定する（npm / bun / pnpm / yarn）
- ランタイム環境を特定する（Node.js / Bun / Deno / Cloudflare Workers 等）
- デプロイ先を特定する（Cloudflare / Vercel / AWS 等）
- 既存の設定ファイルがあれば内容を読み込む

### Step 1-2: ユーザーへの確認

不明な点があれば以下を確認する:

- 使用するパッケージマネージャ
- ランタイムのバージョン要件
- テストフレームワークの好み
- CI/CD プラットフォーム（GitHub Actions / GitLab CI 等）
- デプロイ方法

---

## Phase 2: 設定ファイルの作成

README やソースコードの仕様に基づき、以下を作成する。**既存の設定は上書きせず、不足分のみ追加する。**

### Step 2-1: プロジェクト基盤

| ファイル                        | 内容                                               |
| ------------------------------- | -------------------------------------------------- |
| `package.json`                  | 依存関係・scripts（既存の場合は scripts を拡充）   |
| `tsconfig.json`                 | TypeScript 設定（ランタイムに合わせた target/lib） |
| `.nvmrc` または `.node-version` | ランタイムバージョンの固定                         |
| `.editorconfig`                 | エディタ設定の統一（indent, charset, eol）         |

ランタイム固有の設定:

- Cloudflare Workers → `wrangler.toml`
- Vercel → `vercel.json`
- Docker → `Dockerfile` + `.dockerignore`

### Step 2-2: scripts の設計

以下のスクリプトを必ず用意する:

```
dev           — ローカル開発サーバー
typecheck     — TypeScript 型チェック
lint          — リンター実行
lint:fix      — リンター自動修正
format        — フォーマッター実行
format:check  — フォーマットチェック
test          — ユニットテスト
test:coverage — カバレッジ付きテスト（閾値強制）
test:e2e      — E2E テスト
knip          — デッドコード検出
check         — 全チェック一括実行
prepare       — Git hooks セットアップ
```

---

## Phase 3: 厳格なガードレールの設定

**妥協しない品質基準を設定する。**

### Step 3-1: ESLint（厳格設定）

- ESLint v9 flat config（`eslint.config.js`）を使用
- `strictTypeChecked` + `stylisticTypeChecked`（型情報を使った最も厳格なルールセット）
- `projectService: true` で型情報を有効化
- 設定ファイル（`*.config.ts/js`）は `disableTypeChecked` で除外

必須ルール:

```
explicit-function-return-type: error    — 戻り値の型を必須に
no-explicit-any: error                  — any 禁止
no-floating-promises: error             — 未処理の Promise 禁止
no-misused-promises: error              — Promise の誤用禁止
strict-boolean-expressions: error       — 暗黙の boolean 変換禁止
switch-exhaustiveness-check: error      — switch の網羅性チェック
consistent-type-imports: error          — import type 強制
no-unused-vars: error                   — 未使用変数禁止（_ プレフィックスは許可）
eqeqeq: error                          — === 必須
no-eval: error                          — eval 禁止
no-console: warn                        — console.log は警告
```

### Step 3-2: TypeScript（厳格設定）

`strict: true` に加え、以下を有効化:

```json
{
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true,
  "forceConsistentCasingInFileNames": true,
  "isolatedModules": true
}
```

### Step 3-3: Prettier

- `.prettierrc` と `.prettierignore` を作成
- lint-staged と連携し、コミット時に自動フォーマット

### Step 3-4: Git Hooks（husky + lint-staged）

- `husky` でプレコミットフックを設定
- `lint-staged` で変更ファイルのみ lint + format
- TS/TSX → eslint --fix + prettier --write
- その他 → prettier --write

---

## Phase 4: テスト基盤の構築

### Step 4-1: ユニットテスト

- ランタイムに適したテストフレームワークを選定
  - Cloudflare Workers → `@cloudflare/vitest-pool-workers`
  - Node.js → `vitest`
  - Bun → `vitest` または `bun test`
- カバレッジ設定（`@vitest/coverage-v8`）
- **閾値: 95%**（statements, branches, functions, lines 全て）
- `passWithNoTests: true` でテストファイルなしでもパスするように

### Step 4-2: E2E テスト

- Web アプリ → Playwright
- CLI → 標準入出力のテスト
- `webServer` でローカルサーバーを自動起動
- テストディレクトリ: `e2e/`

### Step 4-3: デッドコード検出

- `knip` でデッドコード・未使用依存を検出
- `knip.config.ts` でエントリポイントとプロジェクトパターンを設定
- ランタイム固有の依存は `ignoreDependencies` に追加

---

## Phase 5: CI/CD パイプラインの構築

### Step 5-1: CI ワークフロー（PR / push）

```yaml
steps:
  - npm ci（または bun install）
  - npm audit --audit-level=high（脆弱性スキャン）
  - typecheck
  - lint
  - format:check
  - knip（デッドコード検出）
  - test:coverage（95% 閾値強制）
  - test:e2e（E2E テスト）
```

### Step 5-2: CD ワークフロー（main push）

デプロイ先に応じたワークフローを構築:

- Cloudflare → `cloudflare/wrangler-action@v3`
- Vercel → `vercel deploy`
- AWS → 適切なデプロイコマンド

必要な Secrets をドキュメントに記載する。

---

## Phase 6: 開発メソドロジーの導入

### Step 6-1: CLAUDE.md の作成

以下のセクションを含む CLAUDE.md を作成する:

1. **Project Overview** — プロジェクトの概要と技術スタック
2. **Architecture** — ファイル構成と役割
3. **Common Commands** — 開発コマンド一覧
4. **Completion Requirements** — コミット前の必須チェック
5. **Code Conventions** — コーディング規約
6. **Quality Requirements** — 品質要件（カバレッジ閾値、禁止パターン）
7. **Testing** — テスト戦略
8. **Deployment** — デプロイフロー
9. **プロジェクト基本方針** — 目的・技術方針
10. **TDDサイクル** — Red → Green → Refactor
11. **Tidy First? (Kent Beck)** — Tidying パターンとタイミング
12. **イテレーション単位** — 最小単位で分割しコミット

### Step 6-2: .gitignore の更新

ランタイム・フレームワーク固有のエントリを追加:

- カバレッジ出力 (`coverage/`)
- ローカル開発状態（`.wrangler/`, `.vercel/` 等）
- 環境変数ファイル（`.env`, `.dev.vars` 等）
- テスト成果物（`test-results/`, `playwright-report/`）

---

## Phase 7: 検証

### Step 7-1: インストールと動作確認

```bash
npm install                    # 依存のインストール
npm run lint                   # ESLint が通ること
npm run format:check           # Prettier が通ること
npm run knip                   # knip が通ること（ソースコード未作成時はスキップ可）
npm run test -- --run           # Vitest が通ること
```

### Step 7-2: Git Hooks の動作確認

テストコミットで husky + lint-staged が正常に動作することを確認する。

### Step 7-3: 最終チェックリスト

- [ ] `npm install` が成功する
- [ ] `npm run lint` がエラーなく通る
- [ ] `npm run format:check` がエラーなく通る
- [ ] `npm run test -- --run` が通る
- [ ] `git commit` 時に lint-staged が自動実行される
- [ ] CLAUDE.md のコマンド一覧が package.json の scripts と一致する
- [ ] CI ワークフローのステップが `check` スクリプトと一致する
- [ ] .gitignore にランタイム固有のエントリが含まれている

---

## 注意事項

- **既存の設定を上書きしない**: 既にある設定ファイルは内容を確認し、不足分のみ追加する
- **ランタイムに合わせる**: Node.js / Bun / Cloudflare Workers 等でツールチェーンが異なる
- **README の仕様を尊重する**: README に記載された技術スタック・コマンドと矛盾しないこと
- **段階的に構築する**: 基盤 → ガードレール → テスト → CI/CD → メソドロジーの順で構築
- **コミット前に全チェックを通す**: 壊れた状態でコミットしない
