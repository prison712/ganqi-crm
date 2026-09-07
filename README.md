# 集团销售客户管理 CRM

这是一个可在 Windows 单机直接运行的中文客户管理系统，采用 React + Vite 前端、Node.js + Express 后端和 SQLite 数据库。系统完整支持超级管理员/子管理员/销售权限、私海、公海、客户跟进、公共资料、软删除回收站、Excel 导入导出、分角色看板、账号管理、自助修改密码和操作审计。

日常使用请先看：[用户操作说明书](./用户操作说明书.md)。该说明书面向管理员和销售人员，包含登录、客户管理、领取释放、跟进和 Excel 等图文无关的逐步操作说明。

## 运行要求

- Windows 10/11（macOS、Linux 同样可以运行）
- Node.js 24 或更高版本
- npm 11 或更高版本
- 不需要安装独立数据库服务，也不需要 Visual Studio C++ 编译工具

确认版本：

```powershell
node --version
npm --version
```

## 首次安装

在项目根目录打开 PowerShell：

```powershell
npm install
Copy-Item .env.example .env
```

开发环境可直接使用示例配置。正式使用前必须编辑 `.env`，把 `JWT_SECRET` 改成至少 32 位的随机字符串；生产环境若密钥缺失、过短或仍为公开示例值，服务会拒绝启动。

可在 PowerShell 生成 64 位十六进制随机密钥：

```powershell
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

## 开发模式启动

一个命令同时启动前后端：

```powershell
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001
- Vite 会把 `/api` 请求代理到后端

初始管理员：

- 账号：`admin`
- 密码：`admin123`

首次登录后建议在“账号管理”页面创建日常使用的销售账号；超级管理员还可以创建普通管理员子账号。

首次使用 `admin/admin123` 登录时，系统会强制修改默认密码；改密完成前，后端也会拒绝访问其他业务接口。

## 生成演示数据

```powershell
npm run seed:demo
```

脚本会生成 3 个销售账号、12 个客户和 9 条跟进，覆盖私海、公海及四种客户状态。脚本可重复执行：固定演示客户会原位更新，用户后来补充的跟进与日志不会删除。如果 `demo_sales01` 等演示账号名已被真实账号占用，脚本会明确中止，绝不会覆盖真实账号密码。

演示销售账号：

| 账号 | 密码 |
|---|---|
| `demo_sales01` | `123456` |
| `demo_sales02` | `123456` |
| `demo_sales03` | `123456` |

## 生产模式启动

先构建前端，再启动一个 Express 进程：

```powershell
npm run build
npm start
```

浏览器访问 http://localhost:3001 。Express 会托管 `client/dist` 并同时提供 `/api` 接口。

正式运行建议 `.env` 至少包含：

```text
NODE_ENV=production
HOST=127.0.0.1
JWT_SECRET=上一步生成的随机密钥
UPLOAD_DIR=data/uploads
MAX_UPLOAD_FILE_MB=50
MAX_UPLOAD_FILES=10
```

服务默认只监听本机回环地址，并采用前后端同源访问。确需局域网访问时，可显式设置 `HOST=0.0.0.0`，同时务必配置 Windows 防火墙访问范围、HTTPS 反向代理和强随机密钥。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 同时启动前后端开发服务 |
| `npm test` | 运行全部前后端自动化测试 |
| `npm run build` | 构建前端生产文件 |
| `npm start` | 启动后端并托管已构建前端 |
| `npm run seed:demo` | 幂等生成演示数据 |

## 数据库初始化与位置

数据库固定存放在项目根目录：

```text
./data/customer-erp.sqlite
```

首次启动或执行演示数据脚本时会自动：

1. 创建 `data` 目录和 SQLite 文件。
2. 创建表、索引并开启外键约束和 WAL 模式。
3. 在管理员不存在时创建 `admin/admin123`。

重置数据库前请先停止所有前后端进程，然后执行：

