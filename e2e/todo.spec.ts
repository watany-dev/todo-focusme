import { test, expect } from "@playwright/test";

// ── JWT ヘルパー（unit test と同じパターン） ───────────

function b64url(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fakeJwt(email: string): string {
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({ email, sub: "e2e-sub", iat: 1000, exp: 9999999999 });
  return `${header}.${payload}.fake-signature`;
}

const TEST_JWT = fakeJwt("e2e@example.com");

// ── 全 API リクエストに JWT ヘッダーを注入 ─────────────

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const headers = {
      ...route.request().headers(),
      "cf-access-jwt-assertion": TEST_JWT,
    };
    await route.continue({ headers });
  });
});

// ── テスト ──────────────────────────────────────────────

test.describe("Todo ページ", () => {
  test("ページが表示される", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText("Todo");
    await expect(page.locator("#content")).toBeVisible();
    await expect(page.locator("#add")).toBeVisible();
  });

  test("タスクを作成して一覧に表示される", async ({ page }) => {
    await page.goto("/");

    await page.locator("#content").fill("E2Eテストタスク");
    await page.locator("#add").click();

    await expect(page.locator("#list")).toContainText("E2Eテストタスク");
  });

  test("期日付きタスクを作成できる", async ({ page }) => {
    await page.goto("/");

    await page.locator("#due").fill("2026-12-25");
    await page.locator("#content").fill("期日付きタスク");
    await page.locator("#add").click();

    await expect(page.locator("#list")).toContainText("期日付きタスク");
    await expect(page.locator("#list")).toContainText("2026-12-25");
  });

  test("タスクをアーカイブできる", async ({ page }) => {
    await page.goto("/");

    const taskName = `アーカイブ対象_${String(Date.now())}`;
    await page.locator("#content").fill(taskName);
    await page.locator("#add").click();
    await expect(page.locator("#list")).toContainText(taskName);

    const row = page.locator("#list tr", { hasText: taskName });
    await row.locator('button[data-act="archive"]').click();

    await expect(page.locator("#list")).not.toContainText(taskName);
  });

  test("アーカイブページにアーカイブ済みタスクが表示される", async ({ page }) => {
    await page.goto("/");

    const taskName = `アーカイブ確認_${String(Date.now())}`;
    await page.locator("#content").fill(taskName);
    await page.locator("#add").click();
    await expect(page.locator("#list")).toContainText(taskName);

    const row = page.locator("#list tr", { hasText: taskName });
    await row.locator('button[data-act="archive"]').click();
    await expect(page.locator("#list")).not.toContainText(taskName);

    await page.click('a[href="/archive.html"]');
    await expect(page.locator("h1")).toHaveText("アーカイブ");
    await expect(page.locator("#list")).toContainText(taskName);
  });
});
