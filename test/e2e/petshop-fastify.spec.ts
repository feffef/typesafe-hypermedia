// E2E test for the petshop-fastify-server using the high-level public API
// This test runs against a real Fastify server to verify the full integration works
import { linkTo, navigate, navigateAll, FetchFactory, ConnectOptions, RootNavigable } from '../../src';

import { petshopApi, PetshopApi } from '../../examples/petshop-api';

function expectArrayOfLinks(arr: any[]) {
    expect(Array.isArray(arr)).toBe(true);
    arr.forEach(item => {
        expect(typeof item.href).toBe('string');
    });
}
import { createExampleServer } from '../../examples/petshop-fastify-server';
import { FastifyInstance } from 'fastify';

describe('Petshop Fastify Server', () => {

    // Custom fetch factory that reads the HTTP method from the link
    const fetchFactory: FetchFactory<PetshopApi> = context => (url: string) => {
        const method = context.navigable?.method || 'GET';
        return fetch(url, { method });
    };

    let baseUrl: string;
    let serverInstance: { app: FastifyInstance; address: string; port: number };
    let apiOptions: ConnectOptions<PetshopApi, 'petshop'>
    let petshopLink: RootNavigable<'petshop', PetshopApi>;

    beforeAll(async () => {
        // Start server on random free port
        serverInstance = await createExampleServer(0);
        baseUrl = `http://localhost:${serverInstance.port}`;

        apiOptions = {
            api: petshopApi,
            resource: 'petshop',
            url: baseUrl,
            fetchFactory
        }

        // Initialize root navigable after base_url is known
        petshopLink = linkTo(apiOptions);
    });

    afterAll(async () => {
        // Clean up server after tests
        if (serverInstance?.app) {
            await serverInstance.app.close();
        }
    });

    describe('Key user journey ', () => {

        it('should allow to navigate entire API: root -> catalog -> pet -> order -> pet', async () => {
            // Start at root
            const petshop = await navigate(petshopLink);

            // Navigate to catalog
            const catalog = await navigate(petshop.actions.listPets);
            // Verify links to pets are present and have epect properties
            expect(catalog.pets).toHaveLength(2);
            const firstLink = catalog.pets[0];
            expect(firstLink.href).toContain('/pets/1');
            expect(firstLink.title).toBe('Fido');

            // Follow link to first pet
            const firstPet = await navigate(firstLink);
            expect(firstPet.name).toBe('Fido');
            expect(firstPet.species).toBe('Dog');

            // verify order link is present
            expect(firstPet.actions.order).toBeDefined();
            if (firstPet.actions.order) {
                // execute the order with a POST request
                const order = await navigate(firstPet.actions.order);
                expect(order.orderId).toBeDefined();
                expect(order.status).toBe('CONFIRMED');

                // Navigate back to pet from order
                const petFromOrder = await navigate(order.pet);
                expect(petFromOrder.id).toBe(firstPet.id);
                expect(petFromOrder.name).toBe(firstPet.name);
            }
        });

    });

    describe('Other use cases', () => {

        it('should allow fetching all pets at once', async () => {
            const petshop = await navigate(petshopLink);
            const catalog = await navigate(petshop.actions.listPets);

            // Follow all pet links in parallel
            const pets = await navigateAll(catalog.pets);

            expect(pets).toHaveLength(2);
            expect(pets[0].name).toBe('Fido');
            expect(pets[0].species).toBe('Dog');
            expect(pets[0].price).toBe(50);

            expect(pets[1].name).toBe('Whiskers');
            expect(pets[1].species).toBe('Cat');
            expect(pets[1].price).toBe(40);
        });

        it('should search pets using URI template', async () => {
            const petshop = await navigate(petshopLink);
            expect(petshop.actions.searchPets.href).toBe(baseUrl + '/pets{?q}');

            // Search for Dog
            const results = await navigate(petshop.actions.searchPets, { params: { q: 'dog' } });
            expectArrayOfLinks(results.pets);
            expect(results.pets).toHaveLength(1);
            expect(results.pets[0].title).toBe('Fido');

            // Search for Cat
            const results2 = await navigate(petshop.actions.searchPets, { params: { q: 'cat' } });
            expectArrayOfLinks(results2.pets);
            expect(results2.pets).toHaveLength(1);
            expect(results2.pets[0].title).toBe('Whiskers');

            // Search for non-existent
            const results3 = await navigate(petshop.actions.searchPets, { params: { q: 'bird' } });
            expectArrayOfLinks(results3.pets);
            expect(results3.pets).toHaveLength(0);
        });
    });

    describe('Error handling', () => {
        it('should handle 404 errors when fetching non-existent root path', async () => {
            // Navigate from a wrong URL
            const wrongRoot = linkTo({
                ...apiOptions,
                url: baseUrl + '/foo/bar'
            })

            await expect(
                navigate(wrongRoot)
            ).rejects.toThrow();
        });

        it('should handle 404 errors with typed problem response for invalid pet ID', async () => {
            const petshop = await navigate(petshopLink);

            // verify actions.getPet is templated
            expect(petshop.actions.getPet.href).toBe(baseUrl + '/pets/{id}');

            // Follow getPet link with an invalid ID
            const [pet, failure] = await navigate(petshop.actions.getPet, { params: { id: '999' } });

            // We expect a failure, not a pet — this throw asserts the test invariant
            // and lets TypeScript narrow the tuple so `failure` is non-null below.
            if (pet !== null) throw new Error(`expected a failure, got pet: ${pet.name}`);

            expect(failure.message).toContain('404');

            // Exhaustive error handling — users should always include an
            // 'unexpected' branch for the catch-all (network failures, schema
            // mismatches, unmapped status codes, etc.).
            switch (failure.kind) {
                case 'problem': {
                    expect(failure.response.status).toBe(404);
                    expect(failure.resource.title).toBe("Pet with id '999' not found");

                    // Recovery-link pattern: the problem resource carries a
                    // link back to the catalog so clients can recover from
                    // the failure by navigating to a useful fallback.
                    expect(failure.resource.suggestionsLink).toBeDefined();
                    const catalog = await navigate(failure.resource.suggestionsLink!);
                    expect(Array.isArray(catalog.pets)).toBe(true);
                    expect(catalog.pets.length).toBeGreaterThan(0);
                    break;
                }
                case 'unexpected':
                    throw new Error(
                        `Unexpected failure reason: ${failure.reason}`
                    );
            }
        });
    });

    describe('OpenAPI Documentation', () => {
        it('should serve auto-generated OpenAPI spec', async () => {
            // Fastify swagger generates the spec at /documentation/json
            const response = await fetch(`${baseUrl}/documentation/json`);
            expect(response.ok).toBe(true);

            const spec = await response.json();

            // Verify it's a valid OpenAPI spec
            expect(spec.openapi).toBeDefined();
            expect(spec.info).toBeDefined();
            expect(spec.info.title).toBe('Hypermedia Pet Shop');

            // Verify it has our routes
            expect(spec.paths).toBeDefined();
            expect(spec.paths['/']).toBeDefined();
            expect(spec.paths['/pets']).toBeDefined();
            expect(spec.paths['/pets/{id}']).toBeDefined();
        });
    });
});
