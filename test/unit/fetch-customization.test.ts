import { ApiDefinition } from '../../src';
import { Static } from '@sinclair/typebox';
import {
    FetchContext,
    FetchFactory,
    TypeAtPath,
    ParentPath,
    LinkNavigable,
    AllLinkNavigables,
} from '../../src/fetch-customization';
import { PetshopApi, PetshopSchema, PetSchema, CatalogSchema } from '../../examples/petshop-api';

// Helper type to check for 'any' type
type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false;

describe('FetchContext type derivation', () => {
    // Uses petshop API to verify TypeAtPath, ParentPath, LinkNavigable, AllLinkNavigables

    it('TypeAtPath resolves nested dot-notation paths', () => {
        // TypeAtPath<Petshop, 'actions.listPets'> should resolve to the listPets link object
        type ListPetsLink = TypeAtPath<Static<typeof PetshopSchema>, 'actions.listPets'>;
        const check: AssertEqual<ListPetsLink, { href: string; title?: string; method?: string }> = true;
        expect(check).toBe(true);
    });

    it('TypeAtPath resolves array bracket paths', () => {
        // TypeAtPath<Catalog, 'pets[]'> should resolve to the array element type
        type PetLink = TypeAtPath<Static<typeof CatalogSchema>, 'pets[]'>;
        const check: AssertEqual<PetLink, { href: string; title?: string; method?: string }> = true;
        expect(check).toBe(true);
    });

    it('TypeAtPath resolves array brackets against readonly arrays to the item type', () => {
        // FINDING-06: TypeAtPath previously only matched mutable `Array<T>`.
        // Hand-build a readonly-array carrier type and verify the path
        // resolver follows `items[]` into its element type. This guards
        // schemas (or downstream callers) that produce `readonly T[]`.
        type ROCarrier = { items: readonly { href: string }[] };
        type ItemLink = TypeAtPath<ROCarrier, 'items[]'>;

        // Must NOT collapse to never
        type IsNever = [ItemLink] extends [never] ? true : false;
        const notNever: IsNever = false;
        expect(notNever).toBe(false);

        // Must resolve to the item type (with the href property).
        const check: AssertEqual<ItemLink, { href: string }> = true;
        expect(check).toBe(true);
    });

    it('TypeAtPath preserves undefined for optional properties', () => {
        // PetSchema.actions.order is Optional(LinkSchema) — TypeAtPath should truthfully include undefined
        type OrderLink = TypeAtPath<Static<typeof PetSchema>, 'actions.order'>;
        const notAny: IsAny<OrderLink> = false;
        expect(notAny).toBe(false);

        // Optional property: undefined IS part of the type
        type HasUndefined = undefined extends OrderLink ? true : false;
        const hasUndefined: HasUndefined = true;
        expect(hasUndefined).toBe(true);
    });

    it('TypeAtPath resolves simple property access', () => {
        type Actions = TypeAtPath<Static<typeof PetshopSchema>, 'actions'>;
        // actions should be the object with listPets, getPet, searchPets
        const check: AssertEqual<keyof Actions, 'listPets' | 'getPet' | 'searchPets'> = true;
        expect(check).toBe(true);
    });

    it('ParentPath strips last segment', () => {
        type P1 = ParentPath<'actions.createPet.href'>;
        const check1: AssertEqual<P1, 'actions.createPet'> = true;
        expect(check1).toBe(true);

        type P2 = ParentPath<'link.href'>;
        const check2: AssertEqual<P2, 'link'> = true;
        expect(check2).toBe(true);

        // Single segment has no parent
        type P3 = ParentPath<'href'>;
        const check3: AssertEqual<P3, never> = true;
        expect(check3).toBe(true);
    });

    it('ParentPath handles three-level paths', () => {
        type P = ParentPath<'a.b.c.d'>;
        const check: AssertEqual<P, 'a.b.c'> = true;
        expect(check).toBe(true);
    });

    it('LinkNavigable resolves array link paths to array element type', () => {
        // catalog has 'pets[].href' — navigable should be the array element (link object)
        type CatNav = LinkNavigable<typeof CatalogSchema, 'pets[].href'>;
        const notAny: IsAny<CatNav> = false;
        expect(notAny).toBe(false);

        // Type-level: CatNav should have href (compiles = passes)
        const _href: string = {} as CatNav extends { href: string } ? string : never;
        expect(true).toBe(true);
    });

    it('LinkNavigable resolves optional property paths without undefined', () => {
        // pet has 'actions.order.href' where order is Optional — navigable should NOT include undefined
        type PetNav = LinkNavigable<typeof PetSchema, 'actions.order.href'>;
        const notAny: IsAny<PetNav> = false;
        expect(notAny).toBe(false);

        type HasUndefined = undefined extends PetNav ? true : false;
        const noUndefined: HasUndefined = false;
        expect(noUndefined).toBe(false);

        // Mandatory properties from the schema should be present
        type HasHref = PetNav extends { href: string } ? true : false;
        const hasHref: HasHref = true;
        expect(hasHref).toBe(true);

        // Optional properties from the schema should remain optional
        // PetNav does NOT extend { title: string } because title is string | undefined
        type TitleRequired = PetNav extends { title: string } ? true : false;
        const titleNotRequired: TitleRequired = false;
        expect(titleNotRequired).toBe(false);
    });

    it('AllLinkNavigables produces union without undefined or never leakage', () => {
        type Navigables = AllLinkNavigables<PetshopApi>;

        // Should NOT be 'any'
        const notAny: IsAny<Navigables> = false;
        expect(notAny).toBe(false);

        // Should NOT be 'never' (would happen if no links produce valid navigables)
        type IsNever = [Navigables] extends [never] ? true : false;
        const notNever: IsNever = false;
        expect(notNever).toBe(false);

        // Should NOT include undefined (from optional link properties like pet.actions.order)
        type HasUndefined = undefined extends Navigables ? true : false;
        const noUndefined: HasUndefined = false;
        expect(noUndefined).toBe(false);

        // Type-level: union should include href (compiles = passes)
        const _href: string = {} as Navigables extends { href: string } ? string : never;
        expect(true).toBe(true);
    });

    it('FetchContext.navigable is typed when parameterized with API', () => {
        // When parameterized, navigable should be the union type, not any
        type Context = FetchContext<PetshopApi>;
        const notAny: IsAny<Context['navigable']> = false;
        expect(notAny).toBe(false);
    });

    it('FetchContext and AllLinkNavigables fall back to any when unparameterized', () => {
        // Backwards compatibility: unparameterized usage keeps navigable as any
        type Navigables = AllLinkNavigables<ApiDefinition>;
        const navigablesAny: IsAny<Navigables> = true;
        expect(navigablesAny).toBe(true);

        type Context = FetchContext;
        const contextAny: IsAny<Context['navigable']> = true;
        expect(contextAny).toBe(true);

        // targetResourceName falls back to plain string when unparameterized
        const nameIsString: AssertEqual<Context['targetResourceName'], string> = true;
        expect(nameIsString).toBe(true);
    });

    it('FetchContext.targetResourceName is narrowed when parameterized', () => {
        type Context = FetchContext<PetshopApi>;
        // Type-level: targetResourceName should be constrained to petshop API resource names
        // (compiles = passes — runtime value is undefined because ctx is a bare cast)
        const ctx = {} as Context;
        const _name: 'petshop' | 'catalog' | 'pet' | 'order' | 'problem' = ctx.targetResourceName;
        expect(true).toBe(true);
    });

    it('FetchFactory accepts typed context when parameterized', () => {
        // A FetchFactory<PetshopApi> should receive typed context
        const factory: FetchFactory<PetshopApi> = (context) => {
            // context.navigable should have href property (from link object union)
            const href: string = context.navigable!.href;
            return (url: string) => fetch(url);
        };
        expect(factory).toBeDefined();
    });
});
