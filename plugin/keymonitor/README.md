# 密钥自动监控插件

## 功能说明

自动监控指定渠道的健康状态，当检测到密钥失效时，自动从 Misskey/Sharkey 社区获取最新密钥并更新。

## 已创建的文件

### 后端核心模块

```
plugin/keymonitor/
├── config.go          # 配置管理（读取/保存/默认值）
├── monitor.go         # 主监控循环和健康检查
├── misskey.go         # Misskey API 客户端
├── extractor.go       # Key 提取器（明文+base64）
└── validator.go       # Key 验证器

controller/
└── plugin-keymonitor.go  # HTTP API 接口
```

## 需要手动修改的文件

### 1. router/api-router.go

在文件中找到 `apiRouter := router.Group("/api")` 后添加：

```go
// 密钥监控插件 API
apiRouter.GET("/plugin/key-monitor", controller.GetKeyMonitorConfig)
apiRouter.PUT("/plugin/key-monitor", controller.UpdateKeyMonitorConfig)
```

### 2. main.go

在 `import` 区域添加：

```go
import (
    // ... 现有 import
    "one-api/plugin/keymonitor"
)
```

在 `main()` 函数中，找到服务启动的地方（通常在 `common.Setup()` 之后），添加：

```go
// 启动密钥监控服务
keymonitor.Start()
```

## 前端配置页面（简化实现）

### 方式 A：通过 API 工具测试（最快）

使用 Postman 或 curl 测试：

```bash
# 获取当前配置
curl http://localhost:3000/api/plugin/key-monitor

# 更新配置
curl -X PUT http://localhost:3000/api/plugin/key-monitor \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "check_interval": 5,
    "target_channel_id": 1,
    "community_url": "https://dc.hhhl.cc",
    "target_username": "ls",
    "fetch_note_limit": 5,
    "validation_timeout": 10,
    "expired_keywords": [
      "公益服务器压力很大",
      "休息十分钟换key开放",
      "Remember to join the new community",
      "The key will be changed"
    ]
  }'
```

### 方式 B：添加前端配置页面（需要前端开发）

创建以下文件：

1. `web/default/src/features/system-settings/plugins/key-monitor/index.tsx` - 配置页面
2. `web/default/src/features/system-settings/plugins/key-monitor/api.ts` - API 调用
3. `web/default/src/features/system-settings/plugins/key-monitor/types.ts` - 类型定义

然后在系统设置路由中注册插件页面。

## 配置说明

| 参数 | 说明 | 默认值 | 范围 |
|------|------|--------|------|
| `enabled` | 是否启用 | `false` | - |
| `check_interval` | 检查间隔（分钟） | `5` | 1-60 |
| `target_channel_id` | 目标渠道 ID | `1` | ≥1 |
| `community_url` | 社区地址 | `https://dc.hhhl.cc` | - |
| `target_username` | 目标用户名 | `ls` | - |
| `fetch_note_limit` | 获取笔记数量 | `5` | 1-20 |
| `validation_timeout` | 验证超时（秒） | `10` | 5-60 |
| `expired_keywords` | 失效关键词列表 | 见下方 | - |

默认失效关键词：
- `"公益服务器压力很大"`
- `"休息十分钟换key开放"`
- `"Remember to join the new community"`
- `"The key will be changed"`

## 工作流程

1. 每隔 `check_interval` 分钟检查一次渠道健康状态
2. 发送测试请求到目标渠道
3. 如果响应包含失效关键词，判定为不健康
4. 调用 Misskey API 获取 `@ls` 用户的最新 `fetch_note_limit` 条笔记
5. 从第一条笔记开始遍历，提取 key（支持明文和 base64）
6. 验证提取的 key 是否可用
7. 找到可用 key 后自动更新渠道密钥
8. 所有操作都会记录到系统日志

## 日志查看

插件运行时会输出详细日志，关键日志包括：

```
[KeyMonitor] Service started
[KeyMonitor] Started with interval: 5 minutes
[KeyMonitor] Checking channel #1 health...
[KeyMonitor] Channel #1 is healthy
[KeyMonitor] Channel #1 is down, fetching new key...
[KeyMonitor] Fetched 5 notes from @ls
[KeyMonitor] Checking note #1 (ID: xxx, created: 2026-06-12 17:01:37)
[KeyMonitor] Found 1 candidate key(s) in note #1
[KeyMonitor] Validating candidate key #1: sk-zemD***x1vR...
[KeyMonitor] ✓ Key #1 from note #1 is valid!
[KeyMonitor] ✓ Successfully updated channel #1 with key from note xxx
```

## 完全删除插件指南

### 1. 删除后端文件

```bash
# 删除插件核心模块
rm -rf plugin/keymonitor/

# 删除 controller
rm controller/plugin-keymonitor.go
```

### 2. 删除前端文件（如果已创建）

```bash
rm -rf web/default/src/features/system-settings/plugins/key-monitor/
```

### 3. 还原修改的文件

#### router/api-router.go

删除以下行：

```go
apiRouter.GET("/plugin/key-monitor", controller.GetKeyMonitorConfig)
apiRouter.PUT("/plugin/key-monitor", controller.UpdateKeyMonitorConfig)
```

#### main.go

删除以下 import：

```go
"one-api/plugin/keymonitor"
```

删除以下调用：

```go
keymonitor.Start()
```

### 4. 清理数据库配置（可选）

如果想清除保存的配置：

```sql
DELETE FROM options WHERE key = 'plugin.key_monitor.config';
```

或通过管理后台删除该配置项。

## 故障排查

### 问题：插件启动但不工作

1. 检查配置是否启用：`enabled: true`
2. 检查目标渠道 ID 是否正确
3. 查看系统日志中的错误信息

### 问题：无法获取社区笔记

1. 检查社区 URL 是否正确
2. 检查目标用户名是否正确
3. 确认网络可以访问社区

### 问题：提取到 key 但验证失败

1. 检查失效关键词配置是否正确
2. 增加 `validation_timeout` 值
3. 查看日志中的响应内容预览

## 开发者注意事项

- 插件使用 `common.SysLog()` 输出日志
- 配置存储在 `options` 表的 `plugin.key_monitor.config` 键
- 监控服务在独立 goroutine 中运行
- Key 提取支持递归 base64 解码
- 所有 HTTP 请求都有超时保护
