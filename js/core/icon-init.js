// Centralized Lucide Icon Initialization
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();

        // Debounced observer to prevent infinite loops and performance issues
        let timeout;
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            for (let m of mutations) {
                if (m.addedNodes.length > 0) {
                    shouldUpdate = true;
                    break;
                }
            }
            if (shouldUpdate) {
                clearTimeout(timeout);
                timeout = setTimeout(() => lucide.createIcons(), 50);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
});
