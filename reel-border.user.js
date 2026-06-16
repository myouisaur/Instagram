// ==UserScript==
// @name         [Instagram] Reel Border Highlight in Profiles
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      1.4
// @description  Adds an ultra-premium, multi-layered glassmorphic inner glow to Reel posts.
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
        // Base color for the glow (RGB format: R, G, B)
        // Default is a vibrant neon purple: 168, 85, 247
        BASE_COLOR_RGB: '168, 85, 247',

        // Intensity controls
        GLOW_OPACITY_LIGHT: 0.85,
        GLOW_OPACITY_DARK: 1.0,

        // How much the glow expands when you hover your mouse over it
        HOVER_MULTIPLIER: 1.5
    };

    // =========================================================
    // CORE LOGIC
    // =========================================================
    const injectStyles = () => {
        if (document.getElementById('tm-reel-highlight-style')) return;

        const style = document.createElement('style');
        style.id = 'tm-reel-highlight-style';

        style.textContent = `
            :root {
                --reel-glow-opacity: ${CONFIG.GLOW_OPACITY_LIGHT};
                --reel-rgb: ${CONFIG.BASE_COLOR_RGB};
            }

            @media (prefers-color-scheme: dark) {
                :root {
                    --reel-glow-opacity: ${CONFIG.GLOW_OPACITY_DARK};
                }
            }

            /* Target Reel Links */
            a:is([href*="/reel/"], [href*="/reels/"]):has(img, video) {
                position: relative !important;
                display: block;
            }

            /* * ULTRA-PREMIUM MULTI-LAYERED GLOW
             * Layer 1: Crisp inner 2px border
             * Layer 2: Tight, bright 15px bloom
             * Layer 3: Deep, soft 40px ambient shadow
             */
            a:is([href*="/reel/"], [href*="/reels/"]):has(img, video)::after {
                content: "";
                position: absolute;
                inset: 0;

                box-shadow:
                    inset 0 0 0 2px rgba(var(--reel-rgb), calc(var(--reel-glow-opacity) * 0.9)),
                    inset 0 0 15px rgba(var(--reel-rgb), calc(var(--reel-glow-opacity) * 0.6)),
                    inset 0 0 40px rgba(var(--reel-rgb), calc(var(--reel-glow-opacity) * 0.25));

                pointer-events: none;
                z-index: 10;
                border-radius: inherit;
                transition: box-shadow 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), background-color 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            }

            /* Hover State: Expands the bloom layers and adds a slight color tint to the whole image */
            a:is([href*="/reel/"], [href*="/reels/"]):has(img, video):hover::after {
                box-shadow:
                    inset 0 0 0 2px rgba(var(--reel-rgb), 1),
                    inset 0 0 calc(15px * ${CONFIG.HOVER_MULTIPLIER}) rgba(var(--reel-rgb), calc(var(--reel-glow-opacity) * 0.8)),
                    inset 0 0 calc(40px * ${CONFIG.HOVER_MULTIPLIER}) rgba(var(--reel-rgb), calc(var(--reel-glow-opacity) * 0.4));

                background-color: rgba(var(--reel-rgb), 0.1);
            }
        `;
        document.head.appendChild(style);
    };

    injectStyles();

})();
