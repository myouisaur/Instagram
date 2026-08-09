// ==UserScript==
// @name         [Instagram] Carousel Indicator
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      4.5
// @description  Adds a native mobile-style position badge to multi-image carousels on the web.
// @author       Xiv
// @match        *://*.instagram.com/*
// @run-at       document-idle
// @noframes
// @updateURL    https://myouisaur.github.io/Instagram/carousel-indicator.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/carousel-indicator.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.xivCarouselIndicatorInitialized) return;
    window.xivCarouselIndicatorInitialized = true;

    // ==========================================
    // 1. CONFIGURATION & STATE
    // ==========================================

    const CONFIG = {
        DEBUG: false,

        // Selectors (Scoped strictly to stable views: single posts and modals)
        SELECTORS: {
            POST_CONTAINERS: 'article, [role="dialog"], main div > div > div > div > div:first-child'
        },

        // Layout Constraints
        LAYOUT: {
            MIN_MEDIA_SIZE: 250
        },

        // Timing
        TIMING: {
            DEBOUNCE_MS: 200,
            DEBOUNCE_MAX_WAIT_MS: 400,
            HYDRATION_DELAY_MS: 300,
            TRANSITION_DELAY_MS: 150,
            HYDRATION_CHECKS: [100, 400, 800]
        },

        // CSS Classes
        CLASSES: {
            BADGE: 'xiv-carousel-badge',
            TEXT: 'xiv-carousel-text',
            VISIBLE: 'xiv-carousel-visible',
            LENS: 'xiv-badge-lens',
            SCATTER: 'xiv-badge-scatter',
            CHROMA: 'xiv-badge-chroma',
            RIM: 'xiv-badge-rim'
        }
    };

    const processedContainers = new WeakMap();

    const State = {
        mainObserver: null,
        debounceTimer: null,
        pendingSince: null
    };

    // ==========================================
    // 2. STYLESHEET (LIQUID GLASS PILL)
    // ==========================================

    const CSS = `
        .${CONFIG.CLASSES.BADGE} {
            position: absolute;
            top: clamp(0.75rem, 3%, 1.25rem);
            right: clamp(0.75rem, 3%, 1.25rem);
            border: none;
            outline: none;
            border-radius: 9999px;
            z-index: 50;
            pointer-events: none;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: clamp(0.25rem, 1vw, 0.375rem) clamp(0.5rem, 2vw, 0.75rem);
            min-width: 2.5rem;
            user-select: none;
            -webkit-user-select: none;
            opacity: 0;
            will-change: transform, opacity;
            transform: translateZ(0) scale(0.9) translateY(4px);
            background: rgba(255, 255, 255, 0.14);
            backdrop-filter: blur(0.5em) saturate(180%) brightness(1.1);
            -webkit-backdrop-filter: blur(0.5em) saturate(180%) brightness(1.1);
            box-shadow:
                inset 0  1.5px 0   rgba(255,255,255,0.75),
                inset 0 -1.5px 0   rgba(255,255,255,0.06),
                inset  1px 0   0   rgba(255,255,255,0.30),
                inset -1px 0   0   rgba(255,255,255,0.10),
                0 0 0 1px          rgba(0,0,0,0.08),
                0 3px 8px          rgba(0,0,0,0.10);
            transition:
                opacity 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .${CONFIG.CLASSES.BADGE}.${CONFIG.CLASSES.VISIBLE} {
            opacity: 1;
            transform: translateZ(0) scale(1) translateY(0);
        }

        .${CONFIG.CLASSES.BADGE}::before {
            content: ''; position: absolute; inset: 0; border-radius: 9999px; padding: 1px;
            background: linear-gradient(155deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.35) 25%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.22) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; z-index: 5;
        }

        .${CONFIG.CLASSES.BADGE}::after {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 58%;
            background: radial-gradient(ellipse 75% 70% at 50% -8%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.20) 40%, rgba(255,255,255,0.05) 70%, transparent 90%);
            border-radius: 9999px 9999px 0 0; pointer-events: none; z-index: 5;
        }

        .${CONFIG.CLASSES.LENS} {
            position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 9999px;
            background: radial-gradient(ellipse at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
            pointer-events: none; z-index: 1;
        }
        .${CONFIG.CLASSES.SCATTER} {
            position: absolute; inset: 2px; border-radius: 9999px;
            background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
            pointer-events: none; z-index: 2;
        }
        .${CONFIG.CLASSES.CHROMA} {
            position: absolute; inset: 0; border-radius: 9999px;
            background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
            pointer-events: none; z-index: 3;
        }
        .${CONFIG.CLASSES.RIM} {
            position: absolute; bottom: 0; left: 10%; right: 10%; height: 40%; border-radius: 0 0 9999px 9999px;
            background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
            pointer-events: none; z-index: 4;
        }

        .${CONFIG.CLASSES.TEXT} {
            position: relative; z-index: 6; color: rgba(255, 255, 255, 0.96);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: clamp(0.75rem, 1.5vw, 0.875rem); font-weight: 600; letter-spacing: 0.3px; line-height: 1;
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
        }
    `;

    // ==========================================
    // 3. UTILITIES & EXTRACTORS
    // ==========================================

    function log(...args) {
        if (CONFIG.DEBUG) console.log('[IG Carousel]', ...args);
    }

    const HydrationSafeguard = {
        executeWhenStable(callback) {
            const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
            idle(() => setTimeout(callback, CONFIG.TIMING.HYDRATION_DELAY_MS), { timeout: 2000 });
        }
    };

    const Extractor = {
        findDotsContainer(root) {
            const divs = root.querySelectorAll('div');
            for (let i = 0; i < divs.length; i++) {
                const div = divs[i];
                const len = div.children.length;

                if (len >= 2 && len <= 20) {
                    let isDots = true;
                    for (let j = 0; j < len; j++) {
                        const child = div.children[j];
                        if (child.tagName !== 'DIV' || child.children.length > 0 || child.textContent.trim() !== '') {
                            isDots = false;
                            break;
                        }
                    }
                    if (isDots) {
                        const rect = div.getBoundingClientRect();
                        if (rect.height > 0 && rect.height < 40 && rect.width > 10) return div;
                    }
                }
            }
            return null;
        },

        getMediaContainer(dotsContainer, root) {
            let current = dotsContainer.parentElement;
            while (current && current !== root) {
                const rect = current.getBoundingClientRect();
                if (rect.width > CONFIG.LAYOUT.MIN_MEDIA_SIZE && rect.height > CONFIG.LAYOUT.MIN_MEDIA_SIZE) return current;
                current = current.parentElement;
            }
            return root;
        },

        getDotState(dotsContainer) {
            let current = -1;
            let total = dotsContainer.children.length;

            try {
                let node = dotsContainer;
                let depth = 0;
                while (node && depth < 5) {
                    const fiberKey = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
                    if (fiberKey) {
                        let fiber = node[fiberKey];
                        let fDepth = 0;
                        while (fiber && fDepth < 15) {
                            const props = fiber.memoizedProps;
                            if (props) {
                                if (typeof props.selectedIndex === 'number') current = props.selectedIndex;
                                else if (typeof props.activeIndex === 'number') current = props.activeIndex;

                                if (typeof props.numItems === 'number') total = props.numItems;
                                else if (typeof props.total === 'number') total = props.total;
                                else if (props.carousel_media) total = props.carousel_media.length;

                                if (current !== -1 && total > 0) return { current: current + 1, total };
                            }
                            fiber = fiber.return;
                            fDepth++;
                        }
                    }
                    node = node.parentElement;
                    depth++;
                }
            } catch (e) {
                if (CONFIG.DEBUG) console.warn('Fiber dots extraction failed:', e);
            }

            const dots = Array.from(dotsContainer.children);
            if (total === 2) {
                const opacity0 = parseFloat(window.getComputedStyle(dots[0]).opacity) || 1;
                const opacity1 = parseFloat(window.getComputedStyle(dots[1]).opacity) || 1;
                current = (opacity0 > opacity1) ? 0 : 1;
            } else {
                const classMap = new Map();
                dots.forEach((dot, idx) => {
                    const c = dot.className;
                    if (!classMap.has(c)) classMap.set(c, []);
                    classMap.get(c).push(idx);
                });
                for (const [className, indices] of classMap.entries()) {
                    if (indices.length === 1) { current = indices[0]; break; }
                }
            }

            return { current: Math.max(1, current + 1), total };
        }
    };

    // ==========================================
    // 4. CORE MANAGER
    // ==========================================

    const CarouselManager = {
        initPost(rootElement, attempt = 0) {
            if (processedContainers.has(rootElement)) return;

            const dotsContainer = Extractor.findDotsContainer(rootElement);
            if (!dotsContainer) {
                // Dots may not be hydrated yet — common for modals opened via SPA navigation,
                // which render a shell before the carousel content populates a beat later.
                // Retry on the same staggered schedule already used for initial page-load
                // hydration, instead of relying on some unrelated future DOM mutation to
                // happen to re-trigger a global rescan (this was the modal-specific delay).
                log(`initPost: no dots container found (attempt ${attempt})`);
                if (attempt < CONFIG.TIMING.HYDRATION_CHECKS.length) {
                    setTimeout(
                        () => this.initPost(rootElement, attempt + 1),
                        CONFIG.TIMING.HYDRATION_CHECKS[attempt]
                    );
                }
                return;
            }

            const mediaContainer = Extractor.getMediaContainer(dotsContainer, rootElement);
            if (!mediaContainer || mediaContainer.querySelector(`.${CONFIG.CLASSES.BADGE}`)) return;

            log(`initPost: badge created on attempt ${attempt}`);
            processedContainers.set(rootElement, true);

            const style = window.getComputedStyle(mediaContainer);
            if (style.position === 'static') mediaContainer.style.position = 'relative';

            const badge = document.createElement('div'); badge.className = CONFIG.CLASSES.BADGE;
            const lens = document.createElement('div'); lens.className = CONFIG.CLASSES.LENS;
            const scatter = document.createElement('div'); scatter.className = CONFIG.CLASSES.SCATTER;
            const chroma = document.createElement('div'); chroma.className = CONFIG.CLASSES.CHROMA;
            const rim = document.createElement('div'); rim.className = CONFIG.CLASSES.RIM;
            const textLayer = document.createElement('span'); textLayer.className = CONFIG.CLASSES.TEXT;

            badge.append(lens, scatter, chroma, rim, textLayer);

            try { mediaContainer.appendChild(badge); }
            catch(err) { log('Failed to append badge', err); return; }

            // Unified State Synchronizer (Prioritizes URL Index instantly)
            const syncBadgeState = () => {
                const domState = Extractor.getDotState(dotsContainer);
                const urlParams = new URLSearchParams(window.location.search);
                const urlIndex = urlParams.get('img_index');

                let activeCurrent = domState.current;

                // Validate the URL parameter applies to this specific post context
                if (urlIndex) {
                    const isModal = rootElement.getAttribute('role') === 'dialog';
                    const hasMatchingLink = Array.from(rootElement.querySelectorAll('a')).some(a => a.pathname === window.location.pathname);

                    if (isModal || hasMatchingLink) {
                        const parsed = parseInt(urlIndex, 10);
                        if (!isNaN(parsed) && parsed > 0 && parsed <= domState.total) {
                            activeCurrent = parsed;
                        }
                    }
                }

                textLayer.textContent = `${activeCurrent}/${domState.total}`;
            };

            // Attach sync function directly to DOM node so the URL listener can trigger it globally
            mediaContainer.xivSyncBadge = syncBadgeState;

            // Initial Paint
            window.requestAnimationFrame(syncBadgeState);
            CONFIG.TIMING.HYDRATION_CHECKS.forEach(delay => setTimeout(() => window.requestAnimationFrame(syncBadgeState), delay));

            window.requestAnimationFrame(() => {
                void badge.offsetWidth;
                badge.classList.add(CONFIG.CLASSES.VISIBLE);
            });

            let transitionTimer = null;

            // DOM Observer fallback
            const dotObserver = new MutationObserver(() => {
                if (transitionTimer) clearTimeout(transitionTimer);

                const hasUrlIndex = new URLSearchParams(window.location.search).has('img_index');

                // If URL-driven navigation is active, bypass the 150ms delay for zero-latency updates
                if (hasUrlIndex) {
                    window.requestAnimationFrame(syncBadgeState);
                } else {
                    transitionTimer = setTimeout(() => {
                        window.requestAnimationFrame(syncBadgeState);
                    }, CONFIG.TIMING.TRANSITION_DELAY_MS);
                }
            });

            dotObserver.observe(dotsContainer, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style'] });
            log('Initialized carousel instance v4.5');
        }
    };

    // ==========================================
    // 5. LIFECYCLE & DOM INJECTION
    // ==========================================

    const App = {
        injectStyles() {
            if (document.getElementById('xiv-carousel-styles')) return;
            const style = document.createElement('style');
            style.id = 'xiv-carousel-styles';
            style.textContent = CSS;

            if (typeof GM_addStyle === 'function') GM_addStyle(CSS);
            else document.head.appendChild(style);
        },

        processDOM() {
            const posts = document.querySelectorAll(CONFIG.SELECTORS.POST_CONTAINERS);
            log(`processDOM: scanning ${posts.length} candidate container(s)`);
            posts.forEach(post => CarouselManager.initPost(post));
        },

        requestUpdate() {
            const now = Date.now();
            if (!State.pendingSince) State.pendingSince = now;

            if (State.debounceTimer) clearTimeout(State.debounceTimer);

            // Under continuous DOM churn (e.g. a modal's comments still streaming in), every
            // mutation resets the trailing debounce, which could otherwise delay processDOM()
            // indefinitely until the churn happens to pause. Force an immediate run once we've
            // been waiting too long, so detection latency stays bounded regardless of context.
            const elapsed = now - State.pendingSince;
            const delay = elapsed >= CONFIG.TIMING.DEBOUNCE_MAX_WAIT_MS ? 0 : CONFIG.TIMING.DEBOUNCE_MS;

            State.debounceTimer = setTimeout(() => {
                State.pendingSince = null;
                window.requestAnimationFrame(() => this.processDOM());
            }, delay);
        },

        startObserver() {
            if (State.mainObserver) State.mainObserver.disconnect();
            State.mainObserver = new MutationObserver((mutations) => {
                const shouldUpdate = mutations.some(m => m.addedNodes.length > 0 || m.type === 'attributes');
                if (shouldUpdate) this.requestUpdate();
            });
            State.mainObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        },

        setupHooks() {
            // Instant broadcast for URL parameter changes
            const notifyUrlChange = () => window.dispatchEvent(new CustomEvent('xiv:urlChange'));

            window.addEventListener('popstate', () => {
                notifyUrlChange();
                this.requestUpdate();
            });

            const pushState = history.pushState;
            history.pushState = function() {
                const res = pushState.apply(this, arguments);
                notifyUrlChange();
                App.requestUpdate();
                return res;
            };

            const replaceState = history.replaceState;
            history.replaceState = function() {
                const res = replaceState.apply(this, arguments);
                notifyUrlChange();
                return res;
            };

            // Global listener to trigger zero-latency sync across all active carousels
            window.addEventListener('xiv:urlChange', () => {
                document.querySelectorAll(`.${CONFIG.CLASSES.BADGE}`).forEach(badge => {
                    const container = badge.parentElement;
                    if (container && typeof container.xivSyncBadge === 'function') {
                        window.requestAnimationFrame(container.xivSyncBadge);
                    }
                });
            });

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    if (State.mainObserver) State.mainObserver.disconnect();
                    if (State.debounceTimer) clearTimeout(State.debounceTimer);
                    State.pendingSince = null;
                } else {
                    this.startObserver();
                    this.requestUpdate();
                }
            });
        },

        init() {
            this.injectStyles();
            HydrationSafeguard.executeWhenStable(() => {
                this.processDOM();
                this.startObserver();
                this.setupHooks();
                log('v4.5 Loaded (URL-Driven Zero Latency)');
            });
        }
    };

    App.init();

})();
