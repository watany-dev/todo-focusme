# 設計書: インライン編集 & アーカイブ復元

## 目的

タスク内容の修正手段がない現状を解消し、ユーザーがタスク一覧画面上で直接編集できるようにする。
また、誤ってアーカイブしたタスクを復元できるようにする。

## スコープ

### In

1. **フロントエンド: インライン編集UI** (`public/index.html`)
2. **バックエンド: アーカイブ復元API** (`src/app.ts`)
3. **フロントエンド: 復元ボタン** (`public/archive.html`)
4. **テスト追加** (`test/app.test.ts`)

### Out

- 通知機能、タグ、優先度（フェーズ4以降）
- ドラッグ&ドロップ並び替え
- バッチ操作（複数タスク一括編集）
- モーダルダイアログによる編集（インライン方式を採用）
- 物理削除エンドポイント

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/app.ts` | `PUT /api/archive/:id` 復元エンドポイント追加 |
| `public/index.html` | インライン編集UI（編集ボタン・入力フォーム・保存/キャンセル） |
| `public/archive.html` | 復元ボタン追加、`api()` ヘルパー拡張（PUT対応） |
| `test/app.test.ts` | 復元APIのユニットテスト追加 |

**マイグレーション: 不要** — 既存の `tasks` テーブルスキーマで対応可能。`archived_at` を `NULL` に戻すだけで復元が成立する。

---

## DB設計

### 既存スキーマ（変更なし）

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  due_date TEXT,          -- ISO 8601 or NULL
  content TEXT NOT NULL,
  created_at TEXT NOT NULL, -- ISO 8601
  updated_at TEXT NOT NULL, -- ISO 8601
  archived_at TEXT          -- NULL=アクティブ, ISO 8601=アーカイブ済み
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_arch_due
  ON tasks(user_email, archived_at, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON tasks(user_email, created_at);
```

### 復元操作のSQL

```sql
UPDATE tasks
SET archived_at = NULL, updated_at = ?1
WHERE id = ?2 AND user_email = ?3 AND archived_at IS NOT NULL
```

- `?1`: `nowIso()` で生成した現在時刻（ISO 8601）
- `?2`: パスパラメータ `:id`
- `?3`: JWT から抽出した `userEmail`
- `archived_at IS NOT NULL` 条件により、アクティブなタスクへの誤操作を防止
- `result.meta.changes === 0` で該当なしを判定し 404 を返す（既存パターンと同一）

### インライン編集のSQL（既存・変更なし）

既存の `PATCH /api/tasks/:id` がそのまま利用可能。動的 SET 句構築により `content` / `due_date` を個別・同時に更新可能。

```sql
UPDATE tasks SET content = ?1, updated_at = ?2
WHERE id = ?3 AND user_email = ?4 AND archived_at IS NULL
```

### インデックス活用

- 復元クエリ: `idx_tasks_user_arch_due` が `(user_email, archived_at)` をカバー
- 編集クエリ: 同インデックスが `(user_email, archived_at IS NULL)` をカバー
- 新規インデックス追加は不要

---

## API設計

### 新規: PUT /api/archive/:id — アーカイブ復元

HTTPメソッドに `PUT` を採用する理由: リソース（タスク）の状態を「アーカイブ済み → アクティブ」に変更する冪等操作であり、RESTの `PUT`（リソース状態の置換）に該当する。`PATCH` は部分更新、`POST` は非冪等操作のため不適切。

**認証**: `/api/*` 配下のため `authMiddleware` が自動適用される。

#### リクエスト

```
PUT /api/archive/:id
Headers:
  Cf-Access-Jwt-Assertion: <JWT>   ← Cloudflare Access が自動付与
  Content-Type: application/json    ← 任意（ボディなし）
Body: なし
```

#### レスポンス

| ステータス | ボディ | 条件 |
|-----------|-------|------|
| 200 | `{ "ok": true }` | 復元成功 |
| 401 | `{ "ok": false, "error": "missing access token" }` | JWT なし / 不正 |
| 403 | `{ "ok": false, "error": "forbidden" }` | ALLOWED_EMAIL 不一致 |
| 404 | `{ "ok": false, "error": "task not found" }` | ID不存在 / 未アーカイブ / 別ユーザー |

### 既存: PATCH /api/tasks/:id — タスク更新（インライン編集で使用）

フロントエンドのインライン編集UIから呼び出す既存エンドポイント。変更なし。

#### リクエスト

```
PATCH /api/tasks/:id
Headers:
  Cf-Access-Jwt-Assertion: <JWT>
  Content-Type: application/json
Body: { "content"?: string, "due_date"?: string }
  - content: 空文字不可、省略可
  - due_date: 空文字で NULL クリア、省略可
  - 少なくとも1フィールドは必須
```

