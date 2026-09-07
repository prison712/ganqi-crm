# 集团销售客户管理 ERP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个中文、可在 Windows 单机运行的客户管理 ERP，完整实现认证权限、私海/公海、客户跟进、Excel、统计、账号管理和审计日志。

**Architecture:** 使用 npm workspaces 管理 `client` 和 `server`。React/Vite 前端只负责交互与展示；Express 服务端承担全部身份、角色和对象级权限判断，并通过 Node 内置 `node:sqlite` 事务保证客户领取、释放、停用账号等业务一致性。开发时 Vite 代理 `/api`，生产时 Express 托管前端构建产物。

**Tech Stack:** Node.js 24+、React 19、Vite、React Router、Ant Design、Axios、Express、Node 内置 `node:sqlite`、JWT、bcryptjs、Zod、Multer、SheetJS、Vitest、Supertest、React Testing Library。

**Spec:** `docs/superpowers/specs/2026-08-28-customer-erp-design.md`

## Global Constraints

- 中文界面，深蓝色导航与橙色强调色，桌面端优先并提供基础响应式适配。
- SQLite 数据库必须存放在根目录 `data/`，路径处理兼容 Windows PowerShell。
- 初始管理员固定为 `admin/admin123`，密码只以 bcrypt 哈希保存。
- 所有业务权限强制在后端验证，前端菜单隐藏不能作为安全边界。
- 客户使用软删除；跟进记录和操作日志不提供编辑、删除能力。
- 公海领取单次一条且需要并发防护；释放必须记录 2 至 200 字原因。
- Excel 仅接受 `.xlsx`，按标准化“公司名称 + 电话”判重，导出复用当前筛选条件。
- 所有用户可见的业务错误使用中文。

---

## File Structure

```text
customer-erp/
├─ package.json                    # npm workspaces 与统一命令
├─ .env.example                    # 服务端环境变量示例
├─ .gitignore
├─ README.md
├─ data/.gitkeep
├─ server/
│  ├─ package.json
│  ├─ src/
│  │  ├─ app.js                    # Express 应用装配
│  │  ├─ server.js                 # 监听端口与生产静态托管
│  │  ├─ config.js                 # 跨平台路径和环境配置
│  │  ├─ db.js                     # SQLite 连接、初始化和事务入口
│  │  ├─ errors.js                 # 中文业务错误类型
│  │  ├─ middleware/auth.js        # JWT 与角色中间件
│  │  ├─ middleware/error.js       # 统一错误响应
│  │  ├─ modules/auth.js           # 登录与当前用户
│  │  ├─ modules/users.js          # 销售账号管理与停用释放
│  │  ├─ modules/customers.js      # 客户 CRUD、查询、领取释放分配恢复
│  │  ├─ modules/followUps.js      # 跟进新增与查询
│  │  ├─ modules/logs.js           # 不可变操作日志查询/写入
│  │  ├─ modules/dashboard.js      # 分角色统计
│  │  ├─ modules/excel.js          # 模板、导入、导出
│  │  └─ seed-demo.js              # 幂等模拟数据脚本
│  └─ test/
│     ├─ helpers.js                # 临时数据库和鉴权测试工具
│     ├─ auth-users.test.js
│     ├─ customers.test.js
│     ├─ followups-dashboard.test.js
│     └─ excel.test.js
└─ client/
   ├─ package.json
   ├─ vite.config.js
   ├─ index.html
   └─ src/
      ├─ main.jsx
      ├─ App.jsx                   # 路由与鉴权边界
      ├─ styles.css                # 主题与响应式布局
      ├─ api/http.js               # Axios 与单次 401 跳转
      ├─ auth/AuthContext.jsx
      ├─ layout/AppLayout.jsx
      ├─ components/CustomerForm.jsx
      ├─ components/CustomerFilters.jsx
      ├─ components/CustomerTable.jsx
      ├─ components/DangerConfirm.jsx
      ├─ pages/LoginPage.jsx
      ├─ pages/DashboardPage.jsx
      ├─ pages/PrivateCustomersPage.jsx
      ├─ pages/PublicCustomersPage.jsx
      ├─ pages/AllCustomersPage.jsx
      ├─ pages/RecycleBinPage.jsx
      ├─ pages/CustomerDetailPage.jsx
      ├─ pages/UsersPage.jsx
      ├─ pages/OperationLogsPage.jsx
      └─ test/
         ├─ setup.js
         ├─ auth-routing.test.jsx
         ├─ customer-pages.test.jsx
         └─ admin-pages.test.jsx
```

