// PIM uses flat string URL properties with a *Url suffix (GitHub / JSON-LD style).
// This is one of two link patterns supported by defineLinks — see AGENTS.md Core Concept #5.
// DAM (dam-api.ts) uses the alternative HAL-style _links.href pattern for contrast.
import { Type } from '@sinclair/typebox';
import { defineLinks, Simplify } from '../../../src';

// --- Domain Schemas ---

export const ProductSchema = Type.Object({
    id: Type.String(),
    sku: Type.String(),
    name: Type.String(),
    description: Type.String(),
    categoryId: Type.String(),
    categoryUrl: Type.String(),
    relatedProductsUrl: Type.String(),
    reviewsUrl: Type.String()
});

export const ProductListSchema = Type.Object({
    items: Type.Array(ProductSchema)
});

export const CategorySchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    productsUrl: Type.String()
});

export const CategoryListSchema = Type.Object({
    items: Type.Array(CategorySchema)
});

export const ReviewSchema = Type.Object({
    id: Type.String(),
    author: Type.String(),
    rating: Type.Number(),
    text: Type.String()
});

export const ReviewListSchema = Type.Object({
    items: Type.Array(ReviewSchema)
});

export const NotFoundSchema = Type.Object({
    message: Type.String()
});

export const RootSchema = Type.Object({
    categoriesUrl: Type.String(),
    productsByCategoryUrl: Type.String(),
    tagSearchUrl: Type.String(),
    textSearchUrl: Type.String(),
    productUrl: Type.String()
});

// --- API Definition ---

const apiDef = defineLinks(['root', 'categories', 'category', 'products', 'product', 'reviews', 'notFound'], {
    root: {
        schema: RootSchema,
        links: {
            'categoriesUrl': { to: 'categories' },
            'productsByCategoryUrl': { to: 'products', params: { id: Type.String() } },
            'tagSearchUrl': { to: 'products', params: { tag: Type.String() } },
            'textSearchUrl': { to: 'products', params: { q: Type.String() } },
            'productUrl': { to: 'product', params: { sku: Type.String() }, expect: { 404: 'notFound' } }
        }
    },
    categories: {
        schema: CategoryListSchema,
        links: {
            'items[].productsUrl': { to: 'products' }
        }
    },
    category: {
        schema: CategorySchema,
        links: {
            'productsUrl': { to: 'products' }
        }
    },
    products: {
        schema: ProductListSchema,
        links: {
            'items[].categoryUrl': { to: 'category' },
            'items[].relatedProductsUrl': { to: 'products' },
            'items[].reviewsUrl': { to: 'reviews' }
        }
    },
    product: {
        schema: ProductSchema,
        links: {
            'categoryUrl': { to: 'category' },
            'relatedProductsUrl': { to: 'products' },
            'reviewsUrl': { to: 'reviews' }
        }
    },
    reviews: {
        schema: ReviewListSchema,
        links: {}
    },
    notFound: {
        schema: NotFoundSchema,
        links: {}
    }
});

export interface PimApi extends Simplify<typeof apiDef> { }
export const pimApi: PimApi = apiDef;
