# api-proxy-ng
* 感谢：https://linux.do/t/topic/278306 源代码
* 感谢：https://github.com/Nshpiter/api-proxy 添加验证、UI
* 感谢 https://deno.land 提供免费托管服务
## Preview: 
<img width="500" alt="image" src="https://github.com/user-attachments/assets/f7b2ce7f-f63c-4f66-9bd5-59d39241cfda" />

## 💪本地开发:
1. MacOS/Linux: curl -fsSL https://deno.land/install.sh | sh
2. Windows: irm https://deno.land/install.ps1 | iex

```deno
PROXY_DOMAIN= PROXY_PASSWORD= PROXY_PORT= AVATAR_URL="" Background_URL="" deno run --allow-net --allow-env main.ts
```

## deno托管
1. fork本仓库
2. 来到 https://dash.deno.com ,选择github-newproject,选择fork的仓库
3. 填写内容：


| 属性                 | 填写值     |
| -------------------- | ---------- |
| **Framework Preset** | `Unknown`  |
| **Install Step**     |            |
| **Build Step**       |            |
| **Root directory**   | `/`        |
| **Include files**    | `*` |
| **Exclude files**    | *.md       |
| **Entrypoint**       | `main.ts`  |


4. 添加变量,如下图：
<img width="915" alt="image" src="https://github.com/user-attachments/assets/83dd820d-4317-47bb-811b-d6ca233138c8" />

5. `deploy`
