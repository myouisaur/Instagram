// ==UserScript==
// @name        [Instagram] Advanced Navigation
// @namespace   https://github.com/myouisaur/instagram-advanced-nav
// @icon        https://www.instagram.com/favicon.ico
// @version     5.0
// @description The ultimate Instagram navigation engine. Hardware-accelerated visuals, Smart Video Hotkeys, Yield Engine, and Momentum-aware Edge Cooldowns.
// @author      Xiv
// @match       *://*.instagram.com/*
// @noframes
// @run-at      document-end
// @updateURL   https://myouisaur.github.io/Instagram/advanced-navigation.user.js
// @downloadURL https://myouisaur.github.io/Instagram/advanced-navigation.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.__igAdvancedNavRunning) return;
    window.__igAdvancedNavRunning = true;

    const CONFIG = {
        SELECTORS: {
            MODAL: '[role="dialog"]',
            ARTICLE: 'article',
            MAIN: 'main',
            CAROUSEL_NEXT: 'button[aria-label="Next"]',
            CAROUSEL_PREV: 'button[aria-label="Go back"]',
            POST_NEXT_SVG: 'svg[aria-label="Next"]',
            POST_PREV_SVG: 'svg[aria-label="Go back"]',
            INPUT_FIELDS: 'input, textarea, [contenteditable="true"]',
            SPAN: 'span',
            VIDEO: 'video',
            MUTE_BTN: 'button[aria-label*="audio" i], button[aria-label*="mute" i]'
        },
        CLASSES: {
            SHIM: 'ig-glow-viewport-shim',
            GLOW_RIGHT: 'ig-glow-flash-right',
            GLOW_LEFT: 'ig-glow-flash-left'
        },
        PATHS: {
            POST: '/p/',
            REEL: '/reel/'
        },
        KEYS: {
            RIGHT: 'ArrowRight',
            LEFT: 'ArrowLeft',
            UP: 'ArrowUp',
            DOWN: 'ArrowDown',
            SPACE: ' ',
            M_LOWER: 'm',
            M_UPPER: 'M'
        },
        LABELS: {
            ADS: ['Ad', 'Sponsored']
        },
        SETTINGS: {
            SPAM_PROTECTION_MS: 400,
            GLOW_DURATION_MS: 400,
            SCROLL_DURATION_MS: 450,
            DEBOUNCE_MS: 100,
            TOP_OF_PAGE_THRESHOLD: 50,
            CENTER_OFFSET_PX: 15,
            GLOW_WIDTH_VW: 30,
            GLOW_OPACITY: 0.25
        }
    };

    const Utils = {
        consumeEvent(event) {
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.preventDefault();
        },

        // Anti-Ghost Click utility
        clickAndBlur(buttonElement) {
            if (!buttonElement) return;
            buttonElement.click();
            buttonElement.blur();
        }
    };

    const CustomScroller = {
        animationId: null,
        isScrolling: false,

        init() {
            const abortScroll = () => {
                if (this.isScrolling) {
                    cancelAnimationFrame(this.animationId);
                    this.isScrolling = false;
                }
            };
            window.addEventListener('wheel', abortScroll, { passive: true });
            window.addEventListener('touchstart', abortScroll, { passive: true });
            window.addEventListener('mousedown', abortScroll, { passive: true });
        },

        getCenterPosition(element) {
            const rect = element.getBoundingClientRect();
            let targetY = window.scrollY + rect.top - (window.innerHeight / 2) + (rect.height / 2);
            return Math.max(0, targetY);
        },

        scrollToCentered(element) {
            this.smoothScroll(this.getCenterPosition(element), CONFIG.SETTINGS.SCROLL_DURATION_MS);
        },

        smoothScroll(targetY, duration) {
            this.isScrolling = true;
            cancelAnimationFrame(this.animationId);

            const startY = window.scrollY;
            const difference = targetY - startY;
            const startTime = performance.now();

            const step = (time) => {
                if (!this.isScrolling) return;

                let elapsed = time - startTime;
                if (elapsed > duration) elapsed = duration;

                const t = elapsed / duration;
                const ease = 1 - Math.pow(1 - t, 4);

                window.scrollTo(0, startY + difference * ease);

                if (elapsed < duration) {
                    this.animationId = requestAnimationFrame(step);
                } else {
                    this.isScrolling = false;
                }
            };
            this.animationId = requestAnimationFrame(step);
        }
    };

    const FeedManager = {
        timeoutId: null,

        init() {
            this.processPosts();
            this.observer = new MutationObserver(() => {
                clearTimeout(this.timeoutId);
                this.timeoutId = setTimeout(() => this.processPosts(), CONFIG.SETTINGS.DEBOUNCE_MS);
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
        },

        processPosts() {
            const articles = document.querySelectorAll(CONFIG.SELECTORS.ARTICLE);
            for (let i = 0; i < articles.length; i++) {
                const article = articles[i];

                if (!article.dataset.igFeedPost && !article.closest(CONFIG.SELECTORS.MODAL)) {
                    article.dataset.igFeedPost = 'true';
                }

                if (article.dataset.adChecked) continue;

                const spans = Array.from(article.querySelectorAll(CONFIG.SELECTORS.SPAN));
                const isAd = spans.some(span => CONFIG.LABELS.ADS.includes(span.textContent.trim()));

                if (isAd) {
                    article.dataset.isAd = 'true';
                }
                article.dataset.adChecked = 'true';
            }
        }
    };

    const ActivePostDetector = {
        get() {
            const isIndividualPath = window.location.pathname.includes(CONFIG.PATHS.POST) || window.location.pathname.includes(CONFIG.PATHS.REEL);

            const modal = document.querySelector(CONFIG.SELECTORS.MODAL);
            if (modal) {
                const modalArticle = modal.querySelector(CONFIG.SELECTORS.ARTICLE) || modal;
                return { element: modalArticle, context: 'modal', allArticles: [] };
            }

            if (isIndividualPath) {
                const mainWrapper = document.querySelector(CONFIG.SELECTORS.MAIN);
                if (mainWrapper) {
                    return { element: mainWrapper, context: 'individual', allArticles: [mainWrapper] };
                }
            }

            const articles = Array.from(document.querySelectorAll(CONFIG.SELECTORS.ARTICLE))
                .filter(a => {
                    if (a.closest(CONFIG.SELECTORS.MODAL)) return false;
                    if (a.getBoundingClientRect().height === 0) return false;
                    return true;
                })
                .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

            if (articles.length === 0) return null;

            const viewportCenter = window.innerHeight / 2;
            const closestArticle = articles.reduce((closest, current) => {
                const currentRect = current.getBoundingClientRect();
                const closestRect = closest.getBoundingClientRect();
                const currentDist = Math.abs(viewportCenter - (currentRect.top + currentRect.height / 2));
                const closestDist = Math.abs(viewportCenter - (closestRect.top + closestRect.height / 2));

                return currentDist < closestDist ? current : closest;
            });

            return {
                element: closestArticle,
                context: 'feed',
                allArticles: articles
            };
        }
    };

    const MediaController = {
        handle(container, action) {
            const video = container.querySelector(CONFIG.SELECTORS.VIDEO);
            if (!video) return;

            if (action === 'playpause') {
                if (video.paused) {
                    video.play().catch(() => video.parentElement.click());
                } else {
                    video.pause();
                }
            } else if (action === 'mute') {
                const audioBtn = container.querySelector(CONFIG.SELECTORS.MUTE_BTN);
                if (audioBtn) {
                    Utils.clickAndBlur(audioBtn);
                } else {
                    video.muted = !video.muted;
                }
            }
        }
    };

    const SpamVisualizer = {
        timerId: null,
        shimEl: null,

        init() {
            if (document.getElementById(CONFIG.CLASSES.SHIM)) return;
            this.shimEl = document.createElement('div');
            this.shimEl.id = CONFIG.CLASSES.SHIM;
            this.shimEl.classList.add(CONFIG.CLASSES.SHIM);
            document.body.appendChild(this.shimEl);
        },

        flash(direction) {
            if (!this.shimEl) return;

            clearTimeout(this.timerId);
            this.shimEl.classList.remove(CONFIG.CLASSES.GLOW_RIGHT, CONFIG.CLASSES.GLOW_LEFT);

            void this.shimEl.offsetWidth;

            this.shimEl.classList.add(direction === 'right' ? CONFIG.CLASSES.GLOW_RIGHT : CONFIG.CLASSES.GLOW_LEFT);

            this.timerId = setTimeout(() => {
                this.shimEl.classList.remove(CONFIG.CLASSES.GLOW_RIGHT, CONFIG.CLASSES.GLOW_LEFT);
            }, CONFIG.SETTINGS.GLOW_DURATION_MS);
        }
    };

    const StylesManager = {
        init() {
            if (document.getElementById('ig-advanced-nav-styles')) return;
            const style = document.createElement('style');
            style.id = 'ig-advanced-nav-styles';

            const op = CONFIG.SETTINGS.GLOW_OPACITY;
            const vw = CONFIG.SETTINGS.GLOW_WIDTH_VW;
            const ms = CONFIG.SETTINGS.GLOW_DURATION_MS;
            const shimCls = CONFIG.CLASSES.SHIM;
            const rightCls = CONFIG.CLASSES.GLOW_RIGHT;
            const leftCls = CONFIG.CLASSES.GLOW_LEFT;

            style.textContent = `
                article[data-is-ad="true"] {
                    opacity: 0.15 !important;
                    filter: grayscale(100%) !important;
                    pointer-events: none !important;
                }

                /* IMMERSIVE VIEWPORT SHIM ENGINE */
                .${shimCls} {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    z-index: 2147483647 !important;
                    pointer-events: none !important;
                    opacity: 0;
                    background: transparent;
                    transition: none;
                    /* Hardware Acceleration */
                    will-change: opacity;
                    transform: translateZ(0);
                }

                .${rightCls} {
                    background: linear-gradient(to left,
                        rgba(255, 0, 70, ${op}) 0%,
                        rgba(255, 0, 70, ${op * 0.4}) ${vw * 0.4}vw,
                        rgba(255, 0, 70, 0) ${vw}vw);
                    animation: ig-viewport-pulse ${ms}ms cubic-bezier(0.25, 1, 0.5, 1);
                }
                .${leftCls} {
                    background: linear-gradient(to right,
                        rgba(255, 0, 70, ${op}) 0%,
                        rgba(255, 0, 70, ${op * 0.4}) ${vw * 0.4}vw,
                        rgba(255, 0, 70, 0) ${vw}vw);
                    animation: ig-viewport-pulse ${ms}ms cubic-bezier(0.25, 1, 0.5, 1);
                }

                @keyframes ig-viewport-pulse {
                    0% { opacity: 0; }
                    20% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    };

    const InstagramAdvancedNav = {
        lastActionTime: 0,

        init() {
            StylesManager.init();
            FeedManager.init();
            CustomScroller.init();
            SpamVisualizer.init();
            document.addEventListener('keydown', this.handleKeydown.bind(this), true);
        },

        handleKeydown(event) {
            try {
                if (event.target && event.target.matches(CONFIG.SELECTORS.INPUT_FIELDS)) return;

                const activePostData = ActivePostDetector.get();
                if (!activePostData || !activePostData.element) return;

                const isRight = event.key === CONFIG.KEYS.RIGHT;
                const isLeft = event.key === CONFIG.KEYS.LEFT;
                const isUp = event.key === CONFIG.KEYS.UP;
                const isDown = event.key === CONFIG.KEYS.DOWN;
                const isSpace = event.key === CONFIG.KEYS.SPACE;
                const isMute = event.key === CONFIG.KEYS.M_LOWER || event.key === CONFIG.KEYS.M_UPPER;

                if (isSpace || isMute) {
                    Utils.consumeEvent(event);
                    MediaController.handle(activePostData.element, isSpace ? 'playpause' : 'mute');
                    return;
                }

                if (!isRight && !isLeft && !isUp && !isDown) return;

                if (activePostData.context === 'feed' && window.scrollY < CONFIG.SETTINGS.TOP_OF_PAGE_THRESHOLD && (isRight || isLeft)) {
                    const currentIndex = activePostData.allArticles.indexOf(activePostData.element);
                    if (currentIndex === 0) {
                        const targetY = CustomScroller.getCenterPosition(activePostData.element);

                        if (targetY - window.scrollY > CONFIG.SETTINGS.CENTER_OFFSET_PX) {
                            Utils.consumeEvent(event);
                            if (isRight) {
                                CustomScroller.smoothScroll(targetY, CONFIG.SETTINGS.SCROLL_DURATION_MS);
                            }
                            return;
                        }
                    }
                }

                if (activePostData.context === 'feed' && (isUp || isDown)) {
                    Utils.consumeEvent(event);
                    this.scrollToNeighbor(activePostData, isDown ? 'next' : 'prev');
                    return;
                }

                if (activePostData.context === 'modal' && (event.ctrlKey || event.metaKey)) {
                    Utils.consumeEvent(event);
                    this.triggerModalOuterNavigation(event, isRight ? 'right' : 'left');
                    return;
                }

                if (isRight || isLeft) {
                    this.processCarouselNavigation(event, activePostData, isRight ? 'right' : 'left');
                }

            } catch (error) {
                console.warn('[Instagram Advanced Nav] Error handling keystroke:', error);
            }
        },

        triggerModalOuterNavigation(event, direction) {
            const svgSelector = direction === 'right' ? CONFIG.SELECTORS.POST_NEXT_SVG : CONFIG.SELECTORS.POST_PREV_SVG;
            const outerSvg = document.querySelector(svgSelector);
            if (outerSvg) {
                const outerButton = outerSvg.closest('button, [role="button"]');
                Utils.clickAndBlur(outerButton);
            }
        },

        scrollToNeighbor(activePostData, direction) {
            const { element, allArticles } = activePostData;
            const currentIndex = allArticles.indexOf(element);

            let targetArticle = null;
            let step = direction === 'next' ? 1 : -1;
            let checkIndex = currentIndex + step;

            if (direction === 'next' && window.scrollY < CONFIG.SETTINGS.TOP_OF_PAGE_THRESHOLD && currentIndex === 0) {
                checkIndex = 0;
            }

            while (checkIndex >= 0 && checkIndex < allArticles.length) {
                if (allArticles[checkIndex].dataset.isAd === 'true') {
                    checkIndex += step;
                    continue;
                }
                targetArticle = allArticles[checkIndex];
                break;
            }

            if (direction === 'prev' && checkIndex < 0 && currentIndex === 0) {
                CustomScroller.smoothScroll(0, CONFIG.SETTINGS.SCROLL_DURATION_MS);
                return;
            }

            if (targetArticle) {
                CustomScroller.scrollToCentered(targetArticle);
            }
        },

        _getTrueCarouselButton(container, direction) {
            const selector = direction === 'right' ? CONFIG.SELECTORS.CAROUSEL_NEXT : CONFIG.SELECTORS.CAROUSEL_PREV;
            const outerSvgSelector = direction === 'right' ? CONFIG.SELECTORS.POST_NEXT_SVG : CONFIG.SELECTORS.POST_PREV_SVG;

            const outerSvg = document.querySelector(outerSvgSelector);
            const outerButton = outerSvg ? outerSvg.closest('button, [role="button"]') : null;

            const buttons = Array.from(container.querySelectorAll(selector));

            return buttons.find(b => {
                if (b === outerButton || b.contains(outerSvg)) return false;

                const style = window.getComputedStyle(b);
                if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;

                return true;
            }) || null;
        },

        processCarouselNavigation(event, activePostData, direction) {
            const trueNextButton = this._getTrueCarouselButton(activePostData.element, 'right');
            const truePrevButton = this._getTrueCarouselButton(activePostData.element, 'left');
            const isSingleMedia = !trueNextButton && !truePrevButton;

            const now = Date.now();

            if (isSingleMedia) {
                if (activePostData.context === 'individual') return;

                if (now - this.lastActionTime < CONFIG.SETTINGS.SPAM_PROTECTION_MS) {
                    this.lastActionTime = now;
                    Utils.consumeEvent(event);
                    return;
                }

                this.lastActionTime = now;
                Utils.consumeEvent(event);

                if (activePostData.context === 'feed') {
                    this.scrollToNeighbor(activePostData, direction === 'right' ? 'next' : 'prev');
                } else if (activePostData.context === 'modal') {
                    this.triggerModalOuterNavigation(event, direction);
                }
                return;
            }

            const targetButton = direction === 'right' ? trueNextButton : truePrevButton;

            if (targetButton) {
                this.lastActionTime = now;
                Utils.consumeEvent(event);
                Utils.clickAndBlur(targetButton);
            } else {
                if (activePostData.context === 'individual') return;

                if (now - this.lastActionTime < CONFIG.SETTINGS.SPAM_PROTECTION_MS) {
                    this.lastActionTime = now;
                    Utils.consumeEvent(event);
                    SpamVisualizer.flash(direction);
                    return;
                }

                this.lastActionTime = now;
                Utils.consumeEvent(event);

                if (activePostData.context === 'feed') {
                    this.scrollToNeighbor(activePostData, direction === 'right' ? 'next' : 'prev');
                } else if (activePostData.context === 'modal') {
                    this.triggerModalOuterNavigation(event, direction);
                }
            }
        }
    };

    InstagramAdvancedNav.init();

})();
