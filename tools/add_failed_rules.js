const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const domains = [
  // Reddit (Image 1)
  "conversions-config.reddit.com",
  "error-tracking.reddit.com",
  "pixel-config.reddit.com",
  "w3-reporting-nel.reddit.com",
  "w3-reporting.reddit.com",

  // TikTok / ByteDance (Image 2)
  "mon.us.tiktokv.com",
  "mssdk-sg.byteoversea.com",
  "mssdk-va.byteoversea.com",
  "p16-ad.byteoversea.com",
  "rtc-logger-va.tiktokv.com",
  "rtlog.byteoversea.com",
  "rtlog.tiktokv.com",
  "sf16-telemetry-proxy-oci.tiktokcdn-us.com",
  "sgali-mcs.byteoversea.com",
  "ug-sg.byteoversea.com",
  "v16-ad.byteoversea.com",
  "xlog-va.tiktokv.com",

  // Yahoo (Image 3 & 4)
  "clb.yahoo.co.jp",
  "cookiex.ngd.yahoo.com",
  "dsb.yahoo.co.jp",
  "jill.fc.yahoo.com",
  "noa.yahoo.com",
  "webc2s.pubgw.yahoo.com",
  "yads.yjtag.yahoo.co.jp",
  "ybx.yahoo.co.jp",

  // Yandex (Image 5)
  "awaps.yandex.net",
  "awaps.yandex.ru",
  "awsync.yandex.ru",
  "browser-updater.yandex.net",
  "csp.yandex.net",
  "easy-monetization.s3.yandex.net",

  // Missing from official d3host.txt
  "events.hotjar.io",
  "log.byteoversea.com",
  "extmaps-api.yandex.net",
  "offerwall.yandex.net",
  "click.oneplus.cn"
];

console.log(`Loading ruleset from: ${rulesPath}`);
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
let lastId = rules[rules.length - 1].id;

let addedCount = 0;
for (const domain of domains) {
  const filter = `||${domain}^`;
  if (rules.some(r => r.condition && r.condition.urlFilter === filter)) {
    console.log(`Skipping (already exists): ${filter}`);
    continue;
  }
  
  lastId++;
  rules.push({
    "id": lastId,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": filter,
      "resourceTypes": ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
    }
  });
  addedCount++;
}

fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
console.log(`Reorganization complete! Added ${addedCount} new blocking rules. Total rules: ${rules.length}`);