```powershell
Remove-Item -LiteralPath .\data\customer-erp.sqlite -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\data\customer-erp.sqlite-wal -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\data\customer-erp.sqlite-shm -ErrorAction SilentlyContinue
npm run seed:demo
```

以上命令只删除明确指定的本项目数据库文件；生产数据请先备份。

## Excel 导入导出

1. 在“我的客户”或管理员“全部客户”页面点击“下载模板”。
2. 按模板填写公司名称、联系人、电话、邮箱、来源、备注。
3. 上传 `.xlsx` 文件；单个文件最大 5 MB，最多 5,000 条数据。
4. 公司名称必填，邮箱填写时必须合法。
5. 系统按标准化后的“公司名称 + 电话”判重，并逐行返回成功、重复或错误原因。
6. 导出会复用页面当前关键词、状态、来源和归属筛选；后端再次执行权限过滤。

销售导入后进入本人私海；管理员未选择销售时进入公海，选择销售后进入对应私海。

## 公共资料库

- 管理员和销售都可以上传、搜索、筛选、预览和下载公共资料。
- 每批最多 10 个文件，单文件最大 50 MB。
- 允许 PDF、Word、Excel、PowerPoint、JPG/JPEG、PNG、GIF、WebP、TXT 和 ZIP。
- PDF 与图片可在线预览，Office、TXT、ZIP 仅下载。
- 上传者可删除自己的资料；管理员可删除任意资料，并在“资料回收站”恢复或彻底删除。
- 上传目录由 `UPLOAD_DIR` 设置；相对路径以项目根目录为基准。不要把该目录配置成 Web 静态目录，文件访问必须经过登录鉴权接口。

## 数据备份与服务器迁移

数据库和 `UPLOAD_DIR` 必须作为同一份备份同时保存，否则会出现“列表有记录但文件不存在”。Windows 局域网升级前：

1. 通知用户停止新增、上传和删除操作。
2. 查询并停止端口 3001 的旧 Node 进程。
3. 备份 `data/customer-erp.sqlite` 和整个 `data/uploads` 目录。
4. 完成升级、测试后再启动服务。

服务停止后可执行：

```powershell
$erpBackupDir = Join-Path (Get-Location) ("data/backups/manual-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $erpBackupDir -Force
Copy-Item -LiteralPath .\data\customer-erp.sqlite -Destination $erpBackupDir
Copy-Item -LiteralPath .\data\uploads -Destination $erpBackupDir -Recurse
```

迁移到服务器时，在旧机器停止写入和后端进程，确认 SQLite 已关闭，再复制数据库与上传目录。在新服务器设置 `DB_FILE`、`UPLOAD_DIR`、强随机 `JWT_SECRET` 和目录读写权限，运行 `npm ci`、`npm test`、`npm run build` 后启动。上线时使用 HTTPS 反向代理，不要直接公开上传目录；首次开放前抽查资料列表、预览、下载和回收站。

## 权限与审计规则

- 销售只能查看和修改自己的私海客户，以及浏览公海客户。
- 公海每次只能领取一条；并发领取由 SQLite 写事务和条件更新保护。
- 销售只能释放自己的客户，必须填写 2–200 字释放原因。
- 停用销售账号会自动释放该账号名下全部客户，包括回收站客户的归属；跟进和操作日志不会删除。
- 删除销售账号为软删除：账号立即禁止登录并自动释放名下客户，用户行、历史跟进和操作日志永久保留。
- 只有超级管理员可创建管理员子账号；子管理员拥有管理员业务权限，但不能创建或操作超级管理员。
- 所有登录用户均可从右上角个人菜单修改密码。新密码必须为 8–128 位并同时包含字母和数字。
- 客户删除为软删除，仅管理员可在回收站查看和恢复。
- 跟进记录和操作日志只允许新增或查看，不提供修改和删除接口。
- 所有权限均由后端 JWT、角色校验和客户归属校验强制执行；前端菜单隐藏仅改善体验。
- 首页“本周跟进”按服务器本地时区统计，从周一 00:00 起算；销售只统计本人跟进，管理员统计全员跟进。

## 项目结构

