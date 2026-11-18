/**
 * Browser e2e against the full stack with the deterministic scripted model (see scripts/e2e-stack.mjs).
 * Runs serially with one account: onboarding → connections → five demo scenarios → customisation → GDPR delete.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let page: Page;
const email = `e2e${Date.now()}@example.com`;

const lastReply = () => page.locator('.bubble.assistant:not(.typing)').last();
async function ask(text: string) {
  await expect(page.locator('#composer')).toBeEditable();
  await page.waitForTimeout(500); // let history load (SSE keeps the network busy, so no networkidle)
  await page.fill('#composer', text);
  await page.keyboard.press('Enter');
  // The reply is the first finished assistant bubble after our own message.
  const mine = page.locator('.bubble.user', { hasText: text }).last();
  await expect(mine).toBeVisible();
  await expect(page.locator('.bubble.user', { hasText: text }).last().locator('xpath=following-sibling::div[contains(@class,"bubble") and contains(@class,"assistant") and not(contains(@class,"typing"))]').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.typing')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator('[aria-label="What I\'m doing"]')).toHaveCount(0, { timeout: 90_000 });
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test('age gate blocks under-18s', async () => {
  await page.goto('/onboarding');
  await expect(page.getByRole('img', { name: /Jolly is waving/ })).toBeVisible();
  await expect(page.getByText(/You are chatting with an AI agent/)).toBeVisible();
  await page.getByRole('button', { name: "Let's start" }).click();
  const y = new Date().getFullYear() - 16;
  await page.getByLabel('Date of birth').fill(`${y}-01-01`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.card[role=alert]')).toContainText('at least 18');
});

test('adult signs up, names the avatar and lands in chat', async () => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: "Let's start" }).click();
  await page.getByLabel('Date of birth').fill('1990-05-20');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Password/).fill('correct horse battery staple');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('What should you call me?')).toBeVisible();
  await page.getByLabel('Name').fill('Pip');
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Pip' })).toBeVisible();
});

test('connect Demo Mail with granular scopes', async () => {
  await page.goto('/connections');
  const card = page.locator('article', { hasText: 'Demo Mail' });
  await card.getByLabel('Write drafts').check();
  await card.getByLabel('Send email').check();
  await card.getByRole('button', { name: 'Connect' }).click();
  await expect(card.getByText(/Connected/)).toBeVisible();
});

test('scenario 1: trip + host email waits for approval, approve sends it', async () => {
  await page.goto('/');
  await ask('Plan my trip to Lisbon and draft the email to my host about my arrival.');
  await expect(lastReply()).toContainText('Approvals');
  await page.goto('/approvals');
  const card = page.locator('article').first();
  await expect(card).toContainText('lucia.ferrari@casa-lucia.example');
  await expect(card).toContainText(/Risk: (high|medium)/);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved and done/)).toBeVisible();
  await page.goto('/');
  await expect(page.locator('.messages')).toContainText('your email was sent', { timeout: 60_000 });
});

test('scenario 4: background task keeps working and finishes on its own', async () => {
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Plan Lisbon trip' })).toBeVisible();
  // The task schedules a wake-up 1 minute later (durable job in Redis), even with no client connected.
  await page.goto('about:blank');
  await page.waitForTimeout(70_000);
  await page.goto('/tasks');
  await expect(page.getByText('Finished')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('article', { hasText: 'Plan Lisbon trip' })).toContainText('€89');
});

test('scenario 5: prompt-injection email is blocked by Sentinel', async () => {
  await page.goto('/');
  await ask('Can you summarise my inbox?');
  await expect(lastReply()).toContainText('Sentinel blocked it and nothing was sent');
  await page.goto('/activity');
  await expect(page.getByText(/DENY: Send email to recovery@account-verify.example/)).toBeVisible();
  await expect(page.getByText(/Audit trail verified/)).toBeVisible();
});

test('scenario 2: cheaper phone plan via research in the sandbox browser', async () => {
  await page.goto('/');
  await ask('Find me a cheaper phone plan.');
  await expect(lastReply()).toContainText('€9.99');
});

test('scenario 3: saved recipe becomes a grocery list', async () => {
  await ask('Turn my saved recipe into a grocery list.');
  await expect(lastReply()).toContainText('320 g arborio rice');
});

test('memory: add and forget from the memory manager', async () => {
  await page.goto('/memory');
  await page.getByPlaceholder('Add something to remember…').fill('Anna is vegetarian');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Anna is vegetarian')).toBeVisible();
  await page.getByRole('button', { name: 'Forget: Anna is vegetarian' }).click();
  await expect(page.getByText('Anna is vegetarian')).toHaveCount(0);
});

test('avatar customisation persists', async () => {
  await page.goto('/avatar');
  await page.getByRole('button', { name: 'beanie' }).click();
  await page.getByRole('button', { name: 'round' }).click();
  await page.getByLabel('Name').fill('Biscuit');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved ✓')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Biscuit' })).toBeVisible();
});

test('mobile layout shows bottom tabs with approval badge area', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.tabbar')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('GDPR: export data, then delete everything', async () => {
  await page.goto('/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export my data' }).click()]);
  expect(download.suggestedFilename()).toMatch(/my-data/);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page).toHaveURL(/onboarding/);
});
