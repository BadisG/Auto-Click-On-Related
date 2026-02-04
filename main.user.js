// ==UserScript==
// @name         YouTube Auto-Click Related
// @namespace    http://tampermonkey.net/
// @version      1.8
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

    /**
     * Get all chip elements
     */
    function getChips() {
        // Try related chip cloud first, then general chip cloud
        let chips = document.querySelectorAll('yt-related-chip-cloud-renderer yt-chip-cloud-chip-renderer');
        if (chips.length === 0) {
            chips = document.querySelectorAll('#related yt-chip-cloud-chip-renderer');
        }
        if (chips.length === 0) {
            chips = document.querySelectorAll('yt-chip-cloud-renderer yt-chip-cloud-chip-renderer');
        }
        return chips;
    }

    /**
     * Get clean text from a chip
     */
    function getChipText(chip) {
        const button = chip.querySelector('button');
        if (button) {
            // Get the chip shape div which contains the text
            const chipDiv = button.querySelector('.ytChipShapeChip, [id="text"]');
            if (chipDiv) {
                // Extract only direct text nodes (not nested element text)
                let text = '';
                for (const node of chipDiv.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) {
                        text += node.textContent;
                    }
                }
                if (text.trim()) return text.trim();
            }
        }
        // Fallback
        return chip.textContent?.trim() || '';
    }

    /**
     * Check if a chip name should be skipped
     */
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
     * Find the target chip to click
     * Priority: "Related" first, then first valid alternative
     */
    function findTargetChip() {
        const chips = getChips();
        let fallbackChip = null;
        let fallbackName = null;
        let fallbackButton = null;

        for (const chip of chips) {
            const chipText = getChipText(chip);
            const button = chip.querySelector('button');

            if (!button || !chipText) continue;

            // Priority 1: "Related" chip
            if (chipText === 'Related') {
                return { chip, button, name: 'Related' };
            }

            // Track first valid fallback (skip unwanted chips)
            if (!fallbackChip && !shouldSkipChip(chipText)) {
                fallbackChip = chip;
                fallbackName = chipText;
                fallbackButton = button;
            }
        }

        // Return fallback if no "Related" found
        if (fallbackChip) {
            return { chip: fallbackChip, button: fallbackButton, name: fallbackName };
        }

        return null;
    }

    /**
     * Check if our target chip is currently selected
     */
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
     * Click the target chip (Related or fallback)
     */
    function clickTargetChip() {
        const target = findTargetChip();

        if (!target) {
            return 'not-found';
        }

        // Update our target name
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

    /**
     * Main polling loop - keeps checking and re-clicking if needed
     */
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
                if (result === 'not-found') {
                    // Chips not in DOM yet, keep waiting
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

    /**
     * Handle navigation
     */
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
    log('🚀 Script initialized (v1.8 - excludes Watched & Recently uploaded)');

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