### Task 1: Workspace, Database, and Authentication Foundation

**Files:**
- Create: `package.json`, `.env.example`, `.gitignore`, `data/.gitkeep`
- Create: `server/package.json`, `server/src/config.js`, `server/src/db.js`, `server/src/errors.js`
- Create: `server/src/middleware/auth.js`, `server/src/middleware/error.js`
- Create: `server/src/modules/auth.js`, `server/src/app.js`, `server/src/server.js`
- Test: `server/test/helpers.js`, `server/test/auth-users.test.js`

**Interfaces:**
- Produces: `createDatabase({ filename })`, `createApp({ db, jwtSecret })`, `requireAuth`, `requireRole('admin')`, `AppError`.
- Produces API: `POST /api/auth/login`, `GET /api/auth/me`.

- [ ] **Step 1: Scaffold workspace manifests and write the failing authentication test**

```js
it('creates the initial administrator and authenticates with admin123', async () => {
  const { app } = createTestApp();
  const response = await request(app).post('/api/auth/login').send({
    username: 'admin', password: 'admin123'
  });
  expect(response.status).toBe(200);
  expect(response.body.data.user).toMatchObject({ username: 'admin', role: 'admin' });
  expect(response.body.data.token).toEqual(expect.any(String));
});

it('rejects missing, invalid, and expired JWTs with Chinese messages', async () => {
  const { app, expiredToken } = createTestApp();
  expect((await request(app).get('/api/auth/me')).body.error.message).toBe('请先登录');
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expiredToken}`)).body.error.message)
    .toBe('登录已过期，请重新登录');
});
```

- [ ] **Step 2: Run the authentication test and verify RED**

Run: `npm install && npm --workspace server test -- auth-users.test.js`

Expected: FAIL because `createTestApp` and authentication routes do not exist.

- [ ] **Step 3: Implement cross-platform config, schema initialization, error format, JWT middleware, and auth routes**

Use `path.resolve(process.cwd(), 'data', process.env.DB_FILE || 'customer-erp.sqlite')`, create the directory with `fs.mkdirSync(dir, { recursive: true })`, enable `foreign_keys` and `journal_mode = WAL`, create the four schema tables and indexes, then seed the administrator only when absent. `createApp` must accept an injected database so tests use `:memory:`.

```js
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
```

- [ ] **Step 4: Run the focused and full server tests and verify GREEN**

Run: `npm --workspace server test -- auth-users.test.js && npm --workspace server test`

Expected: all tests pass with no unhandled rejection or SQLite warning.

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example .gitignore data server
git commit -m "feat: add database and authentication foundation"
```

### Task 2: Sales Account Management and Automatic Release

**Files:**
- Modify: `server/src/db.js`, `server/src/app.js`
- Create: `server/src/modules/logs.js`, `server/src/modules/users.js`
- Test: `server/test/auth-users.test.js`

**Interfaces:**
- Consumes: `createDatabase`, `requireAuth`, `requireRole`, `AppError`.
- Produces API: `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-password`, `POST /api/users/:id/toggle-active`.
- Produces: `writeOperationLog(db, entry)` used by later modules.

- [ ] **Step 1: Write failing tests for administrator-only account changes and atomic disable**

```js
it('disables a salesperson, clears every customer owner, and preserves history', async () => {
  const { app, db, adminToken, salesUser } = createAuthenticatedTestApp();
  const active = insertCustomer(db, { ownerId: salesUser.id });
  const deleted = insertCustomer(db, { ownerId: salesUser.id, deletedAt: '2026-08-28T00:00:00.000Z' });
  insertFollowUp(db, { customerId: active.id, authorId: salesUser.id });

  const response = await request(app)
    .post(`/api/users/${salesUser.id}/toggle-active`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: false });

  expect(response.status).toBe(200);
  expect(db.prepare('SELECT owner_id FROM customers WHERE id IN (?, ?)').all(active.id, deleted.id))
    .toEqual([{ owner_id: null }, { owner_id: null }]);
  expect(db.prepare('SELECT count(*) total FROM follow_ups').get().total).toBe(1);
  expect(db.prepare("SELECT count(*) total FROM operation_logs WHERE action = 'account_disabled'").get().total).toBe(1);
});
```

