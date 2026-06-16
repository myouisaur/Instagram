// ==UserScript==
// @name         [Instagram] Media Extractor
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      7.0
// @description  Extracts and downloads the highest-resolution images, videos, and audio-stories directly from the Instagram feed, reels, and stories.
// @author       Xiv
// @match        *://*.instagram.com/*
// @noframes
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      cdninstagram.com
// @connect      fbcdn.net
// @connect      instagram.com
// @connect      *
// @updateURL    https://myouisaur.github.io/Instagram/media-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/media-extractor.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. CONFIGURATION & STATE
    // ==========================================

    if (window.__xivIgExtractor) return;
    window.__xivIgExtractor = true;

    const CONFIG = {
        DEBUG: false,
        MIN_SIZE: 150,
        JPG_QUALITY: 1.0,
        TIMING: {
            DEBOUNCE_MS: 150,
            SUCCESS_DURATION_MS: 1000,
            MORPH_OUT_MS: 150,
            MORPH_IN_MS: 250,
            PROGRESS_UPDATE_MS: 150,
            BLOB_REVOKE_MS: 5000,
            TOAST_DURATION_MS: 3500,
            TOAST_FADE_MS: 300,
            RETRY_BASE_MS: 500
        },
        API: {
            APP_ID: '936619743392459',
            MEDIA_INFO_URL: 'https://www.instagram.com/api/v1/media/%id%/info/',
            TIMEOUT_MS: 10000,
            MAX_RETRIES: 2
        },
        HEADERS: {
            CACHE_KEY: 'xiv_ig_optional_headers',
            CACHE_TTL_MS: 30 * 60 * 1000,
            TRACKED: ['x-ig-www-claim', 'x-asbd-id', 'x-instagram-ajax']
        },
        CLASSES: {
            CONTAINER: 'xiv-btn-container',
            FEED_BTN: 'xiv-feed-btn',
            STORY_BTN: 'xiv-story-btn',
            REEL_BTN: 'xiv-reel-btn',
            BTN: 'xiv-action-btn',
            ICON_WRAPPER: 'xiv-btn-icon',
            ICON_INNER: 'xiv-icon-inner',
            MORPHING: 'xiv-morphing',
            SPINNER: 'xiv-spinner',
            GLASS_LENS: 'xiv-glass-lens',
            GLASS_SCATTER: 'xiv-glass-scatter',
            GLASS_CHROMA: 'xiv-glass-chroma',
            GLASS_RIM: 'xiv-glass-rim',
            RIPPLE: 'xiv-glass-ripple',
            PROGRESS: 'xiv-progress-text',
            TOAST_CONTAINER: 'xiv-toast-container',
            TOAST: 'xiv-toast',
            VISIBLE: 'xiv-visible'
        }
    };

    const { CLASSES, TIMING } = CONFIG;

    // Fast-path WeakMap to prevent excessive DOM querying during rapid scrolls
    const processedWrappers = new WeakMap();

    const State = {
        observer: null,
        debounceTimer: null,
        activeHoverContext: null
    };

    // ==========================================
    // 2. ASSETS & STYLES
    // ==========================================

    const ASSETS = {
        ICONS: {
            DOWNLOAD: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
            LINK:     '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
            CHECK:    '<polyline points="20 6 9 17 4 12" stroke="#4ade80" stroke-width="3"></polyline>',
            SPINNER:  '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="40 20" stroke-linecap="round" class="xiv-spinner"></circle>'
        },
        CSS: `
            /* ── Container ──────────────────────────────── */
            body .${CLASSES.CONTAINER} {
                position: absolute;
                z-index: 2147483647 !important; /* Punch through Instagram video overlays */
                display: flex;
                gap: 8px;
                pointer-events: none;
                visibility: hidden;
                transition: visibility 0s linear 0.3s;
            }

            body .${CLASSES.CONTAINER}::before {
                content: '';
                position: absolute;
                top: -20px; right: -25px; bottom: -20px; left: -25px;
                z-index: -1;
                background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.22) 0%, rgba(0, 0, 0, 0) 65%);
                pointer-events: none;
                border-radius: 50%;
                opacity: 0;
                transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            /* Feed Post / Modal Placement (Bottom-Center) */
            body .${CLASSES.FEED_BTN} {
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
            }

            /* Stories Placement */
            body .${CLASSES.STORY_BTN} {
                bottom: clamp(70px, 5%, 110px);
                left: 50%;
                transform: translateX(-50%);
            }

            /* Native Reels Action Bar Placement (Top of Bar) */
            body .${CLASSES.REEL_BTN} {
                position: relative;
                flex-direction: column;
                visibility: visible;
                pointer-events: auto;
                margin-bottom: 12px;
                gap: 12px;
                align-items: center;
            }
            body .${CLASSES.REEL_BTN}::before { display: none; }

            body .${CLASSES.CONTAINER}.${CLASSES.VISIBLE} {
                visibility: visible;
                pointer-events: auto;
                transition: visibility 0s;
            }

            body .${CLASSES.CONTAINER}.${CLASSES.VISIBLE}::before { opacity: 1; }

            /* ── Button shell ────────────────────────────── */
            body .${CLASSES.BTN} {
                position: relative;
                width: 35px; height: 35px;
                border-radius: 50%;
                border: none; outline: none; overflow: hidden;
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
                color: rgba(255, 255, 255, 0.96);
                background: rgba(255, 255, 255, 0.14);
                backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
                -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.1);
                box-shadow:
                    inset 0  1.5px 0   rgba(255,255,255,0.75),
                    inset 0 -1.5px 0   rgba(255,255,255,0.06),
                    inset  1px 0   0   rgba(255,255,255,0.30),
                    inset -1px 0   0   rgba(255,255,255,0.10),
                    0 0 0 0.5px        rgba(255,255,255,0.20),
                    0 6px 20px         rgba(0,0,0,0.32),
                    0 2px  6px         rgba(0,0,0,0.20);
                opacity: 0;
                will-change: transform, opacity;
                transform: translateZ(0);
                transition:
                    transform       0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
                    box-shadow      0.35s ease,
                    background      0.35s ease,
                    opacity         0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            body .${CLASSES.CONTAINER}.${CLASSES.VISIBLE} .${CLASSES.BTN},
            body .${CLASSES.REEL_BTN} .${CLASSES.BTN} {
                opacity: 1;
            }

            body .${CLASSES.BTN}[data-loading="1"] { cursor: default !important; }

            body .${CLASSES.BTN}::before {
                content: '';
                position: absolute; inset: 0; border-radius: 50%; padding: 1px;
                background: linear-gradient(155deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.35) 25%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.22) 100%);
                -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                -webkit-mask-composite: xor; mask-composite: exclude;
                pointer-events: none; z-index: 5;
                transition: background 0.35s ease;
            }

            body .${CLASSES.BTN}::after {
                content: '';
                position: absolute; top: 0; left: 0; right: 0; height: 58%;
                background: radial-gradient(ellipse 75% 70% at 50% -8%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.20) 40%, rgba(255,255,255,0.05) 70%, transparent 90%);
                border-radius: 50% 50% 0 0;
                pointer-events: none; z-index: 5;
                transition: background 0.35s ease;
            }

            /* Hover & Active states */
            body .${CLASSES.BTN}:hover {
                background: rgba(255, 255, 255, 0.22);
                backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
                -webkit-backdrop-filter: blur(32px) saturate(210%) brightness(1.18);
                box-shadow:
                    inset 0  1.5px 0   rgba(255,255,255,0.85),
                    inset 0 -1.5px 0   rgba(255,255,255,0.08),
                    inset  1px 0   0   rgba(255,255,255,0.40),
                    inset -1px 0   0   rgba(255,255,255,0.14),
                    0 0 0 0.5px        rgba(255,255,255,0.28),
                    0 10px 30px        rgba(0,0,0,0.38),
                    0 3px 10px         rgba(0,0,0,0.22),
                    0 0 22px           rgba(140,180,255,0.22);
            }

            body .${CLASSES.BTN}:active {
                transition: box-shadow 0.10s ease;
                box-shadow:
                    inset 0  1.5px 0  rgba(255,255,255,0.75),
                    inset 0 -1.5px 0  rgba(255,255,255,0.06),
                    inset  1px 0   0  rgba(255,255,255,0.30),
                    inset -1px 0   0  rgba(255,255,255,0.10),
                    0 0 0 0.5px       rgba(255,255,255,0.18),
                    0 3px 10px        rgba(0,0,0,0.25);
            }

            /* Icon wrapper */
            body .${CLASSES.ICON_WRAPPER} {
                position: relative;
                z-index: 6; display: flex; align-items: center; justify-content: center;
                width: 17px; height: 17px; color: rgba(255, 255, 255, 0.96);
                filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
                transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.35s ease;
                pointer-events: none;
            }

            body .${CLASSES.BTN}:hover .${CLASSES.ICON_WRAPPER} {
                filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
            }

            /* Morph Transitions & Spinner */
            body .${CLASSES.ICON_INNER} {
                display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
                transition: opacity 0.15s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
                transform-origin: center;
            }

            body .${CLASSES.ICON_INNER}.${CLASSES.MORPHING} { opacity: 0; transform: scale(0.25) rotate(-45deg); }
            body .${CLASSES.ICON_INNER} svg { width: 100% !important; height: 100% !important; display: block !important; }

            @keyframes xiv-spin { 100% { transform: rotate(360deg); } }
            body .${CLASSES.SPINNER} { animation: xiv-spin 1s linear infinite; transform-origin: center; }

            /* Inner glass layers */
            body .${CLASSES.GLASS_LENS} {
                position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50%;
                background: radial-gradient(circle at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
                pointer-events: none; z-index: 1;
            }
            body .${CLASSES.GLASS_SCATTER} {
                position: absolute; inset: 2px; border-radius: 50%;
                background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
                pointer-events: none; z-index: 2;
            }
            body .${CLASSES.GLASS_CHROMA} {
                position: absolute; inset: 0; border-radius: 50%;
                background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
                pointer-events: none; z-index: 3;
            }
            body .${CLASSES.GLASS_RIM} {
                position: absolute; bottom: 0; left: 10%; right: 10%; height: 40%;
                background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
                border-radius: 0 0 50% 50%; pointer-events: none; z-index: 4;
            }

            /* Ripple */
            body .${CLASSES.RIPPLE} {
                position: absolute; border-radius: 50%; background: rgba(255, 255, 255, 0.28);
                transform: scale(0); animation: xiv-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
                pointer-events: none; z-index: 7;
            }
            @keyframes xiv-ripple { to { transform: scale(2.8); opacity: 0; } }

            /* Progress & Toasts */
            .${CLASSES.PROGRESS} {
                font-size: 11px; font-weight: 700; font-family: system-ui, -apple-system, sans-serif; letter-spacing: -0.5px;
            }
            #${CLASSES.TOAST_CONTAINER} {
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                z-index: 2147483647 !important; display: flex; flex-direction: column; gap: 8px; pointer-events: none;
            }
            .${CLASSES.TOAST} {
                background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
                color: #ffffff; padding: 12px 24px; border-radius: 30px; font-size: 14px; font-family: system-ui, -apple-system, sans-serif;
                border: 1px solid rgba(255, 255, 255, 0.15); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); opacity: 0; transform: translateY(20px);
                transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            }
            .${CLASSES.TOAST}.${CLASSES.VISIBLE} { opacity: 1; transform: translateY(0); }
        `
    };

    // ==========================================
    // 3. UTILITIES & HEADER CAPTURE
    // ==========================================

    function log(...args) {
        if (CONFIG.DEBUG) console.log('[IG Extractor]', ...args);
    }

    function warn(...args) {
        console.warn('[IG Extractor]', ...args);
    }

    function shortcodeToPostId(shortcode) {
        if (!shortcode) return null;
        try {
            const code = shortcode.length > 28 ? shortcode.substring(0, shortcode.length - 28) : shortcode;
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
            let result = 0n;
            for (const char of code) {
                const idx = alphabet.indexOf(char);
                if (idx === -1) return null;
                result = (result * 64n) + BigInt(idx);
            }
            return result.toString();
        } catch (e) {
            return null;
        }
    }

    const HeaderCapture = {
        _headers: {},

        load() {
            try {
                const raw = GM_getValue(CONFIG.HEADERS.CACHE_KEY, null);
                if (!raw) return;
                const cached = JSON.parse(raw);
                const age = Date.now() - (cached.timestamp || 0);
                if (age < CONFIG.HEADERS.CACHE_TTL_MS && cached.headers) {
                    this._headers = cached.headers;
                }
            } catch (e) {}
        },

        save() {
            try {
                GM_setValue(CONFIG.HEADERS.CACHE_KEY, JSON.stringify({
                    headers: this._headers,
                    timestamp: Date.now()
                }));
            } catch (e) {}
        },

        _absorb(entries) {
            let changed = false;
            for (const [name, value] of entries) {
                const lower = name.toLowerCase();
                if (CONFIG.HEADERS.TRACKED.includes(lower) && value && this._headers[lower] !== value) {
                    this._headers[lower] = value;
                    changed = true;
                }
            }
            if (changed) this.save();
        },

        getHeaders() {
            return { ...this._headers };
        },

        _patchFetch() {
            if (typeof unsafeWindow === 'undefined' || typeof unsafeWindow.fetch !== 'function') return;
            const self = this;
            const originalFetch = unsafeWindow.fetch;
            unsafeWindow.fetch = function (input, init) {
                try {
                    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
                    if (url.includes('instagram.com') && init?.headers) {
                        let entries;
                        if (init.headers instanceof Headers) entries = [...init.headers.entries()];
                        else if (Array.isArray(init.headers)) entries = init.headers;
                        else entries = Object.entries(init.headers);
                        self._absorb(entries);
                    }
                } catch (e) {}
                return originalFetch.apply(this, arguments);
            };
        },

        _patchXHR() {
            if (typeof unsafeWindow === 'undefined' || typeof unsafeWindow.XMLHttpRequest === 'undefined') return;
            const self = this;
            const proto = unsafeWindow.XMLHttpRequest.prototype;
            const orig = proto.setRequestHeader;
            proto.setRequestHeader = function (name, value) {
                try { self._absorb([[name, value]]); } catch (e) {}
                return orig.apply(this, arguments);
            };
        },

        init() {
            this.load();
            this._patchFetch();
            this._patchXHR();
        }
    };

    // ==========================================
    // 4. INSTAGRAM MULTI-TIER API (WITH EXPONENTIAL BACKOFF)
    // ==========================================

    const API = {
        _inFlight: new Map(),

        async _fetchWithRetry(fetcherFn) {
            const retries = CONFIG.API.MAX_RETRIES;
            for (let i = 0; i <= retries; i++) {
                try {
                    return await fetcherFn();
                } catch (e) {
                    if (e.message === 'AUTH_EXPIRED' || i === retries) throw e;
                    const delay = TIMING.RETRY_BASE_MS * Math.pow(2, i);
                    warn(`API Fetch failed (${e.message}), retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        },

        getRobustVideoUrl(postId, shortcode) {
            if (!postId && !shortcode) return Promise.reject(new Error('No post identifier provided'));
            const key = postId || shortcode;

            if (this._inFlight.has(key)) return this._inFlight.get(key);

            const promise = new Promise(async (resolve, reject) => {
                if (postId) {
                    try {
                        const url = await this._fetchWithRetry(() => this._fetchMediaInfo(postId));
                        if (url) return resolve(url);
                    } catch (e) {
                        warn('Tier 1 API failed after retries:', e.message);
                    }
                }
                if (shortcode) {
                    try {
                        const url = await this._fetchWithRetry(() => this._fetchJsonTrick(shortcode));
                        if (url) return resolve(url);
                    } catch (e) {
                        warn('Tier 2 Endpoint Trick failed after retries:', e.message);
                    }
                }
                reject(new Error('All backend extraction tiers failed'));
            }).finally(() => this._inFlight.delete(key));

            this._inFlight.set(key, promise);
            return promise;
        },

        _buildHeaders() {
            const csrfMatch = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
            const csrftoken = csrfMatch?.[1] || '';
            const optional = HeaderCapture.getHeaders();
            const headers = {
                'x-ig-app-id': CONFIG.API.APP_ID,
                'x-csrftoken': csrftoken,
                'x-requested-with': 'XMLHttpRequest'
            };
            if (optional['x-ig-www-claim']) headers['x-ig-www-claim'] = optional['x-ig-www-claim'];
            if (optional['x-asbd-id']) headers['x-asbd-id'] = optional['x-asbd-id'];
            if (optional['x-instagram-ajax']) headers['x-instagram-ajax'] = optional['x-instagram-ajax'];

            return headers;
        },

        _fetchMediaInfo(postId) {
            return new Promise((resolve, reject) => {
                const url = CONFIG.API.MEDIA_INFO_URL.replace('%id%', postId);
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: this._buildHeaders(),
                    timeout: CONFIG.API.TIMEOUT_MS,
                    onload: (res) => {
                        if (res.status === 401 || res.status === 403) return reject(new Error('AUTH_EXPIRED'));
                        if (res.status < 200 || res.status >= 300) return reject(new Error(`HTTP_${res.status}`));
                        try {
                            const data = JSON.parse(res.responseText);
                            const item = data?.items?.[0];
                            if (!item) return reject(new Error('EMPTY_RESPONSE'));
                            const videoUrl = this._extractVideoUrl(item);
                            if (!videoUrl) return reject(new Error('NO_VIDEO_URL'));
                            resolve(videoUrl);
                        } catch (e) {
                            reject(new Error('PARSE_ERROR'));
                        }
                    },
                    onerror: () => reject(new Error('NETWORK_ERROR')),
                    ontimeout: () => reject(new Error('TIMEOUT'))
                });
            });
        },

        _fetchJsonTrick(shortcode) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
                    headers: this._buildHeaders(),
                    timeout: CONFIG.API.TIMEOUT_MS,
                    onload: (res) => {
                        if (res.status < 200 || res.status >= 300) return reject(new Error(`HTTP_${res.status}`));
                        try {
                            const data = JSON.parse(res.responseText);
                            const item = data?.items?.[0] || data?.graphql?.shortcode_media;
                            if (!item) return reject(new Error('EMPTY_JSON_RESPONSE'));
                            const videoUrl = this._extractVideoUrl(item);
                            if (!videoUrl) return reject(new Error('NO_VIDEO_URL'));
                            resolve(videoUrl);
                        } catch (e) {
                            reject(new Error('JSON_PARSE_ERROR'));
                        }
                    },
                    onerror: () => reject(new Error('NETWORK_ERROR')),
                    ontimeout: () => reject(new Error('TIMEOUT'))
                });
            });
        },

        _extractVideoUrl(item) {
            if (Array.isArray(item.carousel_media) || item.edge_sidecar_to_children?.edges) {
                const slides = item.carousel_media || item.edge_sidecar_to_children.edges;
                for (const slide of slides) {
                    const mediaNode = slide.node || slide;
                    const url = this._pickVideoFromMedia(mediaNode);
                    if (url) return url;
                }
                return null;
            }
            return this._pickVideoFromMedia(item);
        },

        _pickVideoFromMedia(media) {
            if (media.video_url) return media.video_url;
            if (Array.isArray(media.video_versions) && media.video_versions.length) {
                return media.video_versions.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
            }
            return null;
        }
    };

    // ==========================================
    // 5. REACT FIBER EXTRACTION
    // ==========================================

    const Extractor = {
        getMediaData(element) {
            let result = { url: null, videoUrl: null, isVideo: false, postId: null, shortcode: null };
            try {
                let currentEl = element;
                let depth = 0;

                while (currentEl && depth < 15) {
                    const fiberKey = Object.keys(currentEl).find(k =>
                        k.startsWith('__reactFiber$') ||
                        k.startsWith('__reactProps$') ||
                        k.startsWith('__reactInternalInstance$')
                    );
                    if (fiberKey) {
                        let node = currentEl[fiberKey];
                        let fiberDepth = 0;

                        while (node && fiberDepth < 40) {
                            const props = node.memoizedProps;
                            if (props) {
                                const sources = [
                                    props, props.media, props.item, props.post, props.xdt_shortcode_media
                                ].filter(Boolean);

                                for (const source of sources) {
                                    const pk = source.pk || source.id;
                                    if (pk && !result.postId) result.postId = String(pk).split('_')[0];
                                    if (!result.shortcode) result.shortcode = source.shortcode || source.code;

                                    const isVideo = Boolean(source.video_versions || source.is_video || source.media_type === 2);
                                    if (isVideo) result.isVideo = true;

                                    if (source.video_versions?.length && !result.videoUrl) {
                                        result.videoUrl = source.video_versions.sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
                                    }

                                    if (source.image_versions2?.candidates?.length && !result.url) {
                                        result.url = source.image_versions2.candidates.sort((a, b) => b.width - a.width)[0].url;
                                    }
                                }
                            }
                            node = node.return;
                            fiberDepth++;
                        }
                    }
                    currentEl = currentEl.parentElement;
                    depth++;
                }
            } catch (err) {
                warn('Fiber extraction error:', err);
            }
            return result;
        }
    };

    // ==========================================
    // 6. MEDIA PROCESSING & DOWNLOADS
    // ==========================================

    const Media = {
        generateFilename(type, ext = 'jpg') {
            const randomStr = (Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8)).padEnd(12, '0').substring(0, 12);
            return `ig-${type}-${randomStr}.${ext}`;
        },

        resolveBestUrl(element, fiberUrl) {
            if (fiberUrl) return fiberUrl;
            if (element && element.srcset) {
                const sources = element.srcset.split(',').map(s => {
                    const [url, width] = s.trim().split(' ');
                    return { url, width: parseInt(width) || 0 };
                }).sort((a, b) => b.width - a.width);
                if (sources[0]) return sources[0].url;
            }
            return element ? element.src : null;
        },

        fetchAndSaveBlob(url, filename, onProgress) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest === 'undefined') return reject(new Error('GM_xmlhttpRequest not available'));

                let lastUpdate = 0;
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'blob',
                    onprogress: (e) => {
                        if (e.lengthComputable && onProgress) {
                            const now = Date.now();
                            if (now - lastUpdate > TIMING.PROGRESS_UPDATE_MS) {
                                onProgress(Math.floor((e.loaded / e.total) * 100));
                                lastUpdate = now;
                            }
                        }
                    },
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            const blobUrl = URL.createObjectURL(res.response);
                            const a = document.createElement('a');
                            a.href = blobUrl;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            setTimeout(() => URL.revokeObjectURL(blobUrl), TIMING.BLOB_REVOKE_MS);
                            resolve();
                        } else {
                            reject(new Error(`HTTP Error ${res.status}`));
                        }
                    },
                    onerror: (err) => reject(err),
                    ontimeout: () => reject(new Error('Network Timeout'))
                });
            });
        },

        convertAndDownload(url, filename) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width  = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            const blobUrl = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = blobUrl;
                            link.download = filename;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            setTimeout(() => URL.revokeObjectURL(blobUrl), TIMING.BLOB_REVOKE_MS);
                            resolve();
                        } else reject(new Error('Canvas toBlob failed'));
                    }, 'image/jpeg', CONFIG.JPG_QUALITY);
                };
                img.onerror = () => reject(new Error('Image load failed'));
                img.src = url;
            });
        }
    };

    // ==========================================
    // 7. TOAST NOTIFICATIONS
    // ==========================================

    const Toast = {
        _container: null,

        _getContainer() {
            if (this._container?.isConnected) return this._container;
            this._container = document.getElementById(CLASSES.TOAST_CONTAINER);
            if (!this._container) {
                this._container = document.createElement('div');
                this._container.id = CLASSES.TOAST_CONTAINER;
                document.body.appendChild(this._container);
            }
            return this._container;
        },

        show(message, duration = TIMING.TOAST_DURATION_MS) {
            if (!document.body) return;
            const container = this._getContainer();
            const toast = document.createElement('div');
            toast.className = CLASSES.TOAST;
            toast.textContent = message;
            container.appendChild(toast);
            requestAnimationFrame(() => {
                void toast.offsetWidth;
                toast.classList.add(CLASSES.VISIBLE);
            });
            setTimeout(() => {
                toast.classList.remove(CLASSES.VISIBLE);
                setTimeout(() => toast.remove(), TIMING.TOAST_FADE_MS);
            }, duration);
        }
    };

    // ==========================================
    // 8. USER INTERFACE
    // ==========================================

    const UI = {
        injectStyles() {
            if (typeof GM_addStyle === 'function') {
                GM_addStyle(ASSETS.CSS);
            } else {
                const style = document.createElement('style');
                style.textContent = ASSETS.CSS;
                document.head.appendChild(style);
            }
        },

        createIconElement(pathData) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.style.cssText = 'width:100%;height:100%;display:block;';
            svg.innerHTML = pathData;
            return svg;
        },

        swapIconSmoothly(iconWrapper, newSvgPath) {
            let inner = iconWrapper.querySelector(`.${CLASSES.ICON_INNER}`);
            if (!inner) {
                inner = document.createElement('div');
                inner.className = `${CLASSES.ICON_INNER} ${CLASSES.MORPHING}`;
                iconWrapper.replaceChildren(inner);
                void inner.offsetWidth;
            }

            return new Promise(resolve => {
                inner.classList.add(CLASSES.MORPHING);
                setTimeout(() => {
                    inner.replaceChildren(this.createIconElement(newSvgPath));
                    void inner.offsetWidth;
                    inner.classList.remove(CLASSES.MORPHING);
                    setTimeout(resolve, TIMING.MORPH_IN_MS);
                }, TIMING.MORPH_OUT_MS);
            });
        },

        createContainer(typeClass) {
            const container = document.createElement('div');
            container.className = `${CLASSES.CONTAINER} ${typeClass}`;
            return container;
        },

        createButton(type, onClickAction, labelOverride) {
            const defaultLabel = type === 'download' ? 'Download High-Res (Shortcut: D)' : 'Open in New Tab';
            const btn = document.createElement('div');
            btn.className = CLASSES.BTN;
            btn.title = labelOverride || defaultLabel;
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', btn.title);
            btn.setAttribute('tabindex', '0');

            const lens = document.createElement('div'); lens.className = CLASSES.GLASS_LENS;
            const scatter = document.createElement('div'); scatter.className = CLASSES.GLASS_SCATTER;
            const chroma = document.createElement('div'); chroma.className = CLASSES.GLASS_CHROMA;
            const rim = document.createElement('div'); rim.className = CLASSES.GLASS_RIM;
            const iconWrapper = document.createElement('span');
            iconWrapper.className = CLASSES.ICON_WRAPPER;
            const innerIconEl = document.createElement('div');
            innerIconEl.className = CLASSES.ICON_INNER;
            innerIconEl.appendChild(this.createIconElement(type === 'download' ? ASSETS.ICONS.DOWNLOAD : ASSETS.ICONS.LINK));
            iconWrapper.appendChild(innerIconEl);

            btn.append(lens, scatter, chroma, rim, iconWrapper);

            ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick'].forEach(eventType => {
                btn.addEventListener(eventType, (e) => {
                    e.stopPropagation();
                    if (eventType === 'click') e.preventDefault();
                });
            });

            btn.addEventListener('pointerdown', function (e) {
                if (btn.dataset.loading === "1") return;
                const r = btn.getBoundingClientRect();
                const size = Math.max(r.width, r.height);
                const rpl = document.createElement('div');
                rpl.className = CLASSES.RIPPLE;
                rpl.style.cssText = `width:${size}px; height:${size}px; left:${e.clientX - r.left - size / 2}px; top:${e.clientY - r.top - size / 2}px;`;
                btn.appendChild(rpl);
                rpl.addEventListener('animationend', () => rpl.remove());
            });
            btn.addEventListener('click', () => onClickAction(btn, iconWrapper));
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation(); e.preventDefault(); onClickAction(btn, iconWrapper);
                }
            });
            return btn;
        },

        setupHoverContext(hoverTarget, btnContainer) {
            if (!hoverTarget) return;

            hoverTarget.addEventListener('mouseenter', () => {
                btnContainer.classList.add(CLASSES.VISIBLE);
                State.activeHoverContext = { btnContainer };
            });
            hoverTarget.addEventListener('mouseleave', () => {
                btnContainer.classList.remove(CLASSES.VISIBLE);
                if (State.activeHoverContext?.btnContainer === btnContainer) {
                    State.activeHoverContext = null;
                }
            });
            if (hoverTarget.matches(':hover')) {
                btnContainer.classList.add(CLASSES.VISIBLE);
                State.activeHoverContext = { btnContainer };
            }
        },

        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (e.key.toLowerCase() === 'd') {
                    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
                    if (State.activeHoverContext) {
                        const dlBtn = Array.from(State.activeHoverContext.btnContainer.children)
                                           .find(btn => btn.title.includes('Download'));
                        if (dlBtn) {
                            e.preventDefault();
                            dlBtn.click();
                        }
                    }
                }
            });
        }
    };

    // ==========================================
    // 9. CORE EXECUTION ENGINE
    // ==========================================

    const Engine = {
        async executeAction(btnEl, iconWrapper, actionType, getContextData) {
            if (btnEl.dataset.loading === "1") return;
            btnEl.dataset.loading = "1";

            // Trigger spinner animation immediately
            await UI.swapIconSmoothly(iconWrapper, ASSETS.ICONS.SPINNER);

            try {
                const ctx = getContextData();
                if (!ctx) throw new Error('Could not resolve media context');

                let { postId, shortcode, isVideo, videoUrl, url: imageUrl, mediaElement, prefix } = ctx;

                if (!postId && shortcode) postId = shortcodeToPostId(shortcode);

                let finalUrl = null;
                const filename = Media.generateFilename(prefix || 'feed', isVideo ? 'mp4' : 'jpg');

                if (isVideo) {
                    if (videoUrl && !videoUrl.startsWith('blob:')) {
                        finalUrl = videoUrl;
                    } else {
                        try {
                            finalUrl = await API.getRobustVideoUrl(postId, shortcode);
                        } catch (e) {
                            warn('Backend fetch failed, relying on media element', e);
                            finalUrl = mediaElement ? mediaElement.src : null;
                        }
                    }
                } else {
                    finalUrl = Media.resolveBestUrl(mediaElement, imageUrl);
                }

                if (!finalUrl || finalUrl.startsWith('blob:')) {
                    throw new Error('Invalid or protected URL resolved');
                }

                if (actionType === 'link') {
                    if (typeof GM_openInTab === 'function') {
                        GM_openInTab(finalUrl, { active: false, insert: true });
                    } else {
                        window.open(finalUrl, '_blank', 'noopener,noreferrer');
                    }
                } else {
                    if (finalUrl.includes('.webp') || finalUrl.includes('.png')) {
                        await Media.convertAndDownload(finalUrl, filename);
                    } else {
                        await Media.fetchAndSaveBlob(finalUrl, filename, (pct) => {
                            const span = document.createElement('span');
                            span.className = CLASSES.PROGRESS;
                            span.textContent = `${pct}%`;
                            iconWrapper.replaceChildren(span);
                        });
                    }
                }

                await UI.swapIconSmoothly(iconWrapper, ASSETS.ICONS.CHECK);
                setTimeout(async () => {
                    await UI.swapIconSmoothly(iconWrapper, actionType === 'link' ? ASSETS.ICONS.LINK : ASSETS.ICONS.DOWNLOAD);
                    delete btnEl.dataset.loading;
                }, TIMING.SUCCESS_DURATION_MS);

            } catch (error) {
                const msg = error.message === 'AUTH_EXPIRED'
                    ? 'Session expired — please refresh the page'
                    : `Action failed (${error.message})`;
                Toast.show(msg);

                await UI.swapIconSmoothly(iconWrapper, actionType === 'link' ? ASSETS.ICONS.LINK : ASSETS.ICONS.DOWNLOAD);
                delete btnEl.dataset.loading;
            }
        }
    };

    // ==========================================
    // 10. DOM INJECTION ROUTERS
    // ==========================================

    const DOM = {
        isValidMedia(el) {
            const rect = el.getBoundingClientRect();
            if (rect.width < CONFIG.MIN_SIZE || rect.height < CONFIG.MIN_SIZE) return false;

            const src = el.src || '';
            if (src.includes('/profile_pic/') || src.includes('s150x150')) return false;
            if (src.includes('static.cdninstagram.com') || src.startsWith('data:')) return false;

            return true;
        },

        // Strategy 1: Feed & Modals (Elevated Wrapper Injection)
        processFeed() {
            const medias = document.querySelectorAll(`
                article img, article video,
                [role="dialog"] img, [role="dialog"] video,
                main img, main video
            `);

            medias.forEach(media => {
                if (!this.isValidMedia(media)) return;

                // Ensure we skip Reels processing here to prevent overlapping
                if (window.location.pathname.includes('/reel') && !media.closest('article, [role="dialog"]')) {
                    return;
                }

                const container = media.closest('li, [role="dialog"], article, main');
                if (media.tagName === 'IMG' && container) {
                    const immediateWrapper = media.closest('li') || media.closest('div[style*="padding-bottom"]') || container;
                    if (immediateWrapper.querySelector('video')) return;
                }

                let wrapper = media.closest('li');
                if (!wrapper) {
                    let curr = media;
                    while (curr.parentElement && curr.parentElement.tagName !== 'ARTICLE' && curr.parentElement.tagName !== 'MAIN' && curr.parentElement.getAttribute('role') !== 'dialog') {
                        if (window.getComputedStyle(curr.parentElement).position === 'relative' && curr.parentElement.children.length > 1) {
                            wrapper = curr.parentElement;
                            break;
                        }
                        curr = curr.parentElement;
                    }
                    if (!wrapper) wrapper = media.parentElement;
                }

                if (processedWrappers.has(wrapper)) {
                    if (wrapper.querySelector(`:scope > .${CLASSES.CONTAINER}`)) return;
                }

                if (wrapper.querySelector(`:scope > .${CLASSES.CONTAINER}`)) {
                    processedWrappers.set(wrapper, true);
                    return;
                }

                if (window.getComputedStyle(wrapper).position === 'static') {
                    wrapper.style.position = 'relative';
                }

                const btnContainer = UI.createContainer(CLASSES.FEED_BTN);

                const getContext = () => {
                    const fiberData = Extractor.getMediaData(media);
                    let shortcode = fiberData.shortcode;

                    if (!shortcode) {
                        const linkContainer = media.closest('article, [role="dialog"], main');
                        const links = linkContainer?.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
                        if (links && links.length) {
                            for (const link of links) {
                                const match = new URL(link.href).pathname.match(/\/(p|reel)\/([^\/]+)/);
                                if (match && match[2]) {
                                    shortcode = match[2];
                                    break;
                                }
                            }
                        }
                    }

                    const isVideo = media.tagName === 'VIDEO' || fiberData.isVideo;
                    return { ...fiberData, isVideo, shortcode, mediaElement: media, prefix: 'feed' };
                };

                const isVideoOnLoad = media.tagName === 'VIDEO' || Extractor.getMediaData(media).isVideo;

                const linkBtn = UI.createButton('link', (b, i) => Engine.executeAction(b, i, 'link', getContext));
                const dlBtn = UI.createButton('download', (b, i) => Engine.executeAction(b, i, 'download', getContext), isVideoOnLoad ? 'Download Video (Shortcut: D)' : 'Download Image (Shortcut: D)');

                btnContainer.appendChild(linkBtn);
                btnContainer.appendChild(dlBtn);
                wrapper.appendChild(btnContainer);

                processedWrappers.set(wrapper, true);
                UI.setupHoverContext(wrapper, btnContainer);
            });
        },

        // Strategy 2: Reels (Native Action Bar Injection - Exactly as in v6.1)
        processReels() {
            if (!window.location.pathname.includes('/reel')) return;

            const actionIcons = document.querySelectorAll('svg[aria-label="Share Post"], svg[aria-label="Share"], svg[aria-label="Comment"]');

            actionIcons.forEach(svg => {
                // Strict isolation: Prevent injecting ghost buttons into background feeds or modals while URL says /reel/
                if (svg.closest('article, [role="dialog"]')) return;

                let actionBar = svg.closest('[role="button"]')?.parentElement;

                while (actionBar && actionBar.children.length < 3 && actionBar.tagName !== 'MAIN') {
                    actionBar = actionBar.parentElement;
                }

                if (!actionBar || actionBar.dataset.xiv === '1') return;
                actionBar.dataset.xiv = '1';

                const btnContainer = UI.createContainer(CLASSES.REEL_BTN);

                const getContext = () => {
                    const fiberData = Extractor.getMediaData(actionBar);
                    let shortcode = fiberData.shortcode;
                    if (!shortcode) {
                        const match = window.location.pathname.match(/\/reels?\/([^\/\?]+)/);
                        shortcode = match?.[1] || null;
                    }

                    return { ...fiberData, shortcode, isVideo: true, mediaElement: null, prefix: 'reel' };
                };

                const linkBtn = UI.createButton('link', (b, i) => Engine.executeAction(b, i, 'link', getContext));
                const dlBtn = UI.createButton('download', (b, i) => Engine.executeAction(b, i, 'download', getContext), 'Download Reel (Shortcut: D)');

                btnContainer.appendChild(linkBtn);
                btnContainer.appendChild(dlBtn);

                actionBar.insertBefore(btnContainer, actionBar.firstChild);
            });
        },

        // Strategy 3: Stories (Static Viewer Injection)
        processStories() {
            if (!window.location.pathname.includes('/stories/')) return;

            const medias = Array.from(document.querySelectorAll('img, video')).filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 150 && rect.height > 150;
            });
            const activeMedia = medias.pop();
            if (!activeMedia) return;

            const viewer = activeMedia.closest('section');

            if (processedWrappers.has(viewer)) {
                if (viewer.querySelector(`:scope > .${CLASSES.CONTAINER}`)) return;
            }

            if (!viewer || viewer.querySelector(`:scope > .${CLASSES.CONTAINER}`)) {
                if (viewer) processedWrappers.set(viewer, true);
                return;
            }

            const btnContainer = UI.createContainer(CLASSES.STORY_BTN);

            const getContext = () => {
                const currentMedias = Array.from(viewer.querySelectorAll('img, video')).filter(this.isValidMedia);
                if (!currentMedias.length) throw new Error('No active story media found');

                const centerX = window.innerWidth / 2;
                const currentActive = currentMedias.reduce((closest, current) => {
                    const rectC = current.getBoundingClientRect();
                    const distC = Math.abs(rectC.left + (rectC.width / 2) - centerX);
                    const rectBest = closest.getBoundingClientRect();
                    const distBest = Math.abs(rectBest.left + (rectBest.width / 2) - centerX);
                    return distC < distBest ? current : closest;
                }, currentMedias[0]);

                const fiberData = Extractor.getMediaData(currentActive);

                let postId = fiberData.postId;
                if (!postId) {
                    const match = window.location.pathname.match(/\/stories\/[^\/]+\/(\d+)/);
                    if (match) postId = match[1];
                }

                const isVideo = currentActive.tagName === 'VIDEO' || fiberData.isVideo;

                return { ...fiberData, isVideo, postId, mediaElement: currentActive, prefix: 'story' };
            };

            const linkBtn = UI.createButton('link', (b, i) => Engine.executeAction(b, i, 'link', getContext));
            const dlBtn = UI.createButton('download', (b, i) => Engine.executeAction(b, i, 'download', getContext));

            btnContainer.appendChild(linkBtn);
            btnContainer.appendChild(dlBtn);
            viewer.appendChild(btnContainer);

            processedWrappers.set(viewer, true);
            UI.setupHoverContext(viewer, btnContainer);
        },

        processAll() {
            this.processFeed();
            this.processReels();
            this.processStories();
        },

        requestUpdate() {
            if (State.debounceTimer) clearTimeout(State.debounceTimer);
            State.debounceTimer = setTimeout(() => {
                requestAnimationFrame(() => this.processAll());
            }, TIMING.DEBOUNCE_MS);
        },

        initObserver() {
            State.observer = new MutationObserver((mutations) => {
                const shouldUpdate = mutations.some(m => m.addedNodes.length > 0);
                if (shouldUpdate) this.requestUpdate();
            });
            State.observer.observe(document.body, { childList: true, subtree: true });
        },

        setupNavigationHooks() {
            const patchHistory = (method) => {
                const orig = history[method];
                return function() {
                    const rv = orig.apply(this, arguments);
                    window.dispatchEvent(new Event('xiv-locationchange'));
                    return rv;
                };
            };
            history.pushState = patchHistory('pushState');
            history.replaceState = patchHistory('replaceState');
            window.addEventListener('popstate', () => window.dispatchEvent(new Event('xiv-locationchange')));
            window.addEventListener('xiv-locationchange', () => this.requestUpdate());
        }
    };

    // ==========================================
    // 11. INITIALIZATION
    // ==========================================

    const App = {
        init() {
            UI.injectStyles();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.start());
            } else {
                this.start();
            }
        },

        start() {
            DOM.processAll();
            DOM.initObserver();
            DOM.setupNavigationHooks();
            UI.setupKeyboardShortcuts();
        }
    };

    HeaderCapture.init();
    App.init();

})();
