/* Coub Tweaks — content script (изолированный мир).
   Отвечает за CSS, элементы интерфейса и настройки.
   Логика внутри страницы (пробел, громкость) — в page-script.js. */
(() => {
    'use strict';

    const DEFAULTS = {
        enabled: true,
        darkOverlay: true,
        layout: true,
        sidebar: true,
        spaceKey: true,
        volume: true,
        downloads: true,
        sharpen: true,
        avatar: true
    };

    let flags = { ...DEFAULTS };
    let lastPath = '';
    const pendingDownloads = new Set();
    const failedDownloads = new Map(); // coubId -> timestamp последней ошибки
    const DOWNLOAD_RETRY_MS = 30000;

    /* ============================ CSS ============================ */

    const CSS = {
        darkOverlay: `
            /* === ТОЧЕЧНОЕ УДАЛЕНИЕ ЗАТЕМНЕНИЙ ПЛЕЕРА === */
            .viewer__dark,
            .viewer__shade,
            .viewer__backdrop,
            .viewer__pause-overlay,
            .viewer__suggests,
            .viewer__suggests--fit-cover,
            .viewer__suggests-fill,
            .viewer__suggests-control,
            .viewer__suggests-list-v2,
            .coub--timeline__suggestions,
            .coub-suggestions {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                background: transparent !important;
            }

            /* Очищаем полупрозрачные фоны плеера, не затрагивая тему сайта */
            .viewer,
            .viewer__player,
            .coub__viewer,
            .coub--timeline .viewer,
            .coub-block-card__coub-viewer {
                background-color: transparent !important;
                background: transparent !important;
                box-shadow: none !important;
                filter: none !important;
            }

            /* Отключение затемняющих псевдоэлементов плеера */
            .viewer::before,
            .viewer::after,
            .viewer__player::before,
            .viewer__player::after,
            .viewer__bare::before,
            .viewer__bare::after,
            .coub__viewer::before,
            .coub__viewer::after,
            .coub-block-card__coub-viewer::before,
            .coub-block-card__coub-viewer::after {
                content: none !important;
                background: none !important;
                display: none !important;
            }

            /* Принудительно скрываем служебные затемняющие блоки */
            .viewer__black-screen,
            .viewer__black-screen.-fill {
                display: none !important;
                opacity: 0 !important;
                background: transparent !important;
            }

            /* Отображение видео без фильтров и поверх фонового слоя */
            .viewer video,
            .viewer canvas,
            .viewer__player video,
            .viewer__player canvas,
            .viewer__bare video {
                display: block !important;
                opacity: 1 !important;
                visibility: visible !important;
                filter: none !important;
                z-index: 1 !important;
            }
        `,

        layout: `
            /* === БАЗОВЫЙ ФИКС ВЁРСТКИ И ПЛЕЕРА 1360x720 === */
            .timeline-right-block {
                display: none !important;
            }

            .page__body {
                width: 100% !important;
                padding-left: 0px !important;
                margin-left: -200px !important;
            }

            .coubs-list[view='list'] .coub--timeline,
            .coubs-list[view='listWithoutScroll'] .coub--timeline {
                width: 140% !important;
            }

            .coub__viewer .viewer,
            .coub--timeline .viewer {
                width: 1360px !important;
                height: 720px !important;
                background-color: #000000 !important;
                position: relative !important;
            }

            .coub__viewer .viewer video,
            .coub__viewer .viewer canvas,
            .viewer__player video,
            .coub-v2-player__video-container video,
            .coub--timeline .viewer video {
                object-fit: contain !important;
                width: 100% !important;
                height: 100% !important;
                max-width: 100% !important;
                max-height: 100% !important;
            }

            .coub__viewer .viewer__player,
            .coub--timeline .viewer__player {
                position: inherit !important;
                width: 100% !important;
                height: 100% !important;
            }

            .coub__viewer .viewer__img,
            .coub--timeline .viewer__img {
                display: none !important;
            }

            .coub__viewer,
            .coub--timeline {
                max-width: 1360px !important;
                width: 1360px !important;
                position: relative !important;
            }

            .coub__info {
                width: 310px !important;
                flex-shrink: 0 !important;
                position: absolute !important;
                left: 1385px !important;
                top: 0 !important;
                margin-top: 0 !important;
                margin-left: 0 !important;
                padding-top: 0 !important;
            }

            .coub-block,
            .coub__inner,
            .coub__description,
            .coub__footer,
            .coub__comments {
                width: 1360px !important;
                max-width: 1360px !important;
                box-sizing: border-box !important;
            }

            .coub__description__about,
            .coub__description__about_inner {
                max-width: 100% !important;
                width: 100% !important;
            }

            /* === ТОЧЕЧНЫЙ СДВИГ ЛЕНТЫ В ПРОФИЛЕ === */
            .page--profile .page__content,
            .profile__body,
            .coubs-list[view='grid'] {
                margin-left: -120px !important;
            }

            /* ==== СТРОКА ТАБОВ — на всю ширину контента (как на 2К) ==== */
            /* Насколько строке выйти за контейнер, считает JS и кладёт в
               --coub-row-ext-l / --coub-row-ext-r (могут быть и
               отрицательными, когда контейнер шире нужной области). */
            html[data-coub-row] .page-menu {
                box-sizing: border-box !important;
                width: calc(100% + var(--coub-row-ext-l) + var(--coub-row-ext-r)) !important;
                max-width: none !important;
                margin-left: calc(-1 * var(--coub-row-ext-l)) !important;
                margin-right: calc(-1 * var(--coub-row-ext-r)) !important;
            }

            /* ==================== ШИРОКИЕ ЭКРАНЫ (2K/4K) ==================== */
            /* До 1975px всё ровно так же, как выше (1360×720).
               На широких экранах колонка видео растягивается на свободное
               место, а масштаб шрифтов, меню и шапки НЕ меняется. */
            @media (min-width: 1975px) {
                /* Резерв под левое меню: берём РЕАЛЬНУЮ ширину меню из JS
                   (переменная --coub-menu-offset), плюс зазор 20px.
                   Когда меню скрыто, отступ сам становится 0.
                   Отступ делаем padding'ом (а не border): сайт сам играет
                   border-left у .page-container, и его анимация мешает. */
                .page-container {
                    box-sizing: border-box !important;
                    width: 100% !important;
                    max-width: none !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                    border-left: 0 none transparent !important;
                    padding-left: calc(var(--coub-menu-offset, 240px) + 20px) !important;
                    padding-right: 20px !important;
                    transition: none !important;
                }

                /* профиль: сдвиг -120px при полноширинной раскладке не нужен */
                .page--profile .page__content,
                .profile__body,
                .coubs-list[view='grid'] {
                    margin-left: 0 !important;
                }

                .page__body,
                .page__content,
                .featured__body,
                .coub-block-col,
                .coubs-list,
                .coubs-list__inner,
                .coubs-list .page {
                    width: 100% !important;
                    max-width: none !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                    padding-left: 0 !important;
                    padding-right: 0 !important;
                }

                /* колонка = ширина контента минус зазор 25px и панель .coub__info (310px) */
                .coub--page-card,
                .coubs-list[view='list'] .coub--timeline,
                .coubs-list[view='listWithoutScroll'] .coub--timeline {
                    width: calc(100% - 335px) !important;
                    max-width: none !important;
                    margin-left: 0 !important;
                }

                /* в ленте панели информации нет — колонка по центру свободного места */
                .coubs-list[view='list'] .coub--timeline,
                .coubs-list[view='listWithoutScroll'] .coub--timeline {
                    margin-left: auto !important;
                    margin-right: auto !important;
                }

                /* всё внутри колонки — просто на всю её ширину */
                .coub__inner,
                .coub__vd,
                .coub__viewer,
                .coub-block,
                .coub__description,
                .coub__footer,
                .coub__comments,
                .coubs-list .coub--timeline {
                    width: 100% !important;
                    max-width: none !important;
                }


                .coub__inner {
                    flex: 1 1 auto !important;
                    min-width: 0 !important;
                }

                .coub__viewer .viewer,
                .coub--timeline .viewer,
                .coub--page-card .viewer {
                    width: 100% !important;
                    height: auto !important;
                    aspect-ratio: 1360 / 720 !important;
                }

                /* панель информации встаёт сразу за колонкой видео */
                .coub__info {
                    left: calc(100% + 25px) !important;
                }
            }
        `,

        downloads: `
            /* === КНОПКИ СКАЧИВАНИЯ === */
            .coub__description {
                position: relative !important;
            }

            .coub-custom-download-container {
                position: absolute !important;
                top: 100% !important;
                right: 0 !important;
                margin-top: 10px !important;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 10px;
                z-index: 20;
            }

            .coub-custom-buttons-row {
                display: flex;
                gap: 10px;
                align-items: center;
            }

            .coub-custom-download-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 145px !important;
                height: 34px !important;
                background: #2b7fff;
                color: #fff !important;
                border-radius: 6px;
                padding: 0 14px;
                text-decoration: none !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                font-size: 13px !important;
                font-weight: 600 !important;
                line-height: 1 !important;
                box-sizing: border-box !important;
                transition: background 0.2s ease;
                cursor: pointer;
                border: none;
                outline: none;
            }

            .coub-custom-download-btn--audio {
                background: #4b5563 !important;
            }

            .coub-custom-download-btn:hover {
                background: #1a66e5 !important;
            }

            .coub-custom-download-btn--audio:hover {
                background: #374151 !important;
            }

            .coub-custom-download-btn svg {
                margin-right: 6px;
                fill: currentColor;
                flex-shrink: 0;
            }

            .coub-custom-audio-player {
                width: 300px;
                height: 36px;
                margin-top: 4px;
                border-radius: 6px;
            }
        `,

        volume: `
            /* === БЛОК ГРОМКОСТИ === */
            .coub-hover-volume-box {
                position: absolute !important;
                bottom: 12px !important;
                right: 15px !important;
                z-index: 99999 !important;
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
                background: rgba(0, 0, 0, 0.6) !important;
                padding: 0 9px !important;
                border-radius: 999px !important;
                border: none !important;
                height: 28px !important;
                box-sizing: border-box !important;
                color: #ffffff !important;
                opacity: 0 !important;
                visibility: hidden !important;
                transform: translateY(4px);
                transition: opacity 0.18s ease, visibility 0.18s ease, transform 0.18s ease !important;
                pointer-events: none !important;
                user-select: none !important;
            }

            .viewer:hover .coub-hover-volume-box,
            .coub__viewer:hover .coub-hover-volume-box,
            .coub--timeline:hover .coub-hover-volume-box,
            .coub-hover-volume-box:focus-within {
                opacity: 1 !important;
                visibility: visible !important;
                transform: none;
                pointer-events: auto !important;
            }

            .coub-hover-volume-icon {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 18px !important;
                height: 18px !important;
                cursor: pointer !important;
                opacity: 0.88 !important;
                flex: 0 0 auto !important;
            }

            .coub-hover-volume-icon:hover {
                opacity: 1 !important;
            }

            .coub-hover-volume-slider-wrap {
                display: flex !important;
                align-items: center !important;
                width: 0 !important;
                opacity: 0 !important;
                overflow: hidden !important;
                transition: width 0.2s ease, opacity 0.16s ease !important;
            }

            .coub-hover-volume-box:hover .coub-hover-volume-slider-wrap,
            .coub-hover-volume-box:focus-within .coub-hover-volume-slider-wrap {
                width: 96px !important;
                opacity: 1 !important;
            }

            .coub-hover-volume-range {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 96px !important;
                height: 4px !important;
                border-radius: 999px !important;
                background: linear-gradient(
                    to right,
                    #ffffff 0%,
                    #ffffff var(--vol, 3%),
                    rgba(255, 255, 255, 0.28) var(--vol, 3%),
                    rgba(255, 255, 255, 0.28) 100%
                ) !important;
                outline: none !important;
                cursor: pointer !important;
                margin: 0 !important;
                padding: 0 !important;
                flex: 0 0 auto !important;
            }

            .coub-hover-volume-range::-webkit-slider-thumb {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 12px !important;
                height: 12px !important;
                border-radius: 50% !important;
                background: #ffffff !important;
                border: none !important;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5) !important;
                cursor: pointer !important;
            }

            .coub-hover-volume-value {
                color: #ffffff !important;
                font-size: 12px !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                font-weight: 600 !important;
                line-height: 1 !important;
                min-width: 30px !important;
                text-align: right !important;
                flex: 0 0 auto !important;
            }

            .coub-vol-cross {
                display: none !important;
            }

            .coub-hover-volume-box.is-muted .coub-vol-waves {
                display: none !important;
            }

            .coub-hover-volume-box.is-muted .coub-vol-cross {
                display: block !important;
            }

            .coub-hover-volume-box.is-muted .coub-hover-volume-range {
                background: linear-gradient(
                    to right,
                    rgba(255, 255, 255, 0.28) 0%,
                    rgba(255, 255, 255, 0.28) 100%
                ) !important;
            }
        `,

        sharpen: `
            /* === РЕЗКОСТЬ ВИДЕО (SVG-фильтр #coub-sharpen) === */
            .viewer video,
            .coub--timeline .viewer video,
            .coub__viewer .viewer video,
            .viewer__player video,
            .viewer__bare video,
            .coub-v2-player__video-container video {
                filter: url(#coub-sharpen) !important;
            }
        `
    };

    const STYLE_ORDER = ['darkOverlay', 'layout', 'downloads', 'volume', 'sharpen'];
    const STYLE_ID = 'coub-ext-styles';

    let appliedCss = null;

    function applyStyles() {
        const css = STYLE_ORDER
            .filter((name) => flags.enabled && flags[name])
            .map((name) => CSS[name])
            .join('\n');

        let el = document.getElementById(STYLE_ID);

        if (!css) {
            if (el) el.remove();
            appliedCss = '';
            return;
        }

        if (!el) {
            const parent = document.head || document.documentElement;
            if (!parent) return;
            el = document.createElement('style');
            el.id = STYLE_ID;
            parent.appendChild(el);
            appliedCss = null;
        }

        if (appliedCss !== css) {
            el.textContent = css;
            appliedCss = css;
        }
    }

    /* ==================== ФЛАГИ ДЛЯ page-script.js ==================== */

    function syncPageFlags() {
        try {
            localStorage.setItem('coub_ext_volume_on', flags.enabled && flags.volume ? '1' : '0');
            localStorage.setItem('coub_ext_space_on', flags.enabled && flags.spaceKey ? '1' : '0');
        } catch (e) {
            /* localStorage может быть недоступен — не критично */
        }
    }

    /* ============ СБРОС СТАРОГО МАСШТАБА (из версии 1.0.5) ============ */
    /* Раньше расширение ставило странице зум — из-за него увеличивался весь
       интерфейс. Теперь это не нужно: просим background.js вернуть 100%,
       если масштаб ставили мы сами. */

    function resetPageZoom() {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
        try {
            chrome.runtime.sendMessage({ __coubExtZoom: true }, () => {
                void chrome.runtime.lastError;
            });
        } catch (e) {
            /* расширение перезагружено — не критично */
        }
    }

    /* ========= ОТСТУП ПОД ЛЕВОЕ МЕНЮ (широкие экраны 2K/4K) ========= */
    /* Меню coub — плавающая колонка. На широких экранах её ширина может
       отличаться от 240px, а когда меню скрыто (страница коуба), отступ
       не нужен вовсе. Поэтому кладём реальный правый край меню в
       CSS-переменную --coub-menu-offset, а медиазапрос её использует. */

    let menuOffsetAt = 0;
    let menuObserverStarted = false;

    function syncMenuOffset(force) {
        const now = Date.now();
        if (!force && now - menuOffsetAt < 250) return;
        menuOffsetAt = now;

        let offset = 240;
        try {
            const menus = document.querySelectorAll('.main-menu__inner');
            if (menus.length) {
                let best = 0;
                for (const menu of menus) {
                    const rect = menu.getBoundingClientRect();
                    const style = getComputedStyle(menu);
                    const visible =
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        rect.width > 0 &&
                        rect.right > 1;
                    if (visible && rect.right > best) best = Math.round(rect.right);
                }
                offset = best;
            }
        } catch (e) {
            /* ignore */
        }

        if (document.documentElement) {
            document.documentElement.style.setProperty('--coub-menu-offset', offset + 'px');
        }

        /* Строка табов: подгоняем её под область контента (как на 2К) —
           от правого края меню (или от края окна, если меню скрыто) до края окна.
           Считаем от РОДНОЙ геометрии самой строки: сначала снимаем наши
           переменные, измеряем, потом записываем поправки. Никакой привязки
           к .page-container — на «Моей ленте» контейнер свой.
           Значения signed: положительные — сжать, отрицательные — растянуть. */
        const root = document.documentElement;
        try {
            const row = document.querySelector('.page-menu');
            if (root && row) {
                root.removeAttribute('data-coub-row');
                root.style.removeProperty('--coub-row-ext-l');
                root.style.removeProperty('--coub-row-ext-r');

                const rect = row.getBoundingClientRect();
                if (rect.width > 0) {
                    const gap = 20;
                    const clientWidth = root.clientWidth || window.innerWidth;
                    const areaLeft = offset > 0 ? offset + gap : 0;
                    const areaRight = clientWidth - (offset > 0 ? gap : 0);

                    root.style.setProperty('--coub-row-ext-l', Math.round(rect.left - areaLeft) + 'px');
                    root.style.setProperty('--coub-row-ext-r', Math.round(areaRight - rect.right) + 'px');
                    root.setAttribute('data-coub-row', '1');
                }
            }
        } catch (e) {
            /* ignore */
        }
    }

    function watchMenu() {
        if (menuObserverStarted) return;
        const skin = document.querySelector('.coub-skin');
        if (!skin) return;
        menuObserverStarted = true;
        try {
            new MutationObserver(() => syncMenuOffset(true)).observe(skin, {
                attributes: true,
                attributeFilter: ['data-coub-menu']
            });
        } catch (e) {
            /* ignore */
        }
    }

    /* ======================== БОКОВАЯ ПАНЕЛЬ ======================== */

    function updateSidebar() {
        const currentPath = window.location.pathname;
        if (currentPath === lastPath) return;

        const skin = document.querySelector('.coub-skin');
        if (!skin) return;

        const isVideoPage = /^\/(view|coub)\//.test(currentPath);

        if (isVideoPage) {
            if (skin.getAttribute('data-coub-menu') !== 'hidden') {
                skin.setAttribute('data-coub-menu', 'hidden');
                const foldBtn = document.querySelector('.main-menu__fold');
                if (foldBtn) foldBtn.click();
            }
        } else {
            if (skin.getAttribute('data-coub-menu') !== 'visible') {
                skin.setAttribute('data-coub-menu', 'visible');
                const toggleBtn = document.querySelector('.main-menu__overlay-toggle, .header__menu-toggle, .main-menu__fold');
                if (toggleBtn) toggleBtn.click();
            }
        }

        lastPath = currentPath;
        syncMenuOffset(true);
    }

    /* ====================== БЛОК ГРОМКОСТИ (UI) ====================== */

    function attachVolumeToViewers() {
        const viewers = document.querySelectorAll('.viewer, .coub__viewer .viewer');

        viewers.forEach((viewer) => {
            if (viewer.querySelector('.coub-hover-volume-box')) return;

            let initVol = parseInt(localStorage.getItem('coub_custom_volume'), 10);
            if (isNaN(initVol) || initVol <= 0) initVol = 3;

            const box = document.createElement('div');
            box.className = 'coub-hover-volume-box';
            box.title = 'Громкость: колесо мыши или ползунок. Клик по динамику — без звука';

            const icon = document.createElement('span');
            icon.className = 'coub-hover-volume-icon';
            icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><g class="coub-vol-waves"><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></g><line class="coub-vol-cross" x1="22" y1="2" x2="16" y2="22"></line></svg>`;

            const wrap = document.createElement('span');
            wrap.className = 'coub-hover-volume-slider-wrap';

            const range = document.createElement('input');
            range.type = 'range';
            range.min = '0';
            range.max = '100';
            range.step = '1';
            range.className = 'coub-hover-volume-range';
            range.value = initVol.toString();
            range.style.setProperty('--vol', `${initVol}%`);

            const value = document.createElement('span');
            value.className = 'coub-hover-volume-value';
            value.textContent = `${initVol}%`;

            // Не даём кликам и клавишам уходить в плеер
            ['keydown', 'keyup', 'keypress', 'click', 'mousedown'].forEach((evt) => {
                box.addEventListener(evt, (e) => e.stopPropagation());
            });

            let lastNonZero = initVol > 0 ? initVol : 50;

            const applyLevel = (level) => {
                const clamped = Math.max(0, Math.min(100, Math.round(level)));
                range.value = clamped.toString();
                range.style.setProperty('--vol', `${clamped}%`);
                value.textContent = `${clamped}%`;
                box.classList.toggle('is-muted', clamped === 0);
                if (clamped > 0) lastNonZero = clamped;

                window.postMessage(
                    { __coubExt: true, type: 'syncVolume', level: clamped },
                    '*'
                );
            };

            range.addEventListener('input', () => applyLevel(Number(range.value)));
            range.addEventListener('change', () => applyLevel(Number(range.value)));

            // Колесо мыши над регулятором — ±5%
            box.addEventListener('wheel', (e) => {
                e.preventDefault();
                e.stopPropagation();
                applyLevel(Number(range.value) + (e.deltaY < 0 ? 5 : -5));
            }, { passive: false });

            // Клик по динамику — выключить/вернуть звук
            icon.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const saved = parseInt(localStorage.getItem('coub_custom_volume'), 10);
                const restore = (saved > 0 ? saved : lastNonZero) || 50;
                applyLevel(Number(range.value) > 0 ? 0 : restore);
            });

            wrap.appendChild(range);
            box.appendChild(icon);
            box.appendChild(wrap);
            box.appendChild(value);

            viewer.appendChild(box);
        });
    }

    /* ======================== КНОПКИ СКАЧИВАНИЯ ======================== */

    async function addDownloadButtons() {
        if (!(flags.enabled && flags.downloads)) return;

        const path = window.location.pathname;
        const match = path.match(/^\/(view|coub)\/([a-zA-Z0-9]+)/);
        if (!match) return;

        const coubId = match[2];
        const container = document.querySelector('.coub__description');

        if (!container || document.getElementById(`coub-dl-box-${coubId}`)) return;
        if (pendingDownloads.has(coubId)) return;

        const failedAt = failedDownloads.get(coubId);
        if (failedAt && Date.now() - failedAt < DOWNLOAD_RETRY_MS) return;

        pendingDownloads.add(coubId);

        try {
            const response = await fetch(`/api/v2/coubs/${coubId}`);
            const data = await response.json();

            if (!(flags.enabled && flags.downloads)) return;

            const videoUrl = data.file_versions?.html5?.video?.high?.url ||
                             data.file_versions?.html5?.video?.med?.url;

            const audioUrl = data.file_versions?.html5?.audio?.high?.url ||
                             data.file_versions?.html5?.audio?.med?.url;

            if ((videoUrl || audioUrl) && !document.getElementById(`coub-dl-box-${coubId}`)) {
                const box = document.createElement('div');
                box.id = `coub-dl-box-${coubId}`;
                box.className = 'coub-custom-download-container';

                const buttonsRow = document.createElement('div');
                buttonsRow.className = 'coub-custom-buttons-row';

                if (videoUrl) {
                    const videoBtn = document.createElement('a');
                    videoBtn.className = 'coub-custom-download-btn';
                    videoBtn.href = videoUrl;
                    videoBtn.target = '_blank';
                    videoBtn.download = `${data.permalink || 'coub'}.mp4`;
                    videoBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg> Скачать MP4
                    `;
                    buttonsRow.appendChild(videoBtn);
                }

                if (audioUrl) {
                    const audioBtn = document.createElement('button');
                    audioBtn.className = 'coub-custom-download-btn coub-custom-download-btn--audio';
                    audioBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                        </svg> Слушать MP3
                    `;

                    audioBtn.addEventListener('click', () => {
                        let audioPlayer = box.querySelector('audio');
                        if (audioPlayer) {
                            audioPlayer.pause();
                            audioPlayer.remove();
                        } else {
                            audioPlayer = document.createElement('audio');
                            audioPlayer.className = 'coub-custom-audio-player';
                            audioPlayer.controls = true;
                            audioPlayer.src = audioUrl;
                            let savedVol = parseInt(localStorage.getItem('coub_custom_volume'), 10);
                            if (isNaN(savedVol) || savedVol <= 0) savedVol = 3;
                            audioPlayer.volume = savedVol / 100;
                            box.appendChild(audioPlayer);
                            audioPlayer.play();
                        }
                    });

                    buttonsRow.appendChild(audioBtn);
                }

                box.appendChild(buttonsRow);
                container.appendChild(box);
            }
        } catch (e) {
            failedDownloads.set(coubId, Date.now());
            console.error('Ошибка при получении медиафайлов Coub:', e);
        } finally {
            pendingDownloads.delete(coubId);
        }
    }

    /* ================ УНИВЕРСАЛЬНОЕ УДАЛЕНИЕ ТЁМНЫХ ОВЕРЛЕЕВ ================ */

    function removeDarkOverlays() {
        document.querySelectorAll('.viewer, .coub__viewer').forEach((viewer) => {
            const rect = viewer.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            viewer.querySelectorAll('*').forEach((el) => {
                if (el.dataset.coubOverlayChecked) return;

                const tag = el.tagName;
                if (['VIDEO', 'CANVAS', 'INPUT', 'BUTTON', 'SVG', 'PATH', 'IMG'].includes(tag)) return;
                if (el.closest('.coub-hover-volume-box')) return;
                if (el.closest('.coub-custom-download-container')) return;

                const style = getComputedStyle(el);
                const match = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
                if (!match) { el.dataset.coubOverlayChecked = '1'; return; }

                const parts = match[1].split(',').map((s) => parseFloat(s));
                const alpha = parts.length === 4 ? parts[3] : 1;
                const isDark = (parts[0] + parts[1] + parts[2]) < 180;

                if (alpha > 0.03 && isDark) {
                    const elRect = el.getBoundingClientRect();
                    if (elRect.width >= rect.width * 0.5 && elRect.height >= rect.height * 0.5) {
                        el.style.setProperty('background', 'transparent', 'important');
                        el.style.setProperty('background-color', 'transparent', 'important');
                        el.style.setProperty('backdrop-filter', 'none', 'important');
                    }
                }
                el.dataset.coubOverlayChecked = '1';
            });
        });
    }

    let overlayScanScheduled = false;
    function scheduleOverlayScan() {
        if (overlayScanScheduled) return;
        overlayScanScheduled = true;
        requestAnimationFrame(() => {
            overlayScanScheduled = false;
            if (flags.enabled && flags.darkOverlay) removeDarkOverlays();
        });
    }

    /* ==================== КАЧЕСТВО ВИДЕО (HD В ЛЕНТЕ) ==================== */

    /* Лента отдаёт coub-low.mp4 (низкое качество), а на странице коуба сайт
       использует coub-hd.mp4. Файлы лежат в одной папке-ассете и отличаются
       только именем, поэтому источник можно подменить без запросов к API. */

    const HD_SRC_RE = /coub-(low|sd)\.mp4/;
    const HD_MARGIN = 400; // px: насколько близко к экрану грузить HD

    let hdScanTimer = null;
    let hdScrollTimer = null;

    function videoSrc(v) {
        return v.dataset.coubOrigSrc || v.currentSrc || v.src || '';
    }

    function setVideoSrc(v, url) {
        const time = v.currentTime || 0;
        const wasPlaying = !v.paused && !v.ended;
        v.src = url;
        try {
            v.load();
        } catch (e) {
            /* ignore */
        }
        if (time > 0.3 || wasPlaying) {
            const restore = () => {
                try {
                    if (time > 0.3) v.currentTime = time;
                } catch (e) {
                    /* ignore */
                }
                if (wasPlaying) {
                    const p = v.play();
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                }
            };
            if (v.readyState >= 2) restore();
            else v.addEventListener('loadeddata', restore, { once: true });
        }
    }

    function upgradeVideoToHd(v) {
        const url = videoSrc(v);
        if (!HD_SRC_RE.test(url)) return;
        const hd = url.replace(HD_SRC_RE, 'coub-hd.mp4');
        if (hd === url) return;

        v.dataset.coubOrigSrc = url;
        v.dataset.coubHd = '1';

        const onError = () => {
            v.removeEventListener('error', onError);
            /* HD-версии нет — возвращаем оригинал и больше не пробуем */
            v.dataset.coubHdSkip = '1';
            delete v.dataset.coubHd;
            const orig = v.dataset.coubOrigSrc;
            delete v.dataset.coubOrigSrc;
            if (orig) setVideoSrc(v, orig);
        };
        v.addEventListener('error', onError);

        setVideoSrc(v, hd);
    }

    function scanHdVideos() {
        if (!flags.enabled) return;
        const videos = document.querySelectorAll('video.viewer__video, .viewer video');

        for (const v of videos) {
            if (v.dataset.coubHd === '1' || v.dataset.coubHdSkip === '1') continue;

            const url = videoSrc(v);
            if (!HD_SRC_RE.test(url)) continue;

            const rect = v.getBoundingClientRect();
            if (!rect.width) continue; // скрытый плеер
            if (rect.bottom < -HD_MARGIN || rect.top > window.innerHeight + HD_MARGIN) continue;

            upgradeVideoToHd(v);
        }
    }

    function scheduleHdVideos(delay) {
        if (hdScanTimer) return;
        hdScanTimer = setTimeout(() => {
            hdScanTimer = null;
            scanHdVideos();
        }, typeof delay === 'number' ? delay : 150);
    }

    function revertHdVideos() {
        document.querySelectorAll('video[data-coub-orig-src]').forEach((v) => {
            const orig = v.dataset.coubOrigSrc;
            delete v.dataset.coubOrigSrc;
            delete v.dataset.coubHd;
            if (orig) setVideoSrc(v, orig);
        });
        document.querySelectorAll('video[data-coub-hd]').forEach((v) => delete v.dataset.coubHd);
        document.querySelectorAll('video[data-coub-hd-skip]').forEach((v) => delete v.dataset.coubHdSkip);
        if (hdScanTimer) {
            clearTimeout(hdScanTimer);
            hdScanTimer = null;
        }
    }

    /* ============ РЕЗКОСТЬ ВИДЕО (SVG-фильтр, без нагрузки) ============ */

    /* CSS-фильтр ссылается на этот SVG, поэтому его надо держать в документе,
       пока включена фича. Ядро свёртки: центр 2.4, крест -0.35 (сумма = 1.0). */

    const SHARP_SVG_ID = 'coub-sharpen-svg';
    const SHARP_FILTER_ID = 'coub-sharpen';

    function syncSharpenFilter() {
        const on = !!(flags.enabled && flags.sharpen);
        const existing = document.getElementById(SHARP_SVG_ID);

        if (!on) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;

        const parent = document.body || document.documentElement;
        if (!parent) return;

        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.id = SHARP_SVG_ID;
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
        svg.innerHTML =
            '<filter id="' + SHARP_FILTER_ID + '" x="0" y="0" width="100%" height="100%" ' +
            'color-interpolation-filters="sRGB">' +
            '<feConvolveMatrix order="3 3" preserveAlpha="true" divisor="1" bias="0" ' +
            'kernelMatrix="0 -0.35 0 -0.35 2.4 -0.35 0 -0.35 0"/>' +
            '</filter>';
        parent.appendChild(svg);
    }

    /* ==================== АВАТАР АККАУНТА В ШАПКЕ ==================== */

    /* Coub сам отдаёт в шапку заглушку /coub/default-avatars/48.png, хотя
       настоящий аватар канала есть. Берём его из публичного API канала. */

    const AVATAR_LINK_SEL = '.header-channel__avatar, .coub-mobile-header__avatar';
    const avatarCache = new Map(); // nick -> лёгкая версия аватара
    const avatarTemplate = new Map(); // nick -> полный шаблон из API
    const avatarPending = new Set();

    function avatarNick(link) {
        const nick = (link.getAttribute('href') || '').replace(/^\/+/, '');
        return nick && nick.indexOf('/') === -1 ? nick : '';
    }

    function applyAvatar(link, url) {
        const img = link.querySelector('img');
        if (!img || !url) return;
        if ((img.currentSrc || img.getAttribute('src') || '') === url) return;
        img.removeAttribute('srcset');
        img.addEventListener('error', function onAvatarError() {
            img.removeEventListener('error', onAvatarError);
            const full = avatarTemplate.get(avatarNick(link));
            if (full && img.getAttribute('src') !== full) img.src = full;
        });
        img.src = url;
    }

    function fixHeaderAvatars() {
        if (!(flags.enabled && flags.avatar) || typeof fetch !== 'function') return;

        document.querySelectorAll(AVATAR_LINK_SEL).forEach((link) => {
            const img = link.querySelector('img');
            if (!img) return;
            const src = img.currentSrc || img.getAttribute('src') || '';
            if (!/\/coub\/default-avatars\//.test(src)) return; // уже настоящий
            const nick = avatarNick(link);
            if (!nick) return;

            if (avatarCache.has(nick)) {
                applyAvatar(link, avatarCache.get(nick));
                return;
            }
            if (avatarPending.has(nick)) return;
            avatarPending.add(nick);

            fetch('/api/v2/channels/' + encodeURIComponent(nick), { headers: { accept: 'application/json' } })
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                    const tpl = data && data.avatar_versions && data.avatar_versions.template;
                    avatarPending.delete(nick);
                    if (!tpl) return;
                    avatarTemplate.set(nick, tpl);
                    avatarCache.set(nick, tpl.replace(/(\.[a-z0-9]+)$/i, '_96$1'));
                    fixHeaderAvatars();
                })
                .catch(() => {
                    avatarPending.delete(nick);
                });
        });
    }

    /* ========================== ПРИМЕНЕНИЕ ВСЕГО ========================== */

    function tick() {
        if (!flags.enabled) return;
        applyStyles();
        syncMenuOffset(true);
        watchMenu();
        if (flags.sidebar) updateSidebar();
        if (flags.volume) attachVolumeToViewers();
        if (flags.downloads) addDownloadButtons();
        if (flags.darkOverlay) scheduleOverlayScan();
        scheduleHdVideos();
        syncSharpenFilter();
        fixHeaderAvatars();
    }

    function applyAll() {
        applyStyles();
        syncPageFlags();
        resetPageZoom();
        syncMenuOffset(true);
        watchMenu();

        if (flags.enabled && flags.volume) {
            attachVolumeToViewers();
        } else {
            document.querySelectorAll('.coub-hover-volume-box').forEach((el) => el.remove());
        }

        if (flags.enabled && flags.downloads) {
            addDownloadButtons();
        } else {
            document.querySelectorAll('.coub-custom-download-container').forEach((el) => el.remove());
            pendingDownloads.clear();
            failedDownloads.clear();
        }

        lastPath = '';
        if (flags.enabled && flags.sidebar) updateSidebar();

        if (flags.enabled) {
            scheduleHdVideos();
        } else {
            revertHdVideos();
        }

        if (flags.enabled && flags.darkOverlay) scheduleOverlayScan();
        syncSharpenFilter();
        fixHeaderAvatars();
    }

    /* ============================ НАСТРОЙКИ ============================ */

    function loadSettings(settings) {
        flags = { ...DEFAULTS, ...settings };
        applyAll();
        console.info('[Coub Tweaks] настройки:', flags);
    }

    function cacheSettings() {
        try {
            localStorage.setItem('coub_ext_settings', JSON.stringify(flags));
        } catch (e) {
            /* ignore */
        }
    }

    // Мгновенное применение из кэша, чтобы не было вспышки нестилизованного плеера
    try {
        const cached = JSON.parse(localStorage.getItem('coub_ext_settings'));
        if (cached && typeof cached === 'object') {
            flags = { ...DEFAULTS, ...cached };
            applyAll();
        }
    } catch (e) {
        /* ignore */
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(DEFAULTS, (settings) => {
            loadSettings(settings);
            cacheSettings();
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            let dirty = false;
            for (const key of Object.keys(changes)) {
                if (!(key in DEFAULTS)) continue;
                const next = changes[key].newValue;
                flags[key] = next === undefined ? DEFAULTS[key] : next;
                dirty = true;
            }
            if (dirty) {
                applyAll();
                cacheSettings();
            }
        });
    } else {
        applyAll();
    }

    /* ============================ НАБЛЮДАТЕЛЬ ============================ */

    const observer = new MutationObserver(() => {
        if (!flags.enabled) return;
        applyStyles();
        syncMenuOffset();
        watchMenu();
        if (flags.sidebar) updateSidebar();
        if (flags.volume) attachVolumeToViewers();
        if (flags.downloads) addDownloadButtons();
        if (flags.darkOverlay) scheduleOverlayScan();
        scheduleHdVideos();
        syncSharpenFilter();
        fixHeaderAvatars();
    });

    function startObserver() {
        if (!document.documentElement) {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
            return;
        }
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    let menuResizeTimer = null;
    window.addEventListener('resize', () => {
        if (menuResizeTimer) clearTimeout(menuResizeTimer);
        menuResizeTimer = setTimeout(() => syncMenuOffset(true), 200);
    });

    window.addEventListener(
        'scroll',
        () => {
            if (!flags.enabled) return;
            if (hdScrollTimer) return;
            hdScrollTimer = setTimeout(() => {
                hdScrollTimer = null;
                scanHdVideos();
            }, 200);
        },
        { passive: true }
    );

    startObserver();

    document.addEventListener('DOMContentLoaded', () => {
        if (!flags.enabled) return;
        tick();
    });
})();
