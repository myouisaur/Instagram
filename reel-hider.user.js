// ==UserScript==
// @name         [Instagram] Reel Hider
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      2.1
// @description  Replaces profile grid Reels with an interactive, theme-aware frosted-glass placeholder that can be toggled individually or via shortcut.
// @author       Xiv
// @match        *://*.instagram.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Instagram/reel-hider.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/reel-hider.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__tmHideReelsInitialized) return;
    window.__tmHideReelsInitialized = true;

    // =========================================================
    // CENTRALIZED CONFIGURATION
    // =========================================================
    const CONFIG = {
        DEBUG: false,
        STORAGE_KEY: 'tm-revealed-reels-session',
        SHORTCUT_KEY: 'h', // Alt + H

        SELECTORS: {
            // Fallback supports both semantic <main> and ARIA role="main"
            MAIN_CONTAINER: 'main, div[role="main"]',
            // Selects un-injected reels with images/videos
            NEW_REELS: ':is(main, div[role="main"]) a:is([href*="/reel/"], [href*="/reels/"]):has(img, video):not([data-tm-overlay-injected])',
            // Selects all injected reels for bulk toggling
            ALL_INJECTED_REELS: 'a[data-tm-overlay-injected="true"]'
        },

        ICONS: {
            SHOW: 'M21 3H3c-1.11 0-2 .89-2 2v14c0 1.1.89 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm-11 13V8l7 4-7 4z',
            HIDE: 'M21 3H6.53l2 2H21v12.47l2 2V5c0-1.11-.9-2-2-2zM2.1 2.1.69 3.51 3 5.83V19c0 1.1.89 2 2 2h13.17l2.31 2.31 1.41-1.41L2.1 2.1zM5 19V7.83l11.17 11.17H5z'
        },

        THEME: {
            BLUR_RADIUS: '16px',
            DARK: {
                BLUR_BG: 'rgba(20, 20, 20, 0.75)',
                BTN_BG: 'rgba(0, 0, 0, 0.65)',
                BTN_TEXT: '#ffffff',
                BTN_BORDER: 'rgba(255, 255, 255, 0.15)'
            },
            LIGHT: {
                BLUR_BG: 'rgba(255, 255, 255, 0.65)',
                BTN_BG: 'rgba(255, 255, 255, 0.85)',
                BTN_TEXT: '#000000',
                BTN_BORDER: 'rgba(0, 0, 0, 0.1)'
            }
        }
    };

    const log = (...args) => {
        if (CONFIG.DEBUG) console.log('[Instagram Reel Declutter]', ...args);
    };

    // =========================================================
    // STATE & SESSION MANAGEMENT
    // =========================================================

    // Extracts the unique shortcode (e.g., Cxyz123) from the reel URL
    const getReelID = (href) => {
        const match = href.match(/\/reels?\/([^\/?#]+)/);
        return match ? match[1] : null;
    };

    const getSessionRevealedSet = () => {
        try {
            return new Set(JSON.parse(sessionStorage.getItem(CONFIG.STORAGE_KEY) || '[]'));
        } catch {
            return new Set();
        }
    };

    const saveSessionRevealedSet = (revealedSet) => {
        sessionStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify([...revealedSet]));
    };

    const updateSessionState = (reelID, isRevealed) => {
        if (!reelID) return;
        const state = getSessionRevealedSet();
        isRevealed ? state.add(reelID) : state.delete(reelID);
        saveSessionRevealedSet(state);
    };

    // =========================================================
    // ROUTING & PERFORMANCE-SCOPED OBSERVER
    // =========================================================
    const isProfileGridRoute = () => {
        const path = window.location.pathname;
        if (path === '/' || /^\/(explore|direct|stories|p|reel|reels)\/?/.test(path)) return false;
        return /^\/[a-zA-Z0-9._]+\/?$/.test(path);
    };

    let lastUrl = '';
    let gridObserver = null;

    // Connects observer only when on a profile page to save CPU
    const connectGridObserver = () => {
        if (gridObserver) return;

        const target = document.querySelector(CONFIG.SELECTORS.MAIN_CONTAINER) || document.body;
        gridObserver = new MutationObserver((mutations) => {
            if (mutations.some(m => m.addedNodes.length > 0)) {
                requestAnimationFrame(scanForReels);
            }
        });

        gridObserver.observe(target, { childList: true, subtree: true });
        log('Grid observer connected.');
    };

    const disconnectGridObserver = () => {
        if (!gridObserver) return;
        gridObserver.disconnect();
        gridObserver = null;
        log('Grid observer disconnected.');
    };

    const updateRouteState = () => {
        const currentUrl = window.location.href;
        if (currentUrl === lastUrl) return;
        lastUrl = currentUrl;

        if (isProfileGridRoute()) {
            document.documentElement.dataset.tmHideReels = 'true';
            connectGridObserver();
            requestAnimationFrame(scanForReels);

            // Reconcile existing injected reels with current session storage
            const sessionState = getSessionRevealedSet();
            document.querySelectorAll(CONFIG.SELECTORS.ALL_INJECTED_REELS).forEach(reel => {
                const id = getReelID(reel.href);
                const shouldBeRevealed = id && sessionState.has(id);
                toggleReelState(reel, !shouldBeRevealed, true); // true = skipSessionUpdate
            });
        } else {
            delete document.documentElement.dataset.tmHideReels;
            disconnectGridObserver();
        }
    };

    const initRouteObserver = () => {
        updateRouteState();

        const originalPush = history.pushState;
        history.pushState = function(...args) {
            const result = originalPush.apply(this, args);
            requestAnimationFrame(updateRouteState);
            return result;
        };

        const originalReplace = history.replaceState;
        history.replaceState = function(...args) {
            const result = originalReplace.apply(this, args);
            requestAnimationFrame(updateRouteState);
            return result;
        };

        window.addEventListener('popstate', () => requestAnimationFrame(updateRouteState));

        // Fallback router detection
        const observeHead = () => {
            const head = document.querySelector('head');
            if (head) {
                let timeout;
                new MutationObserver(() => {
                    clearTimeout(timeout);
                    timeout = setTimeout(updateRouteState, 50);
                }).observe(head, { childList: true, subtree: true, characterData: true });
            } else {
                requestAnimationFrame(observeHead);
            }
        };
        observeHead();
    };

    // =========================================================
    // DOM MANIPULATION & UI
    // =========================================================
    const createIconSVG = (pathData) => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "18");
        svg.setAttribute("height", "18");
        svg.setAttribute("fill", "currentColor");

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.appendChild(path);

        return svg;
    };

    const toggleReelState = (reelLink, forceHidden = false, skipSessionUpdate = false) => {
        const isCurrentlyHidden = reelLink.dataset.tmReelState === 'hidden';
        const willBeHidden = forceHidden !== null ? forceHidden : !isCurrentlyHidden;

        reelLink.dataset.tmReelState = willBeHidden ? 'hidden' : 'revealed';

        const btn = reelLink.querySelector('.tm-reel-toggle-btn');
        if (btn) btn.replaceChildren(createIconSVG(willBeHidden ? CONFIG.ICONS.SHOW : CONFIG.ICONS.HIDE));

        if (!skipSessionUpdate) {
            updateSessionState(getReelID(reelLink.href), !willBeHidden);
        }
    };

    const createOverlay = (reelLink) => {
        reelLink.dataset.tmOverlayInjected = 'true';

        // Initial state logic based on session storage
        const reelID = getReelID(reelLink.href);
        const sessionState = getSessionRevealedSet();
        const startRevealed = reelID && sessionState.has(reelID);
        reelLink.dataset.tmReelState = startRevealed ? 'revealed' : 'hidden';

        // 1. Frosted glass layer
        const blurLayer = document.createElement('div');
        blurLayer.className = 'tm-reel-blur-layer';
        blurLayer.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // 2. Interactive toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'tm-reel-toggle-btn';
        toggleBtn.appendChild(createIconSVG(startRevealed ? CONFIG.ICONS.HIDE : CONFIG.ICONS.SHOW));

        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleReelState(reelLink, null); // null forces it to flip its current state
        });

        reelLink.appendChild(blurLayer);
        reelLink.appendChild(toggleBtn);
    };

    const scanForReels = () => {
        if (document.documentElement.dataset.tmHideReels !== 'true') return;

        const reels = document.querySelectorAll(CONFIG.SELECTORS.NEW_REELS);
        reels.forEach(reel => {
            try {
                createOverlay(reel);
            } catch (err) {
                log('Failed to inject overlay for reel node:', reel, err);
            }
        });
    };

    // =========================================================
    // KEYBOARD SHORTCUT (Alt + H)
    // =========================================================
    const initKeyboardShortcuts = () => {
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === CONFIG.SHORTCUT_KEY) {
                if (document.documentElement.dataset.tmHideReels !== 'true') return;
                e.preventDefault();

                const allReels = document.querySelectorAll(CONFIG.SELECTORS.ALL_INJECTED_REELS);
                if (allReels.length === 0) return;

                // Smart toggle: Check if majority are hidden. If so, reveal all. Otherwise, hide all.
                let hiddenCount = 0;
                allReels.forEach(r => { if (r.dataset.tmReelState === 'hidden') hiddenCount++; });
                const hideAll = hiddenCount < (allReels.length / 2);

                allReels.forEach(reel => toggleReelState(reel, hideAll));
                log(`Bulk toggled ${allReels.length} reels to ${hideAll ? 'hidden' : 'revealed'}.`);
            }
        });
    };

    // =========================================================
    // STYLING
    // =========================================================
    const injectStyles = () => {
        if (document.getElementById('tm-reel-declutter-style')) return;

        const style = document.createElement('style');
        style.id = 'tm-reel-declutter-style';

        style.textContent = `
            :root {
                --tm-reel-blur-bg: ${CONFIG.THEME.LIGHT.BLUR_BG};
                --tm-reel-btn-bg: ${CONFIG.THEME.LIGHT.BTN_BG};
                --tm-reel-btn-text: ${CONFIG.THEME.LIGHT.BTN_TEXT};
                --tm-reel-btn-border: ${CONFIG.THEME.LIGHT.BTN_BORDER};
            }

            @media (prefers-color-scheme: dark) {
                :root {
                    --tm-reel-blur-bg: ${CONFIG.THEME.DARK.BLUR_BG};
                    --tm-reel-btn-bg: ${CONFIG.THEME.DARK.BTN_BG};
                    --tm-reel-btn-text: ${CONFIG.THEME.DARK.BTN_TEXT};
                    --tm-reel-btn-border: ${CONFIG.THEME.DARK.BTN_BORDER};
                }
            }

            html[data-tm-hide-reels="true"] ${CONFIG.SELECTORS.MAIN_CONTAINER} a:is([href*="/reel/"], [href*="/reels/"]):has(img, video) {
                position: relative !important;
                display: block;
            }

            /* --- FROSTED GLASS LAYER --- */
            .tm-reel-blur-layer {
                position: absolute;
                inset: 0;
                background-color: var(--tm-reel-blur-bg);
                backdrop-filter: blur(${CONFIG.THEME.BLUR_RADIUS});
                -webkit-backdrop-filter: blur(${CONFIG.THEME.BLUR_RADIUS});
                z-index: 10;
                transition: opacity 0.3s ease;
                border-radius: inherit;
                cursor: default !important;
            }

            /* --- TOGGLE BUTTON BASE --- */
            .tm-reel-toggle-btn {
                position: absolute;
                bottom: 0.5rem;
                left: 0.5rem;
                z-index: 11;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 2.25rem;
                height: 2.25rem;
                background: var(--tm-reel-btn-bg);
                color: var(--tm-reel-btn-text);
                border: 1px solid var(--tm-reel-btn-border);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border-radius: 50%;
                cursor: pointer;
                transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
                box-shadow: 0 4px 12px rgba(0,0,0,0.25);
            }

            .tm-reel-toggle-btn:hover {
                transform: scale(1.1);
                filter: brightness(1.2);
            }

            /* --- STATE: HIDDEN --- */
            html[data-tm-hide-reels="true"] a[data-tm-reel-state="hidden"] .tm-reel-blur-layer {
                opacity: 1;
                pointer-events: auto;
            }

            html[data-tm-hide-reels="true"] a[data-tm-reel-state="hidden"] .tm-reel-toggle-btn {
                opacity: 1;
            }

            /* --- STATE: REVEALED --- */
            html[data-tm-hide-reels="true"] a[data-tm-reel-state="revealed"] .tm-reel-blur-layer {
                opacity: 0;
                pointer-events: none;
            }

            html[data-tm-hide-reels="true"] a[data-tm-reel-state="revealed"] .tm-reel-toggle-btn {
                opacity: 0.4;
            }

            html[data-tm-hide-reels="true"] a[data-tm-reel-state="revealed"] .tm-reel-toggle-btn:hover {
                opacity: 1;
            }

            /* Disable completely when off route */
            html:not([data-tm-hide-reels="true"]) .tm-reel-blur-layer,
            html:not([data-tm-hide-reels="true"]) .tm-reel-toggle-btn {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    };

    // =========================================================
    // BOOTSTRAP
    // =========================================================
    try {
        injectStyles();
        initRouteObserver();
        initKeyboardShortcuts();
    } catch (error) {
        console.error('[Instagram Reel Declutter] Failed to initialize:', error);
    }

})();