#### レスポンス

| ステータス | ボディ | 条件 |
|-----------|-------|------|
| 200 | `{ "ok": true }` | 更新成功 |
| 400 | `{ "ok": false, "error": "content cannot be empty" }` | content が空文字 |
| 400 | `{ "ok": false, "error": "no fields to update" }` | フィールド未指定 |
| 401 | `{ "ok": false, "error": "missing access token" }` | JWT なし / 不正 |
| 403 | `{ "ok": false, "error": "forbidden" }` | ALLOWED_EMAIL 不一致 |
| 404 | `{ "ok": false, "error": "task not found" }` | ID不存在 / アーカイブ済み / 別ユーザー |

---

## 内部アーキテクチャ

### データフロー

#### インライン編集フロー

```
[ユーザー] → 「編集」クリック
  → [index.html JS] 該当 <tr> を入力フォームに差し替え
  → [ユーザー] 値を編集 → 「保存」クリック
  → [index.html JS] PATCH /api/tasks/:id に fetch
  → [authMiddleware] JWT検証 → userEmail 抽出
  → [app.patch] バリデーション → D1 UPDATE → { ok: true }
  → [index.html JS] load() でタスク一覧を再取得・再レンダリング
```

#### アーカイブ復元フロー

```
[ユーザー] → 「復元」クリック
  → [archive.html JS] PUT /api/archive/:id に fetch
  → [authMiddleware] JWT検証 → userEmail 抽出
  → [app.put] D1 UPDATE (archived_at=NULL) → { ok: true }
  → [archive.html JS] load() でアーカイブ一覧を再取得・再レンダリング
```

### ミドルウェアチェーン

```
リクエスト → app.use("/api/*", authMiddleware) → ルートハンドラ → レスポンス
```

新規 `PUT /api/archive/:id` は `/api/*` パターンに合致するため、追加のミドルウェア設定は不要。

### フロントエンド状態管理

`index.html` のインライン編集では、以下の状態をDOM属性で管理する:

```html
<tr data-id="uuid" data-editing="true">  <!-- 編集中の行 -->
  <td><input type="date" class="edit-due" value="2026-03-01" /></td>
  <td><input type="text" class="edit-content" value="牛乳を買う" /></td>
  <td>
    <button data-act="save" data-id="uuid">保存</button>
    <button data-act="cancel" data-id="uuid">キャンセル</button>
  </td>
</tr>
```

- 編集中の行は最大1行（新たに「編集」を押すと、既存の編集行はキャンセル扱い）
- 状態の永続化は不要（ページ遷移・リロードで編集モード解除）

---

## イテレーション1: アーカイブ復元API

### 実装箇所

`src/app.ts` の `GET /api/archive` ルート（L227）の直後に追加。

### 実装コード（想定）

```typescript
/** PUT /api/archive/:id — アーカイブ済みタスクを復元 */
app.put("/api/archive/:id", async (c) => {
  const email = c.get("userEmail");
  const id = c.req.param("id");
  const t = nowIso();

  const result = await c.env.DB.prepare(
    `UPDATE tasks SET archived_at = NULL, updated_at = ?1
     WHERE id = ?2 AND user_email = ?3 AND archived_at IS NOT NULL`,
  )
    .bind(t, id, email)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ ok: false, error: "task not found" }, 404);
  }

  return c.json({ ok: true });
});
```

### テストケース

| # | テスト名 | 操作 | 期待結果 |
|---|---------|------|---------|
| 1 | アーカイブ済みタスクを復元 | POST→DELETE→PUT | 200, `{ ok: true }` |
| 2 | 復元後にタスク一覧に表示 | PUT後にGET /api/tasks | tasks に含まれる |
| 3 | 復元後にアーカイブ一覧から消滅 | PUT後にGET /api/archive | tasks に含まれない |
| 4 | 存在しないIDを指定 | PUT /api/archive/nonexistent | 404 |
| 5 | アクティブなタスクに復元を実行 | POST→PUT（DELETEせず） | 404 |
| 6 | 別ユーザーのタスクは復元不可 | user-A が作成→アーカイブ、user-B が復元 | 404 |

---

## イテレーション2: フロントエンド インライン編集UI

### UX設計

```
通常表示:
┌──────────┬──────────────────────────┬────────────────────────┐
│ 期限     │ 内容                     │ 操作                   │
├──────────┼──────────────────────────┼────────────────────────┤
│ 2026-03-01│ 牛乳を買う              │ [編集] [アーカイブ]     │
│          │ updated: 2026-02-28...   │                        │
└──────────┴──────────────────────────┴────────────────────────┘

編集モード（「編集」クリック後）:
┌──────────────────┬────────────────────────┬────────────────────┐
│ [2026-03-01    ] │ [牛乳を買う          ] │ [保存] [キャンセル] │
└──────────────────┴────────────────────────┴────────────────────┘
```

