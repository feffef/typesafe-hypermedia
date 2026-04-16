import { Type, Static } from '@sinclair/typebox';
import { linkTo, navigate, expandUriTemplate, Resource } from '../../src/index';
import { FastifyRoutePlugin } from './types';

// API definitions
import { pimApi, PimApi } from './backends/pim-api';
import { erpApi, ErpApi } from './backends/erp-api';
import { crmApi } from './backends/crm-api';
import { damApi, DamApi } from './backends/dam-api';
import {
    bffApi, QueryState, ToastVariantSchema,
    TitledLink, Card, ProductCards, ProductDetails,
    Toast, DataSource, CartSummary,
    ListingView, ProductDetailView, CartView, OrderConfirmationView,
} from './bff-api';

interface OfferInfo { code: string; discount: number; }

/**
 * Returns a lazy fetch that memoizes the in-flight promise.
 * The first call starts the fetch; subsequent calls return the same promise,
 * so multiple consumers within one request share a single network call.
 */
function lazyFetch<T>(fn: () => Promise<T>): () => Promise<T> {
    let promise: Promise<T> | undefined;
    return () => {
        if (!promise) promise = fn();
        return promise;
    };
}

// ViewState: exactly one sub-object is populated per response.
type ViewState = {
    listing?: ListingView;
    detail?: ProductDetailView;
    cart?: CartView;
    confirmation?: OrderConfirmationView;
};

// --- Data source attribution ---

type SourceId = 'pim' | 'erp' | 'crm' | 'dam';

const SOURCE_CATALOG: Record<SourceId, { name: string; role: string }> = {
    pim: { name: 'PIM', role: 'Catalog & Reviews' },
    erp: { name: 'ERP', role: 'Pricing, Stock & Orders' },
    crm: { name: 'CRM', role: 'Profile & Offers' },
    dam: { name: 'DAM', role: 'Media Assets' },
};

const FREE_SHIPPING_THRESHOLD = 500;

function buildDataSources(used: Set<SourceId>): DataSource[] {
    const order: SourceId[] = ['pim', 'erp', 'crm', 'dam'];
    return order
        .filter(id => used.has(id))
        .map(id => ({ id, ...SOURCE_CATALOG[id] }));
}

// --- Backend write helpers ---

/**
 * POSTs a JSON body to the ERP backend.
 *
 * NOTE: This intentionally uses raw `fetch()` instead of `navigate()` because
 * the typesafe-hypermedia client does not yet support client-provided request
 * bodies — see roadmap §5 ("Client-Provided Request Data"). `navigate()` can
 * expand URI templates via its `params` option, but there is no `data` slot
 * for a POST/PUT/PATCH payload, and `FetchFactory` has no standard way to
 * receive client-generated body data from the call site.
 *
 * Once roadmap §5 lands, this helper should be replaced with something like:
 *   navigate(erpRoot, { link: 'createOrderUrl', data: { sku, quantity } })
 * where the ERP client's `FetchFactory` serialises `context.data` as the body.
 *
 * For GET-only navigation examples in this file, see `navigate()` call sites
 * such as `productDetailView` (quote, stock, DAM assets) — those are the
 * pattern the showcase is meant to demonstrate.
 */
async function postToErp(baseUrl: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/**
 * POSTs a JSON body to the CRM backend.
 *
 * Same raw-fetch workaround as `postToErp` — see that function's comment for
 * the full rationale. This exists to demonstrate cross-backend coordination:
 * the checkout flow credits earned loyalty points to the CRM after placing
 * orders with the ERP.
 *
 * Fire-and-forget: CRM credit failures are logged but do not fail the checkout,
 * since the orders themselves were already committed on the ERP side.
 */
async function postToCrm<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`CRM ${path} failed: ${response.status}`);
    return response.json() as Promise<T>;
}

// --- Per-view querystring schemas ---
// Each route declares exactly the fields it uses. Fastify validates required
// fields automatically and returns 400 Bad Request when they are absent.

// Shared optional fields that travel with every view (session state + toasts).
const sharedFields = () => ({
    cart: Type.Optional(Type.Array(Type.String())),
    wishlist: Type.Optional(Type.Array(Type.String())),
    message: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    variant: Type.Optional(ToastVariantSchema),
});

// Routes that carry only shared state
const BaseQuerySchema = Type.Object({ ...sharedFields() });

const CategoryQuerySchema = Type.Object({
    category: Type.String(),
    sort: Type.Optional(Type.String()),
    ...sharedFields(),
});

const ProductQuerySchema = Type.Object({
    sku: Type.String(),
    // Carried from the originating category page so the nav can show the active
    // category and breadcrumbs can render "Home → Category → Product".
    category: Type.Optional(Type.String()),
    // Preserved when navigating from search results so breadcrumbs can render
    // "Home → Search → Product" instead of "Home → Category → Product".
    search: Type.Optional(Type.String()),
    ...sharedFields(),
});

const SearchQuerySchema = Type.Object({
    search: Type.String(),
    ...sharedFields(),
});

const OrderConfirmationQuerySchema = Type.Object({
    orderId: Type.String(),
    ...sharedFields(),
});

// --- URL builders ---

/** Shared session-state values used by every per-view URI template. */
function sharedUrlValues(state: QueryState) {
    return {
        cart: state.cart,
        wishlist: state.wishlist,
        message: state.message,
        title: state.title,
        variant: state.variant,
    };
}

function homeUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/home{?cart*,wishlist*,message,title,variant}',
        schema: BaseQuerySchema,
        values: sharedUrlValues(state),
    });
}

function categoryUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/category{?category,sort,cart*,wishlist*,message,title,variant}',
        schema: CategoryQuerySchema,
        values: { category: state.category!, sort: state.sort, ...sharedUrlValues(state) },
    });
}

// Named productDetailUrl to avoid confusion with the PIM 'productUrl' link name.
function productDetailUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/product{?sku,category,search,cart*,wishlist*,message,title,variant}',
        schema: ProductQuerySchema,
        values: { sku: state.sku!, category: state.category, search: state.search, ...sharedUrlValues(state) },
    });
}

function searchUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/search{?search,cart*,wishlist*,message,title,variant}',
        schema: SearchQuerySchema,
        values: { search: state.search!, ...sharedUrlValues(state) },
    });
}

