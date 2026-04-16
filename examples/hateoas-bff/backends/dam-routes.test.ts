import Fastify, { FastifyInstance } from 'fastify';
import { damApi, DamApi } from './dam-api';
import { damRoutes } from './dam-routes';
import { linkTo, navigate, RootNavigable } from '../../../src';
import { createInjectFetchFactory } from '../test-utils';

describe('DAM backend', () => {
    let server: FastifyInstance;
    let root: RootNavigable<'root', DamApi>;

    beforeAll(async () => {
        server = Fastify();
        server.register(damRoutes);
        await server.ready();

        root = linkTo({
            api: damApi,
            resource: 'root',
            url: 'http://dam-test/dam',
            fetchFactory: createInjectFetchFactory(server)
        });
    });

    afterAll(async () => {
        await server.close();
    });

    it('root exposes a HAL _links.assets link object', async () => {
        const damRoot = await navigate(root);
        expect(damRoot._links.assets).toBeDefined();
        expect(damRoot._links.assets.href).toBeDefined();
    });

    it('navigates to assets for a known SKU', async () => {
        const damRoot = await navigate(root);
        const [assets, failure] = await navigate(damRoot._links.assets, { params: { sku: 'PROD-001' } });

        expect(failure).toBeNull();
        expect(assets).not.toBeNull();
        expect(assets!.sku).toBe('PROD-001');
        expect(assets!.images).toHaveLength(2);
        expect(assets!._links.self.href).toContain('PROD-001');
    });

    it('returns a 404 failure for an unknown SKU', async () => {
        const damRoot = await navigate(root);
        const [assets, failure] = await navigate(damRoot._links.assets, { params: { sku: 'UNKNOWN' } });

        expect(assets).toBeNull();
        expect(failure).not.toBeNull();
        expect(failure!.kind).toBe('notFound');
        expect(failure!.kind === 'notFound' && failure!.response.status).toBe(404);
        expect(failure!.kind === 'notFound' && failure!.resource.sku).toBe('UNKNOWN');
        expect(failure!.kind === 'notFound' && failure!.resource.message).toBe("No assets found for SKU 'UNKNOWN'");
    });
});
