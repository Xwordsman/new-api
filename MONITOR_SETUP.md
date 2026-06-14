# 监控页面翻译和配置

## 问题 1: 翻译缺失

### 自动添加翻译（推荐）

在 `web/default/` 目录下运行：

```bash
node add-translations.js
# 或
bun add-translations.js
```

### 手动添加翻译

如果自动脚本无法运行，手动在以下文件中添加翻译：

#### `web/default/src/i18n/locales/en.json`

在 `translation` 对象中添加：

```json
"Status Monitor": "Status Monitor",
"Service Status Monitor": "Service Status Monitor",
"Service status and uptime monitoring page.": "Service status and uptime monitoring page.",
"Require login to view status": "Require login to view status",
"Visitors must authenticate before accessing the status monitor page.": "Visitors must authenticate before accessing the status monitor page.",
"Some services are experiencing issues": "Some services are experiencing issues",
"Failed to load monitor data": "Failed to load monitor data",
"No monitoring data available yet": "No monitoring data available yet",
"Normal": "Normal",
"Failed": "Failed",
"Now": "Now"
```

#### `web/default/src/i18n/locales/zh.json`

在 `translation` 对象中添加：

```json
"Status Monitor": "状态监控",
"Service Status Monitor": "服务状态监控",
"Service status and uptime monitoring page.": "服务状态和运行时间监控页面。",
"Require login to view status": "需要登录才能查看状态",
"Visitors must authenticate before accessing the status monitor page.": "访问状态监控页面前需要进行身份验证。",
"Some services are experiencing issues": "部分服务出现故障",
"Failed to load monitor data": "加载监控数据失败",
"No monitoring data available yet": "暂无监控数据",
"Normal": "正常",
"Failed": "失败",
"Now": "现在"
```

## 问题 2: 顶部导航链接不显示

### 原因

数据库中的 `HeaderNavModules` 配置可能还是旧的，没有包含 `status` 字段。

### 解决方法

1. 登录后台
2. 进入：系统设置 > 站点维护 > 顶部导航
3. 找到 "Status Monitor" 开关
4. 打开开关
5. 点击"保存导航设置"按钮
6. 刷新页面

如果看不到 "Status Monitor" 开关，可能需要：

1. 清除浏览器缓存
2. 重启后端服务
3. 确认已部署最新版本

## 问题 3: 页面显示 "No monitoring data available yet"

### 原因

这是正常的！因为还没有运行自动检测。

### 解决方法

1. 进入：系统设置 > 运营设置 > 监控设置
2. 确认"启用自动渠道测试"已勾选
3. 检测间隔建议设置为 10 分钟
4. 等待一次自动检测运行（或手动点击"测试所有渠道"）
5. 刷新 `/status` 页面

### 手动触发测试

如果不想等待，可以：

1. 进入后台：渠道管理
2. 点击"测试所有渠道"按钮
3. 等待测试完成
4. 访问 `/status` 页面查看结果

## 验证步骤

1. **翻译是否生效**：刷新页面，切换语言，检查文字是否正确显示
2. **导航链接是否显示**：顶部导航栏应该出现"状态监控"或"Status Monitor"链接
3. **数据是否显示**：运行一次渠道测试后，页面应显示监控数据

## 排查工具

### 检查 API 返回

```bash
curl http://localhost:3000/api/status | jq .HeaderNavModules
```

应该看到类似：
```json
{
  "home": true,
  "console": true,
  "pricing": {"enabled": true, "requireAuth": false},
  "rank": {"enabled": true, "requireAuth": false},
  "rankings": {"enabled": true, "requireAuth": false},
  "status": {"enabled": true, "requireAuth": false},
  "docs": true,
  "about": true
}
```

### 检查监控数据

```bash
curl http://localhost:3000/api/monitor/status?hours=12
```

应该返回监控日志数据。
