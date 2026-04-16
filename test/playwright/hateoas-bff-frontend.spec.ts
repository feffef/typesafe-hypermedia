import { test, expect, type Page } from '@playwright/test';
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
// Test-selector helpers
//
// Convention: the HTML uses `data-test` attributes for test-visible elements
// and standard ARIA attributes for state (`aria-current="page"` on the active
// nav button, `aria-pressed` on sort toggles).  CSS classes are for styling
// only — tests never select by CSS class.
// ---------------------------------------------------------------------------

/** Build a `[data-test="<name>"]` selector. */
const T = (name: string) => `[data-test="${name}"]`;

/** Navigate to the frontend and wait for the initial BFF fetch to complete. */
async function openFrontend(page: Page, query = '') {
    await page.goto(`${baseURL}/frontend${query}`);
    await expect(page.locator('[x-cloak]')).toHaveCount(0);
    await expect(navButton(page, /./).first()).toBeVisible();
}

/** Navigate to a frontend deep link and wait for a specific view heading to render. */
async function openDeepLink(page: Page, path: string, expectedHeading: string | RegExp) {
    await page.goto(`${baseURL}/frontend${path}`);
    await expect(page.locator('[x-cloak]')).toHaveCount(0);
    await expect(productsHeading(page)).toHaveText(expectedHeading);
}

/** Locate a nav button by its visible text label. */
function navButton(page: Page, label: string | RegExp) {
    const nav = page.locator(`${T('nav')} button`);
    if (typeof label === 'string') {
        return nav.filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
    }
    return nav.filter({ hasText: label });
}

function productCards(page: Page) {
    return page.locator(T('card'));
}

function cartNavButton(page: Page) {
    return page.locator(T('nav-cart'));
}

function wishlistNavButton(page: Page) {
    return page.locator(T('nav-wishlist'));
}

function productsHeading(page: Page) {
    return page.locator(T('heading'));
}

function detailsView(page: Page) {
    return page.locator(T('detail'));
}

function toast(page: Page) {
    return page.locator(T('toast'));
}

