process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // WARNING: Do not use in production for security reasons.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises; // Use fs.promises for async file operations
const axios = require('axios');
// Removed: const util = require('util'); // No longer needed for promisify with electron-html-to
// Removed: const convertFactory = require('electron-html-to'); // Removed due to vulnerabilities

let Store;
let store;
let currentAppEnvironment = 'uat'; // Default, will be updated by auth.html

async function initializeModules() {
  try {
    const electronStore = await import('electron-store');
    Store = electronStore.default;
    store = new Store();
  } catch (error) {
    console.error('Failed to import modules:', error);
    app.quit();
  }
}

initializeModules();

app.whenReady().then(() => {
  createWindow();
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200, // Slightly increased width for new sections
    height: 900, // Slightly increased height for new sections
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  try {
    const layoutHtml = await fs.readFile(path.join(__dirname, 'views', 'layout.html'), 'utf8');
    const authHtml = await fs.readFile(path.join(__dirname, 'views', 'auth.html'), 'utf8');
    const apiExecutionHtml = await fs.readFile(path.join(__dirname, 'views', 'api-execution.html'), 'utf8');

    // Manually inject HTML content into the layout
    let finalHtml = layoutHtml.replace('<div id="auth-section"></div>', `<div id="auth-section">\n${authHtml}\n</div>`);
    finalHtml = finalHtml.replace('<div id="api-execution-section"></div>', `<div id="api-execution-section">\n${apiExecutionHtml}\n</div>`);

    win.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(finalHtml)}`);
  } catch (error) {
    console.error('Failed to load HTML files:', error);
    win.loadFile(path.join(__dirname, 'error.html')).catch(loadError => {
      console.error('Failed to load error.html fallback:', loadError);
    });
  }

  // Open DevTools (optional, for debugging during development)
  // win.webContents.openDevTools();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handler for general API requests
ipcMain.handle('execute-api-request', async (event, { url, method, headers = {}, payload, accessToken }) => {
  try {
    const config = { headers, method, url };

    // Add Authorization header if accessToken is provided
    if (accessToken) {
      config.headers['Authorization'] = `Bearer ${accessToken}`;
    }

    if (payload && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.data = payload; // Payload is already parsed JSON from renderer
      config.headers['Content-Type'] = 'application/json';
    } else if (method === 'GET' && payload) { // Handle GET with query parameters from a payload object
      const params = new URLSearchParams(payload).toString();
      config.url = `${url}?${params}`;
    }

    const response = await axios(config);
    return { success: true, data: JSON.stringify(response.data), status: response.status, headers: response.headers };
  } catch (error) {
    console.error('API execution error:', error.message);
    if (error.response) {
      return { success: false, data: JSON.stringify(error.response.data), status: error.response.status, headers: error.response.headers, message: error.message };
    } else if (error.request) {
      return { success: false, data: 'No response received from API. Check network or API server.', status: 0, headers: {}, message: 'Network Error' };
    } else {
      return { success: false, data: error.message, status: -1, headers: {}, message: error.message };
    }
  }
});

// IPC handler for getting access token
ipcMain.handle('get-access-token', async (event, { tokenUrl, formData }) => {
  try {
    const response = await axios.post(tokenUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
    return { success: true, data: JSON.stringify(response.data), status: response.status, headers: response.headers };
  } catch (error) {
    console.error('Token acquisition error:', error.message);
    if (error.response) {
      return { success: false, data: JSON.stringify(error.response.data), status: error.response.status, headers: error.response.headers, message: error.message };
    } else if (error.request) {
      return { success: false, data: 'No response received from token URL. Check network or auth server.', status: 0, headers: {}, message: 'Network Error' };
    } else {
      return { success: false, data: error.message, status: -1, headers: {}, message: error.message };
    }
  }
});

// Token storage and retrieval via electron-store
ipcMain.handle('store-token', async (event, token) => {
  if (!store) {
    console.error('electron-store not initialized. Cannot store token.');
    return { success: false, message: 'Electron store not initialized.' };
  }
  store.set('access_token', token);
  return { success: true };
});

ipcMain.handle('get-stored-token', async (event) => {
  if (!store) {
    console.error('electron-store not initialized. Cannot retrieve token.');
    return null;
  }
  return store.get('access_token');
});

ipcMain.handle('clear-token', async (event) => {
  if (!store) {
    console.error('electron-store not initialized. Cannot clear token.');
    return { success: false, message: 'Electron store not initialized.' };
  }
  store.delete('access_token');
  return { success: true };
});

// Read credentials file (plaintext)
ipcMain.handle('read-credentials-file', async (event, { environment }) => {
  let credentialsFilePath;
  if (environment === 'prod') {
    credentialsFilePath = path.join(__dirname, 'config', 'auto_credentials_prod.json');
  } else {
    credentialsFilePath = path.join(__dirname, 'config', 'auto_credentials_uat.json'); // Default to UAT
  }

  try {
    const data = await fs.readFile(credentialsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Failed to read credentials file for ${environment}:`, error);
    throw new Error(`Failed to read credentials for ${environment}: ${error.message}. Please ensure the correct file exists.`);
  }
});

