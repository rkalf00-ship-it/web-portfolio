// Service Worker for Unity WebGL execution
const CACHE_NAME = 'portfolio-webgl-v1';
const virtualFolders = new Map();

// Firebase Database URL (will be set from main script)
let firebaseDbUrl = '';

self.addEventListener('message', (event) => {
    if (event.data.type === 'INIT_FIREBASE') {
        firebaseDbUrl = event.data.dbUrl;
        console.log('Service Worker: Firebase DB URL set');
    } else if (event.data.type === 'REGISTER_FOLDER') {
        const { itemId, files } = event.data;
        virtualFolders.set(itemId, files);
        console.log('Service Worker: Registered folder', itemId, 'with', files.length, 'files');
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

        // Get folder data from Firebase
        const folderData = await fetchFolderFromFirebase(itemId);
        if (!folderData) {
            console.error('SW: Folder not found:', itemId);
            return new Response('Folder not found', { status: 404 });
        }

        // Find the requested file
        let targetFile = null;

        // If no file path (accessing /virtual/item_12345/), serve index.html
        if (!filePath || filePath === '') {
            targetFile = folderData.files.find(f =>
                f.name === 'index.html' || f.path.endsWith('/index.html')
            );
        } else {
            // Find file by path
            targetFile = folderData.files.find(f => {
                const relativePath = f.path.split('/').slice(1).join('/'); // Remove folder name
                return relativePath === filePath || f.path.endsWith('/' + filePath);
            });
        }

        if (!targetFile) {
            console.error('SW: File not found:', filePath);
            return new Response('File not found: ' + filePath, { status: 404 });
        }

        console.log('SW: Found file:', targetFile.name, 'type:', targetFile.type);

        // Convert base64 to blob
        const blob = base64ToBlob(targetFile.data, targetFile.type || getMimeType(targetFile.name));

        // For HTML files, rewrite paths to virtual paths
        if (targetFile.name.endsWith('.html')) {
            const text = await blob.text();
            const rewrittenHtml = rewriteHtmlPaths(text, itemId);
            return new Response(rewrittenHtml, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-cache'
                }
            });
        }

        // Return file with correct MIME type
        return new Response(blob, {
            status: 200,
            headers: {
                'Content-Type': targetFile.type || getMimeType(targetFile.name),
                'Cache-Control': 'public, max-age=3600'
            }
        });

    } catch (error) {
        console.error('SW: Error handling virtual request:', error);
        return new Response('Error: ' + error.message, { status: 500 });
    }
}

async function fetchFolderFromFirebase(itemId) {
    try {
        if (!firebaseDbUrl) {
            console.error('SW: Firebase DB URL not set');
            return null;
        }

        // Fetch file data from Firebase
        const fileUrl = `${firebaseDbUrl}/files/${itemId}.json`;
        const response = await fetch(fileUrl);

        if (!response.ok) {
            console.error('SW: Firebase fetch failed:', response.status);
            return null;
        }

        const fileDataString = await response.json();
        if (!fileDataString) {
            return null;
        }

        // Parse folder data
        const folderData = JSON.parse(fileDataString);
        return folderData;

    } catch (error) {
        console.error('SW: Error fetching from Firebase:', error);
        return null;
    }
}

function base64ToBlob(base64, mimeType) {
    // Remove data URL prefix if present
    let pureBase64 = base64;
    if (base64.includes(',')) {
        pureBase64 = base64.split(',')[1];
    }

    const byteCharacters = atob(pureBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeTypes = {
        'html': 'text/html',
        'js': 'application/javascript',
        'json': 'application/json',
        'wasm': 'application/wasm',
        'data': 'application/octet-stream',
        'unityweb': 'application/octet-stream',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'css': 'text/css',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'ttf': 'font/ttf',
        'mp3': 'audio/mpeg',
        'mp4': 'video/mp4',
        'webm': 'video/webm'
    };
    return mimeTypes[ext] || 'application/octet-stream';
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
