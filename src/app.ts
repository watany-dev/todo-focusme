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

export { app };
export type { AppEnv };
