document.addEventListener('DOMContentLoaded', () => {
    const profilePic = document.querySelector('.profile-pic');
    if (!profilePic) return;

    const ORIGINAL_PROFILE_SRC = profilePic.getAttribute('src') || 'profile.png';
    const RETRO_PROFILE_SRC = 'assets/profile_8bit.png';

    let isRetroMode = false;
    let isBgmMuted = false;
    let clickCount = 0;
    let clickTimer = null;

    let audioCtx = null;
    let bgmInterval = null;
    let bgmStep = 0;
    let noiseBuffer = null;

    function ensureAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        if (audioCtx && !noiseBuffer) {
            const bufferSize = audioCtx.sampleRate * 0.5;
            noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            // LFSR-like stepped noise for authentic NES 2A03 noise channel
            let lfsr = 1;
            for (let i = 0; i < bufferSize; i++) {
                if (i % 6 === 0) {
                    const bit = ((lfsr >> 0) ^ (lfsr >> 1)) & 1;
                    lfsr = (lfsr >> 1) | (bit << 14);
                }
                data[i] = (lfsr & 1) ? 0.8 : -0.8;
            }
        }
        return audioCtx;
    }

    function playSquareTone(freq, startTime, duration, gainVal = 0.08, endFreq = null, type = 'square') {
        const ctx = ensureAudioContext();
        if (!ctx || !freq) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        if (endFreq !== null) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startTime + duration);
        }

        gain.gain.setValueAtTime(gainVal, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration + 0.01);
    }

    function playNoiseHit(startTime, duration = 0.045, gainVal = 0.035, highpassFreq = 1800) {
        const ctx = ensureAudioContext();
        if (!ctx || !noiseBuffer) return;

        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(highpassFreq, startTime);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(gainVal, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        src.start(startTime);
        src.stop(startTime + duration + 0.01);
    }

    // Classic NES Coin Sound (B5 -> E6)
    function playNesCoinSfx() {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        playSquareTone(987.77, now, 0.075, 0.09);        // B5
        playSquareTone(1318.51, now + 0.075, 0.28, 0.09); // E6
    }

    // Classic NES 1-UP Mushroom Fanfare (E5 - G5 - E6 - C6 - D6 - G6)
    function playNesOneUpSfx() {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const notes = [659.25, 783.99, 1318.51, 1046.50, 1174.66, 1567.98];
        const step = 0.095;
        notes.forEach((f, idx) => {
            playSquareTone(f, now + idx * step, step * 0.92, 0.10);
            playSquareTone(f * 0.5, now + idx * step, step * 0.92, 0.05, null, 'triangle');
        });
    }

    // Classic NES Warp Pipe / Power-Down SFX (3 descending stepped bursts)
    function playNesWarpPipeSfx() {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        for (let burst = 0; burst < 3; burst++) {
            const bStart = now + burst * 0.16;
            const freqs = [783.99, 659.25, 523.25, 392.00, 329.63, 246.94];
            freqs.forEach((f, i) => {
                playSquareTone(f, bStart + i * 0.022, 0.022, 0.085);
            });
        }
    }

    // Classic NES Pause Sound (E6 - C6 - E6 - C6)
    function playNesPauseSfx() {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const notes = [1318.51, 1046.50, 1318.51, 1046.50];
        notes.forEach((f, i) => {
            playSquareTone(f, now + i * 0.065, 0.06, 0.075);
        });
    }

    // Classic NES Jump / Menu Select Blip
    function playNesSelectSfx() {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        playSquareTone(330.0, now, 0.09, 0.065, 880.0);
    }

    // Subtle NES Cursor Tick
    let lastTickTime = 0;
    function playNesCursorTick() {
        const perfNow = performance.now();
        if (perfNow - lastTickTime < 55) return;
        lastTickTime = perfNow;
        const ctx = ensureAudioContext();
        if (!ctx) return;
        playSquareTone(1174.66, ctx.currentTime, 0.018, 0.028);
    }

    // =========================================================================
    // NES 2A03 Overworld Adventure Chiptune Sequencer (4 Channels)
    // =========================================================================
    const N = {
        _: 0,
        C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
        C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.00, Gs4: 415.30, A4: 440.00, Bb4: 466.16, B4: 493.88,
        C5: 523.25, D5: 587.33, Dis5: 622.25, E5: 659.25, F5: 698.46, Fs5: 739.99, G5: 783.99, A5: 880.00, Bb5: 932.33, B5: 987.77,
        C6: 1046.50, D6: 1174.66, E6: 1318.51
    };

    // 64-step (4-bar, 16th-note) upbeat 8-bit Nintendo Overworld Adventure loop
    const MELODY_SEQ = [
        // Bar 1: Classic bouncy C-major NES opening
        N.E5, N.E5, N._,  N.E5, N._,  N.C5, N.E5, N._,
        N.G5, N._,  N._,  N._,  N.G4, N._,  N._,  N._,
        // Bar 2: Overworld adventurephrase A
        N.C5, N._,  N._,  N.G4, N._,  N._,  N.E4, N._,
        N._,  N.A4, N._,  N.B4, N._,  N.Bb4,N.A4, N._,
        // Bar 3: Triplet-feel run up to A5/F5/G5
        N.G4, N.E5, N.G5, N.A5, N._,  N.F5, N.G5, N._,
        N.E5, N._,  N.C5, N.D5, N.B4, N._,  N._,  N._,
        // Bar 4: Chromatic NES turnaround
        N._,  N._,  N.G5, N.Fs5,N.F5, N.Dis5,N._, N.E5,
        N._,  N.Gs4,N.A4, N.C5, N._,  N.A4, N.C5, N.D5
    ];

    const HARMONY_SEQ = [
        // Bar 1
        N.Fs4,N.Fs4,N._,  N.Fs4,N._,  N.Fs4,N.Fs4,N._,
        N.B4, N._,  N._,  N._,  N.G4, N._,  N._,  N._,
        // Bar 2
        N.E4, N._,  N._,  N.C4, N._,  N._,  N.G3, N._,
        N._,  N.C4, N._,  N.D4, N._,  N.D4, N.C4, N._,
        // Bar 3
        N.C4, N.G4, N.B4, N.C5, N._,  N.A4, N.B4, N._,
        N.G4, N._,  N.E4, N.F4, N.D4, N._,  N._,  N._,
        // Bar 4
        N._,  N._,  N.E5, N.Dis5,N.D5,N.B4, N._,  N.C5,
        N._,  N.E4, N.F4, N.A4, N._,  N.C4, N.E4, N.F4
    ];

    const BASS_SEQ = [
        // Bar 1
        N.D3, N.D3, N._,  N.D3, N._,  N.D3, N.D3, N._,
        N.G3, N._,  N._,  N._,  N.G3, N._,  N._,  N._,
        // Bar 2
        N.G3, N._,  N._,  N.E3, N._,  N._,  N.C3, N._,
        N._,  N.F3, N._,  N.G3, N._,  N.G3, N.F3, N._,
        // Bar 3
        N.C3, N.E3, N.G3, N.C4, N._,  N.F3, N.G3, N._,
        N.C4, N._,  N.G3, N.G3, N.G3, N._,  N._,  N._,
        // Bar 4
        N.C3, N._,  N.G3, N._,  N.C4, N._,  N.F3, N._,
        N.F3, N._,  N.C3, N.F3, N._,  N.F3, N.G3, N.G3
    ];

    function startChiptuneLoop() {
        stopChiptuneLoop();
        bgmStep = 0;
        const stepMs = 130; // ~115 BPM 16th notes
        const stepSec = stepMs / 1000;

        bgmInterval = setInterval(() => {
            if (!isRetroMode || isBgmMuted) return;
            const ctx = ensureAudioContext();
            if (!ctx) return;

            const now = ctx.currentTime + 0.01;
            const idx = bgmStep % MELODY_SEQ.length;

            const mel = MELODY_SEQ[idx];
            const harm = HARMONY_SEQ[idx];
            const bass = BASS_SEQ[idx];

            if (mel > 0) {
                playSquareTone(mel, now, stepSec * 0.82, 0.045, null, 'square');
            }
            if (harm > 0) {
                playSquareTone(harm, now, stepSec * 0.78, 0.028, null, 'square');
            }
            if (bass > 0) {
                playSquareTone(bass, now, stepSec * 0.9, 0.075, null, 'triangle');
            }

            // Percussion: kick/hat on even steps, snare on backbeats (steps 4, 12)
            if (idx % 4 === 0) {
                playNoiseHit(now, 0.025, 0.018, 3500);
            } else if (idx % 4 === 2) {
                playNoiseHit(now, 0.055, 0.032, 1200);
            }

            bgmStep++;
        }, stepMs);
    }

    function stopChiptuneLoop() {
        if (bgmInterval) {
            clearInterval(bgmInterval);
            bgmInterval = null;
        }
    }

    // =========================================================================
    // NES Top Scoreboard HUD & Floating +1UP Popup
    // =========================================================================
    let hudEl = null;

    function ensureNesHud() {
        if (hudEl) return hudEl;
        hudEl = document.createElement('div');
        hudEl.id = 'nes-arcade-hud';
        hudEl.className = 'nes-arcade-hud';
        hudEl.innerHTML = `
            <div class="nes-hud-col">
                <span class="nes-hud-label">SERGIO</span>
                <span class="nes-hud-val" id="nes-hud-score">009980</span>
            </div>
            <div class="nes-hud-col">
                <span class="nes-hud-label">COINS</span>
                <span class="nes-hud-val"><span class="nes-coin-icon"></span>&times;<span id="nes-hud-coins">86</span></span>
            </div>
            <div class="nes-hud-col">
                <span class="nes-hud-label">WORLD</span>
                <span class="nes-hud-val">ZURICH-1</span>
            </div>
            <div class="nes-hud-col">
                <button type="button" id="nes-bgm-toggle" class="nes-hud-btn" title="Toggle 8-Bit Chiptune Music">&#9835; BGM: ON</button>
            </div>
        `;
        document.body.prepend(hudEl);

        const bgmBtn = document.getElementById('nes-bgm-toggle');
        if (bgmBtn) {
            bgmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                isBgmMuted = !isBgmMuted;
                bgmBtn.innerHTML = isBgmMuted ? '&#9835; BGM: OFF' : '&#9835; BGM: ON';
                bgmBtn.classList.toggle('is-muted', isBgmMuted);
                playNesCoinSfx();
            });
        }
        return hudEl;
    }

    function spawnOneUpPopup(text = '1UP!') {
        const rect = profilePic.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.className = 'nes-oneup-popup';
        pop.textContent = text;
        pop.style.left = `${rect.left + rect.width * 0.5}px`;
        pop.style.top = `${rect.top + window.scrollY - 10}px`;
        document.body.appendChild(pop);
        setTimeout(() => pop.remove(), 1100);
    }

    function bumpHudScore(points = 200, coins = 1) {
        if (!isRetroMode) return;
        const scoreEl = document.getElementById('nes-hud-score');
        const coinsEl = document.getElementById('nes-hud-coins');
        if (scoreEl) {
            const cur = parseInt(scoreEl.textContent, 10) || 9980;
            scoreEl.textContent = String(cur + points).padStart(6, '0');
        }
        if (coinsEl) {
            const curC = parseInt(coinsEl.textContent, 10) || 86;
            coinsEl.textContent = String((curC + coins) % 100).padStart(2, '0');
        }
    }

    // =========================================================================
    // Activate / Deactivate 8-Bit Nintendo Mode
    // =========================================================================
    function setRetroMode(active) {
        isRetroMode = active;
        ensureNesHud();

        if (active) {
            document.documentElement.setAttribute('data-retro', '8bit');
            profilePic.src = RETRO_PROFILE_SRC;
            playNesOneUpSfx();
            spawnOneUpPopup('1UP! 8-BIT MODE');
            setTimeout(() => {
                if (isRetroMode) startChiptuneLoop();
            }, 620);
        } else {
            stopChiptuneLoop();
            playNesWarpPipeSfx();
            spawnOneUpPopup('WARP OUT!');
            document.documentElement.removeAttribute('data-retro');
            profilePic.src = ORIGINAL_PROFILE_SRC;
        }

        window.dispatchEvent(new CustomEvent('retro8bitChange', {
            detail: { active: isRetroMode }
        }));
    }

    // Preload 8-bit avatar image so switching is instantaneous
    const preloadImg = new Image();
    preloadImg.src = RETRO_PROFILE_SRC;

    // Triple-click handler on .profile-pic
    profilePic.style.cursor = 'pointer';
    profilePic.addEventListener('click', (e) => {
        e.preventDefault();
        clickCount++;

        profilePic.classList.remove('nes-coin-bump');
        void profilePic.offsetWidth;
        profilePic.classList.add('nes-coin-bump');

        clearTimeout(clickTimer);

        if (clickCount < 3) {
            playNesCoinSfx();
            clickTimer = setTimeout(() => {
                clickCount = 0;
            }, 1200);
        } else {
            clickCount = 0;
            setRetroMode(!isRetroMode);
        }
    });

    // Global delegated retro sound effects when in 8-bit mode
    document.addEventListener('click', (e) => {
        if (!isRetroMode) return;
        if (e.target === profilePic || profilePic.contains(e.target)) return;

        const btn = e.target.closest('button, a, .filter-btn, .category-btn, .gnm-ctrl-chip');
        if (!btn) return;

        if (btn.classList.contains('news-spine-toggle-btn') || btn.classList.contains('gnm-viewer-toggle-btn')) {
            playNesPauseSfx();
        } else if (btn.id !== 'nes-bgm-toggle') {
            playNesSelectSfx();
            bumpHudScore(100, 1);
        }
    });

    document.addEventListener('mouseover', (e) => {
        if (!isRetroMode) return;
        const interactive = e.target.closest('button, a.nav-link, .filter-btn, .category-btn, .gnm-ctrl-chip, .pub-link');
        if (interactive) {
            playNesCursorTick();
        }
    });
});
