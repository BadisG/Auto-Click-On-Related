// ==UserScript==
// @name         YouTube Auto-Click Related
// @namespace    http://tampermonkey.net/
// @version      2.0
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
        // YouTube caches old pages in the DOM. We MUST filter for visible elements
        // so we don't accidentally interact with a hidden video's chips.
        const selectors = [
            'yt-related-chip-cloud-renderer yt-chip-cloud-chip-renderer',
            '#related yt-chip-cloud-chip-renderer',
            'yt-chip-cloud-renderer yt-chip-cloud-chip-renderer'
        ];

        for (const selector of selectors) {
            const allChips = document.querySelectorAll(selector);
            // Filter to only elements that are actually rendered/visible on screen
            const visibleChips = Array.from(allChips).filter(chip => chip.getBoundingClientRect().width > 0);
            if (visibleChips.length > 0) {
                return visibleChips;
            }
        }
        return[];
    }

    function getChipText(chip) {
        // YouTube's new layout wraps text in an inner div inside .ytChipShapeChip
        const textDiv = chip.querySelector('.ytChipShapeChip > div:first-child, [id="text"]');
        if (textDiv && textDiv.textContent) {
            return textDiv.textContent.replace(/\s+/g, ' ').trim();
        }

        // Fallback for older layouts
        return (chip.textContent || '').replace(/\s+/g, ' ').trim();
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

    function findTargetChip() {
        const chips = getChips();

        if (chips.length === 0) return null; // Wait for chips

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

    function clickTargetChip() {
        const target = findTargetChip();

        if (target === null) return 'not-found';
        if (target === 'no-valid-target') return 'no-valid-target';

        if (targetChipName !== target.name) {
            log(`🎯 Target chip: "${target.name}"`);
            targetChipName = target.name;
        }

        if (target.button.getAttribute('aria-selected') === 'true') {
            return 'already-selected';
        }

        // Click the native button
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
                    log('🚫 No valid target chips found, leaving default selection intact');
                    stopPolling();
                    return;
                }
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
    log('🚀 Script initialized (v2.0)');

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
