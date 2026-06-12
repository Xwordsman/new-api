# 密钥自动监控插件 - 快速安装指南

## 📦 已创建的文件清单

### ✅ 后端核心文件（已完成，无需修改）

```
plugin/keymonitor/
├── README.md          ← 详细文档
├── config.go          ← 配置管理
├── monitor.go         ← 监控主逻辑
├── misskey.go         ← Misskey API
├── extractor.go       ← Key 提取器
└── validator.go       ← Key 验证器

controller/
└── plugin-keymonitor.go  ← HTTP API
```

---

## ⚙️ 需要手动修改的文件（3 处）

### 1️⃣ router/api-router.go

找到这一行：
```go
apiRouter := router.Group("/api")
```

在它**下面**添加：
```go
// 密钥监控插件
apiRouter.GET("/plugin/key-monitor", controller.GetKeyMonitorConfig)
apiRouter.PUT("/plugin/key-monitor", controller.UpdateKeyMonitorConfig)
```

---

### 2️⃣ main.go

**第一处**：在 import 区域添加：
```go
import (
    // ... 其他 import
    "one-api/plugin/keymonitor"
)
```

**第二处**：在 `common.Setup()` 调用之后添加：
```go
// 启动密钥监控
keymonitor.Start()
```

---

## 🚀 启动和配置

### 方式 1：通过 API 配置（推荐）

重启服务后，使用以下命令配置：

```bash
# 启用插件
curl -X PUT http://localhost:3000/api/plugin/key-monitor \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
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

### 方式 2：直接在数据库配置

在 `options` 表插入：

```sql
INSERT INTO options (`key`, `value`) VALUES 
('plugin.key_monitor.config', '{"enabled":true,"check_interval":5,"target_channel_id":1,"community_url":"https://dc.hhhl.cc","target_username":"ls","fetch_note_limit":5,"validation_timeout":10,"expired_keywords":["公益服务器压力很大","休息十分钟换key开放","Remember to join the new community","The key will be changed"]}');
```

---

## 📊 查看日志

插件运行后会输出日志：

```
[KeyMonitor] Service started
[KeyMonitor] Started with interval: 5 minutes
[KeyMonitor] Checking channel #1 health...
[KeyMonitor] Channel #1 is down, fetching new key...
[KeyMonitor] Found 1 candidate key(s) in note #1
[KeyMonitor] ✓ Successfully updated channel #1 with key from note xxx
```

---

## 🗑️ 完全删除插件

### 1. 删除文件

```bash
rm -rf plugin/keymonitor/
rm controller/plugin-keymonitor.go
```

### 2. 还原代码修改

**router/api-router.go** - 删除 2 行：
```go
apiRouter.GET("/plugin/key-monitor", controller.GetKeyMonitorConfig)
apiRouter.PUT("/plugin/key-monitor", controller.UpdateKeyMonitorConfig)
```

**main.go** - 删除 2 行：
```go
"one-api/plugin/keymonitor"  // import 区域
keymonitor.Start()           // main 函数
```

### 3. 清理数据库（可选）

```sql
DELETE FROM options WHERE key = 'plugin.key_monitor.config';
```

---

## ✅ 快速验证

启动服务后，执行：

```bash
# 查看当前配置
curl http://localhost:3000/api/plugin/key-monitor
```

如果返回配置 JSON，说明插件已正常安装。

---

## 🔧 配置参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `enabled` | 是否启用 | `false` |
| `check_interval` | 检查间隔（分钟） | `5` |
| `target_channel_id` | 监控的渠道 ID | `1` |
| `community_url` | 社区地址 | `https://dc.hhhl.cc` |
| `target_username` | 目标用户 | `ls` |
| `fetch_note_limit` | 获取笔记数 | `5` |
| `validation_timeout` | 验证超时（秒） | `10` |
| `expired_keywords` | 失效关键词 | 4 个关键词 |

---

## 💡 工作原理

```
每 5 分钟
  ↓
检查渠道 #1 是否返回失效广告？
  ↓ 是
获取 @ls 最新 5 条笔记
  ↓
从第 1 条开始提取 key（支持 base64）
  ↓
验证 key 是否可用
  ↓
自动更新渠道密钥 ✓
```

---

完整文档请查看：`plugin/keymonitor/README.md`