Also assert a sales token receives 403 on every `/api/users` route and a disabled salesperson receives “账号已停用，请联系管理员”.

- [ ] **Step 2: Run the account tests and verify RED**

Run: `npm --workspace server test -- auth-users.test.js`

Expected: FAIL because user-management endpoints and logs do not exist.

- [ ] **Step 3: Implement account CRUD, password reset, and disable transaction**

Within one SQLite transaction: update `users.is_active`, select all owned customers including soft-deleted rows, set their `owner_id = NULL`, append one `release` log per customer with reason “销售账号停用自动释放”, then append `account_disabled`. Never delete user, follow-up, or log rows.

- [ ] **Step 4: Run account and full server tests and verify GREEN**

Run: `npm --workspace server test -- auth-users.test.js && npm --workspace server test`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/auth-users.test.js
git commit -m "feat: add sales account administration"
```

### Task 3: Customer Queries, CRUD, Soft Delete, and Ownership Rules

**Files:**
- Create: `server/src/modules/customers.js`
- Modify: `server/src/app.js`
- Test: `server/test/customers.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `requireRole`, `AppError`, `writeOperationLog`.
- Produces API: `GET/POST /api/customers`, `GET/PATCH/DELETE /api/customers/:id`, `POST /api/customers/:id/restore`.
- Query contract: `scope=private|public|all|recycle`, `keyword`, `status`, `source`, `ownerId`, `page`, `pageSize`.
- Response contract: `{ data: { items, pagination: { page, pageSize, total } } }`.

- [ ] **Step 1: Write failing authorization and soft-delete tests**

```js
it('never exposes another salesperson private customer', async () => {
  const { app, db, salesAToken, salesB } = createAuthenticatedTestApp();
  const customer = insertCustomer(db, { ownerId: salesB.id });
  expect((await request(app).get(`/api/customers/${customer.id}`).set(auth(salesAToken))).status).toBe(403);
  expect((await request(app).patch(`/api/customers/${customer.id}`).set(auth(salesAToken)).send({ notes: '越权' })).status).toBe(403);
});

it('moves deleted customers to administrator-only recycle bin and restores them', async () => {
  const { app, adminToken, salesToken, customer } = createCustomerScenario();
  expect((await request(app).delete(`/api/customers/${customer.id}`).set(auth(salesToken))).status).toBe(200);
  expect((await request(app).get('/api/customers?scope=recycle').set(auth(salesToken))).status).toBe(403);
  expect((await request(app).post(`/api/customers/${customer.id}/restore`).set(auth(adminToken))).status).toBe(200);
});
```

Add literal assertions for keyword/status/source/owner filters, pagination totals, validation messages, and sales-created customer ownership.

- [ ] **Step 2: Run customer tests and verify RED**

Run: `npm --workspace server test -- customers.test.js`

Expected: FAIL because customer routes are missing.

- [ ] **Step 3: Implement parameterized customer queries and object-level authorization**

Build scope predicates server-side from `req.user`; ignore or reject disallowed `ownerId`. Validate with Zod, cap `pageSize` at 100, use parameterized SQL, and write soft-delete/restore logs in transactions. Do not expose `password_hash` or deleted data to sales.

- [ ] **Step 4: Run focused and full server tests and verify GREEN**

Run: `npm --workspace server test -- customers.test.js && npm --workspace server test`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/customers.js server/src/app.js server/test/customers.test.js
git commit -m "feat: add customer management and recycle bin"
```

### Task 4: Atomic Claim, Reasoned Release, and Administrator Assignment

**Files:**
- Modify: `server/src/modules/customers.js`
- Test: `server/test/customers.test.js`

**Interfaces:**
- Produces API: `POST /api/customers/:id/claim`, `POST /api/customers/:id/release` body `{ reason }`, `POST /api/customers/:id/assign` body `{ ownerId: number|null }`.

- [ ] **Step 1: Write failing tests for the state transitions**

```js
it('allows exactly one salesperson to claim a public customer', async () => {
  const { app, publicCustomer, salesAToken, salesBToken } = createClaimScenario();
  const first = await request(app).post(`/api/customers/${publicCustomer.id}/claim`).set(auth(salesAToken));
  const second = await request(app).post(`/api/customers/${publicCustomer.id}/claim`).set(auth(salesBToken));
  expect(first.status).toBe(200);
  expect(second.status).toBe(409);
  expect(second.body.error.message).toBe('该客户已被其他销售领取，请刷新列表');
});

