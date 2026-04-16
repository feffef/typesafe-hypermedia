import { Type } from '@sinclair/typebox';
import { defineLinks, Simplify } from '../../../src';

// --- Schemas ---
// DAM intentionally uses HAL-style _links with link objects ({ href })
// rather than the flat string URL properties used by PIM/ERP/CRM.
// This demonstrates that defineLinks works with both link patterns —
// see AGENTS.md Core Concept #5 for the distinction.

export const LinkObjectSchema = Type.Object({
    href: Type.String()
});

export const AssetsSchema = Type.Object({
    sku: Type.String(),
    images: Type.Array(Type.String()),
    _links: Type.Object({
        self: LinkObjectSchema
    })
});

export const NotFoundSchema = Type.Object({
    sku: Type.String(),
    message: Type.String(),
    _links: Type.Object({
        self: LinkObjectSchema
    })
});

// --- API Definition ---

const apiDef = defineLinks(['root', 'assets', 'notFound'], {
    root: {
        schema: Type.Object({
            _links: Type.Object({
                assets: LinkObjectSchema
            })
        }),
        links: {
            '_links.assets.href': {
                to: 'assets',
                params: { sku: Type.String() },
                expect: { 404: 'notFound' }
            }
        }
    },
    assets: {
        schema: AssetsSchema,
        links: {}
    },
    notFound: {
        schema: NotFoundSchema,
        links: {}
    }
});

export interface DamApi extends Simplify<typeof apiDef> { }
export const damApi: DamApi = apiDef;