### 動作フロー

1. **「編集」ボタンクリック** → 該当行が編集モードに切り替わる
   - `due_date` セル → `<input type="date">` に変換
   - `content` セル → `<input type="text">` に変換（`updated_at` 行は非表示）
   - 操作セル → 「保存」「キャンセル」ボタンに変換
   - 既に別の行が編集中の場合、その行は自動キャンセル（`load()` で再描画）
2. **「保存」ボタンクリック** → `PATCH /api/tasks/:id` を呼び出し
   - 成功 → `load()` でタスク一覧を再取得・再レンダリング
   - 失敗 → `setErr()` でエラーメッセージ表示、編集モード維持
   - 保存中は保存ボタンを `disabled` にして二重送信を防止
3. **「キャンセル」ボタンクリック** → `load()` でタスク一覧を再取得（編集前の状態に戻る）

### 制約

- 同時に編集できるのは1行のみ
- 空の content は送信不可（バリデーションエラーを `setErr()` で表示）
- 編集モード中にソート変更やタスク追加を行うと、編集は破棄される（`load()` による再描画）

### 実装方針

- 既存のイベント委譲パターン（`listEl.addEventListener("click", ...)`）を拡張
- `data-act` 属性で操作を識別: `edit` / `save` / `cancel`（既存の `archive` と並列）
- `render()` 関数に編集ボタンを追加（既存のアーカイブボタンの手前に配置）
- 編集モードへの切り替えは DOM 操作で `<tr>` の `innerHTML` を差し替え
- 保存時は `content` / `due_date` の両方を PATCH ボディに含める（変更有無に関わらず）

---

## イテレーション3: アーカイブ画面の復元ボタン

### UX設計

```
┌──────────┬──────────────────────────┬─────────────────┬──────────┐
│ 期限     │ 内容                     │ アーカイブ日時   │ 操作     │
├──────────┼──────────────────────────┼─────────────────┼──────────┤
│ 2026-03-01│ 牛乳を買う              │ 2026-02-28T...  │ [復元]   │
└──────────┴──────────────────────────┴─────────────────┴──────────┘
```

### 動作フロー

1. **「復元」ボタンクリック** → `PUT /api/archive/:id` を呼び出し
2. 成功 → `load()` でアーカイブ一覧を再取得
3. 失敗 → `errEl` にエラーメッセージ表示

### 実装方針

- `archive.html` の `api()` ヘルパーを `index.html` と同等に拡張（`options` 引数を受け取れるようにする）
- テーブルヘッダーに「操作」列を追加
- 各行に復元ボタン `<button data-act="restore" data-id="...">復元</button>` を追加
- イベント委譲で `data-act="restore"` を処理
- 復元中はボタンを `disabled` にして二重送信防止
- レンダリングを `index.html` の `render()` パターンに合わせてリファクタ

---

## エッジケース・異常系

### バックエンド

| ケース | 対処 |
|-------|------|
| 復元対象がアクティブ（未アーカイブ） | `archived_at IS NOT NULL` 条件で弾く → 404 |
| 復元対象が存在しない | `changes === 0` で検知 → 404 |
| 別ユーザーのタスクを復元 | `user_email` 条件で弾く → 404（ID存在の有無を漏洩しない） |
| 同一タスクへの同時復元リクエスト | D1 の行ロックにより1つ目が成功、2つ目は `changes === 0` → 404 |
| PATCH で content が空文字 | 既存バリデーション → 400 |
| PATCH でフィールド未指定 | 既存バリデーション → 400 |

### フロントエンド

| ケース | 対処 |
|-------|------|
| 編集中にネットワークエラー | `catch` でエラーメッセージ表示、編集モード維持。ユーザーが再試行可能 |
| 編集中に別の行の「編集」をクリック | 現在の編集を破棄し、新しい行を編集モードに切り替え |
| 保存中に「保存」を再クリック | `btn.disabled = true` で二重送信防止 |
| 編集中にソート変更 | `load()` で再描画されるため編集は自動キャンセル |
| 編集中にタスク追加 | 同上（`load()` で再描画） |
| 復元中にネットワークエラー | `catch` でエラーメッセージ表示、ボタン再有効化 |
| 非常に長いコンテンツの入力 | `<input type="text">` のブラウザデフォルト制限に委ねる。D1側は TEXT 型で制限なし |

---

## テスト戦略

### ユニットテスト（`test/app.test.ts`）

