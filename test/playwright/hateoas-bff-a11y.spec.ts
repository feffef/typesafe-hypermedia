import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createBffServer, resetAllBackendState } from '../../examples/hateoas-bff/server';
import type { FastifyInstance } from 'fastify';

let server: FastifyInstance;
let baseURL: string;

test.beforeAll(async () => {
    const result = await createBffServer({ withStaticFiles: true });
    server = result.server;
    baseURL = result.address;
});

test.beforeEach(() => {
    resetAllBackendState();
});

test.afterAll(async () => {
    await server.close();
});

// ---------------------------------------------------------------------------
// A11y-locator helpers — every interaction uses roles, names, or placeholders
// so tests double as discoverability assertions.
// ---------------------------------------------------------------------------

/**
 * Navigate to the frontend entry point and wait for Alpine to finish rendering.
 * Every test starts here — the only hardcoded URL is the entry point, matching
 * the HATEOAS principle that the client knows exactly one URL.
 */
async function openFrontend(page: Page) {
    // Disable animations so axe-core sees final-state colors, not mid-fade opacity
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseURL}/frontend`);
    await expect(page.locator('[x-cloak]')).toHaveCount(0);
    await expect(mainNav(page)).toBeVisible();
}

function mainNav(page: Page) {
    return page.getByRole('navigation', { name: 'Main navigation' });
}

/** Click a button inside the main navigation by its accessible name. */
async function clickInMainNav(page: Page, name: string) {
    await mainNav(page).getByRole('button', { name }).click();
}

/** Click a page-level button by its accessible name (exact or regex). */
async function clickButton(page: Page, name: string | RegExp) {
    await page.getByRole('button', { name }).click();
}

/** Click the first page-level button matching the accessible name. */
async function clickFirstButton(page: Page, name: string | RegExp) {
    await page.getByRole('button', { name }).first().click();
}

/** Wait for the page-level heading (h1) to show the expected text. */
async function expectHeading(page: Page, text: string | RegExp) {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(text);
}

/** Wait for a named region (aria-label) to be visible. */
async function expectRegion(page: Page, name: string) {
    await expect(page.getByRole('region', { name })).toBeVisible();
}

/** Click "View Details" on the product card whose heading matches `name`. */
async function openProduct(page: Page, name: string) {
    const card = page.getByRole('listitem').filter({
        has: page.getByRole('heading', { name }),
    });
    await card.getByRole('button', { name: 'View Details' }).click();
    await expectRegion(page, 'Product details');
}

/** Type a search query and submit. */
async function search(page: Page, query: string) {
    const input = page.getByPlaceholder('Search products');
    await input.fill(query);
    await input.press('Enter');
}

/** Assert zero axe-core violations, printing a readable report on failure. */
async function expectAccessible(page: Page) {
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations;
    const message = violations
        .map(v => {
            const nodes = v.nodes
                .map(n => `    ${n.html}\n      ${n.failureSummary}`)
                .join('\n');
            return `[${v.id}] ${v.help} (${v.impact})\n${nodes}`;
        })
        .join('\n\n');
    expect(violations, message).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// Accessibility audits — one test per distinct view.
//
// Every test navigates from the entry point using a11y locators (getByRole,
// getByPlaceholder, etc.) — no hardcoded routes.  This validates that each
// view is discoverable through the real user journey AND that the resulting
// page passes axe-core.
// ---------------------------------------------------------------------------

test.describe('Accessibility audit (axe-core)', () => {

    test('home view', async ({ page }) => {
        await openFrontend(page);
        await expectAccessible(page);
    });

    test('category view', async ({ page }) => {
        await openFrontend(page);
        await clickInMainNav(page, 'Electronics');
        await expectHeading(page, 'Electronics');
        await expectAccessible(page);
    });

    test('product detail view', async ({ page }) => {
        await openFrontend(page);
        await clickInMainNav(page, 'Electronics');
        await expectHeading(page, 'Electronics');
        await openProduct(page, 'Smartphone 15 Pro');
        await expectAccessible(page);
    });

    test('search results view', async ({ page }) => {
        await openFrontend(page);
        await search(page, 'garden');
        await expectHeading(page, /Results for/);
        await expectAccessible(page);
    });

    test('cart view (empty)', async ({ page }) => {
        await openFrontend(page);
        await clickButton(page, /Show cart/);
        await expectRegion(page, 'Empty');
        await expectAccessible(page);
    });

    test('cart view (with items)', async ({ page }) => {
        await openFrontend(page);
        await clickInMainNav(page, 'Electronics');
        await expectHeading(page, 'Electronics');
        await openProduct(page, 'Smartphone 15 Pro');
        await clickButton(page, /Add to Cart/);
        await clickButton(page, /Show cart/);
        await expectHeading(page, 'Your Shopping Cart');
        await expectAccessible(page);
    });

    test('wishlist view', async ({ page }) => {
        await openFrontend(page);
        // Wishlist two products so the view has a populated list
        await clickInMainNav(page, 'Electronics');
        await expectHeading(page, 'Electronics');
        await clickFirstButton(page, 'Add to wishlist');
        await clickInMainNav(page, 'Home & Garden');
        await expectHeading(page, 'Home & Garden');
        await clickFirstButton(page, 'Add to wishlist');
        await clickButton(page, /Show wishlist/);
        await expectHeading(page, 'Your Wishlist');
        await expectAccessible(page);
    });

    test('orders view', async ({ page }) => {
        await openFrontend(page);
        await clickInMainNav(page, 'Orders');
        await expectHeading(page, 'Your Orders');
        await expectAccessible(page);
    });

    test('order confirmation view', async ({ page }) => {
        await openFrontend(page);
        await clickInMainNav(page, 'Electronics');
        await expectHeading(page, 'Electronics');
        await openProduct(page, 'Smartphone 15 Pro');
        await clickButton(page, /Add to Cart/);
        await clickButton(page, /Show cart/);
        await expectHeading(page, 'Your Shopping Cart');
        await clickButton(page, /Checkout/);
        await expectRegion(page, 'Order confirmation');
        await expectAccessible(page);
    });
});
