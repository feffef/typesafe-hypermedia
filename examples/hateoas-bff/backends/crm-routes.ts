import { crmApi } from './crm-api';
import { FastifyRoutePlugin } from '../types';

// --- Mock Data ---

const INITIAL_LOYALTY_POINTS = 240;

const profile = {
    id: 'u1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    loyaltyPoints: INITIAL_LOYALTY_POINTS
};

/** Restore CRM in-memory state to its initial values. Call from test `beforeEach`. */
export function resetCrmState(): void {
    profile.loyaltyPoints = INITIAL_LOYALTY_POINTS;
}

const offers = [
    { id: 'o1', code: 'WELCOME10', discount: 0.10, description: '10% off your first order' },
    { id: 'o2', code: 'SUMMER', discount: 0.15, description: 'Summer sale!' }
];


// --- Routes ---

export const crmRoutes: FastifyRoutePlugin = async (fastify) => {
    fastify.get('/crm', {
        schema: {
            response: {
                200: crmApi.root.schema
            }
        }
    }, async () => {
        return {
            profileUrl: '/crm/profile'
        };
    });

    fastify.get('/crm/profile', {
        schema: {
            response: {
                200: crmApi.profile.schema
            }
        }
    }, async () => {
        return {
            ...profile,
            offersUrl: '/crm/offers',
            creditUrl: '/crm/loyalty/credit'
        };
    });

    fastify.post('/crm/loyalty/credit', {
        schema: {
            body: {
                type: 'object',
                properties: { points: { type: 'number' } },
                required: ['points']
            },
            response: {
                200: crmApi.creditResult.schema
            }
        }
    }, async (req) => {
        const { points } = req.body as { points: number };
        profile.loyaltyPoints += points;
        return { loyaltyPoints: profile.loyaltyPoints };
    });

    fastify.get('/crm/offers', {
        schema: {
            response: {
                200: crmApi.offers.schema
            }
        }
    }, async () => {
        return {
            items: offers
        };
    });
};
