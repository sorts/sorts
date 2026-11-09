document.addEventListener('DOMContentLoaded', () => {
    const containerEl = document.getElementById('gnm-floating-viewer');
    if (!containerEl) return;

    const savedCompactPref = sessionStorage.getItem('soe_gnm_viewer_compact');
    let isCompact = savedCompactPref !== null ? savedCompactPref === 'true' : false;

    const state = {
        animMode: 'gnm_spin',
        showEdgeflow: true,
        showWireframe: false,
        yawDeg: 0.0,
        pitchDeg: 0.0,
        distance: 0.92,
        fovDeg: 20.0,
        panX: 0.0,
        panY: -0.008
    };

    let gl = null;
    let canvasEl = null;
    let rafId = null;
    let isMeshLoaded = false;
    let isLoadingMesh = false;
    let startTime = performance.now();
    let renderOnceFn = null;

    function buildUI() {
        const isInlineMode = typeof window !== 'undefined' && window.innerWidth < 1400;
        containerEl.classList.toggle('is-inline-mode', isInlineMode);
        containerEl.classList.toggle('is-compact', isCompact);

        if (!containerEl.querySelector('.gnm-viewer-header')) {
            containerEl.innerHTML = `
                <div class="gnm-viewer-header">
                    <span class="gnm-viewer-title" id="gnm-viewer-title-click" title="3D GNM Head Model">
                        <span class="gnm-viewer-live-dot"></span>
                        <span class="gnm-viewer-title-text">3D GNM Fit</span>
                    </span>
                    <button type="button" id="gnm-viewer-toggle-btn" class="gnm-viewer-toggle-btn"></button>
                </div>
                <div class="gnm-viewer-body" id="gnm-viewer-body">
                    <div class="gnm-canvas-wrap">
                        <canvas id="gnm-webgl-canvas" class="gnm-webgl-canvas"></canvas>
                        <div class="gnm-loading-overlay" id="gnm-loading-overlay">Loading 3D GNM mesh&hellip;</div>
                        <a href="https://github.com/google/GNM" target="_blank" rel="noopener noreferrer" class="gnm-viewport-badge" title="Google Neural Model (GNM) Head v3.0 on GitHub">GNM Head v3.0 &#8599;</a>
                        <span class="gnm-orbit-hint">Drag to orbit</span>
                    </div>
                    <div class="gnm-viewer-footer">
                        <button type="button" class="gnm-ctrl-chip is-active" id="gnm-btn-spin" title="Toggle GNM Spin oscillation">GNM Spin</button>
                        <button type="button" class="gnm-ctrl-chip is-active" id="gnm-btn-edgeflow" title="Toggle UDIM 1001 Edge-Flow texture">Edge-Flow</button>
                        <button type="button" class="gnm-ctrl-chip" id="gnm-btn-wire" title="Toggle 3D wireframe overlay">Wire</button>
                    </div>
                </div>
            `;

            const toggleBtn = document.getElementById('gnm-viewer-toggle-btn');
            const titleClick = document.getElementById('gnm-viewer-title-click');

            const toggleCollapse = () => {
                isCompact = !isCompact;
                sessionStorage.setItem('soe_gnm_viewer_compact', String(isCompact));
                syncUIState();
            };

            if (toggleBtn) {
                toggleBtn.addEventListener('click', toggleCollapse);
            }
            if (titleClick) {
                titleClick.addEventListener('click', () => {
                    if (isCompact) {
                        isCompact = false;
                        sessionStorage.setItem('soe_gnm_viewer_compact', 'false');
                        syncUIState();
                    }
                });
            }

            const btnSpin = document.getElementById('gnm-btn-spin');
            const btnEdge = document.getElementById('gnm-btn-edgeflow');
            const btnWire = document.getElementById('gnm-btn-wire');

            if (btnSpin) {
                btnSpin.addEventListener('click', () => {
                    if (state.animMode === 'gnm_spin') {
                        state.animMode = 'none';
                    } else {
                        state.animMode = 'gnm_spin';
                        state.panX = 0.0;
                        state.panY = -0.008;
                        state.distance = 0.92;
                    }
                    syncControlButtons();
                });
            }

            if (btnEdge) {
                btnEdge.addEventListener('click', () => {
                    state.showEdgeflow = !state.showEdgeflow;
                    syncControlButtons();
                });
            }

            if (btnWire) {
                btnWire.addEventListener('click', () => {
                    state.showWireframe = !state.showWireframe;
                    syncControlButtons();
                });
            }
        }

        syncUIState();
    }

    function syncControlButtons() {
        const btnSpin = document.getElementById('gnm-btn-spin');
        const btnEdge = document.getElementById('gnm-btn-edgeflow');
        const btnWire = document.getElementById('gnm-btn-wire');
        if (btnSpin) btnSpin.classList.toggle('is-active', state.animMode === 'gnm_spin');
        if (btnEdge) btnEdge.classList.toggle('is-active', state.showEdgeflow);
        if (btnWire) btnWire.classList.toggle('is-active', state.showWireframe);
    }

    function syncUIState() {
        const isInlineMode = typeof window !== 'undefined' && window.innerWidth < 1400;
        containerEl.classList.toggle('is-inline-mode', isInlineMode);
        containerEl.classList.toggle('is-compact', isCompact);

        const toggleBtn = document.getElementById('gnm-viewer-toggle-btn');
        if (toggleBtn) {
            if (isInlineMode) {
                toggleBtn.innerHTML = isCompact ? 'Expand 3D &#9662;' : 'Collapse &#9652;';
                toggleBtn.title = isCompact ? 'Expand 3D GNM viewer' : 'Collapse 3D GNM viewer';
            } else {
                toggleBtn.innerHTML = isCompact ? 'Expand &rarr;|' : '|&larr; Compact';
                toggleBtn.title = isCompact ? 'Expand 3D GNM viewer' : 'Collapse 3D GNM viewer';
            }
        }

        if (!isCompact) {
            if (!isMeshLoaded && !isLoadingMesh) {
                initWebGLViewer();
            } else if (isMeshLoaded && !rafId && renderOnceFn) {
                startTime = performance.now();
                rafId = requestAnimationFrame(renderOnceFn);
            }
        } else {
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        }
    }

    function b64ToBytes(b64) {
        const bin = atob(b64);
        const len = bin.length;
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            out[i] = bin.charCodeAt(i);
        }
        return out;
    }

    async function initWebGLViewer() {
        isLoadingMesh = true;
        const overlayEl = document.getElementById('gnm-loading-overlay');
        canvasEl = document.getElementById('gnm-webgl-canvas');
        if (!canvasEl) {
            isLoadingMesh = false;
            return;
        }

        try {
            const resp = await fetch('assets/sergio_gnm_head.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const payload = await resp.json();

            gl = canvasEl.getContext('webgl', { antialias: true, alpha: false, depth: true });
            if (!gl) throw new Error('WebGL not supported');

            const extAniso = (
                gl.getExtension('EXT_texture_filter_anisotropic') ||
                gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
                gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
            );

            const num3D = payload.num3D;
            const numUV = payload.numUV;
            const numTris = payload.numTris;
            const targetCenter = payload.targetCenter;

            const curVerts3D = new Float32Array(b64ToBytes(payload.vCfg4F32).buffer);
            const facesUV = new Uint16Array(b64ToBytes(payload.facesUVU16).buffer);
            const mapUVTo3D = new Uint16Array(b64ToBytes(payload.mapUVTo3DU16).buffer);
            const uvCoords = new Float32Array(b64ToBytes(payload.uvCoordsF32).buffer);
            const uvIsSkin = b64ToBytes(payload.uvIsSkinU8);
            const vc3DU8 = b64ToBytes(payload.vc3DU8);

            // Compute area-weighted smooth 3D vertex normals
            const curNorms3D = new Float32Array(num3D * 3);
            for (let t = 0; t < numTris; t++) {
                const i0 = mapUVTo3D[facesUV[t * 3]] * 3;
                const i1 = mapUVTo3D[facesUV[t * 3 + 1]] * 3;
                const i2 = mapUVTo3D[facesUV[t * 3 + 2]] * 3;
                const ax = curVerts3D[i1] - curVerts3D[i0];
                const ay = curVerts3D[i1 + 1] - curVerts3D[i0 + 1];
                const az = curVerts3D[i1 + 2] - curVerts3D[i0 + 2];
                const bx = curVerts3D[i2] - curVerts3D[i0];
                const by = curVerts3D[i2 + 1] - curVerts3D[i0 + 1];
                const bz = curVerts3D[i2 + 2] - curVerts3D[i0 + 2];
                const nx = ay * bz - az * by;
                const ny = az * bx - ax * bz;
                const nz = ax * by - ay * bx;
                curNorms3D[i0] += nx; curNorms3D[i0 + 1] += ny; curNorms3D[i0 + 2] += nz;
                curNorms3D[i1] += nx; curNorms3D[i1 + 1] += ny; curNorms3D[i1 + 2] += nz;
                curNorms3D[i2] += nx; curNorms3D[i2 + 1] += ny; curNorms3D[i2 + 2] += nz;
            }
            for (let i = 0; i < num3D; i++) {
                const idx = i * 3;
                const l = Math.hypot(curNorms3D[idx], curNorms3D[idx + 1], curNorms3D[idx + 2]) || 1e-8;
                curNorms3D[idx] /= l;
                curNorms3D[idx + 1] /= l;
                curNorms3D[idx + 2] /= l;
            }

            const uvPositions = new Float32Array(numUV * 3);
            const uvNormals = new Float32Array(numUV * 3);
            const uvColors = new Float32Array(numUV * 3);
            const uvSkinFlag = new Float32Array(numUV);

            for (let k = 0; k < numUV; k++) {
                const v3 = mapUVTo3D[k] * 3;
                const u3 = k * 3;
                uvPositions[u3] = curVerts3D[v3];
                uvPositions[u3 + 1] = curVerts3D[v3 + 1];
                uvPositions[u3 + 2] = curVerts3D[v3 + 2];
                uvNormals[u3] = curNorms3D[v3];
                uvNormals[u3 + 1] = curNorms3D[v3 + 1];
                uvNormals[u3 + 2] = curNorms3D[v3 + 2];
                uvColors[u3] = vc3DU8[v3] / 255.0;
                uvColors[u3 + 1] = vc3DU8[v3 + 1] / 255.0;
                uvColors[u3 + 2] = vc3DU8[v3 + 2] / 255.0;
                uvSkinFlag[k] = uvIsSkin[k];
            }

            const wireIndices = new Uint16Array(numTris * 6);
            for (let i = 0; i < numTris; i++) {
                const i0 = facesUV[i * 3];
                const i1 = facesUV[i * 3 + 1];
                const i2 = facesUV[i * 3 + 2];
                const b = i * 6;
                wireIndices[b] = i0; wireIndices[b + 1] = i1;
                wireIndices[b + 2] = i1; wireIndices[b + 3] = i2;
                wireIndices[b + 4] = i2; wireIndices[b + 5] = i0;
            }

            const vsSource = `
                attribute vec3 aPosition;
                attribute vec3 aNormal;
                attribute vec2 aUV;
                attribute vec3 aColor;
                attribute float aIsSkin;

                uniform mat4 uView;
                uniform mat4 uProj;
                uniform float uDepthBias;

                varying vec3 vPosCam;
                varying vec3 vNormCam;
                varying vec2 vUV;
                varying vec3 vColor;
                varying float vIsSkin;

                void main() {
                    vec4 posCam = uView * vec4(aPosition, 1.0);
                    posCam.z += uDepthBias;
                    vPosCam = posCam.xyz;
                    vNormCam = mat3(uView) * aNormal;
                    vUV = aUV;
                    vColor = aColor;
                    vIsSkin = aIsSkin;
                    gl_Position = uProj * posCam;
                }
            `;

            const fsSource = `
                precision highp float;

                varying vec3 vPosCam;
                varying vec3 vNormCam;
                varying vec2 vUV;
                varying vec3 vColor;
                varying float vIsSkin;

                uniform sampler2D uEdgeflowTex;
                uniform float uShowEdgeflow;
                uniform int uIsWirePass;

                const float PI = 3.141592653589793;
                const float MIN_ROUGHNESS = 0.04;

                void main() {
                    if (uIsWirePass == 1) {
                        gl_FragColor = vec4(0.05, 0.14, 0.24, 0.55);
                        return;
                    }

                    vec3 n = normalize(vNormCam);
                    if (!gl_FrontFacing) n = -n;

                    float efRaw = texture2D(uEdgeflowTex, vUV).r;
                    float efMod = mix(1.0, efRaw * 0.5 + 0.5, vIsSkin * uShowEdgeflow);

                    vec3 baseColor = vec3(efMod);
                    vec3 c_diff = baseColor * (1.0 - MIN_ROUGHNESS);
                    vec3 f0 = vec3(MIN_ROUGHNESS);

                    vec3 l = normalize(vec3(1.0, 1.0, 1.0));
                    vec3 v = normalize(-vPosCam);
                    vec3 h = normalize(l + v);

                    float nl = clamp((dot(n, l) + 0.8) / 1.8, 0.0, 1.0);
                    float nv = clamp(abs(dot(n, v)), 0.001, 1.0);
                    float vh = clamp(dot(v, h), 0.0, 1.0);

                    vec3 F = f0 + (1.0 - f0) * pow(clamp(1.0 - vh, 0.0, 1.0), 5.0);
                    float k = 0.5;
                    float g1 = nv / (nv * (1.0 - k) + k);
                    float g2 = nl / (nl * (1.0 - k) + k);
                    float G = g1 * g2;
                    float D = 1.0 / PI;

                    vec3 diffuseContrib = (1.0 - F) * c_diff / PI;
                    vec3 specContrib = F * G * D / (4.0 * nl * nv + 0.001);

                    vec3 radiance = vec3(3.34);
                    vec3 litColor = nl * radiance * (diffuseContrib + specContrib) * vColor;

                    gl_FragColor = vec4(clamp(litColor, 0.0, 1.0), 1.0);
                }
            `;

            function compileShader(type, src) {
                const sh = gl.createShader(type);
                gl.shaderSource(sh, src);
                gl.compileShader(sh);
                return sh;
            }

            const prog = gl.createProgram();
            gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSource));
            gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSource));
            gl.linkProgram(prog);
            gl.useProgram(prog);

            const loc = {
                aPosition: gl.getAttribLocation(prog, 'aPosition'),
                aNormal: gl.getAttribLocation(prog, 'aNormal'),
                aUV: gl.getAttribLocation(prog, 'aUV'),
                aColor: gl.getAttribLocation(prog, 'aColor'),
                aIsSkin: gl.getAttribLocation(prog, 'aIsSkin'),
                uView: gl.getUniformLocation(prog, 'uView'),
                uProj: gl.getUniformLocation(prog, 'uProj'),
                uDepthBias: gl.getUniformLocation(prog, 'uDepthBias'),
                uEdgeflowTex: gl.getUniformLocation(prog, 'uEdgeflowTex'),
                uShowEdgeflow: gl.getUniformLocation(prog, 'uShowEdgeflow'),
                uIsWirePass: gl.getUniformLocation(prog, 'uIsWirePass')
            };

            const bufPos = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
            gl.bufferData(gl.ARRAY_BUFFER, uvPositions, gl.STATIC_DRAW);

            const bufNorm = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, bufNorm);
            gl.bufferData(gl.ARRAY_BUFFER, uvNormals, gl.STATIC_DRAW);

            const bufUV = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, bufUV);
            gl.bufferData(gl.ARRAY_BUFFER, uvCoords, gl.STATIC_DRAW);

            const bufColor = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, bufColor);
            gl.bufferData(gl.ARRAY_BUFFER, uvColors, gl.STATIC_DRAW);

            const bufSkin = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, bufSkin);
            gl.bufferData(gl.ARRAY_BUFFER, uvSkinFlag, gl.STATIC_DRAW);

            const bufFaces = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufFaces);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, facesUV, gl.STATIC_DRAW);

            const bufWire = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufWire);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wireIndices, gl.STATIC_DRAW);

            const edgeflowTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, edgeflowTex);
            gl.texImage2D(
                gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([255, 255, 255, 255])
            );

            const efImg = new Image();
            efImg.onload = () => {
                gl.bindTexture(gl.TEXTURE_2D, edgeflowTex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, efImg);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                if (extAniso) {
                    const maxAniso = gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
                    gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso));
                }
            };
            efImg.src = 'data:image/png;base64,' + payload.edgeflowPngB64;

            function computeViewAndProj(aspect) {
                const yaw = (state.yawDeg * Math.PI) / 180.0;
                const pitch = (state.pitchDeg * Math.PI) / 180.0;
                const tx = targetCenter[0] + state.panX;
                const ty = targetCenter[1] + state.panY;
                const tz = targetCenter[2];

                const cx = tx + state.distance * Math.cos(pitch) * Math.sin(yaw);
                const cy = ty + state.distance * Math.sin(pitch);
                const cz = tz + state.distance * Math.cos(pitch) * Math.cos(yaw);

                let zx = cx - tx, zy = cy - ty, zz = cz - tz;
                const zl = Math.hypot(zx, zy, zz) || 1.0;
                zx /= zl; zy /= zl; zz /= zl;

                let xx = zz, xy = 0.0, xz = -zx;
                const xl = Math.hypot(xx, xy, xz) || 1.0;
                xx /= xl; xy /= xl; xz /= xl;

                const yx = zy * xz - zz * xy;
                const yy = zz * xx - zx * xz;
                const yz = zx * xy - zy * xx;

                const view = new Float32Array([
                    xx, yx, zx, 0,
                    xy, yy, zy, 0,
                    xz, yz, zz, 0,
                    -(xx * cx + xy * cy + xz * cz),
                    -(yx * cx + yy * cy + yz * cz),
                    -(zz * cz + zx * cx + zy * cy),
                    1
                ]);

                const f = 1.0 / Math.tan(((state.fovDeg * Math.PI) / 180.0) * 0.5);
                const near = 0.1, far = 4.0, nf = 1.0 / (near - far);
                const proj = new Float32Array([
                    f / aspect, 0, 0, 0,
                    0, f, 0, 0,
                    0, 0, (far + near) * nf, -1,
                    0, 0, 2 * far * near * nf, 0
                ]);

                return { view, proj };
            }

            renderOnceFn = function renderFrame(now) {
                if (isCompact) {
                    rafId = null;
                    return;
                }
                const dt = (now - startTime) * 0.001;
                if (state.animMode === 'gnm_spin') {
                    state.yawDeg = Math.sin(dt * 1.6) * 22.0;
                    state.pitchDeg = Math.cos(dt * 1.6) * 5.0;
                }

                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                const cssW = canvasEl.clientWidth || 240;
                const cssH = canvasEl.clientHeight || 248;
                const w = Math.floor(cssW * dpr);
                const h = Math.floor(cssH * dpr);

                if (canvasEl.width !== w || canvasEl.height !== h) {
                    canvasEl.width = w;
                    canvasEl.height = h;
                }

                gl.viewport(0, 0, w, h);
                gl.clearColor(0.059, 0.078, 0.110, 1.0);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                gl.enable(gl.DEPTH_TEST);

                const { view, proj } = computeViewAndProj(w / h);

                gl.useProgram(prog);
                gl.uniformMatrix4fv(loc.uView, false, view);
                gl.uniformMatrix4fv(loc.uProj, false, proj);
                gl.uniform1f(loc.uDepthBias, 0.0);
                gl.uniform1f(loc.uShowEdgeflow, state.showEdgeflow ? 1.0 : 0.0);
                gl.uniform1i(loc.uIsWirePass, 0);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, edgeflowTex);
                gl.uniform1i(loc.uEdgeflowTex, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
                gl.enableVertexAttribArray(loc.aPosition);
                gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, bufNorm);
                gl.enableVertexAttribArray(loc.aNormal);
                gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, bufUV);
                gl.enableVertexAttribArray(loc.aUV);
                gl.vertexAttribPointer(loc.aUV, 2, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, bufColor);
                gl.enableVertexAttribArray(loc.aColor);
                gl.vertexAttribPointer(loc.aColor, 3, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ARRAY_BUFFER, bufSkin);
                gl.enableVertexAttribArray(loc.aIsSkin);
                gl.vertexAttribPointer(loc.aIsSkin, 1, gl.FLOAT, false, 0, 0);

                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufFaces);
                gl.drawElements(gl.TRIANGLES, numTris * 3, gl.UNSIGNED_SHORT, 0);

                if (state.showWireframe) {
                    gl.enable(gl.BLEND);
                    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                    gl.uniform1f(loc.uDepthBias, 0.0008);
                    gl.uniform1i(loc.uIsWirePass, 1);
                    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufWire);
                    gl.drawElements(gl.LINES, numTris * 6, gl.UNSIGNED_SHORT, 0);
                    gl.disable(gl.BLEND);
                }

                rafId = requestAnimationFrame(renderOnceFn);
            };

            // Interactive drag-to-orbit & wheel zoom
            let isDragging = false;
            let lastX = 0, lastY = 0;

            canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
            canvasEl.addEventListener('pointerdown', (e) => {
                isDragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                if (state.animMode !== 'none') {
                    state.animMode = 'none';
                    syncControlButtons();
                }
                canvasEl.setPointerCapture(e.pointerId);
            });

            canvasEl.addEventListener('pointermove', (e) => {
                if (!isDragging) return;
                const dx = e.clientX - lastX;
                const dy = e.clientY - lastY;
                lastX = e.clientX;
                lastY = e.clientY;
                state.yawDeg -= dx * 0.45;
                state.pitchDeg = Math.max(-70, Math.min(70, state.pitchDeg + dy * 0.45));
            });

            canvasEl.addEventListener('pointerup', (e) => {
                isDragging = false;
                try {
                    canvasEl.releasePointerCapture(e.pointerId);
                } catch (_) {}
            });

            canvasEl.addEventListener('wheel', (e) => {
                e.preventDefault();
                const factor = Math.exp(e.deltaY * 0.001);
                state.distance = Math.max(0.55, Math.min(1.6, state.distance * factor));
            }, { passive: false });

            isMeshLoaded = true;
            isLoadingMesh = false;
            if (overlayEl) {
                overlayEl.style.display = 'none';
            }

            if (!isCompact) {
                startTime = performance.now();
                rafId = requestAnimationFrame(renderOnceFn);
            }
        } catch (err) {
            console.error('Failed to load GNM 3D viewer:', err);
            isLoadingMesh = false;
            if (overlayEl) {
                overlayEl.textContent = '3D viewer unavailable';
            }
        }
    }

    buildUI();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            syncUIState();
        }, 100);
    });
});
