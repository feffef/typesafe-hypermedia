import { FastifyInstance } from 'fastify';
import { bffApi } from './bff-api';
import { createBffServer } from './server';
import { assertMatchesSchema } from './test-utils';

describe('BFF Routes Sanity Check', () => {
    let server: FastifyInstance;
    let baseUrl: string;

    beforeAll(async () => {
        const setup = await createBffServer();
        server = setup.server;
        baseUrl = setup.address;
    });

    afterAll(async () => {
        await server.close();
    });

    it('GET /bff should match FrontendState Schema', async () => {
        const res = await server.inject({ method: 'GET', url: '/bff' });
        expect(res.statusCode).toBe(200);

        const body = res.json();

        assertMatchesSchema(bffApi.main.schema, body);
    });

    it('GET /bff/actions/add-to-cart redirects to a relative BFF path', async () => {
        const res = await server.inject({
            method: 'GET',
            url: '/bff/actions/add-to-cart?sku=PROD-001&qty=1'
        });
        expect(res.statusCode).toBe(302);
        expect(res.headers['location']).toMatch(/^\/bff/);
    });

    describe('add-to-cart: unknown SKU shows product-not-found toast, not stock-race toast', () => {
        it('unknown SKU in add-to-cart shows "Unknown product" toast, not "Someone grabbed the last one!"', async () => {
            const res = await server.inject({
                method: 'GET',
                url: '/bff/actions/add-to-cart?sku=PROD-FAKE&qty=1'
            });
            expect(res.statusCode).toBe(302);
            const location = res.headers['location'] as string;
            // Must mention the "not found" message, not the stock-race message
            expect(location).toContain('Unknown%20product');
            expect(location).not.toContain('grabbed');
        });
    });

    describe('ERP quote endpoint returns 404 for unknown SKU', () => {
        it('ERP /erp/quotes/:sku returns 404 when SKU has no pricing data', async () => {
            const erpRes = await server.inject({ method: 'GET', url: '/erp/quotes/PROD-UNKNOWN' });
            expect(erpRes.statusCode).toBe(404);
        });
    });

    describe('productDetailView: missing ERP quote redirects with danger toast', () => {
        it('navigating to a PIM product with no ERP quote returns 200 with a danger toast (not HTTP 500)', async () => {
            // PROD-011 is in the PIM catalog but has no entry in the ERP prices map,
            // so the quote prone-link returns a 404 failure.
            // The BFF should respond 200 with a toast in the state rather than 500.
            const res = await server.inject({ method: 'GET', url: '/bff/product?sku=PROD-011' });
            expect(res.statusCode).toBe(200);
            const body = res.json();
            expect(body.chrome.toast).toBeDefined();
            expect(body.chrome.toast.variant).toBe('danger');
            expect(body.chrome.toast.message).toBe('Product pricing unavailable');
        });
    });
});