test.describe('HATEOAS BFF Frontend E2E', () => {

    test('should load the home view with featured products', async ({ page }) => {
        await openFrontend(page);

        await expect(navButton(page, 'Home')).toHaveAttribute('aria-current', 'page');
        await expect(productsHeading(page)).toHaveText('Featured Products');
        await expect(productCards(page)).not.toHaveCount(0);
        await expect(detailsView(page)).not.toBeVisible();
    });

    test('should navigate to a category', async ({ page }) => {
        await openFrontend(page);
        await navButton(page, 'Electronics').click();
        await expect(productsHeading(page)).toHaveText('Electronics');
        await expect(navButton(page, 'Electronics')).toHaveAttribute('aria-current', 'page');
        await expect(navButton(page, 'Home')).not.toHaveAttribute('aria-current');
    });

    test('should navigate back home via nav link', async ({ page }) => {
        await openFrontend(page);
        await navButton(page, 'Electronics').click();
        await expect(productsHeading(page)).toHaveText('Electronics');

        await navButton(page, 'Home').click();
        await expect(productsHeading(page)).toHaveText('Featured Products');
        await expect(navButton(page, 'Home')).toHaveAttribute('aria-current', 'page');
    });

    test.describe('category browsing', () => {
        test('should load Home & Garden products', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Home & Garden').click();
            await expect(productsHeading(page)).toHaveText('Home & Garden');
            await expect(productCards(page).filter({ hasText: 'Garden Hose' })).toBeVisible();
        });

        test('should load Kitchen products', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Kitchen').click();
            await expect(productsHeading(page)).toHaveText('Kitchen');
            await expect(productCards(page).filter({ hasText: 'Blender 3000' })).toBeVisible();
        });
    });

    test.describe('sort options', () => {
        test('should reorder Electronics by price ascending', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await page.locator(`${T('sort')} button`, { hasText: 'Price: Low → High' }).click();

            const firstCard = productCards(page).first();
            await expect(page.locator(`${T('sort')} button`, { hasText: 'Price: Low → High' }))
                .toHaveAttribute('aria-pressed', 'true');
            await expect(firstCard).toBeVisible();
        });

        test('should clear sort when navigating to another category', async ({ page }) => {
            await openFrontend(page, '/category?category=c1&sort=price-desc');
            await expect(page.locator(`${T('sort')} button`, { hasText: 'Price: High → Low' }))
                .toHaveAttribute('aria-pressed', 'true');

            await navButton(page, 'Kitchen').click();
            await expect(page.locator(`${T('sort')} button`, { hasText: 'Name' }))
                .toHaveAttribute('aria-pressed', 'true');
        });
    });

    test.describe('search', () => {
        test('should find products by name', async ({ page }) => {
            await openFrontend(page);
            const searchInput = page.locator(`${T('search')} input`);
            await searchInput.click();
            await searchInput.pressSequentially('Blender');
            await searchInput.press('Enter');

            await expect(productsHeading(page)).toContainText('Results for "Blender"');
            await expect(productCards(page).filter({ hasText: 'Blender 3000' })).toBeVisible();
        });

        test('should show no results message for unmatched search', async ({ page }) => {
            await openFrontend(page);
            const searchInput = page.locator(`${T('search')} input`);
            await searchInput.click();
            await searchInput.pressSequentially('xyznonexistent');
            await searchInput.press('Enter');

            await expect(productsHeading(page)).toContainText('No results for "xyznonexistent"');
        });

        test('should preserve search in URL state', async ({ page }) => {
            await openFrontend(page, '/search?search=Headphones');
            await expect(productsHeading(page)).toContainText('Results for "Headphones"');
            await expect(productCards(page).filter({ hasText: 'Wireless Headphones' })).toBeVisible();
        });
    });

    test.describe('breadcrumbs', () => {
        test('should show breadcrumbs on category pages', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();

            // Each breadcrumb item is an <li> containing either an <a> (link) or a <span> (current)
            const crumbs = page.locator(`${T('breadcrumbs')} li`);
            await expect(crumbs).toHaveCount(2);
            await expect(crumbs.first()).toContainText('Home');
            await expect(crumbs.last()).toContainText('Electronics');
        });

        test('should show three-level breadcrumb on product detail', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            const crumbs = page.locator(`${T('breadcrumbs')} li`);
            await expect(crumbs).toHaveCount(3);
            await expect(crumbs.nth(0)).toContainText('Home');
            await expect(crumbs.nth(1)).toContainText('Electronics');
            await expect(crumbs.nth(2)).toContainText('Smartphone 15 Pro');
        });

        test('should navigate via breadcrumb link', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            // Click the Electronics breadcrumb
            await page.locator(`${T('breadcrumbs')} a`).filter({ hasText: 'Electronics' }).click();
            await expect(productsHeading(page)).toHaveText('Electronics');
        });
    });

    test.describe('CRM personalization', () => {
        test('should show user greeting from CRM profile', async ({ page }) => {
            await openFrontend(page);
            await expect(page.locator(T('greeting'))).toContainText('Jane Doe');
        });

        test('should show promo banner with offer from CRM', async ({ page }) => {
            await openFrontend(page);
            const promo = page.locator(T('promo'));
            await expect(promo).toBeVisible();
            await expect(page.locator(T('promo-code'))).toContainText('WELCOME10');
        });
    });

    test.describe('card enrichment', () => {
        test('should show product description on cards', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();

            const card = productCards(page).filter({ hasText: 'Smartphone 15 Pro' });
            await expect(card.locator(T('card-desc'))).toContainText('OLED');
        });

        test('should show out-of-stock badge on sold-out products', async ({ page }) => {
            // PROD-006 (4K Webcam Pro) has stock 0
            await openFrontend(page);
            await navButton(page, 'Electronics').click();

            const card = productCards(page).filter({ hasText: '4K Webcam Pro' });
            await expect(card.locator(T('badge'))).toContainText('Out of Stock');
        });

        test('should show low-stock badge on low-stock products', async ({ page }) => {
            // PROD-004 (Blender 3000) has stock 3
            await openFrontend(page);
            await navButton(page, 'Kitchen').click();

            const card = productCards(page).filter({ hasText: 'Blender 3000' });
            await expect(card.locator(T('badge'))).toContainText('Low Stock');
        });
    });

    test.describe('prices', () => {
        test('should show prices on product cards', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();

            const card = productCards(page).filter({ hasText: 'Smartphone 15 Pro' });
            await expect(card.locator(T('card-price'))).toContainText('$');
        });

        test('should show price in product details', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            await expect(detailsView(page).locator(T('detail-price'))).toContainText('$999.00');
        });
    });

    test.describe('product details', () => {
        test('should show product details when clicking a card', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await expect(productsHeading(page)).toHaveText('Electronics');

            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            const details = detailsView(page);
            await expect(details.locator('h1')).toHaveText('Smartphone 15 Pro');
            await expect(details.locator(T('detail-badge'))).toContainText('In Stock');
        });

        test('should show reviews on reviewed products', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            const reviews = detailsView(page).locator(T('review'));
            await expect(reviews).toHaveCount(2);
            await expect(reviews.first()).toContainText('Alice');
            await expect(reviews.first()).toContainText('Amazing phone!');
        });

        test('should show related products', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            await expect(page.locator(`${T('recommendations')} > h2`)).toHaveText('Related Products');
            await expect(productCards(page)).not.toHaveCount(0);
        });

        test('should show DAM images on products that have them', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            const gallery = detailsView(page).locator(T('image-gallery'));
            await expect(gallery).toBeVisible();
            await expect(gallery.locator(T('image-placeholder'))).toHaveCount(2);
            await expect(gallery.locator(T('image-placeholder')).first()).toContainText('PROD-001-front.jpg');
        });

        test('should not show image gallery when DAM has no assets', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Home & Garden').click();
            await productCards(page).filter({ hasText: 'Garden Hose' })
                .locator('button', { hasText: 'View Details' }).click();

            await expect(detailsView(page).locator(T('image-gallery'))).not.toBeVisible();
        });

        test('should show "No reviews yet" for unreviewed products', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Home & Garden').click();
            await productCards(page).filter({ hasText: 'Garden Hose' })
                .locator('button', { hasText: 'View Details' }).click();

            await expect(detailsView(page).locator(T('no-reviews'))).toBeVisible();
        });
    });

    test.describe('add to cart', () => {
        test('should add a product to the cart', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 0 items');

            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 1 item');
            await expect(productsHeading(page)).toHaveText('Your Shopping Cart');
            await expect(productCards(page).filter({ hasText: 'Smartphone 15 Pro' })).toBeVisible();
        });

        test('should render duplicate items when the same product is added twice', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            // Add to cart the first time
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();
            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 1 item');

            // Navigate back to the same product and add again
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            // Cart should show 2 items, both rendered as separate cards
            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 2 items');
            await expect(productsHeading(page)).toHaveText('Your Shopping Cart');
            await expect(productCards(page).filter({ hasText: 'Smartphone 15 Pro' })).toHaveCount(2);
        });
    });

    test.describe('checkout flow', () => {
        test('should show checkout button in cart with total', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            const checkout = page.locator(`${T('checkout')} button`);
            await expect(checkout).toContainText('Checkout');
            await expect(checkout).toContainText('$');
        });

        test('should complete checkout and show order confirmation', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            await page.locator(`${T('checkout')} button`).click();

            const confirmation = page.locator(T('confirmation'));
            await expect(confirmation).toBeVisible();
            await expect(confirmation.locator('h1')).toHaveText('Order Confirmed');
            await expect(page.locator(`${T('confirmation-id')} code`)).toContainText('ord-');
        });

        test('should show empty cart state', async ({ page }) => {
            await openFrontend(page);
            await cartNavButton(page).click();

            await expect(page.locator(T('empty'))).toBeVisible();
            await expect(page.locator(T('empty'))).toContainText('No items here yet');
        });
    });

    test.describe('toast notifications', () => {
        test('should show a toast after adding to cart', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            await expect(toast(page)).toBeVisible();
            await expect(toast(page)).toContainText('Added to cart!');
        });
    });

    test.describe('wishlist', () => {
        test('should save a product to the wishlist from a category page', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Kitchen').click();
            const card = productCards(page).filter({ hasText: 'Blender 3000' });
            await card.locator(T('wishlist-toggle')).click();

            await expect(productsHeading(page)).toHaveText('Kitchen');
            await expect(wishlistNavButton(page)).toHaveAttribute('aria-label', 'Show wishlist with 1 item');
        });

        test('should show wishlist view with saved items', async ({ page }) => {
            await openFrontend(page, '/home?wishlist=PROD-001');
            await wishlistNavButton(page).click();
            await expect(productsHeading(page)).toHaveText('Your Wishlist');
            await expect(productCards(page).filter({ hasText: 'Smartphone 15 Pro' })).toBeVisible();
        });

        test('should add a wishlist item to the cart via card action', async ({ page }) => {
            await openFrontend(page, '/home?wishlist=PROD-001');
            await wishlistNavButton(page).click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'Add to Cart' }).click();
            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 1 item');
        });

        test('should show empty state when wishlist is empty', async ({ page }) => {
            await openFrontend(page);
            await wishlistNavButton(page).click();
            await expect(productsHeading(page)).toHaveText('Your Wishlist');
            await expect(page.locator(T('empty'))).toBeVisible();
        });
    });

    test.describe('cart recommendations', () => {
        test('should show "You might also like" section in cart', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            const recs = page.locator(T('recommendations'));
            await expect(recs).toBeVisible();
            await expect(recs.locator('> h2')).toContainText('You might also like');
            await expect(recs.locator(T('card'))).not.toHaveCount(0);
        });
    });

    test.describe('move to wishlist', () => {
        test('should move a cart item into the wishlist', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 1 item');
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'Move to Wishlist' }).click();

            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 0 items');
            await expect(wishlistNavButton(page)).toHaveAttribute('aria-label', 'Show wishlist with 1 item');
        });
    });

    test.describe('remove from cart', () => {
        test('should remove an item from the cart', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 1 item');
            const card = productCards(page).filter({ hasText: 'Smartphone 15 Pro' });
            await card.locator('button', { hasText: 'Remove' }).click();

            await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 0 items');
            await expect(page.locator(T('empty'))).toBeVisible();
        });
    });

    test.describe('free shipping progress', () => {
        test('should show progress toward free shipping for a small cart', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Kitchen').click();
            await productCards(page).filter({ hasText: 'Blender 3000' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            await expect(page.locator(T('shipping-progress'))).toBeVisible();
            await expect(page.locator(T('shipping-progress'))).toContainText('more for free shipping');
        });

        test('should show unlocked state when cart exceeds the threshold', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            await expect(page.locator(T('shipping-unlocked'))).toBeVisible();
            await expect(page.locator(T('shipping-unlocked'))).toContainText('Free shipping unlocked');
        });
    });

    test.describe('cart summary with discount', () => {
        test('should apply CRM promo discount to cart total', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            const summary = page.locator(T('cart-summary'));
            await expect(summary).toBeVisible();
            await expect(summary).toContainText('$999.00');
            await expect(summary.locator(T('discount-code'))).toContainText('WELCOME10');
            await expect(summary.locator(T('discount-amount'))).toContainText('-$99.90');
            await expect(summary.locator(T('summary-total'))).toContainText('$899.10');
        });
    });

    test.describe('loyalty points', () => {
        test('should show loyalty balance in header', async ({ page }) => {
            await openFrontend(page);
            await expect(page.locator(T('loyalty'))).toContainText('pts');
            await expect(page.locator(T('loyalty'))).toContainText('240');
        });

        test('should show points to earn in cart', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();

            // Smartphone is $999, WELCOME10 brings it to $899.10 → floor = 899 points
            await expect(page.locator(T('loyalty-earn'))).toContainText('899');
        });

        test('should mention loyalty points earned in the order confirmation toast', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();
            await page.locator(`${T('checkout')} button`).click();

            await expect(toast(page)).toBeVisible();
            await expect(toast(page)).toContainText('loyalty points earned');
            await expect(toast(page)).toContainText('999');
        });

        test('should update loyalty balance in header after checkout', async ({ page }) => {
            await openFrontend(page);
            const loyaltyPill = page.locator(T('loyalty'));
            await expect(loyaltyPill).toContainText('240');

            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();
            await page.locator(`${T('checkout')} button`).click();

            const confirmation = page.locator(T('confirmation'));
            await expect(confirmation).toBeVisible();
            await expect(loyaltyPill).toContainText('1239');
        });
    });

    test.describe('order history', () => {
        test('should navigate from confirmation to order history and show the order', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();
            await page.locator(`${T('checkout')} button`).click();

            const viewOrdersBtn = page.locator(`${T('confirmation-actions')} button`, { hasText: 'View All Orders' });
            await expect(viewOrdersBtn).toBeVisible();
            await viewOrdersBtn.click();

            await expect(productsHeading(page)).toHaveText('Your Orders');
            await expect(productCards(page).filter({ hasText: /Order ord-/ }).first()).toBeVisible();
        });

        test('should not show a "View Details" button on order cards', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();
            await detailsView(page).locator('button', { hasText: 'Add to Cart' }).click();
            await page.locator(`${T('checkout')} button`).click();

            const viewOrdersBtn = page.locator(`${T('confirmation-actions')} button`, { hasText: 'View All Orders' });
            await viewOrdersBtn.click();

            await expect(productsHeading(page)).toHaveText('Your Orders');
            const orderCard = productCards(page).filter({ hasText: /Order ord-/ }).first();
            await expect(orderCard).toBeVisible();
            await expect(orderCard.locator('button', { hasText: 'View Details' })).toHaveCount(0);
        });
    });

    test.describe('backend attribution footer', () => {
        test('should list PIM and CRM on the home view', async ({ page }) => {
            await openFrontend(page);
            const footer = page.locator(T('sources'));
            await expect(footer).toBeVisible();
            await expect(footer.locator(T('source-chip'), { hasText: 'PIM' })).toBeVisible();
            await expect(footer.locator(T('source-chip'), { hasText: 'ERP' })).toBeVisible();
            await expect(footer.locator(T('source-chip'), { hasText: 'CRM' })).toBeVisible();
        });

        test('should add DAM on product detail when assets exist', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await productCards(page).filter({ hasText: 'Smartphone 15 Pro' })
                .locator('button', { hasText: 'View Details' }).click();

            const footer = page.locator(T('sources'));
            await expect(footer.locator(T('source-chip'), { hasText: 'DAM' })).toBeVisible();
        });

        test('should not include DAM when product has no media assets', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Home & Garden').click();
            await productCards(page).filter({ hasText: 'Garden Hose' })
                .locator('button', { hasText: 'View Details' }).click();

            const footer = page.locator(T('sources'));
            await expect(footer.locator(T('source-chip'), { hasText: 'DAM' })).toHaveCount(0);
        });
    });

    test.describe('browser URL and history', () => {
        test('should update the URL on navigation', async ({ page }) => {
            await openFrontend(page);
            await navButton(page, 'Electronics').click();
            await expect(productsHeading(page)).toHaveText('Electronics');

            expect(page.url()).toContain('/frontend/category');
            expect(page.url()).toContain('category=');
        });

        test('should restore state from a direct URL', async ({ page }) => {
            await openFrontend(page, '/category?category=c1');
            await expect(productsHeading(page)).toHaveText('Electronics');
            await expect(navButton(page, 'Electronics')).toHaveAttribute('aria-current', 'page');
        });

        test('should support browser back navigation', async ({ page }) => {
            await openFrontend(page);
            await expect(productsHeading(page)).toHaveText('Featured Products');

            await navButton(page, 'Electronics').click();
            await expect(productsHeading(page)).toHaveText('Electronics');

            await page.goBack();
            await expect(productsHeading(page)).toHaveText('Featured Products');
        });
    });
});

