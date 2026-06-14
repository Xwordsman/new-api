const fs = require('fs');
const path = require('path');

// Translations to add
const translations = {
  en: {
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
    "Now": "Now",
  },
  zh: {
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
    "Now": "现在",
  }
};

// Process each language
['en', 'zh'].forEach(lang => {
  const filePath = path.join(__dirname, 'src', 'i18n', 'locales', `${lang}.json`);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Add new translations
  Object.entries(translations[lang]).forEach(([key, value]) => {
    if (!content.translation[key]) {
      content.translation[key] = value;
    }
  });

  // Write back (pretty print)
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
  console.log(`Updated ${lang}.json`);
});

console.log('Translation files updated successfully!');
