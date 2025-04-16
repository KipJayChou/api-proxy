import { serve } from "https://deno.land/std/http/server.ts";
import { serveFile } from "https://deno.land/std/http/file_server.ts";

// --- Configuration ---
const apiMapping = {
  "/xai": "https://api.x.ai",
  "/openai": "https://api.openai.com",
  "/gemini": "https://generativelanguage.googleapis.com",
  "/perplexity": "https://api.perplexity.ai",
};

const PROXY_DOMAIN = Deno.env.get("PROXY_DOMAIN");
const PROXY_PASSWORD = Deno.env.get("PROXY_PASSWORD");
const PROXY_PORT = Deno.env.get("PROXY_PORT") || "8000";
const AUTH_COOKIE_NAME = "api_proxy_auth_token";

if (!PROXY_DOMAIN) {
  const errorMsg = "错误: PROXY_DOMAIN 环境变量未设置。";
  console.error(errorMsg);
  throw new Error(errorMsg);
}

if (!PROXY_PASSWORD) {
  console.warn("警告: PROXY_PASSWORD 环境变量未设置。身份验证已禁用。");
}

// --- Authentication Helper Functions ---
async function generateAuthToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

async function isAuthenticated(request: Request): Promise<boolean> {
  if (!PROXY_PASSWORD) return true;

  const cookies = request.headers.get("Cookie") || "";
  const tokenMatch = cookies.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`));
  const receivedToken = tokenMatch ? tokenMatch[1] : null;

  if (!receivedToken) return false;

  const expectedToken = await generateAuthToken(PROXY_PASSWORD);
  return receivedToken === expectedToken;
}

function generateLoginPage(errorMessage = ""): Response {
  const errorHtml = errorMessage
    ? `<p class="error-message">${errorMessage}</p>`
    : "";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>需要登录</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta charset="UTF-8">
        <style>
            body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background-image:url('https://raw.githubusercontent.com/Nshpiter/docker-accelerate/refs/heads/main/background.jpg');background-size:cover;background-position:center;background-repeat:no-repeat}.login-container{background-color:rgba(255,255,255,.05);padding:30px 40px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.1);text-align:center;max-width:380px;width:90%;backdrop-filter:blur(5px);border:1px solid rgba(255,255,255,.1)}h2{color:#f0f9ff;margin-bottom:20px;font-weight:600;text-shadow:1px 1px 3px rgba(0,0,0,.5)}p{color:#e2e8f0;margin-bottom:25px}form{display:flex;flex-direction:column}label{text-align:left;margin-bottom:8px;color:#e2e8f0;font-weight:bold;font-size:14px}input[type=password]{padding:12px 15px;margin-bottom:18px;border:1px solid rgba(255,255,255,.2);background-color:rgba(255,255,255,.1);color:#fff;border-radius:6px;font-size:16px;box-sizing:border-box}input:focus{outline:none;border-color:#60a5fa;box-shadow:0 0 0 2px rgba(96,165,250,.3)}button{padding:12px;background:linear-gradient(45deg,#3b82f6,#8b5cf6);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:16px;font-weight:600;transition:background .3s ease,transform .2s ease;margin-top:10px}button:hover{background:linear-gradient(45deg,#2563eb,#7c3aed);transform:scale(1.02)}.error-message{color:#f87171;margin-top:15px;font-weight:bold}
        </style>
    </head>
    <body>
        <div class="login-container">
            <h2>需要登录</h2>
            <p>请输入密码以访问 API 代理。</p>
            <form action="/login" method="post">
                <label for="password">密码:</label>
                <input type="password" id="password" name="password" required>
                <button type="submit">登录</button>
            </form>
            ${errorHtml}
        </div>
    </body>
    </html>`;
  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

async function handleLogin(request: Request): Promise<Response> {
  if (!PROXY_PASSWORD) {
    return new Response("身份验证后端配置错误。", { status: 500 });
  }
  try {
    const formData = await request.formData();
    const password = formData.get("password");

    if (password === PROXY_PASSWORD) {
      const token = await generateAuthToken(PROXY_PASSWORD);
      const cookieValue = `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`; // 1 day expiry
      return new Response(null, {
        status: 302,
        headers: { "Location": "/", "Set-Cookie": cookieValue },
      });
    } else {
      return generateLoginPage("密码无效。");
    }
  } catch (error) {
    console.error("处理登录表单时出错:", error);
    return generateLoginPage("登录过程中发生错误。");
  }
}

// --- Main Request Handler ---
async function main(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const [prefix, _] = extractPrefixAndRest(pathname, Object.keys(apiMapping));
  const isApiEndpoint = prefix !== null;

  if (!isApiEndpoint) {
    if (pathname === "/login" && request.method === "POST") {
      return handleLogin(request);
    }
    if ((pathname === "/" || pathname === "/index.html") && PROXY_PASSWORD) {
      const authenticated = await isAuthenticated(request);
      if (!authenticated) {
        return generateLoginPage();
      }
    }
  }

  // --- Route Requests ---
  if (pathname === "/" || pathname === "/index.html") {
    return handleDashboardPage(apiMapping, PROXY_DOMAIN);
  }

  if (pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (pathname.startsWith("/public/")) {
    if (pathname.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }
    return serveStaticFile(request, `.${pathname}`);
  }

  if (isApiEndpoint) {
    return handleApiRequest(request, prefix!, pathname);
  }

  return new Response("Not Found", { status: 404 });
}

async function handleApiRequest(
  request: Request,
  prefix: string,
  pathname: string,
): Promise<Response> {
  const url = new URL(request.url);
  const [_, rest] = extractPrefixAndRest(pathname, [prefix]);
  const targetPath = rest || ""; // Ensure empty string if no rest part
  const targetUrl = `${apiMapping[prefix]}${targetPath}${url.search}`;

  try {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("connection");
    headers.delete("content-length");

    console.log(`Proxying ${request.method} ${pathname} to ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "manual", // Handle redirects manually if needed, often safer for proxies
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set("Access-Control-Allow-Origin", "*"); // Be cautious with '*' in production
    responseHeaders.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    );
    responseHeaders.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With", // Add common headers
    );
    responseHeaders.delete("Content-Security-Policy");
    responseHeaders.delete("Strict-Transport-Security");
    responseHeaders.delete("Public-Key-Pins");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`Proxy request failed for ${targetUrl}:`, error);
    return new Response("Proxy Error", { status: 502 }); // Bad Gateway is often more appropriate
  }
}

function extractPrefixAndRest(
  pathname: string,
  prefixes: string[],
): [string | null, string | null] {
  prefixes.sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) {
      return [prefix, pathname.slice(prefix.length)];
    }
  }
  return [null, null];
}

async function handleDashboardPage(
  apiMap: { [key: string]: string },
  domain: string,
): Promise<Response> {
  let cardsHtml = "";
  const sortedPaths = Object.keys(apiMap).sort();

  for (const proxyPath of sortedPaths) {
    const targetUrl = apiMap[proxyPath];
    const fullProxyUrl = `https://${domain}${proxyPath}`;

    cardsHtml += `
      <div class="card">
        <div class="card-header">
          <h3 class="path-title">${proxyPath}</h3>
          <span class="status-badge online">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>
            在线
          </span>
        </div>
        <div class="card-body">
          <div class="url-group">
            <strong class="url-label">代理地址:</strong>
            <div class="url-value">
              <code>${fullProxyUrl}</code>
              <button class="copy-btn" data-clipboard-text="${fullProxyUrl}" title="复制代理地址">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
          </div>
          <div class="url-group">
            <strong class="url-label">源地址:</strong>
            <div class="url-value">
              <code>${targetUrl}</code>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <title>API 代理仪表板</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="description" content="API 代理服务状态面板">
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>">
        <style>
            :root {
                --bg-url: url('https://raw.githubusercontent.com/Nshpiter/docker-accelerate/refs/heads/main/background.jpg');
                --primary-glow-start: rgba(59, 130, 246, 0.4); /* Blue */
                --primary-glow-end: rgba(139, 92, 246, 0.4); /* Purple */
                --card-bg: rgba(30, 41, 59, 0.4); /* Slate-800 with transparency */
                --card-border: rgba(255, 255, 255, 0.1);
                --text-primary: #e2e8f0; /* Slate-200 */
                --text-secondary: #94a3b8; /* Slate-400 */
                --text-heading: #f8fafc; /* Slate-50 */
                --accent-green: #34d399; /* Emerald-400 */
                --accent-blue: #60a5fa; /* Blue-400 */
                --accent-purple: #a78bfa; /* Violet-400 */
                --code-bg: rgba(51, 65, 85, 0.5); /* Slate-700 with transparency */
                --shadow-color: rgba(0, 0, 0, 0.2);
                --copy-btn-bg: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
                --copy-btn-hover-bg: linear-gradient(135deg, #3b82f6, #8b5cf6);
                --copy-success-bg: #22c55e; /* Green-500 */
                --copy-error-bg: #ef4444; /* Red-500 */
            }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                color: var(--text-primary);
                background-color: #0f172a; /* Slate-900 */
                background-image: var(--bg-url);
                background-size: cover;
                background-position: center;
                background-attachment: fixed;
                min-height: 100vh;
                overflow-x: hidden;
                line-height: 1.6;
            }
            .overlay {
                background: linear-gradient(180deg, rgba(15, 23, 42, 0.55), rgba(15, 23, 42, 0.85)); /* 调整透明度 */
                backdrop-filter: blur(8px);
                min-height: 100vh;
                padding: clamp(20px, 5vw, 50px); /* Responsive padding */
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .header {
                text-align: center;
                margin-bottom: clamp(30px, 6vh, 60px);
                width: 100%;
                max-width: 900px;
                animation: fadeInDown 0.8s ease-out;
            }
            .header h1 {
                font-size: clamp(2rem, 6vw, 3.5rem);
                font-weight: 700;
                margin-bottom: 0.5em;
                background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple), var(--accent-green));
                -webkit-background-clip: text;
                background-clip: text;
                -webkit-text-fill-color: transparent;
                text-shadow: 0 2px 10px var(--shadow-color);
            }
            .header p {
                font-size: clamp(1rem, 2.5vw, 1.2rem);
                color: var(--text-secondary);
                max-width: 600px;
                margin: 0 auto;
            }
            .container {
                width: 100%;
                max-width: 1200px;
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(min(100%, 350px), 1fr)); /* Responsive grid */
                gap: clamp(20px, 4vw, 30px);
            }
            .card {
                background: var(--card-bg);
                border-radius: 16px;
                border: 1px solid var(--card-border);
                box-shadow: 0 8px 32px var(--shadow-color);
                overflow: hidden;
                transition: transform 0.3s ease, box-shadow 0.3s ease;
                animation: fadeInUp 0.8s ease-out;
                display: flex;
                flex-direction: column;
            }
            .card:hover {
                transform: translateY(-8px) scale(1.02);
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
                border-color: rgba(255, 255, 255, 0.2);
            }
            .card-header {
                padding: 16px 24px;
                background: rgba(255, 255, 255, 0.05);
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid var(--card-border);
            }
            .path-title {
                font-size: 1.3rem;
                font-weight: 600;
                color: var(--text-heading);
            }
            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 0.8rem;
                font-weight: 500;
                background-color: rgba(52, 211, 153, 0.1); /* Green tint */
                color: var(--accent-green);
            }
            .status-badge svg {
                color: var(--accent-green);
            }
            .card-body {
                padding: 24px;
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .url-group {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .url-label {
                font-size: 0.85rem;
                color: var(--text-secondary);
                font-weight: 500;
            }
            .url-value {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap; /* Allow wrapping */
            }
            .url-value code {
                background: var(--code-bg);
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 0.9rem;
                color: var(--text-primary);
                word-break: break-all; /* Break long URLs */
                flex-grow: 1; /* Take available space */
                min-width: 150px; /* Ensure code block has some width */
            }
            .copy-btn {
                background: var(--copy-btn-bg);
                color: white;
                border: none;
                border-radius: 6px;
                padding: 6px 8px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: background 0.3s ease, transform 0.2s ease;
                flex-shrink: 0; /* Prevent shrinking */
            }
            .copy-btn:hover {
                background: var(--copy-btn-hover-bg);
                transform: scale(1.1);
            }
             .copy-btn:active {
                transform: scale(0.95);
            }
            .copy-btn svg {
                width: 14px;
                height: 14px;
            }
            .copy-btn.copied {
                background: var(--copy-success-bg);
            }
            .copy-btn.error {
                 background: var(--copy-error-bg);
            }
            .footer {
                margin-top: clamp(40px, 8vh, 80px);
                text-align: center;
                font-size: 0.9rem;
                color: var(--text-secondary);
                padding: 20px;
                width: 100%;
                max-width: 900px;
            }
            .footer a {
                color: var(--text-secondary);
                text-decoration: none;
                transition: color 0.3s ease;
            }
            .footer a:hover {
                color: var(--text-primary);
            }
            @keyframes fadeInDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    </head>
    <body>
        <div class="overlay">
            <header class="header">
                <h1>API 代理仪表板</h1>
                <p>管理和监控您的 API 代理端点</p>
            </header>
            <main class="container">
                ${cardsHtml}
            </main>
            <footer class="footer">
                © ${new Date().getFullYear()} API 代理服务 - powered by <a href="https://jxufe.icu/u/piter/summary" target="_blank" rel="noopener noreferrer">piter</a>
            </footer>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/clipboard@2.0.11/dist/clipboard.min.js"></script>
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                const clipboard = new ClipboardJS('.copy-btn');
                const originalIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
                const successIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

                clipboard.on('success', function(e) {
                    const btn = e.trigger;
                    btn.innerHTML = successIcon;
                    btn.classList.add('copied');

                    setTimeout(() => {
                        btn.innerHTML = originalIcon;
                        btn.classList.remove('copied');
                    }, 2000);
                    e.clearSelection();
                });

                clipboard.on('error', function(e) {
                    console.error('复制失败，但可能已在剪贴板中:', e);
                    const btn = e.trigger;
                    btn.innerHTML = '?';
                    btn.classList.add('error');
                    btn.title = '复制可能已成功，请尝试粘贴';

                    setTimeout(() => {
                        btn.innerHTML = originalIcon;
                        btn.classList.remove('error');
                        btn.title = '复制代理地址';
                    }, 3000);
                });
            });
        </script>
    </body>
    </html>
    `;

  return new Response(htmlContent, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function serveStaticFile(
  request: Request,
  filepath: string,
): Promise<Response> {
  try {
    const resolvedPath = Deno.realPathSync(filepath);
    const projectRoot = Deno.realPathSync(".");

    if (!resolvedPath.startsWith(projectRoot)) {
      console.warn(`Forbidden access attempt: ${filepath}`);
      return new Response("Forbidden", { status: 403 });
    }

    return await serveFile(request, resolvedPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not Found", { status: 404 });
    } else if (error instanceof Deno.errors.PermissionDenied) {
      console.error(`Permission denied for static file: ${filepath}`);
      return new Response("Forbidden", { status: 403 });
    } else {
      console.error(`Error serving static file ${filepath}:`, error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }
}

// --- Start the Server ---
console.log(`[${new Date().toISOString()}] Server starting...`);
console.log(`  Port: ${PROXY_PORT}`);
console.log(`  Domain: ${PROXY_DOMAIN}`);
if (!PROXY_PASSWORD) console.warn("  Authentication: DISABLED");
console.log("  Proxy Endpoints:");
Object.keys(apiMapping)
  .sort()
  .forEach((p) =>
    console.log(`    https://${PROXY_DOMAIN}${p} -> ${apiMapping[p]}`),
  );
console.warn(`Ensure your proxy is accessed via HTTPS: https://${PROXY_DOMAIN}/`);

serve(
  async (req) => {
    const start = performance.now();
    let responseStatus = 500; // Default to error
    try {
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204, // No Content
          headers: {
            "Access-Control-Allow-Origin": "*", // Adjust in production if needed
            "Access-Control-Allow-Methods":
              "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-Requested-With",
            "Access-Control-Max-Age": "86400", // Cache preflight for 1 day
          },
        });
      }

      const response = await main(req);
      responseStatus = response.status;
      return response;
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Unhandled error for ${req.method} ${req.url}:`,
        error,
      );
      return new Response("Internal Server Error", { status: 500 });
    } finally {
      const duration = performance.now() - start;
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.url} - ${responseStatus} (${duration.toFixed(2)}ms)`,
      );
    }
  },
  { port: parseInt(PROXY_PORT, 10) },
);
