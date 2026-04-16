// BFF uses link objects ({ title, href }) — the HAL/Siren style — because the frontend
// needs per-link metadata (title for labels, count for badges, inWishlist for toggle state).
// Backend APIs (PIM/ERP/CRM) use flat *Url strings; DAM uses _links.href objects.
// See AGENTS.md Core Concept #5 and docs/how-it-works.md §9 for the design rationale.
import { Type, Static } from '@sinclair/typebox';
import { defineLinks, Simplify } from '../../src';

// --- BFF Schemas ---

const ReviewSummarySchema = Type.Object({
    author: Type.String(),
    rating: Type.Number(),
    text: Type.String()
});

export const TitledLinkSchema = Type.Object({
    title: Type.String(),
    href: Type.String(),
});
export type TitledLink = Static<typeof TitledLinkSchema>;

// Canonical "link with an optional selected flag" — the shared structural primitive for
// nav items, sort controls, and any "pick one from a list" UI element.
export const SelectableLinkSchema = Type.Object({
    title: Type.String(),
    href: Type.String(),
    selected: Type.Optional(Type.Boolean()),
});
export type SelectableLink = Static<typeof SelectableLinkSchema>;

// Semantic aliases — same TypeBox node, same TypeScript type, different semantic intent.
export const NavLinkSchema = SelectableLinkSchema;
export type NavLink = SelectableLink;

// Extends the SelectableLinkSchema concept with a count badge (cart, wishlist quantities).
// Not composed via Type.Intersect to avoid changing the TypeBox node kind.
export const CountedLinkSchema = Type.Object({
    title: Type.String(),
    href: Type.String(),
    selected: Type.Optional(Type.Boolean()),
    count: Type.Number(),
});

export const BadgeSchema = Type.Object({
    text: Type.String(),
    variant: Type.String(),
});

export const WishlistToggleSchema = Type.Object({
    title: Type.String(),
    href: Type.String(),
    inWishlist: Type.Boolean(),
});

export const CardActionsSchema = Type.Object({
    addToCart: Type.Optional(TitledLinkSchema),
    removeFromCart: Type.Optional(TitledLinkSchema),
    moveToWishlist: Type.Optional(TitledLinkSchema),
    wishlistToggle: Type.Optional(WishlistToggleSchema),
});

export type CardActions = Static<typeof CardActionsSchema>;

export const CardSchema = Type.Object({
    title: Type.String(),
    subtitle: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    badge: Type.Optional(BadgeSchema),
    // Optional: omit when there is no navigable detail view for this card
    // (e.g. order cards — no order-detail view exists yet).
    href: Type.Optional(Type.String()),
    actions: Type.Optional(CardActionsSchema),
});
export type Card = Static<typeof CardSchema>;

// Semantic alias of SelectableLinkSchema — sort controls share the same shape as nav links.
export const SortOptionSchema = SelectableLinkSchema;
export type SortOption = SelectableLink;

export const CardsSchema = Type.Object({
    heading: Type.String(),
    cards: Type.Array(
        CardSchema
    ),
});
export type ProductCards = Static<typeof CardsSchema>;

export const ProductDetailsSchema = Type.Object({
    name: Type.String(),
    description: Type.String(),
    price: Type.Optional(Type.Number()),
    images: Type.Array(Type.String()),
    stockStatus: Type.String(),
    isAvailable: Type.Boolean(),
    reviews: Type.Array(ReviewSummarySchema),

    addToCart: Type.Optional(TitledLinkSchema),
});
export type ProductDetails = Static<typeof ProductDetailsSchema>;

// Minimal link carrying only an href — used for action endpoints where
// no title or selection state is needed (e.g. the search form action URL).
export const ActionLinkSchema = Type.Object({
    href: Type.String(),
});
export type ActionLink = Static<typeof ActionLinkSchema>;

export const MainNavSchema = Type.Object({
    home: NavLinkSchema,
    categories: Type.Array(NavLinkSchema),
    wishlist: CountedLinkSchema,
    cart: CountedLinkSchema,
    orders: NavLinkSchema,
    // Base URL for the search action. The frontend appends ?search=<term> when
    // the user submits a search — the only client-side URL construction permitted.
    search: ActionLinkSchema,
});

export const ToastVariantSchema = Type.Union([
    Type.Literal('danger'),
    Type.Literal('warning'),
    Type.Literal('success'),
]);

export const ToastSchema = Type.Object({
    title: Type.String(),
    message: Type.String(),
    variant: Type.Optional(ToastVariantSchema),
});
export type Toast = Static<typeof ToastSchema>;

export const UserSchema = Type.Object({
    name: Type.String(),
    loyaltyPoints: Type.Number(),
});

export const PromoSchema = Type.Object({
    code: Type.String(),
    description: Type.String(),
    discount: Type.Number(),
});

export const CartSummarySchema = Type.Object({
    subtotal: Type.Number(),
    discount: Type.Optional(Type.Object({
        code: Type.String(),
        amount: Type.Number(),
    })),
    total: Type.Number(),
    freeShipping: Type.Object({
        threshold: Type.Number(),
        qualifies: Type.Boolean(),
        remaining: Type.Number(),
        progress: Type.Number(),
    }),
});
export type CartSummary = Static<typeof CartSummarySchema>;