// IPC handler to set the current environment
ipcMain.handle('set-environment', async (event, env) => {
  currentAppEnvironment = env;
  if (store) {
    store.set('app_environment', env);
  }
  BrowserWindow.getAllWindows().forEach(win => {
    if (win && win.webContents) {
      win.webContents.send('environment-updated', currentAppEnvironment);
    }
  });
  return { success: true };
});

// IPC handler to get the current environment
ipcMain.handle('get-environment', async (event) => {
  return (store ? store.get('app_environment') : null) || currentAppEnvironment;
});

// IPC handler to open external links (for email client)
ipcMain.handle('open-external-link', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Failed to open external link:', error);
    return { success: false, error: error.message };
  }
});

// --- API Security Testing IPC Handler ---
ipcMain.handle('run-security-test', async (event, { testType, url, payload, accessToken }) => {
  let results = {
    testType,
    url,
    payloadSent: payload,
    vulnerabilitiesFound: [],
    testDetails: []
  };

  const commonHeaders = {
    'Content-Type': 'application/json',
    ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
  };

  try {
    let testPayloads = [];
    if (testType === 'xss') {
      testPayloads = [
        '<script>alert("XSS")</script>',
        '"><img src=x onerror=alert("XSS")>',
        '%3cscript%3ealert(%22XSS%22)%3c/script%3e' // URL-encoded
      ];
    } else if (testType === 'sql_injection') {
      testPayloads = [
        "' OR '1'='1 --",
        "'; DROP TABLE users; --",
        "1 UNION SELECT null, null, null --",
        "admin'--",
        "admin' #"
      ];
    } else {
      results.testDetails.push({ status: 'info', message: `Test type '${testType}' is a placeholder or not yet implemented fully.` });
      return results;
    }

    for (const testValue of testPayloads) {
      let currentTestPayload = {};
      let targetUrl = url;

      try {
        if (payload) {
          // Attempt to inject into existing JSON payload
          let originalPayload = JSON.parse(payload);
          // Simple injection: find first string value and replace it
          // This is very basic; real injection needs to iterate or target specific fields
          const injectIntoObject = (obj) => {
            for (const key in obj) {
              if (typeof obj[key] === 'string') {
                obj[key] = testValue;
                return true;
              }
              if (typeof obj[key] === 'object' && obj[key] !== null) {
                if (injectIntoObject(obj[key])) return true;
              }
            }
            return false;
          };
          if (injectIntoObject(originalPayload)) {
            currentTestPayload = originalPayload;
          } else {
            // If no string field found, just use the test value as raw payload or add a new field
            currentTestPayload = { originalPayload: originalPayload, injectedValue: testValue };
          }
        } else {
          // If no payload, try to inject into URL query parameter
          targetUrl = `${url}?q=${encodeURIComponent(testValue)}`;
        }
      } catch (parseError) {
        // If original payload isn't JSON, just use the test value as raw payload
        currentTestPayload = testValue;
      }

      const requestConfig = {
        method: payload ? 'POST' : 'GET', // Assume POST if there's a payload. This can be refined.
        url: targetUrl,
        headers: commonHeaders,
      };
      if (payload) {
        requestConfig.data = currentTestPayload;
      }

      const startTime = Date.now();
      let response;
      try {
        response = await axios(requestConfig);
      } catch (error) {
        response = error.response || { status: 0, data: `Error: ${error.message}` };
      }
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      let vulnerabilityDetected = false;
      let responseBodyText = '';
      if (response.data) {
        try {
          responseBodyText = JSON.stringify(response.data);
        } catch (e) {
          responseBodyText = response.data.toString();
        }
      }

      // Very basic vulnerability detection heuristics
      if (testType === 'xss' && responseBodyText.includes('<script>alert("XSS")</script>')) {
        vulnerabilityDetected = true;
        results.vulnerabilitiesFound.push({ type: 'XSS Reflected', detail: `Payload "${testValue}" reflected in response.`, response: responseBodyText });
      }
      if (testType === 'sql_injection' && (responseBodyText.includes('SQL syntax') || responseBodyText.includes('error in your SQL'))) {
        vulnerabilityDetected = true;
        results.vulnerabilitiesFound.push({ type: 'SQL Injection', detail: `SQL error detected with payload "${testValue}".`, response: responseBodyText });
      }

      results.testDetails.push({
        testValue: testValue,
        urlUsed: requestConfig.url,
        method: requestConfig.method,
        status: response.status,
        responseTime: responseTime,
        vulnerable: vulnerabilityDetected,
        response: responseBodyText.substring(0, 500) + (responseBodyText.length > 500 ? '...' : '') // Truncate long responses
      });
    }

  } catch (overallError) {
    results.testDetails.push({ status: 'error', message: `Overall security test failed: ${overallError.message}` });
    console.error('Security test general error:', overallError);
  }
  return results;
});


