// ==UserScript==
// @name         [Instagram] Image Extractor
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://static.cdninstagram.com/rsrc.php/y4/r/QaBlI0OZiks.ico
// @version      2.0
// @description  Adds buttons to Instagram posts to open or download the highest resolution images (including stories). Keeps JPG/JPEG originals, converts PNG/WEBP → JPG (0.92 quality).
// @author       Xiv
// @match        *://*.instagram.com/*
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Instagram/image-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/image-extractor.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_CSS = `
        .ig-feed-btn-container {
            position: absolute !important;
            top: 12px !important;
            right: 12px !important;
            display: flex !important;
            gap: 6px;
            z-index: 9999 !important;
        }
        .ig-story-btn-container {
            position: absolute !important;
            bottom: 14px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            display: flex !important;
            gap: 6px;
            z-index: 9999 !important;
        }
        .ig-highres-btn {
            width: 36px;
            height: 36px;
            background: rgba(0,0,0,0.4);
            backdrop-filter: blur(6px);
            color: white;
            border-radius: 10px;
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.1);
            display: flex !important;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            box-shadow: 0 6px 18px rgba(0,0,0,0.2);
            transition: transform 0.12s ease, opacity 0.12s ease;
        }
        .ig-highres-btn:hover {
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(12px);
            border: 1.5px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .ig-highres-btn:active {
            transform: scale(0.95);
            opacity: 0.9;
        }
    `;

    GM_addStyle(BUTTON_CSS);

    function generateRandomString(length = 15) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }

    function getResolution(img) {
        const w = img.naturalWidth || img.offsetWidth || 0;
        const h = img.naturalHeight || img.offsetHeight || 0;
        return `${w}x${h}`;
    }

    function isProfilePage() {
        const path = window.location.pathname;
        const profilePattern = /^\/[^\/]+\/?(?:tagged|reels|saved)?\/?\s*$/;
        return profilePattern.test(path) && !path.startsWith('/p/') && !path.startsWith('/reel/') && !path.startsWith('/stories/');
    }

    function isStoryContext(element) {
        if (window.location.pathname.includes('/stories/')) return true;
        if (element.closest('[data-testid="story-viewer"]') ||
            (element.closest('[role="dialog"]') && window.location.pathname.includes('/stories/')) ||
            (element.closest('section') && element.closest('section').querySelector('[data-testid*="story"]'))) {
            return true;
        }
        return false;
    }

    function getHighestResImage(img) {
        if (img.srcset) {
            const sources = img.srcset.split(',')
                .map(source => {
                    const [url, width] = source.trim().split(' ');
                    return { url: url.trim(), width: parseInt(width) || 0 };
                })
                .sort((a, b) => b.width - a.width);
            if (sources.length > 0 && sources[0].url) return sources[0].url;
        }
        if (img.dataset && img.dataset.largeImage) return img.dataset.largeImage;
        return img.src;
    }

    function isPostMedia(element) {
        const src = element.src || '';
        if (!src) return false;
        if (isProfilePage()) return false;
        if (!element.offsetParent) return false;
        if (src.includes('/profile_pic/') || src.includes('s150x150')) return false;
        if (element.closest('header') || element.closest('nav') || element.closest('footer')) return false;
        if (src.includes('/sprites/') || src.includes('instagram.com/static/')) return false;
        if (src.endsWith('.svg') || src.startsWith('data:')) return false;
        if (element.naturalWidth < 200 || element.naturalHeight < 200) return false;
        if (element.closest('article') ||
            element.closest('[data-testid="media-viewer-content"]') ||
            element.closest('[role="dialog"]') ||
            element.closest('section') ||
            element.closest('[data-testid="story-viewer"]')) {
            return true;
        }
        return false;
    }

    function getMediaInfo(element) {
        const randomStr = generateRandomString(15);
        const resolution = getResolution(element);
        const isStory = isStoryContext(element);
        const prefix = isStory ? 'ig-story' : 'ig-image';
        const url = getHighestResImage(element);

        let extension = 'jpg';
        if (url.includes('.png')) extension = 'png';
        else if (url.includes('.webp')) extension = 'webp';
        else if (url.includes('.jpeg')) extension = 'jpeg';

        return {
            type: 'image',
            filename: `${prefix}-${resolution}-${randomStr}.${extension}`,
            url: url,
            isStory: isStory
        };
    }

    // ✅ Updated Download Function
    function downloadMedia(url, filename) {
        // Direct download for JPG/JPEG
        if (/\.(jpg|jpeg)$/i.test(filename)) {
            return fetch(url)
                .then(r => r.ok ? r.blob() : Promise.reject())
                .then(blob => {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                })
                .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
        }

        // Convert PNG/WEBP → JPG at quality 0.92
        if (/\.(png|webp)$/i.test(filename)) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(function(blob) {
                    if (blob) {
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = filename.replace(/\.(png|webp)$/i, '.jpg');
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(link.href);
                    } else {
                        window.open(url, '_blank', 'noopener,noreferrer');
                    }
                }, 'image/jpeg', 0.92);
            };
            img.onerror = () => window.open(url, '_blank', 'noopener,noreferrer');
            img.src = url;
            return;
        }

        // Fallback
        fetch(url)
            .then(r => r.ok ? r.blob() : Promise.reject())
            .then(blob => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            })
            .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
    }

    function removeOldButtons() {
        document.querySelectorAll('.ig-feed-btn-container, .ig-story-btn-container').forEach(c => c.remove());
    }

    function addMediaButtons() {
        removeOldButtons();
        document.querySelectorAll('img').forEach(element => {
            if (!isPostMedia(element)) return;
            const parent = element.parentElement;
            if (!parent) return;
            if (parent.querySelector('.ig-feed-btn-container, .ig-story-btn-container')) return;
            if (!/relative|absolute|fixed|sticky/i.test(getComputedStyle(parent).position)) {
                parent.style.position = 'relative';
            }
            const mediaInfo = getMediaInfo(element);
            if (!mediaInfo.url) return;

            const container = document.createElement('div');
            container.className = mediaInfo.isStory ? 'ig-story-btn-container' : 'ig-feed-btn-container';

            const openButton = document.createElement('div');
            openButton.textContent = '🔗';
            openButton.className = 'ig-highres-btn';
            openButton.title = `Open original ${mediaInfo.type}`;
            openButton.addEventListener('mousedown', e => {
                e.stopPropagation();
                e.preventDefault();
                const currentMediaInfo = getMediaInfo(element);
                window.open(currentMediaInfo.url, '_blank', 'noopener,noreferrer');
            });

            const downloadButton = document.createElement('div');
            downloadButton.textContent = '⬇';
            downloadButton.className = 'ig-highres-btn';
            downloadButton.title = `Download highest resolution ${mediaInfo.type}`;
            downloadButton.addEventListener('mousedown', e => {
                e.stopPropagation();
                e.preventDefault();
                const currentMediaInfo = getMediaInfo(element);
                downloadMedia(currentMediaInfo.url, currentMediaInfo.filename);
            });

            container.appendChild(openButton);
            container.appendChild(downloadButton);
            parent.appendChild(container);
        });
    }

    let debounceTimer = null;
    function debouncedAddButtons() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(addMediaButtons, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', debouncedAddButtons);
    } else {
        debouncedAddButtons();
    }

    window.addEventListener('load', () => setTimeout(debouncedAddButtons, 200));
    setTimeout(debouncedAddButtons, 500);
    setTimeout(debouncedAddButtons, 1000);
    setTimeout(debouncedAddButtons, 2000);

    const observer = new MutationObserver(debouncedAddButtons);
    observer.observe(document.body, { childList: true, subtree: true });

    let currentPath = window.location.pathname;
    setInterval(() => {
        if (window.location.pathname !== currentPath) {
            currentPath = window.location.pathname;
            removeOldButtons();
            setTimeout(debouncedAddButtons, 300);
        }
    }, 500);

})();