it('requires a reason and ownership before release', async () => {
  const { app, salesAToken, salesBToken, salesACustomer } = createClaimScenario();
  expect((await request(app).post(`/api/customers/${salesACustomer.id}/release`).set(auth(salesBToken)).send({ reason: '不应成功' })).body.error.message)
    .toBe('只能释放属于自己的客户');
  expect((await request(app).post(`/api/customers/${salesACustomer.id}/release`).set(auth(salesAToken)).send({ reason: '' })).status)
    .toBe(400);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --workspace server test -- customers.test.js -t "claim|release|assign"`

Expected: FAIL because transition routes are missing.

- [ ] **Step 3: Implement transactional conditional updates and audit entries**

Claim must execute `UPDATE customers SET owner_id = ?, updated_at = ? WHERE id = ? AND owner_id IS NULL AND deleted_at IS NULL` and require `changes === 1`. Release must require active ownership and validated reason. Assignment is admin-only and rejects inactive sales targets. All mutations and logs share one transaction.

- [ ] **Step 4: Run customer and full server tests and verify GREEN**

Run: `npm --workspace server test -- customers.test.js && npm --workspace server test`

Expected: all tests pass, including the conflict response and log contents.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/customers.js server/test/customers.test.js
git commit -m "feat: protect customer ownership transitions"
```

### Task 5: Immutable Follow-ups, Role-aware Dashboard, and Logs

**Files:**
- Create: `server/src/modules/followUps.js`, `server/src/modules/dashboard.js`
- Modify: `server/src/modules/logs.js`, `server/src/app.js`
- Test: `server/test/followups-dashboard.test.js`

**Interfaces:**
- Produces API: `GET/POST /api/customers/:id/follow-ups`, `GET /api/dashboard/stats`, `GET /api/operation-logs`.
- No `PATCH` or `DELETE` route exists for follow-ups or operation logs.

- [ ] **Step 1: Write failing tests for immutable history and dashboard isolation**

```js
it('adds follow-up history and updates last_followed_at in one transaction', async () => {
  const { app, db, salesToken, customer } = createCustomerScenario();
  const response = await request(app).post(`/api/customers/${customer.id}/follow-ups`)
    .set(auth(salesToken)).send({ followedAt: '2026-08-28T09:00:00.000Z', content: '电话沟通', nextPlan: '发送方案' });
  expect(response.status).toBe(201);
  expect(db.prepare('SELECT last_followed_at FROM customers WHERE id = ?').get(customer.id).last_followed_at)
    .toBe('2026-08-28T09:00:00.000Z');
  expect((await request(app).delete(`/api/customers/${customer.id}/follow-ups/1`).set(auth(salesToken))).status).toBe(404);
});

it('limits sales dashboard counts to the authenticated salesperson', async () => {
  const { app, salesAToken } = createDashboardScenario();
  const response = await request(app).get('/api/dashboard/stats').set(auth(salesAToken));
  expect(response.body.data).toMatchObject({ privateTotal: 2, weeklyFollowUps: 1 });
});
```

- [ ] **Step 2: Run dashboard tests and verify RED**

Run: `npm --workspace server test -- followups-dashboard.test.js`

Expected: FAIL because follow-up, dashboard, and log query routes are missing.

- [ ] **Step 3: Implement follow-up transactions, role-specific SQL, and admin-only log listing**

Use the same customer visibility guard as customer details. Dashboard predicates must be derived only from `req.user.role` and `req.user.id`. Define week start as Monday 00:00 in server local time and document this in README. Log pagination supports action, actor, and date filters.

- [ ] **Step 4: Run focused and full server tests and verify GREEN**

Run: `npm --workspace server test -- followups-dashboard.test.js && npm --workspace server test`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test/followups-dashboard.test.js
git commit -m "feat: add follow-ups dashboards and audit log"
```

### Task 6: Excel Template, Validated Import, and Filtered Export

**Files:**
- Create: `server/src/modules/excel.js`
- Modify: `server/src/app.js`
- Test: `server/test/excel.test.js`

**Interfaces:**
- Produces API: `GET /api/customers/import-template`, `POST /api/customers/import`, `GET /api/customers/export`.
- Import response: `{ data: { total, success, duplicate, failed, rows: [{ row, companyName, type, message }] } }`.

- [ ] **Step 1: Write failing tests using real in-memory XLSX workbooks**

```js
it('reports valid, duplicate, and invalid spreadsheet rows independently', async () => {
  const workbook = makeWorkbook([
    ['公司名称', '联系人', '电话', '邮箱', '来源', '备注'],
    ['演示科技', '张三', '138-0000-0001', 'a@example.com', '展会', ''],
    ['演示科技', '张三', '13800000001', 'a@example.com', '展会', '重复'],
    ['', '李四', '13900000002', 'bad-email', '转介绍', '']
  ]);
  const response = await uploadWorkbook(app, salesToken, workbook);
  expect(response.body.data).toMatchObject({ total: 3, success: 1, duplicate: 1, failed: 1 });
  expect(response.body.data.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ row: 3, type: 'duplicate' }),
    expect.objectContaining({ row: 4, type: 'error' })
  ]));
});
```

Also test `.xlsx` MIME/extension rejection, template headers, sales ownership, admin target ownership, and that export results match literal active filters without leaking other sales private customers.

- [ ] **Step 2: Run Excel tests and verify RED**

Run: `npm --workspace server test -- excel.test.js`

Expected: FAIL because Excel routes are missing.

- [ ] **Step 3: Implement template generation, row validation, normalized duplicate checks, and filtered export**

Limit files to 5 MB and 5,000 data rows. Use memory storage so no orphaned temporary file remains. Normalize company with `trim()` and phone by removing whitespace, hyphens, parentheses, and plus signs. Reuse the server-side customer filter builder for export rather than trusting client ownership parameters.

- [ ] **Step 4: Run Excel and full server tests and verify GREEN**

Run: `npm --workspace server test -- excel.test.js && npm --workspace server test`

Expected: all tests pass and generated workbooks can be parsed back by SheetJS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/excel.js server/src/app.js server/test/excel.test.js
git commit -m "feat: add customer Excel workflows"
```

