// ==UserScript==
// @name         [Instagram] Image Extractor
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://static.cdninstagram.com/rsrc.php/y4/r/QaBlI0OZiks.ico
// @version      4.5
// @description  Extracts and downloads the highest-resolution images directly from the Instagram feed and stories.
// @author       Xiv
// @match        *://*.instagram.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      cdninstagram.com
// @connect      fbcdn.net
// @updateURL    https://myouisaur.github.io/Instagram/image-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/image-extractor.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ==========================================
    // 1. CONFIGURATION & STATE
    // ==========================================

    if (window.__tmIgExtractor) return;
    window.__tmIgExtractor = true;

    const CONFIG = {
        JPG_QUALITY: 1.0,
        DEBOUNCE_MS: 150,
        SELECTORS: {
            MEDIA_ELEMENTS: 'img',
            FEED_CONTAINERS: 'main, [role="presentation"]'
        },
        ICONS: {
            DOWNLOAD: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px;display:block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
            LINK:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px;display:block;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
            SPINNER:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tm-spin" style="width:17px;height:17px;display:block;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>',
            CHECK:    '<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px;display:block;"><polyline points="20 6 9 17 4 12"></polyline></svg>'
        }
    };

    const State = {
        observer: null,
        debounceTimer: null,
        activeHoverContext: null
    };

    // ==========================================
    // 2. STYLES — Liquid Glass
    // ==========================================

    const CSS = `
        /* ── Container ──────────────────────────────── */
        body .tm-btn-container {
            position: absolute;
            z-index: 99999;
            display: flex;
            gap: 8px;
            pointer-events: none;
            opacity: 1;
            transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
        }

        body .tm-btn-container::before {
            content: '';
            position: absolute;
            top: -20px; right: -25px; bottom: -20px; left: -25px;
            z-index: -1;
            background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.22) 0%, rgba(0, 0, 0, 0) 65%);
            pointer-events: none;
            border-radius: 50%;
        }

        body .tm-feed-btn {
            top: 10px;
            right: 10px;
            transform: translateY(-16px) scale(0);
            transform-origin: top right;
        }

        body .tm-story-btn {
            bottom: clamp(70px, 5%, 110px);
            left: 50%;
            transform: translateX(-50%) translateY(20px) scale(0);
            transform-origin: center bottom;
        }

        body .tm-btn-container.tm-visible {
            pointer-events: auto;
        }
        body .tm-feed-btn.tm-visible {
            transform: translateY(0) scale(1);
        }
        body .tm-story-btn.tm-visible {
            transform: translateX(-50%) translateY(0) scale(1);
        }

        /* ── Button shell ────────────────────────────── */
        body .tm-action-btn {
            position: relative;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            border: none;
            outline: none;
            overflow: hidden;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
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
            transition:
                transform       0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow      0.35s ease,
                background      0.35s ease;
        }

        body .tm-action-btn::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            padding: 1px;
            background: linear-gradient(
                155deg,
                rgba(255,255,255,0.72) 0%,
                rgba(255,255,255,0.35) 25%,
                rgba(255,255,255,0.08) 55%,
                rgba(255,255,255,0.22) 100%
            );
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        body .tm-action-btn::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 58%;
            background: radial-gradient(
                ellipse 75% 70% at 50% -8%,
                rgba(255,255,255,0.58)  0%,
                rgba(255,255,255,0.20) 40%,
                rgba(255,255,255,0.05) 70%,
                transparent            90%
            );
            border-radius: 50% 50% 0 0;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        body .tm-action-btn:hover {
            transform: scale(1.075);
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

        body .tm-action-btn:active {
            transform: scale(0.95);
            transition: transform 0.10s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.10s ease;
            box-shadow:
                inset 0  1.5px 0  rgba(255,255,255,0.75),
                inset 0 -1.5px 0  rgba(255,255,255,0.06),
                inset  1px 0   0  rgba(255,255,255,0.30),
                inset -1px 0   0  rgba(255,255,255,0.10),
                0 0 0 0.5px       rgba(255,255,255,0.18),
                0 3px 10px        rgba(0,0,0,0.25);
        }

        /* ── Icon ────────────────────────────────────── */
        body .tm-btn-icon {
            position: relative;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            color: rgba(255, 255, 255, 0.96);
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
            transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.35s ease;
            pointer-events: none;
        }
        body .tm-action-btn:hover .tm-btn-icon {
            transform: scale(1.08) translateY(-1px);
            filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
        }

        /* ── Inner glass layers ──────────────────────── */
        body .tm-glass-lens {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: radial-gradient(circle at 72% 56%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, rgba(180,200,255,0.04) 80%, rgba(0,0,0,0) 100%);
            pointer-events: none;
            z-index: 1;
        }
        body .tm-glass-scatter {
            position: absolute;
            inset: 2px;
            border-radius: 50%;
            background: radial-gradient(ellipse 60% 50% at 38% 40%, rgba(255,255,255,0.09) 0%, transparent 65%);
            pointer-events: none;
            z-index: 2;
        }
        body .tm-glass-chroma {
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: radial-gradient(ellipse 100% 100% at 50% 50%, transparent 62%, rgba(80,200,255,0.09) 74%, rgba(255,80,100,0.07) 84%, transparent 92%);
            pointer-events: none;
            z-index: 3;
        }
        body .tm-glass-rim {
            position: absolute;
            bottom: 0; left: 10%; right: 10%;
            height: 40%;
            background: radial-gradient(ellipse 80% 100% at 50% 115%, rgba(255,255,255,0.26) 0%, rgba(255,255,255,0.08) 45%, transparent 70%);
            border-radius: 0 0 50% 50%;
            pointer-events: none;
            z-index: 4;
        }

        /* ── Ripple ──────────────────────────────────── */
        body .tm-glass-ripple {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.28);
            transform: scale(0);
            animation: tm-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            pointer-events: none;
            z-index: 7;
        }
        @keyframes tm-ripple {
            to { transform: scale(2.8); opacity: 0; }
        }

        /* ── Spinner ─────────────────────────────────── */
        body .tm-spin {
            animation: tm-spin-anim 0.9s linear infinite;
        }
        @keyframes tm-spin-anim {
            100% { transform: rotate(360deg); }
        }
    `;

    // ==========================================
    // 3. REACT FIBER EXTRACTION
    // ==========================================

    const Extractor = {
        getMediaData(element) {
            try {
                let currentEl = element;
                let depth = 0;

                while (currentEl && depth < 10) {
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
                                const sources = [props, props.media, props.item, props.post].filter(Boolean);

                                for (const source of sources) {
                                    const isVideo = Boolean(
                                        source.video_versions || source.is_video || source.media_type === 2
                                    );
                                    if (source.image_versions2?.candidates?.length) {
                                        const bestImage = source.image_versions2.candidates
                                            .sort((a, b) => b.width - a.width)[0].url;
                                        return { url: bestImage, isVideo };
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
                console.warn('[IG Extractor] Fiber extraction error:', err);
            }
            return { url: null, isVideo: false };
        }
    };

    // ==========================================
    // 4. MEDIA PROCESSING
    // ==========================================

    const Media = {
        generateFilename(type) {
            const randomStr = (Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8)).padEnd(12, '0').substring(0, 12);
            return `ig-${type}-${randomStr}.jpg`;
        },

        resolveBestUrl(element, mediaData) {
            if (mediaData && mediaData.url) return mediaData.url;

            if (element.srcset) {
                const sources = element.srcset.split(',').map(s => {
                    const [url, width] = s.trim().split(' ');
                    return { url, width: parseInt(width) || 0 };
                }).sort((a, b) => b.width - a.width);
                if (sources[0]) return sources[0].url;
            }

            return element.src;
        },

        async download(url, filename, buttonElement) {
            UI.setButtonState(buttonElement, 'loading');

            try {
                if (url.includes('.webp') || url.includes('.png')) {
                    await this.convertAndDownload(url, filename);
                } else {
                    await this.fetchAndDownload(url, filename);
                }
                UI.setButtonState(buttonElement, 'success', true);
                setTimeout(() => UI.setButtonState(buttonElement, 'ready', true), 2000);
            } catch (error) {
                console.warn('[IG Extractor] Download failed, falling back to open:', error);
                UI.setButtonState(buttonElement, 'error', true);
            }
        },

        fetchAndDownload(url, filename) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest !== 'undefined') {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        responseType: 'blob',
                        onload: (res) => {
                            if (res.status === 200) {
                                this.triggerDownload(URL.createObjectURL(res.response), filename);
                                resolve();
                            } else {
                                reject(new Error('HTTP status ' + res.status));
                            }
                        },
                        onerror: reject
                    });
                } else {
                    fetch(url)
                        .then(r => r.ok ? r.blob() : Promise.reject('Fetch failed'))
                        .then(blob => {
                            this.triggerDownload(URL.createObjectURL(blob), filename);
                            resolve();
                        })
                        .catch(reject);
                }
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
                            this.triggerDownload(URL.createObjectURL(blob), filename);
                            resolve();
                        } else reject(new Error('Canvas toBlob failed'));
                    }, 'image/jpeg', CONFIG.JPG_QUALITY);
                };
                img.onerror = () => reject(new Error('Image load failed'));
                img.src = url;
            });
        },

        triggerDownload(blobUrl, filename) {
            const link = document.createElement('a');
            link.href     = blobUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        }
    };

    // ==========================================
    // 5. USER INTERFACE & DOM MANAGEMENT
    // ==========================================

    const UI = {
        injectStyles() {
            const style = document.createElement('style');
            style.textContent = CSS;
            document.head.appendChild(style);
        },

        setButtonState(btn, state, isDownloadBtn = false) {
            let iconEl = btn.querySelector('.tm-btn-icon');
            if (!iconEl) {
                iconEl = document.createElement('span');
                iconEl.className = 'tm-btn-icon';
                btn.appendChild(iconEl);
            }

            // Clear content safely
            while (iconEl.firstChild) {
                iconEl.removeChild(iconEl.firstChild);
            }

            if (state === 'loading') {
                iconEl.insertAdjacentHTML('beforeend', CONFIG.ICONS.SPINNER);
                btn.style.pointerEvents = 'none';
                btn.style.opacity       = '0.7';
            } else if (state === 'error') {
                iconEl.textContent = '⚠️';
                btn.title = 'Download failed. Click link icon instead.';
                btn.style.pointerEvents = 'none';
                btn.style.opacity       = '1';
                setTimeout(() => this.setButtonState(btn, 'ready', isDownloadBtn), 3000);
            } else if (state === 'success') {
                iconEl.insertAdjacentHTML('beforeend', CONFIG.ICONS.CHECK);
                btn.style.pointerEvents = 'none';
                btn.style.opacity       = '1';
            } else if (state === 'ready') {
                iconEl.insertAdjacentHTML('beforeend', isDownloadBtn ? CONFIG.ICONS.DOWNLOAD : CONFIG.ICONS.LINK);
                btn.title = isDownloadBtn ? 'Download High-Res (Shortcut: D)' : 'Open in New Tab';
                btn.style.pointerEvents = 'auto';
                btn.style.opacity       = '1';
            }
        },

        createContainer(isStory) {
            const container = document.createElement('div');
            container.className = `tm-btn-container ${isStory ? 'tm-story-btn' : 'tm-feed-btn'}`;
            return container;
        },

        createButton(type, onClickAction) {
            const btn = document.createElement('div');
            btn.className = `tm-action-btn tm-${type}-btn`;
            btn.title = type === 'download' ? 'Download High-Res (Shortcut: D)' : 'Open in New Tab';

            const lens = document.createElement('div');
            lens.className = 'tm-glass-lens';
            const scatter = document.createElement('div');
            scatter.className = 'tm-glass-scatter';
            const chroma = document.createElement('div');
            chroma.className = 'tm-glass-chroma';
            const rim = document.createElement('div');
            rim.className = 'tm-glass-rim';

            const iconEl = document.createElement('span');
            iconEl.className = 'tm-btn-icon';
            iconEl.insertAdjacentHTML('beforeend', type === 'download' ? CONFIG.ICONS.DOWNLOAD : CONFIG.ICONS.LINK);

            btn.append(lens, scatter, chroma, rim, iconEl);

            btn.addEventListener('pointerdown', function (e) {
                const r    = btn.getBoundingClientRect();
                const size = Math.max(r.width, r.height);
                const rpl  = document.createElement('div');
                rpl.className = 'tm-glass-ripple';
                rpl.style.cssText = `width:${size}px; height:${size}px; left:${e.clientX - r.left - size / 2}px; top:${e.clientY - r.top - size / 2}px;`;
                btn.appendChild(rpl);
                rpl.addEventListener('animationend', () => rpl.remove());
            });

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClickAction(btn);
            });

            return btn;
        },

        setupHoverContext(mediaElement, btnContainer, mediaData) {
            const hoverTarget = mediaElement.closest('li, [role="dialog"], [data-testid="story-viewer"], article, main') || mediaElement.parentElement;
            if (!hoverTarget) return;

            hoverTarget.addEventListener('mouseenter', () => {
                btnContainer.classList.add('tm-visible');
                State.activeHoverContext = { media: mediaElement, btnContainer, mediaData };
            });

            hoverTarget.addEventListener('mouseleave', () => {
                btnContainer.classList.remove('tm-visible');
                if (State.activeHoverContext && State.activeHoverContext.media === mediaElement) {
                    State.activeHoverContext = null;
                }
            });

            if (hoverTarget.matches(':hover')) {
                btnContainer.classList.add('tm-visible');
                State.activeHoverContext = { media: mediaElement, btnContainer, mediaData };
            }
        },

        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (e.key.toLowerCase() === 'd') {
                    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
                    if (State.activeHoverContext) {
                        const downloadBtn = State.activeHoverContext.btnContainer.querySelector('.tm-download-btn');
                        if (downloadBtn) {
                            e.preventDefault();
                            downloadBtn.click();
                        }
                    }
                }
            });
        }
    };

    // ==========================================
    // DOM
    // ==========================================

    const DOM = {
        isValidMedia(el) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 150 || rect.height < 150) return false;

            const src = el.src || '';
            if (src.includes('/profile_pic/') || src.includes('s150x150')) return false;
            if (src.includes('static.cdninstagram.com') || src.startsWith('data:')) return false;

            const inArticle = el.closest('article');
            const inDialog  = el.closest('[role="dialog"]');
            const inStory   = el.closest('[data-testid="story-viewer"]') || window.location.pathname.includes('/stories/');
            const isPermalink = window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/') || window.location.pathname.includes('/reels/');

            if (!inArticle && !inDialog && !inStory && !isPermalink) return false;

            const slide = el.closest('li, article, [role="dialog"], main');
            if (slide && slide.querySelector('video')) return false;

            return true;
        },

        isStory() {
            return window.location.pathname.includes('/stories/');
        },

        processMediaElements() {
            const mediaElements = document.querySelectorAll(CONFIG.SELECTORS.MEDIA_ELEMENTS);

            mediaElements.forEach(media => {
                if (!this.isValidMedia(media)) return;

                const wrapper = media.parentElement;
                if (!wrapper) return;

                const currentSrc = media.src;
                const mediaData  = Extractor.getMediaData(media);
                if (mediaData.isVideo) return;

                if (media.dataset.tmProcessedSrc === currentSrc) {
                    if (wrapper.querySelector('.tm-btn-container')) return;
                }

                wrapper.querySelectorAll('.tm-btn-container').forEach(c => c.remove());
                media.dataset.tmProcessedSrc = currentSrc;

                const position = window.getComputedStyle(wrapper).position;
                if (position === 'static') wrapper.style.position = 'relative';

                const inStory     = this.isStory();
                const btnContainer = UI.createContainer(inStory);

                const linkBtn = UI.createButton('link', () => {
                    const url = Media.resolveBestUrl(media, mediaData);
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                });

                const downloadBtn = UI.createButton('download', (btn) => {
                    const url = Media.resolveBestUrl(media, mediaData);
                    if (!url) return;
                    const filename = Media.generateFilename(inStory ? 'story' : 'feed');
                    Media.download(url, filename, btn);
                });

                btnContainer.appendChild(linkBtn);
                btnContainer.appendChild(downloadBtn);
                wrapper.appendChild(btnContainer);

                UI.setupHoverContext(media, btnContainer, mediaData);
            });
        },

        requestUpdate() {
            if (State.debounceTimer) clearTimeout(State.debounceTimer);
            State.debounceTimer = setTimeout(() => this.processMediaElements(), CONFIG.DEBOUNCE_MS);
        },

        initObserver() {
            // Narrowly scoped observer focusing only on node additions
            State.observer = new MutationObserver((mutations) => {
                const shouldUpdate = mutations.some(m => m.addedNodes.length > 0);
                if (shouldUpdate) this.requestUpdate();
            });

            // Target the React root or body, ignoring attribute modifications universally
            const targetNode = document.querySelector('#react-root, main') || document.body;
            State.observer.observe(targetNode, {
                childList: true,
                subtree: true
            });
        },

        setupNavigationHooks() {
            // Replaces the heavy document mutation string comparison from v4.4
            const patchHistory = (method) => {
                const orig = history[method];
                return function() {
                    const rv = orig.apply(this, arguments);
                    window.dispatchEvent(new Event('tm-locationchange'));
                    return rv;
                };
            };
            history.pushState = patchHistory('pushState');
            history.replaceState = patchHistory('replaceState');
            window.addEventListener('popstate', () => window.dispatchEvent(new Event('tm-locationchange')));
            window.addEventListener('tm-locationchange', () => this.requestUpdate());
        }
    };

    // ==========================================
    // 6. INITIALIZATION
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
            DOM.processMediaElements();
            DOM.initObserver();
            DOM.setupNavigationHooks();
            UI.setupKeyboardShortcuts();
        }
    };

    App.init();

})();
