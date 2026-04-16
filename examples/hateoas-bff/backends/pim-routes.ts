import { Type } from '@sinclair/typebox';
import { pimApi, NotFoundSchema } from './pim-api';
import { FastifyRoutePlugin } from '../types';

// --- Mock Data ---

const categories = [
    { id: 'c1', name: 'Electronics' },
    { id: 'c2', name: 'Home & Garden' },
    { id: 'c3', name: 'Kitchen' }
];

const products = [
    // Electronics
    { id: 'p1', sku: 'PROD-001', name: 'Smartphone 15 Pro', description: 'Flagship smartphone with 6.7" OLED display, titanium frame, 48MP triple camera system, and all-day battery life. Water resistant to 6 meters.', categoryId: 'c1', tags: ['new', 'featured'] },
    { id: 'p2', sku: 'PROD-002', name: 'Wireless Headphones', description: 'Premium over-ear headphones with adaptive noise cancellation, spatial audio, and 30-hour battery. Memory foam cushions for all-day comfort.', categoryId: 'c1', tags: ['audio'] },
    { id: 'p5', sku: 'PROD-005', name: 'Mechanical Keyboard', description: 'Compact 75% layout with hot-swappable switches, per-key RGB, PBT keycaps, and USB-C connectivity. Satisfying tactile feedback for typing and gaming.', categoryId: 'c1', tags: ['new', 'peripherals'] },
    { id: 'p6', sku: 'PROD-006', name: '4K Webcam Pro', description: 'Ultra-wide 4K webcam with auto-framing, built-in ring light, and dual noise-cancelling microphones. Perfect for remote work and streaming.', categoryId: 'c1', tags: ['peripherals'] },

    // Home & Garden
    { id: 'p3', sku: 'PROD-003', name: 'Garden Hose', description: 'Premium 50ft expandable garden hose with 9-pattern spray nozzle. Kink-resistant, lightweight, and compact storage. Brass fittings for durability.', categoryId: 'c2', tags: ['garden'] },
    { id: 'p7', sku: 'PROD-007', name: 'Smart Planter', description: 'Self-watering planter with soil moisture sensor, companion app notifications, and built-in LED grow light. Keeps your plants thriving automatically.', categoryId: 'c2', tags: ['new', 'garden', 'smart'] },
    { id: 'p8', sku: 'PROD-008', name: 'Outdoor Solar Lights', description: 'Set of 8 stainless steel solar path lights with warm white LEDs. Auto on/off at dusk/dawn, IP65 waterproof. No wiring needed.', categoryId: 'c2', tags: ['garden', 'lighting'] },

    // Kitchen
    { id: 'p4', sku: 'PROD-004', name: 'Blender 3000', description: 'High-performance blender with 1500W motor, 10-speed control, and self-cleaning mode. Crushes ice and frozen fruit effortlessly. BPA-free pitcher.', categoryId: 'c3', tags: ['kitchen'] },
    { id: 'p9', sku: 'PROD-009', name: 'Pour-Over Coffee Set', description: 'Handcrafted ceramic dripper with double-wall glass carafe, gooseneck kettle, and precision scale. Everything you need for the perfect morning ritual.', categoryId: 'c3', tags: ['new', 'kitchen', 'coffee'] },
    { id: 'p10', sku: 'PROD-010', name: 'Cast Iron Skillet', description: 'Pre-seasoned 12" cast iron skillet, oven-safe to 500°F. Naturally non-stick surface that improves with use. A kitchen heirloom that lasts generations.', categoryId: 'c3', tags: ['kitchen'] },
    // PROD-011 intentionally has no ERP price entry — used to test the BFF's
    // graceful-degradation path when ERP quote returns 404.
    { id: 'p11', sku: 'PROD-011', name: 'Test Product No ERP Price', description: 'A product that exists in PIM but has no pricing in the ERP system.', categoryId: 'c3', tags: [] },
];

const reviews: Record<string, { id: string, author: string, rating: number, text: string }[]> = {
    'PROD-001': [
        { id: 'r1', author: 'Alice', rating: 5, text: 'Amazing phone! The camera is incredible in low light.' },
        { id: 'r2', author: 'Marcus', rating: 4, text: 'Great build quality and battery life. Wish it came in more colors.' },
    ],
    'PROD-002': [
        { id: 'r3', author: 'Charlie', rating: 5, text: 'Best noise cancelling I have ever tried. Worth every penny.' },
        { id: 'r4', author: 'Priya', rating: 4, text: 'Sound quality is superb. A bit heavy for long flights though.' },
    ],
    'PROD-005': [
        { id: 'r5', author: 'Dave', rating: 5, text: 'The tactile switches are perfection. Hot-swap is a game changer.' },
    ],
    'PROD-004': [
        { id: 'r6', author: 'Elena', rating: 5, text: 'Makes the smoothest smoothies. Self-cleaning mode is genius.' },
        { id: 'r7', author: 'Tom', rating: 4, text: 'Powerful motor but a bit loud. Great results though.' },
        { id: 'r8', author: 'Kenji', rating: 5, text: 'Use it daily for protein shakes. Crushes ice like nothing.' },
    ],
    'PROD-009': [
        { id: 'r9', author: 'Sasha', rating: 5, text: 'Elevated my morning coffee routine. The gooseneck kettle is essential.' },
    ],
    'PROD-010': [
        { id: 'r10', author: 'Julia', rating: 5, text: 'Perfect sear on steaks every time. Already planning to buy a second one.' },
        { id: 'r11', author: 'Marco', rating: 5, text: 'Passed down from my grandmother — still going strong. This is the real deal.' },
    ],
};

