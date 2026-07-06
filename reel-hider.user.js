// ==UserScript==
// @name         [Instagram] Reel Hider
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      2.6
// @description  Replaces profile grid Reels with an interactive, solid-color placeholder to completely kill the curiosity gap, togglable individually or via shortcut.
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
            MAIN_CONTAINER: 'main, div[role="main"]',
            NEW_REELS: ':is(main, div[role="main"]) a:is([href*="/reel/"], [href*="/reels/"]):has(img, video):not([data-tm-overlay-injected])',
            ALL_INJECTED_REELS: 'a[data-tm-overlay-injected="true"]'
        },

        ICONS: {
            SHOW: 'M21 3H3c-1.11 0-2 .89-2 2v14c0 1.1.89 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.11-.9-2-2-2zm-11 13V8l7 4-7 4z',
            HIDE: 'M21 3H6.53l2 2H21v12.47l2 2V5c0-1.11-.9-2-2-2zM2.1 2.1.69 3.51 3 5.83V19c0 1.1.89 2 2 2h13.17l2.31 2.31 1.41-1.41L2.1 2.1zM5 19V7.83l11.17 11.17H5z'
        },

        THEME: {
            DARK: {
                COVER_BG: '#0c1014', // Matches exact IG Dark Mode
                BTN_BG: 'rgba(30, 30, 30, 0.85)',
                BTN_TEXT: '#ffffff',
                BTN_BORDER: 'rgba(255, 255, 255, 0.15)'
            },
            LIGHT: {
                COVER_BG: '#FFFFFF', // Matches IG Light Mode
                BTN_BG: 'rgba(255, 255, 255, 0.95)',
                BTN_TEXT: '#000000',
                BTN_BORDER: 'rgba(0, 0, 0, 0.1)'
            }
        }
    };

    const log = (...args) => {
        if (CONFIG.DEBUG) console.log('[Instagram Reel Declutter]', ...args);
    };

    const haltEvent = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    // =========================================================
    // STATE & SESSION MANAGEMENT
    // =========================================================
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
    // THEME OBSERVER (Detects manual IG dark mode toggles)
    // =========================================================
    const syncThemeState = () => {
        const html = document.documentElement;
        let theme = null;

        if (html.classList.contains('dark') || html.classList.contains('__fb-dark-mode') || html.getAttribute('data-theme') === 'dark') {
            theme = 'dark';
        } else if (html.classList.contains('light') || html.classList.contains('__fb-light-mode') || html.getAttribute('data-theme') === 'light') {
            theme = 'light';
        } else if (document.body) {
            const bodyBg = window.getComputedStyle(document.body).backgroundColor;
            const rgb = bodyBg.match(/\d+/g);
            if (rgb && rgb.length >= 3 && rgb[3] !== '0') {
                const brightness = (parseInt(rgb[0]) * 299 + parseInt(rgb[1]) * 587 + parseInt(rgb[2]) * 114) / 1000;
                theme = brightness < 128 ? 'dark' : 'light';
            }
        }

        if (theme !== html.dataset.tmTheme) {
            if (theme) html.dataset.tmTheme = theme;
            else delete html.dataset.tmTheme;
            log(`Theme synchronized to: ${theme || 'OS Default'}`);
        }
    };

    const initThemeObserver = () => {
        syncThemeState();

        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            for (const mut of mutations) {
                if (mut.type === 'attributes' && (mut.attributeName === 'class' || mut.attributeName === 'data-theme' || mut.attributeName === 'style')) {
                    shouldUpdate = true;
                    break;
                }
            }
            if (shouldUpdate) requestAnimationFrame(syncThemeState);
        });

        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });

        const observeBody = () => {
            if (document.body) {
                observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
                syncThemeState();
            } else {
                requestAnimationFrame(observeBody);
            }
        };
        observeBody();
    };

    // =========================================================
    // ROUTING & PERFORMANCE-SCOPED OBSERVER
    // =========================================================
    const isProfileGridRoute = () => {
        const path = window.location.pathname;
        if (path === '/' || /^\/(explore|direct|stories)\/?/.test(path)) return false;
        return true;
    };

    let lastUrl = '';
    let gridObserver = null;

    const connectGridObserver = () => {
        if (gridObserver) return;

        // Attaching to document.body ensures the observer survives React
        // completely destroying and replacing the <main> container on navigation.
        gridObserver = new MutationObserver((mutations) => {
            if (mutations.some(m => m.addedNodes.length > 0)) {
                requestAnimationFrame(scanForReels);
            }
        });

        gridObserver.observe(document.body, { childList: true, subtree: true });
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

        // Force a clean reset of the observer to prevent holding dead DOM references
        disconnectGridObserver();

        if (isProfileGridRoute()) {
            document.documentElement.dataset.tmHideReels = 'true';
            connectGridObserver();

            // Staggered micro-delays to flawlessly catch React's asynchronous rendering
            requestAnimationFrame(scanForReels);
            setTimeout(scanForReels, 150);
            setTimeout(scanForReels, 400);
            setTimeout(scanForReels, 800);

            const sessionState = getSessionRevealedSet();
            document.querySelectorAll(CONFIG.SELECTORS.ALL_INJECTED_REELS).forEach(reel => {
                const id = getReelID(reel.href);
                const shouldBeRevealed = id && sessionState.has(id);
                toggleReelState(reel, !shouldBeRevealed, true);
            });
        } else {
            delete document.documentElement.dataset.tmHideReels;
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

        const observeHead = () => {
            const head = document.querySelector('head');
            if (head) {
                let rafId;
                new MutationObserver(() => {
                    cancelAnimationFrame(rafId);
                    rafId = requestAnimationFrame(updateRouteState);
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

        const reelID = getReelID(reelLink.href);
        const sessionState = getSessionRevealedSet();
        const startRevealed = reelID && sessionState.has(reelID);
        reelLink.dataset.tmReelState = startRevealed ? 'revealed' : 'hidden';

        // 1. Solid color cover layer
        const coverLayer = document.createElement('div');
        coverLayer.className = 'tm-reel-cover-layer';
        coverLayer.addEventListener('click', haltEvent);

        // 2. Interactive toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'tm-reel-toggle-btn';
        toggleBtn.appendChild(createIconSVG(startRevealed ? CONFIG.ICONS.HIDE : CONFIG.ICONS.SHOW));

        toggleBtn.addEventListener('click', (e) => {
            haltEvent(e);
            toggleReelState(reelLink, null);
        });

        reelLink.appendChild(coverLayer);
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

                let hiddenCount = 0;
                allReels.forEach(r => { if (r.dataset.tmReelState === 'hidden') hiddenCount++; });
                const hideAll = hiddenCount < (allReels.length / 2);

                const sessionState = getSessionRevealedSet();
                allReels.forEach(reel => {
                    toggleReelState(reel, hideAll, true);
                    const id = getReelID(reel.href);
                    if (id) hideAll ? sessionState.delete(id) : sessionState.add(id);
                });
                saveSessionRevealedSet(sessionState);

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
            /* --- DEFAULT (LIGHT MODE) --- */
            :root {
                --tm-reel-cover-bg: ${CONFIG.THEME.LIGHT.COVER_BG};
                --tm-reel-btn-bg: ${CONFIG.THEME.LIGHT.BTN_BG};
                --tm-reel-btn-text: ${CONFIG.THEME.LIGHT.BTN_TEXT};
                --tm-reel-btn-border: ${CONFIG.THEME.LIGHT.BTN_BORDER};
            }

            /* --- OS DARK MODE (Fallback) --- */
            @media (prefers-color-scheme: dark) {
                html:not([data-tm-theme="light"]) {
                    --tm-reel-cover-bg: ${CONFIG.THEME.DARK.COVER_BG};
                    --tm-reel-btn-bg: ${CONFIG.THEME.DARK.BTN_BG};
                    --tm-reel-btn-text: ${CONFIG.THEME.DARK.BTN_TEXT};
                    --tm-reel-btn-border: ${CONFIG.THEME.DARK.BTN_BORDER};
                }
            }

            /* --- MANUAL DARK MODE --- */
            html[data-tm-theme="dark"] {
                --tm-reel-cover-bg: ${CONFIG.THEME.DARK.COVER_BG} !important;
                --tm-reel-btn-bg: ${CONFIG.THEME.DARK.BTN_BG} !important;
                --tm-reel-btn-text: ${CONFIG.THEME.DARK.BTN_TEXT} !important;
                --tm-reel-btn-border: ${CONFIG.THEME.DARK.BTN_BORDER} !important;
            }

            /* Scoped using :is() to prevent comma selector leakage */
            html[data-tm-hide-reels="true"] :is(${CONFIG.SELECTORS.MAIN_CONTAINER}) a:is([href*="/reel/"], [href*="/reels/"]):has(img, video) {
                position: relative !important;
                display: block;
            }

            /* --- SOLID COVER LAYER --- */
            .tm-reel-cover-layer {
                position: absolute;
                inset: 0;
                background-color: var(--tm-reel-cover-bg);
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
            html[data-tm-hide-reels="true"] a[data-tm-reel-state="hidden"] .tm-reel-cover-layer {
                opacity: 1;
                pointer-events: auto;
            }

            html[data-tm-hide-reels="true"] a[data-tm-reel-state="hidden"] .tm-reel-toggle-btn {
                opacity: 1;
            }

            /* --- STATE: REVEALED --- */
            html[data-tm-hide-reels="true"] a[data-tm-reel-state="revealed"] .tm-reel-cover-layer {
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
            html:not([data-tm-hide-reels="true"]) .tm-reel-cover-layer,
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
        initThemeObserver();
        initRouteObserver();
        initKeyboardShortcuts();
    } catch (error) {
        console.error('[Instagram Reel Declutter] Failed to initialize:', error);
    }

})();
