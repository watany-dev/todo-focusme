import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/app";

// ── 型定義 ──────────────────────────────────────────

interface ApiResponse {
  ok: boolean;
  error?: string;
  id?: string;
  status?: string;
  tasks?: TaskRow[];
}

interface TaskRow {
  id: string;
  due_date: string | null;
  content: string;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

// ── ヘルパー ────────────────────────────────────────

const TEST_EMAIL = "test@example.com";

function b64url(obj: Record<string, unknown>) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fakeJwt(email: string) {
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({ email, sub: "test-sub", iat: 1000, exp: 9999999999 });
  return `${header}.${payload}.fake-signature`;
}

function authHeaders(email: string = TEST_EMAIL): Record<string, string> {
  return {
    "Cf-Access-Jwt-Assertion": fakeJwt(email),
    "Content-Type": "application/json",
  };
}

async function jsonBody(res: Response) {
  const data: unknown = await res.json();
  return data as ApiResponse;
}

function req(path: string, init?: RequestInit) {
  return app.request(path, init, env);
}

// ── DB セットアップ ─────────────────────────────────

const CREATE_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_email TEXT NOT NULL, due_date TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);";

async function setupDb() {
  await env.DB.exec(CREATE_TABLE_SQL);
  await env.DB.exec("DELETE FROM tasks;");
}

// ── テスト ──────────────────────────────────────────

describe("Health check", () => {
  it("GET /api/health returns 401 without auth", async () => {
    const res = await req("/api/health");
    expect(res.status).toBe(401);
  });

  it("GET /api/health returns ok with auth", async () => {
    const res = await req("/api/health", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body).toEqual({ ok: true, status: "healthy" });
  });
});

describe("Auth middleware", () => {
  it("rejects requests without JWT", async () => {
    const res = await req("/api/tasks");
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect(body).toEqual({ ok: false, error: "missing access token" });
  });

  it("rejects requests with invalid JWT", async () => {
    const res = await req("/api/tasks", {
      headers: { "Cf-Access-Jwt-Assertion": "invalid" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with non-string email in JWT", async () => {
    const header = b64url({ alg: "RS256" });
    const payload = b64url({ email: 123 });
    const jwt = `${header}.${payload}.sig`;
    const res = await req("/api/tasks", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with invalid base64 JWT payload", async () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.!!!invalid-base64!!!.sig";
    const res = await req("/api/tasks", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests when ALLOWED_EMAIL does not match", async () => {
    const envWithEmail = { ...env, ALLOWED_EMAIL: "allowed@example.com" };
    const res = await app.request(
      "/api/tasks",
      { headers: authHeaders("wrong@example.com") },
      envWithEmail,
    );
    expect(res.status).toBe(403);
    const body = await jsonBody(res);
    expect(body.error).toBe("forbidden");
  });
});

describe("POST /api/tasks", () => {
  beforeEach(setupDb);

  it("creates a task", async () => {
    const res = await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Buy milk", due_date: "2026-03-15" }),
    });
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe("string");
  });

  it("creates a task without due_date", async () => {
    const res = await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "No deadline task" }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects empty content", async () => {
    const res = await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "   " }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.error).toBe("content is required");
  });

  it("rejects missing content", async () => {
    const res = await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("handles invalid JSON body", async () => {
    const res = await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tasks", () => {
  beforeEach(setupDb);

  it("returns empty list initially", async () => {
    const res = await req("/api/tasks", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    expect(body.tasks).toEqual([]);
  });

  it("returns created tasks", async () => {
    await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Task 1" }),
    });
    await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Task 2" }),
    });

    const res = await req("/api/tasks", { headers: authHeaders() });
    const body = await jsonBody(res);
    expect(body.tasks).toHaveLength(2);
  });

  it("supports sort=due_asc", async () => {
    await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Later", due_date: "2026-12-01" }),
    });
    await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Earlier", due_date: "2026-01-01" }),
    });

    const res = await req("/api/tasks?sort=due_asc", { headers: authHeaders() });
    const body = await jsonBody(res);
    const tasks = body.tasks ?? [];
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.content).toBe("Earlier");
    expect(tasks[1]?.content).toBe("Later");
  });

  it("supports sort=due_desc", async () => {
    await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Later", due_date: "2026-12-01" }),
    });
    await req("/api/tasks", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Earlier", due_date: "2026-01-01" }),
    });

    const res = await req("/api/tasks?sort=due_desc", { headers: authHeaders() });
    const body = await jsonBody(res);
    const tasks = body.tasks ?? [];
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.content).toBe("Later");
    expect(tasks[1]?.content).toBe("Earlier");
  });
});

describe("PATCH /api/tasks/:id", () => {
  beforeEach(setupDb);

  it("updates task content", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Original" }),
      }),
    );
    const id = createBody.id ?? "";

    const res = await req(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Updated" }),
    });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).ok).toBe(true);

    const listBody = await jsonBody(await req("/api/tasks", { headers: authHeaders() }));
    const tasks = listBody.tasks ?? [];
    expect(tasks[0]?.content).toBe("Updated");
  });

  it("updates task due_date", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Task", due_date: "2026-01-01" }),
      }),
    );
    const id = createBody.id ?? "";

    const res = await req(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ due_date: "2026-06-15" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects empty content", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Task" }),
      }),
    );
    const id = createBody.id ?? "";

    const res = await req(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toBe("content cannot be empty");
  });

  it("rejects no fields to update", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Task" }),
      }),
    );
    const id = createBody.id ?? "";

    const res = await req(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toBe("no fields to update");
  });

  it("returns 404 for non-existent task", async () => {
    const res = await req("/api/tasks/nonexistent", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ content: "Updated" }),
    });
    expect(res.status).toBe(404);
  });

  it("handles invalid JSON body", async () => {
    const res = await req("/api/tasks/some-id", {
      method: "PATCH",
      headers: authHeaders(),
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("clears due_date with empty string", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Task", due_date: "2026-01-01" }),
      }),
    );
    const id = createBody.id ?? "";

    const res = await req(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ due_date: "" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/tasks/:id", () => {
  beforeEach(setupDb);

  it("archives a task", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "To archive" }),
      }),
    );
    const id = createBody.id ?? "";

    const res = await req(`/api/tasks/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).ok).toBe(true);

    const listBody = await jsonBody(await req("/api/tasks", { headers: authHeaders() }));
    expect(listBody.tasks).toEqual([]);
  });

  it("returns 404 for non-existent task", async () => {
    const res = await req("/api/tasks/nonexistent", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when archiving already archived task", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Double archive" }),
      }),
    );
    const id = createBody.id ?? "";

    await req(`/api/tasks/${id}`, { method: "DELETE", headers: authHeaders() });

    const res = await req(`/api/tasks/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/archive", () => {
  beforeEach(setupDb);

  it("returns empty list initially", async () => {
    const res = await req("/api/archive", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    expect(body.tasks).toEqual([]);
  });

  it("returns archived tasks", async () => {
    const createBody = await jsonBody(
      await req("/api/tasks", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Archived task" }),
      }),
    );
    const id = createBody.id ?? "";

    await req(`/api/tasks/${id}`, { method: "DELETE", headers: authHeaders() });

    const res = await req("/api/archive", { headers: authHeaders() });
    const body = await jsonBody(res);
    const tasks = body.tasks ?? [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.content).toBe("Archived task");
    expect(tasks[0]?.archived_at).toBeTruthy();
  });
});