### Task 7: Frontend Shell, Authentication, Theme, and Routing

**Files:**
- Create: `client/package.json`, `client/vite.config.js`, `client/index.html`
- Create: `client/src/main.jsx`, `client/src/App.jsx`, `client/src/styles.css`
- Create: `client/src/api/http.js`, `client/src/auth/AuthContext.jsx`, `client/src/layout/AppLayout.jsx`
- Create: `client/src/pages/LoginPage.jsx`, placeholder route components for all pages
- Test: `client/src/test/setup.js`, `client/src/test/auth-routing.test.jsx`

**Interfaces:**
- Consumes API: `/api/auth/login`, `/api/auth/me`.
- Produces: `AuthProvider`, `useAuth()`, `ProtectedRoute`, `RoleRoute`, shared `http` Axios instance.

- [ ] **Step 1: Write failing UI tests for login, route guards, role menus, and a single 401 redirect**

```jsx
it('shows administrator navigation only to administrators', async () => {
  renderApp({ user: { displayName: '管理员', role: 'admin' } });
  expect(await screen.findByText('销售账号')).toBeInTheDocument();
  expect(screen.getByText('操作日志')).toBeInTheDocument();
});

it('handles concurrent expired responses with one login redirect', async () => {
  await triggerConcurrentExpiredRequests();
  expect(mockNavigateToLogin).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('token')).toBeNull();
});
```

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `npm --workspace client test -- auth-routing.test.jsx`

Expected: FAIL because the client application does not exist.

- [ ] **Step 3: Implement the app shell and authentication flow**

Configure Ant Design theme tokens with `colorPrimary: '#f58220'`, deep-blue sider `#0b2a4a`, light content background `#f4f7fb`. Build responsive navigation, loading boundary, protected routes, role routes, and Axios interceptors. Preserve `location.pathname + location.search` before expired-token redirect.

- [ ] **Step 4: Run UI tests and production build and verify GREEN**

Run: `npm --workspace client test -- auth-routing.test.jsx && npm --workspace client run build`

