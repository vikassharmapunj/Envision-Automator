const nw = require('nw.gui');
const fetch = require('node-fetch');
const https = require('https');

// Simple in-memory storage for token (for demonstration only)
// For persistent storage, consider localStorage or nw.App.dataPath
// const storage = {}; // Kept for consistency, but localStorage is recommended for persistence
// For persistent storage:
const TOKEN_STORAGE_KEY = 'nw_access_token';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false // WARNING: Do not use in production for security reasons.
});

const win = nw.Window.get(); // Get the current window instance

// --- Utility Functions (these are designed to be injected and run in the renderer context) ---
function applyGlobalStyles() {
    const style = document.createElement('style');
    style.textContent = `
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 14px;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f8f8f8;
    }

    .container {
      padding: 20px;
    }

    label {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
      color: #555;
    }

    input[type="text"],
    input[type="password"],
    textarea {
      width: calc(100% - 22px);
      padding: 10px;
      margin-bottom: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      box-sizing: border-box;
      font-size: 14px;
    }

    button {
      background-color: #007bff; /* Example primary color */
      color: white;
      padding: 10px 15px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      margin-right: 10px;
    }

    button:hover {
      background-color: #0056b3;
    }

    h1, h2, h3 {
      color: #222;
      margin-bottom: 15px;
    }

    .menu-bar {
      background-color: #eee;
      border-bottom: 1px solid #ddd;
      padding: 5px;
      display: flex;
      align-items: center;
      user-select: none; /* Prevent text selection */
    }

    .menu-item {
      padding: 8px 15px;
      cursor: pointer;
    }

    .menu-item:hover {
      background-color: #ddd;
    }

    .dropdown-menu {
      position: absolute;
      background-color: white;
      border: 1px solid #ccc;
      box-shadow: 1px 1px 5px rgba(0, 0, 0, 0.1);
      display: none;
      flex-direction: column;
      z-index: 10;
    }

    .dropdown-menu.open {
      display: flex;
    }

    .dropdown-menu .menu-item {
      padding: 8px 20px;
      text-align: left;
    }

    .dropdown-menu .menu-item:hover {
      background-color: #f0f0f0;
    }

    hr.menu-separator {
      border: none;
      border-top: 1px solid #ccc;
      margin: 5px 0;
    }
  `;
    document.head.appendChild(style);
}

function createCustomMenuBar() {
    const menuBar = document.createElement('div');
    menuBar.classList.add('menu-bar');

    const fileMenuBtn = createMenu('File', [
        { label: 'New', action: 'new-file' },
        { label: 'Open...', action: 'open-file' },
        { type: 'separator' },
        { label: 'Save', action: 'save-file' },
        { label: 'Save As...', action: 'save-as-file' },
        { type: 'separator' },
        { label: 'Quit', action: 'quit-app' }
    ]);
    menuBar.appendChild(fileMenuBtn);

    const editMenuBtn = createMenu('Edit', [
        { label: 'Undo', action: 'undo' },
        { label: 'Redo', action: 'redo' },
        { type: 'separator' },
        { label: 'Cut', action: 'cut' },
        { label: 'Copy', action: 'copy' },
        { label: 'Paste', action: 'paste' },
        { label: 'Select All', action: 'select-all' }
    ]);
    menuBar.appendChild(editMenuBtn);

    const viewMenuBtn = createMenu('View', [
        { label: 'Reload', action: 'reload' },
        { label: 'Toggle DevTools', action: 'toggle-dev-tools' }
    ]);
    menuBar.appendChild(viewMenuBtn);

    document.body.prepend(menuBar); // Add to the top of the body
}

function createMenu(label, items) {
    const menuGroup = document.createElement('div');
    menuGroup.classList.add('menu-group');

    const menuButton = document.createElement('div');
    menuButton.classList.add('menu-item');
    menuButton.textContent = label;
    menuGroup.appendChild(menuButton);

    const dropdownMenu = document.createElement('div');
    dropdownMenu.classList.add('dropdown-menu');

    items.forEach(item => {
        if (item.type === 'separator') {
            const separator = document.createElement('hr');
            separator.classList.add('menu-separator');
            dropdownMenu.appendChild(separator);
        } else {
            const menuItem = document.createElement('div');
            menuItem.classList.add('menu-item');
            menuItem.textContent = item.label;
            menuItem.addEventListener('click', () => {
                if (item.action === 'reload') {
                    win.reload();
                } else if (item.action === 'toggle-dev-tools') {
                    win.showDevTools();
                } else if (item.action === 'quit-app') {
                    nw.App.quit();
                } else if (item.action) {
                    // Emit a custom event on the window object that can be listened to
                    // by other scripts running in the same window context.
                    win.emit('menu-action', item.action);
                }
                dropdownMenu.classList.remove('open');
            });
            dropdownMenu.appendChild(menuItem);
        }
    });

    menuButton.addEventListener('click', () => {
        dropdownMenu.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (event) => {
        if (!menuGroup.contains(event.target)) {
            dropdownMenu.classList.remove('open');
        }
    });

    menuGroup.appendChild(dropdownMenu);
    return menuGroup;
}

// --- NW.js Event Handlers (listening for calls from other scripts in the main window) ---
// These handlers use node-fetch and are executed in the Node.js context available to the window.
win.on('execute-api-request', async (data) => {
    try {
        const response = await fetch(data.url, {
            method: data.method,
            headers: data.headers,
            body: data.payload ? JSON.stringify(data.payload) : null,
            agent: httpsAgent // Use the custom https agent for SSL bypass
        });
        const responseData = await response.text();
        data.callback({ // Call the callback function provided from the renderer
            data: responseData,
            status: response.status,
            headers: Object.fromEntries(response.headers.entries())
        });
    } catch (error) {
        data.callback({ data: error.message, status: 'Error', headers: {} });
    }
});

win.on('get-access-token', async (data) => {
    try {
        const response = await fetch(data.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: data.formData,
            agent: httpsAgent // Use the custom https agent for SSL bypass
        });
        const responseData = await response.json();
        data.callback({ data: JSON.stringify(responseData), status: response.status, headers: Object.fromEntries(response.headers.entries()) });
    } catch (error) {
        data.callback({ data: error.message, status: 'Error', headers: {} });
    }
});

