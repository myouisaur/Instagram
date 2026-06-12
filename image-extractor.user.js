// ==UserScript==
// @name         [Instagram] Image Extractor
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      5.0
// @description  Extracts and downloads the highest-resolution images directly from the Instagram feed and stories.
// @author       Xiv
// @match        *://*.instagram.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_addStyle
// @connect      cdninstagram.com
// @connect      fbcdn.net
// @connect      *
// @updateURL    https://myouisaur.github.io/Instagram/image-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/image-extractor.user.js
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
            TOAST_DURATION_MS: 3000,
            TOAST_FADE_MS: 300
        },
        SELECTORS: {
            MEDIA_ELEMENTS: 'img',
            FEED_CONTAINERS: 'main, [role="presentation"]'
        },
        CLASSES: {
            WRAPPER: 'xiv-wrap',
            CONTAINER: 'xiv-btn-container',
            FEED_BTN: 'xiv-feed-btn',
            STORY_BTN: 'xiv-story-btn',
            BTN: 'xiv-action-btn',
            ICON_WRAPPER: 'xiv-btn-icon',
            ICON_INNER: 'xiv-icon-inner',
            MORPHING: 'xiv-morphing',
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

    const ICONS = {
        DOWNLOAD: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
        LINK:     '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
        CHECK:    '<polyline points="20 6 9 17 4 12" stroke="#4ade80" stroke-width="3"></polyline>'
    };

    const State = {
        observer: null,
        debounceTimer: null,
        activeHoverContext: null
    };

    // Invisible registry mapping DOM elements to their processed source URL
    const processedMedia = new WeakMap();

    // ==========================================
    // 2. STYLES — Liquid Glass v2
    // ==========================================

    const CSS = `
        /* ── Container ──────────────────────────────── */
        body .${CLASSES.CONTAINER} {
            position: absolute;
            z-index: 99999;
            display: flex;
            gap: 8px;
            pointer-events: none;

            /* Chromium backdrop-filter transition fix */
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

        body .${CLASSES.FEED_BTN} {
            top: 10px;
            right: 10px;
        }

        body .${CLASSES.STORY_BTN} {
            bottom: clamp(70px, 5%, 110px);
            left: 50%;
            transform: translateX(-50%);
        }

        body .${CLASSES.CONTAINER}.${CLASSES.VISIBLE} {
            visibility: visible;
            pointer-events: auto;
            transition: visibility 0s;
        }

        body .${CLASSES.CONTAINER}.${CLASSES.VISIBLE}::before {
            opacity: 1;
        }

        /* ── Button shell ────────────────────────────── */
        body .${CLASSES.BTN} {
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

            /* Hardware acceleration & direct opacity transition */
            opacity: 0;
            will-change: transform, opacity;
            transform: translateZ(0);

            transition:
                transform       0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow      0.35s ease,
                background      0.35s ease,
                opacity         0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        body .${CLASSES.CONTAINER}.${CLASSES.VISIBLE} .${CLASSES.BTN} {
            opacity: 1;
        }

        /* Loading / Locked State */
        body .${CLASSES.BTN}[data-loading="1"] {
            cursor: default !important;
            /* CRITICAL: No pointer-events: none so it physically blocks clicks */
        }

        body .${CLASSES.CONTAINER}.${CLASSES.VISIBLE} .${CLASSES.BTN}[data-loading="1"] {
            opacity: 0.8 !important;
        }

        body .${CLASSES.BTN}::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            padding: 1px;
            background: linear-gradient(155deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.35) 25%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.22) 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        body .${CLASSES.BTN}::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 58%;
            background: radial-gradient(ellipse 75% 70% at 50% -8%, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.20) 40%, rgba(255,255,255,0.05) 70%, transparent 90%);
            border-radius: 50% 50% 0 0;
            pointer-events: none;
            z-index: 5;
            transition: background 0.35s ease;
        }

        /* ── Hover & Active states ── */
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

        /* ── Icon wrapper ── */
        body .${CLASSES.ICON_WRAPPER} {
            position: relative;
            z-index: 6;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 17px;
            height: 17px;
            color: rgba(255, 255, 255, 0.96);
            filter: drop-shadow(0 0 4px rgba(0,0,0,0.65)) drop-shadow(0 1px 3px rgba(0,0,0,0.50));
            transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.35s ease;
            pointer-events: none;
        }

        body .${CLASSES.BTN}:hover .${CLASSES.ICON_WRAPPER} {
            filter: drop-shadow(0 0 7px rgba(180,210,255,0.70)) drop-shadow(0 2px 4px rgba(0,0,0,0.55));
        }

        /* ── Icon Morph Transitions ── */
        body .${CLASSES.ICON_INNER} {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            transition: opacity 0.15s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            transform-origin: center;
        }

        body .${CLASSES.ICON_INNER}.${CLASSES.MORPHING} {
            opacity: 0;
            transform: scale(0.25) rotate(-45deg);
        }

        body .${CLASSES.ICON_INNER} svg {
            width: 100% !important;
            height: 100% !important;
            display: block !important;
        }

        /* ── Inner glass layers ──────────────────────── */
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

        /* ── Ripple ──────────────────────────────────── */
        body .${CLASSES.RIPPLE} {
            position: absolute;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.28);
            transform: scale(0);
            animation: xiv-ripple 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
            pointer-events: none;
            z-index: 7;
        }
        @keyframes xiv-ripple {
            to { transform: scale(2.8); opacity: 0; }
        }

        /* ── Progress & Toasts ───────────────────────── */
        .${CLASSES.PROGRESS} {
            font-size: 11px;
            font-weight: 700;
            font-family: system-ui, -apple-system, sans-serif;
            letter-spacing: -0.5px;
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
    // 4. MEDIA PROCESSING & DOWNLOADS
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

        fetchAndSaveBlob(url, filename, onProgress) {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest === 'undefined') {
                    return reject(new Error('GM_xmlhttpRequest not available'));
                }

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
    // 5. USER INTERFACE & DOM MANAGEMENT
    // ==========================================

    const UI = {
        injectStyles() {
            if (typeof GM_addStyle === 'function') {
                GM_addStyle(CSS);
            } else {
                const style = document.createElement('style');
                style.textContent = CSS;
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

        createContainer(isStory) {
            const container = document.createElement('div');
            container.className = `${CLASSES.CONTAINER} ${isStory ? CLASSES.STORY_BTN : CLASSES.FEED_BTN}`;
            return container;
        },

        createButton(type, onClickAction) {
            const btn = document.createElement('div');
            btn.className = CLASSES.BTN;
            btn.title = type === 'download' ? 'Download High-Res (Shortcut: D)' : 'Open in New Tab';
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', btn.title);
            btn.setAttribute('tabindex', '0');

            const lens = document.createElement('div');
            lens.className = CLASSES.GLASS_LENS;
            const scatter = document.createElement('div');
            scatter.className = CLASSES.GLASS_SCATTER;
            const chroma = document.createElement('div');
            chroma.className = CLASSES.GLASS_CHROMA;
            const rim = document.createElement('div');
            rim.className = CLASSES.GLASS_RIM;

            const iconWrapper = document.createElement('span');
            iconWrapper.className = CLASSES.ICON_WRAPPER;

            const innerIconEl = document.createElement('div');
            innerIconEl.className = CLASSES.ICON_INNER;
            innerIconEl.appendChild(this.createIconElement(type === 'download' ? ICONS.DOWNLOAD : ICONS.LINK));
            iconWrapper.appendChild(innerIconEl);

            btn.append(lens, scatter, chroma, rim, iconWrapper);

            // Event Sealing: Prevent clicks from hitting Instagram's underlying navigation/post wrappers
            // We trap all interactions so the event never bubbles to Instagram's React handlers.
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

            btn.addEventListener('click', (e) => {
                onClickAction(btn, iconWrapper);
            });

            btn.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    onClickAction(btn, iconWrapper);
                }
            });

            return btn;
        },

        setupHoverContext(mediaElement, btnContainer, mediaData) {
            const hoverTarget = mediaElement.closest('li, [role="dialog"], [data-testid="story-viewer"], article, main') || mediaElement.parentElement;
            if (!hoverTarget) return;

            hoverTarget.addEventListener('mouseenter', () => {
                btnContainer.classList.add(CLASSES.VISIBLE);
                State.activeHoverContext = { media: mediaElement, btnContainer, mediaData };
            });

            hoverTarget.addEventListener('mouseleave', () => {
                btnContainer.classList.remove(CLASSES.VISIBLE);
                if (State.activeHoverContext && State.activeHoverContext.media === mediaElement) {
                    State.activeHoverContext = null;
                }
            });

            if (hoverTarget.matches(':hover')) {
                btnContainer.classList.add(CLASSES.VISIBLE);
                State.activeHoverContext = { media: mediaElement, btnContainer, mediaData };
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
    // DOM & LIFECYCLE
    // ==========================================

    const DOM = {
        isValidMedia(el) {
            const rect = el.getBoundingClientRect();
            if (rect.width < CONFIG.MIN_SIZE || rect.height < CONFIG.MIN_SIZE) return false;

            const src = el.src || '';
            if (src.includes('/profile_pic/') || src.includes('s150x150')) return false;
            if (src.includes('static.cdninstagram.com') || src.startsWith('data:')) return false;

            if (el.closest('header, nav')) return false;
            if (el.closest('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]')) return false;

            const inArticle   = el.closest('article');
            const inDialog    = el.closest('[role="dialog"]');
            const inStory     = el.closest('[data-testid="story-viewer"]') || window.location.pathname.includes('/stories/');
            const inMain      = el.closest('main');
            const isPermalink = window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/') || window.location.pathname.includes('/reels/');

            if (!inArticle && !inDialog && !inStory && !(isPermalink && inMain)) return false;

            const slide = el.closest('li') || el.parentElement;
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

                if (processedMedia.get(media) === currentSrc) {
                    if (wrapper.querySelector(`.${CLASSES.CONTAINER}`)) return;
                }

                wrapper.querySelectorAll(`.${CLASSES.CONTAINER}`).forEach(c => c.remove());
                processedMedia.set(media, currentSrc);

                const position = window.getComputedStyle(wrapper).position;
                if (position === 'static') wrapper.style.position = 'relative';

                const inStory      = this.isStory();
                const btnContainer = UI.createContainer(inStory);

                const linkBtn = UI.createButton('link', async (btnEl, iconWrapper) => {
                    if (btnEl.dataset.loading === "1") return;
                    btnEl.dataset.loading = "1";

                    const url = Media.resolveBestUrl(media, mediaData);
                    try {
                        if (url) {
                            if (typeof GM_openInTab === 'function') {
                                GM_openInTab(url, { active: false, insert: true });
                            } else {
                                window.open(url, '_blank', 'noopener,noreferrer');
                            }
                        }
                        await UI.swapIconSmoothly(iconWrapper, ICONS.CHECK);
                        setTimeout(async () => {
                            await UI.swapIconSmoothly(iconWrapper, ICONS.LINK);
                            delete btnEl.dataset.loading;
                        }, TIMING.SUCCESS_DURATION_MS);
                    } catch (e) {
                        delete btnEl.dataset.loading;
                    }
                });

                const downloadBtn = UI.createButton('download', async (btnEl, iconWrapper) => {
                    const url = Media.resolveBestUrl(media, mediaData);
                    if (!url || url.startsWith('blob:')) return;
                    if (btnEl.dataset.loading === "1") return;

                    btnEl.dataset.loading = "1";
                    const filename = Media.generateFilename(inStory ? 'story' : 'feed');

                    try {
                        if (url.includes('.webp') || url.includes('.png')) {
                            await Media.convertAndDownload(url, filename);
                        } else {
                            await Media.fetchAndSaveBlob(url, filename, (percent) => {
                                const span = document.createElement('span');
                                span.className = CLASSES.PROGRESS;
                                span.textContent = `${percent}%`;
                                iconWrapper.replaceChildren(span);
                            });
                        }

                        await UI.swapIconSmoothly(iconWrapper, ICONS.CHECK);
                        setTimeout(async () => {
                            await UI.swapIconSmoothly(iconWrapper, ICONS.DOWNLOAD);
                            delete btnEl.dataset.loading;
                        }, TIMING.SUCCESS_DURATION_MS);

                    } catch (error) {
                        log('Download failed, falling back to open:', error);
                        window.open(url, '_blank', 'noopener,noreferrer');
                        await UI.swapIconSmoothly(iconWrapper, ICONS.DOWNLOAD);
                        delete btnEl.dataset.loading;
                    }
                });

                btnContainer.appendChild(linkBtn);
                btnContainer.appendChild(downloadBtn);
                wrapper.appendChild(btnContainer);

                UI.setupHoverContext(media, btnContainer, mediaData);
            });
        },

        requestUpdate() {
            if (State.debounceTimer) clearTimeout(State.debounceTimer);
            State.debounceTimer = setTimeout(() => this.processMediaElements(), TIMING.DEBOUNCE_MS);
        },

        initObserver() {
            State.observer = new MutationObserver((mutations) => {
                const shouldUpdate = mutations.some(m => m.addedNodes.length > 0);
                if (shouldUpdate) this.requestUpdate();
            });

            const targetNode = document.querySelector('#react-root, main') || document.body;
            State.observer.observe(targetNode, { childList: true, subtree: true });
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