#### 新規: `describe("PUT /api/archive/:id")`

| # | テスト | 期待 |
|---|-------|------|
| 1 | アーカイブ済みタスクを復元 | 200 |
| 2 | 復元後 GET /api/tasks に表示 | tasks に含まれる |
| 3 | 復元後 GET /api/archive から消滅 | tasks に含まれない |
| 4 | 存在しないID | 404 |
| 5 | アクティブなタスクに実行 | 404 |
| 6 | 別ユーザーのタスクは不可 | 404 |

#### 既存テストへの影響

`PATCH /api/tasks/:id` のテストは変更不要。インライン編集は既存APIを使用するため、バックエンド側の追加テストは不要。

### E2Eテスト（`e2e/`）

今回のスコープでは E2E テストの追加は行わない。理由:
- フロントエンドは Vanilla JS で型チェック対象外のため、ユニットテストでは検証困難
- ただし、E2E テストの追加は今後の改善として検討する

### カバレッジ影響

- 新規エンドポイント（`PUT /api/archive/:id`）の全分岐をテストでカバー
- 既存の95%閾値を維持するため、新規コードのカバレッジ100%を目標とする
- フロントエンド（`public/` 配下）はカバレッジ対象外（Vanilla JS）

---

## セキュリティ考慮

### 認証・認可

- **認証**: `authMiddleware` が `/api/*` に自動適用。Cloudflare Access の JWT を `Cf-Access-Jwt-Assertion` ヘッダーから検証。署名検証は Cloudflare Access 側で完了済み。
- **認可**: 全クエリに `user_email = ?` 条件を含め、他ユーザーのタスクへのアクセスを防止。404 で返すことにより、タスクIDの存在有無を漏洩しない。
- **新規エンドポイント**: `PUT /api/archive/:id` も同一の認証・認可パターンに従う。

### XSS対策

- 既存の `esc()` 関数（`& < > " '` をエスケープ）をインライン編集でも使用
- `<input>` の `value` 属性に値を設定する際は `esc()` でエスケープ（HTMLインジェクション防止）
- `innerHTML` による DOM 構築時は全ユーザー入力を `esc()` 経由で挿入

### SQLインジェクション対策

- 全クエリでパラメータバインディング（`.bind()`）を使用（既存パターン継続）
- 動的SQLは `PATCH` の SET 句構築のみで、カラム名はハードコードされた文字列

### CSRF対策

- Cloudflare Access がリクエストごとに JWT を検証するため、CSRF トークンは不要

---

## 技術選定の根拠

### HTTPメソッド: PUT（復元API）

| 候補 | 判断 | 理由 |
|------|------|------|
| **PUT** | **採用** | アーカイブ状態からアクティブ状態へのリソース状態変更。冪等（2回呼んでも結果同一: 1回目成功→2回目404）|
| PATCH | 不採用 | 部分更新向け。復元は常に `archived_at=NULL` で固定値のため PATCH の意味に合わない |
| POST | 不採用 | 非冪等操作向け。復元は冪等のため不適切 |
| DELETE | 不採用 | 意味的に逆（削除→復元）。混乱を招く |

### UI方式: インライン編集（モーダルでなく）

| 候補 | 判断 | 理由 |
|------|------|------|
| **インライン編集** | **採用** | 編集フィールドが2つ（content, due_date）と少なく、行内で完結可能。コンテキスト切り替えが不要で操作が直感的 |
| モーダルダイアログ | 不採用 | フィールド数が少ないためオーバーキル。外部ライブラリ不要の方針にも反する |
| 専用編集ページ | 不採用 | 最小構成の方針に反する。SPA化が必要になる |

### 保存方針: 全フィールド送信

編集時は変更の有無に関わらず `content` と `due_date` の両方を PATCH ボディに含める。差分検出ロジックを省き、実装をシンプルに保つ。サーバー側は `updated_at` のみ更新コストが発生するが、個人用アプリのため問題ない。

---

## 実装順序

| 順番 | 内容 | コミット単位 | 依存 |
|------|------|-------------|------|
| 1 | `PUT /api/archive/:id` エンドポイント + テスト | 1コミット | なし |
| 2 | `public/index.html` にインライン編集UI追加 | 1コミット | なし（既存 PATCH API を使用） |
| 3 | `public/archive.html` に復元ボタン追加 | 1コミット | イテレーション1（復元API必須） |
| 4 | `npm run check && npm run test:coverage` で最終確認 | — | 全イテレーション |

- イテレーション1と2は相互に依存しないため、順序を入れ替えても問題ない
- イテレーション3はイテレーション1の完了が前提（復元APIが必要）
- 各イテレーションで `npm run check && npm run test:coverage` を通してからコミットする