Expected: tests pass and Vite emits `client/dist` without warnings treated as errors.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat: add authenticated React application shell"
```

### Task 8: Customer, Public Pool, Recycle Bin, and Follow-up UI

**Files:**
- Create: `client/src/components/CustomerForm.jsx`, `client/src/components/CustomerFilters.jsx`, `client/src/components/CustomerTable.jsx`, `client/src/components/DangerConfirm.jsx`
- Create: `client/src/pages/PrivateCustomersPage.jsx`, `client/src/pages/PublicCustomersPage.jsx`, `client/src/pages/AllCustomersPage.jsx`, `client/src/pages/RecycleBinPage.jsx`, `client/src/pages/CustomerDetailPage.jsx`
- Modify: `client/src/App.jsx`, `client/src/styles.css`
- Test: `client/src/test/customer-pages.test.jsx`

**Interfaces:**
- Consumes all customer, transition, follow-up, import-template, import, and export APIs.
- Produces reusable list query state `{ keyword, status, source, ownerId, page, pageSize }` shared with export.

- [ ] **Step 1: Write failing interaction tests for customer workflows**

```jsx
it('sends the current filters when exporting private customers', async () => {
  renderPrivateCustomers();
  await user.type(screen.getByPlaceholderText('搜索公司、联系人、电话或邮箱'), '科技');
  await user.selectOptions(screen.getByLabelText('客户状态'), 'following');
  await user.click(screen.getByRole('button', { name: '导出 Excel' }));
  expect(downloadRequest).toHaveBeenCalledWith(expect.objectContaining({ keyword: '科技', status: 'following', scope: 'private' }));
});

it('requires a release reason in the confirmation dialog', async () => {
  renderPrivateCustomers();
  await user.click(await screen.findByRole('button', { name: '释放' }));
  await user.click(screen.getByRole('button', { name: '确认释放' }));
  expect(await screen.findByText('请输入释放原因')).toBeInTheDocument();
  expect(releaseRequest).not.toHaveBeenCalled();
});
```

Also cover claim confirmation, soft-delete confirmation, import result rows, admin restore, form validation, paginated filtering, and add-only follow-up timeline.

- [ ] **Step 2: Run customer UI tests and verify RED**

Run: `npm --workspace client test -- customer-pages.test.jsx`

Expected: FAIL because customer components and pages do not exist.

- [ ] **Step 3: Implement reusable customer components and all customer routes**

Keep API state per page, reset page to 1 on filter change, display status tags with text, use Ant Design `Modal`, `Form`, `Table`, `Upload`, and `Timeline`. After mutation, refetch affected data and surface server Chinese messages. Template download and export use Blob downloads with UTF-8 filenames.

- [ ] **Step 4: Run customer UI tests and build and verify GREEN**

Run: `npm --workspace client test -- customer-pages.test.jsx && npm --workspace client run build`

Expected: tests pass and all customer routes compile.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat: add customer management interface"
```

### Task 9: Dashboard, User Administration, and Operation Log UI

**Files:**
- Create: `client/src/pages/DashboardPage.jsx`, `client/src/pages/UsersPage.jsx`, `client/src/pages/OperationLogsPage.jsx`
- Modify: `client/src/App.jsx`, `client/src/styles.css`
- Test: `client/src/test/admin-pages.test.jsx`

**Interfaces:**
- Consumes API: `/api/dashboard/stats`, `/api/users`, `/api/operation-logs`.

- [ ] **Step 1: Write failing role-specific dashboard and high-risk confirmation tests**

```jsx
it('renders sales dashboard labels without global operation data', async () => {
  renderDashboard({ role: 'sales', stats: salesStats });
  expect(await screen.findByText('我的私海')).toBeInTheDocument();
  expect(screen.getByText('本周我的跟进')).toBeInTheDocument();
  expect(screen.queryByText('最近全局操作')).not.toBeInTheDocument();
});

it('warns that disabling a salesperson releases every owned customer', async () => {
  renderUsersPage();
  await user.click(await screen.findByRole('button', { name: '停用' }));
  expect(screen.getByText(/名下全部客户将自动释放到公海/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run admin UI tests and verify RED**

Run: `npm --workspace client test -- admin-pages.test.jsx`

Expected: FAIL because dashboard, user, and log pages are placeholders.

- [ ] **Step 3: Implement role-aware cards, account dialogs, and log filters**

Render card labels from the authenticated role, not only returned numbers. Account creation/edit/reset/enable/disable uses validated forms and high-impact confirmations. Operation logs display timestamp, actor, action, customer, ownership transition, and release reason.

- [ ] **Step 4: Run all frontend tests and build and verify GREEN**

Run: `npm --workspace client test && npm --workspace client run build`

Expected: all frontend tests pass and build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "feat: add dashboards users and audit views"
```

### Task 10: Demo Seed, Production Serving, Documentation, and End-to-End Verification

