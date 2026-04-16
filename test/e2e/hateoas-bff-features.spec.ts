
import { FastifyInstance } from 'fastify';
import { bffApi, BffApi } from '../../examples/hateoas-bff/bff-api';
import { createBffServer } from '../../examples/hateoas-bff/server';
import { linkTo, navigate, RootNavigable } from '../../src';

// Coverage for BFF features that the original `hateoas-bff.spec.ts` journey
// doesn't exercise. Grouped by feature in describe blocks so they can be
// split into dedicated files later.

describe('HATEOAS BFF feature coverage', () => {

    let server: FastifyInstance;
    let address: string;
    let mainLink: RootNavigable<'main', BffApi>;

    beforeAll(async () => {
        const started = await createBffServer();
        server = started.server;
        address = started.address;
        mainLink = linkTo({ api: bffApi, resource: 'main', url: `${address}/bff` });
    });

    afterAll(async () => {
        await server.close();
    });

    async function loadHome() {
        return navigate(mainLink);
    }

    /** Navigate to an arbitrary BFF URL (used to simulate the frontend-built search URL). */
    async function loadUrl(path: string) {
        return navigate(linkTo({ api: bffApi, resource: 'main', url: `${address}${path}` }));
    }

    async function loadProduct(title: string) {
        const home = await loadHome();
        for (const categoryLink of home.nav.categories) {
            const category = await navigate(categoryLink);
            const card = category.view.listing?.products?.cards.find(c => c.title === title);
            if (card) return navigate(card);
        }
        throw new Error(`Product "${title}" not found in any category`);
    }

    /** Add a product to the cart and return the resulting cart view. */
    async function addProductToCart(title: string) {
        const product = await loadProduct(title);
        const addToCart = product.view.detail?.productDetails?.addToCart;
        if (!addToCart) throw new Error(`"${title}" cannot be added to cart`);
        return navigate(addToCart);
    }

    describe('CRM greeting and promo banner', () => {
        it('should include the CRM user profile on every state', async () => {
            const home = await loadHome();

            expect(home.chrome.user?.name).toBe('Jane Doe');
            expect(home.chrome.user?.loyaltyPoints).toBeGreaterThanOrEqual(0);
        });

        it('should surface the top CRM offer as a promo banner', async () => {
            const home = await loadHome();

            expect(home.chrome.promo?.code).toBe('WELCOME10');
            expect(home.chrome.promo?.description).toBe('10% off your first order');
            expect(home.chrome.promo?.discount).toBeCloseTo(0.1);
        });
    });

    describe('backend attribution footer', () => {
        it('should list PIM, ERP and CRM on the home view', async () => {
            const home = await loadHome();

            const ids = home.meta?.dataSources?.map(s => s.id);
            expect(ids).toEqual(expect.arrayContaining(['pim', 'erp', 'crm']));
            expect(ids).not.toContain('dam');
            // Roles round-trip so the UI footer can render them unchanged.
            const pim = home.meta?.dataSources?.find(s => s.id === 'pim');
            expect(pim?.name).toBe('PIM');
            expect(pim?.role).toBe('Catalog & Reviews');
        });

        it('should add DAM to the attribution when a product detail has images', async () => {
            const product = await loadProduct('Smartphone 15 Pro');

            const ids = product.meta?.dataSources?.map(s => s.id);
            expect(ids).toContain('dam');
        });

        it('should omit DAM when a product detail has no DAM assets', async () => {
            const product = await loadProduct('Garden Hose');

            const ids = product.meta?.dataSources?.map(s => s.id);
            expect(ids).not.toContain('dam');
        });
    });

    describe('breadcrumbs', () => {
        it('should have no breadcrumbs on the home view', async () => {
            const home = await loadHome();

            expect(home.chrome.breadcrumbs).toBeUndefined();
        });

        it('should show a two-level trail on a category view', async () => {
            const home = await loadHome();
            const electronics = home.nav.categories.find(c => c.title === 'Electronics')!;
            const category = await navigate(electronics);

            expect(category.chrome.breadcrumbs).toEqual([
                { title: 'Home', href: expect.any(String) },
                { title: 'Electronics' }
            ]);
            // The leaf crumb has no href — it represents the current page.
            expect(category.chrome.breadcrumbs?.[category.chrome.breadcrumbs.length - 1].href).toBeUndefined();
        });

        it('should show a three-level trail on a product detail view', async () => {
            const product = await loadProduct('Smartphone 15 Pro');

            const titles = product.chrome.breadcrumbs?.map(b => b.title);
            expect(titles).toEqual(['Home', 'Electronics', 'Smartphone 15 Pro']);
        });

        it('should allow navigating back to the category via a breadcrumb link', async () => {
            const product = await loadProduct('Smartphone 15 Pro');
            const categoryCrumb = product.chrome.breadcrumbs?.find(b => b.title === 'Electronics');
            expect(categoryCrumb?.href).toBeDefined();

            const category = await navigate(categoryCrumb!);

            expect(category.view.listing?.products?.heading).toBe('Electronics');
            expect(category.view.detail).toBeUndefined();
        });
    });

    describe('product search', () => {
        it('should return server-driven results for a query', async () => {
            const results = await loadUrl('/bff/search?search=Smartphone');

            expect(results.view.listing?.products?.heading).toBe('Results for "Smartphone"');
            expect(results.view.listing?.products?.cards.map(c => c.title)).toContain('Smartphone 15 Pro');
        });

        it('should render a dedicated empty state when nothing matches', async () => {
            const results = await loadUrl('/bff/search?search=zzznope');

            expect(results.view.listing?.products?.heading).toBe('No results for "zzznope"');
            expect(results.view.listing?.products?.cards).toEqual([]);
        });

        // Regression: previously `updatedStateUrl` did not reset `search`, so card
        // hrefs in search results carried `search=…` through to the detail request,
        // and the BFF re-entered the search branch instead of product-detail.
        it('should open product details from a search result without staying in search mode', async () => {
            const results = await loadUrl('/bff/search?search=Smartphone');
            const card = results.view.listing?.products?.cards.find(c => c.title === 'Smartphone 15 Pro');
            expect(card).toBeDefined();

            const product = await navigate(card!);

            expect(product.view.detail?.productDetails?.name).toBe('Smartphone 15 Pro');
            expect(product.view.listing).toBeUndefined();
        });
    });

    describe('sort options on a category', () => {
        it('should default to name sort with all three options listed', async () => {
            const home = await loadHome();
            const electronics = home.nav.categories.find(c => c.title === 'Electronics')!;
            const category = await navigate(electronics);

            const sort = category.view.listing?.sortOptions;
            expect(sort?.map(s => s.title)).toEqual([
                'Name',
                'Price: Low → High',
                'Price: High → Low',
            ]);
            expect(sort?.find(s => s.title === 'Name')?.selected).toBe(true);
        });

        it('should reorder cards when following the price-ascending sort link', async () => {
            const home = await loadHome();
            const electronics = home.nav.categories.find(c => c.title === 'Electronics')!;
            const category = await navigate(electronics);
            const priceAsc = category.view.listing?.sortOptions?.find(s => s.title === 'Price: Low → High')!;

            const sorted = await navigate(priceAsc);

            // Subtitles are formatted as "$NNN.NN"; parse and verify non-decreasing order.
            const prices = sorted.view.listing?.products?.cards.map(c =>
                parseFloat((c.subtitle ?? '$0').replace('$', ''))
            ) ?? [];
            expect(prices.length).toBeGreaterThan(1);
            for (let i = 1; i < prices.length; i++) {
                expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
            }
            expect(sorted.view.listing?.sortOptions?.find(s => s.title === 'Price: Low → High')?.selected).toBe(true);
        });
    });

    describe('wishlist', () => {
        it('should toggle a product into the wishlist and list it under "Your Wishlist"', async () => {
            const home = await loadHome();
            const card = home.view.listing?.products?.cards.find(c => c.actions?.wishlistToggle)!;
            expect(card.actions?.wishlistToggle?.inWishlist).toBe(false);

            const afterToggle = await navigate(card.actions!.wishlistToggle!);
            expect(afterToggle.nav.wishlist.count).toBe(1);

            const wishlist = await navigate(afterToggle.nav.wishlist);
            expect(wishlist.view.listing?.products?.heading).toBe('Your Wishlist');
            expect(wishlist.view.listing?.products?.cards.length).toBe(1);
            expect(wishlist.view.listing?.products?.cards[0].title).toBe(card.title);
        });

        it('should expose an add-to-cart link on in-stock wishlist items', async () => {
            const home = await loadHome();
            const card = home.view.listing?.products?.cards.find(c => c.title === 'Smartphone 15 Pro')!;
            const withItem = await navigate(card.actions!.wishlistToggle!);
            const wishlist = await navigate(withItem.nav.wishlist);

            const wishlistCard = wishlist.view.listing?.products?.cards[0];
            expect(wishlistCard?.actions?.addToCart?.title).toBe('Add to Cart');

            const cart = await navigate(wishlistCard!.actions!.addToCart!);
            expect(cart.nav.cart.count).toBe(1);
            expect(cart.view.cart?.products?.cards[0].title).toBe('Smartphone 15 Pro');
        });
    });

    describe('cart actions', () => {
        it('should remove an item from the cart via the remove link', async () => {
            const cart = await addProductToCart('Smartphone 15 Pro');
            expect(cart.nav.cart.count).toBe(1);
            const removeFromCart = cart.view.cart?.products?.cards[0].actions?.removeFromCart!;
            expect(removeFromCart.title).toBe('Remove');

            const emptied = await navigate(removeFromCart);
            expect(emptied.nav.cart.count).toBe(0);
            expect(emptied.view.cart?.products?.cards).toEqual([]);
        });

        it('should move an item from the cart to the wishlist via "Move to Wishlist"', async () => {
            const cart = await addProductToCart('Smartphone 15 Pro');
            const saveForLater = cart.view.cart?.products?.cards[0].actions?.moveToWishlist!;
            expect(saveForLater.title).toBe('Move to Wishlist');

            const afterMove = await navigate(saveForLater);
            expect(afterMove.nav.cart.count).toBe(0);
            expect(afterMove.nav.wishlist.count).toBe(1);

            const wishlist = await navigate(afterMove.nav.wishlist);
            expect(wishlist.view.listing?.products?.cards[0].title).toBe('Smartphone 15 Pro');
        });

        it('should preserve the wishlist count when removing an item from the cart', async () => {
            // Load the cart view with one cart item (PROD-002) and one wishlist item (PROD-001)
            // directly via URL to isolate the remove-from-cart behaviour from the add-to-cart flow.
            const withBoth = await loadUrl('/bff/cart?cart=PROD-002&wishlist=PROD-001');
            expect(withBoth.nav.cart.count).toBe(1);
            expect(withBoth.nav.wishlist.count).toBe(1);

            // Remove the single cart item via the remove link — wishlist must survive.
            const removeFromCart = withBoth.view.cart?.products?.cards[0].actions?.removeFromCart!;
            const afterRemove = await navigate(removeFromCart);
            expect(afterRemove.nav.cart.count).toBe(0);
            expect(afterRemove.nav.wishlist.count).toBe(1);
        });
    });

    describe('cart summary', () => {
        it('should apply the top CRM offer as a discount on the cart total', async () => {
            // Smartphone 15 Pro is $999; WELCOME10 is 10% → discount $99.90, total $899.10
            const cart = await addProductToCart('Smartphone 15 Pro');

            expect(cart.view.cart?.cartSummary?.subtotal).toBe(999);
            expect(cart.view.cart?.cartSummary?.discount?.code).toBe('WELCOME10');
            expect(cart.view.cart?.cartSummary?.discount?.amount).toBeCloseTo(99.9, 2);
            expect(cart.view.cart?.cartSummary?.total).toBeCloseTo(899.1, 2);
            // Checkout CTA reflects the discounted total.
            expect(cart.view.cart?.checkout?.title).toBe('Checkout — $899.10');
        });

        it('should award one loyalty point per whole dollar of total', async () => {
            const cart = await addProductToCart('Smartphone 15 Pro');

            expect(cart.view.cart?.loyaltyEarn).toBe(Math.floor(cart.view.cart!.cartSummary!.total));
        });

        it('should qualify a high-value cart for free shipping', async () => {
            // $899.10 total clears the $500 threshold.
            const cart = await addProductToCart('Smartphone 15 Pro');

            expect(cart.view.cart?.cartSummary?.freeShipping.threshold).toBe(500);
            expect(cart.view.cart?.cartSummary?.freeShipping.qualifies).toBe(true);
            expect(cart.view.cart?.cartSummary?.freeShipping.remaining).toBe(0);
            expect(cart.view.cart?.cartSummary?.freeShipping.progress).toBe(100);
        });

        it('should show progress toward free shipping for a low-value cart', async () => {
            // Cast Iron Skillet is $59.99; after 10% WELCOME10 discount total is $53.99.
            const cart = await addProductToCart('Cast Iron Skillet');

            const shipping = cart.view.cart?.cartSummary?.freeShipping;
            expect(shipping?.qualifies).toBe(false);
            expect(shipping?.progress).toBeGreaterThan(0);
            expect(shipping?.progress).toBeLessThan(100);
            expect(shipping?.remaining).toBeGreaterThan(0);
            expect(shipping?.remaining).toBeLessThan(500);
        });

        it('should surface "You might also like" recommendations for a non-empty cart', async () => {
            const cart = await addProductToCart('Smartphone 15 Pro');

            expect(cart.view.cart?.recommendations?.heading).toBe('You might also like');
            expect(cart.view.cart?.recommendations?.cards.length).toBeGreaterThan(0);
            // Recommendations must not include the item already in the cart.
            expect(cart.view.cart?.recommendations?.cards.map(c => c.title)).not.toContain('Smartphone 15 Pro');
        });
    });

    describe('checkout and order history', () => {
        // Defensive guard: the BFF checkout action must redirect to the cart view with a
        // danger toast when the cart query param is missing or empty. A user could arrive
        // at the checkout URL via browser history, a direct bookmark, or a race where
        // items are removed between page load and button click.
        it('should redirect to cart with a danger toast when checkout is called with an empty cart', async () => {
            // Hit the action route directly — no cart params — without following redirects.
            const response = await fetch(`${address}/bff/actions/checkout`, { redirect: 'manual' });

            // The guard must redirect (302 or 303) to the cart view.
            expect(response.status).toBeGreaterThanOrEqual(300);
            expect(response.status).toBeLessThan(400);

            const location = response.headers.get('location');
            expect(location).toMatch(/\/bff\/cart/);

            // The redirect URL must carry the danger toast params.
            const url = new URL(location!, address);
            expect(url.searchParams.get('variant')).toBe('danger');
            expect(url.searchParams.get('message')).toMatch(/empty/i);
        });

        it('should check out a cart and land on the order confirmation with viewOrders', async () => {
            const cart = await addProductToCart('Wireless Headphones');
            const confirmation = await navigate(cart.view.cart!.checkout!);

            expect(confirmation.view.confirmation?.summary?.orderId).toMatch(/^ord-/);
            expect(confirmation.view.confirmation?.summary?.itemCount).toBe(1);
            expect(confirmation.view.confirmation?.summary?.total).toBe(249);
            expect(confirmation.view.confirmation?.viewOrders?.title).toBe('View All Orders');
            // Confirmation view also surfaces a success toast built from the redirect query.
            expect(confirmation.chrome.toast?.title).toBe('Order Confirmed');
            expect(confirmation.chrome.toast?.message).toMatch(/^Order placed successfully!/);
            expect(confirmation.chrome.toast?.message).toContain('loyalty points earned');
        });

        it('should fall back to the orders list with a danger toast when the confirmation order id is unknown', async () => {
            // Simulates a bookmarked, reloaded, or tampered order-confirmation URL.
            const result = await loadUrl('/bff/order-confirmation?orderId=nonexistent');

            // No confirmation panel — the helper falls back to the orders list.
            expect(result.view.confirmation).toBeUndefined();
            expect(result.view.listing?.products?.heading).toBe('Your Orders');
            // And a danger toast explains what happened.
            expect(result.chrome.toast?.variant).toBe('danger');
            expect(result.chrome.toast?.title).toBe('Order not found');
            expect(result.chrome.toast?.message).toContain('nonexistent');
            // Breadcrumbs must reflect the fallback orders view, not the
            // intended-but-failed 'order-confirmation' query param (FINDING-02).
            expect(result.chrome.breadcrumbs).toEqual([
                { title: 'Home', href: expect.stringContaining('/bff') },
                { title: 'Orders' }
            ]);
        });

        it('should list placed orders under "Your Orders" when following viewOrders', async () => {
            const cart = await addProductToCart('Wireless Headphones');
            const confirmation = await navigate(cart.view.cart!.checkout!);
            const orders = await navigate(confirmation.view.confirmation!.viewOrders!);

            expect(orders.view.listing?.products?.heading).toBe('Your Orders');
            expect(orders.view.listing?.products?.cards.length).toBeGreaterThan(0);
            // Order cards carry status badges sourced from the ERP.
            const first = orders.view.listing?.products?.cards[0];
            expect(first?.title).toMatch(/^Order ord-/);
            expect(first?.badge?.text).toBe('pending');
        });

        // Cross-backend coordination: checkout credits loyalty points to CRM.
        // The CRM profile should show a higher loyaltyPoints after checkout.
        it('should credit loyalty points to the CRM profile after checkout', async () => {
            const profileBefore = await loadUrl('/bff/home');
            const pointsBefore = profileBefore.chrome.user?.loyaltyPoints ?? 0;

            const cart = await addProductToCart('Wireless Headphones');
            await navigate(cart.view.cart!.checkout!);

            // The ERP commits the order at the raw ERP price ($249 for Wireless Headphones),
            // so points credited = Math.floor(249) = 249 (1 point per whole dollar).
            const expectedPoints = 249;

            // Poll the BFF home response until the fire-and-forget CRM credit settles.
            // Up to 10 attempts with 20ms gaps is ample for an in-process call.
            let pointsAfter = pointsBefore;
            for (let i = 0; i < 10; i++) {
                const profileAfter = await loadUrl('/bff/home');
                pointsAfter = profileAfter.chrome.user?.loyaltyPoints ?? 0;
                if (pointsAfter >= pointsBefore + expectedPoints) break;
                await new Promise(r => setTimeout(r, 20));
            }

            expect(pointsAfter).toBe(pointsBefore + expectedPoints);
        });
    });

    describe('toast notifications', () => {
        it('should surface a success toast after adding to cart', async () => {
            const cart = await addProductToCart('Smartphone 15 Pro');

            expect(cart.chrome.toast?.title).toBe('Cart');
            expect(cart.chrome.toast?.message).toBe('Added to cart!');
        });

        it('should not include a toast on a plain home navigation', async () => {
            const home = await loadHome();

            expect(home.chrome.toast).toBeUndefined();
        });
    });

    describe('card enrichment', () => {
        it('should include a description and subtitle price on home cards', async () => {
            const home = await loadHome();
            const card = home.view.listing?.products?.cards[0];

            expect(card?.description?.length).toBeGreaterThan(0);
            expect(card?.subtitle).toMatch(/^\$/);
        });

        it('should mark the out-of-stock 4K Webcam with a danger badge', async () => {
            const home = await loadHome();
            const electronics = home.nav.categories.find(c => c.title === 'Electronics')!;
            const category = await navigate(electronics);
            const webcam = category.view.listing?.products?.cards.find(c => c.title === '4K Webcam Pro');

            expect(webcam?.badge).toEqual({ text: 'Out of Stock', variant: 'danger' });
        });
    });

    describe('prone-link 404 propagation', () => {
        // productUrl is a prone link (expect: { 404: 'notFound' }) in pim-api.ts.
        // When the BFF productView navigates it with an unknown SKU, PIM returns 404
        // with a typed body and the BFF propagates a clean 404 — not a 500.
        it('should return HTTP 404 from /bff/product when the SKU is unknown', async () => {
            const res = await fetch(`${address}/bff/product?sku=BOGUS`);

            expect(res.status).toBe(404);
            const body = await res.json() as { message: string };
            expect(body.message).toMatch(/BOGUS/);
        });
    });

    describe('URL-sourced input audit — graceful handling without prone links', () => {
        // Audit per docs/hateoas-bff-example.md §8 TODO #2.

        // category — categoryView checks categories.items.find() before any PIM call.
        // An unknown category ID returns an empty view (200) rather than 500.
        // No prone-link treatment needed: the guard is a local in-memory lookup, not a
        // backend navigate() call that could throw.
        it('should return 200 with an empty view for an unknown category', async () => {
            const result = await loadUrl('/bff/category?category=BOGUS');

            expect(result.view.listing).toBeUndefined();
            expect(result.view.detail).toBeUndefined();
        });

        // search — PIM textSearch always returns 200 with empty items for no-match queries.
        // An unexpected input can never cause a backend 404; the empty-results path is the
        // correct response. No prone-link treatment needed.
        it('should return 200 with an empty results heading for a no-match search', async () => {
            const result = await loadUrl('/bff/search?search=ZZZNOMATCH_BOGUS');

            expect(result.view.listing?.products?.heading).toMatch(/No results/);
            expect(result.view.listing?.products?.cards).toEqual([]);
        });

        // orderId — ERP has no single-order GET endpoint; orderConfirmationView fetches
        // the full orders list and finds by id in memory. Unknown id falls back to the
        // orders list with a danger toast — already covered in checkout tests. Confirmed
        // no prone-link treatment needed.

        // add-to-cart with bogus SKU — ERP POST /erp/orders returns 404 for unknown SKUs.
        // The action route already handles this explicitly and redirects with a danger toast.
        it('should redirect with a danger toast when adding a bogus SKU to the cart', async () => {
            const res = await fetch(`${address}/bff/actions/add-to-cart?sku=BOGUS&qty=1`, { redirect: 'manual' });

            expect(res.status).toBeGreaterThanOrEqual(300);
            expect(res.status).toBeLessThan(400);
            const location = res.headers.get('location')!;
            const url = new URL(location, address);
            expect(url.searchParams.get('variant')).toBe('danger');
            expect(url.searchParams.get('message')).toMatch(/Unknown product/i);
        });

        // toggle-wishlist with bogus SKU — pure URL state manipulation, no backend call.
        // No adverse effect possible; no prone-link treatment needed.
    });
});
