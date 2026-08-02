// ==UserScript==
// @name         [Instagram] Viewed Post Marker
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      4.10
// @description  Manually mark Instagram posts as seen with silent cross-device synchronization.
// @author       Xiv
// @match        *://*.instagram.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      *
// @run-at       document-end
// @noframes
// @updateURL    https://myouisaur.github.io/Instagram/viewed-post-marker.user.js
// @downloadURL  https://myouisaur.github.io/Instagram/viewed-post-marker.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Guard against duplicate initialization in SPA environments
    if (window.xivInitialized) return;
    window.xivInitialized = true;

    // =========================================================
    // CONFIGURATION
    // =========================================================
    const CLOUD_CONFIG = {
        WORKER_URL: 'https://ig-viewed-post-marker.myouisaur.workers.dev/',
        OWNER: 'myouisaur',
        REPO: 'Instagram',
        BRANCH: 'main',
        PATH: 'viewed-post-marker-db.json'
    };

    const CONFIG = {
        // --- Identifiers & Namespaces ---
        UI_PREFIX: 'xiv-ig-seen',
        STORAGE_KEY: 'xiv_ig_seen_data_v3',
        TOKEN_KEY: 'xiv_ig_github_token',
        DIRTY_KEY: 'xiv_ig_sync_dirty',
        LAST_FETCH_KEY: 'xiv_ig_last_fetch',
        MUTEX_KEY: 'xiv_ig_global_mutex',
        SYNC_LOCK_KEY: 'xiv_ig_cloud_sync_lock',

        // --- Legacy Migration Keys ---
        LEGACY_TM_STORAGE_KEY: 'tm_ig_seen_data_v3',
        LEGACY_TM_TOKEN_KEY: 'tm_ig_github_token',
        LEGACY_V2_STORAGE_KEY: 'tm_ig_seen_data_v2',

        // --- Timing ---
        OBSERVER_DEBOUNCE_MS: 150,
        ROUTER_SETTLE_DELAY_MS: 250,
        CLOUD_HISTORY_THROTTLE_MS: 10000,
        CLOUD_FOCUS_THROTTLE_MS: 2000,
        CLOUD_REQUEST_TIMEOUT_MS: 15000,
        CLOUD_RATE_LIMIT_BACKOFF_MS: 60 * 60 * 1000,
        CLOUD_PUSH_RETRY_LIMIT: 3,

        // --- Visual Settings ---
        CHECKMARK_SIZE: '7.5rem',
        CHECKMARK_COLOR: '#4ade80',
        OVERLAY_DIM_OPACITY: 0.50,

        // --- Post Expansion (Single-Post Permalink Pages Only) ---
        POST_EXPAND_MIN_HEIGHT: '600px',
        POST_EXPAND_PREFERRED_HEIGHT: '88vh',
        POST_EXPAND_MAX_HEIGHT: '1300px',
        POST_EXPAND_MIN_OVERFLOW_PX: 20
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
            // Strictly extract the shortcode, rejecting sub-paths like /liked_by/ or /comments/
            const match = url.match(/\/(?:p|reel)\/([a-zA-Z0-9_-]+)\/?(?:[\?#].*)?$/);
            return match ? match[1] : null;
        }
    };

    // =========================================================
    // CLOUD API ENGINE
    // =========================================================
    const CloudAPI = {
        rateLimitResetTime: 0,

        isRateLimited() {
            return Date.now() < this.rateLimitResetTime;
        },

        handleRateLimit(status) {
            if (status === 403 || status === 429) {
                this.rateLimitResetTime = Date.now() + CONFIG.CLOUD_RATE_LIMIT_BACKOFF_MS;
                console.warn('[IG Tracker] GitHub API rate limit hit. Pausing cloud sync for 1 hour.');
                UI.showAuthToast('GitHub Sync: Rate limit reached. Pausing sync for 1 hour.', 'warning');
                return true;
            }
            return false;
        },

        getToken() {
            return (GM_getValue(CONFIG.TOKEN_KEY, '') || '').trim();
        },

        async promptForToken() {
            const currentToken = this.getToken();
            const newToken = window.prompt('[Instagram Viewed Post Marker]\n\nEnter your GitHub Personal Access Token to enable cloud sync:\n\n(Leave blank to remove your token)', currentToken);
            if (newToken !== null) {
                const trimmedToken = newToken.trim();
                if (trimmedToken === '') {
                    GM_setValue(CONFIG.TOKEN_KEY, '');
                    UI.showAuthToast('GitHub Token removed. Sync disabled.', 'error');
                    return false;
                }

                GM_setValue(CONFIG.TOKEN_KEY, trimmedToken);
                try {
                    await Storage.fetchCloudBackground(true);
                    UI.showAuthToast('GitHub Token authenticated and synced successfully!', 'success');
                } catch (e) {
                    console.warn(`[IG Tracker] Initial sync failed with new token:`, e);
                }
                return true;
            }
            return false;
        },

        getHeaders(targetPath = CLOUD_CONFIG.PATH) {
            return {
                'X-GitHub-Token': this.getToken(),
                'X-GitHub-Owner': CLOUD_CONFIG.OWNER,
                'X-GitHub-Repo': CLOUD_CONFIG.REPO,
                'X-GitHub-Path': targetPath,
                'X-GitHub-Branch': CLOUD_CONFIG.BRANCH
            };
        },

        fetch(targetPath = CLOUD_CONFIG.PATH) {
            return new Promise((resolve, reject) => {
                if (!this.getToken()) {
                    return resolve({});
                }
                if (this.isRateLimited()) {
                    return reject(new Error('GitHub API is currently rate limited.'));
                }

                const cacheBusterUrl = `${CLOUD_CONFIG.WORKER_URL}?t=${Date.now()}`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: cacheBusterUrl,
                    headers: this.getHeaders(targetPath),
                    responseType: 'json',
                    timeout: CONFIG.CLOUD_REQUEST_TIMEOUT_MS,
                    onload: (res) => {
                        if (this.handleRateLimit(res.status)) {
                            return reject(new Error('Rate limit hit.'));
                        }

                        if (res.status === 401 || res.status === 400) {
                            UI.showAuthToast('GitHub Sync: Invalid or expired token. Click to update.', 'error');
                            return resolve({});
                        }

                        if (res.status === 200) {
                            let data = res.response;
                            if (typeof data === 'string') {
                                try { data = JSON.parse(data); }
                                catch (e) { resolve({}); return; }
                            }
                            resolve(data);
                        } else if (res.status === 404) {
                            resolve({});
                        } else {
                            reject(new Error(`Fetch failed: ${res.status}`));
                        }
                    },
                    onerror: reject,
                    ontimeout: reject
                });
            });
        },

        put(targetPath, payloadData) {
            return new Promise((resolve, reject) => {
                if (!this.getToken()) return reject(new Error('No GitHub token configured.'));
                if (this.isRateLimited()) return reject(new Error('GitHub API is currently rate limited.'));

                GM_xmlhttpRequest({
                    method: 'PUT',
                    url: CLOUD_CONFIG.WORKER_URL,
                    headers: {
                        ...this.getHeaders(targetPath),
                        'Content-Type': 'application/json'
                    },
                    data: JSON.stringify(payloadData),
                    responseType: 'json',
                    timeout: CONFIG.CLOUD_REQUEST_TIMEOUT_MS,
                    onload: (res) => {
                        if (this.handleRateLimit(res.status)) {
                            return reject(new Error('Rate limit hit.'));
                        }

                        if (res.status === 401 || res.status === 400) {
                            UI.showAuthToast('GitHub Sync: Invalid or expired token. Click to update.', 'error');
                            return reject(new Error(`Token rejected by server.`));
                        }

                        if (res.status >= 200 && res.status < 300) resolve();
                        else reject(new Error(`Upload failed: ${res.status}`));
                    },
                    onerror: reject,
                    ontimeout: reject
                });
            });
        }
    };

    // =========================================================
    // PAGE CONTEXT MODULE
    // =========================================================
    const PageContext = {
        shouldScanGrid() {
            const path = window.location.pathname;
            const excluded = ['/', '/explore', '/reels', '/direct', '/stories', '/accounts'];
            if (excluded.some(p => path === p || path.startsWith(p + '/'))) return false;
            return true;
        },

        isSinglePostPermalink() {
            return /^\/(?:[^/]+\/)?p\/[a-zA-Z0-9_-]+\/?$/.test(window.location.pathname)
                || /^\/[^/]+\/reel\/[a-zA-Z0-9_-]+\/?$/.test(window.location.pathname);
        }
    };

    // =========================================================
    // POST EXPANDER MODULE (Single-Post Permalink Pages Only)
    // =========================================================
    const PostExpander = {
        apply(rightPanel) {
            try {
                if (!PageContext.isSinglePostPermalink()) return;
                if (rightPanel.closest('[role="dialog"]')) return; // never touch the modal
                if (rightPanel.dataset.xivExpanded === 'true') return; // idempotent

                const row = rightPanel.parentElement;
                const wrapper = row ? row.parentElement : null;
                if (!row || !wrapper) {
                    console.warn('[IG Tracker][PostExpander] Could not locate post row/wrapper. Skipping expansion.');
                    return;
                }

                const leftPanel = Array.from(row.children).find(child => child !== rightPanel);

                wrapper.classList.add(`${CONFIG.UI_PREFIX}-post-wrapper`);
                row.classList.add(`${CONFIG.UI_PREFIX}-post-row`);

                if (leftPanel) {
                    leftPanel.classList.add(`${CONFIG.UI_PREFIX}-left-panel`);
                }

                rightPanel.dataset.xivExpanded = 'true';

                requestAnimationFrame(() => {
                    this.expandCommentScrollArea(rightPanel);

                    // Allow the browser layout engine to paint the new flex dimensions,
                    // then trigger a native resize event so Instagram's React engine
                    // recalculates the aspect-ratio limits and carousel widths dynamically.
                    setTimeout(() => {
                        window.dispatchEvent(new Event('resize'));
                    }, 50);
                });
            } catch (e) {
                console.warn('[IG Tracker][PostExpander] Failed to expand post height/width:', e);
            }
        },

        expandCommentScrollArea(rightPanel) {
            try {
                let target = null;
                let maxOverflow = CONFIG.POST_EXPAND_MIN_OVERFLOW_PX;

                Array.from(rightPanel.children).forEach(child => {
                    const overflow = child.scrollHeight - child.clientHeight;
                    if (overflow > maxOverflow) {
                        maxOverflow = overflow;
                        target = child;
                    }
                });

                if (target) {
                    target.classList.add(`${CONFIG.UI_PREFIX}-comment-scroll`);
                }
            } catch (e) {
                console.warn('[IG Tracker][PostExpander] Failed to enhance comment scroll area:', e);
            }
        },

        teardown() {
            try {
                document.querySelectorAll(`.${CONFIG.UI_PREFIX}-post-wrapper`).forEach(el => {
                    el.classList.remove(`${CONFIG.UI_PREFIX}-post-wrapper`);
                });
                document.querySelectorAll(`.${CONFIG.UI_PREFIX}-post-row`).forEach(el => {
                    el.classList.remove(`${CONFIG.UI_PREFIX}-post-row`);
                });
                document.querySelectorAll(`.${CONFIG.UI_PREFIX}-left-panel`).forEach(el => {
                    el.classList.remove(`${CONFIG.UI_PREFIX}-left-panel`);
                });
                document.querySelectorAll(`.${CONFIG.UI_PREFIX}-comment-scroll`).forEach(el => {
                    el.classList.remove(`${CONFIG.UI_PREFIX}-comment-scroll`);
                });
                document.querySelectorAll(`.${CONFIG.UI_PREFIX}-right-panel`).forEach(el => {
                    delete el.dataset.xivExpanded;
                });
            } catch (e) {
                console.warn('[IG Tracker][PostExpander] Teardown failed:', e);
            }
        }
    };

    // =========================================================
    // ROUTER MODULE (SPA Navigation Detection)
    // =========================================================
    const Router = {
        currentPath: window.location.pathname,
        settleTimer: null,

        init() {
            try {
                this.patchHistoryMethod('pushState');
                this.patchHistoryMethod('replaceState');
                window.addEventListener('popstate', () => this.handleChange());
            } catch (e) {
                console.warn('[IG Tracker][Router] Failed to initialize navigation detection:', e);
            }
        },

        patchHistoryMethod(methodName) {
            const original = history[methodName];
            if (typeof original !== 'function') return;

            history[methodName] = function (...args) {
                const result = original.apply(this, args);
                Router.handleChange();
                return result;
            };
        },

        handleChange() {
            const newPath = window.location.pathname;
            if (newPath === this.currentPath) return;
            this.currentPath = newPath;

            clearTimeout(this.settleTimer);
            this.settleTimer = setTimeout(() => this.onNavigate(), CONFIG.ROUTER_SETTLE_DELAY_MS);
        },

        onNavigate() {
            try {
                PostExpander.teardown();
                App.resetActionBarMarkers();
                requestAnimationFrame(() => App.scanAll());
            } catch (e) {
                console.warn('[IG Tracker][Router] Navigation handling failed:', e);
            }
        }
    };

    // =========================================================
    // STORAGE & SYNC MODULE
    // =========================================================
    const Storage = {
        data: {},
        _lastCloudFetch: 0,
        _taskQueue: Promise.resolve(),

        async init() {
            this.migrateLegacyNamespaces();
            this.loadLocal();
            this.setupCrossTabSync();
            this.setupDirtyListener();

            if (!CloudAPI.getToken()) {
                UI.showAuthToast('GitHub Sync: Token missing. Click to add.', 'error');
            } else {
                this.fetchCloudBackground(true);
            }
        },

        migrateLegacyNamespaces() {
            const oldToken = GM_getValue(CONFIG.LEGACY_TM_TOKEN_KEY, null);
            if (oldToken && !GM_getValue(CONFIG.TOKEN_KEY, null)) {
                GM_setValue(CONFIG.TOKEN_KEY, oldToken);
                this.cleanupLegacyKey(CONFIG.LEGACY_TM_TOKEN_KEY);
            }

            const oldData = GM_getValue(CONFIG.LEGACY_TM_STORAGE_KEY, null);
            if (oldData && !GM_getValue(CONFIG.STORAGE_KEY, null)) {
                GM_setValue(CONFIG.STORAGE_KEY, oldData);
                this.cleanupLegacyKey(CONFIG.LEGACY_TM_STORAGE_KEY);
            }
        },

        _queueTask(taskFn) {
            this._taskQueue = this._taskQueue.then(taskFn).catch(e => {
                console.error('[IG Tracker] Task queue exception', e);
            });
            return this._taskQueue;
        },

        async _withLock(callback) {
            const lockKey = CONFIG.MUTEX_KEY;
            const myId = Math.random().toString(36).substring(2, 10);
            let attempts = 0;

            while (attempts < 200) {
                const lockStr = GM_getValue(lockKey, null);
                let currentLock = null;
                try { currentLock = lockStr ? JSON.parse(lockStr) : null; } catch(e) {}

                const now = Date.now();
                if (!currentLock || (now - currentLock.time > 3000)) {
                    GM_setValue(lockKey, JSON.stringify({ id: myId, time: now }));
                    await new Promise(r => setTimeout(r, 20));

                    const verifyStr = GM_getValue(lockKey, null);
                    let verifyLock = null;
                    try { verifyLock = verifyStr ? JSON.parse(verifyStr) : null; } catch(e) {}

                    if (verifyLock && verifyLock.id === myId) {
                        try {
                            return await callback();
                        } finally {
                            await new Promise(r => setTimeout(r, 75));
                            GM_setValue(lockKey, null);
                        }
                    }
                }

                const jitter = Math.floor(Math.random() * 40) + 20;
                await new Promise(r => setTimeout(r, jitter));
                attempts++;
            }

            console.warn('[IG Tracker] Global mutex timeout. Forcing execution to prevent stall.');
            return await callback();
        },

        setupDirtyListener() {
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(CONFIG.DIRTY_KEY, (key, oldValue, newValue, remote) => {
                    if (newValue === true && document.visibilityState === 'visible') {
                        setTimeout(() => this.pushToCloud(), 200);
                    }
                });
            }

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && GM_getValue(CONFIG.DIRTY_KEY, false)) {
                    setTimeout(() => this.pushToCloud(), 200);
                }
            });
        },

        async fetchCloudBackground(force = false, isFocusEvent = false) {
            if (!CloudAPI.getToken() || CloudAPI.isRateLimited()) return;
            const now = Date.now();
            const lastFetch = GM_getValue(CONFIG.LAST_FETCH_KEY, 0);
            const isDirty = GM_getValue(CONFIG.DIRTY_KEY, false);

            if (!force && !isDirty) {
                if (isFocusEvent && (now - lastFetch < CONFIG.CLOUD_FOCUS_THROTTLE_MS)) return;
                if (!isFocusEvent && (now - lastFetch < CONFIG.CLOUD_HISTORY_THROTTLE_MS)) return;
            }

            GM_setValue(CONFIG.LAST_FETCH_KEY, now);

            try {
                const cloudData = await CloudAPI.fetch();
                if (cloudData && Object.keys(cloudData).length > 0) {
                    await this._queueTask(() => this._withLock(async () => {
                        this.loadLocal();
                        this.mergeData(cloudData);
                    }));
                }

                if (isDirty) {
                    await this.pushToCloud();
                }
            } catch (e) {
                console.warn(`[IG Tracker] Background cloud sync failed:`, e);
            }
        },

        loadLocal() {
            try {
                const rawData = GM_getValue(CONFIG.STORAGE_KEY, null);
                if (rawData) {
                    this.data = JSON.parse(rawData);
                } else {
                    this.migrateFromV2Legacy();
                }
            } catch (e) {
                console.warn(`[IG Tracker] Corrupted storage. Resetting database.`);
                this.data = {};
            }
        },

        migrateFromV2Legacy() {
            const rawV2 = GM_getValue(CONFIG.LEGACY_V2_STORAGE_KEY, null);
            if (!rawV2) return;

            try {
                const dataV2 = JSON.parse(rawV2);
                const migrated = {};
                const now = Date.now();

                dataV2.forEach(shortcode => {
                    migrated[shortcode] = { s: true, t: now };
                });

                this.data = migrated;
                GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(this.data));
                this.cleanupLegacyKey(CONFIG.LEGACY_V2_STORAGE_KEY);
            } catch(e) {
                console.warn(`[IG Tracker] V2 legacy migration failed:`, e);
            }
        },

        cleanupLegacyKey(key) {
            try {
                if (typeof GM_deleteValue === 'function' && GM_getValue(key, undefined) !== undefined) {
                    GM_deleteValue(key);
                }
            } catch (e) {
                console.warn(`[IG Tracker] Failed to clean up legacy storage key: ${key}`, e);
            }
        },

        saveLocal() {
            setTimeout(() => {
                GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(this.data));
            }, 0);
        },

        mergeData(remoteData) {
            let changed = false;

            for (const [shortcode, remoteState] of Object.entries(remoteData)) {
                const localState = this.data[shortcode];

                if (!localState || remoteState.t > localState.t) {
                    this.data[shortcode] = remoteState;
                    changed = true;

                    document.dispatchEvent(new CustomEvent(`${CONFIG.UI_PREFIX}-sync`, {
                        detail: { shortcode, isSeen: remoteState.s }
                    }));
                }
            }

            if (changed) {
                this.saveLocal();
            }
        },

        setupCrossTabSync() {
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(CONFIG.STORAGE_KEY, (key, oldValue, newValue, remote) => {
                    if (remote) {
                        try {
                            const newObj = JSON.parse(newValue || '{}');
                            this.mergeData(newObj);
                        } catch (e) {}
                    }
                });
            }
        },

        async pushToCloud() {
            if (!CloudAPI.getToken()) return 'skipped';
            if (CloudAPI.isRateLimited()) return 'skipped';

            const syncLockKey = CONFIG.SYNC_LOCK_KEY;
            let shouldUpload = false;

            await this._withLock(async () => {
                if (Date.now() - GM_getValue(syncLockKey, 0) < 5000) {
                    GM_setValue(CONFIG.DIRTY_KEY, true);
                    shouldUpload = false;
                } else {
                    GM_setValue(syncLockKey, Date.now());
                    GM_setValue(CONFIG.DIRTY_KEY, false);
                    shouldUpload = true;
                }
            });

            if (!shouldUpload) return 'queued';

            try {
                let pushing = true;
                let loops = 0;

                while (pushing && loops < CONFIG.CLOUD_PUSH_RETRY_LIMIT) {
                    loops++;

                    const latestCloudData = await CloudAPI.fetch();
                    await this._queueTask(() => this._withLock(async () => {
                        this.loadLocal();
                        if (latestCloudData && Object.keys(latestCloudData).length > 0) {
                            this.mergeData(latestCloudData);
                        }
                    }));

                    await CloudAPI.put(CLOUD_CONFIG.PATH, this.data);

                    await this._withLock(async () => {
                        if (!GM_getValue(CONFIG.DIRTY_KEY, false)) {
                            pushing = false;
                        } else {
                            GM_setValue(syncLockKey, Date.now());
                            GM_setValue(CONFIG.DIRTY_KEY, false);
                        }
                    });
                }

                await this._withLock(async () => {
                    GM_setValue(syncLockKey, 0);
                });

                return 'synced';
            } catch (e) {
                await this._withLock(async () => {
                    GM_setValue(syncLockKey, 0);
                    GM_setValue(CONFIG.DIRTY_KEY, true);
                });
                console.error(`[IG Tracker] Cloud push failed (will retry automatically):`, e);
                throw e;
            }
        },

        toggle(shortcode) {
            const currentState = this.data[shortcode]?.s || false;
            const newState = !currentState;

            this.data[shortcode] = { s: newState, t: Date.now() };

            document.dispatchEvent(new CustomEvent(`${CONFIG.UI_PREFIX}-sync`, {
                detail: { shortcode, isSeen: newState }
            }));

            this.saveLocal();
            GM_setValue(CONFIG.DIRTY_KEY, true);

            return newState;
        },

        has(shortcode) {
            return this.data[shortcode]?.s === true;
        }
    };

    // =========================================================
    // UI MODULE
    // =========================================================
    const UI = {
        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                /* ----------------- GRID STYLES ----------------- */
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
                    background: rgba(0, 0, 0, ${CONFIG.OVERLAY_DIM_OPACITY});
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.2s ease;
                }
                .${CONFIG.UI_PREFIX}-overlay.active { opacity: 1; }

                .${CONFIG.UI_PREFIX}-overlay svg {
                    width: ${CONFIG.CHECKMARK_SIZE};
                    height: ${CONFIG.CHECKMARK_SIZE};
                    fill: ${CONFIG.CHECKMARK_COLOR};
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
                    width: 1.2rem;
                    height: 1.2rem; fill: #fff;
                }

                /* ----------------- ACTION BAR STYLES ----------------- */
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
                    flex-shrink: 0; /* Ensures the button never gets squished */
                    box-sizing: border-box;
                    align-self: center;
                    transition: transform 0.15s ease;
                    outline: none;
                    -webkit-tap-highlight-color: transparent;
                }
                .${CONFIG.UI_PREFIX}-action-btn:active {
                    transform: scale(0.9);
                }

                /* ----------------- RESPONSIVE LAYOUT FIXES ----------------- */
                .${CONFIG.UI_PREFIX}-action-section {
                    column-gap: 4px !important;
                }

                /* ----------------- POST EXPANSION (single-post permalink pages only) ----------------- */

                /* Completely eliminate the hardcoded 815px wrapper limits */
                .${CONFIG.UI_PREFIX}-post-wrapper {
                    height: clamp(${CONFIG.POST_EXPAND_MIN_HEIGHT}, ${CONFIG.POST_EXPAND_PREFERRED_HEIGHT}, ${CONFIG.POST_EXPAND_MAX_HEIGHT}) !important;
                    max-height: none !important;
                    max-width: 100% !important;
                    width: 100% !important;
                }

                .${CONFIG.UI_PREFIX}-post-row {
                    height: 100% !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    align-items: stretch !important;
                }

                /* ---- DYNAMIC MEDIA PANEL (Left Side) ---- */
                .${CONFIG.UI_PREFIX}-left-panel {
                    flex: 1 1 0 !important; /* Grow infinitely to fill remaining space minus sidebar */
                    min-width: 0 !important;
                    height: 100% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    background: #000 !important;
                }

                /* Ensure the immediate internal container is ready for scaling */
                .${CONFIG.UI_PREFIX}-left-panel > div {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 100% !important;
                    height: 100% !important;
                }

                .${CONFIG.UI_PREFIX}-left-panel img,
                .${CONFIG.UI_PREFIX}-left-panel video {
                    object-fit: contain !important;
                }

                /* ---- STRICTLY PROTECT THE COMMENT SECTION (Right Panel) ---- */
                @media (min-width: 768px) {
                    .${CONFIG.UI_PREFIX}-right-panel {
                        width: fit-content !important; /* Let content dictate width naturally */
                        min-width: 335px !important;
                        max-width: 385px !important;
                        flex: 0 0 auto !important; /* Do not shrink, do not grow beyond limits. Fixes the squish bug. */
                        height: 100% !important;
                        display: flex !important;
                        flex-direction: column !important;
                        overflow: hidden !important;
                        transition: width 0.2s ease, max-width 0.2s ease;
                    }
                }

                .${CONFIG.UI_PREFIX}-comment-scroll {
                    flex: 1 1 auto !important;
                    min-height: 0 !important;
                    overflow-y: auto !important;
                }

                /* ----------------- TOAST STYLES ----------------- */
                .${CONFIG.UI_PREFIX}-toast {
                    position: fixed;
                    bottom: 2rem;
                    right: 2rem;
                    background: rgba(20, 20, 20, 0.95);
                    backdrop-filter: blur(10px);
                    border: 1px solid transparent;
                    border-left: 4px solid transparent;
                    color: #fff;
                    padding: 1rem 1.2rem;
                    border-radius: 0.6rem;
                    font-size: 0.9rem;
                    font-weight: 500;
                    box-shadow: 0 8px 16px rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    gap: 1.5rem;
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    animation: xivToastFadeIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                    transition: background 0.2s;
                }
                .${CONFIG.UI_PREFIX}-toast.error {
                    border-color: #e57373;
                    border-left-color: #e57373;
                    cursor: pointer;
                }
                .${CONFIG.UI_PREFIX}-toast.success {
                    border-color: #4ade80;
                    border-left-color: #4ade80;
                    cursor: default;
                }
                .${CONFIG.UI_PREFIX}-toast.warning {
                    border-color: #facc15;
                    border-left-color: #facc15;
                    cursor: default;
                }
                .${CONFIG.UI_PREFIX}-toast.error:hover {
                    background: rgba(40, 40, 40, 0.95);
                }
                .${CONFIG.UI_PREFIX}-toast button {
                    background: transparent;
                    border: none;
                    color: #aaa;
                    font-size: 1.2rem;
                    cursor: pointer;
                    padding: 0;
                    line-height: 1;
                    transition: color 0.2s;
                    outline: none;
                }
                .${CONFIG.UI_PREFIX}-toast button:hover {
                    color: #fff;
                }
                @keyframes xivToastFadeIn {
                    from { opacity: 0; transform: translateX(20px) scale(0.95); }
                    to { opacity: 1; transform: translateX(0) scale(1); }
                }
                @keyframes xivToastFadeOut {
                    from { opacity: 1; transform: translateX(0) scale(1); }
                    to { opacity: 0; transform: translateX(20px) scale(0.95); }
                }
            `;
            document.head.appendChild(style);

            document.addEventListener(`${CONFIG.UI_PREFIX}-sync`, (e) => {
                const { shortcode, isSeen } = e.detail;

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

                const actionBtns = document.querySelectorAll(`.${CONFIG.UI_PREFIX}-action-btn[data-shortcode="${shortcode}"]`);
                actionBtns.forEach(btn => {
                    this.renderActionIcon(btn, isSeen, btn.dataset.svgClass);
                });
            });
        },

        showAuthToast(message, type = 'error') {
            this.removeAuthToast(null, true);

            const toast = document.createElement('div');
            toast.id = `${CONFIG.UI_PREFIX}-auth-toast`;
            toast.className = `${CONFIG.UI_PREFIX}-toast ${type}`;

            const text = document.createElement('span');
            text.textContent = message;
            toast.appendChild(text);

            if (type === 'error' || type === 'warning') {
                const closeBtn = document.createElement('button');
                closeBtn.innerHTML = '✕';
                closeBtn.title = "Dismiss";
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeAuthToast(toast);
                };
                toast.appendChild(closeBtn);
            }

            if (type === 'error') {
                toast.onclick = () => {
                    CloudAPI.promptForToken();
                };
            } else if (type === 'success') {
                setTimeout(() => {
                    this.removeAuthToast(toast);
                }, 3000);
            } else if (type === 'warning') {
                setTimeout(() => {
                    this.removeAuthToast(toast);
                }, 6000);
            }

            document.body.appendChild(toast);
        },

        removeAuthToast(specificToast = null, immediate = false) {
            const toast = specificToast || document.getElementById(`${CONFIG.UI_PREFIX}-auth-toast`);
            if (toast) {
                if (immediate) {
                    toast.remove();
                    return;
                }
                toast.style.animation = 'xivToastFadeOut 0.3s forwards';
                setTimeout(() => {
                    if (toast.parentNode) toast.remove();
                }, 300);
            }
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
    // DOM OBSERVER & APP LIFECYCLE
    // =========================================================
    const App = {
        observer: null,

        start() {
            Router.init();
            this.bindEvents();
            this.startScanner();
        },

        bindEvents() {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    Storage.fetchCloudBackground(false, true);
                }
            });

            setInterval(() => {
                if (document.visibilityState === 'visible') {
                    Storage.fetchCloudBackground(false, false);
                }
            }, CONFIG.CLOUD_HISTORY_THROTTLE_MS);
        },

        startScanner() {
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

        resetActionBarMarkers() {
            try {
                document.querySelectorAll(`svg[aria-label="Save"].${CONFIG.UI_PREFIX}-processed, svg[aria-label="Remove"].${CONFIG.UI_PREFIX}-processed`)
                    .forEach(svg => svg.classList.remove(`${CONFIG.UI_PREFIX}-processed`));
            } catch (e) {
                console.warn('[IG Tracker][App] Failed to reset action bar markers:', e);
            }
        },

        scanGrid() {
            if (!PageContext.shouldScanGrid()) return;

            const links = document.querySelectorAll(`a[href*="/p/"]:not(.${CONFIG.UI_PREFIX}-processed), a[href*="/reel/"]:not(.${CONFIG.UI_PREFIX}-processed)`);
            const isProfileReelsTab = /^\/[^/]+\/reels\/?$/.test(window.location.pathname);

            links.forEach(link => {
                if (!isProfileReelsTab && !link.querySelector('img, video')) {
                    link.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                    return;
                }

                const shortcode = Utils.extractShortcode(link.getAttribute('href'));
                if (shortcode) {
                    link.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                    UI.injectGridUI(link, shortcode);
                } else {
                    link.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                }
            });
        },

        scanActionBar() {
            const saveIcons = document.querySelectorAll(`svg[aria-label="Save"]:not(.${CONFIG.UI_PREFIX}-processed), svg[aria-label="Remove"]:not(.${CONFIG.UI_PREFIX}-processed)`);

            saveIcons.forEach(svg => {
                const container = svg.closest('article')
                    || svg.closest('[role="dialog"]')
                    || svg.closest('main')
                    || svg.closest('section');

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

                const existingBtn = anchor.parentNode && anchor.parentNode.querySelector(`.${CONFIG.UI_PREFIX}-action-btn`);
                if (existingBtn) {
                    svg.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                    if (existingBtn.dataset.shortcode !== shortcode) {
                        existingBtn.dataset.shortcode = shortcode;
                        UI.renderActionIcon(existingBtn, Storage.has(shortcode), existingBtn.dataset.svgClass || '');
                    }
                    return;
                }

                svg.classList.add(`${CONFIG.UI_PREFIX}-processed`);
                UI.injectActionBarUI(anchor, svg, shortcode);

                // --- Apply Precision Layout Fixes for the Action Bar & Right Panel ---
                const section = svg.closest('section');
                if (section) {
                    section.classList.add(`${CONFIG.UI_PREFIX}-action-section`);

                    let rightPanel = section.closest('.x4h1yfo');
                    if (!rightPanel) {
                        const article = section.closest('article');
                        if (article && article.children.length >= 2) {
                            rightPanel = article.lastElementChild;
                        }
                    }
                    if (rightPanel) {
                        rightPanel.classList.add(`${CONFIG.UI_PREFIX}-right-panel`);
                        PostExpander.apply(rightPanel);
                    }
                }
            });
        }
    };

    // =========================================================
    // BOOTSTRAP
    // =========================================================
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Update GitHub Token', () => {
            CloudAPI.promptForToken();
        });
    }

    Storage.init().then(() => {
        UI.injectStyles();
        App.start();
    });

})();