win.on('store-token', (token) => {
    // For persistent storage using localStorage
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    // If using in-memory storage: storage.access_token = token;
});

win.on('get-stored-token', (callback) => {
    // For persistent storage using localStorage
    callback(localStorage.getItem(TOKEN_STORAGE_KEY));
    // If using in-memory storage: callback(storage.access_token);
});

win.on('clear-token', () => {
    // For persistent storage using localStorage
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    // If using in-memory storage: delete storage.access_token;
});

win.on('menu-action', (action) => {
    console.log(`Menu action: ${action}`);
    // Example of how to trigger a function in the main window's loaded HTML context
    // This requires the function (e.g., handleNewFile) to be globally available
    // or exposed on `window`.
    if (action === 'new-file') {
        win.eval('if (typeof handleNewFile === "function") handleNewFile();');
    } else if (action === 'open-file') {
        // This part needs to be handled within the renderer process to open file dialog
        // You might emit another event for the renderer to catch and handle the file chooser.
        // For simplicity, here's a direct way that would work if `document` is available.
        // If this part of the script is NOT in the main window's renderer context,
        // you'd need to emit an event and handle it in the renderer.
        const chooser = document.createElement('input');
        chooser.type = 'file';
        chooser.addEventListener('change', function () {
            console.log('File selected in NW.js:', this.value);
            // Example: Pass the selected file path to a function in the main window's script
            win.eval(`if (typeof handleOpenFile === "function") handleOpenFile("${this.value}");`);
        });
        chooser.click(); // Programmatically click to open dialog
    }
    // Add handlers for other menu actions as needed
});

// --- Initial setup when the NW.js app loads ---
// This code will be injected into the main window's renderer context
win.once('loaded', () => {
    win.webContents.executeJavaScript(`
        ${applyGlobalStyles.toString()}
        applyGlobalStyles();
        ${createCustomMenuBar.toString()}
        createCustomMenuBar();

        // Dynamically load auth.html and api-execution.html into the layout.html
        async function loadContentParts() {
            const contentPlaceholder = document.getElementById('content-placeholder');
            if (!contentPlaceholder) {
                console.error('Content placeholder not found in layout.html');
                return;
            }

            try {
                // Fetch HTML parts relative to the loaded index.html
                const authResponse = await fetch('views/auth.html');
                const authHtml = await authResponse.text();
                contentPlaceholder.insertAdjacentHTML('beforeend', authHtml);

                const apiExecResponse = await fetch('views/api-execution.html');
                const apiExecutionHtml = await apiExecResponse.text();
                contentPlaceholder.insertAdjacentHTML('beforeend', apiExecutionHtml);

                // Re-run any scripts within the injected HTML
                // This is crucial for event listeners and initial checks to work properly.
                // Creating new script elements and replacing old ones forces re-execution.
                contentPlaceholder.querySelectorAll('script').forEach(oldScript => {
                    const newScript = document.createElement('script');
                    Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
                    newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                });

                // Manually trigger DOMContentLoaded on the document to ensure
                // that scripts in injected HTML (like initial token checks) run if they listen for it.
                const event = new Event('DOMContentLoaded', {
                    bubbles: true,
                    cancelable: true,
                });
                document.dispatchEvent(event);

            } catch (error) {
                console.error('Failed to load content parts:', error);
            }
        }
        loadContentParts(); // Call this function to start loading content
    `);
});

// Get the path to the directory where the NW.js executable is located
const nwDir = process.execPath.substring(0, process.execPath.lastIndexOf(process.platform === 'win32' ? '\\' : '/'));
// Construct the absolute file URL for the app icon
const iconPath = `file://${nwDir}/app_icon.png`; 

// Open the main window, which will load index.html (your layout.html)
nw.Window.open('index.html', {
    show: true,
    icon: iconPath,
    width: 1000, // Set initial width
    height: 600  // Set initial height
});