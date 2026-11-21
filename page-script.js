/* Coub Tweaks — page script (MAIN world).
   Работает в контексте страницы: пробел и громкость.
   Включается/выключается флагами в localStorage, которые пишет content.js. */
(() => {
    'use strict';

    const volumeOn = () => {
        try { return localStorage.getItem('coub_ext_volume_on') === '1'; }
        catch (e) { return false; }
    };

    const spaceOn = () => {
        try { return localStorage.getItem('coub_ext_space_on') === '1'; }
        catch (e) { return false; }
    };

    /* ==================== ПРОБЕЛ — ПАУЗА/ПЛЕЙ ==================== */

    function isInputElement(target) {
        return !!target && (
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable
        );
    }

    function getActiveViewer() {
        const viewers = Array.from(document.querySelectorAll('.viewer, .coub__viewer, .coub--timeline .viewer'));
        if (viewers.length === 0) return null;
        if (viewers.length === 1) return viewers[0];

        const windowCenter = window.innerHeight / 2;
        let closestViewer = null;
        let minDistance = Infinity;

        viewers.forEach((viewer) => {
            const rect = viewer.getBoundingClientRect();
            const viewerCenter = rect.top + (rect.height / 2);
            const distance = Math.abs(windowCenter - viewerCenter);
            if (distance < minDistance) {
                minDistance = distance;
                closestViewer = viewer;
            }
        });

        return closestViewer;
    }

    window.addEventListener('keydown', (e) => {
        if (!spaceOn()) return;
        if ((e.code === 'Space' || e.keyCode === 32) && !isInputElement(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
    }, true);

    window.addEventListener('keyup', (e) => {
        if (!spaceOn()) return;
        if ((e.code === 'Space' || e.keyCode === 32) && !isInputElement(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const activeViewer = getActiveViewer();
            if (!activeViewer) return;

            if (activeViewer.coubPlayer && typeof activeViewer.coubPlayer.togglePlay === 'function') {
                activeViewer.coubPlayer.togglePlay();
            } else {
                const clickTarget = activeViewer.querySelector('.viewer__player, video, canvas') || activeViewer;
                clickTarget.click();
            }
        }
    }, true);

    /* ===================== ГРОМКОСТЬ + ЗАПОМИНАНИЕ ===================== */

    let savedVol = parseInt(localStorage.getItem('coub_custom_volume'), 10);
    if (isNaN(savedVol) || savedVol <= 0) savedVol = 3;

    let currentVol = savedVol;
    let isUpdating = false;

    function updateNativeSliderUI(floatVol) {
        const percent = (floatVol * 100) + '%';
        const elements = document.querySelectorAll(
            '.viewer__volume-control, .coub-volume-control, .volume-control, [class*="volume-control"]'
        );

        elements.forEach((ctrl) => {
            const bar = ctrl.querySelector('[class*="progress"], [class*="bar"], [class*="line-inner"]');
            if (bar) {
                bar.style.width = percent;
                bar.style.height = percent;
            }
            const handle = ctrl.querySelector('[class*="handle"], [class*="thumb"], [class*="pointer"]');
            if (handle) {
                handle.style.left = percent;
                handle.style.bottom = percent;
            }
        });
    }

    function updateVolumeControlUI(level) {
        document.querySelectorAll('.coub-hover-volume-box').forEach((box) => {
            const range = box.querySelector('.coub-hover-volume-range');
            const value = box.querySelector('.coub-hover-volume-value');

            if (range) {
                range.value = level.toString();
                range.style.setProperty('--vol', `${level}%`);
            }
            if (value) value.textContent = `${level}%`;
            box.classList.toggle('is-muted', level === 0);
        });
    }

    window.syncCoubVolume = function (val, sourceInput) {
        if (!volumeOn() || isUpdating) return;
        isUpdating = true;

        let level = parseInt(val, 10);
        if (isNaN(level)) level = 0;
        level = Math.max(0, Math.min(100, level));

        const floatVol = level / 100;

        if (level > 0) {
            currentVol = level;
            localStorage.setItem('coub_custom_volume', level.toString());
            localStorage.setItem('coub:player:volume', floatVol.toString());
        } else {
            localStorage.setItem('coub:player:volume', '0');
        }

        updateVolumeControlUI(level);

        document.querySelectorAll('video, audio').forEach((media) => {
            media.volume = floatVol;
            media.muted = (level === 0);
        });

        document.querySelectorAll('.viewer, .coub__viewer, .coub-v2-player').forEach((el) => {
            if (el.coubPlayer && typeof el.coubPlayer.setVolume === 'function') {
                el.coubPlayer.setVolume(floatVol);
            }
        });

        updateNativeSliderUI(floatVol);
        isUpdating = false;
    };

    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
        if (!volumeOn()) return origPlay.apply(this, arguments);

        let activeVol = parseInt(localStorage.getItem('coub_custom_volume'), 10);
        if (isNaN(activeVol) || activeVol <= 0) activeVol = currentVol || 3;

        const floatVol = activeVol / 100;
        this.volume = floatVol;
        this.muted = false;

        updateNativeSliderUI(floatVol);
        updateVolumeControlUI(activeVol);

        return origPlay.apply(this, arguments);
    };

    document.addEventListener('volumechange', (e) => {
        if (!volumeOn() || isUpdating || !e.target) return;
        const newVol = Math.round((e.target.muted ? 0 : e.target.volume) * 100);

        if (newVol === 0 && e.target.paused) return;

        if (newVol !== currentVol) {
            window.syncCoubVolume(newVol, null);
        }
    }, true);

    /* ======================= МОСТ ИЗ CONTENT SCRIPT ======================= */

    window.addEventListener('message', (e) => {
        const data = e.data;
        if (!data || data.__coubExt !== true) return;
        if (data.type === 'syncVolume') {
            window.syncCoubVolume(data.level, null);
        }
    });
})();
