# todo-focusme

Cloudflare だけで動く個人用 Todo アプリ。ほぼ無料・認証あり・高速・軽量・CRUD・アーカイブ対応。

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│  Cloudflare Edge                                │
│                                                 │
│  ┌───────────────────┐   ┌───────────────────┐  │
│  │  Zero Trust Access│   │  WAF / Rate Limit │  │
│  │  (認証・ログイン強制) │   │  (ボット対策)      │  │
│  └────────┬──────────┘   └───────────────────┘  │
│           ▼                                     │
│  ┌────────────────────────────────────────────┐ │
│  │  Cloudflare Pages                          │ │
│  │                                            │ │
│  │  public/          Hono (Functions)         │ │
│  │  ├─ index.html    ├─ GET  /api/health     │ │
│  │  └─ archive.html  ├─ GET  /api/tasks      │ │
│  │    (静的配信)      ├─ POST /api/tasks      │ │
│  │                   ├─ PATCH /api/tasks/:id │ │
│  │                   ├─ DELETE /api/tasks/:id │ │
│  │                   └─ GET  /api/archive     │ │
│  └──────────────────────┬─────────────────────┘ │
│                         ▼                       │
│  ┌────────────────────────────────────────────┐ │
│  │  Cloudflare D1 (SQLite)                    │ │
│  │  tasks テーブル                              │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

| レイヤー | 技術                                       | 役割                                             |
| -------- | ------------------------------------------ | ------------------------------------------------ |
| フロント | Cloudflare Pages（静的 HTML / Vanilla JS） | タスク一覧・登録・アーカイブ UI                  |
| API      | **Hono** on Cloudflare Pages Functions     | RESTful CRUD + 認可                              |
| DB       | Cloudflare D1（SQLite）                    | タスク永続化                                     |
| 認証     | Cloudflare Zero Trust Access               | 前段でログイン強制                               |
| 認可     | Hono ミドルウェア                          | Access JWT の email を検証し許可メール以外を拒否 |

Pages と API が同一プロジェクト内でエッジ配信されるため体感が速い。D1 の無料枠は小規模個人 Todo なら十分。Access も無料プランで個人用途ならコストゼロ。

### なぜ Hono？

元の構成（素の Pages Functions）ではファイルごとに認証コードを重複して書く必要があった。Hono を使うことで：

- **ミドルウェアで認証を一元化** — JWT パース + メール検証を 1 箇所に集約
- **プログラマティックルーティング** — 全ルートが 1 ファイルで見通せる
- **型安全な環境バインディング** — `Hono<{ Bindings }>` で D1 の型が効く
- **RESTful パスパラメータ** — `?id=xxx` ではなく `/api/tasks/:id`
- **ヘルパー関数** — `c.json()` 等でレスポンス生成が簡潔

## ディレクトリ構成

```
todo-focusme/
├── functions/
│   └── [[route]].ts        # Hono catch-all エントリポイント
├── src/
│   └── app.ts              # Hono アプリ本体（ルート + ミドルウェア）
├── public/
│   ├── index.html           # タスク一覧 UI
│   └── archive.html         # アーカイブ一覧 UI
├── test/
│   ├── app.test.ts          # Vitest ユニットテスト
│   └── env.d.ts             # cloudflare:test 型定義
├── migrations/
│   └── 0001_init.sql        # D1 スキーマ
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

> `functions/[[route]].ts` は Cloudflare Pages の catch-all ルートで、すべてのリクエストを Hono に委譲する。ビルドステップ不要で最もシンプル。

## セットアップ

### 前提条件

- Node.js 18+
- Cloudflare アカウント
- wrangler CLI（`npm install -g wrangler` でインストール済み）

### 1. 依存インストール

```bash
npm install
```

### 2. D1 データベース作成

```bash
npm run d1:create
```

出力される `database_id` を `wrangler.toml` に貼る。

### 3. マイグレーション適用

```bash
# ローカル
npm run d1:migrate