test.describe('error paths — unknown URL inputs', () => {

    test('should show error state for unknown SKU on product detail', async ({ page }) => {
        await page.goto(`${baseURL}/frontend/product?sku=FOO&category=c2`);
        await expect(page.locator('[x-cloak]')).toHaveCount(0);

        const errorContainer = page.locator(T('error'));
        await expect(errorContainer).toBeVisible();
        await expect(errorContainer).toContainText('HTTP error! status: 404');
    });

    test('should fall back to orders list when orderId is unknown', async ({ page }) => {
        await page.goto(`${baseURL}/frontend/order-confirmation?orderId=ord-nonexistent-12345`);
        await expect(page.locator('[x-cloak]')).toHaveCount(0);
        await expect(navButton(page, /./).first()).toBeVisible();

        await expect(productsHeading(page)).toHaveText('Your Orders');

        await expect(toast(page)).toBeVisible();
        await expect(toast(page)).toContainText('Order not found');
    });

});

test.describe('out-of-stock and checkout failure', () => {

    test('should show 409 "Stock Problem" when a second session exhausts stock between render and click', async ({ browser }) => {
        const contextA = await browser.newContext();
        const contextB = await browser.newContext();
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();
        try {
            await pageA.goto(`${baseURL}/frontend/product?sku=PROD-004&category=c3`);
            await expect(pageA.locator('[x-cloak]')).toHaveCount(0);
            await expect(pageA.locator(`${T('detail')} button`, { hasText: 'Add to Cart' })).toBeVisible();

            await openDeepLink(pageB, '/cart?cart=PROD-004&cart=PROD-004&cart=PROD-004', 'Your Shopping Cart');
            await expect(productCards(pageB).filter({ hasText: 'Blender 3000' }).first()).toBeVisible();
            await pageB.locator(`${T('checkout')} button`).click();
            await expect(pageB.locator(T('confirmation'))).toBeVisible();
            await expect(pageB.locator(`${T('confirmation')} h1`)).toHaveText('Order Confirmed');

            await pageA.locator(`${T('detail')} button`, { hasText: 'Add to Cart' }).click();

            await expect(toast(pageA)).toBeVisible();
            await expect(toast(pageA)).toContainText('Stock Problem');
            await expect(toast(pageA)).toContainText('Someone grabbed the last one!');

            await expect(pageA.locator(T('nav-cart'))).toHaveAttribute('aria-label', 'Show cart with 0 items');
        } finally {
            await contextA.close();
            await contextB.close();
        }
    });

    test('should show checkout failure toast when cart contains only out-of-stock items', async ({ page }) => {
        await openDeepLink(page, '/cart?cart=PROD-006', 'Your Shopping Cart');

        await expect(productCards(page).filter({ hasText: '4K Webcam Pro' })).toBeVisible();

        await page.locator(`${T('checkout')} button`).click();

        await expect(toast(page)).toBeVisible();
        await expect(toast(page)).toContainText('Checkout Failed');
        await expect(toast(page)).toContainText('Already-placed orders were not cancelled');

        await expect(productsHeading(page)).toHaveText('Your Shopping Cart');

        await expect(page.locator(T('empty'))).toBeVisible();
        await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 0 items');
    });

    test('should partially commit orders when checkout has a mix of in-stock and out-of-stock items', async ({ page }) => {
        await openDeepLink(page, '/cart?cart=PROD-001&cart=PROD-006', 'Your Shopping Cart');

        await expect(productCards(page).filter({ hasText: 'Smartphone 15 Pro' })).toBeVisible();
        await expect(productCards(page).filter({ hasText: '4K Webcam Pro' })).toBeVisible();

        await page.locator(`${T('checkout')} button`).click();

        await expect(toast(page)).toBeVisible();
        await expect(toast(page)).toContainText('Already-placed orders were not cancelled');

        await expect(productsHeading(page)).toHaveText('Your Shopping Cart');
        await expect(page.locator(T('empty'))).toBeVisible();
        await expect(cartNavButton(page)).toHaveAttribute('aria-label', 'Show cart with 0 items');

        await openDeepLink(page, '/orders', 'Your Orders');

        await expect(productCards(page).filter({ hasText: /Order ord-/ }).first()).toBeVisible();
        await expect(productCards(page).filter({ hasText: '$999.00' }).first()).toBeVisible();
    });

});