// --- API Load Testing IPC Handler ---
ipcMain.handle('run-load-test', async (event, { url, requests, concurrency, payload, accessToken }) => {
  const testResults = {
    url,
    totalRequests: requests,
    concurrency: concurrency,
    minResponseTime: Infinity,
    maxResponseTime: 0,
    avgResponseTime: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalTime: 0,
    errors: []
  };

  const requestPromises = [];
  const startOverallTime = Date.now();

  const commonHeaders = {
    'Content-Type': 'application/json',
    ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
  };

  const executeSingleRequest = async () => {
    const startTime = Date.now();
    try {
      const config = {
        method: payload ? 'POST' : 'GET',
        url: url,
        headers: commonHeaders
      };
      if (payload) {
        config.data = JSON.parse(payload); // Ensure payload is parsed for axios
      }

      const response = await axios(config);
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      testResults.successfulRequests++;
      testResults.minResponseTime = Math.min(testResults.minResponseTime, responseTime);
      testResults.maxResponseTime = Math.max(testResults.maxResponseTime, responseTime);
      testResults.avgResponseTime += responseTime; // Will divide by totalRequests later
      return { success: true, status: response.status, responseTime: responseTime };
    } catch (error) {
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      testResults.failedRequests++;
      testResults.errors.push({
        url: url,
        status: error.response ? error.response.status : 'Network Error',
        message: error.message,
        responseTime: responseTime
      });
      return { success: false, status: error.response ? error.response.status : 0, responseTime: responseTime, error: error.message };
    }
  };

  // Schedule requests to respect concurrency
  const activeRequests = new Set();
  let completedRequests = 0;

  const runNext = async () => {
    if (completedRequests < requests) {
      const requestPromise = executeSingleRequest().finally(() => {
        activeRequests.delete(requestPromise);
        completedRequests++;
        runNext(); // Schedule next when one finishes
      });
      activeRequests.add(requestPromise);
    }
  };

  for (let i = 0; i < concurrency; i++) {
    runNext(); // Start initial concurrent requests
  }

  // Wait for all active requests to complete
  while (activeRequests.size > 0) {
    await Promise.race(Array.from(activeRequests));
  }
  
  const endOverallTime = Date.now();
  testResults.totalTime = endOverallTime - startOverallTime;
  testResults.avgResponseTime = testResults.successfulRequests > 0 ? (testResults.avgResponseTime / testResults.successfulRequests) : 0;

  return testResults;
});

