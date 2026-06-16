// ==UserScript==
// @name         [Instagram] Reel Border Highlight in Profiles
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      1.12
// @description  Adds a dynamic, completely desynchronized, color-cycling glassmorphic inner glow to Reel thumbnails.
// @author       Xiv
// @match        *://*.instagram.com/*
// @noframes
// @updateURL    https://myouisaur.github.io/Instagram/reel-border.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/reel-border.user.js
// ==/UserScript==

(function() {
    'use strict';

    if (window.__tmReelHighlightInitialized) return;
    window.__tmReelHighlightInitialized = true;

    // =========================================================
    // CONFIGURATION
    // =========================================================
    const CONFIG = {
        GLOW_OPACITY_LIGHT: 0.85,
        GLOW_OPACITY_DARK: 1.0,
        BORDER_THICKNESS: '2px',
        HOVER_MULTIPLIER: 1.5,
        CYCLE_DURATION: 12 // Seconds to transition between two random colors
    };

    const IG_COLORS = [
        { r: 254, g: 218, b: 117 }, // Yellow
        { r: 250, g: 126, b: 30 },  // Orange
        { r: 214, g: 41,  b: 118 }, // Pink
        { r: 150, g: 47,  b: 191 }, // Purple
        { r: 79,  g: 91,  b: 213 }  // Blue
    ];

    // =========================================================
    // ROUTING & SPA MANAGEMENT
    // =========================================================
    const isAllowedRoute = () => {
        const path = window.location.pathname;
        if (path === '/' || /^\/(explore|direct|stories|p|reel|reels)\/?/.test(path)) return false;
        return /^\/[a-zA-Z0-9._]+\/?(reposts\/?|tagged\/?)?$/.test(path);
    };

    let lastUrl = '';

    const updateRouteState = () => {
        const currentUrl = window.location.href;
        if (currentUrl === lastUrl) return;
        lastUrl = currentUrl;

        if (isAllowedRoute()) {
            document.documentElement.dataset.tmProfileGrid = 'true';
            scanForReels();
        } else {
            delete document.documentElement.dataset.tmProfileGrid;
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
    // JAVASCRIPT TRUE-RNG ANIMATION ENGINE
    // =========================================================
    const reelStateMap = new WeakMap();
    let visibilityObserver = null;
    let isAnimating = false;

    // Pick a random color index that isn't the one we are currently on
    const getRandomNextColorIdx = (currentIdx) => {
        let next;
        do {
            next = Math.floor(Math.random() * IG_COLORS.length);
        } while (next === currentIdx);
        return next;
    };

    // Linear Interpolation for smooth color blending
    const lerp = (start, end, progress) => {
        return Math.round(start + (end - start) * progress);
    };

    const initJSEngine = () => {
        // Only calculate colors for reels currently visible on screen to save CPU/Battery
        visibilityObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.dataset.tmVisible = 'true';
                } else {
                    delete entry.target.dataset.tmVisible;
                }
            });
        }, { rootMargin: '100px' }); // Load slightly before they scroll into view

        const durationMs = CONFIG.CYCLE_DURATION * 1000;

        const animationLoop = (timestamp) => {
            if (document.documentElement.dataset.tmProfileGrid !== 'true') {
                requestAnimationFrame(animationLoop);
                return;
            }

            const activeReels = document.querySelectorAll('main a[data-tm-visible="true"]');

            activeReels.forEach(reel => {
                const state = reelStateMap.get(reel);
                if (!state) return;

                // Initialize random start time to desync everything
                if (!state.startTime) {
                    state.startTime = timestamp - (Math.random() * durationMs);
                }

                let elapsed = timestamp - state.startTime;
                let progress = elapsed / durationMs;

                // When transition is complete, pick a new random color
                if (progress >= 1) {
                    progress = 0;
                    state.startTime = timestamp;
                    state.currentIdx = state.nextIdx;
                    state.nextIdx = getRandomNextColorIdx(state.currentIdx);
                }

                const currentColor = IG_COLORS[state.currentIdx];
                const nextColor = IG_COLORS[state.nextIdx];

                // Calculate the exact RGB for this specific frame
                const r = lerp(currentColor.r, nextColor.r, progress);
                const g = lerp(currentColor.g, nextColor.g, progress);
                const b = lerp(currentColor.b, nextColor.b, progress);

                // Pipe directly into the CSS variables
                reel.style.setProperty('--ig-r', r);
                reel.style.setProperty('--ig-g', g);
                reel.style.setProperty('--ig-b', b);
            });

            requestAnimationFrame(animationLoop);
        };

        if (!isAnimating) {
            isAnimating = true;
            requestAnimationFrame(animationLoop);
        }
    };

    const scanForReels = () => {
        if (document.documentElement.dataset.tmProfileGrid !== 'true') return;

        const reels = document.querySelectorAll('main a:is([href*="/reel/"], [href*="/reels/"])');
        reels.forEach(reel => {
            if (!reelStateMap.has(reel)) {
                const initialIdx = Math.floor(Math.random() * IG_COLORS.length);
                reelStateMap.set(reel, {
                    currentIdx: initialIdx,
                    nextIdx: getRandomNextColorIdx(initialIdx),
                    startTime: null
                });
                visibilityObserver.observe(reel);
            }
        });
    };

    const initDOMObserver = () => {
        const observer = new MutationObserver((mutations) => {
            if (document.documentElement.dataset.tmProfileGrid !== 'true') return;
            let shouldUpdate = false;
            for (const mut of mutations) {
                if (mut.addedNodes.length > 0) {
                    shouldUpdate = true;
                    break;
                }
            }
            if (shouldUpdate) requestAnimationFrame(scanForReels);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    };

    // =========================================================
    // STYLING
    // =========================================================
    const injectStyles = () => {
        if (document.getElementById('tm-reel-highlight-style')) return;

        const style = document.createElement('style');
        style.id = 'tm-reel-highlight-style';

        style.textContent = `
            :root {
                --reel-glow-opacity: ${CONFIG.GLOW_OPACITY_LIGHT};
                --tm-border-thick: ${CONFIG.BORDER_THICKNESS};
            }

            @media (prefers-color-scheme: dark) {
                :root {
                    --reel-glow-opacity: ${CONFIG.GLOW_OPACITY_DARK};
                }
            }

            html[data-tm-profile-grid="true"] main a:is([href*="/reel/"], [href*="/reels/"]):has(img, video) {
                position: relative !important;
                display: block;
            }

            /* LAYER 1: IDLE STATE (Values driven dynamically by JS Loop) */
            html[data-tm-profile-grid="true"] main a:is([href*="/reel/"], [href*="/reels/"]):has(img, video)::before {
                content: "";
                position: absolute;
                inset: 0;

                box-shadow:
                    inset 0 0 0 var(--tm-border-thick) rgba(var(--ig-r), var(--ig-g), var(--ig-b), calc(var(--reel-glow-opacity) * 0.9)),
                    inset 0 0 15px rgba(var(--ig-r), var(--ig-g), var(--ig-b), calc(var(--reel-glow-opacity) * 0.6)),
                    inset 0 0 40px rgba(var(--ig-r), var(--ig-g), var(--ig-b), calc(var(--reel-glow-opacity) * 0.25));

                pointer-events: none;
                z-index: 10;
                border-radius: inherit;
            }

            /* LAYER 2: HOVER STATE */
            html[data-tm-profile-grid="true"] main a:is([href*="/reel/"], [href*="/reels/"]):has(img, video)::after {
                content: "";
                position: absolute;
                inset: 0;

                box-shadow:
                    inset 0 0 0 var(--tm-border-thick) rgba(var(--ig-r), var(--ig-g), var(--ig-b), 1),
                    inset 0 0 calc(15px * ${CONFIG.HOVER_MULTIPLIER}) rgba(var(--ig-r), var(--ig-g), var(--ig-b), calc(var(--reel-glow-opacity) * 0.8)),
                    inset 0 0 calc(40px * ${CONFIG.HOVER_MULTIPLIER}) rgba(var(--ig-r), var(--ig-g), var(--ig-b), calc(var(--reel-glow-opacity) * 0.4));

                background-color: rgba(var(--ig-r), var(--ig-g), var(--ig-b), 0.15);

                pointer-events: none;
                z-index: 11;
                border-radius: inherit;

                opacity: 0;
                transition: opacity 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
            }

            /* TRIGGER HOVER */
            html[data-tm-profile-grid="true"] main a:is([href*="/reel/"], [href*="/reels/"]):has(img, video):hover::after {
                opacity: 1;
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
        initDOMObserver();
        initJSEngine();
    } catch (error) {
        console.error('[Instagram Reel Highlight] Failed to initialize:', error);
    }

})();
