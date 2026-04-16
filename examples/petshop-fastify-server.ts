import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AddressInfo } from 'net';
import {
    PetshopSchema,
    CatalogSchema,
    PetSchema,
    OrderSchema,
    ProblemSchema,
    Pet
} from './petshop-api';

// --- Mock Database (Async to simulate real DB/upstream APIs) ---
class MockDatabase {
    private pets: Pet[] = [
        { id: '101', name: 'Fido', species: 'Dog', price: 50, actions: {} },
        { id: '102', name: 'Whiskers', species: 'Cat', price: 40, actions: {} }
    ];

    async findPet(id: string): Promise<Pet | undefined> {
        // Simulate async DB/API call
        return Promise.resolve(this.pets.find(p => p.id === id));
    }

    async listPets(): Promise<Pet[]> {
        // Simulate async DB/API call
        return Promise.resolve([...this.pets]);
    }

    async countPets(): Promise<number> {
        // Simulate async DB/API call
        return Promise.resolve(this.pets.length);
    }
}

const db = new MockDatabase();

/**
 * Create and configure the example Fastify server
 * @param port Port to listen on (0 for random free port, defaults to 3000)
 * @returns Promise resolving to { app, address, port }
 */
export async function createExampleServer(port: number = 3000) {
    const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();

    // Register Swagger plugins
    await app.register(swagger, {
        openapi: {
            info: {
                title: 'Hypermedia Pet Shop',
                description: 'Type-safe Hypermedia API',
                version: '1.0.0'
            }
        }
    });

    await app.register(swaggerUi, {
        routePrefix: '/documentation'
    });

    // --- Routes (Fastify) ---

    // Root / Entry Point
    app.get('/', {
        schema: {
            response: {
                200: PetshopSchema
            }
        }
    }, async (req) => {
        const baseUrl = `${req.protocol}://${req.hostname}:${req.port}`;
        return {
            actions: {
                listPets: { href: `${baseUrl}/pets` },
                getPet: { href: `${baseUrl}/pets/{id}`, templated: true },
                searchPets: { href: `${baseUrl}/pets{?q}`, templated: true }
            }
        };
    });

    // Catalog - list all pets
    app.get('/pets', {
        schema: {
            querystring: Type.Object({ q: Type.Optional(Type.String()) }),
            response: {
                200: CatalogSchema
            }
        }
    }, async (req) => {
        // Controller: all async operations happen here
        let pets = await db.listPets();

        // Filter by query if present
        if (req.query.q) {
            const q = req.query.q.toLowerCase();
            pets = pets.filter(p => p.name.toLowerCase().includes(q) || p.species.toLowerCase().includes(q));
        }

        const baseUrl = `${req.protocol}://${req.hostname}:${req.port}`;

        // Return plain JSON matching CatalogSchema
        return {
            pets: pets.map(pet => ({
                href: `${baseUrl}/pets/${pet.id}`,
                title: pet.name
            }))
        };
    });

    // Single Pet
    app.get('/pets/:id', {
        schema: {
            params: Type.Object({ id: Type.String() }),
            response: {
                200: PetSchema,
                404: ProblemSchema
            }
        }
    }, async (req, reply) => {
        // Controller: all async operations happen here
        const pet = await db.findPet(req.params.id!);
        const baseUrl = `${req.protocol}://${req.hostname}:${req.port}`;
        if (!pet) {
            // Include a recovery link back to the catalog so clients handling
            // the 404 can navigate to a useful fallback resource.
            return reply.code(404).send({
                title: `Pet with id '${req.params.id}' not found`,
                suggestionsLink: {
                    href: `${baseUrl}/pets`,
                    title: 'Browse all pets'
                }
            });
        }

        // Return plain JSON matching PetSchema
        return {
            id: pet.id,
            name: pet.name,
            species: pet.species,
            price: pet.price,
            actions: {
                order: { href: `${baseUrl}/pets/${pet.id}/buy`, method: 'POST' }
            }
        };
    });

    // Order / Purchase
    app.post('/pets/:id/buy', {
        schema: {
            params: Type.Object({ id: Type.String() }),
            response: {
                200: OrderSchema,
                404: Type.Object({ error: Type.String() })
            }
        }
    }, async (req, reply) => {
        // Controller: all async operations happen here
        const pet = await db.findPet(req.params.id!);
        if (!pet) return reply.code(404).send({ error: 'Not Found' });

        // In a real BFF: await orderService.create(...)
        const orderId = 'ORD-' + Date.now();
        const baseUrl = `${req.protocol}://${req.hostname}:${req.port}`;

        // Return plain JSON matching OrderSchema
        return {
            orderId,
            status: 'CONFIRMED',
            total: pet.price,
            pet: { href: `${baseUrl}/pets/${pet.id}`, title: pet.name }
        };
    });

    // Start server
    await app.ready();
    const address = await app.listen({ port, host: 'localhost' });
    const actualPort = (app.server.address() as AddressInfo).port;

    return { app, address, port: actualPort };
}

// Run directly if this file is executed (not imported)
if (require.main === module) {
    (async () => {
        try {
            const { address } = await createExampleServer(3000);
            console.log(`Server listening at ${address}`);
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    })();
}
