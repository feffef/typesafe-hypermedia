/**
 * link-locations.spec.ts — Where in the JSON graph can a navigable live?
 *
 * Where does my test go? (first match wins)
 *  1. Structurally invalid input → runtime-guards
 *  2. Custom fetchFactory or typed navigable union check → fetch-customization
 *  3. errorVerbosity: 'safe' → error-verbosity
 *  4. JSON.stringify, runtime tampering, union/intersection link schema → metadata
 *  5. navigateAll, or array fan-out edge cases → navigate-all
 *  6. params:/URI template/baseURL/final URL assertion → url-resolution
 *  7. Return shape/contents of an error → error-handling
 *  8. Which navigate() overload fires → navigate-overloads
 *  9. "A navigable can live here too" → link-locations  ← THIS FILE
 * 10. Bootstrap step → navigate-entry
 */

import { Type } from '@sinclair/typebox';
import { defineLinks, linkTo } from '../../src';
import { navigate } from '../../src/navigate';
import { petshopApi, PetshopSchema, CatalogSchema, PetSchema } from '../../examples/petshop-api';
import { mockResponse, mockResponses } from '../mock-responses';
import { mockPetshop, mockCatalog, mockPet1, mockPet2 } from '../test-schemas';

describe('navigate — link locations', () => {

    describe('a link object', () => {
        it('can be followed via its href (baseline)', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const shop = await navigate(linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            }));

            mockResponse(CatalogSchema, mockCatalog);
            const catalog = await navigate(shop.actions.listPets);

            expect(catalog.pets).toBeDefined();
            expect(Array.isArray(catalog.pets)).toBe(true);
            expect(catalog.pets).toHaveLength(2);
            expect(catalog.pets[0].title).toBe('Fido');
            expect(catalog.pets[1].title).toBe('Whiskers');
        });

        it('composes across a chain of hops', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const shop = await navigate(linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            }));

            mockResponse(CatalogSchema, mockCatalog);
            const catalog = await navigate(shop.actions.listPets);

            mockResponse(PetSchema, mockPet1);
            const pet = await navigate(catalog.pets[0]);

            expect(pet.id).toBe('1');
            expect(pet.name).toBe('Fido');
        });

        it('can be nested inside an array', async () => {
            mockResponse(PetshopSchema, mockPetshop);
            const shop = await navigate(linkTo({
                api: petshopApi,
                resource: 'petshop',
                url: 'http://localhost:3000',
            }));

            mockResponse(CatalogSchema, mockCatalog);
            const catalog = await navigate(shop.actions.listPets);

            mockResponses(PetSchema, mockPet1, mockPet2);
            const pets = await Promise.all(catalog.pets.map(p => navigate(p)));

            expect(pets).toHaveLength(2);
            expect(pets[0].name).toBe('Fido');
            expect(pets[1].name).toBe('Whiskers');
        });

        it('supports the HAL-style _links convention', async () => {
            const HalResourceSchema = Type.Object({
                id: Type.String(),
                _links: Type.Object({
                    self: Type.Object({ href: Type.String() }),
                    next: Type.Object({ href: Type.String() }),
                    author: Type.Object({ href: Type.String() }),
                }),
            });
            const AuthorSchema = Type.Object({ name: Type.String() });

            const halApi = defineLinks(['resource', 'author'], {
                resource: {
                    schema: HalResourceSchema,
                    links: {
                        '_links.self.href': { to: 'resource' },
                        '_links.next.href': { to: 'resource' },
                        '_links.author.href': { to: 'author' },
                    },
                },
                author: { schema: AuthorSchema, links: {} },
            });

            mockResponse(HalResourceSchema, {
                id: 'res-1',
                _links: {
                    self: { href: '/resources/1' },
                    next: { href: '/resources/2' },
                    author: { href: '/authors/1' },
                },
            });
            const resource = await navigate(linkTo({
                api: halApi,
                resource: 'resource',
                url: 'http://api.com',
            }));

            expect(resource._links.self.href).toBe('/resources/1');

            // Follow HAL-style link via navigate (single-link auto-resolve on link object)
            mockResponse(HalResourceSchema, {
                id: 'res-2',
                _links: {
                    self: { href: '/resources/2' },
                    next: { href: '/resources/3' },
                    author: { href: '/authors/2' },
                },
            });
            const next = await navigate(resource._links.next);
            expect(next.id).toBe('res-2');

            mockResponse(AuthorSchema, { name: 'Alice' });
            const author = await navigate(resource._links.author);
            expect(author.name).toBe('Alice');
        });
    });

    describe('a string-property link', () => {
        it('resolves one level deep by its property name', async () => {
            const MultiLinkSchema = Type.Object({
                self: Type.String(),
                next: Type.String(),
                profile: Type.Object({
                    url: Type.String(),
                    avatarUrl: Type.String(),
                }),
            });
            const UserProfileSchema = Type.Object({ name: Type.String() });
            const AvatarSchema = Type.Object({ image: Type.String() });

            const nestedApi = defineLinks(['root', 'userProfile', 'avatar'], {
                root: {
                    schema: MultiLinkSchema,
                    links: {
                        self: { to: 'root' },
                        next: { to: 'root' },
                        'profile.url': { to: 'userProfile' },
                        'profile.avatarUrl': { to: 'avatar' },
                    },
                },
                userProfile: { schema: UserProfileSchema, links: {} },
                avatar: { schema: AvatarSchema, links: {} },
            });

            mockResponse(MultiLinkSchema, {
                self: '/root',
                next: '/page/2',
                profile: { url: '/users/1', avatarUrl: '/images/1.jpg' },
            });
            const root = await navigate(linkTo({
                api: nestedApi,
                resource: 'root',
                url: 'http://api.com',
            }));

            // Navigate nested link via named link mode
            mockResponse(UserProfileSchema, { name: 'Alice' });
            const profile = await navigate(root.profile, { link: 'url' });
            expect(profile.name).toBe('Alice');

            mockResponse(AvatarSchema, { image: 'binary' });
            const avatar = await navigate(root.profile, { link: 'avatarUrl' });
            expect(avatar.image).toBe('binary');
        });

        it('resolves at arbitrary nesting depth', async () => {
            const DeepSchema = Type.Object({
                metadata: Type.Object({
                    author: Type.Object({
                        profileUrl: Type.String(),
                        avatarUrl: Type.String(),
                    }),
                    editor: Type.Object({
                        profileUrl: Type.String(),
                    }),
                }),
            });
            const ProfileSchema = Type.Object({ username: Type.String() });
            const AvatarSchema = Type.Object({ image: Type.String() });

            const deepApi = defineLinks(['root', 'profile', 'avatar'], {
                root: {
                    schema: DeepSchema,
                    links: {
                        'metadata.author.profileUrl': { to: 'profile' },
                        'metadata.author.avatarUrl': { to: 'avatar' },
                        'metadata.editor.profileUrl': { to: 'profile' },
                    },
                },
                profile: { schema: ProfileSchema, links: {} },
                avatar: { schema: AvatarSchema, links: {} },
            });

            mockResponse(DeepSchema, {
                metadata: {
                    author: { profileUrl: '/users/author', avatarUrl: '/avatars/author.jpg' },
                    editor: { profileUrl: '/users/editor' },
                },
            });
            const root = await navigate(linkTo({
                api: deepApi,
                resource: 'root',
                url: 'http://api.com',
            }));

            mockResponse(ProfileSchema, { username: 'alice' });
            const authorProfile = await navigate(root.metadata.author, { link: 'profileUrl' });
            expect(authorProfile.username).toBe('alice');

            mockResponse(AvatarSchema, { image: 'alice.jpg' });
            const authorAvatar = await navigate(root.metadata.author, { link: 'avatarUrl' });
            expect(authorAvatar.image).toBe('alice.jpg');

            mockResponse(ProfileSchema, { username: 'bob' });
            const editorProfile = await navigate(root.metadata.editor, { link: 'profileUrl' });
            expect(editorProfile.username).toBe('bob');
        });
    });

    describe('sibling string-property links', () => {
        it('dispatch independently when on the same parent inside an array element', async () => {
            const ItemSchema = Type.Object({
                id: Type.String(),
                download: Type.String(),
                preview: Type.String(),
            });
            const CatSchema = Type.Object({
                items: Type.Array(ItemSchema),
            });
            const FileSchema = Type.Object({ size: Type.Number() });
            const PreviewSchema = Type.Object({ url: Type.String() });

            const arrayApi = defineLinks(['catalog', 'file', 'preview'], {
                catalog: {
                    schema: CatSchema,
                    links: {
                        'items[].download': { to: 'file' },
                        'items[].preview': { to: 'preview' },
                    },
                },
                file: { schema: FileSchema, links: {} },
                preview: { schema: PreviewSchema, links: {} },
            });

            mockResponse(CatSchema, {
                items: [
                    { id: '1', download: '/files/1', preview: '/previews/1' },
                    { id: '2', download: '/files/2', preview: '/previews/2' },
                ],
            });
            const catalog = await navigate(linkTo({
                api: arrayApi,
                resource: 'catalog',
                url: 'http://api.com',
            }));

            const firstItem = catalog.items[0];
            expect(firstItem.download).toBe('/files/1');
            expect(firstItem.preview).toBe('/previews/1');

            mockResponse(FileSchema, { size: 1024 });
            const file = await navigate(firstItem, { link: 'download' });
            expect(file.size).toBe(1024);

            mockResponse(PreviewSchema, { url: '/binary/1' });
            const preview = await navigate(catalog.items[0], { link: 'preview' });
            expect(preview.url).toBe('/binary/1');
        });

        it('tolerate an optional sibling being absent', async () => {
            const ResourceSchema = Type.Object({
                id: Type.String(),
                primaryUrl: Type.String(),
                alternateUrl: Type.Optional(Type.String()),
            });
            const OptTargetSchema = Type.Object({ data: Type.String() });

            const optApi = defineLinks(['resource', 'target'], {
                resource: {
                    schema: ResourceSchema,
                    links: {
                        primaryUrl: { to: 'target' },
                        alternateUrl: { to: 'target' },
                    },
                },
                target: { schema: OptTargetSchema, links: {} },
            });

            // Both links present
            mockResponse(ResourceSchema, {
                id: '1',
                primaryUrl: '/primary',
                alternateUrl: '/alternate',
            });
            const withBoth = await navigate(linkTo({
                api: optApi,
                resource: 'resource',
                url: 'http://api.com',
            }));

            mockResponse(OptTargetSchema, { data: 'primary-data' });
            const primary = await navigate(withBoth, { link: 'primaryUrl' });
            expect(primary.data).toBe('primary-data');

            if (withBoth.alternateUrl) {
                mockResponse(OptTargetSchema, { data: 'alternate-data' });
                const alternate = await navigate(withBoth, { link: 'alternateUrl' });
                expect(alternate.data).toBe('alternate-data');
            }

            // Optional link absent
            mockResponse(ResourceSchema, { id: '2', primaryUrl: '/primary2' });
            const withoutOptional = await navigate(linkTo({
                api: optApi,
                resource: 'resource',
                url: 'http://api.com',
            }));

            expect(withoutOptional.primaryUrl).toBe('/primary2');
            expect(withoutOptional.alternateUrl).toBeUndefined();

            mockResponse(OptTargetSchema, { data: 'primary2-data' });
            const primary2 = await navigate(withoutOptional, { link: 'primaryUrl' });
            expect(primary2.data).toBe('primary2-data');
        });
    });

});
