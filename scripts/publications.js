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
    let currentViewMode = 'selected'; // 'selected' | 'all'
    let currentYearFilter = 'All';
    let currentCategoryFilter = 'All';
    let currentSearchQuery = '';

    const CATEGORIES = [
        { id: 'All', label: 'All Topics' },
        { id: 'genai', label: 'GenAI & Avatars', image: 'publications/images/cat_genai.png' },
        { id: '3d', label: '3D & Volumetric', image: 'publications/images/cat_3d.png' },
        { id: 'depth', label: 'Depth & Stereo', image: 'publications/images/cat_depth.png' },
        { id: 'arvr', label: 'AR/VR & Tracking', image: 'publications/images/cat_arvr.png' },
        { id: 'cv', label: 'Computer Vision & ML', image: 'publications/images/cat_cv.png' }
    ];

    function getCategoryInfo(title, venue = '') {
        const text = `${title} ${venue}`;
        if (/\b(generative|gan|gantlitz|nerf|radiance|relight|relighting|lighting|portrait|face|facial|avatar|avatars|magicmirror|diffusion|synthesis|human|humans)\b/i.test(text)) {
            return CATEGORIES[1]; // GenAI & Avatars
        }
        if (/\b(depth|stereo|rgb-d|rgbd|tof|time-of-flight|disparity|dual-camera|dual-cameras|du2net|du²net)\b/i.test(text)) {
            return CATEGORIES[3]; // Depth & Stereo
        }
        if (/\b(holoportation|virtual reality|augmented reality|mixed reality|telepresence|vr|ar|xr|headset|tracking|pose|gesture|hand|hands|interactive)\b/i.test(text)) {
            return CATEGORIES[4]; // AR/VR & Tracking
        }
        if (/\b(3d|volumetric|point cloud|point clouds|mesh|meshes|reconstruction|octree|geometry|surface|fusion4d|room assembly)\b/i.test(text)) {
            return CATEGORIES[2]; // 3D & Volumetric
        }
        return CATEGORIES[5]; // Computer Vision & ML
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

    function parseBibtex(bibtex) {
        const entries = [];
        const entryRegex = /@(\w+)\s*\{([^,]+),\s*([\s\S]*?)\n\}/g;
        let match;

        while ((match = entryRegex.exec(bibtex)) !== null) {
            const type = match[1].toLowerCase();
            if (type === 'proceedings') continue;

            const key = match[2].trim();
            const content = match[3];
            // Strip custom 'selected = {...}' line from copied BibTeX
            const rawBibtex = match[0].replace(/,?\s*\n\s*selected\s*=\s*\{[^}]*\}/gi, '');
            const entry = { type, key, rawBibtex };

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
                entry.venue = formatVenue(entry);
                entry.category = getCategoryInfo(entry.title, entry.venue);
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
            const matchesCategory = currentCategoryFilter === 'All' || pub.category.id === currentCategoryFilter;
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
            img.src = `publications/thumbs/${thumbSlug}.jpg`;
            img.onerror = () => {
                img.onerror = null;
                img.src = pub.category.image;
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

            const catBadge = document.createElement('span');
            catBadge.className = 'pub-cat-badge';
            catBadge.textContent = pub.category.label;
            metaDiv.appendChild(catBadge);

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

    fetch('publications.bib')
        .then(response => {
            if (!response.ok) {
                throw new Error('Could not load publications.bib');
            }
            return response.text();
        })
        .then(data => {
            publicationsData = parseBibtex(data);
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
        })
        .catch(error => {
            console.error('Error fetching publications:', error);
            publicationsContainer.innerHTML = '<div class="text-center">Failed to load publications. Please ensure publications.bib exists.</div>';
        });
});
