// ==UserScript==
// @name         [Instagram] Viewed Post Marker
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      2.3
// @description  Manually mark Instagram posts as seen with sync across grid, modal, and individual post views.
// @author       Xiv
// @match        *://*.instagram.com/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @updateURL    https://myouisaur.github.io/Instagram/viewed-post-marker.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/viewed-post-marker.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Guard against duplicate initialization in SPA environments
    if (window.__tmIgTrackerInitialized) return;
    window.__tmIgTrackerInitialized = true;

    // =========================================================
    // CONFIGURATION
    // =========================================================
    const CONFIG = {
        UI_PREFIX: 'tm-ig-seen',
        STORAGE_KEY: 'tm_ig_seen_data_v2',
        OBSERVER_DEBOUNCE_MS: 150
    };

    const ICONS = {
        eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
        check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
    };

    // =========================================================
    // UTILITIES
    // =========================================================
    const Utils = {
        debounce(fn, delay) {
            let timeoutId;
            return function (...args) {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => fn.apply(this, args), delay);
            };
        },
        createSVG(pathD, viewBox = '0 0 24 24', customClass = '') {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', viewBox);

            // CRITICAL: Explicitly define dimensions to prevent flexbox collapsing
            svg.setAttribute('height', '24');
            svg.setAttribute('width', '24');

            if (customClass) svg.setAttribute('class', customClass);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathD);
            svg.appendChild(path);
            return svg;
        },
        extractShortcode(url) {
            if (!url) return null;
            const match = url.match(/\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
            return match ? match[1] : null;
        }
    };

    // =========================================================
    // STORAGE MODULE
    // =========================================================
    const Storage = {
        seenSet: new Set(),

        init() {
            try {
                const rawV2 = GM_getValue(CONFIG.STORAGE_KEY, null);
                if (!rawV2) {
                    const rawV1 = GM_getValue('tm_ig_seen_data', '{}');
                    const dataV1 = JSON.parse(rawV1);
                    const merged = [];
                    Object.values(dataV1).forEach(arr => merged.push(...arr));
                    this.seenSet = new Set(merged);
                    this.save();
                } else {
                    this.seenSet = new Set(JSON.parse(rawV2));
                }
            } catch (e) {
                console.warn(`[IG Tracker] Corrupted storage data. Initializing clean database.`);
                this.seenSet = new Set();
            }
        },

        save() {
            try {
                GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify([...this.seenSet]));
            } catch (e) {
                console.error(`[IG Tracker] Failed to save to local storage:`, e);
            }
        },

        toggle(shortcode) {
            let isSeen = false;
            if (this.seenSet.has(shortcode)) {
                this.seenSet.delete(shortcode);
            } else {
                this.seenSet.add(shortcode);
                isSeen = true;
            }
            this.save();

            document.dispatchEvent(new CustomEvent(`${CONFIG.UI_PREFIX}-sync`, {
                detail: { shortcode, isSeen }
            }));

            return isSeen;
        },

        has(shortcode) {
            return this.seenSet.has(shortcode);
        }
    };

    // =========================================================
    // UI MODULE
    // =========================================================
    const UI = {
        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .${CONFIG.UI_PREFIX}-grid-wrapper {
                    position: absolute;
                    inset: 0;
                    z-index: 10;
                    pointer-events: none;
                    border-radius: inherit;
                    overflow: hidden;
                }

                [role="dialog"] .${CONFIG.UI_PREFIX}-grid-wrapper {
                    display: none !important;
                }

                .${CONFIG.UI_PREFIX}-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                }
                .${CONFIG.UI_PREFIX}-overlay.active { opacity: 1; }
                .${CONFIG.UI_PREFIX}-overlay svg {
                    width: 3.5rem; height: 3.5rem;
                    fill: rgba(255, 255, 255, 0.85);
                }

                .${CONFIG.UI_PREFIX}-grid-btn {
                    position: absolute;
                    bottom: 0.5rem; right: 0.5rem;
                    width: 2.2rem; height: 2.2rem;
                    background: rgba(0, 0, 0, 0.6);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer; pointer-events: auto;
                    transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
                    backdrop-filter: blur(4px);
                    outline: none;
                    -webkit-tap-highlight-color: transparent;
                }
                .${CONFIG.UI_PREFIX}-grid-btn:hover {
                    background: rgba(0, 0, 0, 0.85);
                    transform: scale(1.1);
                }
                .${CONFIG.UI_PREFIX}-grid-btn.active {
                    background: rgba(74, 222, 128, 0.9);
                    border-color: rgba(74, 222, 128, 1);
                }
                .${CONFIG.UI_PREFIX}-grid-btn svg {
                    width: 1.2rem; height: 1.2rem; fill: #fff;
                }

                /* Action Bar Button Styles */
                .${CONFIG.UI_PREFIX}-action-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    border: none;
                    padding: 8px;
                    margin: 0;
                    cursor: pointer;
                    color: inherit;
                    height: 40px;
                    width: 40px;
                    box-sizing: border-box;
                    align-self: center;
                    transition: transform 0.15s ease;
                    outline: none;
                    -webkit-tap-highlight-color: transparent;
                }
                .${CONFIG.UI_PREFIX}-action-btn:active {
                    transform: scale(0.9);
                }
            `;
            document.head.appendChild(style);

            document.addEventListener(`${CONFIG.UI_PREFIX}-sync`, (e) => {
                const { shortcode, isSeen } = e.detail;

                // Sync Grid
                const gridWrappers = document.querySelectorAll(`.${CONFIG.UI_PREFIX}-grid-wrapper[data-shortcode="${shortcode}"]`);
                gridWrappers.forEach(wrapper => {
                    const overlay = wrapper.querySelector(`.${CONFIG.UI_PREFIX}-overlay`);
                    const btn = wrapper.querySelector(`.${CONFIG.UI_PREFIX}-grid-btn`);
                    if (isSeen) {
                        overlay.classList.add('active');
                        btn.classList.add('active');
                    } else {
                        overlay.classList.remove('active');
                        btn.classList.remove('active');
                    }
                });

                // Sync Action Bar
                const actionBtns = document.querySelectorAll(`.${CONFIG.UI_PREFIX}-action-btn[data-shortcode="${shortcode}"]`);
                actionBtns.forEach(btn => {
                    this.renderActionIcon(btn, isSeen, btn.dataset.svgClass);
                });
            });
        },

        injectGridUI(linkEl, shortcode) {
            if (window.getComputedStyle(linkEl).position === 'static') {
                linkEl.style.position = 'relative';
            }

            const isSeen = Storage.has(shortcode);

            const wrapper = document.createElement('div');
            wrapper.className = `${CONFIG.UI_PREFIX}-grid-wrapper`;
            wrapper.dataset.shortcode = shortcode;

            const overlay = document.createElement('div');
            overlay.className = `${CONFIG.UI_PREFIX}-overlay ${isSeen ? 'active' : ''}`;
            overlay.appendChild(Utils.createSVG(ICONS.check));

            const btn = document.createElement('button');
            btn.className = `${CONFIG.UI_PREFIX}-grid-btn ${isSeen ? 'active' : ''}`;
            btn.title = "Toggle Seen Status";
            btn.appendChild(Utils.createSVG(ICONS.eye));

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                Storage.toggle(shortcode);
            });

            wrapper.appendChild(overlay);
            wrapper.appendChild(btn);
            linkEl.appendChild(wrapper);
        },

        injectActionBarUI(anchorElement, originalSvg, shortcode) {
            const parentContainer = anchorElement.parentNode;
            if (parentContainer) {
                parentContainer.style.display = 'flex';
                parentContainer.style.alignItems = 'center';
            }

            const btn = document.createElement('button');
            btn.className = `${CONFIG.UI_PREFIX}-action-btn`;
            btn.dataset.shortcode = shortcode;
            btn.title = "Toggle Seen Status";

            let nativeClass = originalSvg.getAttribute('class') || '';
            nativeClass = nativeClass.replace(`${CONFIG.UI_PREFIX}-processed`, '').trim();
            btn.dataset.svgClass = nativeClass;

            const isSeen = Storage.has(shortcode);
            this.renderActionIcon(btn, isSeen, nativeClass);

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                Storage.toggle(shortcode);
            });

            anchorElement.parentNode.insertBefore(btn, anchorElement);
        },

        renderActionIcon(btnContainer, isSeen, nativeClass) {
            btnContainer.innerHTML = '';

            const svg = Utils.createSVG(ICONS.eye, '0 0 24 24', nativeClass);

            if (isSeen) {
                svg.style.color = '#4ade80';
                svg.style.fill = '#4ade80';
            } else {
                svg.style.color = 'currentColor';
                svg.style.fill = 'currentColor';
            }

            btnContainer.appendChild(svg);
        }
    };

    // =========================================================
    // DOM OBSERVER MODULE
    // =========================================================
    const Scanner = {
        observer: null,

        start() {
            this.scanAll();
            if (this.observer) this.observer.disconnect();

            this.observer = new MutationObserver(Utils.debounce(() => {
                requestAnimationFrame(() => this.scanAll());
            }, CONFIG.OBSERVER_DEBOUNCE_MS));

            this.observer.observe(document.body, { childList: true, subtree: true });
        },

        scanAll() {
            this.scanGrid();
            this.scanActionBar();
        },

        scanGrid() {
            const links = document.querySelectorAll(`a[href*="/p/"]:not(.${CONFIG.UI_PREFIX}-processed), a[href*="/reel/"]:not(.${CONFIG.UI_PREFIX}-processed)`);

            links.forEach(link => {
                // EXCLUSION FIX: Verify the link actually contains a media thumbnail.
                // This ignores purely textual links (like timestamps and comment dates)
                // to prevent the grid UI from injecting and squishing into tiny inline elements.
                if (!link.querySelector('img, video')) {
                    link.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                    return;
                }

                const shortcode = Utils.extractShortcode(link.getAttribute('href'));
                if (shortcode) {
                    link.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                    UI.injectGridUI(link, shortcode);
                }
            });
        },

        scanActionBar() {
            const saveIcons = document.querySelectorAll(`svg[aria-label="Save"]:not(.${CONFIG.UI_PREFIX}-processed), svg[aria-label="Remove"]:not(.${CONFIG.UI_PREFIX}-processed)`);

            saveIcons.forEach(svg => {
                const container = svg.closest('article, [role="dialog"], main, section');
                let shortcode = null;

                if (container) {
                    const timeLink = container.querySelector('a[href*="/p/"], a[href*="/reel/"]');
                    if (timeLink) {
                        shortcode = Utils.extractShortcode(timeLink.getAttribute('href'));
                    }
                }

                if (!shortcode) {
                    shortcode = Utils.extractShortcode(window.location.pathname);
                }

                if (!shortcode) return;

                let anchor = svg.closest('[aria-disabled="false"]');

                if (!anchor) {
                    anchor = svg.closest('.x1i10hfl');
                    if (anchor && anchor.parentElement && (anchor.parentElement.style.cursor === 'pointer' || anchor.parentElement.getAttribute('role') === 'button')) {
                        anchor = anchor.parentElement;
                    }
                }

                if (!anchor) return;

                if (anchor.parentNode && anchor.parentNode.querySelector(`.${CONFIG.UI_PREFIX}-action-btn`)) {
                    svg.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                    return;
                }

                svg.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                UI.injectActionBarUI(anchor, svg, shortcode);
            });
        }
    };

    // =========================================================
    // BOOTSTRAP
    // =========================================================
    Storage.init();
    UI.injectStyles();
    Scanner.start();

})();