test.describe('direct URL deep-linking', () => {

    test('should render Electronics category when deep-linked via /frontend/category?category=c1', async ({ page }) => {
        await openDeepLink(page, '/category?category=c1', 'Electronics');
        await expect(navButton(page, 'Electronics')).toHaveAttribute('aria-current', 'page');
        await expect(navButton(page, 'Home')).not.toHaveAttribute('aria-current');
        await expect(productCards(page)).not.toHaveCount(0);
        await expect(productCards(page).filter({ hasText: 'Smartphone 15 Pro' })).toBeVisible();
    });

    test('should render product detail view when deep-linked via /frontend/product?sku=PROD-001&category=c1', async ({ page }) => {
        await page.goto(`${baseURL}/frontend/product?sku=PROD-001&category=c1`);
        await expect(page.locator('[x-cloak]')).toHaveCount(0);

        const details = detailsView(page);
        await expect(details).toBeVisible();
        await expect(details.locator('h1')).toHaveText('Smartphone 15 Pro');

        await expect(details.locator(T('detail-price'))).toContainText('$999.00');

        await expect(navButton(page, 'Electronics')).toHaveAttribute('aria-current', 'page');
    });

    test('should render home view when deep-linked via /frontend/home', async ({ page }) => {
        await openDeepLink(page, '/home', 'Featured Products');
        await expect(navButton(page, 'Home')).toHaveAttribute('aria-current', 'page');
        await expect(productCards(page)).not.toHaveCount(0);
    });

});

