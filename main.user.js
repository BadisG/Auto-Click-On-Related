// ==UserScript==
// @name        YouTube Auto-Click Related
// @namespace   http://tampermonkey.net/
// @version     1.5
// @description Uses YouTube's navigation endpoint to trigger Related filter
// @match       https://www.youtube.com/*
// @author      BadisG
// @grant       none
// @run-at      document-idle
// ==/UserScript==

(function() {
    'use strict';

    const ENABLE_LOGGING = false;
    let lastProcessedUrl = null;
    let isProcessing = false;
    let selectionComplete = false;

    function log(...args) {
        if (ENABLE_LOGGING) {
            console.log('[Auto-Click-Related]', ...args);
        }
    }

    function isWatchPage() {
        return window.location.pathname === '/watch';
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getRelatedChipCloudRenderer() {
        return document.querySelector('yt-related-chip-cloud-renderer');
    }

    function findRelatedChipData() {
        const relatedCloud = getRelatedChipCloudRenderer();
        if (!relatedCloud) {
            log('No yt-related-chip-cloud-renderer found');
            return null;
        }

        // Access the Polymer element's data
        const data = relatedCloud.__data || relatedCloud.data;
        if (!data) {
            log('No data on relatedCloud');
            return null;
        }

        log('RelatedCloud data keys:', Object.keys(data));

        // Look for the chip cloud data
        if (data.content && data.content.chipCloudRenderer) {
            const chips = data.content.chipCloudRenderer.chips;
            if (chips && Array.isArray(chips)) {
                log(`Found ${chips.length} chips in data`);

                for (let i = 0; i < chips.length; i++) {
                    const chip = chips[i];
                    if (chip.chipCloudChipRenderer) {
                        const text = chip.chipCloudChipRenderer.text;
                        const chipText = text?.simpleText || text?.runs?.[0]?.text || '';
                        log(`  Chip ${i}: "${chipText}", isSelected: ${chip.chipCloudChipRenderer.isSelected}`);

                        if (chipText === 'Related') {
                            return {
                                index: i,
                                chipData: chip.chipCloudChipRenderer,
                                navigationEndpoint: chip.chipCloudChipRenderer.navigationEndpoint,
                                isSelected: chip.chipCloudChipRenderer.isSelected
                            };
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Execute the navigation endpoint command
     */
    function executeNavigationEndpoint(endpoint, relatedCloud) {
        log('Attempting to execute navigation endpoint...');
        log('Endpoint:', JSON.stringify(endpoint, null, 2));

        if (!endpoint) {
            log('No endpoint provided');
            return false;
        }

        // Method 1: Try using YouTube's built-in navigation
        if (endpoint.continuationCommand) {
            log('Found continuationCommand');

            // Try to find and call the handleRelatedChipCommand with proper data
            if (typeof relatedCloud.handleRelatedChipCommand === 'function') {
                try {
                    // Create a properly structured event/data object
                    const commandData = {
                        continuationCommand: endpoint.continuationCommand
                    };
                    log('Calling handleRelatedChipCommand with:', commandData);
                    relatedCloud.handleRelatedChipCommand(commandData);
                    return true;
                } catch (e) {
                    log('handleRelatedChipCommand failed:', e.message);
                }
            }

            // Method 2: Try to use ytd-app's navigation
            const ytdApp = document.querySelector('ytd-app');
            if (ytdApp) {
                // Try various navigation methods
                const navMethods = ['handleNavigate_', 'navigate_', 'handleAction_', 'sendAction_'];
                for (const method of navMethods) {
                    if (typeof ytdApp[method] === 'function') {
                        log(`Trying ytd-app.${method}`);
                        try {
                            ytdApp[method]({ endpoint: endpoint });
                        } catch (e) {
                            log(`  ${method} failed:`, e.message);
                        }
                    }
                }
            }

            // Method 3: Try to manually trigger the continuation
            if (endpoint.continuationCommand.token) {
                log('Has continuation token, attempting fetch...');
                return triggerContinuationFetch(endpoint.continuationCommand);
            }
        }

        return false;
    }

    /**
     * Manually trigger the continuation fetch
     */
    async function triggerContinuationFetch(continuationCommand) {
        log('Triggering continuation fetch...');

        const token = continuationCommand.token;
        const request = continuationCommand.request || 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT';

        log('Token:', token?.substring(0, 50) + '...');
        log('Request type:', request);

        // Try to find the API endpoint and make the request
        try {
            // Get the innertube API key
            const ytcfg = window.ytcfg?.data_ || window.ytcfg?.get?.('INNERTUBE_API_KEY');
            const apiKey = typeof ytcfg === 'object' ? ytcfg.INNERTUBE_API_KEY : ytcfg;

            if (!apiKey) {
                log('Could not find API key');
                return false;
            }

            log('API Key found:', apiKey?.substring(0, 10) + '...');

            // Make the continuation request
            const response = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    context: window.ytcfg?.data_?.INNERTUBE_CONTEXT || {
                        client: {
                            clientName: 'WEB',
                            clientVersion: '2.20240101.00.00'
                        }
                    },
                    continuation: token
                }),
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                log('Continuation response received!');
                log('Response keys:', Object.keys(data));

                // Now we need to update the UI with this data
                // This is the tricky part - we need to inject this into YouTube's state
                return updateUIWithContinuationData(data);
            } else {
                log('Continuation request failed:', response.status);
            }
        } catch (e) {
            log('Error fetching continuation:', e.message);
        }

        return false;
    }

    /**
     * Update the UI with the continuation data
     */
    function updateUIWithContinuationData(data) {
        log('Attempting to update UI with new data...');

        // Find the secondary results renderer and update it
        const secondaryResults = document.querySelector('ytd-watch-next-secondary-results-renderer');
        if (secondaryResults && secondaryResults.__data) {
            log('Found secondary results renderer');

            // Look for the new results in the continuation data
            if (data.onResponseReceivedEndpoints) {
                for (const endpoint of data.onResponseReceivedEndpoints) {
                    if (endpoint.reloadContinuationItemsCommand) {
                        log('Found reloadContinuationItemsCommand');
                        // This would need to trigger Polymer's data binding
                        // which is complex to do externally
                    }
                    if (endpoint.appendContinuationItemsAction) {
                        log('Found appendContinuationItemsAction');
                    }
                }
            }
        }

        return false;
    }

    /**
     * Simpler approach: Just click the chip element directly with better targeting
     */
    async function clickChipDirectly() {
        log('Attempting direct chip click...');

        const chips = document.querySelectorAll('yt-related-chip-cloud-renderer yt-chip-cloud-chip-renderer');

        for (const chip of chips) {
            if (chip.textContent.trim() === 'Related') {
                const button = chip.querySelector('button');
                if (button) {
                    // Check if already selected
                    if (button.getAttribute('aria-selected') === 'true') {
                        log('Already selected!');
                        return true;
                    }

                    log('Found Related button, focusing and clicking...');

                    // Focus first
                    button.focus();
                    await sleep(50);

                    // Try the direct click
                    button.click();
                    await sleep(100);

                    // Check if it worked
                    if (button.getAttribute('aria-selected') === 'true') {
                        log('Click worked!');
                        return true;
                    }

                    // If not, try triggering via the chip-shape
                    const chipShape = chip.querySelector('chip-shape');
                    if (chipShape) {
                        chipShape.click();
                        await sleep(100);
                    }

                    return button.getAttribute('aria-selected') === 'true';
                }
            }
        }

        return false;
    }

    /**
     * Main function
     */
    async function selectRelatedChip() {
        if (isProcessing) {
            log('Already processing, skipping');
            return;
        }

        if (selectionComplete) {
            log('Selection already complete');
            return;
        }

        if (!isWatchPage()) {
            log('Not on watch page');
            return;
        }

        isProcessing = true;
        log('\n========== ATTEMPTING SELECTION ==========');

        try {
            // First, try the simple click approach
            const clickWorked = await clickChipDirectly();
            if (clickWorked) {
                log('✅ SUCCESS via direct click!');
                selectionComplete = true;
                isProcessing = false;
                return;
            }

            // Get the chip data with navigation endpoint
            const chipInfo = findRelatedChipData();

            if (!chipInfo) {
                log('Could not find Related chip data');
                isProcessing = false;
                scheduleRetry();
                return;
            }

            if (chipInfo.isSelected) {
                log('✅ Related chip is already selected in data!');
                selectionComplete = true;
                isProcessing = false;
                return;
            }

            log('Found Related chip at index', chipInfo.index);
            log('Has navigationEndpoint:', !!chipInfo.navigationEndpoint);

            // Try to execute the navigation endpoint
            const relatedCloud = getRelatedChipCloudRenderer();
            if (chipInfo.navigationEndpoint && relatedCloud) {
                const success = executeNavigationEndpoint(chipInfo.navigationEndpoint, relatedCloud);
                if (success) {
                    log('Navigation endpoint executed');
                    await sleep(500);

                    // Verify
                    const newInfo = findRelatedChipData();
                    if (newInfo?.isSelected) {
                        log('✅ SUCCESS! Related is now selected!');
                        selectionComplete = true;
                        isProcessing = false;
                        return;
                    }
                }
            }

            log('❌ Could not activate Related chip');
            scheduleRetry();

        } catch (e) {
            log('Error:', e.message);
            scheduleRetry();
        }

        isProcessing = false;
    }

    let retryCount = 0;
    const MAX_RETRIES = 5;
    let retryTimer = null;

    function scheduleRetry() {
        if (retryTimer) {
            clearTimeout(retryTimer);
        }

        retryCount++;
        if (retryCount <= MAX_RETRIES) {
            log(`Scheduling retry ${retryCount}/${MAX_RETRIES} in 3 seconds...`);
            retryTimer = setTimeout(() => {
                isProcessing = false;
                selectRelatedChip();
            }, 3000);
        } else {
            log('Max retries reached. Giving up.');
            log('\n⚠️ YouTube appears to block automated chip selection.');
            log('The navigation endpoint exists but cannot be triggered externally.');
        }
    }

    function handlePageChange() {
        const currentUrl = window.location.href;

        if (currentUrl === lastProcessedUrl) {
            return;
        }

        log('\n🔄 PAGE CHANGE:', currentUrl);
        lastProcessedUrl = currentUrl;
        selectionComplete = false;
        isProcessing = false;
        retryCount = 0;

        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        if (!isWatchPage()) {
            log('Not a watch page, ignoring');
            return;
        }

        // Wait for page to load
        log('Scheduling selection in 2.5 seconds...');
        setTimeout(selectRelatedChip, 2500);
    }

    // Initialize
    log('🚀 Script initialized v5.0.0');

    window.addEventListener('yt-navigate-finish', handlePageChange);

    // Only handle visibility change if we haven't completed
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isWatchPage() && !selectionComplete && !isProcessing) {
            log('Tab became visible, checking...');
            setTimeout(selectRelatedChip, 1000);
        }
    });

    // Initial run
    handlePageChange();

})();
