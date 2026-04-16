
// --- Browser history helpers ---

const FRONTEND_PATH = '/frontend';
const BFF_PATH = '/bff';

function currentStateUri() {
    // Include the sub-path so /frontend/category?... reconstructs /bff/category?...
    return BFF_PATH + window.location.pathname.slice(FRONTEND_PATH.length) + window.location.search;
}

function toStateUri(response) {
    const url = new URL(response.url);
    return url.pathname + url.search;
}

function toFrontendUri(stateUri) {
    return FRONTEND_PATH + stateUri.slice(BFF_PATH.length);
}

function pushBrowserState(stateUri) {
    const frontendUri = toFrontendUri(stateUri);
    if (window.location.pathname + window.location.search === frontendUri) return;
    window.history.pushState({ stateUri }, '', frontendUri);
}

// --- Alpine data ---

document.addEventListener('alpine:init', () => {
    Alpine.data('app', () => ({
        state: {
            nav: { home: {}, categories: [], cart: { count: 0 } },
            chrome: {},
        },
        isLoading: false,
        error: null,

        async init() {
            await this.updateStateFrom(currentStateUri());

            window.addEventListener('popstate', (event) => {
                const uri = event.state?.stateUri || currentStateUri();
                this.updateStateFrom(uri, false);
            });
        },

        async updateStateFrom(stateUri, pushToHistory = true) {
            if (!stateUri || this.isLoading) return;

            this.isLoading = true;
            this.error = null;
            try {
                const res = await fetch(stateUri);
                if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

                this.state = await res.json();

                if (pushToHistory) {
                    pushBrowserState(toStateUri(res));
                }
            } catch (err) {
                console.error('Loading failed:', err);
                this.error = err.message || 'Failed to load data';
            } finally {
                this.isLoading = false;
            }
        }
    }));
});