test.describe('orders nav button', () => {

    test('should show Orders button in the nav bar', async ({ page }) => {
        await openFrontend(page);
        await expect(navButton(page, 'Orders')).toBeVisible();
    });

    test('should navigate to orders view when Orders nav button is clicked', async ({ page }) => {
        await openFrontend(page);
        await navButton(page, 'Orders').click();
        await expect(productsHeading(page)).toHaveText('Your Orders');
        await expect(navButton(page, 'Orders')).toHaveAttribute('aria-current', 'page');
    });

});

test.describe('empty-cart checkout guard', () => {

    test('should redirect to cart with a danger toast when checkout URL is visited directly with no cart items', async ({ page }) => {
        await page.goto(`${baseURL}/frontend/actions/checkout`);
        await expect(page.locator('[x-cloak]')).toHaveCount(0);
        await expect(navButton(page, /./).first()).toBeVisible();

        await expect(productsHeading(page)).toHaveText('Your Shopping Cart');
        await expect(page.locator(T('empty'))).toBeVisible();

        await expect(toast(page)).toBeVisible();
        await expect(toast(page)).toContainText('Cart is empty');
    });

});

test.describe('wishlist toggle from various views', () => {

    test('should toggle wishlist heart on a recommendation card in product detail view', async ({ page }) => {
        await page.goto(`${baseURL}/frontend/product?sku=PROD-001&category=c1`);
        await expect(page.locator('[x-cloak]')).toHaveCount(0);
        await expect(detailsView(page)).toBeVisible();

        const recs = detailsView(page).locator(T('recommendations'));
        await expect(recs).toBeVisible();
        const recCard = recs.locator(T('card')).first();
        await expect(recCard).toBeVisible();

        const toggle = recCard.locator(T('wishlist-toggle'));
        await expect(toggle).toBeVisible();

        await toggle.click();

        await expect(detailsView(page).locator('h1')).toHaveText('Smartphone 15 Pro');
        expect(page.url()).toContain('sku=PROD-001');

        await expect(wishlistNavButton(page)).toHaveAttribute('aria-label', 'Show wishlist with 1 item');

        await expect(toast(page)).toBeVisible();
        await expect(toast(page)).toContainText('wishlist');
    });

    test('should toggle wishlist from search results', async ({ page }) => {
        await openDeepLink(page, '/search?search=Blender', 'Results for "Blender"');

        const card = productCards(page).filter({ hasText: 'Blender 3000' });
        await card.locator(T('wishlist-toggle')).click();

        await expect(productsHeading(page)).toHaveText('Results for "Blender"');
        expect(page.url()).toContain('search=Blender');

        await expect(wishlistNavButton(page)).toHaveAttribute('aria-label', 'Show wishlist with 1 item');
    });

    test('should not show wishlist toggle on cart cards (use "Move to Wishlist" instead)', async ({ page }) => {
        await openDeepLink(page, '/cart?cart=PROD-002', 'Your Shopping Cart');

        const card = productCards(page).filter({ hasText: 'Wireless Headphones' });
        await expect(card.locator(T('wishlist-toggle'))).toHaveCount(0);
        await expect(card.locator('button', { hasText: 'Move to Wishlist' })).toBeVisible();
    });

    test('search uses server-provided nav.search.href — no hard-coded BFF URLs', async ({ page }) => {
        await openFrontend(page);

        const searchInput = page.locator(`${T('search')} input`);
        await searchInput.click();
        await searchInput.pressSequentially('Blender');
        await searchInput.press('Enter');

        await expect(productsHeading(page)).toContainText('Results for "Blender"');
        await expect(productCards(page).filter({ hasText: 'Blender 3000' })).toBeVisible();
        expect(page.url()).toContain('/search');
        expect(page.url()).toContain('search=Blender');
    });

    test('should navigate home from empty listing state via server link', async ({ page }) => {
        await openDeepLink(page, '/wishlist', 'Your Wishlist');
        await expect(page.locator(T('empty'))).toBeVisible();

        await page.locator(`${T('empty')} button`).click();
        await expect(productsHeading(page)).toHaveText('Featured Products');
    });

    test('should navigate home from empty cart state via server link', async ({ page }) => {
        await openDeepLink(page, '/cart', 'Your Shopping Cart');
        await expect(page.locator(T('empty'))).toBeVisible();

        await page.locator(`${T('empty')} button`).click();
        await expect(productsHeading(page)).toHaveText('Featured Products');
    });

    test('should clear search and navigate home via server link', async ({ page }) => {
        await openDeepLink(page, '/search?search=Blender', 'Results for "Blender"');

        // The @input handler on the search input navigates home when the value is cleared.
        const [homeRequest] = await Promise.all([
            page.waitForRequest(req => req.url().includes('/bff/home')),
            page.locator(`${T('search')} input`).evaluate((el: HTMLInputElement) => {
                // Simulate clearing: set value to empty and dispatch an input event.
                const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
                nativeSetter.call(el, '');
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }),
        ]);
        expect(homeRequest.url()).toContain('/bff/home');
        await expect(productsHeading(page)).toHaveText('Featured Products');
    });

    test('should remove an item from the wishlist view via heart toggle', async ({ page }) => {
        await openDeepLink(page, '/wishlist?wishlist=PROD-001', 'Your Wishlist');

        await expect(wishlistNavButton(page)).toHaveAttribute('aria-label', 'Show wishlist with 1 item');
        await expect(productCards(page).filter({ hasText: 'Smartphone 15 Pro' })).toBeVisible();

        const card = productCards(page).filter({ hasText: 'Smartphone 15 Pro' });
        await card.locator(T('wishlist-toggle')).click();

        await expect(wishlistNavButton(page)).toHaveAttribute('aria-label', 'Show wishlist with 0 items');
        await expect(page.locator(T('empty'))).toBeVisible();
        await expect(productsHeading(page)).toHaveText('Your Wishlist');

        await expect(toast(page)).toContainText('Removed from wishlist');
    });

});