/**
 * Base URL for the search action — carries session state (cart/wishlist) but
 * omits the search term so the frontend can append `?search=<term>` itself.
 * Transient toast fields are deliberately excluded (they reset on navigation).
 */
function searchActionUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/search{?cart*,wishlist*}',
        schema: Type.Object({
            cart: Type.Optional(Type.Array(Type.String())),
            wishlist: Type.Optional(Type.Array(Type.String())),
        }),
        values: { cart: state.cart, wishlist: state.wishlist },
    });
}

function cartUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/cart{?cart*,wishlist*,message,title,variant}',
        schema: BaseQuerySchema,
        values: sharedUrlValues(state),
    });
}

function wishlistUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/wishlist{?cart*,wishlist*,message,title,variant}',
        schema: BaseQuerySchema,
        values: sharedUrlValues(state),
    });
}

// Named ordersListUrl to avoid confusion with the ERP 'ordersUrl' link name.
function ordersListUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/orders{?cart*,wishlist*,message,title,variant}',
        schema: BaseQuerySchema,
        values: sharedUrlValues(state),
    });
}

function orderConfirmationUrl(state: QueryState): string {
    return expandUriTemplate({
        template: '/bff/order-confirmation{?orderId,cart*,wishlist*,message,title,variant}',
        schema: OrderConfirmationQuerySchema,
        values: { orderId: state.orderId!, ...sharedUrlValues(state) },
    });
}

/** Dispatch to the right per-view URL builder based on `state.view`. */
function viewUrl(state: QueryState): string {
    switch (state.view) {
        case 'home': return homeUrl(state);
        case 'category': return categoryUrl(state);
        case 'product': return productDetailUrl(state);
        case 'search': return searchUrl(state);
        case 'cart': return cartUrl(state);
        case 'wishlist': return wishlistUrl(state);
        case 'orders': return ordersListUrl(state);
        case 'order-confirmation': return orderConfirmationUrl(state);
        default: return homeUrl(state);
    }
}

function checkoutUrl(cart: string[]) {
    return expandUriTemplate({
        template: '/bff/actions/checkout{?cart*}',
        schema: Type.Object({
            cart: Type.Array(Type.String())
        }),
        values: { cart }
    });
}

function addToCartUrl(sku: string, cart: string[]) {
    return expandUriTemplate({
        template: '/bff/actions/add-to-cart?qty=1{&sku,cart*}',
        schema: Type.Object({
            sku: Type.String(),
            cart: Type.Array(Type.String())
        }),
        values: { sku, cart }
    });
}

function removeFromCartUrl(index: number, cart: string[], wishlist: string[]) {
    return expandUriTemplate({
        template: '/bff/actions/remove-from-cart{?index,cart*,wishlist*}',
        schema: Type.Object({
            index: Type.Integer({ minimum: 0 }),
            cart: Type.Array(Type.String()),
            wishlist: Type.Array(Type.String()),
        }),
        values: { index, cart, wishlist }
    });
}

function moveToWishlistUrl(index: number, cart: string[], wishlist: string[]) {
    return expandUriTemplate({
        template: '/bff/actions/save-for-later{?index,cart*,wishlist*}',
        schema: Type.Object({
            index: Type.Integer({ minimum: 0 }),
            cart: Type.Array(Type.String()),
            wishlist: Type.Array(Type.String()),
        }),
        values: { index, cart, wishlist }
    });
}

function toggleWishlistUrl(sku: string, wishlist: string[], cart: string[], returnView: string) {
    return expandUriTemplate({
        template: '/bff/actions/toggle-wishlist{?sku,wishlist*,cart*,returnView}',
        schema: Type.Object({
            sku: Type.String(),
            wishlist: Type.Array(Type.String()),
            cart: Type.Array(Type.String()),
            returnView: Type.String(),
        }),
        values: { sku, wishlist, cart, returnView }
    });
}

// --- BFF config & backend clients ---

export interface BffConfig {
    baseUrl?: string;
    config?: { baseUrl: string };
}

function resolveBaseUrl(opts: BffConfig): string {
    const baseUrl = opts.config?.baseUrl || opts.baseUrl;
    if (!baseUrl) throw new Error('Base URL not configured');
    return baseUrl;
}

function connectBackends(baseUrl: string) {
    return {
        pim: linkTo({ api: pimApi, resource: 'root', url: `${baseUrl}/pim` }),
        erp: linkTo({ api: erpApi, resource: 'root', url: `${baseUrl}/erp` }),
        crm: linkTo({ api: crmApi, resource: 'root', url: `${baseUrl}/crm` }),
        dam: linkTo({ api: damApi, resource: 'root', url: `${baseUrl}/dam` }),
    };
}

type Backends = ReturnType<typeof connectBackends>;

// --- Query state helpers ---

/** Build a URL that preserves current query state but applies the given update, resetting transient fields. */
function updatedStateUrl(query: QueryState, stateUpdate: QueryState): string {
    return viewUrl({
        ...query,
        // transient fields — reset on navigation
        message: undefined,
        title: undefined,
        variant: undefined,
        sku: undefined,
        view: undefined,
        sort: undefined,
        search: undefined,
        // then apply the update
        ...stateUpdate
    });
}

/** Serialize the current page so toggle actions can redirect the user back. */
function currentReturnView(query: QueryState): string {
    if (query.view === 'product' && query.sku) return `sku:${query.sku}`;
    if (query.view === 'cart') return 'cart';
    if (query.view === 'wishlist') return 'wishlist';
    if (query.view === 'orders') return 'orders';
    if (query.view === 'search' && query.search) return `search:${query.search}`;
    if (query.view === 'category' && query.category) return `category:${query.category}`;
    return 'home';
}

/** Convert a PIM product to a card link pointing at the product detail view. */
function productToCard(query: QueryState, product: Static<typeof pimApi.product.schema>, quote?: ErpQuoteInfo): Card {
    const wishlist = query.wishlist || [];
    const cart = query.cart || [];
    const inWishlist = wishlist.includes(product.sku);
    return {
        title: product.name,
        subtitle: quote ? formatPrice(quote.price) : undefined,
        description: truncate(product.description, 100),
        badge: stockAlertBadge(quote?.availableStock),
        href: updatedStateUrl(query, { view: 'product', sku: product.sku }),
        actions: {
            wishlistToggle: {
                title: inWishlist ? 'Remove from Wishlist' : 'Save to Wishlist',
                href: toggleWishlistUrl(product.sku, wishlist, cart, currentReturnView(query)),
                inWishlist
            }
        }
    };
}