**Files:**
- Create: `server/src/seed-demo.js`, `README.md`
- Modify: `server/src/server.js`, root `package.json`, `.gitignore`
- Test: `server/test/seed-demo.test.js`

**Interfaces:**
- Produces root scripts: `npm run dev`, `npm test`, `npm run build`, `npm start`, `npm run seed:demo`.
- Produces demo accounts printed by `npm run seed:demo`.

- [ ] **Step 1: Write a failing idempotency test for demo seeding**

```js
it('replaces only tagged demo data and leaves user data intact', () => {
  const db = createDatabase({ filename: ':memory:' });
  const real = insertCustomer(db, { companyName: '真实客户' });
  seedDemo(db);
  seedDemo(db);
  expect(db.prepare("SELECT count(*) total FROM customers WHERE company_name = '真实客户'").get().total).toBe(1);
  expect(db.prepare("SELECT count(*) total FROM users WHERE username LIKE 'demo_%'").get().total).toBe(3);
  expect(db.prepare("SELECT count(*) total FROM customers WHERE demo_tag = 'customer-erp-v1'").get().total).toBeGreaterThan(8);
  expect(db.prepare('SELECT id FROM customers WHERE id = ?').get(real.id)).toBeTruthy();
});
```

- [ ] **Step 2: Run the seed test and verify RED**

Run: `npm --workspace server test -- seed-demo.test.js`

Expected: FAIL because the seed module and `demo_tag` migration do not exist.

- [ ] **Step 3: Implement idempotent demo seeding and production static serving**

Seed `demo_sales01/123456`, `demo_sales02/123456`, and `demo_sales03/123456`, at least 12 customers across public/private pools and four statuses, plus follow-ups and logs. Add a nullable `demo_tag` to seeded tables. In production, serve `client/dist` and fall back to `index.html` only for non-API GET requests.

- [ ] **Step 4: Write complete Chinese README and Windows troubleshooting**

Document Node.js 24+, `npm install`, `.env` creation, `npm run dev`, URLs, `admin/admin123`, demo seed credentials, `npm test`, `npm run build && npm start`, database location/reset, Excel template, and exact diagnostics for port conflicts, unavailable `node:sqlite`, locked SQLite files, JWT configuration, PowerShell policy, and Vite proxy failures.

- [ ] **Step 5: Run fresh full verification**

Run:

```powershell
npm test
npm run build
npm run seed:demo
npm run seed:demo
git diff --check
```

Expected: every command exits 0; the second seed reports replacement rather than duplication; no whitespace errors.

- [ ] **Step 6: Execute a real API smoke flow**

Start the server against a temporary database, then verify: admin login → create salesperson → create public customer → salesperson claim → add follow-up → release with reason → admin soft-delete → recycle-bin visibility → restore → filtered Excel export. Assert each status code and parse the returned workbook.

- [ ] **Step 7: Commit**

```bash
git add package.json server client README.md .gitignore data/.gitkeep
git commit -m "docs: add demo setup and operating guide"
```

### Task 11: Final Requirements Audit

**Files:**
- Verify: all files listed above
- Modify: only files needed to fix an audit failure

**Interfaces:**
- Consumes the complete application and the approved design.
- Produces a release-ready local project.

- [ ] **Step 1: Map every design requirement to running evidence**

Create a temporary checklist covering authentication, role/object permissions, private/public ownership, claim conflict, release reason, automatic release on disable, soft delete/restore, immutable history, Excel template/import/export, Chinese errors, JWT redirect, high-risk confirmations, role dashboards, seed script, Windows data path, README, tests, and production build.

- [ ] **Step 2: Run the full verification suite from a clean install state**

Run:

```powershell
npm ci
npm test
npm run build
npm run seed:demo
npm start
```

Expected: install, tests, build, seed, and startup succeed; the app is reachable at the documented URL. Stop the server after the smoke check.

- [ ] **Step 3: Inspect repository state and documentation accuracy**

Run: `git status --short && git diff --check && git log --oneline -12`

Expected: only intentional changes remain, no whitespace errors, and commits correspond to independently testable tasks.

- [ ] **Step 4: Commit any audit fixes and re-run affected verification**

```bash
git add -- server/src server/test client/src README.md package.json
git commit -m "fix: address final ERP verification findings"
```

Only create this commit if the audit found a real defect; otherwise leave history unchanged.
