// ERP uses flat string URL properties with a *Url suffix (same pattern as PIM and CRM).
// Note: the root resource names the stock link "stockUrl"; the quote resource renames it
// "checkStockUrl" to convey intent at the call site — both resolve to the same 'stock' resource.
// See AGENTS.md Core Concept #5 for the two link-pattern options.
import { Type } from '@sinclair/typebox';
import { defineLinks, Simplify } from '../../../src';

// --- Schemas ---

export const PriceQuoteSchema = Type.Object({
    sku: Type.String(),
    price: Type.Number(),
    currency: Type.String(),
    availableStock: Type.Number(),
    orderUrl: Type.String(),
    checkStockUrl: Type.String()
});

export const StockStatusSchema = Type.Object({
    sku: Type.String(),
    inStock: Type.Boolean(),
    quantity: Type.Number()
});

export const LineItemSchema = Type.Object({
    sku: Type.String(),
    quantity: Type.Number(),
    price: Type.Number(),
    subtotal: Type.Number()
});

export const OrderSchema = Type.Object({
    id: Type.String(),
    status: Type.String(),
    total: Type.Number(),
    items: Type.Array(LineItemSchema),
    paymentUrl: Type.String()
});

export const OrderListSchema = Type.Object({
    items: Type.Array(OrderSchema)
});

export const QuoteNotFoundSchema = Type.Object({
    sku: Type.String(),
    message: Type.String()
});

// --- API Definition ---

const apiDef = defineLinks(['root', 'quote', 'quoteNotFound', 'stock', 'orders', 'order'], {
    root: {
        schema: Type.Object({
            ordersUrl: Type.String(),
            quoteUrl: Type.String(),
            stockUrl: Type.String()
        }),
        links: {
            'ordersUrl': { to: 'orders' },
            'quoteUrl': {
                to: 'quote',
                params: { sku: Type.String() },
                expect: { 404: 'quoteNotFound' }
            },
            'stockUrl': { to: 'stock', params: { sku: Type.String() } }
        }
    },
    quote: {
        schema: PriceQuoteSchema,
        links: {
            'orderUrl': { to: 'order' },
            'checkStockUrl': { to: 'stock' }
        }
    },
    stock: {
        schema: StockStatusSchema,
        links: {}
    },
    orders: {
        schema: OrderListSchema,
        links: {
            'items[].paymentUrl': { to: 'order' }
        }
    },
    order: {
        schema: OrderSchema,
        links: {}
    },
    quoteNotFound: {
        schema: QuoteNotFoundSchema,
        links: {}
    }
});

export interface ErpApi extends Simplify<typeof apiDef> { }
export const erpApi: ErpApi = apiDef;