function formatPrice(price: number): string {
    return `$${price.toFixed(2)}`;
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function stockLevelFromQty(qty: number): 'Out of Stock' | 'Low Stock' | 'In Stock' {
    if (qty === 0) return 'Out of Stock';
    if (qty < 5)  return 'Low Stock';
    return 'In Stock';
}

function stockAlertBadge(availableStock?: number): { text: string; variant: string } | undefined {
    if (availableStock === undefined) return undefined;
    const level = stockLevelFromQty(availableStock);
    if (level === 'Out of Stock') return { text: 'Out of Stock', variant: 'danger' };
    if (level === 'Low Stock')   return { text: 'Low Stock',    variant: 'warning' };
    return undefined;
}

// --- View builders ---

type PimRoot = Resource<'root', PimApi>;
type PimCategories = Resource<'categories', PimApi>;

type ProductDetailResult =
    | { kind: 'ok'; view: ViewState['detail']; productMeta: { name: string; categoryId: string } }
    | { kind: 'notFound' }
    | { kind: 'error'; toast: Toast };

function buildNav(query: QueryState, categories: PimCategories, isHome: boolean, isCart: boolean, isWishlist: boolean, isOrders: boolean) {
    return {
        home: {
            title: 'Home',
            href: updatedStateUrl(query, { view: 'home' }),
            selected: isHome ? true : undefined
        },
        categories: categories.items.map(c => ({
            title: c.name,
            href: updatedStateUrl(query, { view: 'category', category: c.id }),
            selected: (query.category === c.id && !isCart && !isWishlist) ? true : undefined
        })),
        wishlist: {
            title: 'Wishlist',
            href: updatedStateUrl(query, { view: 'wishlist' }),
            count: query.wishlist?.length || 0,
            selected: isWishlist ? true : undefined
        },
        cart: {
            title: 'Cart',
            href: updatedStateUrl(query, { view: 'cart' }),
            count: query.cart?.length || 0,
            selected: isCart ? true : undefined
        },
        orders: {
            title: 'Orders',
            href: updatedStateUrl(query, { view: 'orders' }),
            selected: isOrders ? true : undefined
        },
        // Search action base URL — the frontend appends ?search=<term>.
        // Carries session state (cart/wishlist) so searches preserve the basket.
        search: {
            href: searchActionUrl(query)
        }
    };
}

function buildBreadcrumbs(
    query: QueryState,
    categories: PimCategories,
    productMeta?: { name: string; categoryId: string }
): { title: string; href?: string }[] | undefined {
    const home = { title: 'Home', href: homeUrl({ cart: query.cart, wishlist: query.wishlist }) };

    if (query.view === 'cart') return [home, { title: 'Cart' }];
    if (query.view === 'wishlist') return [home, { title: 'Wishlist' }];
    if (query.view === 'orders') return [home, { title: 'Orders' }];
    if (query.view === 'order-confirmation') return [home, { title: 'Order Confirmed' }];
    if (query.view === 'search') return [home, { title: `Search: "${query.search}"` }];

    if (query.view === 'product' && query.search) {
        return [
            home,
            { title: `Search: "${query.search}"`, href: searchUrl({ view: 'search', search: query.search }) },
            { title: productMeta?.name ?? 'Product' }
        ];
    }

    if (productMeta) {
        const cat = categories.items.find(c => c.id === productMeta.categoryId);
        const crumbs: { title: string; href?: string }[] = [home];
        if (cat) {
            crumbs.push({ title: cat.name, href: categoryUrl({ view: 'category', category: cat.id }) });
        }
        crumbs.push({ title: productMeta.name });
        return crumbs;
    }

    if (query.view === 'category' && query.category) {
        const cat = categories.items.find(c => c.id === query.category);
        if (cat) return [home, { title: cat.name }];
    }
    return undefined;
}

type ErpRoot = Resource<'root', ErpApi>;
type DamRoot = Resource<'root', DamApi>;

interface ErpQuoteInfo {
    price: number;
    availableStock: number;
}

async function fetchQuotes(erpRoot: ErpRoot, skus: string[]): Promise<Map<string, ErpQuoteInfo>> {
    const quotes = new Map<string, ErpQuoteInfo>();
    await Promise.all(skus.map(async sku => {
        // quoteUrl is a prone link — tuple return. Any failure (404 unknown SKU,
        // network error, schema mismatch) is silently dropped so listings still
        // render even when ERP is partially down. The product card simply won't
        // show a price or stock badge for that SKU.
        const [quote, failure] = await navigate(erpRoot, { link: 'quoteUrl', params: { sku } });
        if (failure) return;
        quotes.set(sku, { price: quote.price, availableStock: quote.availableStock });
    }));
    return quotes;
}

async function wishlistView(query: QueryState, pimRoot: PimRoot, erpRoot: ErpRoot, used: Set<SourceId>): Promise<ViewState> {
    const skus = query.wishlist || [];
    if (!skus.length) {
        return { listing: { products: { heading: 'Your Wishlist', cards: [] } } };
    }
    used.add('pim');
    used.add('erp');
    const [productResults, quotes] = await Promise.all([
        Promise.all(skus.map(sku => navigate(pimRoot, { link: 'productUrl', params: { sku } }))),
        fetchQuotes(erpRoot, skus)
    ]);
    // Silently skip any SKUs that no longer exist in PIM (e.g. removed from catalog).
    const products = productResults.flatMap(([p]) => p ? [p] : []);
    const cart = query.cart || [];
    return {
        listing: {
            products: {
                heading: 'Your Wishlist',
                cards: products.map(p => {
                    const base = productToCard(query, p, quotes.get(p.sku));
                    const canAddToCart = (quotes.get(p.sku)?.availableStock ?? 0) > 0;
                    return {
                        ...base,
                        actions: {
                            ...base.actions,
                            addToCart: canAddToCart ? {
                                title: 'Add to Cart',
                                href: addToCartUrl(p.sku, cart)
                            } : undefined
                        }
                    };
                })
            }
        }
    };
}

async function orderConfirmationView(
    query: QueryState,
    orderId: string,
    erpRoot: ErpRoot,
    used: Set<SourceId>
): Promise<{
    view: ViewState;
    toast?: Toast;
    effectiveView: 'order-confirmation' | 'orders';
}> {
    used.add('erp');
    const orders = await navigate(erpRoot, { link: 'ordersUrl' });
    const order = orders.items.find(o => o.id === orderId);
    if (order) {
        return {
            view: {
                confirmation: {
                    summary: {
                        orderId: order.id,
                        total: order.total,
                        itemCount: order.items.length,
                    },
                    viewOrders: {
                        title: 'View All Orders',
                        href: ordersListUrl({})
                    }
                }
            },
            effectiveView: 'order-confirmation'
        };
    }
    // Stale/tampered orderId — fall back to orders list with a danger toast so
    // the user lands somewhere actionable instead of a blank content area.
    // Reuse the `orders` we already fetched so the fallback path does not
    // trigger a second `navigate()` round-trip.
    return {
        view: { listing: { products: ordersCardsFromItems(query, orders.items) } },
        toast: {
            title: 'Order not found',
            message: `We couldn't find order ${orderId}. Here are your recent orders.`,
            variant: 'danger'
        },
        effectiveView: 'orders'
    };
}

async function ordersView(query: QueryState, erpRoot: ErpRoot, used: Set<SourceId>): Promise<ViewState> {
    used.add('erp');
    const orders = await navigate(erpRoot, { link: 'ordersUrl' });
    return { listing: { products: ordersCardsFromItems(query, orders.items) } };
}

function ordersCardsFromItems(
    query: QueryState,
    items: Static<typeof erpApi.orders.schema>['items']
): ProductCards {
    if (!items.length) {
        return { heading: 'Your Orders', cards: [] };
    }
    const cards: Card[] = items.map(o => ({
        title: `Order ${o.id}`,
        subtitle: formatPrice(o.total),
        description: `${o.items.length} item${o.items.length === 1 ? '' : 's'} · ${o.status}`,
        badge: { text: o.status, variant: o.status === 'pending' ? 'warning' : 'success' },
        // No href: there is no order-detail view. Omitting href suppresses the
        // "View Details" button in the listing template. See docs/hateoas-bff-example.md §8 TODO #10.
    }));
    return { heading: 'Your Orders', cards };
}

// 1 loyalty point per whole dollar spent.
function computeLoyaltyEarn(total: number): number {
    return Math.floor(total);
}

function computeFreeShipping(total: number): CartSummary['freeShipping'] {
    const qualifies = total >= FREE_SHIPPING_THRESHOLD;
    const remaining = qualifies ? 0 : +(FREE_SHIPPING_THRESHOLD - total).toFixed(2);
    const progress = Math.min(100, Math.round((total / FREE_SHIPPING_THRESHOLD) * 100));
    return { threshold: FREE_SHIPPING_THRESHOLD, qualifies, remaining, progress };
}

async function cartView(query: QueryState, pimRoot: PimRoot, erpRoot: ErpRoot, offer: OfferInfo | undefined, used: Set<SourceId>): Promise<ViewState> {
    const cartSkus = query.cart || [];
    if (!cartSkus.length) {
        return { cart: { products: { heading: 'Your Shopping Cart', cards: [] } } };
    }
    used.add('pim');
    used.add('erp');
    // Kick off the related-products fetch in parallel with the main products/quotes Promise.all.
    // Chain it off firstProductFetch so it starts as soon as the first product resolves,
    // rather than serially after the Promise.all.
    // productUrl is a prone link — each navigate returns a [product, failure] tuple.
    const firstProductFetch = navigate(pimRoot, { link: 'productUrl', params: { sku: cartSkus[0] } });
    const relatedFetch = firstProductFetch.then(([fp]) => fp ? navigate(fp, { link: 'relatedProductsUrl' }) : Promise.resolve({ items: [] }));
    const [productResults, quotes, related] = await Promise.all([
        Promise.all(cartSkus.map(sku => navigate(pimRoot, { link: 'productUrl', params: { sku } }))),
        fetchQuotes(erpRoot, cartSkus),
        relatedFetch
    ]);
    // Silently skip any SKUs that no longer exist in PIM. Preserve the original
    // cart index so remove/save-for-later links remain correct.
    const productEntries = productResults.flatMap(([p], i) => p ? [{ p, i }] : []);
    // "You might also like" — related products for the first cart item, excluding cart SKUs.
    // `recQuotes` stays sequential because it depends on the filtered suggestions list.
    let recommendations: ProductCards | undefined;
    const cartSet = new Set(cartSkus);
    const relatedItems = 'items' in related ? related.items : [];
    const suggestions = relatedItems.filter(p => !cartSet.has(p.sku)).slice(0, 4);
    if (suggestions.length) {
        const recQuotes = await fetchQuotes(erpRoot, suggestions.map(p => p.sku));
        recommendations = {
            heading: 'You might also like',
            cards: suggestions.map(p => productToCard(query, p, recQuotes.get(p.sku)))
        };
    }

    const cartWishlist = query.wishlist || [];
    const cards = productEntries.map(({ p, i }) => {
        const base = productToCard(query, p, quotes.get(p.sku));
        return {
            ...base,
            actions: {
                ...base.actions,
                wishlistToggle: undefined,
                removeFromCart: {
                    title: 'Remove',
                    href: removeFromCartUrl(i, cartSkus, cartWishlist)
                },
                moveToWishlist: cartWishlist.includes(p.sku) ? undefined : {
                    title: 'Move to Wishlist',
                    href: moveToWishlistUrl(i, cartSkus, cartWishlist)
                }
            }
        };
    });
    const subtotal = cartSkus.reduce((sum, sku) => sum + (quotes.get(sku)?.price || 0), 0);
    const discountAmount = offer ? +(subtotal * offer.discount).toFixed(2) : 0;
    const total = +(subtotal - discountAmount).toFixed(2);
    const cartSummary: CartSummary = {
        subtotal,
        discount: offer ? { code: offer.code, amount: discountAmount } : undefined,
        total,
        // Free shipping threshold is evaluated on subtotal — a promo code should not
        // push a customer below the threshold after they already qualified.
        freeShipping: computeFreeShipping(subtotal),
    };
    return {
        cart: {
            products: { heading: 'Your Shopping Cart', cards },
            recommendations,
            checkout: {
                title: `Checkout — $${total.toFixed(2)}`,
                href: checkoutUrl(cartSkus)
            },
            cartSummary,
            loyaltyEarn: computeLoyaltyEarn(total)
        }
    };
}

async function homeView(query: QueryState, pimRoot: PimRoot, erpRoot: ErpRoot, used: Set<SourceId>): Promise<ViewState> {
    used.add('pim');
    used.add('erp');
    const featured = await navigate(pimRoot, { link: 'tagSearchUrl', params: { tag: 'new' } });
    const quotes = await fetchQuotes(erpRoot, featured.items.map(p => p.sku));
    return {
        listing: {
            products: {
                heading: 'Featured Products',
                cards: featured.items.map(p => productToCard(query, p, quotes.get(p.sku)))
            }
        }
    };
}

type SortKey = 'name' | 'price-asc' | 'price-desc';
const SORT_LABELS = {
    'name': 'Name',
    'price-asc': 'Price: Low → High',
    'price-desc': 'Price: High → Low',
} satisfies Record<SortKey, string>;
const SORT_KEYS = Object.keys(SORT_LABELS) as SortKey[];

function buildSortOptions(query: QueryState) {
    const current = (query.sort as SortKey) || 'name';
    return SORT_KEYS.map(k => ({
        title: SORT_LABELS[k],
        href: updatedStateUrl(query, { view: 'category', sort: k }),
        selected: k === current ? true : undefined
    }));
}

function sortProducts<T extends { sku: string; name: string }>(items: T[], sort: SortKey, quotes: Map<string, ErpQuoteInfo>): T[] {
    const copy = [...items];
    if (sort === 'price-asc') {
        copy.sort((a, b) => (quotes.get(a.sku)?.price ?? 0) - (quotes.get(b.sku)?.price ?? 0));
    } else if (sort === 'price-desc') {
        copy.sort((a, b) => (quotes.get(b.sku)?.price ?? 0) - (quotes.get(a.sku)?.price ?? 0));
    } else {
        copy.sort((a, b) => a.name.localeCompare(b.name));
    }
    return copy;
}

async function categoryView(query: QueryState, pimRoot: PimRoot, erpRoot: ErpRoot, categories: PimCategories, used: Set<SourceId>): Promise<ViewState> {
    const category = categories.items.find(c => c.id === query.category);
    if (!category) return {};

    used.add('pim');
    used.add('erp');
    const pimProducts = await navigate(pimRoot, { link: 'productsByCategoryUrl', params: { id: query.category! } });
    const quotes = await fetchQuotes(erpRoot, pimProducts.items.map(p => p.sku));
    const sorted = sortProducts(pimProducts.items, (query.sort as SortKey) || 'name', quotes);
    return {
        listing: {
            products: {
                heading: category.name,
                cards: sorted.map(p => productToCard(query, p, quotes.get(p.sku))),
            },
            sortOptions: buildSortOptions(query)
        }
    };
}

async function searchView(query: QueryState, pimRoot: PimRoot, erpRoot: ErpRoot, used: Set<SourceId>): Promise<ViewState> {
    used.add('pim');
    const results = await navigate(pimRoot, { link: 'textSearchUrl', params: { q: query.search! } });
    if (!results.items.length) {
        return { listing: { products: { heading: `No results for "${query.search!}"`, cards: [] } } };
    }
    // ERP is only added here (not at the top) because it is not called on empty results.
    // Moving used.add('erp') above the early return would falsely attribute ERP on zero-result pages.
    used.add('erp');
    const quotes = await fetchQuotes(erpRoot, results.items.map(p => p.sku));
    return {
        listing: {
            products: {
                heading: `Results for "${query.search!}"`,
                cards: results.items.map(p => ({
                    ...productToCard(query, p, quotes.get(p.sku)),
                    // Preserve search context so the product detail view knows it was
                    // reached from a search — buildBreadcrumbs uses this to render a
                    // "Search: …" ancestor instead of the category ancestor.
                    // `updatedStateUrl` deliberately clears `search`, so we override
                    // the href after merging.
                    href: updatedStateUrl(query, { view: 'product', sku: p.sku, search: query.search! })
                }))
            }
        }
    };
}

async function productDetailView(query: QueryState, pimRoot: PimRoot, erpRoot: ErpRoot, damRoot: DamRoot, used: Set<SourceId>): Promise<ProductDetailResult> {
    used.add('pim');
    used.add('erp');
    // productUrl is a prone link (expect: { 404: 'notFound' }) — unknown SKUs return a
    // typed tuple rather than throwing, so we can propagate a clean 404 from the BFF.
    const [pimProduct, pimFailure] = await navigate(pimRoot, { link: 'productUrl', params: { sku: query.sku! } });
    if (pimFailure) {
        if (pimFailure.kind === 'notFound') return { kind: 'notFound' };
        return { kind: 'error', toast: { title: 'Error', message: 'Failed to load product', variant: 'danger' } };
    }

    const [quoteResult, reviews, related, damResult] = await Promise.all([
        navigate(erpRoot, { link: 'quoteUrl', params: { sku: pimProduct.sku } }),
        navigate(pimProduct, { link: 'reviewsUrl' }),
        navigate(pimProduct, { link: 'relatedProductsUrl' }),
        navigate(damRoot._links.assets, { params: { sku: pimProduct.sku } })
    ]);
    const [damAssets] = damResult; // prone link — [assets, null] on success, [null, failure] on 404
    if (damAssets?.images.length) used.add('dam');

    // quoteUrl is a prone link — tuple return. A 404 means the SKU is unknown to ERP;
    // the product detail page cannot render without a quote (stock check, add-to-cart).
    // Redirect to the home page with a danger toast rather than returning HTTP 500.
    const [quote, quoteFailure] = quoteResult;
    if (quoteFailure) {
        return {
            kind: 'error',
            toast: { title: 'Error', message: 'Product pricing unavailable', variant: 'danger' }
        };
    }

    const qty = quote.availableStock;
    const stockLevel = stockLevelFromQty(qty);

    const addToCart: TitledLink | undefined = qty > 0
        ? { title: 'Add to Cart', href: addToCartUrl(pimProduct.sku, query.cart || []) }
        : undefined;

    const productDetails: ProductDetails = {
        name: pimProduct.name,
        description: pimProduct.description,
        price: quote.price,
        stockStatus: stockLevel,
        isAvailable: qty > 0,
        images: damAssets?.images ?? [],
        reviews: reviews.items,
        addToCart
    };

    let recommendations: ProductCards | undefined;
    if (related.items.length) {
        const relatedQuotes = await fetchQuotes(erpRoot, related.items.map(p => p.sku));
        recommendations = {
            heading: 'Related Products',
            cards: related.items.map(p => productToCard(query, p, relatedQuotes.get(p.sku))),
        };
    }

    return {
        kind: 'ok',
        view: { productDetails, recommendations },
        productMeta: { name: pimProduct.name, categoryId: pimProduct.categoryId }
    };
}

// --- Shared request context ---

async function buildRequestContext(backends: Backends, used: Set<SourceId>) {
    const [pimRoot, erpRoot, crmRoot] = await Promise.all([
        navigate(backends.pim),
        navigate(backends.erp),
        navigate(backends.crm)
    ]);
    // Nav + user greeting + promo always come from PIM categories and CRM profile.
    used.add('pim');
    used.add('crm');
    const [pimCategories, crmProfile] = await Promise.all([
        navigate(pimRoot, { link: 'categoriesUrl' }),
        navigate(crmRoot, { link: 'profileUrl' })
    ]);
    // Kick off the offers fetch eagerly — it races the view builder so it is
    // usually resolved (or nearly so) by the time we need it for the cart
    // discount or the promo banner. lazyFetch ensures exactly one CRM network
    // call per request even when both the cart branch and the promo assembly await it.
    const getCrmOffers = lazyFetch(() => navigate(crmProfile, { link: 'offersUrl' }));
    getCrmOffers(); // start immediately; don't block here
    return { pimRoot, erpRoot, pimCategories, crmProfile, getCrmOffers };
}

type RequestContext = Awaited<ReturnType<typeof buildRequestContext>>;

/** Assemble the full FrontendState from context + view builder output. */
async function assembleResponse(
    query: QueryState,
    ctx: RequestContext,
    view: ViewState,
    used: Set<SourceId>,
    opts: { toast?: Toast; productMeta?: { name: string; categoryId: string } } = {}
) {
    const isCart = query.view === 'cart';
    const isWishlist = query.view === 'wishlist';
    const isHome = query.view === 'home';
    const isOrders = query.view === 'orders';
    const nav = buildNav(query, ctx.pimCategories, isHome, isCart, isWishlist, isOrders);

    // View-provided toast (e.g. "order not found" fallback) takes priority over
    // a transient query-param toast carried in from a redirect.
    let toast: Toast | undefined = opts.toast;
    if (!toast && query.message) {
        toast = {
            title: query.title || 'Notice',
            message: query.message,
            variant: query.variant
        };
    }

    const user = { name: ctx.crmProfile.name, loyaltyPoints: ctx.crmProfile.loyaltyPoints };
    const crmOffers = await ctx.getCrmOffers();
    const topOffer = crmOffers.items[0];
    const promo = topOffer ? {
        code: topOffer.code,
        description: topOffer.description,
        discount: topOffer.discount
    } : undefined;

    const breadcrumbs = buildBreadcrumbs(query, ctx.pimCategories, opts.productMeta);
    const dataSources = buildDataSources(used);

    return {
        nav,
        view,
        chrome: { breadcrumbs, toast, user, promo },
        meta: { dataSources },
    };
}

// --- Routes ---

export const bffRoutes: FastifyRoutePlugin<BffConfig> = async (fastify, opts) => {
    // Late-binding: server.ts sets config.baseUrl *after* listen(), so resolve per-request.
    const getBaseUrl = () => resolveBaseUrl(opts);
    const getBackends = () => connectBackends(getBaseUrl());

    async function renderView(
        req: { query: Record<string, unknown> },
        viewName: QueryState['view'],
        builder: (query: QueryState, ctx: Awaited<ReturnType<typeof buildRequestContext>>, used: Set<SourceId>) => Promise<ViewState>
    ) {
        const query: QueryState = { ...req.query as QueryState, view: viewName };
        const used = new Set<SourceId>();
        const ctx = await buildRequestContext(getBackends(), used);
        return assembleResponse(query, ctx, await builder(query, ctx, used), used);
    }

    // GET /bff — parameter-free entry point for a completely fresh session.
    // No cart, no wishlist, no state — just a clean home view.
    // Any query parameters will be stripped by Fastify's AJV (removeAdditional: true)
    // and ignored so that stale bookmarks land safely instead of erroring.
    fastify.get('/bff', {
        schema: {
            querystring: Type.Object({}),
            response: { 200: bffApi.main.schema }
        }
    }, async () => {
        const query: QueryState = { view: 'home' };
        const used = new Set<SourceId>();
        const ctx = await buildRequestContext(getBackends(), used);
        const view = await homeView(query, ctx.pimRoot, ctx.erpRoot, used);
        return assembleResponse(query, ctx, view, used);
    });

    // GET /bff/home
    fastify.get('/bff/home', {
        schema: { querystring: BaseQuerySchema, response: { 200: bffApi.main.schema } }
    }, (req) => renderView(req, 'home', (q, ctx, used) => homeView(q, ctx.pimRoot, ctx.erpRoot, used)));

    // GET /bff/category — requires ?category=<id>
    fastify.get('/bff/category', {
        schema: { querystring: CategoryQuerySchema, response: { 200: bffApi.main.schema } }
    }, (req) => renderView(req, 'category', (q, ctx, used) => categoryView(q, ctx.pimRoot, ctx.erpRoot, ctx.pimCategories, used)));

    // GET /bff/product — requires ?sku=<sku>
    fastify.get('/bff/product', {
        schema: {
            querystring: ProductQuerySchema,
            response: {
                200: bffApi.main.schema,
                404: Type.Object({ message: Type.String() })
            }
        }
    }, async (req, reply) => {
        const query: QueryState = { ...req.query, view: 'product' };
        const used = new Set<SourceId>();
        const backends = getBackends();
        const [ctx, damRoot] = await Promise.all([
            buildRequestContext(backends, used),
            navigate(backends.dam),
        ]);
        const detailResult = await productDetailView(query, ctx.pimRoot, ctx.erpRoot, damRoot, used);
        if (detailResult.kind === 'notFound') {
            return reply.code(404).send({ message: `Product not found: ${query.sku}` });
        }
        if (detailResult.kind === 'error') {
            return assembleResponse(query, ctx, {}, used, { toast: detailResult.toast });
        }
        return assembleResponse(query, ctx, { detail: detailResult.view }, used, {
            productMeta: detailResult.productMeta
        });
    });

    // GET /bff/search — requires ?search=<q>
    fastify.get('/bff/search', {
        schema: { querystring: SearchQuerySchema, response: { 200: bffApi.main.schema } }
    }, (req) => renderView(req, 'search', (q, ctx, used) => searchView(q, ctx.pimRoot, ctx.erpRoot, used)));

    // GET /bff/cart
    fastify.get('/bff/cart', {
        schema: {
            querystring: BaseQuerySchema,
            response: { 200: bffApi.main.schema }
        }
    }, async (req) => {
        const query: QueryState = { ...req.query, view: 'cart' };
        const used = new Set<SourceId>();
        const ctx = await buildRequestContext(getBackends(), used);
        const crmOffers = await ctx.getCrmOffers();
        const topOffer = crmOffers.items[0];
        const offerInfo = topOffer ? { code: topOffer.code, discount: topOffer.discount } : undefined;
        const view = await cartView(query, ctx.pimRoot, ctx.erpRoot, offerInfo, used);
        return assembleResponse(query, ctx, view, used);
    });

    // GET /bff/wishlist
    fastify.get('/bff/wishlist', {
        schema: { querystring: BaseQuerySchema, response: { 200: bffApi.main.schema } }
    }, (req) => renderView(req, 'wishlist', (q, ctx, used) => wishlistView(q, ctx.pimRoot, ctx.erpRoot, used)));

    // GET /bff/orders
    fastify.get('/bff/orders', {
        schema: { querystring: BaseQuerySchema, response: { 200: bffApi.main.schema } }
    }, (req) => renderView(req, 'orders', (q, ctx, used) => ordersView(q, ctx.erpRoot, used)));

    // GET /bff/order-confirmation — requires ?orderId=<id>
    fastify.get('/bff/order-confirmation', {
        schema: {
            querystring: OrderConfirmationQuerySchema,
            response: { 200: bffApi.main.schema }
        }
    }, async (req) => {
        let query: QueryState = { ...req.query, view: 'order-confirmation' };
        const used = new Set<SourceId>();
        const ctx = await buildRequestContext(getBackends(), used);
        const result = await orderConfirmationView(query, query.orderId!, ctx.erpRoot, used);
        // Patch query so buildBreadcrumbs reflects the actual rendered view when the
        // orderId lookup falls back to the orders list.
        if (result.effectiveView !== 'order-confirmation') query = { ...query, view: result.effectiveView };
        return assembleResponse(query, ctx, result.view, used, { toast: result.toast });
    });

    // --- Action routes (POST-via-GET) ---
    // Each route below performs a mutation and redirects back to the main state endpoint.
    // Using GET lets the browser follow the redirect without a second round-trip and
    // makes the action URL bookmarkable/shareable for testing.

    fastify.get('/bff/actions/add-to-cart', {
        schema: {
            querystring: Type.Object({
                sku: Type.String(),
                qty: Type.String(),
                cart: Type.Optional(Type.Array(Type.String()))
            })
        }
    }, async (req, reply) => {
        const sku = req.query.sku!;
        const qty = req.query.qty!;

        const response = await postToErp(getBaseUrl(), '/erp/orders', { sku, quantity: Number(qty) });

        if (response.status === 409) {
            // Intentionally redirect to the product detail page (via `sku`) so the user
            // sees the updated "Out of Stock" status. Returning to the originating list
            // would leave them without context about why the add failed.
            return reply.redirect(productDetailUrl({ cart: req.query.cart, sku, title: 'Stock Problem', message: 'Someone grabbed the last one!', variant: 'danger' }));
        }
        if (response.status === 404) {
            // Same UX intent as the 409/500 branches: land on the (now presumably
            // stale) product detail page with a danger toast explaining the failure.
            return reply.redirect(productDetailUrl({ cart: req.query.cart, sku, title: 'Error', message: 'Unknown product', variant: 'danger' }));
        }
        if (!response.ok) {
            // Same UX intent: land on the product page with an error toast so the user
            // can see which item failed and retry from a known state.
            return reply.redirect(productDetailUrl({ cart: req.query.cart, sku, title: 'Error', message: 'Could not add to cart', variant: 'danger' }));
        }

        const cart = [...(req.query.cart || []), sku];
        // The action querystring only carries `sku`, `qty`, `cart` — we deliberately
        // don't spread `req.query` because there is no wishlist/category/etc. here
        // to preserve. Just emit the minimum state the cart view needs.
        return reply.redirect(cartUrl({ cart, title: 'Cart', message: 'Added to cart!' }));
    });

    // Toggle a product in/out of the wishlist and redirect back to the originating view
    fastify.get('/bff/actions/toggle-wishlist', {
        schema: {
            querystring: Type.Object({
                sku: Type.String(),
                returnView: Type.String(),
                wishlist: Type.Optional(Type.Array(Type.String())),
                cart: Type.Optional(Type.Array(Type.String())),
            })
        }
    }, async (req, reply) => {
        const sku = req.query.sku!;
        const returnView = req.query.returnView!;
        const wishlist = [...(req.query.wishlist || [])];
        const cart = req.query.cart || [];
        const idx = wishlist.indexOf(sku);
        let message: string;
        if (idx >= 0) {
            wishlist.splice(idx, 1);
            message = 'Removed from wishlist';
        } else {
            wishlist.push(sku);
            message = 'Saved to wishlist';
        }

        // Decode returnView and rebuild the state we came from
        const base: QueryState = { wishlist, cart, message, title: 'Wishlist' };
        if (returnView.startsWith('sku:')) { base.view = 'product'; base.sku = returnView.slice(4); }
        else if (returnView.startsWith('category:')) { base.view = 'category'; base.category = returnView.slice(9); }
        else if (returnView.startsWith('search:')) { base.view = 'search'; base.search = returnView.slice(7); }
        else if (returnView === 'cart') base.view = 'cart';
        else if (returnView === 'wishlist') base.view = 'wishlist';
        else if (returnView === 'orders') base.view = 'orders';
        else base.view = 'home';

        return reply.redirect(viewUrl(base));
    });

    // Remove item from cart by index, redirect back to cart
    fastify.get('/bff/actions/remove-from-cart', {
        schema: {
            querystring: Type.Object({
                index: Type.Integer({ minimum: 0 }),
                cart: Type.Optional(Type.Array(Type.String())),
                wishlist: Type.Optional(Type.Array(Type.String())),
            })
        }
    }, async (req, reply) => {
        const idx = req.query.index!; // Fastify validates + coerces before the handler runs
        const cart = [...(req.query.cart || [])];
        const wishlist = [...(req.query.wishlist || [])];
        if (idx < cart.length) {
            cart.splice(idx, 1);
        }
        return reply.redirect(cartUrl({ cart, wishlist, message: 'Item removed', title: 'Cart' }));
    });

    // Move an item from the cart into the wishlist
    fastify.get('/bff/actions/save-for-later', {
        schema: {
            querystring: Type.Object({
                index: Type.Integer({ minimum: 0 }),
                cart: Type.Optional(Type.Array(Type.String())),
                wishlist: Type.Optional(Type.Array(Type.String())),
            })
        }
    }, async (req, reply) => {
        const idx = req.query.index!; // Fastify validates + coerces before the handler runs
        const cart = [...(req.query.cart || [])];
        const wishlist = [...(req.query.wishlist || [])];
        if (idx < cart.length) {
            const [sku] = cart.splice(idx, 1);
            if (sku && !wishlist.includes(sku)) wishlist.push(sku);
        }
        return reply.redirect(cartUrl({ cart, wishlist, message: 'Saved for later', title: 'Wishlist' }));
    });

    // Checkout: place orders for all cart items, redirect to confirmation
    fastify.get('/bff/actions/checkout', {
        schema: {
            querystring: Type.Object({
                cart: Type.Optional(Type.Array(Type.String()))
            })
        }
    }, async (req, reply) => {
        const cartSkus = req.query.cart || [];
        if (!cartSkus.length) {
            return reply.redirect(cartUrl({ title: 'Error', message: 'Cart is empty', variant: 'danger' }));
        }

        // Place an order for each unique SKU with its quantity
        const skuCounts = new Map<string, number>();
        for (const sku of cartSkus) {
            skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
        }

        /**
         * Place all orders in parallel. This reduces latency from O(n·RTT)
         * to O(RTT), and is closer to what a production BFF would do.
         *
         * ATOMICITY GAP (showcase simplification): the ERP mock has no
         * batch or transaction endpoint, so individual orders may still
         * partially commit if some POSTs succeed and others fail. On any
         * failure we redirect to an *empty* cart — never the original
         * cart — so the user is not nudged into retrying the full cart,
         * which would duplicate already-committed orders. Already-placed
         * orders are not automatically cancelled; the user is directed to
         * their order history instead.
         *
         * The production fix is a batch ERP endpoint that accepts an array
         * of line items and commits all-or-nothing. The endpoint would receive
         * the full cart as a single payload and either commit every item or
         * roll back the entire transaction.
         */
        const orderResults = await Promise.allSettled(
            [...skuCounts.entries()].map(([sku, qty]) =>
                postToErp(getBaseUrl(), '/erp/orders', { sku, quantity: qty }).then(async response => {
                    if (!response.ok) throw new Error(`order failed for ${sku}`);
                    return (await response.json()) as { id: string };
                })
            )
        );

        const failures = orderResults
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map(r => r.reason instanceof Error ? r.reason.message : String(r.reason));
        if (failures.length > 0) {
            return reply.redirect(cartUrl({
                title: 'Checkout Failed',
                message: `${failures.join('; ')}. Already-placed orders were not cancelled — please check Your Orders.`,
                variant: 'danger'
            }));
        }

        const lastOrderId = (orderResults[orderResults.length - 1] as PromiseFulfilledResult<{ id: string }>).value.id;

        // Credit loyalty points earned on this checkout to the CRM profile.
        // Fire-and-forget: if the CRM credit fails we log it but do not block the
        // redirect — the orders are already committed on the ERP side.
        // Points = 1 per whole dollar of each successfully placed order total.
        const successfulOrders = orderResults
            .filter((r): r is PromiseFulfilledResult<{ id: string; total?: number }> => r.status === 'fulfilled')
            .map(r => r.value);
        // Fetch ERP order totals so we know the exact amounts to credit.
        const earnedPoints = await (async () => {
            try {
                const erpResponse = await fetch(`${getBaseUrl()}/erp/orders`);
                if (!erpResponse.ok) return 0;
                const erpOrders = (await erpResponse.json()) as { items: { id: string; total: number }[] };
                const placedIds = new Set(successfulOrders.map(o => o.id));
                const total = erpOrders.items
                    .filter(o => placedIds.has(o.id))
                    .reduce((sum, o) => sum + o.total, 0);
                return computeLoyaltyEarn(total);
            } catch {
                return 0;
            }
        })();

        if (earnedPoints > 0) {
            postToCrm(getBaseUrl(), '/crm/loyalty/credit', { points: earnedPoints }).catch(err => {
                console.error('[BFF] CRM loyalty credit failed (non-blocking):', err);
            });
        }

        const pointsMsg = earnedPoints > 0 ? ` ${earnedPoints} loyalty points earned!` : '';
        return reply.redirect(orderConfirmationUrl({
            orderId: lastOrderId,
            message: `Order placed successfully!${pointsMsg}`,
            title: 'Order Confirmed'
        }));
    });
};
