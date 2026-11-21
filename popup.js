/* Coub Tweaks — попап с настройками */
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

    const inputs = {};
    document.querySelectorAll('input[data-key]').forEach((input) => {
        inputs[input.dataset.key] = input;
    });

    const master = inputs.enabled;
    const status = document.getElementById('status');
    const featureInputs = Object.entries(inputs)
        .filter(([key]) => key !== 'enabled')
        .map(([, input]) => input);

    function renderMaster(enabled) {
        document.body.classList.toggle('ext-off', !enabled);
        status.textContent = enabled ? 'Включено' : 'Выключено';
        status.classList.toggle('on', enabled);
        featureInputs.forEach((input) => {
            input.disabled = !enabled;
        });
    }

    chrome.storage.sync.get(DEFAULTS, (settings) => {
        for (const key of Object.keys(DEFAULTS)) {
            if (inputs[key]) inputs[key].checked = !!settings[key];
        }
        renderMaster(!!settings.enabled);
    });

    Object.entries(inputs).forEach(([key, input]) => {
        input.addEventListener('change', () => {
            chrome.storage.sync.set({ [key]: input.checked });
            if (key === 'enabled') renderMaster(input.checked);
        });
    });
})();
