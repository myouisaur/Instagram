// ==UserScript==
// @name         [Instagram] Viewed Post Marker
// @namespace    https://github.com/myouisaur/Instagram
// @icon         https://www.instagram.com/favicon.ico
// @version      3.6
// @description  Manually mark Instagram posts as seen with silent cross-device GitHub synchronization.
// @author       Xiv
// @match        *://*.instagram.com/*
// @noframes
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
    const CLOUD_CONFIG = {
        WORKER_URL: 'https://ig-viewed-post-marker.myouisaur.workers.dev/',
        OWNER: 'myouisaur',
        REPO: 'Instagram',
        BRANCH: 'main',
        PATH: 'viewed-post-marker-db.json'
    };

    const CONFIG = {
        UI_PREFIX: 'tm-ig-seen',
        STORAGE_KEY: 'tm_ig_seen_data_v3',
        TOKEN_KEY: 'tm_ig_github_token',
        DIRTY_KEY: 'tm_ig_sync_dirty',
        LAST_FETCH_KEY: 'tm_ig_last_fetch',
        MUTEX_KEY: 'tm_ig_global_mutex',
        SYNC_LOCK_KEY: 'tm_ig_cloud_sync_lock',
        OBSERVER_DEBOUNCE_MS: 150,
        CLOUD_HISTORY_THROTTLE_MS: 10000,
        CLOUD_FOCUS_THROTTLE_MS: 2000,
        CLOUD_REQUEST_TIMEOUT_MS: 15000,
        CLOUD_RATE_LIMIT_BACKOFF_MS: 60 * 60 * 1000,
        CLOUD_PUSH_RETRY_LIMIT: 3,
        LEGACY_STORAGE_KEY: 'tm_ig_seen_data_v2',

        // --- Visual Settings ---
        CHECKMARK_SIZE: '7.5rem',
        CHECKMARK_COLOR: '#4ade80',
        OVERLAY_DIM_OPACITY: 0.60
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
            const match = url.match(/\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
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
                // User intentionally cleared the prompt
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

                // Append timestamp to bypass aggressive browser GET caching
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
        isProfilePage() {
            const path = window.location.pathname;
            const excluded = ['/', '/explore', '/reels', '/direct', '/stories', '/accounts'];
            if (excluded.some(p => path === p || path.startsWith(p + '/'))) return false;
            if (/^\/(p|reel)\//.test(path)) return false;
            return true;
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
            this.loadLocal();
            this.setupCrossTabSync();
            this.setupDirtyListener();

            // Validate token visually on load
            if (!CloudAPI.getToken()) {
                UI.showAuthToast('GitHub Sync: Token missing. Click to add.', 'error');
            } else {
                this.fetchCloudBackground(true);
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

            // Bypasses throttle ONLY if forced, OR if there are offline changes waiting to be synced
            if (!force && !isDirty) {
                if (isFocusEvent && (now - lastFetch < CONFIG.CLOUD_FOCUS_THROTTLE_MS)) return;
                if (!isFocusEvent && (now - lastFetch < CONFIG.CLOUD_HISTORY_THROTTLE_MS)) return;
            }

            // Log fetch time to local storage so multiple tabs share the same throttle limit
            GM_setValue(CONFIG.LAST_FETCH_KEY, now);

            try {
                const cloudData = await CloudAPI.fetch();
                if (cloudData && Object.keys(cloudData).length > 0) {
                    await this._queueTask(() => this._withLock(async () => {
                        this.loadLocal(); // Refresh to latest local state before merging
                        this.mergeData(cloudData);
                    }));
                }

                // Retroactive Safety: If local changes previously failed to push, push them now
                if (isDirty) {
                    await this.pushToCloud();
                }
            } catch (e) {
                console.warn(`[IG Tracker] Background cloud sync failed:`, e);
            }
        },

        loadLocal() {
            try {
                const rawV3 = GM_getValue(CONFIG.STORAGE_KEY, null);
                if (rawV3) {
                    this.data = JSON.parse(rawV3);
                } else {
                    this.migrateFromLegacy();
                }
            } catch (e) {
                console.warn(`[IG Tracker] Corrupted storage. Resetting database.`);
                this.data = {};
            }
        },

        migrateFromLegacy() {
            const rawV2 = GM_getValue(CONFIG.LEGACY_STORAGE_KEY, '[]');
            const dataV2 = JSON.parse(rawV2);
            const migrated = {};
            const now = Date.now();
            dataV2.forEach(shortcode => {
                migrated[shortcode] = { s: true, t: now };
            });
            this.data = migrated;

            // Write synchronously (not the debounced saveLocal) so the new schema is
            // durably persisted before the old key it was migrated from is removed.
            GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(this.data));
            this.cleanupLegacyKey(CONFIG.LEGACY_STORAGE_KEY);
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
            // UNBLOCKING MAIN THREAD: Defers the heavy JSON stringify to prevent UI micro-stutters
            setTimeout(() => {
                GM_setValue(CONFIG.STORAGE_KEY, JSON.stringify(this.data));
            }, 0);
        },

        mergeData(remoteData) {
            let changed = false;
            for (const [shortcode, remoteState] of Object.entries(remoteData)) {
                const localState = this.data[shortcode];
                // Timestamp Supremacy: Always accept the newest action
                if (!localState || remoteState.t > localState.t) {
                    this.data[shortcode] = remoteState;
                    changed = true;

                    // Immediately update UI for the changed elements
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

            // Elect a Leader Tab using Mutex
            await this._withLock(async () => {
                if (Date.now() - GM_getValue(syncLockKey, 0) < 5000) {
                    // Another tab is actively handling the upload
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

                    // PULL-MERGE-PUSH TRANSACTION INSIDE LOCK QUEUE
                    const latestCloudData = await CloudAPI.fetch();
                    await this._queueTask(() => this._withLock(async () => {
                        this.loadLocal(); // Get latest offline data from all cross-tabs
                        if (latestCloudData && Object.keys(latestCloudData).length > 0) {
                            this.mergeData(latestCloudData); // Resolves multi-device conflicts instantly
                        }
                    }));

                    // Push combined master dataset
                    await CloudAPI.put(CLOUD_CONFIG.PATH, this.data);

                    // Converge immediately if new local changes landed mid-upload,
                    // instead of waiting for the next external trigger to retry
                    await this._withLock(async () => {
                        if (!GM_getValue(CONFIG.DIRTY_KEY, false)) {
                            pushing = false;
                        } else {
                            GM_setValue(syncLockKey, Date.now());
                            GM_setValue(CONFIG.DIRTY_KEY, false);
                        }
                    });
                }

                // Release Locks
                await this._withLock(async () => {
                    GM_setValue(syncLockKey, 0);
                });

                return 'synced';
            } catch (e) {
                await this._withLock(async () => {
                    GM_setValue(syncLockKey, 0);
                    GM_setValue(CONFIG.DIRTY_KEY, true); // Re-flag for retroactive sync
                });
                console.error(`[IG Tracker] Cloud push failed (will retry automatically):`, e);
                throw e;
            }
        },

        toggle(shortcode) {
            const currentState = this.data[shortcode]?.s || false;
            const newState = !currentState;

            // 1. Instantly update memory
            this.data[shortcode] = { s: newState, t: Date.now() };

            // 2. Instantly update UI for zero lag
            document.dispatchEvent(new CustomEvent(`${CONFIG.UI_PREFIX}-sync`, {
                detail: { shortcode, isSeen: newState }
            }));

            // 3. Defer local DB write & Tag network as dirty so background loops know to push
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
                .${CONFIG.UI_PREFIX}-overlay.active { opacity: 1;
                }

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
                    box-sizing: border-box;
                    align-self: center;
                    transition: transform 0.15s ease;
                    outline: none;
                    -webkit-tap-highlight-color: transparent;
                }
                .${CONFIG.UI_PREFIX}-action-btn:active {
                    transform: scale(0.9);
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
                    animation: tmToastFadeIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
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
                @keyframes tmToastFadeIn {
                    from { opacity: 0;
                    transform: translateX(20px) scale(0.95); }
                    to { opacity: 1;
                    transform: translateX(0) scale(1); }
                }
                @keyframes tmToastFadeOut {
                    from { opacity: 1;
                    transform: translateX(0) scale(1); }
                    to { opacity: 0;
                    transform: translateX(20px) scale(0.95); }
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
                    }
                    else {
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
            const toast = specificToast ||
            document.getElementById(`${CONFIG.UI_PREFIX}-auth-toast`);
            if (toast) {
                if (immediate) {
                    toast.remove();
                    return;
                }
                toast.style.animation = 'tmToastFadeOut 0.3s forwards';
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
            this.bindEvents();
            this.startScanner();
        },

        bindEvents() {
            // Smart Tab-Switching: Checks for fresh data when you return to Instagram
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    // force = false, isFocusEvent = true
                    Storage.fetchCloudBackground(false, true);
                }
            });
            // Background Idle Polling
            setInterval(() => {
                if (document.visibilityState === 'visible') {
                    // force = false, isFocusEvent = false
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

        scanGrid() {
            if (!PageContext.isProfilePage()) return;
            const links = document.querySelectorAll(`a[href*="/p/"]:not(.${CONFIG.UI_PREFIX}-processed), a[href*="/reel/"]:not(.${CONFIG.UI_PREFIX}-processed)`);

            links.forEach(link => {
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
                    if (anchor && anchor.parentElement && (anchor.parentElement.style.cursor === 'pointer' ||
                        anchor.parentElement.getAttribute('role') === 'button')) {
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
