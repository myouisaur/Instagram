// ==UserScript==
// @name         [Instagram] Image Extractor
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://static.cdninstagram.com/rsrc.php/y4/r/QaBlI0OZiks.ico
// @version      3.6
// @description  Extracts and downloads the highest-resolution images directly from the Instagram feed and stories.
// @author       Xiv
// @match        *://*.instagram.com/*
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
        },
        ICONS: {
            DOWNLOAD: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
            LINK: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
            SPINNER: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tm-spin" style="width:18px;height:18px;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>'
        }
    };

    const State = {
        observer: null,
        debounceTimer: null
    };

    // ==========================================
    // 2. STYLES
    // ==========================================

    const CSS = `
        .tm-btn-container {
            position: absolute !important;
            z-index: 99999 !important;
            display: flex !important;
            gap: 8px;
            pointer-events: auto;
        }
        .tm-feed-btn {
            top: 12px !important;
            right: 12px !important;
        }
        .tm-story-btn {
            /* Dynamic responsive boundary: scales naturally but enforces safe min/max limits */
            bottom: clamp(70px, 5%, 110px) !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
        }
        .tm-action-btn {
            width: 38px;
            height: 38px;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: #ffffff;
            border-radius: 50%;
            cursor: pointer;
            border: 1px solid rgba(255, 255, 255, 0.15);
            display: flex !important;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        }
        .tm-action-btn:hover {
            background: rgba(0, 0, 0, 0.8);
            transform: scale(1.05);
            border-color: rgba(255, 255, 255, 0.4);
        }
        .tm-action-btn:active {
            transform: scale(0.95);
        }
        .tm-spin {
            animation: tm-spin-anim 1s linear infinite;
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
            let currentEl = element;
            let depth = 0;

            while (currentEl && depth < 10) {
                const fiberKey = Object.keys(currentEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$'));

                if (fiberKey) {
                    let node = currentEl[fiberKey];
                    let fiberDepth = 0;

                    while (node && fiberDepth < 40) {
                        const props = node.memoizedProps;
                        if (props) {
                            const sources = [props, props.media, props.item, props.post].filter(Boolean);

                            for (const source of sources) {
                                const isVideo = Boolean(source.video_versions || source.is_video || source.media_type === 2);

                                if (source.image_versions2?.candidates?.length) {
                                    const bestImage = source.image_versions2.candidates.sort((a, b) => b.width - a.width)[0].url;
                                    return { url: bestImage, isVideo: isVideo };
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
            return { url: null, isVideo: false };
        }
    };

    // ==========================================
    // 4. MEDIA PROCESSING
    // ==========================================

    const Media = {
        generateFilename(type) {
            const part1 = Math.random().toString(36).substring(2, 8);
            const part2 = Math.random().toString(36).substring(2, 8);
            const randomStr = (part1 + part2).padEnd(12, '0').substring(0, 12);
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
                    UI.setButtonState(buttonElement, 'ready', true);
                } else {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error('Fetch failed');
                    const blob = await response.blob();
                    this.triggerDownload(URL.createObjectURL(blob), filename);
                    UI.setButtonState(buttonElement, 'ready', true);
                }
            } catch (error) {
                console.warn('[IG Extractor] Download failed, falling back to open:', error);
                UI.setButtonState(buttonElement, 'error', true);
                setTimeout(() => window.open(url, '_blank', 'noopener,noreferrer'), 1000);
            }
        },

        convertAndDownload(url, filename) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
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
            link.href = blobUrl;
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
            if (state === 'loading') {
                btn.innerHTML = CONFIG.ICONS.SPINNER;
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.7';
            } else if (state === 'error') {
                btn.innerHTML = '⚠️';
                btn.title = 'Download failed. Opening link instead.';
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
                setTimeout(() => this.setButtonState(btn, 'ready', isDownloadBtn), 3000);
            } else if (state === 'ready') {
                btn.innerHTML = isDownloadBtn ? CONFIG.ICONS.DOWNLOAD : CONFIG.ICONS.LINK;
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
            }
        },

        createContainer(isStory) {
            const container = document.createElement('div');
            container.className = `tm-btn-container ${isStory ? 'tm-story-btn' : 'tm-feed-btn'}`;
            return container;
        },

        createButton(type, onClickAction) {
            const btn = document.createElement('div');
            btn.className = 'tm-action-btn';
            btn.innerHTML = type === 'download' ? CONFIG.ICONS.DOWNLOAD : CONFIG.ICONS.LINK;
            btn.title = type === 'download' ? 'Download High-Res' : 'Open in New Tab';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClickAction(btn);
            });
            return btn;
        }
    };

    const DOM = {
        isValidMedia(el) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 150 || rect.height < 150) return false;

            const src = el.src || '';
            if (src.includes('/profile_pic/') || src.includes('s150x150')) return false;
            if (src.includes('static.cdninstagram.com') || src.startsWith('data:')) return false;

            const inArticle = el.closest('article');
            const inDialog = el.closest('[role="dialog"]');
            const inStory = el.closest('[data-testid="story-viewer"]') || window.location.pathname.includes('/stories/');

            if (!inArticle && !inDialog && !inStory) {
                return false;
            }

            const slide = el.closest('li, article, [role="dialog"]');
            if (slide && slide.querySelector('video')) {
                return false;
            }

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

                const mediaData = Extractor.getMediaData(media);
                if (mediaData.isVideo) return;

                if (media.dataset.tmProcessedSrc === currentSrc) {
                    if (wrapper.querySelector('.tm-btn-container')) return;
                }

                wrapper.querySelectorAll('.tm-btn-container').forEach(c => c.remove());
                media.dataset.tmProcessedSrc = currentSrc;

                const position = window.getComputedStyle(wrapper).position;
                if (position === 'static') wrapper.style.position = 'relative';

                const inStory = this.isStory();
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
            });
        },

        requestUpdate() {
            if (State.debounceTimer) clearTimeout(State.debounceTimer);
            State.debounceTimer = setTimeout(() => this.processMediaElements(), CONFIG.DEBOUNCE_MS);
        },

        initObserver() {
            State.observer = new MutationObserver((mutations) => {
                const shouldUpdate = mutations.some(m =>
                    m.addedNodes.length > 0 || (m.type === 'attributes' && m.attributeName === 'src')
                );
                if (shouldUpdate) this.requestUpdate();
            });

            State.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });
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

            let lastUrl = location.href;
            new MutationObserver(() => {
                const currentUrl = location.href;
                if (currentUrl !== lastUrl) {
                    lastUrl = currentUrl;
                    DOM.requestUpdate();
                }
            }).observe(document, { subtree: true, childList: true });
        }
    };

    App.init();

})();
