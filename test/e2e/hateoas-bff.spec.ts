
import { FastifyInstance } from 'fastify';
import { bffApi, BffApi } from '../../examples/hateoas-bff/bff-api';
import { createBffServer } from '../../examples/hateoas-bff/server';
import { linkTo, navigate, RootNavigable } from '../../src';

describe('HATEOAS BFF E2E Journey', () => {

    let server: FastifyInstance;
    let mainLink: RootNavigable<'main', BffApi>;

    beforeAll(async () => {
        const { server: s, address } = await createBffServer();
        server = s;
        mainLink = linkTo({ api: bffApi, resource: 'main', url: `${address}/bff` });
    });

    afterAll(async () => {
        await server.close();
    });

    async function loadHome() {
        return await navigate(mainLink);
    }

    async function loadCategory(title: string) {
        const home = await loadHome();
        const link = home.nav.categories.find(c => c.title === title);
        if (!link) throw new Error(`Category "${title}" not found`);
        return navigate(link);
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

    it('should load the home view', async () => {
        const home = await loadHome();

        expect(home.nav.home.selected).toBe(true);
        expect(home.view.detail).toBeUndefined();
        expect(home.view.listing?.products?.heading).toBe('Featured Products');
        expect(home.view.listing?.products?.cards.length).toBeGreaterThan(0);
    });

    it('should navigate back home via nav link', async () => {
        const category = await loadCategory('Electronics');
        const home = await navigate(category.nav.home);

        expect(home.nav.home.selected).toBe(true);
        expect(home.view.listing?.products?.heading).toBe('Featured Products');
    });

    it('should allow navigating to a category', async () => {
        const category = await loadCategory('Electronics');

        expect(category.nav.categories.find(c => c.title === 'Electronics')?.selected).toBe(true);
        expect(category.view.detail).toBeUndefined();

        expect(category.view.listing?.products?.heading).toBe('Electronics');
        expect(category.view.listing?.products?.cards.length).toBeGreaterThan(0);
    });

    it('should allow navigating to a product', async () => {
        const product = await loadProduct('Smartphone 15 Pro');

        expect(product.nav.categories.find(c => c.title === 'Electronics')?.selected).toBe(true);
        expect(product.view.detail?.productDetails).toBeDefined();
        expect(product.view.detail?.productDetails?.name).toBe('Smartphone 15 Pro');
        expect(product.view.detail?.productDetails?.images.length).toBeGreaterThan(0);

        expect(product.view.detail?.recommendations?.heading).toBe("Related Products");
        expect(product.view.detail?.recommendations?.cards.length).toBeGreaterThan(0);
    });

    it('should allow adding a product to the cart', async () => {
        const product = await loadProduct('Smartphone 15 Pro');
        expect(product.nav.cart.count).toBe(0);

        const addToCart = product.view.detail?.productDetails?.addToCart;
        expect(addToCart).toBeDefined();
        if (addToCart) {
            const cart = await navigate(addToCart);
            expect(cart.nav.cart.selected).toBe(true);
            expect(cart.nav.cart.count).toBe(1);

            expect(cart.view.detail).toBeUndefined();
            expect(cart.view.cart?.products?.heading).toBe('Your Shopping Cart');
            expect(cart.view.cart?.products?.cards.length).toBe(1);
            expect(cart.view.cart?.products?.cards[0].title).toBe('Smartphone 15 Pro');
        }
    });

    describe('category browsing', () => {
        it('should load Home & Garden with its products', async () => {
            const category = await loadCategory('Home & Garden');

            expect(category.view.listing?.products?.heading).toBe('Home & Garden');
            expect(category.view.listing?.products?.cards[0].title).toBe('Garden Hose');
        });

        it('should load Kitchen with its products', async () => {
            const category = await loadCategory('Kitchen');

            expect(category.view.listing?.products?.heading).toBe('Kitchen');
            expect(category.view.listing?.products?.cards[0].title).toBe('Blender 3000');
        });
    });

    describe('product detail variations', () => {
        it('should include product images from DAM', async () => {
            const product = await loadProduct('Smartphone 15 Pro');

            expect(product.view.detail?.productDetails?.images).toEqual([
                'https://dam.example.com/PROD-001-front.jpg',
                'https://dam.example.com/PROD-001-side.jpg'
            ]);
        });

        it('should include price from ERP quote in product details', async () => {
            const product = await loadProduct('Smartphone 15 Pro');

            expect(product.view.detail?.productDetails?.price).toBe(999);
        });

        it('should fall back to empty images when DAM has no assets', async () => {
            const product = await loadProduct('Garden Hose');

            expect(product.view.detail?.productDetails?.images).toEqual([]);
        });

        it('should show related products from the same category', async () => {
            const product = await loadProduct('Garden Hose');

            expect(product.view.detail?.recommendations?.cards?.length).toBeGreaterThan(0);
        });

        it('should include review content on reviewed products', async () => {
            const product = await loadProduct('Smartphone 15 Pro');

            expect(product.view.detail?.productDetails?.reviews?.length).toBeGreaterThan(0);
            expect(product.view.detail?.productDetails?.reviews?.[0].author).toBe('Alice');
        });
    });

    describe('multi-item cart journey', () => {
        it('should build a cart across categories', async () => {
            // Add Smartphone to cart (fresh navigation chain — cart starts empty)
            const smartphone = await loadProduct('Smartphone 15 Pro');
            const cartAfterFirst = await navigate(smartphone.view.detail!.productDetails!.addToCart!);
            expect(cartAfterFirst.nav.cart.count).toBe(1);

            // Navigate to Kitchen from cart — cart count persists via URL state
            const kitchenLink = cartAfterFirst.nav.categories.find(c => c.title === 'Kitchen')!;
            const kitchen = await navigate(kitchenLink);
            expect(kitchen.nav.cart.count).toBe(1);

            // Navigate to Blender detail and add to cart
            const blenderCard = kitchen.view.listing!.products!.cards.find(c => c.title === 'Blender 3000')!;
            const blender = await navigate(blenderCard);
            const cartAfterSecond = await navigate(blender.view.detail!.productDetails!.addToCart!);
            expect(cartAfterSecond.nav.cart.count).toBe(2);
            expect(cartAfterSecond.view.cart?.products?.cards.map(c => c.title)).toEqual(
                expect.arrayContaining(['Smartphone 15 Pro', 'Blender 3000'])
            );
        });

        it('should show low stock after purchase reduces quantity below threshold', async () => {
            // Blender was purchased in previous test (stock 5→4), navigate back to it
            const blender = await loadProduct('Blender 3000');

            expect(blender.view.detail?.productDetails?.stockStatus).toBe('Low Stock');
        });
    });

    describe('FINDING-07: unknown SKU add-to-cart shows not-found toast, not stock-race toast', () => {
        it('redirects with "Unknown product" message for an unrecognised SKU', async () => {
            // Directly call the add-to-cart action with a SKU that does not exist in ERP.
            // The typed navigate() follows redirects and loses the message in the schema,
            // so we use server.inject to inspect the redirect URL directly.
            const res = await server.inject({
                method: 'GET',
                url: '/bff/actions/add-to-cart?sku=PROD-FAKE&qty=1'
            });
            expect(res.statusCode).toBe(302);
            const location = res.headers['location'] as string;
            expect(location).toContain('Unknown%20product');
            expect(location).not.toContain('grabbed');
        });
    });

    describe('stock conflict', () => {
        it('should handle stale add-to-cart after another session depletes stock', async () => {
            // Both sessions browse to Blender while it's still in stock
            const [sessionA, sessionB] = await Promise.all([
                loadProduct('Blender 3000'),
                loadProduct('Blender 3000'),
            ]);
            const staleLink = sessionB.view.detail!.productDetails!.addToCart!;

            // Session A buys all remaining stock one by one
            let blender = sessionA;
            while (blender.view.detail?.productDetails?.addToCart) {
                await navigate(blender.view.detail.productDetails.addToCart);
                blender = await loadProduct('Blender 3000');
            }

            // A no longer sees the add-to-cart link
            expect(blender.view.detail?.productDetails?.stockStatus).toBe('Out of Stock');
            expect(blender.view.detail?.productDetails?.addToCart).toBeUndefined();

            // B uses the stale link — ERP returns 409, BFF redirects back to product
            const conflict = await navigate(staleLink);
            expect(conflict.nav.cart.count).toBe(0);
            expect(conflict.view.detail?.productDetails?.stockStatus).toBe('Out of Stock');
            expect(conflict.view.detail?.productDetails?.addToCart).toBeUndefined();
        });
    });
});
