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
const avatarUrl = Deno.env.get("AVATAR_URL") || "https://via.placeholder.com/150";  // 新加的，来自之前的项目

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
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>需要登录</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f3f4f6;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          .login-container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            width: 300px;
            text-align: center;
          }
          .avatar {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            margin-bottom: 1rem;
          }
          h2 {
            color: #1a202c;
            font-size: 1.5rem;
            margin-bottom: 1rem;
          }
          input[type="password"] {
            width: 100%;
            padding: 0.5rem;
            margin: 0.5rem 0;
            border: 1px solid #cbd5e0;
            border-radius: 4px;
          }
          button {
            width: 100%;
            padding: 0.75rem;
            background-color: #4299e1;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 1rem;
          }
          button:hover {
            background-color: #2b6cb0;
          }
          .error-message {
            color: #f87171;
            margin-top: 15px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="login-container">
          <img src="${avatarUrl}" alt="Avatar" class="avatar">
          <h2>需要登录</h2>
          <p>请输入密码以访问 API 代理。</p>
          <form action="/login" method="post">
            <label for="password">密码:</label><br>
            <input type="password" id="password" name="password" required><br>
            <button type="submit">登录</button>
          </form>
          ${errorHtml}
        </div>
      </body>
    </html>
  `;
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
      const cookieValue = `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;
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

// --- Rest of the code remains the same ---
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

// ... (The rest of the functions like handleApiRequest, extractPrefixAndRest, handleDashboardPage, serveStaticFile remain unchanged)

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
    let responseStatus = 500;
    try {
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      const response = await main(req);
      responseStatus = response.status;
      return response;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Unhandled error for ${req.method} ${req.url}:`, error);
      return new Response("Internal Server Error", { status: 500 });
    } finally {
      const duration = performance.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${responseStatus} (${duration.toFixed(2)}ms)`);
    }
  },
  { port: parseInt(PROXY_PORT, 10) },
);
