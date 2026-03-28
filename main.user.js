// ==UserScript==
// @name         YouTube Auto-Click Related
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Persistently selects Related filter (or first valid alternative), re-clicks if YouTube resets it
// @match        https://www.youtube.com/*
// @author       BadisG
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const ENABLE_LOGGING = false;
    const POLL_INTERVAL = 100;
    const STABLE_DURATION = 1500;
    const MAX_POLL_TIME = 20000;

    let lastVideoId = null;
    let pollTimer = null;
    let pollStartTime = 0;
    let lastSelectedTime = 0;
    let targetChipName = null;

    function log(...args) {
        if (ENABLE_LOGGING) {
            console.log('[Auto-Click-Related]', ...args);
        }
    }

    function isWatchPage() {
        return window.location.pathname === '/watch';
    }

    function getVideoId() {
        return new URLSearchParams(window.location.search).get('v');
    }

    function getChips() {
        let chips = document.querySelectorAll('yt-related-chip-cloud-renderer yt-chip-cloud-chip-renderer');
        if (chips.length === 0) {
            chips = document.querySelectorAll('#related yt-chip-cloud-chip-renderer');
        }
        if (chips.length === 0) {
            chips = document.querySelectorAll('yt-chip-cloud-renderer yt-chip-cloud-chip-renderer');
        }
        return chips;
    }

    function getChipText(chip) {
        const button = chip.querySelector('button');
        if (button) {
            const chipDiv = button.querySelector('.ytChipShapeChip, [id="text"]');
            if (chipDiv) {
                let text = '';
                for (const node of chipDiv.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        text += node.textContent;
                    }
                }
                if (text.trim()) return text.trim();
            }
        }
        return chip.textContent?.trim() || '';
    }

    function shouldSkipChip(chipText) {
        if (!chipText) return true;
        if (chipText === 'All') return true;
        if (chipText === 'Watched') return true;
        if (chipText === 'Recently uploaded') return true;
        if (chipText.startsWith('From ')) return true;
        if (chipText.startsWith('For ')) return true;
        return false;
    }

    /**
     * Find the target chip to click.
     * Returns: { chip, button, name } if a valid target exists,
     *          null if chips aren't in the DOM yet (keep waiting),
     *          'no-valid-target' if chips ARE loaded but none pass the filter (give up).
     */
    function findTargetChip() {
        const chips = getChips();

        // Chips not loaded yet — signal caller to keep waiting
        if (chips.length === 0) return null;

        let fallbackChip = null;
        let fallbackName = null;
        let fallbackButton = null;

        for (const chip of chips) {
            const chipText = getChipText(chip);
            const button = chip.querySelector('button');

            if (!button || !chipText) continue;

            if (chipText === 'Related') {
                return { chip, button, name: 'Related' };
            }

            if (!fallbackChip && !shouldSkipChip(chipText)) {
                fallbackChip = chip;
                fallbackName = chipText;
                fallbackButton = button;
            }
        }

        if (fallbackChip) {
            return { chip: fallbackChip, button: fallbackButton, name: fallbackName };
        }

        // Chips are loaded but every single one is in the skip list (e.g. only All + Watched)
        return 'no-valid-target';
    }

    function isTargetSelected() {
        if (!targetChipName) return false;

        const chips = getChips();
        for (const chip of chips) {
            const chipText = getChipText(chip);
            if (chipText === targetChipName) {
                const button = chip.querySelector('button');
                return button?.getAttribute('aria-selected') === 'true';
            }
        }
        return false;
    }

    /**
     * Click the target chip.
     * Returns: 'clicked' | 'already-selected' | 'not-found' | 'no-valid-target'
     */
    function clickTargetChip() {
        const target = findTargetChip();

        // Chips not in DOM yet
        if (target === null) return 'not-found';

        // Chips loaded but nothing actionable — bail out entirely
        if (target === 'no-valid-target') return 'no-valid-target';

        if (targetChipName !== target.name) {
            log(`🎯 Target chip: "${target.name}"`);
            targetChipName = target.name;
        }

        if (target.button.getAttribute('aria-selected') === 'true') {
            return 'already-selected';
        }

        target.button.click();
        log(`🖱️ Clicked "${target.name}"`);
        return 'clicked';
    }

    function startPolling() {
        stopPolling();
        pollStartTime = Date.now();
        lastSelectedTime = 0;
        targetChipName = null;

        log('▶️ Starting poll loop');

        pollTimer = setInterval(() => {
            if (!isWatchPage()) {
                log('⏹️ Not on watch page');
                stopPolling();
                return;
            }

            const elapsed = Date.now() - pollStartTime;

            if (elapsed > MAX_POLL_TIME) {
                log('⏱️ Timeout reached');
                stopPolling();
                return;
            }

            const selected = isTargetSelected();

            if (selected) {
                if (lastSelectedTime === 0) {
                    lastSelectedTime = Date.now();
                    log(`✓ "${targetChipName}" is selected, waiting for stability...`);
                }

                const stableFor = Date.now() - lastSelectedTime;
                if (stableFor >= STABLE_DURATION) {
                    log(`✅ SUCCESS! "${targetChipName}" stable for ${stableFor}ms`);
                    stopPolling();
                    return;
                }
            } else {
                if (lastSelectedTime > 0) {
                    log('⚠️ YouTube RESET the selection! Re-clicking...');
                }
                lastSelectedTime = 0;

                const result = clickTargetChip();

                if (result === 'no-valid-target') {
                    // Only skippable chips present (e.g. All + Watched) — leave YouTube alone
                    log('🚫 No valid target chips found, leaving default selection intact');
                    stopPolling();
                    return;
                }

                // 'not-found' → chips not loaded yet, keep waiting
            }
        }, POLL_INTERVAL);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
            log('⏹️ Polling stopped');
        }
    }

    function handleNavigation() {
        const videoId = getVideoId();

        if (!isWatchPage()) {
            stopPolling();
            lastVideoId = null;
            return;
        }

        if (videoId === lastVideoId && pollTimer === null && isTargetSelected()) {
            log('↩️ Same video, already selected');
            return;
        }

        if (videoId !== lastVideoId) {
            log('🔄 New video:', videoId);
            lastVideoId = videoId;
        }

        startPolling();
    }

    // ===== INITIALIZATION =====
    log('🚀 Script initialized (v1.9 - stops gracefully when only skippable chips exist)');

    window.addEventListener('yt-navigate-finish', handleNavigation);
    window.addEventListener('yt-page-data-updated', handleNavigation);
    window.addEventListener('popstate', () => setTimeout(handleNavigation, 0));

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', handleNavigation);
    } else {
        handleNavigation();
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isWatchPage()) {
            log('👁️ Tab became visible');
            startPolling();
        }
    });
})();
