/**
 * Password-Protected Publications & Thumbnail Admin Panel
 * Allows curating publications.bib (selected, categories, BibTeX entries),
 * discovering new publications from academic APIs, updating paper thumbnails,
 * and publishing changes directly to GitHub (sorts/sorts) or downloading locally.
 */
(function () {
    'use strict';

    // SHA-256 hash of the configured admin password
    const ADMIN_PASSWORD_HASH = 'bbf2ede9b0b1a71a1501acc1f1658757c0b83d91d27903ee67cde6a8cae6567b';
    const SESSION_UNLOCK_KEY = 'soe_admin_unlocked_v1';
    const STORAGE_ENC_GH_TOKEN = 'soe_admin_enc_gh_token_v1';
    const STORAGE_GH_REPO = 'soe_admin_gh_repo_v1';
    const DEFAULT_GH_REPO = 'sorts/sorts';
    const DEFAULT_GH_BRANCH = 'main';

    let isUnlocked = false;
    let sessionPassword = '';
    let hasBibChanges = false;
    // slug -> { slug, filename, dataUrl, base64, blob, pubTitle }
    const pendingThumbnails = new Map();

    // Admin UI filter state
    let adminSearchQuery = '';
    let adminStatusFilter = 'all'; // 'all' | 'selected' | 'unselected' | 'explicit_cat' | 'modified_thumb'
    let adminCatFilter = 'All';

    // Pure-JS SHA-256 fallback (ensures password verification works even on non-HTTPS LAN URLs)
    function sha256Fallback(ascii) {
        function rightRotate(value, amount) {
            return (value >>> amount) | (value << (32 - amount));
        }
        const mathPow = Math.pow;
        const maxWord = mathPow(2, 32);
        const lengthProperty = 'length';
        let i, j;
        let result = '';
        const words = [];
        const asciiBitLength = ascii[lengthProperty] * 8;
        let hash = sha256Fallback.h = sha256Fallback.h || [];
        const k = sha256Fallback.k = sha256Fallback.k || [];
        let primeCounter = k[lengthProperty];
        const isComposite = {};
        for (let candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (i = 0; i < 313; i += candidate) {
                    isComposite[i] = candidate;
                }
                hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
                k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
            }
        }
        ascii += '\x80';
        while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
        for (i = 0; i < ascii[lengthProperty]; i++) {
            j = ascii.charCodeAt(i);
            if (j >> 8) return '';
            words[i >> 2] |= j << ((3 - i) % 4) * 8;
        }
        words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
        words[words[lengthProperty]] = asciiBitLength;
        for (j = 0; j < words[lengthProperty];) {
            const w = words.slice(j, (j += 16));
            const oldHash = hash;
            hash = hash.slice(0, 8);
            for (i = 0; i < 64; i++) {
                const i2 = i + j;
                const w15 = w[i - 15], w2 = w[i - 2];
                const a = hash[0], e = hash[4];
                const temp1 =
                    hash[7] +
                    (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
                    ((e & hash[5]) ^ (~e & hash[6])) +
                    k[i] +
                    (w[i] =
                        i < 16
                            ? w[i]
                            : (w[i - 16] +
                                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                                  w[i - 7] +
                                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                              0);
                const temp2 =
                    (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
                    ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
                hash = [(temp1 + temp2) | 0].concat(hash);
                hash[4] = (hash[4] + temp1) | 0;
            }
            for (i = 0; i < 8; i++) {
                hash[i] = (hash[i] + oldHash[i]) | 0;
            }
        }
        for (i = 0; i < 8; i++) {
            for (j = 3; j + 1; j--) {
                const b = (hash[i] >> (j * 8)) & 255;
                result += (b < 16 ? 0 : '') + b.toString(16);
            }
        }
        return result;
    }

    async function computeSha256Hex(str) {
        if (window.crypto && window.crypto.subtle) {
            try {
                const buf = new TextEncoder().encode(str);
                const digest = await window.crypto.subtle.digest('SHA-256', buf);
                return Array.from(new Uint8Array(digest))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            } catch (_) {
                // Fall back to pure JS implementation
            }
        }
        const utf8 = unescape(encodeURIComponent(str));
        return sha256Fallback(utf8);
    }

    // Simple XOR + Base64 obfuscation with SHA-256 key stream for localStorage token persistence
    async function encryptWithPassword(plainText, password) {
        const keyHex = await computeSha256Hex('soe_salt_v1:' + password);
        const textBytes = new TextEncoder().encode(plainText);
        const out = new Uint8Array(textBytes.length);
        for (let i = 0; i < textBytes.length; i++) {
            const kByte = parseInt(keyHex.substr((i * 2) % 60, 2), 16);
            out[i] = textBytes[i] ^ kByte;
        }
        let binary = '';
        out.forEach(b => (binary += String.fromCharCode(b)));
        return btoa(binary);
    }

    async function decryptWithPassword(cipherB64, password) {
        try {
            const keyHex = await computeSha256Hex('soe_salt_v1:' + password);
            const binary = atob(cipherB64);
            const out = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                const kByte = parseInt(keyHex.substr((i * 2) % 60, 2), 16);
                out[i] = binary.charCodeAt(i) ^ kByte;
            }
            return new TextDecoder().decode(out);
        } catch (_) {
            return '';
        }
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getThumbSlug(key) {
        return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function showToast(message, type = 'info') {
        let container = document.getElementById('admin-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'admin-toast-container';
            container.className = 'admin-toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `admin-toast admin-toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('admin-toast-hide');
            setTimeout(() => toast.remove(), 300);
        }, 3800);
    }

    // =========================================================================
    // 1. PASSWORD GATE & HIDDEN TRIGGERS
    // =========================================================================
    function openPasswordGate() {
        if (isUnlocked) {
            openAdminPanel();
            return;
        }

        let modal = document.getElementById('admin-auth-modal');
        if (modal) {
            modal.classList.add('open');
            const input = modal.querySelector('#admin-password-input');
            if (input) setTimeout(() => input.focus(), 50);
            return;
        }

        modal = document.createElement('div');
        modal.id = 'admin-auth-modal';
        modal.className = 'admin-modal-overlay open';
        modal.innerHTML = `
            <div class="admin-modal admin-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-auth-title">
                <div class="admin-modal-header">
                    <h3 id="admin-auth-title">🔒 Publications Admin Access</h3>
                    <button type="button" class="admin-modal-close" id="admin-auth-close" aria-label="Close">&times;</button>
                </div>
                <form id="admin-auth-form" class="admin-modal-body">
                    <p class="admin-muted-text">Enter the administrator password to manage <code>publications.bib</code>, categories, selected papers, and thumbnails.</p>
                    <div class="admin-form-group">
                        <label for="admin-password-input">Password</label>
                        <input type="password" id="admin-password-input" class="admin-input" placeholder="Enter admin password..." autocomplete="current-password" required>
                    </div>
                    <div id="admin-auth-error" class="admin-error-msg" style="display:none;">Incorrect password. Please try again.</div>
                    <div class="admin-modal-footer">
                        <button type="button" class="admin-btn admin-btn-secondary" id="admin-auth-cancel">Cancel</button>
                        <button type="submit" class="admin-btn admin-btn-primary">Unlock Admin Panel</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => {
            modal.classList.remove('open');
            if (window.location.hash === '#admin') {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
        };

        modal.querySelector('#admin-auth-close').onclick = close;
        modal.querySelector('#admin-auth-cancel').onclick = close;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        const form = modal.querySelector('#admin-auth-form');
        const input = modal.querySelector('#admin-password-input');
        const errorEl = modal.querySelector('#admin-auth-error');

        setTimeout(() => input.focus(), 50);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pwd = input.value;
            const digest = await computeSha256Hex(pwd);
            if (digest === ADMIN_PASSWORD_HASH) {
                isUnlocked = true;
                sessionPassword = pwd;
                sessionStorage.setItem(SESSION_UNLOCK_KEY, pwd);
                errorEl.style.display = 'none';
                input.value = '';
                modal.classList.remove('open');
                openAdminPanel();
                showToast('Admin panel unlocked', 'success');
            } else {
                errorEl.style.display = 'block';
                input.select();
            }
        });
    }

    // =========================================================================
    // 2. MAIN ADMIN PANEL UI
    // =========================================================================
    function openAdminPanel() {
        let section = document.getElementById('admin-panel-section');
        if (!section) {
            section = document.createElement('section');
            section.id = 'admin-panel-section';
            section.className = 'admin-panel-section';
            const pubSection = document.getElementById('publications');
            if (pubSection && pubSection.parentNode) {
                pubSection.parentNode.insertBefore(section, pubSection);
            } else {
                document.body.prepend(section);
            }
        }
        section.style.display = 'block';
        renderAdminPanel();
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function lockAdminPanel() {
        isUnlocked = false;
        sessionPassword = '';
        sessionStorage.removeItem(SESSION_UNLOCK_KEY);
        const section = document.getElementById('admin-panel-section');
        if (section) section.style.display = 'none';
        if (window.location.hash === '#admin') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        showToast('Admin panel locked', 'info');
    }

    function markBibModified() {
        hasBibChanges = true;
        if (window.PublicationsApp) {
            window.PublicationsApp.refreshUI();
        }
        updateUnsavedBanner();
        updateAdminStats();
    }

    function updateUnsavedBanner() {
        const banner = document.getElementById('admin-unsaved-bar');
        if (!banner) return;
        const thumbCount = pendingThumbnails.size;
        if (!hasBibChanges && thumbCount === 0) {
            banner.classList.remove('visible');
            return;
        }
        banner.classList.add('visible');
        const parts = [];
        if (hasBibChanges) parts.push('publications.bib modified');
        if (thumbCount > 0) parts.push(`${thumbCount} thumbnail${thumbCount > 1 ? 's' : ''} staged`);
        const summaryEl = document.getElementById('admin-unsaved-summary');
        if (summaryEl) summaryEl.textContent = `Unsaved changes: ${parts.join(' + ')}`;
    }

    function updateAdminStats() {
        if (!window.PublicationsApp) return;
        const entries = window.PublicationsApp.getEntries();
        const selectedCount = entries.filter(e => e.isSelected).length;
        const explicitCatCount = entries.filter(e => Boolean(e.explicitCategory)).length;

        const statTotal = document.getElementById('admin-stat-total');
        const statSelected = document.getElementById('admin-stat-selected');
        const statExplicit = document.getElementById('admin-stat-explicit');
        const statThumbs = document.getElementById('admin-stat-thumbs');

        if (statTotal) statTotal.textContent = entries.length;
        if (statSelected) statSelected.textContent = selectedCount;
        if (statExplicit) statExplicit.textContent = explicitCatCount;
        if (statThumbs) statThumbs.textContent = pendingThumbnails.size;
    }

    function renderAdminPanel() {
        const section = document.getElementById('admin-panel-section');
        if (!section || !window.PublicationsApp) return;

        const entries = window.PublicationsApp.getEntries();
        const categories = window.PublicationsApp.getCategories().filter(c => c.id !== 'All');
        const selectedCount = entries.filter(e => e.isSelected).length;
        const explicitCatCount = entries.filter(e => Boolean(e.explicitCategory)).length;

        section.innerHTML = `
            <div class="container">
                <div class="admin-dashboard-card">
                    <div class="admin-header-bar">
                        <div>
                            <span class="admin-badge-pill">🔓 Admin Mode</span>
                            <h2 class="admin-title">Publications &amp; Thumbnail Manager</h2>
                        </div>
                        <div class="admin-header-actions">
                            <button type="button" class="admin-btn admin-btn-accent" id="admin-find-new-btn">
                                🔍 Find New Publications
                            </button>
                            <button type="button" class="admin-btn admin-btn-secondary" id="admin-add-entry-btn">
                                + Add BibTeX Entry
                            </button>
                            <button type="button" class="admin-btn admin-btn-secondary" id="admin-manage-cats-btn">
                                🏷️ Categories
                            </button>
                            <button type="button" class="admin-btn admin-btn-secondary" id="admin-gh-settings-btn">
                                ⚙️ GitHub Settings
                            </button>
                            <button type="button" class="admin-btn admin-btn-danger-outline" id="admin-lock-btn-top">
                                🔒 Lock
                            </button>
                        </div>
                    </div>

                    <div class="admin-stats-grid">
                        <div class="admin-stat-box">
                            <span class="admin-stat-label">Total Publications</span>
                            <strong class="admin-stat-value" id="admin-stat-total">${entries.length}</strong>
                        </div>
                        <div class="admin-stat-box">
                            <span class="admin-stat-label">Selected (★)</span>
                            <strong class="admin-stat-value" id="admin-stat-selected">${selectedCount}</strong>
                        </div>
                        <div class="admin-stat-box">
                            <span class="admin-stat-label">Pinned Categories</span>
                            <strong class="admin-stat-value" id="admin-stat-explicit">${explicitCatCount}</strong>
                        </div>
                        <div class="admin-stat-box">
                            <span class="admin-stat-label">Staged Thumbnails</span>
                            <strong class="admin-stat-value" id="admin-stat-thumbs">${pendingThumbnails.size}</strong>
                        </div>
                    </div>

                    <div class="admin-save-toolbar">
                        <div class="admin-save-left">
                            <button type="button" class="admin-btn admin-btn-primary" id="admin-publish-github-btn">
                                🚀 Publish Changes to GitHub
                            </button>
                            <button type="button" class="admin-btn admin-btn-secondary" id="admin-download-bib-btn">
                                ⬇️ Download publications.bib
                            </button>
                            <button type="button" class="admin-btn admin-btn-secondary" id="admin-download-thumbs-btn" ${pendingThumbnails.size === 0 ? 'style="display:none;"' : ''}>
                                🖼️ Download Staged Thumbnails (${pendingThumbnails.size})
                            </button>
                        </div>
                        <div id="admin-unsaved-bar" class="admin-unsaved-indicator ${hasBibChanges || pendingThumbnails.size > 0 ? 'visible' : ''}">
                            <span class="admin-unsaved-dot"></span>
                            <span id="admin-unsaved-summary">Ready</span>
                        </div>
                    </div>

                    <!-- Discovery Drawer placeholder -->
                    <div id="admin-discovery-drawer" class="admin-drawer" style="display:none;"></div>

                    <!-- Filter Bar -->
                    <div class="admin-filter-bar">
                        <input type="search" id="admin-search-input" class="admin-input admin-search-box"
                            placeholder="Filter by title, author, year, venue, or BibTeX key..."
                            value="${escapeHtml(adminSearchQuery)}">
                        <select id="admin-status-filter" class="admin-select">
                            <option value="all" ${adminStatusFilter === 'all' ? 'selected' : ''}>All Entries (${entries.length})</option>
                            <option value="selected" ${adminStatusFilter === 'selected' ? 'selected' : ''}>★ Selected Only</option>
                            <option value="unselected" ${adminStatusFilter === 'unselected' ? 'selected' : ''}>☆ Unselected Only</option>
                            <option value="explicit_cat" ${adminStatusFilter === 'explicit_cat' ? 'selected' : ''}>📌 Pinned Category</option>
                            <option value="modified_thumb" ${adminStatusFilter === 'modified_thumb' ? 'selected' : ''}>🖼️ Staged Thumbnail</option>
                        </select>
                        <select id="admin-cat-filter" class="admin-select">
                            <option value="All" ${adminCatFilter === 'All' ? 'selected' : ''}>All Categories</option>
                            ${categories.map(c => `<option value="${escapeHtml(c.id)}" ${adminCatFilter === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
                        </select>
                    </div>

                    <div id="admin-table-count" class="admin-table-count"></div>
                    <div id="admin-pub-list" class="admin-pub-list"></div>
                </div>
            </div>
        `;

        // Bind toolbar actions
        document.getElementById('admin-lock-btn-top').onclick = lockAdminPanel;
        document.getElementById('admin-find-new-btn').onclick = toggleDiscoveryDrawer;
        document.getElementById('admin-add-entry-btn').onclick = () => openEditEntryModal(null);
        document.getElementById('admin-manage-cats-btn').onclick = openCategoriesModal;
        document.getElementById('admin-gh-settings-btn').onclick = openGitHubSettingsModal;
        document.getElementById('admin-publish-github-btn').onclick = publishToGitHub;
        document.getElementById('admin-download-bib-btn').onclick = downloadBibFile;
        document.getElementById('admin-download-thumbs-btn').onclick = downloadAllStagedThumbnails;

        const searchEl = document.getElementById('admin-search-input');
        const statusEl = document.getElementById('admin-status-filter');
        const catEl = document.getElementById('admin-cat-filter');

        searchEl.addEventListener('input', (e) => {
            adminSearchQuery = e.target.value;
            renderAdminTableRows();
        });
        statusEl.addEventListener('change', (e) => {
            adminStatusFilter = e.target.value;
            renderAdminTableRows();
        });
        catEl.addEventListener('change', (e) => {
            adminCatFilter = e.target.value;
            renderAdminTableRows();
        });

        updateUnsavedBanner();
        renderAdminTableRows();
    }

    function renderAdminTableRows() {
        const listEl = document.getElementById('admin-pub-list');
        const countEl = document.getElementById('admin-table-count');
        if (!listEl || !window.PublicationsApp) return;

        const entries = window.PublicationsApp.getEntries();
        const categories = window.PublicationsApp.getCategories().filter(c => c.id !== 'All');
        const q = adminSearchQuery.trim().toLowerCase();

        const filtered = entries.filter(pub => {
            const slug = getThumbSlug(pub.key);
            if (adminStatusFilter === 'selected' && !pub.isSelected) return false;
            if (adminStatusFilter === 'unselected' && pub.isSelected) return false;
            if (adminStatusFilter === 'explicit_cat' && !pub.explicitCategory) return false;
            if (adminStatusFilter === 'modified_thumb' && !pendingThumbnails.has(slug)) return false;
            if (adminCatFilter !== 'All' && (!pub.category || pub.category.id !== adminCatFilter)) return false;

            if (q) {
                const hay = `${pub.title} ${pub.author} ${pub.venue} ${pub.year} ${pub.key}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        if (countEl) {
            countEl.textContent = `Showing ${filtered.length} of ${entries.length} publications`;
        }

        listEl.innerHTML = '';
        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="admin-empty-state">No publications match the current filter.</div>`;
            return;
        }

        filtered.forEach(pub => {
            const slug = getThumbSlug(pub.key);
            const row = document.createElement('div');
            row.className = `admin-pub-row ${pub.isSelected ? 'is-selected' : ''}`;

            const autoCat = window.PublicationsApp.getCategoryInfo(pub.title, pub.venue, '');
            const thumbSrc = pendingThumbnails.has(slug)
                ? pendingThumbnails.get(slug).dataUrl
                : `publications/thumbs/${slug}.jpg`;

            row.innerHTML = `
                <div class="admin-row-thumb-wrap" title="Click to update thumbnail">
                    <img src="${thumbSrc}" alt="Thumb" class="admin-row-thumb" loading="lazy">
                    ${pendingThumbnails.has(slug) ? '<span class="admin-thumb-staged-badge">NEW</span>' : ''}
                    <button type="button" class="admin-thumb-overlay-btn">🖼️ Edit</button>
                </div>

                <div class="admin-row-main">
                    <div class="admin-row-title-line">
                        <span class="admin-year-pill">${escapeHtml(pub.year || 'N/A')}</span>
                        <strong class="admin-row-title">${escapeHtml(pub.title)}</strong>
                    </div>
                    <div class="admin-row-authors">${escapeHtml(pub.author)}</div>
                    <div class="admin-row-venue">
                        <code>${escapeHtml(pub.key)}</code>
                        ${pub.venue ? ` &bull; <span>${escapeHtml(pub.venue)}</span>` : ''}
                    </div>
                </div>

                <div class="admin-row-controls">
                    <button type="button" class="admin-star-btn ${pub.isSelected ? 'active' : ''}"
                        title="${pub.isSelected ? 'Selected publication (click to unselect)' : 'Click to mark as Selected publication'}">
                        ${pub.isSelected ? '★ Selected' : '☆ Select'}
                    </button>

                    <div class="admin-cat-select-wrap">
                        <select class="admin-select admin-row-cat-select" title="Assign topic category">
                            <option value="" ${!pub.explicitCategory ? 'selected' : ''}>
                                Auto (${escapeHtml(autoCat ? autoCat.label : 'CV')})
                            </option>
                            ${categories.map(c => `
                                <option value="${escapeHtml(c.id)}" ${pub.explicitCategory === c.id ? 'selected' : ''}>
                                    📌 ${escapeHtml(c.label)}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="admin-row-btn-group">
                        <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary admin-row-thumb-btn" title="Update thumbnail image">
                            🖼️ Thumbnail
                        </button>
                        <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary admin-row-edit-btn" title="Edit BibTeX & metadata">
                            ✏️ Edit
                        </button>
                    </div>
                </div>
            `;

            const imgEl = row.querySelector('.admin-row-thumb');
            imgEl.onerror = () => {
                imgEl.onerror = null;
                imgEl.src = (pub.category && pub.category.image) || 'publications/images/cat_cv.png';
            };

            // Toggle Selected
            const starBtn = row.querySelector('.admin-star-btn');
            starBtn.onclick = () => {
                pub.isSelected = !pub.isSelected;
                pub.selected = pub.isSelected ? 'true' : '';
                row.classList.toggle('is-selected', pub.isSelected);
                starBtn.classList.toggle('active', pub.isSelected);
                starBtn.textContent = pub.isSelected ? '★ Selected' : '☆ Select';
                markBibModified();
            };

            // Change Category
            const catSelect = row.querySelector('.admin-row-cat-select');
            catSelect.onchange = (e) => {
                pub.explicitCategory = e.target.value;
                pub.category = window.PublicationsApp.getCategoryInfo(pub.title, pub.venue, pub.explicitCategory);
                markBibModified();
            };

            // Open Thumbnail Studio
            row.querySelector('.admin-row-thumb-wrap').onclick = () => openThumbnailStudioModal(pub);
            row.querySelector('.admin-row-thumb-btn').onclick = () => openThumbnailStudioModal(pub);

            // Open Edit BibTeX Modal
            row.querySelector('.admin-row-edit-btn').onclick = () => openEditEntryModal(pub);

            listEl.appendChild(row);
        });
    }

    // =========================================================================
    // 3. FIND NEW PUBLICATIONS (SCHOLARLY API DISCOVERY + DOI/ARXIV LOOKUP)
    // =========================================================================
    function toggleDiscoveryDrawer() {
        const drawer = document.getElementById('admin-discovery-drawer');
        if (!drawer) return;
        if (drawer.style.display === 'none') {
            drawer.style.display = 'block';
            renderDiscoveryDrawer();
            runPublicationDiscoveryScan();
        } else {
            drawer.style.display = 'none';
        }
    }

    function renderDiscoveryDrawer() {
        const drawer = document.getElementById('admin-discovery-drawer');
        if (!drawer) return;
        drawer.innerHTML = `
            <div class="admin-drawer-header">
                <div>
                    <h3>🔍 Discover &amp; Import New Publications</h3>
                    <p class="admin-muted-text">Scans OpenAlex, Semantic Scholar, and Crossref for papers by <strong>Sergio Orts-Escolano</strong> not yet in <code>publications.bib</code>, or import any paper directly by DOI / arXiv ID / title.</p>
                </div>
                <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" id="admin-close-discovery">Close &times;</button>
            </div>

            <div class="admin-discovery-lookup-bar">
                <input type="text" id="admin-direct-lookup-input" class="admin-input"
                    placeholder="Lookup specific paper by DOI (10.1109/...), arXiv ID (2503.12345), or Title...">
                <button type="button" class="admin-btn admin-btn-secondary" id="admin-direct-lookup-btn">
                    🔎 Search Paper
                </button>
                <button type="button" class="admin-btn admin-btn-accent" id="admin-rescan-author-btn">
                    🔄 Re-scan Author Profile
                </button>
            </div>

            <div id="admin-discovery-status" class="admin-discovery-status">Initializing scan...</div>
            <div id="admin-discovery-results" class="admin-discovery-results"></div>
        `;

        document.getElementById('admin-close-discovery').onclick = () => {
            drawer.style.display = 'none';
        };
        document.getElementById('admin-rescan-author-btn').onclick = () => runPublicationDiscoveryScan();
        document.getElementById('admin-direct-lookup-btn').onclick = () => {
            const q = document.getElementById('admin-direct-lookup-input').value.trim();
            if (q) runDirectPaperLookup(q);
        };
        document.getElementById('admin-direct-lookup-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = e.target.value.trim();
                if (q) runDirectPaperLookup(q);
            }
        });
    }

    function normalizeTitleForComparison(title) {
        return String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function isAlreadyInBib(candidate, existingEntries) {
        const normCandTitle = normalizeTitleForComparison(candidate.title);
        if (!normCandTitle || normCandTitle.length < 6) return true;

        // Exclude known geology papers by namesake "Santiago Orts"
        if (/\b(geolog|andes|tectonic|stratigraph|patagoni|paleomagnet|jurassic|cretaceous|thrust|orogen|sediment)\b/i.test(`${candidate.title} ${candidate.venue}`)) {
            return true;
        }

        const candDoi = String(candidate.doi || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
        const candArxiv = String(candidate.eprint || '').toLowerCase().replace(/^arxiv:/i, '').trim();

        for (const entry of existingEntries) {
            const normExisting = normalizeTitleForComparison(entry.title);
            if (normExisting === normCandTitle) return true;
            if (normExisting.length > 18 && normCandTitle.length > 18) {
                if (normExisting.includes(normCandTitle) || normCandTitle.includes(normExisting)) return true;
            }
            if (candDoi && entry.doi && entry.doi.toLowerCase().trim() === candDoi) return true;
            if (candArxiv && entry.eprint && entry.eprint.toLowerCase().trim() === candArxiv) return true;
        }
        return false;
    }

    function makeCandidateBibEntry(cand) {
        const firstAuthorLast = (cand.authors && cand.authors[0] ? cand.authors[0].split(/\s+/).pop() : 'Orts').replace(/[^a-zA-Z]/g, '');
        const year = String(cand.year || new Date().getFullYear());
        const firstWord = String(cand.title || 'Paper').split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, '');
        const key = `DISC:${firstAuthorLast}${year}${firstWord}`;
        const authorStr = (cand.authors && cand.authors.length > 0) ? cand.authors.join(' and ') : 'Sergio Orts-Escolano';
        const isConf = /\b(conference|proceedings|cvpr|iccv|eccv|siggraph|chi|ijcnn|3dv|icra|iros|neurips|icml|iclr|uist|ismar|vr)\b/i.test(cand.venue || '');
        const type = isConf ? 'inproceedings' : 'article';
        const entry = {
            type,
            key,
            author: authorStr,
            title: cand.title,
            year,
            doi: cand.doi || '',
            url: cand.url || (cand.doi ? `https://doi.org/${cand.doi}` : ''),
            eprint: cand.eprint || '',
            venue: cand.venue || 'Preprint',
            explicitCategory: '',
            isSelected: false,
            _fieldsEdited: true
        };
        if (isConf) {
            entry.booktitle = cand.venue || 'Proceedings';
        } else {
            entry.journal = cand.venue || 'CoRR';
        }
        entry.category = window.PublicationsApp.getCategoryInfo(entry.title, entry.venue, '');
        entry.rawBlock = window.PublicationsApp.buildEntryBlock(entry);
        return entry;
    }

    async function runPublicationDiscoveryScan() {
        const statusEl = document.getElementById('admin-discovery-status');
        const resultsEl = document.getElementById('admin-discovery-results');
        if (!statusEl || !resultsEl || !window.PublicationsApp) return;

        statusEl.textContent = '⏳ Querying OpenAlex, Semantic Scholar, and Crossref for Sergio Orts-Escolano...';
        resultsEl.innerHTML = '';

        const existingEntries = window.PublicationsApp.getEntries();
        const discoveredMap = new Map();

        const addCandidate = (cand) => {
            if (!cand || !cand.title) return;
            // Verify Sergio Orts is among authors if authors list is present
            if (Array.isArray(cand.authors) && cand.authors.length > 0) {
                const hasSergio = cand.authors.some(a => /\borts\b/i.test(a));
                if (!hasSergio) return;
            }
            if (isAlreadyInBib(cand, existingEntries)) return;
            const norm = normalizeTitleForComparison(cand.title);
            if (!discoveredMap.has(norm)) {
                discoveredMap.set(norm, makeCandidateBibEntry(cand));
            }
        };

        const tasks = [];

        // 1. OpenAlex API
        tasks.push(
            fetch('https://api.openalex.org/works?filter=raw_author_name.search:Sergio%20Orts-Escolano&per-page=100&sort=publication_year:desc')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (!data || !Array.isArray(data.results)) return;
                    data.results.forEach(w => {
                        const authors = (w.authorships || []).map(a => a.author && a.author.display_name).filter(Boolean);
                        const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : '';
                        const venue = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '';
                        addCandidate({
                            title: w.title || w.display_name,
                            authors,
                            year: w.publication_year,
                            venue,
                            doi,
                            url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || ''
                        });
                    });
                })
                .catch(() => {})
        );

        // 2. Semantic Scholar search
        tasks.push(
            fetch('https://api.semanticscholar.org/graph/v1/paper/search?query=Sergio+Orts-Escolano&limit=100&fields=title,authors,year,venue,externalIds,url')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (!data || !Array.isArray(data.data)) return;
                    data.data.forEach(p => {
                        const authors = (p.authors || []).map(a => a.name).filter(Boolean);
                        const ext = p.externalIds || {};
                        addCandidate({
                            title: p.title,
                            authors,
                            year: p.year,
                            venue: p.venue || '',
                            doi: ext.DOI || '',
                            eprint: ext.ArXiv || '',
                            url: p.url || ''
                        });
                    });
                })
                .catch(() => {})
        );

        // 3. Crossref API
        tasks.push(
            fetch('https://api.crossref.org/works?query.author=Sergio+Orts+Escolano&rows=80')
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    const items = data && data.message && data.message.items;
                    if (!Array.isArray(items)) return;
                    items.forEach(item => {
                        const title = Array.isArray(item.title) ? item.title[0] : item.title;
                        const authors = (item.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean);
                        const year = (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0] && item.issued['date-parts'][0][0]) || '';
                        const venue = (Array.isArray(item['container-title']) ? item['container-title'][0] : item['container-title']) || '';
                        addCandidate({
                            title,
                            authors,
                            year,
                            venue,
                            doi: item.DOI || '',
                            url: item.URL || ''
                        });
                    });
                })
                .catch(() => {})
        );

        await Promise.allSettled(tasks);

        const candidates = Array.from(discoveredMap.values()).sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
        renderDiscoveryCandidates(candidates, statusEl, resultsEl, `Scan complete across OpenAlex, Semantic Scholar & Crossref (compared against ${existingEntries.length} existing entries).`);
    }

    async function runDirectPaperLookup(query) {
        const statusEl = document.getElementById('admin-discovery-status');
        const resultsEl = document.getElementById('admin-discovery-results');
        if (!statusEl || !resultsEl) return;

        statusEl.textContent = `⏳ Searching for "${query}"...`;
        resultsEl.innerHTML = '';

        const candidates = [];
        try {
            const resp = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=10`);
            if (resp.ok) {
                const data = await resp.json();
                (data.results || []).forEach(w => {
                    const authors = (w.authorships || []).map(a => a.author && a.author.display_name).filter(Boolean);
                    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : '';
                    const venue = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '';
                    candidates.push(makeCandidateBibEntry({
                        title: w.title || w.display_name,
                        authors,
                        year: w.publication_year,
                        venue,
                        doi,
                        url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || ''
                    }));
                });
            }
        } catch (_) {}

        renderDiscoveryCandidates(candidates, statusEl, resultsEl, `Found ${candidates.length} matching result(s) for "${query}".`);
    }

    function renderDiscoveryCandidates(candidates, statusEl, resultsEl, statusMsg) {
        if (candidates.length === 0) {
            statusEl.textContent = `✅ ${statusMsg} All discovered publications are already present in publications.bib!`;
            resultsEl.innerHTML = `<div class="admin-empty-state">No missing publications found. You can also search for a specific DOI, arXiv ID, or paper title above.</div>`;
            return;
        }

        statusEl.textContent = `✨ ${statusMsg} Found ${candidates.length} candidate paper(s):`;
        const categories = window.PublicationsApp.getCategories().filter(c => c.id !== 'All');

        resultsEl.innerHTML = '';
        candidates.forEach(cand => {
            const card = document.createElement('div');
            card.className = 'admin-candidate-card';
            card.innerHTML = `
                <div class="admin-candidate-info">
                    <div>
                        <span class="admin-year-pill">${escapeHtml(cand.year)}</span>
                        <strong>${escapeHtml(cand.title)}</strong>
                    </div>
                    <div class="admin-row-authors">${escapeHtml(cand.author)}</div>
                    <div class="admin-row-venue">${escapeHtml(cand.venue)} ${cand.doi ? `&bull; DOI: ${escapeHtml(cand.doi)}` : ''}</div>
                </div>
                <div class="admin-candidate-actions">
                    <label class="admin-checkbox-label">
                        <input type="checkbox" class="cand-selected-chk"> ★ Selected
                    </label>
                    <select class="admin-select cand-cat-select">
                        ${categories.map(c => `<option value="${escapeHtml(c.id)}" ${cand.category && cand.category.id === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
                    </select>
                    <button type="button" class="admin-btn admin-btn-sm admin-btn-primary cand-import-btn">
                        + Add to publications.bib
                    </button>
                </div>
            `;

            const chk = card.querySelector('.cand-selected-chk');
            const catSel = card.querySelector('.cand-cat-select');
            const importBtn = card.querySelector('.cand-import-btn');

            importBtn.onclick = () => {
                cand.isSelected = chk.checked;
                cand.selected = cand.isSelected ? 'true' : '';
                cand.explicitCategory = catSel.value;
                cand.category = window.PublicationsApp.getCategoryInfo(cand.title, cand.venue, cand.explicitCategory);
                cand.rawBlock = window.PublicationsApp.buildEntryBlock(cand);

                const entries = window.PublicationsApp.getEntries();
                entries.unshift(cand);
                window.PublicationsApp.setEntries(entries);
                markBibModified();
                renderAdminTableRows();

                importBtn.disabled = true;
                importBtn.textContent = '✓ Added';
                card.classList.add('imported');
                showToast(`Added "${cand.title.slice(0, 45)}..."`, 'success');
            };

            resultsEl.appendChild(card);
        });
    }

    // =========================================================================
    // 4. EDIT / ADD BIBTEX ENTRY MODAL
    // =========================================================================
    function openEditEntryModal(existingPub) {
        const isNew = !existingPub;
        const pub = existingPub || {
            type: 'article',
            key: `DBLP:conf/cvpr/Orts${new Date().getFullYear()}`,
            title: '',
            author: 'Sergio Orts-Escolano',
            year: String(new Date().getFullYear()),
            journal: '',
            booktitle: '',
            doi: '',
            url: '',
            eprint: '',
            explicitCategory: '',
            isSelected: false
        };

        const categories = window.PublicationsApp.getCategories().filter(c => c.id !== 'All');
        const currentBibBlock = existingPub
            ? window.PublicationsApp.buildEntryBlock(existingPub)
            : window.PublicationsApp.buildEntryBlock(pub);

        let modal = document.getElementById('admin-edit-entry-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'admin-edit-entry-modal';
        modal.className = 'admin-modal-overlay open';
        modal.innerHTML = `
            <div class="admin-modal admin-modal-lg" role="dialog" aria-modal="true">
                <div class="admin-modal-header">
                    <h3>${isNew ? '➕ Add New Publication' : `✏️ Edit Publication (${escapeHtml(pub.key)})`}</h3>
                    <button type="button" class="admin-modal-close" id="edit-modal-close">&times;</button>
                </div>
                <div class="admin-modal-body">
                    <div class="admin-form-row-2">
                        <div class="admin-form-group">
                            <label>BibTeX Key</label>
                            <input type="text" id="edit-pub-key" class="admin-input" value="${escapeHtml(pub.key)}">
                        </div>
                        <div class="admin-form-group">
                            <label>Entry Type</label>
                            <select id="edit-pub-type" class="admin-select">
                                <option value="article" ${pub.type === 'article' ? 'selected' : ''}>@article</option>
                                <option value="inproceedings" ${pub.type === 'inproceedings' ? 'selected' : ''}>@inproceedings</option>
                                <option value="incollection" ${pub.type === 'incollection' ? 'selected' : ''}>@incollection</option>
                                <option value="book" ${pub.type === 'book' ? 'selected' : ''}>@book</option>
                                <option value="techreport" ${pub.type === 'techreport' ? 'selected' : ''}>@techreport</option>
                            </select>
                        </div>
                    </div>

                    <div class="admin-form-group">
                        <label>Title</label>
                        <input type="text" id="edit-pub-title" class="admin-input" value="${escapeHtml(pub.title)}">
                    </div>

                    <div class="admin-form-group">
                        <label>Authors (separated by <code>and</code>)</label>
                        <input type="text" id="edit-pub-author" class="admin-input" value="${escapeHtml(pub.author)}">
                    </div>

                    <div class="admin-form-row-3">
                        <div class="admin-form-group">
                            <label>Year</label>
                            <input type="text" id="edit-pub-year" class="admin-input" value="${escapeHtml(pub.year || '')}">
                        </div>
                        <div class="admin-form-group">
                            <label>Category</label>
                            <select id="edit-pub-category" class="admin-select">
                                <option value="" ${!pub.explicitCategory ? 'selected' : ''}>Auto-detect from title/venue</option>
                                ${categories.map(c => `<option value="${escapeHtml(c.id)}" ${pub.explicitCategory === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="admin-form-group">
                            <label>Selected Highlight</label>
                            <label class="admin-checkbox-box">
                                <input type="checkbox" id="edit-pub-selected" ${pub.isSelected ? 'checked' : ''}>
                                Mark as Selected (★)
                            </label>
                        </div>
                    </div>

                    <div class="admin-form-row-2">
                        <div class="admin-form-group">
                            <label>Journal (for @article)</label>
                            <input type="text" id="edit-pub-journal" class="admin-input" value="${escapeHtml(pub.journal || '')}">
                        </div>
                        <div class="admin-form-group">
                            <label>Booktitle / Conference (for @inproceedings)</label>
                            <input type="text" id="edit-pub-booktitle" class="admin-input" value="${escapeHtml(pub.booktitle || '')}">
                        </div>
                    </div>

                    <div class="admin-form-row-3">
                        <div class="admin-form-group">
                            <label>DOI</label>
                            <input type="text" id="edit-pub-doi" class="admin-input" value="${escapeHtml(pub.doi || '')}">
                        </div>
                        <div class="admin-form-group">
                            <label>URL</label>
                            <input type="text" id="edit-pub-url" class="admin-input" value="${escapeHtml(pub.url || '')}">
                        </div>
                        <div class="admin-form-group">
                            <label>arXiv ID (eprint)</label>
                            <input type="text" id="edit-pub-eprint" class="admin-input" value="${escapeHtml(pub.eprint || '')}">
                        </div>
                    </div>

                    <details class="admin-raw-bib-details">
                        <summary>Or paste / edit raw BibTeX block directly</summary>
                        <textarea id="edit-pub-raw-bib" class="admin-textarea" rows="8">${escapeHtml(currentBibBlock)}</textarea>
                        <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" id="edit-parse-raw-btn" style="margin-top:0.5rem;">
                            ↻ Parse Raw BibTeX into Fields Above
                        </button>
                    </details>
                </div>
                <div class="admin-modal-footer">
                    ${!isNew ? '<button type="button" class="admin-btn admin-btn-danger-outline" id="edit-delete-btn" style="margin-right:auto;">🗑️ Delete Entry</button>' : ''}
                    <button type="button" class="admin-btn admin-btn-secondary" id="edit-cancel-btn">Cancel</button>
                    <button type="button" class="admin-btn admin-btn-primary" id="edit-save-btn">${isNew ? 'Add Publication' : 'Save Changes'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#edit-modal-close').onclick = close;
        modal.querySelector('#edit-cancel-btn').onclick = close;

        modal.querySelector('#edit-parse-raw-btn').onclick = () => {
            const rawText = modal.querySelector('#edit-pub-raw-bib').value;
            const parsed = window.PublicationsApp.parseBibtex(rawText);
            if (parsed.length > 0) {
                const p = parsed[0];
                modal.querySelector('#edit-pub-key').value = p.key || '';
                modal.querySelector('#edit-pub-type').value = p.type || 'article';
                modal.querySelector('#edit-pub-title').value = p.title || '';
                modal.querySelector('#edit-pub-author').value = p.author || '';
                modal.querySelector('#edit-pub-year').value = p.year || '';
                modal.querySelector('#edit-pub-journal').value = p.journal || '';
                modal.querySelector('#edit-pub-booktitle').value = p.booktitle || '';
                modal.querySelector('#edit-pub-doi').value = p.doi || '';
                modal.querySelector('#edit-pub-url').value = p.url || '';
                modal.querySelector('#edit-pub-eprint').value = p.eprint || '';
                showToast('Parsed BibTeX fields', 'info');
            } else {
                showToast('Could not parse raw BibTeX block. Ensure it has @type{key, ...}', 'error');
            }
        };

        if (!isNew) {
            modal.querySelector('#edit-delete-btn').onclick = () => {
                if (confirm(`Remove "${pub.title}" from publications.bib?`)) {
                    const entries = window.PublicationsApp.getEntries().filter(e => e !== existingPub);
                    window.PublicationsApp.setEntries(entries);
                    markBibModified();
                    renderAdminTableRows();
                    close();
                    showToast('Publication removed', 'info');
                }
            };
        }

        modal.querySelector('#edit-save-btn').onclick = () => {
            const title = modal.querySelector('#edit-pub-title').value.trim();
            const author = modal.querySelector('#edit-pub-author').value.trim();
            if (!title || !author) {
                showToast('Title and Author are required', 'error');
                return;
            }
            pub.key = modal.querySelector('#edit-pub-key').value.trim() || `Orts${Date.now()}`;
            pub.type = modal.querySelector('#edit-pub-type').value;
            pub.title = title;
            pub.author = author;
            pub.year = modal.querySelector('#edit-pub-year').value.trim();
            pub.explicitCategory = modal.querySelector('#edit-pub-category').value;
            pub.isSelected = modal.querySelector('#edit-pub-selected').checked;
            pub.selected = pub.isSelected ? 'true' : '';
            pub.journal = modal.querySelector('#edit-pub-journal').value.trim();
            pub.booktitle = modal.querySelector('#edit-pub-booktitle').value.trim();
            pub.doi = modal.querySelector('#edit-pub-doi').value.trim();
            pub.url = modal.querySelector('#edit-pub-url').value.trim();
            pub.eprint = modal.querySelector('#edit-pub-eprint').value.trim();
            pub._fieldsEdited = true;
            pub.rawBlock = window.PublicationsApp.buildEntryBlock(pub);

            const entries = window.PublicationsApp.getEntries();
            if (isNew) {
                entries.unshift(pub);
            }
            window.PublicationsApp.setEntries(entries);
            markBibModified();
            renderAdminTableRows();
            close();
            showToast(isNew ? 'New publication added' : 'Publication updated', 'success');
        };
    }

    // =========================================================================
    // 5. MANAGE CATEGORIES MODAL
    // =========================================================================
    function openCategoriesModal() {
        const categories = window.PublicationsApp.getCategories()
            .filter(c => c.id !== 'All')
            .map(c => ({ ...c }));

        let modal = document.getElementById('admin-categories-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'admin-categories-modal';
        modal.className = 'admin-modal-overlay open';
        modal.innerHTML = `
            <div class="admin-modal admin-modal-lg" role="dialog" aria-modal="true">
                <div class="admin-modal-header">
                    <h3>🏷️ Manage Topic Categories</h3>
                    <button type="button" class="admin-modal-close" id="cat-modal-close">&times;</button>
                </div>
                <div class="admin-modal-body">
                    <p class="admin-muted-text">Customize category labels, fallback icons, or add new topic categories. Changes are saved inside <code>publications.bib</code>.</p>
                    <div id="admin-cat-editor-list" class="admin-cat-editor-list"></div>
                    <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" id="admin-add-cat-row-btn" style="margin-top:0.75rem;">
                        + Add Category
                    </button>
                </div>
                <div class="admin-modal-footer">
                    <button type="button" class="admin-btn admin-btn-secondary" id="cat-reset-defaults-btn" style="margin-right:auto;">Reset to Defaults</button>
                    <button type="button" class="admin-btn admin-btn-secondary" id="cat-cancel-btn">Cancel</button>
                    <button type="button" class="admin-btn admin-btn-primary" id="cat-save-btn">Save Categories</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const listEl = modal.querySelector('#admin-cat-editor-list');

        const renderRows = () => {
            listEl.innerHTML = '';
            categories.forEach((cat, idx) => {
                const row = document.createElement('div');
                row.className = 'admin-cat-edit-row';
                row.innerHTML = `
                    <input type="text" class="admin-input cat-id-input" placeholder="ID (e.g. genai)" value="${escapeHtml(cat.id)}" style="width:130px;">
                    <input type="text" class="admin-input cat-label-input" placeholder="Display Label" value="${escapeHtml(cat.label)}" style="flex:1;">
                    <input type="text" class="admin-input cat-img-input" placeholder="Fallback Image Path" value="${escapeHtml(cat.image || 'publications/images/cat_cv.png')}" style="flex:1;">
                    <button type="button" class="admin-btn admin-btn-sm admin-btn-danger-outline cat-del-btn" title="Remove category">&times;</button>
                `;
                row.querySelector('.cat-id-input').oninput = (e) => { cat.id = e.target.value.trim(); };
                row.querySelector('.cat-label-input').oninput = (e) => { cat.label = e.target.value; };
                row.querySelector('.cat-img-input').oninput = (e) => { cat.image = e.target.value.trim(); };
                row.querySelector('.cat-del-btn').onclick = () => {
                    if (categories.length <= 1) return;
                    categories.splice(idx, 1);
                    renderRows();
                };
                listEl.appendChild(row);
            });
        };

        renderRows();

        modal.querySelector('#admin-add-cat-row-btn').onclick = () => {
            categories.push({
                id: `topic_${categories.length + 1}`,
                label: 'New Topic',
                image: 'publications/images/cat_cv.png'
            });
            renderRows();
        };

        const close = () => modal.remove();
        modal.querySelector('#cat-modal-close').onclick = close;
        modal.querySelector('#cat-cancel-btn').onclick = close;

        modal.querySelector('#cat-reset-defaults-btn').onclick = () => {
            const defaults = window.PublicationsApp.getDefaultCategories().filter(c => c.id !== 'All');
            categories.length = 0;
            defaults.forEach(d => categories.push({ ...d }));
            renderRows();
        };

        modal.querySelector('#cat-save-btn').onclick = () => {
            const valid = categories.filter(c => c.id && c.label);
            window.PublicationsApp.setCategories([{ id: 'All', label: 'All Topics' }, ...valid]);
            markBibModified();
            renderAdminPanel();
            close();
            showToast('Categories updated', 'success');
        };
    }

    // =========================================================================
    // 6. THUMBNAIL STUDIO MODAL (UPLOAD / PASTE / PDF.JS / CROP / AUTO-CARD)
    // =========================================================================
    let pdfJsLoadedPromise = null;
    function ensurePdfJsLoaded() {
        if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
        if (pdfJsLoadedPromise) return pdfJsLoadedPromise;
        pdfJsLoadedPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.onload = () => {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    resolve(window.pdfjsLib);
                } else {
                    reject(new Error('PDF.js failed to initialize'));
                }
            };
            script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
            document.head.appendChild(script);
        });
        return pdfJsLoadedPromise;
    }

    function openThumbnailStudioModal(pub) {
        const slug = getThumbSlug(pub.key);
        const targetPath = `publications/thumbs/${slug}.jpg`;

        let modal = document.getElementById('admin-thumb-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'admin-thumb-modal';
        modal.className = 'admin-modal-overlay open';
        modal.innerHTML = `
            <div class="admin-modal admin-modal-xl" role="dialog" aria-modal="true">
                <div class="admin-modal-header">
                    <div>
                        <h3>🖼️ Update Thumbnail: ${escapeHtml(pub.title)}</h3>
                        <p class="admin-muted-text">Target file: <code>${escapeHtml(targetPath)}</code> &bull; Tip: Press <kbd>Ctrl+V</kbd> anywhere to paste an image from clipboard</p>
                    </div>
                    <button type="button" class="admin-modal-close" id="thumb-modal-close">&times;</button>
                </div>
                <div class="admin-modal-body">
                    <div class="admin-thumb-studio-toolbar">
                        <label class="admin-btn admin-btn-secondary" style="cursor:pointer;">
                            📁 Upload Image / PDF
                            <input type="file" id="thumb-file-input" accept="image/*,application/pdf" style="display:none;">
                        </label>
                        <button type="button" class="admin-btn admin-btn-secondary" id="thumb-generate-card-btn">
                            ✨ Auto-Generate Paper Card
                        </button>
                        <div class="admin-pdf-controls" id="thumb-pdf-controls" style="display:none;">
                            <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" id="thumb-pdf-prev">&larr; Prev Page</button>
                            <span id="thumb-pdf-page-info">Page 1 / 1</span>
                            <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" id="thumb-pdf-next">Next Page &rarr;</button>
                        </div>
                        <button type="button" class="admin-btn admin-btn-sm admin-btn-secondary" id="thumb-reset-crop-btn" style="margin-left:auto;">
                            ⛶ Select Full Image
                        </button>
                    </div>

                    <div class="admin-thumb-workspace">
                        <div class="admin-crop-stage-wrap">
                            <div class="admin-crop-instructions">Drag on the source canvas below to crop any figure region:</div>
                            <div class="admin-crop-canvas-container">
                                <canvas id="thumb-source-canvas" width="600" height="420"></canvas>
                            </div>
                        </div>

                        <div class="admin-thumb-preview-column">
                            <div class="admin-preview-label">Final Thumbnail Preview (300&times;300 JPG)</div>
                            <canvas id="thumb-output-canvas" width="300" height="300" class="admin-thumb-output-canvas"></canvas>
                            <div class="admin-form-group" style="margin-top:0.75rem;width:100%;">
                                <label>Fit Mode</label>
                                <select id="thumb-fit-mode" class="admin-select">
                                    <option value="cover">Cover (Fill square crop)</option>
                                    <option value="contain">Contain (Pad with white background)</option>
                                </select>
                            </div>
                            <button type="button" class="admin-btn admin-btn-secondary admin-btn-sm" id="thumb-download-single-btn" style="width:100%;margin-top:0.5rem;">
                                ⬇️ Download ${escapeHtml(slug)}.jpg
                            </button>
                        </div>
                    </div>
                </div>
                <div class="admin-modal-footer">
                    <button type="button" class="admin-btn admin-btn-secondary" id="thumb-cancel-btn">Cancel</button>
                    <button type="button" class="admin-btn admin-btn-primary" id="thumb-apply-btn">✓ Stage Thumbnail Update</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const sourceCanvas = modal.querySelector('#thumb-source-canvas');
        const sourceCtx = sourceCanvas.getContext('2d');
        const outputCanvas = modal.querySelector('#thumb-output-canvas');
        const outputCtx = outputCanvas.getContext('2d');
        const fitModeSelect = modal.querySelector('#thumb-fit-mode');

        let sourceImage = new Image();
        sourceImage.crossOrigin = 'anonymous';
        let cropRect = null; // { x, y, w, h } in sourceCanvas coordinates
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let pdfDoc = null;
        let pdfPageNum = 1;

        function drawSourceAndCrop() {
            sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
            sourceCtx.fillStyle = '#f8fafc';
            sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);

            if (sourceImage && sourceImage.width > 0) {
                sourceCtx.drawImage(sourceImage, 0, 0, sourceCanvas.width, sourceCanvas.height);
            }

            if (cropRect && cropRect.w > 4 && cropRect.h > 4) {
                sourceCtx.fillStyle = 'rgba(15, 23, 42, 0.45)';
                sourceCtx.fillRect(0, 0, sourceCanvas.width, cropRect.y);
                sourceCtx.fillRect(0, cropRect.y, cropRect.x, cropRect.h);
                sourceCtx.fillRect(cropRect.x + cropRect.w, cropRect.y, sourceCanvas.width - (cropRect.x + cropRect.w), cropRect.h);
                sourceCtx.fillRect(0, cropRect.y + cropRect.h, sourceCanvas.width, sourceCanvas.height - (cropRect.y + cropRect.h));

                sourceCtx.strokeStyle = '#0EA5E9';
                sourceCtx.lineWidth = 2;
                sourceCtx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
            }
            renderOutputPreview();
        }

        function renderOutputPreview() {
            const outW = outputCanvas.width;
            const outH = outputCanvas.height;
            outputCtx.fillStyle = '#FFFFFF';
            outputCtx.fillRect(0, 0, outW, outH);

            if (!sourceImage || sourceImage.width === 0) return;

            const scaleX = sourceImage.naturalWidth ? sourceImage.naturalWidth / sourceCanvas.width : 1;
            const scaleY = sourceImage.naturalHeight ? sourceImage.naturalHeight / sourceCanvas.height : 1;

            const rx = cropRect && cropRect.w > 5 ? cropRect.x * scaleX : 0;
            const ry = cropRect && cropRect.h > 5 ? cropRect.y * scaleY : 0;
            const rw = cropRect && cropRect.w > 5 ? cropRect.w * scaleX : (sourceImage.naturalWidth || sourceImage.width);
            const rh = cropRect && cropRect.h > 5 ? cropRect.h * scaleY : (sourceImage.naturalHeight || sourceImage.height);

            if (rw <= 0 || rh <= 0) return;

            const mode = fitModeSelect.value;
            const srcAspect = rw / rh;
            const dstAspect = outW / outH;

            let dx = 0, dy = 0, dw = outW, dh = outH;
            if (mode === 'contain') {
                if (srcAspect > dstAspect) {
                    dw = outW;
                    dh = outW / srcAspect;
                    dy = (outH - dh) / 2;
                } else {
                    dh = outH;
                    dw = outH * srcAspect;
                    dx = (outW - dw) / 2;
                }
                outputCtx.drawImage(sourceImage, rx, ry, rw, rh, dx, dy, dw, dh);
            } else {
                // cover
                let sx = rx, sy = ry, sw = rw, sh = rh;
                if (srcAspect > dstAspect) {
                    sw = rh * dstAspect;
                    sx = rx + (rw - sw) / 2;
                } else {
                    sh = rw / dstAspect;
                    sy = ry + (rh - sh) / 2;
                }
                outputCtx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, outW, outH);
            }
        }

        function loadSourceFromDataUrl(url) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                sourceImage = img;
                const maxW = 640;
                const maxH = 460;
                const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
                sourceCanvas.width = Math.max(240, Math.round(img.width * ratio));
                sourceCanvas.height = Math.max(180, Math.round(img.height * ratio));
                cropRect = null;
                drawSourceAndCrop();
            };
            img.src = url;
        }

        // Load existing thumbnail initially
        const initialUrl = pendingThumbnails.has(slug)
            ? pendingThumbnails.get(slug).dataUrl
            : `publications/thumbs/${slug}.jpg`;
        loadSourceFromDataUrl(initialUrl);

        // Mouse / Touch crop interaction
        const getCanvasCoords = (e) => {
            const rect = sourceCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: Math.max(0, Math.min(sourceCanvas.width, (clientX - rect.left) * (sourceCanvas.width / rect.width))),
                y: Math.max(0, Math.min(sourceCanvas.height, (clientY - rect.top) * (sourceCanvas.height / rect.height)))
            };
        };

        sourceCanvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragStart = getCanvasCoords(e);
            cropRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const cur = getCanvasCoords(e);
            cropRect = {
                x: Math.min(dragStart.x, cur.x),
                y: Math.min(dragStart.y, cur.y),
                w: Math.abs(cur.x - dragStart.x),
                h: Math.abs(cur.y - dragStart.y)
            };
            drawSourceAndCrop();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });

        fitModeSelect.onchange = () => renderOutputPreview();
        modal.querySelector('#thumb-reset-crop-btn').onclick = () => {
            cropRect = null;
            drawSourceAndCrop();
        };

        // Paste from Clipboard (Ctrl+V)
        const handlePaste = (e) => {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        loadSourceFromDataUrl(ev.target.result);
                        showToast('Image pasted from clipboard', 'info');
                    };
                    reader.readAsDataURL(blob);
                    break;
                }
            }
        };
        window.addEventListener('paste', handlePaste);

        // Upload Image or PDF
        async function renderPdfPage(num) {
            if (!pdfDoc) return;
            pdfPageNum = Math.max(1, Math.min(pdfDoc.numPages, num));
            modal.querySelector('#thumb-pdf-page-info').textContent = `Page ${pdfPageNum} / ${pdfDoc.numPages}`;
            const page = await pdfDoc.getPage(pdfPageNum);
            const viewport = page.getViewport({ scale: 2.0 });
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = viewport.width;
            tempCanvas.height = viewport.height;
            await page.render({ canvasContext: tempCanvas.getContext('2d'), viewport }).promise;
            loadSourceFromDataUrl(tempCanvas.toDataURL('image/png'));
        }

        modal.querySelector('#thumb-file-input').onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                try {
                    showToast('Loading PDF pages...', 'info');
                    const pdfjsLib = await ensurePdfJsLoaded();
                    const arrayBuf = await file.arrayBuffer();
                    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
                    modal.querySelector('#thumb-pdf-controls').style.display = 'inline-flex';
                    await renderPdfPage(1);
                    showToast(`Loaded PDF (${pdfDoc.numPages} pages). Drag to crop any figure!`, 'success');
                } catch (err) {
                    showToast(`Could not render PDF: ${err.message}`, 'error');
                }
            } else {
                const reader = new FileReader();
                reader.onload = (ev) => loadSourceFromDataUrl(ev.target.result);
                reader.readAsDataURL(file);
            }
        };

        modal.querySelector('#thumb-pdf-prev').onclick = () => renderPdfPage(pdfPageNum - 1);
        modal.querySelector('#thumb-pdf-next').onclick = () => renderPdfPage(pdfPageNum + 1);

        // Auto-Generate Styled Visual Card
        modal.querySelector('#thumb-generate-card-btn').onclick = () => {
            const cardCanvas = document.createElement('canvas');
            cardCanvas.width = 480;
            cardCanvas.height = 480;
            const ctx = cardCanvas.getContext('2d');

            const palettes = {
                genai: ['#0f172a', '#1e1b4b', '#38bdf8'],
                '3d': ['#0f172a', '#064e3b', '#34d399'],
                depth: ['#0f172a', '#3b0764', '#c084fc'],
                arvr: ['#0f172a', '#7c2d12', '#fb923c'],
                cv: ['#0f172a', '#0c4a6e', '#38bdf8']
            };
            const catId = (pub.category && pub.category.id) || 'cv';
            const [c1, c2, accent] = palettes[catId] || palettes.cv;

            const grad = ctx.createLinearGradient(0, 0, 480, 480);
            grad.addColorStop(0, c1);
            grad.addColorStop(1, c2);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 480, 480);

            // Subtle decorative grid
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            for (let x = 40; x < 480; x += 40) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 480); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, x); ctx.lineTo(480, x); ctx.stroke();
            }

            // Year & Venue Pill
            ctx.fillStyle = accent;
            ctx.font = 'bold 22px Inter, sans-serif';
            ctx.fillText(`${pub.year || ''} • ${(pub.category && pub.category.label) || 'Research'}`, 36, 62);

            // Wrapped Title
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 28px Inter, sans-serif';
            const words = String(pub.title || '').split(/\s+/);
            let line = '';
            let y = 135;
            for (let i = 0; i < words.length; i++) {
                const test = line + words[i] + ' ';
                if (ctx.measureText(test).width > 408 && line) {
                    ctx.fillText(line.trim(), 36, y);
                    line = words[i] + ' ';
                    y += 38;
                    if (y > 350) { line += '...'; break; }
                } else {
                    line = test;
                }
            }
            if (line) ctx.fillText(line.trim(), 36, y);

            // Footer venue
            ctx.fillStyle = '#94a3b8';
            ctx.font = '600 18px Inter, sans-serif';
            const venueShort = String(pub.venue || '').slice(0, 42);
            ctx.fillText(venueShort, 36, 435);

            loadSourceFromDataUrl(cardCanvas.toDataURL('image/jpeg', 0.92));
        };

        const close = () => {
            window.removeEventListener('paste', handlePaste);
            modal.remove();
        };

        modal.querySelector('#thumb-modal-close').onclick = close;
        modal.querySelector('#thumb-cancel-btn').onclick = close;

        // Download single JPG
        modal.querySelector('#thumb-download-single-btn').onclick = () => {
            const dataUrl = outputCanvas.toDataURL('image/jpeg', 0.88);
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `${slug}.jpg`;
            a.click();
        };

        // Stage Thumbnail Update
        modal.querySelector('#thumb-apply-btn').onclick = () => {
            const dataUrl = outputCanvas.toDataURL('image/jpeg', 0.88);
            const base64 = dataUrl.split(',')[1];
            outputCanvas.toBlob((blob) => {
                pendingThumbnails.set(slug, {
                    slug,
                    filename: `${slug}.jpg`,
                    path: `publications/thumbs/${slug}.jpg`,
                    dataUrl,
                    base64,
                    blob,
                    pubTitle: pub.title
                });
                if (window.PublicationsApp) {
                    window.PublicationsApp.setPreviewThumbnail(slug, dataUrl);
                }
                updateUnsavedBanner();
                updateAdminStats();
                const dlBtn = document.getElementById('admin-download-thumbs-btn');
                if (dlBtn) {
                    dlBtn.style.display = 'inline-flex';
                    dlBtn.textContent = `🖼️ Download Staged Thumbnails (${pendingThumbnails.size})`;
                }
                renderAdminTableRows();
                close();
                showToast(`Thumbnail staged for ${slug}.jpg`, 'success');
            }, 'image/jpeg', 0.88);
        };
    }

    // =========================================================================
    // 7. GITHUB SETTINGS & ATOMIC PUBLISH TO GITHUB / DOWNLOADS
    // =========================================================================
    async function getStoredGitHubToken() {
        const enc = localStorage.getItem(STORAGE_ENC_GH_TOKEN);
        if (!enc || !sessionPassword) return '';
        return await decryptWithPassword(enc, sessionPassword);
    }

    async function openGitHubSettingsModal() {
        const currentToken = await getStoredGitHubToken();
        const currentRepo = localStorage.getItem(STORAGE_GH_REPO) || DEFAULT_GH_REPO;

        let modal = document.getElementById('admin-gh-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'admin-gh-modal';
        modal.className = 'admin-modal-overlay open';
        modal.innerHTML = `
            <div class="admin-modal" role="dialog" aria-modal="true">
                <div class="admin-modal-header">
                    <h3>⚙️ GitHub Publishing Settings</h3>
                    <button type="button" class="admin-modal-close" id="gh-modal-close">&times;</button>
                </div>
                <div class="admin-modal-body">
                    <p class="admin-muted-text">
                        To publish <code>publications.bib</code> and updated thumbnails directly to GitHub from your browser, provide a GitHub Personal Access Token with <code>Contents: Read &amp; Write</code> permission on <strong>${escapeHtml(currentRepo)}</strong>.
                        Your token is encrypted locally with your admin password.
                    </p>
                    <div class="admin-form-group">
                        <label>GitHub Repository (<code>owner/repo</code>)</label>
                        <input type="text" id="gh-repo-input" class="admin-input" value="${escapeHtml(currentRepo)}">
                    </div>
                    <div class="admin-form-group">
                        <label>GitHub Personal Access Token (<code>ghp_...</code> or <code>github_pat_...</code>)</label>
                        <input type="password" id="gh-token-input" class="admin-input" placeholder="Paste GitHub token..." value="${escapeHtml(currentToken)}">
                    </div>
                </div>
                <div class="admin-modal-footer">
                    <button type="button" class="admin-btn admin-btn-secondary" id="gh-cancel-btn">Cancel</button>
                    <button type="button" class="admin-btn admin-btn-primary" id="gh-save-btn">Save Encrypted Token</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#gh-modal-close').onclick = close;
        modal.querySelector('#gh-cancel-btn').onclick = close;

        modal.querySelector('#gh-save-btn').onclick = async () => {
            const repo = modal.querySelector('#gh-repo-input').value.trim() || DEFAULT_GH_REPO;
            const token = modal.querySelector('#gh-token-input').value.trim();
            localStorage.setItem(STORAGE_GH_REPO, repo);
            if (token) {
                const enc = await encryptWithPassword(token, sessionPassword);
                localStorage.setItem(STORAGE_ENC_GH_TOKEN, enc);
                showToast('GitHub token encrypted and saved', 'success');
            } else {
                localStorage.removeItem(STORAGE_ENC_GH_TOKEN);
                showToast('Cleared saved GitHub token', 'info');
            }
            close();
        };
    }

    function downloadBibFile() {
        if (!window.PublicationsApp) return;
        const bibContent = window.PublicationsApp.serializeBibtex();
        const blob = new Blob([bibContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'publications.bib';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Downloaded publications.bib', 'success');
    }

    function downloadAllStagedThumbnails() {
        if (pendingThumbnails.size === 0) {
            showToast('No staged thumbnails to download', 'info');
            return;
        }
        pendingThumbnails.forEach(item => {
            const a = document.createElement('a');
            a.href = item.dataUrl;
            a.download = item.filename;
            a.click();
        });
        showToast(`Downloaded ${pendingThumbnails.size} thumbnail file(s)`, 'success');
    }

    async function publishToGitHub() {
        const token = await getStoredGitHubToken();
        if (!token) {
            showToast('Please configure your GitHub Personal Access Token first', 'info');
            openGitHubSettingsModal();
            return;
        }

        const repo = localStorage.getItem(STORAGE_GH_REPO) || DEFAULT_GH_REPO;
        const branch = DEFAULT_GH_BRANCH;
        const btn = document.getElementById('admin-publish-github-btn');
        const origText = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Publishing to GitHub...';
        }

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        };

        try {
            // 1. Get latest commit SHA on main
            const refResp = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers });
            if (!refResp.ok) {
                throw new Error(`GitHub API auth/repo check failed (${refResp.status}). Verify your token in GitHub Settings.`);
            }
            const refData = await refResp.json();
            const latestCommitSha = refData.object.sha;

            // 2. Get base tree SHA
            const commitResp = await fetch(`https://api.github.com/repos/${repo}/git/commits/${latestCommitSha}`, { headers });
            const commitData = await commitResp.json();
            const baseTreeSha = commitData.tree.sha;

            // 3. Create blobs for publications.bib and any staged thumbnails
            const treeItems = [];
            const bibContent = window.PublicationsApp.serializeBibtex();
            const bibBlobResp = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ content: bibContent, encoding: 'utf-8' })
            });
            if (!bibBlobResp.ok) throw new Error('Failed to upload publications.bib blob');
            const bibBlob = await bibBlobResp.json();
            treeItems.push({
                path: 'publications.bib',
                mode: '100644',
                type: 'blob',
                sha: bibBlob.sha
            });

            for (const item of pendingThumbnails.values()) {
                const thumbBlobResp = await fetch(`https://api.github.com/repos/${repo}/git/blobs`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ content: item.base64, encoding: 'base64' })
                });
                if (!thumbBlobResp.ok) throw new Error(`Failed to upload ${item.path}`);
                const thumbBlob = await thumbBlobResp.json();
                treeItems.push({
                    path: item.path,
                    mode: '100644',
                    type: 'blob',
                    sha: thumbBlob.sha
                });
            }

            // 4. Create new Git tree
            const newTreeResp = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
            });
            if (!newTreeResp.ok) throw new Error('Failed to create Git tree');
            const newTree = await newTreeResp.json();

            // 5. Create commit
            const commitMsg = `Update publications.bib${pendingThumbnails.size > 0 ? ` and ${pendingThumbnails.size} thumbnail(s)` : ''} via Admin Panel`;
            const newCommitResp = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    message: commitMsg,
                    tree: newTree.sha,
                    parents: [latestCommitSha]
                })
            });
            if (!newCommitResp.ok) throw new Error('Failed to create Git commit');
            const newCommit = await newCommitResp.json();

            // 6. Update branch ref
            const updateRefResp = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ sha: newCommit.sha })
            });
            if (!updateRefResp.ok) throw new Error('Failed to update branch reference');

            hasBibChanges = false;
            pendingThumbnails.clear();
            updateUnsavedBanner();
            renderAdminPanel();
            showToast(`Published commit ${newCommit.sha.slice(0, 7)} to ${repo}!`, 'success');
        } catch (err) {
            console.error(err);
            showToast(err.message || 'Failed to publish to GitHub', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = origText;
            }
        }
    }

    // =========================================================================
    // 8. INITIALIZATION & HIDDEN ENTRY TRIGGERS
    // =========================================================================
    function initAdminTriggers() {
        // Restore session if unlocked in current tab
        const savedPwd = sessionStorage.getItem(SESSION_UNLOCK_KEY);
        if (savedPwd) {
            computeSha256Hex(savedPwd).then(digest => {
                if (digest === ADMIN_PASSWORD_HASH) {
                    isUnlocked = true;
                    sessionPassword = savedPwd;
                    if (window.location.hash === '#admin') {
                        openAdminPanel();
                    }
                }
            });
        }

        // 1. Discreet lock button in footer
        const lockBtn = document.getElementById('admin-footer-trigger');
        if (lockBtn) {
            lockBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openPasswordGate();
            });
        }

        // 2. Triple-click on footer copyright text
        const footer = document.querySelector('.footer');
        if (footer) {
            let clickCount = 0;
            let clickTimer = null;
            footer.addEventListener('click', (e) => {
                if (e.target.closest('#admin-footer-trigger')) return;
                clickCount++;
                clearTimeout(clickTimer);
                if (clickCount >= 3) {
                    clickCount = 0;
                    openPasswordGate();
                } else {
                    clickTimer = setTimeout(() => { clickCount = 0; }, 600);
                }
            });
        }

        // 3. Keyboard shortcut: Ctrl+Shift+E / Cmd+Shift+E
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
                e.preventDefault();
                openPasswordGate();
            }
        });

        // 4. URL hash #admin
        const checkHash = () => {
            if (window.location.hash === '#admin') {
                openPasswordGate();
            }
        };
        window.addEventListener('hashchange', checkHash);
        checkHash();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAdminTriggers);
    } else {
        initAdminTriggers();
    }

    window.addEventListener('publicationsLoaded', () => {
        if (isUnlocked && document.getElementById('admin-panel-section')) {
            renderAdminPanel();
        }
    });
})();
