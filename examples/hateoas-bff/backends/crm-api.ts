// CRM uses flat string URL properties with a *Url suffix (same pattern as PIM and ERP).
// See AGENTS.md Core Concept #5 for the two link-pattern options.
import { Type } from '@sinclair/typebox';
import { defineLinks, Simplify } from '../../../src';

// --- Schemas ---

export const ProfileSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    email: Type.String(),
    loyaltyPoints: Type.Number(),
    offersUrl: Type.String(),
    creditUrl: Type.String()
});

export const OfferSchema = Type.Object({
    id: Type.String(),
    code: Type.String(),
    discount: Type.Number(),
    description: Type.String()
});

export const OffersListSchema = Type.Object({
    items: Type.Array(OfferSchema)
});

export const CreditResponseSchema = Type.Object({
    loyaltyPoints: Type.Number()
});

// --- API Definition ---

const apiDef = defineLinks(['root', 'profile', 'offers', 'creditResult'], {
    root: {
        schema: Type.Object({
            profileUrl: Type.String()
        }),
        links: {
            'profileUrl': { to: 'profile' }
        }
    },
    profile: {
        schema: ProfileSchema,
        links: {
            'offersUrl': { to: 'offers' },
            'creditUrl': { to: 'creditResult' }
        }
    },
    offers: {
        schema: OffersListSchema,
        links: {}
    },
    creditResult: {
        schema: CreditResponseSchema,
        links: {}
    }
});

export interface CrmApi extends Simplify<typeof apiDef> { }
export const crmApi: CrmApi = apiDef;
