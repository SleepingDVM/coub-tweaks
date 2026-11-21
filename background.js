/* Coub Tweaks — service worker.
   Единственная задача: вернуть масштаб вкладкам coub.com на 100%, если его
   раньше ставила сама расширение (версии 1.0.5). Больше зум не используется —
   на широких экранах расширяется только колонка видео (см. content.js). */

const APPLIED_KEY = 'coub_applied_zoom';

function resetZoom(tabId) {
    chrome.storage.local.get({ [APPLIED_KEY]: 0 }, (data) => {
        const applied = data && data[APPLIED_KEY];
        if (!applied) return; // масштаб ставили не мы — не трогаем

        chrome.storage.local.remove(APPLIED_KEY);
        chrome.tabs.setZoom(tabId, 1, () => {
            void chrome.runtime.lastError;
        });
    });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.__coubExtZoom !== true) return;
    if (sender.tab && typeof sender.tab.id === 'number') resetZoom(sender.tab.id);
});
