// ==UserScript==
// @name         [Instagram] Image Extractor
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://static.cdninstagram.com/rsrc.php/y4/r/QaBlI0OZiks.ico
// @version      1.6
// @description  Adds buttons to Instagram posts to open or download the highest resolution images (including stories)
// @author       Xiv
// @match        *://*.instagram.com/*
// @grant        GM_addStyle
// @updateURL    https://myouisaur.github.io/Instagram/image-extractor.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/image-extractor.user.js
// ==/UserScript==

(function() {
    'use strict';

    // CSS styles for the buttons
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
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(8px);
            color: white;
            border-radius: 8px;
            cursor: pointer;
            border: 1.5px solid rgba(255, 255, 255, 0.1);
            display: flex !important;
            align-items: center;
            justify-content: center;
            user-select: none;
            pointer-events: auto !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 16px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            flex-shrink: 0;
        }
        .ig-highres-btn:active {
            opacity: 0.8;
        }
    `;

    // Apply styles
    GM_addStyle(BUTTON_CSS);

    // Generate random string for filename
    function generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Check if current page is a profile page
    function isProfilePage() {
        const path = window.location.pathname;
        // Profile pages have patterns like: /username/ or /username/tagged/ or /username/reels/ etc.
        // But NOT /p/postid/ or /reel/postid/ or /stories/username/
        const profilePattern = /^\/[^\/]+\/?(?:tagged|reels|saved)?\/?\s*$/;
        return profilePattern.test(path) && !path.startsWith('/p/') && !path.startsWith('/reel/') && !path.startsWith('/stories/');
    }

    // Check if element is in a story context
    function isStoryContext(element) {
        // Check URL for stories path
        if (window.location.pathname.includes('/stories/')) return true;

        // Check for story-specific containers
        if (element.closest('[data-testid="story-viewer"]') ||
            element.closest('[role="dialog"]') && window.location.pathname.includes('/stories/') ||
            element.closest('section') && element.closest('section').querySelector('[data-testid*="story"]')) {
            return true;
        }

        return false;
    }

    // Get the highest resolution image from srcset or fallback to src
    function getHighestResImage(img) {
        if (img.srcset) {
            const sources = img.srcset.split(',')
                .map(source => {
                    const [url, width] = source.trim().split(' ');
                    return {
                        url: url.trim(),
                        width: parseInt(width) || 0
                    };
                })
                .sort((a, b) => b.width - a.width);

            if (sources.length > 0 && sources[0].url) {
                return sources[0].url;
            }
        }

        // Check for data attributes that might contain high-res URLs
        if (img.dataset && img.dataset.largeImage) {
            return img.dataset.largeImage;
        }

        // Fallback to regular src
        return img.src;
    }

    // Check if element is a post media (not profile pic, story, etc.)
    function isPostMedia(element) {
        const src = element.src || '';
        if (!src) return false;

        // Skip if we're on a profile page (grid view)
        if (isProfilePage()) return false;

        // Skip if element is not visible
        if (!element.offsetParent) return false;

        // Skip profile pictures and small images
        if (src.includes('/profile_pic/') || src.includes('s150x150')) return false;

        // Skip header, nav, footer elements
        if (element.closest('header') || element.closest('nav') || element.closest('footer')) return false;

        // Skip sprite and static content
        if (src.includes('/sprites/') || src.includes('instagram.com/static/')) return false;

        // Skip SVG and data URLs
        if (src.endsWith('.svg') || src.startsWith('data:')) return false;

        // Check minimum size for images
        if (element.alt && element.alt.length <= 2 && /[\uD800-\uDFFF]/.test(element.alt)) return false;
        if (element.naturalWidth < 200 || element.naturalHeight < 200) return false;

        // Must be inside an article, media viewer, or story container
        if (element.closest('article') ||
            element.closest('[data-testid="media-viewer-content"]') ||
            element.closest('[role="dialog"]') ||
            element.closest('section') ||
            element.closest('[data-testid="story-viewer"]')) {
            return true;
        }

        return false;
    }

    // Get media type and appropriate filename
    function getMediaInfo(element) {
        const randomStr = generateRandomString(15);
        const isStory = isStoryContext(element);
        const prefix = isStory ? 'instagram-story' : 'instagram-image';

        return {
            type: 'image',
            filename: `${prefix}-${randomStr}.jpg`,
            url: getHighestResImage(element),
            isStory: isStory
        };
    }

    // Remove old buttons to prevent duplicates
    function removeOldButtons() {
        document.querySelectorAll('.ig-feed-btn-container, .ig-story-btn-container').forEach(container => container.remove());
    }

    // Download media function with JPG conversion
    function downloadMedia(url, filename) {
        // Convert to highest quality JPG before downloading
        const img = new Image();
        img.crossOrigin = 'anonymous'; // Handle CORS

        img.onload = function() {
            // Create canvas for conversion
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Set canvas size to image size
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;

            // Fill white background (for transparency conversion)
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw image on canvas
            ctx.drawImage(img, 0, 0);

            // Convert to highest quality JPG
            canvas.toBlob(function(blob) {
                if (blob) {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = filename.replace(/\.(png|webp|jpg|jpeg)$/i, '.jpg');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                } else {
                    // Fallback to original method
                    window.open(url, '_blank', 'noopener,noreferrer');
                }
            }, 'image/jpeg', 1.0); // 1.0 = highest quality
        };

        img.onerror = function() {
            // Fallback to original download method
            fetch(url)
                .then(response => response.blob())
                .then(blob => {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                })
                .catch(error => {
                    console.log('Download failed, opening in new tab instead:', error);
                    // Fallback to opening in new tab if download fails
                    window.open(url, '_blank', 'noopener,noreferrer');
                });
        };

        // Start loading image
        img.src = url;
    }

    // Add high-res buttons to valid media elements
    function addMediaButtons() {
        removeOldButtons();

        // Process only images
        document.querySelectorAll('img').forEach(element => {
            if (!isPostMedia(element)) return;

            const parent = element.parentElement;
            if (!parent) return;

            // Skip if buttons already exist
            if (parent.querySelector('.ig-feed-btn-container, .ig-story-btn-container')) return;

            // Make parent positioned if it's not already
            const computedStyle = getComputedStyle(parent);
            if (!/relative|absolute|fixed|sticky/i.test(computedStyle.position)) {
                parent.style.position = 'relative';
            }

            // Get media info
            const mediaInfo = getMediaInfo(element);
            if (!mediaInfo.url) return;

            // Create container for buttons with appropriate class
            const container = document.createElement('div');
            container.className = mediaInfo.isStory ? 'ig-story-btn-container' : 'ig-feed-btn-container';

            // Create the open button
            const openButton = document.createElement('div');
            openButton.textContent = '🔗';
            openButton.className = 'ig-highres-btn';
            openButton.title = `Open original ${mediaInfo.type} (highest resolution)`;
            openButton.tabIndex = 0;

            // Add click handler for open button
            openButton.addEventListener('mousedown', function(e) {
                e.stopPropagation();
                e.preventDefault();
                const currentMediaInfo = getMediaInfo(element);
                window.open(currentMediaInfo.url, '_blank', 'noopener,noreferrer');
            });

            // Add keyboard support for open button
            openButton.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    const currentMediaInfo = getMediaInfo(element);
                    window.open(currentMediaInfo.url, '_blank', 'noopener,noreferrer');
                }
            });

            // Create the download button
            const downloadButton = document.createElement('div');
            downloadButton.textContent = '⬇';
            downloadButton.className = 'ig-highres-btn';
            downloadButton.title = `Download highest resolution ${mediaInfo.type}`;
            downloadButton.tabIndex = 0;

            // Add click handler for download button
            downloadButton.addEventListener('mousedown', function(e) {
                e.stopPropagation();
                e.preventDefault();
                const currentMediaInfo = getMediaInfo(element);
                downloadMedia(currentMediaInfo.url, currentMediaInfo.filename);
            });

            // Add keyboard support for download button
            downloadButton.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    const currentMediaInfo = getMediaInfo(element);
                    downloadMedia(currentMediaInfo.url, currentMediaInfo.filename);
                }
            });

            // Add buttons to container and container to parent
            container.appendChild(openButton);
            container.appendChild(downloadButton);
            parent.appendChild(container);
        });
    }

    // Debounced execution to improve performance
    let debounceTimer = null;
    function debouncedAddButtons() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(addMediaButtons, 100);
    }

    // Initialize on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', debouncedAddButtons);
    } else {
        debouncedAddButtons();
    }

    // Handle dynamic content loading
    window.addEventListener('load', () => setTimeout(debouncedAddButtons, 200));

    // Add buttons after delays to catch lazy-loaded content
    setTimeout(debouncedAddButtons, 500);
    setTimeout(debouncedAddButtons, 1000);
    setTimeout(debouncedAddButtons, 2000);

    // Observe DOM changes for dynamically loaded content (stories, feed updates)
    const observer = new MutationObserver(debouncedAddButtons);
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Listen for navigation changes (Instagram is a SPA)
    let currentPath = window.location.pathname;
    setInterval(() => {
        if (window.location.pathname !== currentPath) {
            currentPath = window.location.pathname;
            // Remove all buttons when navigating to a new page
            removeOldButtons();
            // Re-evaluate after navigation
            setTimeout(debouncedAddButtons, 300);
        }
    }, 500);

})();
