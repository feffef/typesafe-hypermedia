import { Type } from '@sinclair/typebox';
import { damApi } from './dam-api';
import { FastifyRoutePlugin } from '../types';

// --- Mock Data ---

const assetMap: Record<string, string[]> = {
    'PROD-001': ['https://dam.example.com/PROD-001-front.jpg', 'https://dam.example.com/PROD-001-side.jpg'],
    'PROD-002': ['https://dam.example.com/PROD-002-front.jpg', 'https://dam.example.com/PROD-002-detail.jpg'],
    'PROD-004': ['https://dam.example.com/PROD-004-blender.jpg'],
    'PROD-005': ['https://dam.example.com/PROD-005-top.jpg', 'https://dam.example.com/PROD-005-rgb.jpg'],
    'PROD-007': ['https://dam.example.com/PROD-007-planter.jpg'],
    'PROD-009': ['https://dam.example.com/PROD-009-set.jpg', 'https://dam.example.com/PROD-009-pour.jpg', 'https://dam.example.com/PROD-009-carafe.jpg'],
    'PROD-010': ['https://dam.example.com/PROD-010-skillet.jpg'],
};

// --- Routes ---

export const damRoutes: FastifyRoutePlugin = async (fastify) => {
    fastify.get('/dam', {
        schema: {
            response: {
                200: damApi.root.schema
            }
        }
    }, async () => {
        return {
            _links: {
                assets: { href: '/dam/assets/{sku}' }
            }
        };
    });

    fastify.get('/dam/assets/:sku', {
        schema: {
            params: Type.Object({ sku: Type.String() }),
            response: {
                200: damApi.assets.schema,
                404: damApi.notFound.schema
            }
        }
    }, async (req, reply) => {
        const sku = req.params.sku as string;
        const images = assetMap[sku];
        if (!images) {
            return reply.code(404).send({
                sku,
                message: `No assets found for SKU '${sku}'`,
                _links: { self: { href: `/dam/assets/${sku}` } }
            });
        }
        return {
            sku,
            images,
            _links: {
                self: { href: `/dam/assets/${sku}` }
            }
        };
    });
};