# 本番
npm run d1:migrate:remote
```

### 4. ローカル開発

```bash
npm run dev
```

`http://localhost:8788` でアクセスできる。

> ローカル開発では Access JWT がないため、`ALLOWED_EMAIL` 環境変数を未設定にすることで認証チェックをスキップできる。

## 設定ファイル

### wrangler.toml

```toml
name = "todo-focusme"
compatibility_date = "2026-02-28"

pages_build_output_dir = "./public"

[[d1_databases]]
binding = "DB"
database_name = "todo_db"
database_id = "REPLACE_WITH_YOUR_D1_ID"
```

### package.json

```json
{
  "name": "todo-focusme",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler pages dev ./public --d1 DB=todo_db --persist",
    "deploy": "wrangler pages deploy ./public",
    "d1:create": "wrangler d1 create todo_db",
    "d1:migrate": "wrangler d1 migrations apply todo_db --local",
    "d1:migrate:remote": "wrangler d1 migrations apply todo_db --remote",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "knip": "knip",
    "check": "npm run typecheck && npm run lint && npm run format:check && npm run knip",
    "prepare": "husky"
  },
  "dependencies": {
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.12.18",
    "@cloudflare/workers-types": "^4.20260305.0",
    "@vitest/coverage-istanbul": "^3.2.4",
    "eslint": "^9.21.0",
    "typescript": "^5.5.4",
    "vitest": "^3.0.0",
    "wrangler": "^4.69.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "WebWorker"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "functions/**/*.ts", "test/**/*.ts", "e2e/**/*.ts"]
}
```

## データ設計

タスクの要件を満たす最小構成。期日（`due_date`）、本文（`content`）、アーカイブ（`archived_at`）を持つ。将来のマルチユーザー拡張に備えて `user_email` を保存する。

