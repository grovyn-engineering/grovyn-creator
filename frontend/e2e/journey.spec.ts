import { expect, test, type Page } from "@playwright/test";

/**
 * The production acceptance journey, end to end:
 *
 *   sign up → workspace → connect Instagram → build a workflow → enable it
 *   → receive a webhook → execute → see it on the dashboard
 *
 * Runs against the mock Instagram provider, which serves its own consent screen
 * and redirects into the *real* OAuth callback — so state verification, code
 * exchange, token encryption, and the account upsert are all genuinely
 * exercised. Only Meta itself is simulated.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

async function signUp(page: Page, email: string): Promise<void> {
  await page.goto("/signup");

  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-test-password");
  await page.getByLabel(/Workspace name/i).fill("E2E Workspace");

  await page.getByRole("button", { name: "Create account" }).click();

  // Signup provisions the workspace transactionally, so a new user lands on a
  // working dashboard rather than an onboarding dead end.
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe("full journey", () => {
  test("signs up, connects Instagram, builds a workflow, and sees a run", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();

    await test.step("sign up", async () => {
      await signUp(page, email);
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    });

    await test.step("dashboard prompts to connect Instagram", async () => {
      // Nothing can run without a connection, and the dashboard says so rather
      // than showing an unexplained set of zeros.
      await expect(
        page.getByRole("heading", { name: /Connect Instagram to get started/i })
      ).toBeVisible();
    });

    await test.step("connect Instagram through the real OAuth callback", async () => {
      await page.goto("/instagram");
      await expect(page.getByRole("heading", { name: "Instagram" })).toBeVisible();

      // The development banner must be unmistakable — simulated state should
      // never be mistaken for a real connection.
      await expect(page.getByText(/Development mode/i)).toBeVisible();

      await page.getByRole("button", { name: "Connect Instagram" }).click();

      // The mock consent screen, which posts back to /api/instagram/callback.
      await expect(page.getByRole("heading", { name: /Authorize SocialPilot/i })).toBeVisible();
      await page.getByLabel("Instagram username").fill("e2e_studio");
      await page.getByRole("button", { name: "Authorize" }).click();

      await expect(page).toHaveURL(/\/instagram\?status=connected/);
      await expect(page.getByText("@e2e_studio")).toBeVisible();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    });

    await test.step("create a workflow", async () => {
      await page.goto("/workflows");
      await expect(page.getByRole("heading", { name: /No workflows yet/i })).toBeVisible();

      await page.getByRole("link", { name: /Create your first workflow/i }).click();
      await expect(page).toHaveURL(/\/workflows\/new/);

      await page.getByLabel("Workflow name").fill("Auto-reply to price questions");

      // WHEN — comment is the default; assert it rather than assume.
      await expect(page.getByText("Someone comments on a post")).toBeVisible();

      // IF
      await page.getByRole("button", { name: "Add condition" }).click();
      await page.getByPlaceholder("price").fill("price");

      // THEN
      await page
        .getByPlaceholder(/sending you the details/i)
        .fill("Hi {{username}} — sending details now!");

      await page.getByRole("button", { name: "Create workflow" }).click();

      // Lands on the detail page, and starts as a draft — a workflow that
      // immediately acted on a live account would be a surprise.
      await expect(page).toHaveURL(/\/workflows\/[a-z0-9]+$/i);
      await expect(page.getByText("Draft")).toBeVisible();
    });

    await test.step("test the workflow without sending anything", async () => {
      await page.getByRole("button", { name: "Test" }).click();

      await page.getByLabel("Sample text").fill("how much is the price?");
      await page.getByRole("button", { name: "Run test" }).click();

      await expect(page.getByText(/Conditions matched/i)).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();
    });

    await test.step("enable the workflow", async () => {
      await page.getByRole("button", { name: "Enable" }).click();
      await expect(page.getByText("Active")).toBeVisible();
    });

    await test.step("deliver a webhook and see it execute", async () => {
      const payload = {
        object: "instagram",
        entry: [
          {
            // The mock derives this deterministically from the username, so it
            // matches the account connected above.
            id: `mock_${Buffer.from("e2e_studio").toString("hex").slice(0, 16)}`,
            time: Math.floor(Date.now() / 1000),
            changes: [
              {
                field: "comments",
                value: {
                  id: `e2e_comment_${Date.now()}`,
                  text: "hey what is the price on this?",
                  from: { id: "e2e_commenter", username: "curious_buyer" },
                  media: { id: "e2e_post_1" },
                },
              },
            ],
          },
        ],
      };

      const response = await request.post(`${API_URL}/api/webhooks/instagram`, { data: payload });
      // Meta treats a slow or non-200 response as a failed delivery.
      expect(response.status()).toBe(200);

      // Redelivery — Meta does this after any failed acknowledgement.
      await request.post(`${API_URL}/api/webhooks/instagram`, { data: payload });

      await page.goto("/activity");
      await expect(page.getByText(/@curious_buyer commented/i).first()).toBeVisible({
        timeout: 15_000,
      });

      // Deduplicated: one row, not two.
      await expect(page.getByText(/@curious_buyer commented/i)).toHaveCount(1);
      await expect(page.getByText(/1 run/i).first()).toBeVisible();
    });

    await test.step("dashboard reflects the run", async () => {
      await page.goto("/dashboard");

      await expect(page.getByText("Workflow runs")).toBeVisible();
      // The connect prompt is gone now that both prerequisites are satisfied.
      await expect(
        page.getByRole("heading", { name: /Connect Instagram to get started/i })
      ).toBeHidden();

      await expect(page.getByText(/Auto-reply to price questions/i).first()).toBeVisible();
    });
  });

  test("keeps signed-out visitors out of the app", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    // The intended destination is preserved, so signing in lands where they meant to go.
    await expect(page).toHaveURL(/next=%2Fdashboard/);
  });

  test("is reachable by keyboard", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);

    // The skip link must be the first tab stop, ahead of the whole nav.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });
});
