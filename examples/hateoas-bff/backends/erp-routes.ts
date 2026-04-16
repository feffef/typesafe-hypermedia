import { Type } from '@sinclair/typebox';
import { erpApi } from './erp-api';
import { FastifyRoutePlugin } from '../types';

// --- Mock Data & Store ---

const prices: Record<string, number> = {
    'PROD-001': 999, 'PROD-002': 249, 'PROD-003': 34.99,
    'PROD-004': 89.99, 'PROD-005': 159, 'PROD-006': 129,
    'PROD-007': 79.99, 'PROD-008': 44.99, 'PROD-009': 124,
    'PROD-010': 59.99,
};

const INITIAL_STOCK: Readonly<Record<string, number>> = Object.freeze({
    'PROD-001': 100, 'PROD-002': 50, 'PROD-003': 200,
    'PROD-004': 3,  // Low stock
    'PROD-005': 75, 'PROD-006': 0,  // Out of stock
    'PROD-007': 40, 'PROD-008': 150,
    'PROD-009': 25, 'PROD-010': 60,
});

const stock: Record<string, number> = { ...INITIAL_STOCK };

// In-memory orders
interface Order {
    id: string;
    items: { sku: string; quantity: number; price: number }[];
    status: string;
    createdAt: number;
}
const orders: Order[] = [];

/**
 * Restore ERP in-memory state to its initial values.
 * Call this in test `beforeEach` hooks to prevent inter-test state leakage.
 */
export function resetErpState(): void {
    Object.keys(stock).forEach(k => delete stock[k]);
    Object.assign(stock, INITIAL_STOCK);
    orders.length = 0;
}


// --- Routes ---

export const erpRoutes: FastifyRoutePlugin = async (fastify) => {

    fastify.get('/erp', {
        schema: {
            response: {
                200: erpApi.root.schema
            }
        }
    }, async () => {
        return {
            ordersUrl: '/erp/orders',
            quoteUrl: '/erp/quotes/{sku}',
            stockUrl: '/erp/stock/{sku}'
        };
    });

    // Quote
    fastify.get('/erp/quotes/:sku', {
        schema: {
            params: Type.Object({ sku: Type.String() }),
            response: {
                200: erpApi.quote.schema,
                404: Type.Null()
            }
        }
    }, async (req, reply) => {
        const { sku } = req.params;
        if (!sku) return reply.code(404).send();
        const price = prices[sku];

        if (price === undefined) return reply.code(404).send();

        return {
            sku,
            price,
            currency: 'USD',
            availableStock: stock[sku] || 0,
            orderUrl: '/erp/orders',
            checkStockUrl: `/erp/stock/${sku}`
        };
    });

    // Real-time Stock Check
    fastify.get('/erp/stock/:sku', {
        schema: {
            params: Type.Object({ sku: Type.String() }),
            response: {
                200: erpApi.stock.schema
            }
        }
    }, async (req, reply) => {
        const { sku } = req.params;
        if (!sku) return { sku: 'unknown', inStock: false, quantity: 0 };
        const qty = stock[sku] || 0;
        return {
            sku,
            inStock: qty > 0,
            quantity: qty
        };
    });

    // List Orders
    fastify.get('/erp/orders', {
        schema: {
            response: {
                200: erpApi.orders.schema
            }
        }
    }, async () => {
        return {
            items: orders.map(o => ({
                id: o.id,
                status: o.status,
                total: o.items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
                items: o.items.map(i => ({
                    ...i,
                    subtotal: i.price * i.quantity
                })),
                paymentUrl: `/erp/orders/${o.id}/pay`
            }))
        };
    });

    // Create Order
    fastify.post('/erp/orders', {
        schema: {
            body: Type.Object({ sku: Type.String(), quantity: Type.Number() }),
            response: {
                201: erpApi.order.schema,
                400: Type.Null(),
                404: Type.Object({ error: Type.String() }),
                409: Type.Object({ error: Type.String() })
            }
        }
    }, async (req, reply) => {
        const { sku, quantity } = req.body;
        const qty = Number(quantity);

        if (!sku || typeof sku !== 'string') return reply.code(400).send();

        if (!(sku in stock)) {
            return reply.code(404).send({ error: 'Unknown SKU' });
        }
        if (stock[sku] < qty) {
            return reply.code(409).send({ error: 'Insufficient stock' });
        }

        // Decrement stock
        stock[sku] -= qty;

        const newOrder: Order = {
            id: `ord-${orders.length + 1}`,
            items: [{ sku, quantity: qty, price: prices[sku] }],
            status: 'pending',
            createdAt: Date.now()
        };
        orders.push(newOrder);

        return reply.code(201).send({
            id: newOrder.id,
            status: 'pending',
            total: prices[sku] * qty,
            items: [{ sku, quantity: qty, price: prices[sku], subtotal: prices[sku] * qty }],
            paymentUrl: `/erp/orders/${newOrder.id}/pay`
        });
    });
};
