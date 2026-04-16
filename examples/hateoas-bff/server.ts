/**
 * HATEOAS BFF Example — entry point
 *
 * This single process hosts all logical services on different route prefixes
 * so the example runs with a single `node server.js`. In production each
 * service would live on its own host and the BFF would reach them via
 * environment-configured base URLs instead of the shared-process shortcut
 * used here.
 *
 * Architecture:
 *   /pim  — Product Information Management (catalog, categories, products)
 *   /erp  — Enterprise Resource Planning   (pricing, stock, orders)
 *   /crm  — Customer Relationship Management (profiles, offers)
 *   /dam  — Digital Asset Management        (images, media)
 *   /bff  — Backend For Frontend            (aggregated UI state — start here)
 */
import path from 'path';
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastifyStatic from '@fastify/static';
import { pimRoutes } from './backends/pim-routes';
import { erpRoutes, resetErpState } from './backends/erp-routes';
import { crmRoutes, resetCrmState } from './backends/crm-routes';
import { damRoutes } from './backends/dam-routes';
import { bffRoutes } from './bff-routes';

/**
 * Restore all backend in-memory stores to their initial state.
 * Call this in test `beforeEach` hooks so each test starts from a known baseline.
 * PIM and DAM hold only immutable `const` data — ERP and CRM have mutable state.
 */
export function resetAllBackendState(): void {
    resetErpState();
    resetCrmState();
}

interface ServerOptions {
    port?: number;
    host?: string;
    logger?: boolean;
    /** Serve the public/ directory for the browser UI */
    withStaticFiles?: boolean;
}

/**
 * Creates a fully wired BFF server with all backends.
 * Handles the late-binding pattern for bffRoutes automatically.
 */
export async function createBffServer(options: ServerOptions = {}) {
    const { port = 0, host, logger = false, withStaticFiles = false } = options;

    const server = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

    if (withStaticFiles) {
        server.register(fastifyStatic, {
            root: path.join(__dirname, 'public'),
            prefix: '/',
        });

        // SPA entry: serve index.html for /frontend (and any sub-paths)
        // so the app can derive the BFF stateUri from the browser URL.
        server.get('/frontend', async (_req, reply) => reply.sendFile('index.html'));
        server.get('/frontend/*', async (_req, reply) => reply.sendFile('index.html'));
    }

    // Root discovery endpoint — links to all logical services.
    server.get('/', async () => ({
        pim: { href: '/pim', title: 'Product Information Management' },
        erp: { href: '/erp', title: 'Enterprise Resource Planning' },
        crm: { href: '/crm', title: 'Customer Relationship Management' },
        dam: { href: '/dam', title: 'Digital Asset Management' },
        bff: { href: '/bff', title: 'Backend For Frontend (Start Here)' },
    }));

    await server.register(pimRoutes);
    await server.register(erpRoutes);
    await server.register(crmRoutes);
    await server.register(damRoutes);

    const bffConfig = { baseUrl: '' };
    await server.register(bffRoutes, { config: bffConfig });

    const address = await server.listen({ port, host });
    bffConfig.baseUrl = address;

    return { server, address };
}

if (require.main === module) {
    (async () => {
        try {
            const { address } = await createBffServer({
                port: 3000,
                host: 'localhost',
                logger: true,
                withStaticFiles: true,
            });
            console.log(`Server listening at ${address}`);
            console.log(`BFF API: ${address}/bff`);
            console.log(`Frontend: ${address}/frontend`);
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    })();
}
