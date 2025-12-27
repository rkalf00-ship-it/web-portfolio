// Service Worker for Unity WebGL execution with Firebase Storage
const CACHE_NAME = 'portfolio-webgl-v2';

// Firebase Storage base URL
let storageBaseUrl = '';

self.addEventListener('message', (event) => {
    if (event.data.type === 'INIT_STORAGE') {
        storageBaseUrl = event.data.storageUrl;
        console.log('Service Worker: Storage URL set:', storageBaseUrl);
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Check if this is a virtual folder request
    if (url.pathname.startsWith('/virtual/')) {
        event.respondWith(handleVirtualRequest(url, event.request));
        return;
    }

    // Normal fetch for other requests
    event.respondWith(fetch(event.request));
});

async function handleVirtualRequest(url, request) {
    try {
        // Parse path: /virtual/item_12345/Build/MyGame.wasm
        const pathParts = url.pathname.split('/').filter(p => p);
        if (pathParts.length < 2) {
            return new Response('Invalid path', { status: 404 });
        }

        const itemId = pathParts[1]; // item_12345
        const filePath = pathParts.slice(2).join('/'); // Build/MyGame.wasm

        console.log('SW: Fetching virtual file:', itemId, filePath);

        // Construct Firebase Storage URL
        let storageFilePath;
        let response;
        let fileUrl;

        if (!filePath || filePath === '') {
            // Root path - try to find index.html in various locations
            const possiblePaths = [
                `folders/${itemId}/index.html`,           // Direct: folders/item_xxx/index.html
                `folders/${itemId}/Start-build/index.html`, // Unity build folder pattern
                `folders/${itemId}/Build/index.html`,     // Alternative Unity pattern
            ];

            console.log('SW: Looking for index.html in possible locations');

            for (const path of possiblePaths) {
                fileUrl = `${storageBaseUrl}/o/${encodeURIComponent(path)}?alt=media`;
                console.log('SW: Trying:', path);
                response = await fetch(fileUrl);
                if (response.ok) {
                    console.log('SW: Found index.html at:', path);
                    storageFilePath = path;
                    break;
                }
            }
        } else {
            // Specific file path
            // Try direct path first
            storageFilePath = `folders/${itemId}/${filePath}`;
            fileUrl = `${storageBaseUrl}/o/${encodeURIComponent(storageFilePath)}?alt=media`;
            console.log('SW: Trying file URL:', fileUrl);
            response = await fetch(fileUrl);

            // If not found, try with Start-build prefix
            if (!response.ok) {
                storageFilePath = `folders/${itemId}/Start-build/${filePath}`;
                fileUrl = `${storageBaseUrl}/o/${encodeURIComponent(storageFilePath)}?alt=media`;
                console.log('SW: Trying with Start-build prefix:', fileUrl);
                response = await fetch(fileUrl);
            }
        }

        if (!response.ok) {
            console.error('SW: File not found:', storageFilePath);
            return new Response('File not found: ' + filePath, { status: 404 });
        }

        // For HTML files, rewrite paths to virtual paths
        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.includes('text/html')) {
            const text = await response.text();
            const rewrittenHtml = rewriteHtmlPaths(text, itemId);
            return new Response(rewrittenHtml, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-cache'
                }
            });
        }

        // Return file as-is
        return response;

    } catch (error) {
        console.error('SW: Error handling virtual request:', error);
        return new Response('Error: ' + error.message, { status: 500 });
    }
}

function rewriteHtmlPaths(html, itemId) {
    // Rewrite relative paths to absolute virtual paths
    let rewritten = html;

    // Rewrite src and href attributes
    rewritten = rewritten.replace(/src="(?!http|\/\/|\/virtual)([^"]+)"/g, `src="/virtual/${itemId}/$1"`);
    rewritten = rewritten.replace(/href="(?!http|\/\/|\/virtual)([^"]+)"/g, `href="/virtual/${itemId}/$1"`);

    // Rewrite Unity loader paths in JavaScript
    rewritten = rewritten.replace(/loaderUrl:\s*"(?!http|\/\/|\/virtual)([^"]+)"/g, `loaderUrl: "/virtual/${itemId}/$1"`);
    rewritten = rewritten.replace(/dataUrl:\s*"(?!http|\/\/|\/virtual)([^"]+)"/g, `dataUrl: "/virtual/${itemId}/$1"`);
    rewritten = rewritten.replace(/frameworkUrl:\s*"(?!http|\/\/|\/virtual)([^"]+)"/g, `frameworkUrl: "/virtual/${itemId}/$1"`);
    rewritten = rewritten.replace(/codeUrl:\s*"(?!http|\/\/|\/virtual)([^"]+)"/g, `codeUrl: "/virtual/${itemId}/$1"`);

    return rewritten;
}

self.addEventListener('install', (event) => {
    console.log('Service Worker: Installed');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activated');
    event.waitUntil(clients.claim());
});
