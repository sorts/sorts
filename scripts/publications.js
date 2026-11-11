document.addEventListener('DOMContentLoaded', () => {
    const publicationsContainer = document.getElementById('dynamic-publications');
    const viewModeContainer = document.getElementById('view-mode-filters');
    const yearFiltersContainer = document.getElementById('year-filters');
    const categoryFiltersContainer = document.getElementById('category-filters');
    const searchInput = document.getElementById('pub-search');
    const pubCountContainer = document.getElementById('pub-count');
    const themeToggleBtn = document.getElementById('theme-toggle');
    const currentYearSpan = document.getElementById('current-year');

    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const nextTheme = isDark ? 'light' : 'dark';
            if (nextTheme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
            } else {
                document.documentElement.removeAttribute('data-theme');
            }
            localStorage.setItem('theme', nextTheme);
        });
    }

    let publicationsData = [];
    let rawBibtexSource = '';
    let currentViewMode = 'selected'; // 'selected' | 'all'
    let currentYearFilter = 'All';
    let currentCategoryFilter = 'All';
    let currentSearchQuery = '';
    const previewThumbnails = new Map(); // slug -> dataUrl

    const DEFAULT_CATEGORIES = [
        { id: 'All', label: 'All Topics' },
        { id: 'genai', label: 'GenAI & Avatars', image: 'publications/images/cat_genai.png' },
        { id: '3d', label: '3D & Volumetric', image: 'publications/images/cat_3d.png' },
        { id: 'depth', label: 'Depth & Stereo', image: 'publications/images/cat_depth.png' },
        { id: 'arvr', label: 'AR/VR & Tracking', image: 'publications/images/cat_arvr.png' },
        { id: 'cv', label: 'Computer Vision & ML', image: 'publications/images/cat_cv.png' }
    ];

    let CATEGORIES = DEFAULT_CATEGORIES.map(c => ({ ...c }));

    const DEFAULT_NEWS = [
        {
            date: "Nov '26",
            tag: "GNM Head",
            text: "Released the GNM Head model on GitHub \u2197",
            url: "https://github.com/google/GNM"
        },
        {
            date: "Jun '26",
            tag: "UA Award",
            text: "Received the Alumni Embajador Award by the University of Alicante (UA) \u2197",
            url: "https://alumni.ua.es/es/2025-2026/talento-ua-gala-alumni-2026-invitacion.html"
        },
        {
            date: "Dec '25",
            tag: "Galaxy XR",
            text: "Likeness launch in Galaxy XR.",
            url: ""
        }
    ];

    let NEWS_ITEMS = DEFAULT_NEWS.map(n => ({ ...n }));
    const savedCompactPref = sessionStorage.getItem('soe_news_spine_compact');
    let isNewsSpineCompact = savedCompactPref !== null ? savedCompactPref === 'true' : false;
    let isMobileInlineCollapsed = true;
    let isNewsShowAll = false;

    function getCategoryById(catId) {
        if (!catId) return null;
        const norm = String(catId).trim().toLowerCase();
        return CATEGORIES.find(c => c.id.toLowerCase() === norm && c.id !== 'All') || null;
    }

    function parseExplicitCategoryIds(rawVal) {
        if (!rawVal) return [];
        const parts = Array.isArray(rawVal)
            ? rawVal
            : String(rawVal).split(/[,;|]+/);
        const seen = new Set();
        const result = [];
        for (const p of parts) {
            const cat = getCategoryById(p);
            if (cat && !seen.has(cat.id)) {
                seen.add(cat.id);
                result.push(cat.id);
            }
        }
        return result;
    }

    function getCategoriesInfo(title, venue = '', explicitCats = '') {
        const explicitIds = parseExplicitCategoryIds(explicitCats);
        if (explicitIds.length > 0) {
            return explicitIds.map(id => getCategoryById(id)).filter(Boolean);
        }

        const text = `${title} ${venue}`;
        const matched = [];
        const addIfFound = (id) => {
            const cat = getCategoryById(id);
            if (cat && !matched.some(m => m.id === cat.id)) {
                matched.push(cat);
            }
        };

        if (/\b(generative|gan|gantlitz|nerf|radiance|relight|relighting|lighting|portrait|face|facial|avatar|avatars|magicmirror|diffusion|synthesis|human|humans)\b/i.test(text)) {
            addIfFound('genai');
        }
        if (/\b(depth|stereo|rgb-d|rgbd|tof|time-of-flight|disparity|dual-camera|dual-cameras|du2net|du²net)\b/i.test(text)) {
            addIfFound('depth');
        }
        if (/\b(holoportation|virtual reality|augmented reality|mixed reality|telepresence|vr|ar|xr|headset|tracking|pose|gesture|hand|hands|interactive)\b/i.test(text)) {
            addIfFound('arvr');
        }
        if (/\b(3d|volumetric|point cloud|point clouds|mesh|meshes|reconstruction|octree|geometry|surface|fusion4d|room assembly)\b/i.test(text)) {
            addIfFound('3d');
        }

        if (matched.length === 0) {
            const fallback = getCategoryById('cv') || CATEGORIES[5] || CATEGORIES[CATEGORIES.length - 1];
            if (fallback) matched.push(fallback);
        }
        return matched;
    }

    function getCategoryInfo(title, venue = '', explicitCats = '') {
        const cats = getCategoriesInfo(title, venue, explicitCats);
        return cats[0] || CATEGORIES[CATEGORIES.length - 1];
    }

    function decodeLatexEscapes(str) {
        if (!str) return '';

        const replacements = {
            "\\({}^{\\mbox{2}}\\)": "²",
            "{\\ss}": "ß",
            "\\ss": "ß",
            "\\_": "_",
            "\\&": "&",
            "\\%": "%",
            "{-}": "-"
        };

        let decoded = str;
        for (const [escape, char] of Object.entries(replacements)) {
            decoded = decoded.split(escape).join(char);
        }

        const accentMap = {
            "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ć', N: 'Ń' },
            "`": { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
            "^": { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
            "\"": { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü', Y: 'Ÿ' },
            "~": { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
            "c": { c: 'ç', C: 'Ç' },
            "v": { c: 'č', C: 'Č', s: 'š', S: 'Š', z: 'ž', Z: 'Ž', r: 'ř', R: 'Ř' }
        };

        decoded = decoded.replace(/\{?\\(['`"^~cv])\{?\\?([a-zA-Z])\}?\}?/g, (match, acc, letter) => {
            return (accentMap[acc] && accentMap[acc][letter]) ? accentMap[acc][letter] : match;
        });

        decoded = decoded.replace(/[{}]/g, '');
        return decoded;
    }

    function formatVenue(entry) {
        if (entry.journal) {
            if (entry.journal.toLowerCase() === 'corr') {
                const arxivId = entry.eprint || (entry.volume ? entry.volume.replace(/^abs\//i, '') : '');
                return arxivId ? `arXiv preprint arXiv:${arxivId}` : 'arXiv preprint';
            }
            return entry.journal;
        }
        if (entry.booktitle) {
            return entry.booktitle;
        }
        if (entry.institution) {
            return entry.institution;
        }
        if (entry.publisher) {
            return entry.publisher;
        }
        return '';
    }

    function deduplicateEntries(entries) {
        const byTitle = new Map();
        for (const entry of entries) {
            const normTitle = entry.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!byTitle.has(normTitle)) {
                byTitle.set(normTitle, entry);
            } else {
                const existing = byTitle.get(normTitle);
                const existingIsPreprint = (existing.journal || '').toLowerCase() === 'corr';
                const currentIsPreprint = (entry.journal || '').toLowerCase() === 'corr';
                if (existingIsPreprint && !currentIsPreprint) {
                    if (existing.eprint && !entry.eprint) entry.eprint = existing.eprint;
                    if (existing.isSelected) entry.isSelected = true;
                    byTitle.set(normTitle, entry);
                } else if (!existingIsPreprint && currentIsPreprint) {
                    if (entry.eprint && !existing.eprint) existing.eprint = entry.eprint;
                    if (entry.isSelected) existing.isSelected = true;
                }
            }
        }
        return Array.from(byTitle.values());
    }

    function cleanBibtexForCopy(rawBlock) {
        return rawBlock
            .replace(/,?\s*\n\s*selected\s*=\s*\{[^}]*\}/gi, '')
            .replace(/,?\s*\n\s*category\s*=\s*\{[^}]*\}/gi, '');
    }

    function parseCategoriesComment(bibtex) {
        const match = bibtex.match(/@comment\s*\{\s*categories_json\s*=\s*(\[[\s\S]*?\])\s*\}/i);
        if (match) {
            try {
                const parsed = JSON.parse(match[1]);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const hasAll = parsed.some(c => c.id === 'All');
                    CATEGORIES = hasAll ? parsed : [{ id: 'All', label: 'All Topics' }, ...parsed];
                }
            } catch (e) {
                console.warn('Could not parse custom categories_json in publications.bib:', e);
            }
        }

        const newsMatch = bibtex.match(/@comment\s*\{\s*news_json\s*=\s*(\[[\s\S]*?\])\s*\}/i);
        if (newsMatch) {
            try {
                const parsedNews = JSON.parse(newsMatch[1]);
                if (Array.isArray(parsedNews)) {
                    NEWS_ITEMS = parsedNews;
                }
            } catch (e) {
                console.warn('Could not parse custom news_json in publications.bib:', e);
            }
        }
    }

    function parseBibtex(bibtex) {
        parseCategoriesComment(bibtex);
        const entries = [];
        const entryRegex = /@(\w+)\s*\{([^,]+),\s*([\s\S]*?)\n\}/g;
        let match;

        while ((match = entryRegex.exec(bibtex)) !== null) {
            const type = match[1].toLowerCase();
            if (type === 'proceedings' || type === 'comment') continue;

            const key = match[2].trim();
            const content = match[3];
            const rawBlock = match[0];
            const rawBibtex = cleanBibtexForCopy(rawBlock);
            const entry = { type, key, rawBlock, rawBibtex };

            const fieldRegex = /([a-zA-Z0-9_]+)\s*=\s*\{/g;
            let fieldMatch;
            while ((fieldMatch = fieldRegex.exec(content)) !== null) {
                const fieldName = fieldMatch[1].toLowerCase();
                let startIndex = fieldRegex.lastIndex;
                let openBraces = 1;
                let endIndex = startIndex;

                while (openBraces > 0 && endIndex < content.length) {
                    if (content[endIndex] === '{') openBraces++;
                    else if (content[endIndex] === '}') openBraces--;
                    endIndex++;
                }

                let value = content.substring(startIndex, endIndex - 1).trim();
                value = value.replace(/\s+/g, ' ');
                value = decodeLatexEscapes(value);

                entry[fieldName] = value;
            }

            if (entry.title && entry.author) {
                const explicitIds = parseExplicitCategoryIds(entry.category || '');
                entry.explicitCategories = explicitIds;
                entry.explicitCategory = explicitIds.join(', ');
                entry.venue = formatVenue(entry);
                entry.categories = getCategoriesInfo(entry.title, entry.venue, explicitIds);
                entry.category = entry.categories[0];
                entry.isSelected = /^(true|yes|1)$/i.test((entry.selected || '').trim());
                entries.push(entry);
            }
        }

        return deduplicateEntries(entries).sort((a, b) => {
            const yearA = parseInt(a.year, 10) || 0;
            const yearB = parseInt(b.year, 10) || 0;
            return yearB - yearA;
        });
    }

    function buildEntryBlock(entry) {
        let block = entry.rawBlock ? cleanBibtexForCopy(entry.rawBlock).trim() : '';
        if (!block || entry._fieldsEdited) {
            const type = entry.type || 'article';
            const lines = [];
            if (entry.author) lines.push(`  author       = {${entry.author}}`);
            if (entry.title) lines.push(`  title        = {${entry.title}}`);
            if (entry.journal) lines.push(`  journal      = {${entry.journal}}`);
            if (entry.booktitle) lines.push(`  booktitle    = {${entry.booktitle}}`);
            if (entry.volume) lines.push(`  volume       = {${entry.volume}}`);
            if (entry.number) lines.push(`  number       = {${entry.number}}`);
            if (entry.pages) lines.push(`  pages        = {${entry.pages}}`);
            if (entry.publisher) lines.push(`  publisher    = {${entry.publisher}}`);
            if (entry.institution) lines.push(`  institution  = {${entry.institution}}`);
            if (entry.year) lines.push(`  year         = {${entry.year}}`);
            if (entry.url) lines.push(`  url          = {${entry.url}}`);
            if (entry.doi) lines.push(`  doi          = {${entry.doi}}`);
            if (entry.eprint) {
                lines.push(`  eprinttype   = {arXiv}`);
                lines.push(`  eprint       = {${entry.eprint}}`);
            }
            block = `@${type}{${entry.key},\n${lines.join(',\n')}\n}`;
        }

        // Inject explicit category (single or comma-separated multiple) and selected flags before closing brace
        const extraLines = [];
        const explicitIds = Array.isArray(entry.explicitCategories)
            ? entry.explicitCategories.filter(Boolean)
            : parseExplicitCategoryIds(entry.explicitCategory || '');
        if (explicitIds.length > 0) {
            extraLines.push(`  category     = {${explicitIds.join(', ')}}`);
        }
        if (entry.isSelected) {
            extraLines.push(`  selected     = {true}`);
        }

        if (extraLines.length > 0) {
            block = block.replace(/\s*\n\}$/, `,\n${extraLines.join(',\n')}\n}`);
        }
        return block;
    }

    function serializeBibtex(entries = publicationsData, categories = CATEGORIES, news = NEWS_ITEMS) {
        const parts = [];
        const defaultJson = JSON.stringify(DEFAULT_CATEGORIES);
        const currentJson = JSON.stringify(categories);
        if (currentJson !== defaultJson) {
            parts.push(`@comment{categories_json = ${JSON.stringify(categories, null, 2)}}`);
        }
        const defaultNewsJson = JSON.stringify(DEFAULT_NEWS);
        const currentNewsJson = JSON.stringify(news);
        if (currentNewsJson !== defaultNewsJson) {
            parts.push(`@comment{news_json = ${JSON.stringify(news, null, 2)}}`);
        }
        const sorted = [...entries].sort((a, b) => {
            const yearA = parseInt(a.year, 10) || 0;
            const yearB = parseInt(b.year, 10) || 0;
            return yearB - yearA;
        });
        for (const entry of sorted) {
            parts.push(buildEntryBlock(entry));
        }
        return parts.join('\n\n') + '\n';
    }

    function createAuthorElement(authorStr) {
        const authorDiv = document.createElement('div');
        authorDiv.className = 'pub-author';

        const authors = authorStr.split(/\s+and\s+/i);
        authors.forEach((author, idx) => {
            const cleanName = author.trim();
            const isSelf = /sergio\s+orts/i.test(cleanName);

            if (isSelf) {
                const strong = document.createElement('strong');
                strong.className = 'author-self';
                strong.textContent = cleanName;
                authorDiv.appendChild(strong);
            } else {
                authorDiv.appendChild(document.createTextNode(cleanName));
            }

            if (idx < authors.length - 1) {
                authorDiv.appendChild(document.createTextNode(', '));
            }
        });

        return authorDiv;
    }

    function renderViewModeFilters() {
        if (!viewModeContainer) return;
        viewModeContainer.innerHTML = '';

        const selectedCount = publicationsData.filter(p => p.isSelected).length;
        const modes = [
            { id: 'selected', label: `Selected (${selectedCount})` },
            { id: 'all', label: `All Publications (${publicationsData.length})` }
        ];

        modes.forEach(m => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `view-mode-btn ${currentViewMode === m.id ? 'active' : ''}`;
            btn.textContent = m.label;
            btn.onclick = () => {
                currentViewMode = m.id;
                renderViewModeFilters();
                renderYearFilters();
                renderPublications();
            };
            viewModeContainer.appendChild(btn);
        });
    }

    function renderPublications() {
        publicationsContainer.innerHTML = '';

        const query = currentSearchQuery.trim().toLowerCase();
        const modePool = currentViewMode === 'selected'
            ? publicationsData.filter(pub => pub.isSelected)
            : publicationsData;

        const filtered = modePool.filter(pub => {
            const matchesYear = currentYearFilter === 'All' || pub.year === currentYearFilter;
            const pubCats = pub.categories && pub.categories.length > 0 ? pub.categories : [pub.category].filter(Boolean);
            const matchesCategory = currentCategoryFilter === 'All' || pubCats.some(c => c.id === currentCategoryFilter);
            const matchesSearch = !query ||
                pub.title.toLowerCase().includes(query) ||
                (pub.author && pub.author.toLowerCase().includes(query)) ||
                (pub.venue && pub.venue.toLowerCase().includes(query)) ||
                (pub.year && pub.year.includes(query));

            return matchesYear && matchesCategory && matchesSearch;
        });

        if (pubCountContainer) {
            const modeLabel = currentViewMode === 'selected' ? 'selected publications' : 'total publications';
            pubCountContainer.textContent = `Showing ${filtered.length} of ${modePool.length} ${modeLabel}`;
        }

        if (filtered.length === 0) {
            publicationsContainer.innerHTML = '<div class="text-center">No publications match your current filters.</div>';
            return;
        }

        filtered.forEach(pub => {
            const div = document.createElement('div');
            div.className = 'publication-item';

            const img = document.createElement('img');
            const thumbSlug = pub.key.replace(/[^a-zA-Z0-9_-]/g, '_');
            img.src = previewThumbnails.has(thumbSlug)
                ? previewThumbnails.get(thumbSlug)
                : `publications/thumbs/${thumbSlug}.jpg`;
            img.onerror = () => {
                img.onerror = null;
                img.src = pub.category.image || 'publications/images/cat_cv.png';
            };
            img.className = 'publication-img';
            img.alt = `Thumbnail for ${pub.title}`;
            img.loading = 'lazy';
            div.appendChild(img);

            const contentDiv = document.createElement('div');
            contentDiv.className = 'publication-content-wrapper';

            const titleContainer = document.createElement('cite');
            const primaryUrl = pub.url || (pub.doi ? `https://doi.org/${pub.doi}` : '');

            if (primaryUrl) {
                const link = document.createElement('a');
                link.href = primaryUrl;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = pub.title;
                link.className = 'publication-link';
                titleContainer.appendChild(link);
            } else {
                titleContainer.textContent = pub.title;
            }
            contentDiv.appendChild(titleContainer);

            if (pub.author) {
                contentDiv.appendChild(createAuthorElement(pub.author));
            }

            const metaDiv = document.createElement('div');
            metaDiv.className = 'pub-meta';

            if (pub.year) {
                const yearBadge = document.createElement('span');
                yearBadge.className = 'pub-year-badge';
                yearBadge.textContent = pub.year;
                metaDiv.appendChild(yearBadge);
            }

            const pubCats = pub.categories && pub.categories.length > 0 ? pub.categories : [pub.category].filter(Boolean);
            pubCats.forEach(cat => {
                const catBadge = document.createElement('span');
                catBadge.className = 'pub-cat-badge';
                catBadge.textContent = cat.label;
                metaDiv.appendChild(catBadge);
            });

            if (pub.venue) {
                const conf = document.createElement('span');
                conf.className = 'conf';
                conf.textContent = pub.venue;
                metaDiv.appendChild(conf);
            }

            contentDiv.appendChild(metaDiv);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'pub-actions';

            if (primaryUrl) {
                const paperLink = document.createElement('a');
                paperLink.href = primaryUrl;
                paperLink.target = '_blank';
                paperLink.rel = 'noopener noreferrer';
                paperLink.className = 'pub-action-btn';
                paperLink.textContent = 'Paper / DOI ↗';
                actionsDiv.appendChild(paperLink);
            }

            if (pub.eprint) {
                const arxivLink = document.createElement('a');
                arxivLink.href = `https://arxiv.org/abs/${pub.eprint}`;
                arxivLink.target = '_blank';
                arxivLink.rel = 'noopener noreferrer';
                arxivLink.className = 'pub-action-btn';
                arxivLink.textContent = `arXiv:${pub.eprint} ↗`;
                actionsDiv.appendChild(arxivLink);
            }

            if (pub.rawBibtex) {
                const bibBtn = document.createElement('button');
                bibBtn.type = 'button';
                bibBtn.className = 'pub-action-btn';
                bibBtn.textContent = 'Copy BibTeX';
                bibBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(pub.rawBibtex).then(() => {
                        bibBtn.textContent = 'Copied! ✓';
                        setTimeout(() => {
                            bibBtn.textContent = 'Copy BibTeX';
                        }, 1800);
                    });
                });
                actionsDiv.appendChild(bibBtn);
            }

            contentDiv.appendChild(actionsDiv);
            div.appendChild(contentDiv);
            publicationsContainer.appendChild(div);
        });
    }

    function renderCategoryFilters() {
        if (!categoryFiltersContainer) return;
        categoryFiltersContainer.innerHTML = '';

        CATEGORIES.forEach(cat => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `filter-btn ${currentCategoryFilter === cat.id ? 'active' : ''}`;
            btn.textContent = cat.label;
            btn.onclick = () => {
                currentCategoryFilter = cat.id;
                renderCategoryFilters();
                renderPublications();
            };
            categoryFiltersContainer.appendChild(btn);
        });
    }

    function renderYearFilters() {
        if (!yearFiltersContainer) return;
        yearFiltersContainer.innerHTML = '';

        const modePool = currentViewMode === 'selected'
            ? publicationsData.filter(pub => pub.isSelected)
            : publicationsData;

        const years = [...new Set(modePool.map(pub => pub.year).filter(Boolean))].sort((a, b) => b - a);
        if (currentYearFilter !== 'All' && !years.includes(currentYearFilter)) {
            currentYearFilter = 'All';
        }
        years.unshift('All');

        years.forEach(year => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `filter-btn ${currentYearFilter === year ? 'active' : ''}`;
            btn.textContent = year === 'All' ? 'All Years' : year;
            btn.onclick = () => {
                currentYearFilter = year;
                renderYearFilters();
                renderPublications();
            };
            yearFiltersContainer.appendChild(btn);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value;
            renderPublications();
        });
    }

    function renderNewsSpine() {
        const spineEl = document.getElementById('news-timeline-spine');
        if (!spineEl) return;

        if (!Array.isArray(NEWS_ITEMS) || NEWS_ITEMS.length === 0) {
            spineEl.style.display = 'none';
            return;
        }
        spineEl.style.display = '';

        const isInlineMode = typeof window !== 'undefined' && window.innerWidth < 1400;
        spineEl.classList.toggle('is-inline-mode', isInlineMode);

        if (isInlineMode) {
            spineEl.classList.remove('is-compact');
            spineEl.classList.toggle('is-inline-collapsed', isMobileInlineCollapsed);
            spineEl.innerHTML = '';

            const latest = NEWS_ITEMS[0];
            const headerDiv = document.createElement('div');
            headerDiv.className = 'news-spine-header news-inline-bar';
            headerDiv.onclick = () => {
                isMobileInlineCollapsed = !isMobileInlineCollapsed;
                renderNewsSpine();
            };

            const leftWrap = document.createElement('div');
            leftWrap.className = 'news-inline-summary';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'news-spine-title';
            titleSpan.innerHTML = `<span class="news-spine-live-dot"></span>Timeline`;
            leftWrap.appendChild(titleSpan);

            if (isMobileInlineCollapsed && latest) {
                const previewSpan = document.createElement('span');
                previewSpan.className = 'news-inline-latest-text';
                previewSpan.innerHTML = `<strong>${latest.date || ''}:</strong> ${latest.text || ''}`;
                leftWrap.appendChild(previewSpan);
            }
            headerDiv.appendChild(leftWrap);

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'news-spine-toggle-btn';
            toggleBtn.textContent = isMobileInlineCollapsed
                ? `Show all (${NEWS_ITEMS.length}) \u25BE`
                : 'Collapse \u25B4';
            headerDiv.appendChild(toggleBtn);
            spineEl.appendChild(headerDiv);

            if (!isMobileInlineCollapsed) {
                const railDiv = document.createElement('div');
                railDiv.className = 'news-spine-rail news-inline-rail';

                NEWS_ITEMS.forEach((item, idx) => {
                    const nodeDiv = document.createElement('div');
                    nodeDiv.className = `news-spine-item ${idx === 0 ? 'is-latest' : ''}`;

                    const dotSpan = document.createElement('span');
                    dotSpan.className = 'news-spine-dot';
                    nodeDiv.appendChild(dotSpan);

                    const metaLine = document.createElement('div');
                    metaLine.className = 'news-spine-meta';

                    const dateSpan = document.createElement('span');
                    dateSpan.className = 'news-spine-date';
                    dateSpan.textContent = item.date || '';
                    metaLine.appendChild(dateSpan);

                    if (item.tag) {
                        const tagSpan = document.createElement('span');
                        tagSpan.className = 'news-spine-tag';
                        tagSpan.textContent = item.tag;
                        metaLine.appendChild(tagSpan);
                    }
                    nodeDiv.appendChild(metaLine);

                    if (item.text) {
                        const detailDiv = document.createElement('div');
                        detailDiv.className = 'news-spine-detail';
                        if (item.url) {
                            const a = document.createElement('a');
                            a.href = item.url;
                            if (/^https?:\/\//i.test(item.url)) {
                                a.target = '_blank';
                                a.rel = 'noopener noreferrer';
                            }
                            a.textContent = item.text;
                            detailDiv.appendChild(a);
                        } else {
                            detailDiv.textContent = item.text;
                        }
                        nodeDiv.appendChild(detailDiv);
                    }
                    railDiv.appendChild(nodeDiv);
                });

                spineEl.appendChild(railDiv);
            }
            return;
        }

        // Desktop Floating Right-Side Timeline Spine Mode (>= 1400px)
        spineEl.classList.remove('is-inline-collapsed');
        spineEl.classList.toggle('is-compact', isNewsSpineCompact);

        const visibleLimit = 3;
        const displayedItems = (!isNewsSpineCompact && !isNewsShowAll && NEWS_ITEMS.length > visibleLimit)
            ? NEWS_ITEMS.slice(0, visibleLimit)
            : NEWS_ITEMS;

        spineEl.innerHTML = '';

        // Top Header Row
        const headerDiv = document.createElement('div');
        headerDiv.className = 'news-spine-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'news-spine-title';
        titleSpan.innerHTML = `<span class="news-spine-live-dot"></span>Timeline`;
        headerDiv.appendChild(titleSpan);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'news-spine-toggle-btn';
        toggleBtn.title = isNewsSpineCompact ? 'Expand news timeline' : 'Collapse to compact timeline spine';
        toggleBtn.innerHTML = isNewsSpineCompact ? '|&larr; Expand' : '&rarr;| Compact';
        toggleBtn.onclick = () => {
            isNewsSpineCompact = !isNewsSpineCompact;
            sessionStorage.setItem('soe_news_spine_compact', String(isNewsSpineCompact));
            renderNewsSpine();
        };
        headerDiv.appendChild(toggleBtn);
        spineEl.appendChild(headerDiv);

        // Vertical Spine Rail
        const railDiv = document.createElement('div');
        railDiv.className = 'news-spine-rail';

        displayedItems.forEach((item, idx) => {
            const nodeDiv = document.createElement('div');
            nodeDiv.className = `news-spine-item ${idx === 0 ? 'is-latest' : ''}`;

            const dotSpan = document.createElement('span');
            dotSpan.className = 'news-spine-dot';
            nodeDiv.appendChild(dotSpan);

            const metaLine = document.createElement('div');
            metaLine.className = 'news-spine-meta';

            const dateSpan = document.createElement('span');
            dateSpan.className = 'news-spine-date';
            dateSpan.textContent = item.date || '';
            if (isNewsSpineCompact) {
                dateSpan.title = `${item.date}: ${item.text || ''}`;
                dateSpan.style.cursor = 'pointer';
                dateSpan.onclick = () => {
                    isNewsSpineCompact = false;
                    sessionStorage.setItem('soe_news_spine_compact', 'false');
                    renderNewsSpine();
                };
            }
            metaLine.appendChild(dateSpan);

            if (item.tag && !isNewsSpineCompact) {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'news-spine-tag';
                tagSpan.textContent = item.tag;
                metaLine.appendChild(tagSpan);
            }
            nodeDiv.appendChild(metaLine);

            if (!isNewsSpineCompact && item.text) {
                const detailDiv = document.createElement('div');
                detailDiv.className = 'news-spine-detail';
                if (item.url) {
                    const a = document.createElement('a');
                    a.href = item.url;
                    if (/^https?:\/\//i.test(item.url)) {
                        a.target = '_blank';
                        a.rel = 'noopener noreferrer';
                    }
                    a.textContent = item.text;
                    detailDiv.appendChild(a);
                } else {
                    detailDiv.textContent = item.text;
                }
                nodeDiv.appendChild(detailDiv);
            }

            railDiv.appendChild(nodeDiv);
        });

        spineEl.appendChild(railDiv);

        if (!isNewsSpineCompact && NEWS_ITEMS.length > visibleLimit) {
            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'news-spine-more-btn';
            moreBtn.textContent = isNewsShowAll
                ? 'Show less \u25B4'
                : `Show older (${NEWS_ITEMS.length - visibleLimit}) \u25BE`;
            moreBtn.onclick = () => {
                isNewsShowAll = !isNewsShowAll;
                renderNewsSpine();
            };
            spineEl.appendChild(moreBtn);
        }
    }

    if (typeof window !== 'undefined' && window.matchMedia) {
        window.matchMedia('(max-width: 1399px)').addEventListener('change', () => {
            renderNewsSpine();
        });
    }

    function refreshAll() {
        publicationsData.forEach(pub => {
            pub.venue = formatVenue(pub);
            const explicitIds = Array.isArray(pub.explicitCategories)
                ? parseExplicitCategoryIds(pub.explicitCategories)
                : parseExplicitCategoryIds(pub.explicitCategory || '');
            pub.explicitCategories = explicitIds;
            pub.explicitCategory = explicitIds.join(', ');
            pub.categories = getCategoriesInfo(pub.title, pub.venue, explicitIds);
            pub.category = pub.categories[0];
            pub.rawBibtex = cleanBibtexForCopy(buildEntryBlock(pub));
        });
        renderNewsSpine();
        renderViewModeFilters();
        renderCategoryFilters();
        renderYearFilters();
        renderPublications();
    }

    window.PublicationsApp = {
        getEntries: () => publicationsData,
        setEntries: (newEntries) => {
            publicationsData = newEntries;
            refreshAll();
        },
        getCategories: () => CATEGORIES,
        setCategories: (newCats) => {
            const hasAll = newCats.some(c => c.id === 'All');
            CATEGORIES = hasAll ? newCats : [{ id: 'All', label: 'All Topics' }, ...newCats];
            if (currentCategoryFilter !== 'All' && !CATEGORIES.some(c => c.id === currentCategoryFilter)) {
                currentCategoryFilter = 'All';
            }
            refreshAll();
        },
        getDefaultCategories: () => DEFAULT_CATEGORIES.map(c => ({ ...c })),
        getNews: () => NEWS_ITEMS,
        setNews: (newNews) => {
            NEWS_ITEMS = Array.isArray(newNews) ? newNews : [];
            renderNewsSpine();
        },
        getDefaultNews: () => DEFAULT_NEWS.map(n => ({ ...n })),
        getCategoryInfo: (title, venue, explicitCatId) => getCategoryInfo(title, venue, explicitCatId),
        getCategoriesInfo: (title, venue, explicitCats) => getCategoriesInfo(title, venue, explicitCats),
        parseExplicitCategoryIds: (rawVal) => parseExplicitCategoryIds(rawVal),
        parseBibtex: (bib) => parseBibtex(bib),
        serializeBibtex: (entries, cats, news) => serializeBibtex(entries || publicationsData, cats || CATEGORIES, news || NEWS_ITEMS),
        buildEntryBlock: (entry) => buildEntryBlock(entry),
        setPreviewThumbnail: (slug, dataUrl) => {
            previewThumbnails.set(slug, dataUrl);
            renderPublications();
        },
        getPreviewThumbnail: (slug) => previewThumbnails.get(slug),
        refreshUI: () => refreshAll(),
        getRawBibtexSource: () => rawBibtexSource
    };

    renderNewsSpine();

    fetch('publications.bib', { cache: 'no-cache' })
        .then(response => {
            if (!response.ok) {
                throw new Error('Could not load publications.bib');
            }
            return response.text();
        })
        .then(data => {
            rawBibtexSource = data;
            publicationsData = parseBibtex(data);
            renderNewsSpine();
            if (publicationsData.length > 0) {
                const hasSelected = publicationsData.some(p => p.isSelected);
                currentViewMode = hasSelected ? 'selected' : 'all';
                renderViewModeFilters();
                renderCategoryFilters();
                renderYearFilters();
                renderPublications();
            } else {
                publicationsContainer.innerHTML = '<div class="text-center">No publications found in the BibTeX file.</div>';
            }
            window.dispatchEvent(new CustomEvent('publicationsLoaded'));
        })
        .catch(error => {
            console.error('Error fetching publications:', error);
            publicationsContainer.innerHTML = '<div class="text-center">Failed to load publications. Please ensure publications.bib exists.</div>';
        });
});