export const OrderSummarySchema = Type.Object({
    orderId: Type.String(),
    total: Type.Number(),
    itemCount: Type.Number(),
});
export type OrderSummary = Static<typeof OrderSummarySchema>;

export const BreadcrumbSchema = Type.Object({
    title: Type.String(),
    href: Type.Optional(Type.String()),
});
export type Breadcrumb = Static<typeof BreadcrumbSchema>;

export const DataSourceSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    role: Type.String(),
});
export type DataSource = Static<typeof DataSourceSchema>;

// --- Page view sub-schemas ---
// Exactly one of these is populated per response; which one depends on the current view.

export const ListingViewSchema = Type.Object({
    products: CardsSchema,
    sortOptions: Type.Optional(Type.Array(SortOptionSchema)),
});
export type ListingView = Static<typeof ListingViewSchema>;

export const ProductDetailViewSchema = Type.Object({
    productDetails: ProductDetailsSchema,
    recommendations: Type.Optional(CardsSchema),
});
export type ProductDetailView = Static<typeof ProductDetailViewSchema>;

export const CartViewSchema = Type.Object({
    products: CardsSchema,
    cartSummary: Type.Optional(CartSummarySchema),
    checkout: Type.Optional(TitledLinkSchema),
    loyaltyEarn: Type.Optional(Type.Number()),
    recommendations: Type.Optional(CardsSchema),
});
export type CartView = Static<typeof CartViewSchema>;

export const OrderConfirmationViewSchema = Type.Object({
    summary: OrderSummarySchema,
    viewOrders: Type.Optional(TitledLinkSchema),
});
export type OrderConfirmationView = Static<typeof OrderConfirmationViewSchema>;

export const ViewSchema = Type.Object({
    listing: Type.Optional(ListingViewSchema),
    detail: Type.Optional(ProductDetailViewSchema),
    cart: Type.Optional(CartViewSchema),
    confirmation: Type.Optional(OrderConfirmationViewSchema),
});

export const ChromeSchema = Type.Object({
    breadcrumbs: Type.Optional(Type.Array(BreadcrumbSchema)),
    toast: Type.Optional(ToastSchema),
    user: Type.Optional(UserSchema),
    promo: Type.Optional(PromoSchema),
});

export const MetaSchema = Type.Object({
    dataSources: Type.Array(DataSourceSchema),
});

export const FrontendStateSchema = Type.Object({
    nav: MainNavSchema,
    view: ViewSchema,
    chrome: ChromeSchema,
    meta: MetaSchema,
});
export type FrontendState = Static<typeof FrontendStateSchema>;

// `view` is intentionally absent — it is encoded in the route path (/bff/home,
// /bff/category, …) rather than as a query parameter. `QueryState` adds it back
// as a TypeScript-only field so view builders can inspect it internally.
export const QuerySchema = Type.Object({
    category: Type.Optional(Type.String()),
    sku: Type.Optional(Type.String()),
    search: Type.Optional(Type.String()),
    orderId: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    variant: Type.Optional(ToastVariantSchema),
    cart: Type.Optional(Type.Array(Type.String())),
    wishlist: Type.Optional(Type.Array(Type.String())),
    sort: Type.Optional(Type.String())
});
export interface QueryState extends Static<typeof QuerySchema> {
    view?: 'home' | 'category' | 'product' | 'search' | 'cart' | 'wishlist' | 'orders' | 'order-confirmation';
}

// --- API Definition ---

const apiDef = defineLinks(['main'], {
    main: {
        schema: FrontendStateSchema,
        links: {
            'nav.home.href': { to: 'main' },
            'nav.categories[].href': { to: 'main' },
            'nav.wishlist.href': { to: 'main' },
            'nav.cart.href': { to: 'main' },
            'nav.orders.href': { to: 'main' },
            'nav.search.href': { to: 'main' },
            'chrome.breadcrumbs[].href': { to: 'main' },
            // listing view
            'view.listing.products.cards[].href': { to: 'main' },
            'view.listing.products.cards[].actions.addToCart.href': { to: 'main' },
            'view.listing.products.cards[].actions.moveToWishlist.href': { to: 'main' },
            'view.listing.products.cards[].actions.wishlistToggle.href': { to: 'main' },
            'view.listing.sortOptions[].href': { to: 'main' },
            // product detail view
            'view.detail.productDetails.addToCart.href': { to: 'main' },
            'view.detail.recommendations.cards[].href': { to: 'main' },
            'view.detail.recommendations.cards[].actions.wishlistToggle.href': { to: 'main' },
            // cart view
            'view.cart.products.cards[].href': { to: 'main' },
            'view.cart.products.cards[].actions.removeFromCart.href': { to: 'main' },
            'view.cart.products.cards[].actions.moveToWishlist.href': { to: 'main' },
            'view.cart.products.cards[].actions.wishlistToggle.href': { to: 'main' },
            'view.cart.recommendations.cards[].href': { to: 'main' },
            'view.cart.recommendations.cards[].actions.wishlistToggle.href': { to: 'main' },
            'view.cart.checkout.href': { to: 'main' },
            // order confirmation view
            'view.confirmation.viewOrders.href': { to: 'main' },
        }
    }
});

export interface BffApi extends Simplify<typeof apiDef> { }
export const bffApi: BffApi = apiDef;
