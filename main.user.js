// ==UserScript==
// @name        YouTube Auto-Click Related
// @namespace   http://tampermonkey.net/
// @version     1.1
// @description Automated clicking of "Related" on YouTube
// @match       https://www.youtube.com/*
// @author      BadisG
// @grant       none
// @run-at      document-idle
// ==/UserScript==

(function() {
    'use strict';

    const ENABLE_LOGGING = true;
    let clickTimer = null;
    let retryTimer = null;
    let tabFocusRetryTimer = null;

    function log(...args) {
        if (ENABLE_LOGGING) {
            console.log('[Auto-Click-Related]', ...args);
        }
    }

    function isWatchPage() {
        return window.location.pathname === '/watch';
    }

    function isTabActive() {
        return !document.hidden;
    }

    function getVisibleChipContainer() {
        const containers = document.querySelectorAll('yt-chip-cloud-renderer');
        for (let container of containers) {
            if (container.offsetParent !== null) {
                return container;
            }
        }
        return null;
    }

    /**
     * Waits for the chip container to be fully loaded with interactive chips
     */
    function waitForChipsToLoad(maxAttempts = 20, interval = 250) {
        return new Promise((resolve) => {
            let attempts = 0;

            const checkChips = () => {
                attempts++;
                const chipContainer = getVisibleChipContainer();

                if (chipContainer) {
                    const ironSelector = chipContainer.querySelector('iron-selector#chips');
                    const chips = chipContainer.querySelectorAll('yt-chip-cloud-chip-renderer');

                    if (ironSelector && chips.length > 1) {
                        const buttonsReady = Array.from(chips).every(chip => {
                            const button = chip.querySelector('button.ytChipShapeButtonReset');
                            return button && button.getAttribute('role') === 'tab';
                        });

                        if (buttonsReady) {
                            log(`Chips fully loaded after ${attempts} attempts (${attempts * interval}ms)`);
                            resolve(chipContainer);
                            return;
                        }
                    }
                }

                if (attempts >= maxAttempts) {
                    log(`Timeout waiting for chips to load after ${maxAttempts} attempts`);
                    resolve(null);
                    return;
                }

                setTimeout(checkChips, interval);
            };

            checkChips();
        });
    }

    /**
     * Enhanced click simulation with more aggressive methods
     */
    function simulateClick(element) {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // Method 1: Native click (most reliable when tab is active)
        try {
            element.click();
        } catch (e) {
            log('Native click failed:', e);
        }

        // Method 2: Mouse events with more realistic timing
        const mouseEventInit = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1
        };

        element.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));
        setTimeout(() => {
            element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
            element.dispatchEvent(new MouseEvent('click', mouseEventInit));
        }, 10);

        // Method 3: Focus and keyboard events
        setTimeout(() => {
            if (element.focus) {
                element.focus();
            }

            element.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13
            }));

            setTimeout(() => {
                element.dispatchEvent(new KeyboardEvent('keyup', {
                    bubbles: true,
                    cancelable: true,
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13
                }));
            }, 10);
        }, 20);

        // Method 4: Pointer events
        setTimeout(() => {
            const pointerEventInit = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: 'mouse',
                isPrimary: true
            };

            element.dispatchEvent(new PointerEvent('pointerdown', pointerEventInit));
            element.dispatchEvent(new PointerEvent('pointerup', pointerEventInit));
            element.dispatchEvent(new PointerEvent('click', pointerEventInit));
        }, 30);
    }

    async function selectBestChip() {
        // If tab is not active, wait for it to become active
        if (!isTabActive()) {
            log('Tab is not active, waiting for tab focus...');
            waitForTabFocus();
            return;
        }

        log('Waiting for chips to fully load...');
        const chipContainer = await waitForChipsToLoad();

        if (!chipContainer) {
            log('Chips failed to load within timeout period.');
            return;
        }

        const chips = chipContainer.querySelectorAll('yt-chip-cloud-chip-renderer');
        if (!chips.length) {
            log('No chips found in the loaded container.');
            return;
        }

        const excludedChips = ['All', 'For you', 'Recently uploaded', 'Watched'];
        const priorityChipText = 'Related';

        let targetChip = null;
        let targetButton = null;

        // Prioritize "Related" chip
        for (let chip of chips) {
            const chipText = chip.textContent.trim();
            if (chipText === priorityChipText) {
                targetChip = chip;
                break;
            }
        }

        // Fallback to the first non-excluded chip if "Related" is not found
        if (!targetChip) {
            for (let chip of chips) {
                const chipText = chip.textContent.trim();
                if (!excludedChips.includes(chipText) && !chipText.toLowerCase().startsWith('from ')) {
                    targetChip = chip;
                    break;
                }
            }
        }

        if (targetChip) {
            targetButton = targetChip.querySelector('button.ytChipShapeButtonReset') ||
                          targetChip.querySelector('button') ||
                          targetChip;

            // Check if already selected
            const isSelected = targetButton.getAttribute('aria-selected') === 'true';

            if (!isSelected) {
                log(`Found best chip: "${targetChip.textContent.trim()}". Attempting click...`);

                // Try multiple elements
                simulateClick(targetButton);
                simulateClick(targetChip);

                // Also try the chip shape div
                const chipShape = targetChip.querySelector('.ytChipShapeChip');
                if (chipShape) {
                    setTimeout(() => simulateClick(chipShape), 50);
                }

                // Verify after a delay
                setTimeout(() => {
                    const newState = targetButton.getAttribute('aria-selected');
                    log(`Click result: aria-selected is now "${newState}"`);

                    if (newState !== 'true') {
                        log('Click failed, scheduling retry...');
                        scheduleRetry();
                    } else {
                        log('Successfully clicked Related chip!');
                    }
                }, 800);
            } else {
                log(`Chip "${targetChip.textContent.trim()}" is already selected.`);
            }
        } else {
            log('No suitable chip to select.');
        }
    }

    function scheduleRetry() {
        if (retryTimer) {
            clearTimeout(retryTimer);
        }

        retryTimer = setTimeout(() => {
            log('Retrying chip selection...');
            selectBestChip();
        }, 2000);
    }

    function waitForTabFocus() {
        if (tabFocusRetryTimer) {
            clearTimeout(tabFocusRetryTimer);
        }

        const checkFocus = () => {
            if (isTabActive()) {
                log('Tab became active, proceeding with chip selection...');
                selectBestChip();
            } else {
                tabFocusRetryTimer = setTimeout(checkFocus, 1000);
            }
        };

        tabFocusRetryTimer = setTimeout(checkFocus, 1000);
    }

    function handlePageChange() {
        if (!isWatchPage()) {
            log('Not a watch page, script will remain idle.');
            return;
        }

        // Clear any existing timers
        if (clickTimer) clearTimeout(clickTimer);
        if (retryTimer) clearTimeout(retryTimer);
        if (tabFocusRetryTimer) clearTimeout(tabFocusRetryTimer);

        clickTimer = setTimeout(() => {
            log('Watch page active. Starting chip selection process...');
            selectBestChip();
        }, 500);
    }

    // Listen for tab visibility changes
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isWatchPage()) {
            log('Tab became visible, checking if chip selection needed...');
            setTimeout(() => {
                // Check if Related chip is already selected
                const chipContainer = getVisibleChipContainer();
                if (chipContainer) {
                    const chips = chipContainer.querySelectorAll('yt-chip-cloud-chip-renderer');
                    let relatedSelected = false;

                    for (let chip of chips) {
                        if (chip.textContent.trim() === 'Related') {
                            const button = chip.querySelector('button.ytChipShapeButtonReset') || chip.querySelector('button');
                            if (button && button.getAttribute('aria-selected') === 'true') {
                                relatedSelected = true;
                                break;
                            }
                        }
                    }

                    if (!relatedSelected) {
                        log('Related chip not selected, attempting selection...');
                        selectBestChip();
                    }
                }
            }, 500);
        }
    });

    // Initialize
    window.addEventListener('yt-navigate-finish', handlePageChange);
    handlePageChange();

})();
