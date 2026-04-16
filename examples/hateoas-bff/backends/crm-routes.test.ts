import Fastify from 'fastify';
import { crmApi } from './crm-api';
import { crmRoutes } from './crm-routes';
import { Type } from '@sinclair/typebox';

describe('CRM Service', () => {

    // 1. Validation Test
    // Importing crmApi naturally triggers validation inside `defineLinks`.
    // If validation failed, this test file wouldn't even run properly or would throw on import.
    // We can explicitly check it exists.
    it('should have a valid API definition', () => {
        expect(crmApi).toBeDefined();
        expect(crmApi.root).toBeDefined();
        expect(crmApi.profile).toBeDefined();
    });

    // 2. Integration Test (mocked server)
    it('should return valid Natural JSON responses matching the schema', async () => {
        const fastify = Fastify();
        await fastify.register(crmRoutes);

        // Root
        const rootRes = await fastify.inject({ method: 'GET', url: '/crm' });
        expect(rootRes.statusCode).toBe(200);
        const rootBody = rootRes.json();

        // Check Natural JSON link structure
        expect(rootBody.profileUrl).toBeDefined();
        // Ensure no _links
        expect(rootBody._links).toBeUndefined();

        // Profile
        const profileRes = await fastify.inject({ method: 'GET', url: rootBody.profileUrl });
        expect(profileRes.statusCode).toBe(200);
        const profileBody = profileRes.json();

        expect(profileBody.name).toBe('Jane Doe');
        expect(profileBody.offersUrl).toBeDefined();

        // Offers
        const offersRes = await fastify.inject({ method: 'GET', url: profileBody.offersUrl });
        expect(offersRes.statusCode).toBe(200);
        const offersBody = offersRes.json();

        expect(Array.isArray(offersBody.items)).toBe(true);
        expect(offersBody.items[0].code).toBeDefined();
    });
});