// --- Static Page Security Testing IPC Handler ---
ipcMain.handle('run-static-page-security-test', async (event, { url }) => {
  const results = {
    url,
    vulnerabilitiesFound: [],
    testDetails: []
  };

  try {
    const response = await axios.get(url);
    const htmlContent = response.data;

    // Basic XSS checks:
    // 1. Script tags
    const scriptTagRegex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
    if (scriptTagRegex.test(htmlContent)) {
      results.vulnerabilitiesFound.push({ type: 'Potential XSS', detail: 'Script tags detected in HTML content. Review for malicious scripts.', snippet: htmlContent.match(scriptTagRegex)?.[0] || 'N/A' });
    }

    // 2. Inline event handlers (e.g., onerror, onload, onclick)
    const inlineEventHandlerRegex = /(on\w+="[^"]*")/gi;
    let match;
    while ((match = inlineEventHandlerRegex.exec(htmlContent)) !== null) {
      results.vulnerabilitiesFound.push({ type: 'Potential XSS', detail: `Inline event handler detected: ${match[0]}. Review for malicious code.`, snippet: match[0] });
    }

    // 3. Dangerous attributes (e.g., srcdoc, href with javascript:)
    const dangerousAttributeRegex = /(srcdoc|href=["']javascript:)/gi;
    while ((match = dangerousAttributeRegex.exec(htmlContent)) !== null) {
      results.vulnerabilitiesFound.push({ type: 'Potential XSS', detail: `Dangerous attribute detected: ${match[0]}. Review for malicious usage.`, snippet: match[0] });
    }

    results.testDetails.push({ status: 'info', message: 'Static page analysis completed.' });

  } catch (error) {
    console.error('Error running static page security test:', error);
    results.testDetails.push({ status: 'error', message: `Failed to fetch or analyze page: ${error.message}` });
  }

  return results;
});


// --- PDF Report Generation IPC Handler ---
ipcMain.handle('generate-pdf-report', async (event, htmlContent) => {
  let pdfWindow = null;
  try {
    // Create a temporary, hidden browser window to render the HTML
    pdfWindow = new BrowserWindow({
      show: false, // Don't show the window to the user
      webPreferences: {
        nodeIntegration: false, // Keep nodeIntegration false for security
        contextIsolation: true, // Keep contextIsolation true for security
        // You might need a preload script for the pdfWindow if it needs to interact with Node.js
        // For simple HTML rendering, it might not be strictly necessary.
      }
    });

    // Load the HTML content into the hidden window
    // Using a data URI is simplest for self-contained HTML
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // Ensure the content is fully loaded and rendered before printing
    // A slight delay or waiting for a specific event (e.g., `did-finish-load`) can help
    await new Promise(resolve => pdfWindow.webContents.once('did-finish-load', resolve));

    // Define output path for the PDF
    const outputFileName = `API_Test_Report_${new Date().toISOString().replace(/:/g, '-')}.pdf`;
    const downloadsPath = app.getPath('downloads');
    const filePath = path.join(downloadsPath, outputFileName);

    // Print to PDF
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true, // Include background colors/images
      pageSize: 'A4',
      marginsType: 1 // Default margins
    });

    // Save the PDF buffer to a file
    await fs.writeFile(filePath, pdfBuffer);

    pdfWindow.close(); // Close the hidden window after PDF generation
    return { success: true, filePath: filePath };
  } catch (error) {
    console.error('Error generating PDF:', error);
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close(); // Ensure window is closed even on error
    }
    return { success: false, error: error.message };
  }
});


// Ensure the main process knows about the environment from the beginning
app.on('ready', async () => {
  const storedEnv = store.get('app_environment');
  if (storedEnv) {
    currentAppEnvironment = storedEnv;
  }
});