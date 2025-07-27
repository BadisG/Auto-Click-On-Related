// ==UserScript==
// @name        YouTube Auto-Click Related
// @namespace   http://tampermonkey.net/
// @version     1.0
// @description Automated clicking of "Related" on YouTube
// @author      BadisG
// @match       https://www.youtube.com/*
// @grant       none
// @run-at      document-idle
// ==/UserScript==

(function() {
    'use strict';

    const ENABLE_LOGGING = false;
    let clickTimer = null;

    function log(...args) {
        if (ENABLE_LOGGING) {
            console.log('[Auto-Click-Related]', ...args);
        }
    }

    function isWatchPage() {
        return window.location.pathname === '/watch';
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
     * Multiple click simulation methods to ensure compatibility
     */
    function simulateMultipleClicks(element) {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // Method 1: Full mouse event sequence
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
        element.dispatchEvent(new MouseEvent('mouseup', mouseEventInit));
        element.dispatchEvent(new MouseEvent('click', mouseEventInit));

        // Method 2: Pointer events
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

        // Method 3: Focus and keyboard activation
        if (element.focus) {
            element.focus();
        }

        // Method 4: Direct click as fallback
        setTimeout(() => {
            try {
                element.click();
            } catch (e) {
                log('Direct click failed:', e);
            }
        }, 50);

        // Method 5: Trigger via Enter key
        setTimeout(() => {
            element.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13
            }));
            element.dispatchEvent(new KeyboardEvent('keyup', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13
            }));
        }, 100);
    }

    async function selectBestChip() {
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
            const button = targetChip.querySelector('button.ytChipShapeButtonReset') || targetChip.querySelector('button') || targetChip;

            // Check if already selected
            const isSelected = button.getAttribute('aria-selected') === 'true';

            if (!isSelected) {
                log(`Found best chip: "${targetChip.textContent.trim()}". Attempting multiple click methods.`);

                // Try clicking the chip element itself first
                simulateMultipleClicks(targetChip);

                // Also try clicking the button
                setTimeout(() => {
                    simulateMultipleClicks(button);
                }, 150);

                // Verify the click worked after a longer delay
                setTimeout(() => {
                    const newState = button.getAttribute('aria-selected');
                    log(`Click result: aria-selected is now "${newState}"`);

                    // If still not selected, try one more time with a different approach
                    if (newState !== 'true') {
                        log('Click failed, trying alternative method...');

                        // Try clicking on the chip shape div
                        const chipShape = targetChip.querySelector('.ytChipShapeChip');
                        if (chipShape) {
                            simulateMultipleClicks(chipShape);
                        }

                        // Final verification
                        setTimeout(() => {
                            const finalState = button.getAttribute('aria-selected');
                            log(`Final click result: aria-selected is now "${finalState}"`);
                        }, 500);
                    }
                }, 500);
            } else {
                log(`Chip "${targetChip.textContent.trim()}" is already selected.`);
            }
        } else {
            log('No suitable chip to select.');
        }
    }

    function handlePageChange() {
        if (!isWatchPage()) {
            log('Not a watch page, script will remain idle.');
            return;
        }

        if (clickTimer) {
            clearTimeout(clickTimer);
        }

        clickTimer = setTimeout(() => {
            log('Watch page active. Waiting for chips to load...');
            selectBestChip();
        }, 500);
    }

    window.addEventListener('yt-navigate-finish', handlePageChange);
    handlePageChange();

})();