```text
.
├─ client/                 React + Vite 中文前端
├─ server/                 Express API、SQLite 与测试
├─ data/                   运行时 SQLite 数据库
├─ docs/superpowers/       设计文档与实施计划
├─ .env.example            环境变量模板
├─ package.json            工作区统一命令
└─ README.md
```

## 常见故障排查

### Node.js 版本过低或提示找不到 `node:sqlite`

本项目使用 Node.js 24 内置 SQLite。安装 Node.js 24 LTS 或更高版本，然后删除 `node_modules` 并重新安装：

```powershell
Remove-Item -LiteralPath .\node_modules -Recurse -Force
npm install
```

### 3001 或 5173 端口被占用

查询占用进程：

```powershell
Get-NetTCPConnection -LocalPort 3001,5173 -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess
```

确认进程可以关闭后，使用实际进程号：

```powershell
Stop-Process -Id 12345
```

也可在 `.env` 修改后端 `PORT`；修改前端端口时同步调整 `client/vite.config.js`。

### 数据库文件被锁定

SQLite 同一时间允许多个读取者，但只允许一个写入者。本项目已经用事务串行化关键写操作。如果仍提示锁定：

1. 停止重复启动的后端进程。
2. 不要用数据库查看工具长时间保持写事务。
3. 不要手动删除运行中的 `.sqlite-wal` 或 `.sqlite-shm` 文件。
4. 重启后端再试。

### JWT 密钥缺失或修改后全部用户退出

检查根目录 `.env`：

```text
JWT_SECRET=请替换为至少32位随机字符串
```

修改密钥会让既有登录令牌立即失效，这是正常安全行为；重新登录即可。

如果生产环境提示 `生产环境 JWT_SECRET` 并拒绝启动，请确认 `.env` 中已设置非示例、至少 32 位的随机值，且没有多余引号或空格。

### 初始管理员登录后无法进入业务页面

这是首次登录强制改密保护。请在弹窗中输入当前密码 `admin123`，再设置 8–128 位新密码。改密成功后业务页面会自动显示。若忘记已修改的管理员密码，请先备份数据库，再由维护人员通过受控脚本重置；不要删除生产数据库。

### PowerShell 阻止 npm 脚本

仅为当前 PowerShell 进程临时放开脚本策略：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

然后重新运行 `npm run dev`。无需修改系统级策略。

### 前端提示无法连接后端或代理失败

1. 确认 http://localhost:3001 已启动。
2. 查看运行 `npm run dev` 的终端是否有后端错误。
3. 确认 `client/vite.config.js` 的代理目标是 `http://localhost:3001`。
4. 如果修改了后端端口，也要同步修改代理目标并重启 Vite。

### 安装依赖失败

先清理 npm 缓存元数据并按锁文件重装：

```powershell
npm cache verify
npm ci
```

本项目使用 Node 内置 SQLite，不依赖 `node-gyp` 或 Visual Studio C++ 工具链。

### 公共资料上传失败

- 提示超过限制：确认单文件不超过 50 MB、每批不超过 10 个。
- 提示格式不支持或内容不一致：不要只改扩展名，请使用真实的允许格式文件。
- 提示磁盘空间不足：停止上传，清理服务器无关文件或扩容后重试，不要手动删除 `data/uploads` 中的文件。
- 提示目录不可写：检查运行 Node.js 的 Windows 账号是否对 `UPLOAD_DIR` 有读写权限。
- 提示资料文件不存在或损坏：先保留数据库和上传目录现场，从同一时间点备份恢复；不要直接删除数据库记录。

## 测试与安全检查

```powershell
npm test
npm run build
npm audit --audit-level=high
```

后端测试使用内存 SQLite，覆盖认证、权限、客户流转、公共资料上传/下载/回收站、跟进、角色看板、Excel 和完整 HTTP 生命周期。前端测试覆盖角色菜单、JWT 失效、公共资料、筛选导出、导入结果表格、释放原因和高危确认。SheetJS 使用官方 `0.20.3` 修复版本。