### migrations/0001_init.sql

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  due_date TEXT,              -- ISO8601: '2026-02-28' or '2026-02-28T09:00:00+09:00'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT            -- NULLなら現役、値が入っていたらアーカイブ
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_arch_due
  ON tasks(user_email, archived_at, due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON tasks(user_email, created_at);
```

## API 実装

### functions/[[route]].ts — エントリポイント

Pages Functions の catch-all ハンドラ。Hono アプリを import して `handle` で接続する。

```typescript
import { handle } from "hono/cloudflare-pages";
import { app } from "../src/app";

export const onRequest = handle(app);
```

### src/app.ts — Hono アプリ本体

```typescript
import { Hono } from "hono";
import type { Context, Next } from "hono";

// ── 型定義 ──────────────────────────────────────────

interface AppEnv {
  Bindings: {
    DB: D1Database;
    ALLOWED_EMAIL?: string;
  };
  Variables: {
    userEmail: string;
  };
}

const app = new Hono<AppEnv>();

// ── ヘルパー ────────────────────────────────────────

/** JWT のペイロード部をデコード（署名検証は Access 側に任せる） */
function parseJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  // parts[1] is guaranteed to exist since we checked length === 3
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  try {
    return JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Access JWT からメールアドレスを取り出す */
function extractEmail(request: Request): string | null {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (jwt === null || jwt === "") return null;
  const payload = parseJwtPayload(jwt);
  if (payload === null) return null;

  const candidates = [payload.email, payload.user_email, payload.upn, payload.preferred_username];
  const email = candidates.find((v): v is string => typeof v === "string");
  return email ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** UUID v4 互換の ID 生成（外部依存なし） */
function newId(): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  // Uint8Array(16) guarantees indices 6 and 8 exist
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  a[6] = (a[6]! & 0x0f) | 0x40;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  a[8] = (a[8]! & 0x3f) | 0x80;
  const hex = [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

// ── リクエストボディパーサー ─────────────────────────

function parseBodyField(bodyObj: Record<string, unknown>, key: string): string | null {
  const val = bodyObj[key];
  return typeof val === "string" ? val.trim() : null;
}

// ── 認証ミドルウェア（/api 配下に適用） ────────────

const authMiddleware = async (c: Context<AppEnv>, next: Next): Promise<Response | undefined> => {
  const allowedEmail = c.env.ALLOWED_EMAIL ?? "";
  const email = extractEmail(c.req.raw);

  if (email === null) {
    return c.json({ ok: false, error: "missing access token" }, 401);
  }

  if (allowedEmail !== "" && email !== allowedEmail) {
    return c.json({ ok: false, error: "forbidden" }, 403);
  }

  c.set("userEmail", email);
  await next();
  return undefined;
};

app.use("/api/*", authMiddleware);

// ── ヘルスチェック ──────────────────────────────────

app.get("/api/health", (c) => {
  return c.json({ ok: true, status: "healthy" });
});

// ── タスク CRUD ─────────────────────────────────────

/** GET /api/tasks — タスク一覧（ソート対応） */
app.get("/api/tasks", async (c) => {
  const email = c.get("userEmail");
  const sort = c.req.query("sort");

  let orderBy = "created_at DESC";
  if (sort === "due_asc") orderBy = "due_date IS NULL, due_date ASC, created_at DESC";
  if (sort === "due_desc") orderBy = "due_date IS NULL, due_date DESC, created_at DESC";

  const stmt = c.env.DB.prepare(
    `SELECT id, due_date, content, created_at, updated_at
     FROM tasks
     WHERE user_email = ?1 AND archived_at IS NULL
     ORDER BY ${orderBy}
     LIMIT 500`,
  ).bind(email);

  const res = await stmt.all();
  return c.json({ ok: true, tasks: res.results });
});

/** POST /api/tasks — タスク作成 */
app.post("/api/tasks", async (c) => {
  const email = c.get("userEmail");
  const body: unknown = await c.req.json().catch(() => null);

  const bodyObj =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const content = parseBodyField(bodyObj, "content") ?? "";
  const dueDate = parseBodyField(bodyObj, "due_date") ?? "";

  if (content === "") {
    return c.json({ ok: false, error: "content is required" }, 400);
  }

  const id = newId();
  const t = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO tasks (id, user_email, due_date, content, created_at, updated_at, archived_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)`,
  )
    .bind(id, email, dueDate === "" ? null : dueDate, content, t, t)
    .run();

  return c.json({ ok: true, id }, 201);
});

/** PATCH /api/tasks/:id — タスク更新 */
app.patch("/api/tasks/:id", async (c) => {
  const email = c.get("userEmail");
  const id = c.req.param("id");
  const body: unknown = await c.req.json().catch(() => null);

  const bodyObj =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const content = parseBodyField(bodyObj, "content");
  const dueDate = parseBodyField(bodyObj, "due_date");

  if (content !== null && content === "") {
    return c.json({ ok: false, error: "content cannot be empty" }, 400);
  }

  const t = nowIso();
  const sets: string[] = [];
  const binds: unknown[] = [];
  let idx = 1;

  if (content !== null) {
    sets.push(`content = ?${String(idx++)}`);
    binds.push(content);
  }
  if (dueDate !== null) {
    sets.push(`due_date = ?${String(idx++)}`);
    binds.push(dueDate === "" ? null : dueDate);
  }

  if (sets.length === 0) {
    return c.json({ ok: false, error: "no fields to update" }, 400);
  }

  sets.push(`updated_at = ?${String(idx++)}`);
  binds.push(t);

  const sql = `UPDATE tasks SET ${sets.join(", ")}
     WHERE id = ?${String(idx++)} AND user_email = ?${String(idx++)} AND archived_at IS NULL`;

  binds.push(id, email);

  const result = await c.env.DB.prepare(sql)
    .bind(...binds)
    .run();
  if (result.meta.changes === 0) {
    return c.json({ ok: false, error: "task not found" }, 404);
  }

  return c.json({ ok: true });
});

/** DELETE /api/tasks/:id — アーカイブ（論理削除） */
app.delete("/api/tasks/:id", async (c) => {
  const email = c.get("userEmail");
  const id = c.req.param("id");
  const t = nowIso();

  const result = await c.env.DB.prepare(
    `UPDATE tasks SET archived_at = ?1, updated_at = ?2
     WHERE id = ?3 AND user_email = ?4 AND archived_at IS NULL`,
  )
    .bind(t, t, id, email)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ ok: false, error: "task not found" }, 404);
  }

  return c.json({ ok: true });
});

// ── アーカイブ一覧 ──────────────────────────────────

/** GET /api/archive — アーカイブ済みタスク一覧 */
app.get("/api/archive", async (c) => {
  const email = c.get("userEmail");

  const stmt = c.env.DB.prepare(
    `SELECT id, due_date, content, created_at, updated_at, archived_at
     FROM tasks
     WHERE user_email = ?1 AND archived_at IS NOT NULL
     ORDER BY archived_at DESC
     LIMIT 1000`,
  ).bind(email);

  const res = await stmt.all();
  return c.json({ ok: true, tasks: res.results });
});

export { app };
export type { AppEnv };
```

### 元の構成との比較

| 項目           | 元（素の Pages Functions）                               | Hono 版                                    |
| -------------- | -------------------------------------------------------- | ------------------------------------------ |
| ルーティング   | ファイルベース（`functions/api/tasks.ts`, `archive.ts`） | プログラマティック（1 ファイルに集約）     |
| 認証コード     | 各ファイルに重複して記述                                 | ミドルウェアで 1 箇所に集約                |
| ID 受け渡し    | クエリパラメータ `?id=xxx`                               | パスパラメータ `/api/tasks/:id`（RESTful） |
| レスポンス生成 | `new Response(JSON.stringify(...))` を手動構築           | `c.json()` ヘルパー                        |
| 型安全性       | `Env` を各ファイルで定義                                 | `Hono<AppEnv>` で一括管理                  |
| ファイル数     | 2 ファイル + 重複コード                                  | 1 ファイル（+ 薄いエントリポイント）       |

## フロントエンド

### public/index.html — タスク一覧

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Todo</title>
    <style>
      :root {
        font-family:
          system-ui,
          -apple-system,
          Segoe UI,
          Roboto,
          sans-serif;
      }
      body {
        margin: 16px;
        max-width: 900px;
      }
      h1 {
        font-size: 20px;
        margin: 0 0 12px;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      input[type="date"] {
        padding: 8px;
      }
      input[type="text"] {
        padding: 8px;
        min-width: 280px;
        flex: 1;
      }
      button,
      select,
      a.btn {
        padding: 8px 10px;
        border: 1px solid #ccc;
        background: #fff;
        cursor: pointer;
        border-radius: 8px;
        text-decoration: none;
        color: inherit;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
      }
      th,
      td {
        border-bottom: 1px solid #eee;
        padding: 10px 6px;
        vertical-align: top;
      }
      th {
        text-align: left;
        font-weight: 600;
      }
      td.due {
        width: 140px;
        white-space: nowrap;
      }
      td.actions {
        width: 140px;
      }
      .muted {
        color: #666;
        font-size: 12px;
      }
      .error {
        color: #b00020;
        margin-top: 8px;
      }
    </style>
  </head>
  <body>
    <h1>Todo</h1>

    <div class="row">
      <label class="muted">ソート</label>
      <select id="sort">
        <option value="due_asc">期日 昇順</option>
        <option value="due_desc">期日 降順</option>
        <option value="created_desc">作成日 新しい順</option>
      </select>
      <a class="btn" href="/archive.html">アーカイブを見る</a>
    </div>

    <div style="height: 10px;"></div>

    <div class="row">
      <input id="due" type="date" />
      <input id="content" type="text" placeholder="タスク内容" />
      <button id="add">追加</button>
    </div>

    <div id="msg" class="muted"></div>
    <div id="err" class="error"></div>

    <table>
      <thead>
        <tr>
          <th>期日</th>
          <th>内容</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody id="list"></tbody>
    </table>

    <script>
      const sortEl = document.getElementById("sort");
      const dueEl = document.getElementById("due");
      const contentEl = document.getElementById("content");
      const addEl = document.getElementById("add");
      const listEl = document.getElementById("list");
      const msgEl = document.getElementById("msg");
      const errEl = document.getElementById("err");

      function setMsg(text) {
        msgEl.textContent = text || "";
      }
      function setErr(text) {
        errEl.textContent = text || "";
      }

      function esc(s) {
        return String(s).replace(
          /[&<>"']/g,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
        );
      }

      async function api(path, options) {
        const res = await fetch(path, {
          headers: { "content-type": "application/json" },
          cache: "no-store",
          ...options,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status);
        return data;
      }

      function render(tasks) {
        listEl.innerHTML = "";
        for (const t of tasks) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
        <td class="due">${esc(t.due_date || "")}</td>
        <td>
          <div>${esc(t.content)}</div>
          <div class="muted">updated: ${esc(t.updated_at)}</div>
        </td>
        <td class="actions">
          <button data-act="archive" data-id="${esc(t.id)}">アーカイブ</button>
        </td>`;
          listEl.appendChild(tr);
        }
      }

      async function load() {
        setErr("");
        setMsg("読み込み中...");
        const data = await api(`/api/tasks?sort=${encodeURIComponent(sortEl.value)}`);
        render(data.tasks || []);
        setMsg(`件数: ${(data.tasks || []).length}`);
      }

      addEl.addEventListener("click", async () => {
        setErr("");
        const content = contentEl.value.trim();
        const due_date = dueEl.value;
        if (!content) {
          setErr("内容を入力してください");
          return;
        }

        addEl.disabled = true;
        try {
          await api("/api/tasks", { method: "POST", body: JSON.stringify({ content, due_date }) });
          contentEl.value = "";
          await load();
        } catch (e) {
          setErr(e.message);
        } finally {
          addEl.disabled = false;
        }
      });

      sortEl.addEventListener("change", load);

      // アーカイブボタン — RESTful パス /api/tasks/:id に DELETE
      listEl.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("button");
        if (!btn || btn.getAttribute("data-act") !== "archive") return;
        const id = btn.getAttribute("data-id");

        btn.disabled = true;
        setErr("");
        try {
          await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
          await load();
        } catch (e) {
          setErr(e.message);
        } finally {
          btn.disabled = false;
        }
      });

      load().catch((e) => setErr(e.message));
    </script>
  </body>
</html>
```

### public/archive.html — アーカイブ一覧

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Todo Archive</title>
    <style>
      :root {
        font-family:
          system-ui,
          -apple-system,
          Segoe UI,
          Roboto,
          sans-serif;
      }
      body {
        margin: 16px;
        max-width: 900px;
      }
      h1 {
        font-size: 20px;
        margin: 0 0 12px;
      }
      a.btn {
        display: inline-block;
        padding: 8px 10px;
        border: 1px solid #ccc;
        border-radius: 8px;
        text-decoration: none;
        color: inherit;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
      }
      th,
      td {
        border-bottom: 1px solid #eee;
        padding: 10px 6px;
        vertical-align: top;
      }
      th {
        text-align: left;
        font-weight: 600;
      }
      td.due {
        width: 140px;
        white-space: nowrap;
      }
      .muted {
        color: #666;
        font-size: 12px;
      }
      .error {
        color: #b00020;
        margin-top: 8px;
      }
    </style>
  </head>
  <body>
    <h1>アーカイブ</h1>
    <a class="btn" href="/">← 戻る</a>
    <div id="err" class="error"></div>

    <table>
      <thead>
        <tr>
          <th>期日</th>
          <th>内容</th>
          <th>アーカイブ日時</th>
        </tr>
      </thead>
      <tbody id="list"></tbody>
    </table>

    <script>
      const listEl = document.getElementById("list");
      const errEl = document.getElementById("err");

      function esc(s) {
        return String(s).replace(
          /[&<>"']/g,
          (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
        );
      }

      async function api(path) {
        const res = await fetch(path, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status);
        return data;
      }

      (async () => {
        try {
          const data = await api("/api/archive");
          listEl.innerHTML = "";
          for (const t of data.tasks || []) {
            const tr = document.createElement("tr");
            tr.innerHTML = `
          <td class="due">${esc(t.due_date || "")}</td>
          <td>
            <div>${esc(t.content)}</div>
            <div class="muted">created: ${esc(t.created_at)}</div>
          </td>
          <td>${esc(t.archived_at || "")}</td>`;
            listEl.appendChild(tr);
          }
        } catch (e) {
          errEl.textContent = e.message;
        }
      })();
    </script>
  </body>
</html>
```

## デプロイ

### A. D1 作成 + マイグレーション

```bash
# 依存インストール
npm install

# D1 データベース作成
npm run d1:create
# → 出力される database_id を wrangler.toml にセット

# マイグレーションファイル作成
wrangler d1 migrations create todo_db init
# → 生成された migrations/0001_init.sql に上記 SQL を貼る

# ローカルに適用
npm run d1:migrate

# 本番に適用
npm run d1:migrate:remote
```

### B. Cloudflare Pages へデプロイ

**方法 1: GitHub 連携**

1. GitHub にリポジトリを push
2. Cloudflare Dashboard → Pages → 新規プロジェクト → GitHub リポジトリを選択
3. ビルド設定: ビルドコマンドなし、出力ディレクトリ `./public`
4. Settings → Functions → D1 database bindings → 変数名 `DB` に `todo_db` を紐付け

**方法 2: CLI**

```bash
npm run deploy
```

### C. 認証（Cloudflare Access）

1. Cloudflare Zero Trust ダッシュボードを有効化
2. Access → Applications → 「Self-hosted」を追加
3. Application domain に `your-domain.example.com` を設定（`/*` をカバー）
4. Policy で「自分の IdP（Google 等）の特定メール」だけ許可

これで未ログインユーザーはブロックされ、ログイン済みユーザーのリクエストにのみ `Cf-Access-Jwt-Assertion` ヘッダが付く。

## 運用ノート

### バックアップ

D1 の無料枠では Time Travel（ポイントインタイムリカバリ）に制限がある。定期的にエクスポートしておくと安全。

```bash
# 手動バックアップ
wrangler d1 export todo_db --remote --output backup.sql

# R2 に保存する cron スクリプトを組むのもおすすめ
```

### セキュリティの二重化

- **第 1 層**: Cloudflare Access が前段でログインを強制
- **第 2 層**: Hono ミドルウェアが JWT の email を検証し `ALLOWED_EMAIL` 以外を拒否

さらに堅くするなら Cloudflare Pages の [Access プラグイン](https://developers.cloudflare.com/pages/functions/plugins/cloudflare-access/) で JWT の署名検証まで行うのが王道。

### レート制限

個人 Todo でも公開 URL は叩かれうる。Cloudflare WAF / Rate Limiting（無料枠範囲）を `/api/*` に適用するか、少なくとも Access 配下に置くことで対策する。

### UI 改善案（費用対効果の高い順）

1. **Access プラグインで JWT 完全検証** — 署名検証を Functions 側でも実施
2. **アーカイブから復帰** — `PATCH /api/archive/:id` で `archived_at = NULL` に戻す
3. **インライン編集** — `PATCH /api/tasks/:id` は実装済みなのでフロント側に編集 UI を追加するだけ
4. **期日なしタスクの最下段固定** — SQL の `ORDER BY` で対応済み（`due_date IS NULL` を先頭に）

### 監視

- Functions のエラーは JSON レスポンスの `error` フィールドでブラウザ上から確認可能
- Cloudflare Dashboard の Analytics で 4xx/5xx を定期チェック
- 必要に応じて `console.log` → Cloudflare の Tail Workers で確認

## ライセンス

MIT