// --- Routes ---

export const pimRoutes: FastifyRoutePlugin = async (fastify) => {

    fastify.get('/pim', {
        schema: {
            response: {
                200: pimApi.root.schema
            }
        }
    }, async () => {
        return {
            categoriesUrl: '/pim/categories',
            productsByCategoryUrl: '/pim/categories/{id}/products',
            tagSearchUrl: '/pim/products{?tag}',
            textSearchUrl: '/pim/products{?q}',
            productUrl: '/pim/products/{sku}'
        };
    });

    fastify.get('/pim/categories', {
        schema: {
            response: {
                200: pimApi.categories.schema
            }
        }
    }, async () => {
        return {
            items: categories.map(c => ({
                ...c,
                productsUrl: `/pim/categories/${c.id}/products`
            }))
        };
    });

    fastify.get('/pim/categories/:id', {
        schema: {
            params: Type.Object({ id: Type.String() }),
            response: {
                200: pimApi.category.schema,
                404: Type.Null()
            }
        }
    }, async (req, reply) => {
        const { id } = req.params;
        const c = categories.find(cat => cat.id === id);
        if (!c) return reply.code(404).send();
        return {
            ...c,
            productsUrl: `/pim/categories/${c.id}/products`
        };
    });

    fastify.get('/pim/categories/:id/products', {
        schema: {
            params: Type.Object({ id: Type.String() }),
            response: {
                200: pimApi.products.schema
            }
        }
    }, async (req) => {
        const { id } = req.params;
        const items = products.filter(p => p.categoryId === id);
        return {
            items: items.map(mapProduct)
        };
    });

    fastify.get('/pim/products', {
        schema: {
            querystring: Type.Object({
                tag: Type.Optional(Type.String()),
                q: Type.Optional(Type.String())
            }),
            response: {
                200: pimApi.products.schema
            }
        }
    }, async (req) => {
        const { tag, q } = req.query;
        let items = products;
        if (tag) {
            items = items.filter(p => p.tags.includes(tag));
        }
        if (q) {
            const lower = q.toLowerCase();
            items = items.filter(p =>
                p.name.toLowerCase().includes(lower) ||
                p.description.toLowerCase().includes(lower)
            );
        }
        return {
            items: items.map(mapProduct)
        };
    });

    fastify.get('/pim/products/:sku', {
        schema: {
            params: Type.Object({ sku: Type.String() }),
            response: {
                200: pimApi.product.schema,
                404: NotFoundSchema
            }
        }
    }, async (req, reply) => {
        const { sku } = req.params;
        const p = products.find(prod => prod.sku === sku);
        if (!p) return reply.code(404).send({ message: `Product not found: ${sku}` });
        return mapProduct(p);
    });

    fastify.get('/pim/products/:sku/related', {
        schema: {
            params: Type.Object({ sku: Type.String() }),
            response: {
                200: pimApi.products.schema,
                404: Type.Null()
            }
        }
    }, async (req, reply) => {
        const { sku } = req.params;
        const p = products.find(prod => prod.sku === sku);
        if (!p) return reply.code(404).send();

        // Simple logic: same category, excluding self
        const related = products
            .filter(other => other.categoryId === p.categoryId && other.id !== p.id)
            .slice(0, 3);

        return {
            items: related.map(mapProduct)
        };
    });

    fastify.get('/pim/products/:sku/reviews', {
        schema: {
            params: Type.Object({ sku: Type.String() }),
            response: {
                200: pimApi.reviews.schema
            }
        }
    }, async (req, reply) => {
        const { sku } = req.params;
        if (!sku) return { items: [] };
        const items = reviews[sku] || [];
        return { items };
    });
};

function mapProduct(p: typeof products[0]) {
    return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        categoryId: p.categoryId,
        categoryUrl: `/pim/categories/${p.categoryId}`,
        relatedProductsUrl: `/pim/products/${p.sku}/related`,
        reviewsUrl: `/pim/products/${p.sku}/reviews`
    };
}
