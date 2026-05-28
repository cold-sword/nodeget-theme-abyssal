# Abyssal

一款为 NodeGet 设计的深海幽蓝主题。

## 演示站

https://www.dmit.li

## Docker 部署

[![Docker Pulls](https://img.shields.io/docker/pulls/coldsword/nodeget-theme-abyssal?logo=docker)](https://hub.docker.com/r/coldsword/nodeget-theme-abyssal)

支持 `linux/amd64` 和 `linux/arm64`，镜像随 main 分支自动构建推送。

### docker-compose.yml

```yaml
services:
  nodeget-abyssal:
    image: coldsword/nodeget-theme-abyssal:latest
    restart: unless-stopped
    ports:
      - "3000:80"
    env_file:
      - .env
```

### .env

```dotenv
SITE_NAME=Abyssal Status
SITE_LOGO=
SITE_FOOTER=Powered by NodeGet
SITE_1=name="主节点",backend_url="wss://your-server.example.com",token="***"
```

多节点追加 `SITE_2`、`SITE_3` 即可：

```dotenv
SITE_1=name="Node 1",backend_url="wss://node1.example.com",token="***"
SITE_2=name="Node 2",backend_url="wss://node2.example.com",token="***"
```

### 启动

```bash
docker compose up -d
```

修改 `.env` 后重启生效，无需重新构建镜像：

```bash
docker compose restart
```

> 也支持 `NODEGET_CONFIG` 环境变量传入完整 JSON。修改配置只需重启容器，不用重新 build。

---

## 一键部署到 Vercel / Cloudflare Pages

Fork 本仓库，然后点击下方按钮一键部署。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https://github.com/cold-sword/nodeget-theme-abyssal)
[![Deploy to Cloudflare Pages](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cold-sword/nodeget-theme-abyssal)

部署时设置环境变量 `NODEGET_CONFIG`（JSON 格式）：

```json
{
  "user_preferences": {
    "site_name": "Abyssal Status",
    "site_logo": "",
    "footer": "Powered by NodeGet"
  },
  "site_tokens": [
    {
      "name": "master server node 1",
      "backend_url": "wss://your-backend.example.com",
      "token": "YOUR_TOKEN_HERE"
    }
  ]
}
```

> **注意**：`NODEGET_CONFIG` 是 **build 时** 注入的，修改后必须重新部署才会生效。

部署完成后绑定自定义域名即可使用。要更新版本则在 GitHub 仓库点击 Sync fork。

---

## NodeGet 面板一键部署

> 需要主控版本在 **0.2.6 以上**，请先到[控制面板](https://dash.nodeget.com/#/dashboard/node-manage?tab=servers)查看主控版本。

<a href="https://dash.nodeget.com/#/dashboard/theme-management?add=https://nodeget.li">
  <img src="https://dash.nodeget.com/deploy-button.png" alt="deploy button" width="230px" />
</a>

---

## 手动安装（上传 ZIP）

1. 在本仓库 GitHub Release 下载 `NodeGet-Abyssal-Theme.zip`。
2. 打开 NodeGet-Board 后台，进入 `Dashboard -> 主题管理`。
3. 点击「从本地上传」，选择下载的 ZIP。
4. 确认主题名称为 `NodeGet Abyssal Theme`，然后创建并上传。
5. 进入主题详情，填写站点标题、页脚、visitor token 等配置。
6. 回到主题列表，打开 Abyssal 的「是否启用」开关。

启用后访问你的 NodeGet 后端根域名：

```text
https://你的后端域名/
```

未启用时可用静态路径预览：

```text
https://你的后端域名/nodeget/static/theme_Abyssal/index.html
```

## 更新

1. 下载新版 `NodeGet-Abyssal-Theme.zip`。
2. 在主题列表中找到 Abyssal。
3. 选择「从本地重新上传」并上传新版 ZIP。

更新时建议保留旧的 `site_tokens` 和用户配置，避免覆盖你自己的后端 token。

## 许可证

AGPL-3.0-only。详见 [LICENSE](LICENSE)。

## 鸣谢

本主题基于 [NodeGet StatusShow](https://github.com/NodeSeekDev/NodeGet-StatusShow) 开发。
