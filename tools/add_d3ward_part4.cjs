const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const domains = [
  // Analytics (Image 1)
  "piwik.pro", "cdn.piwik.pro",
  "pendo.io", "cdn.pendo.io",

  // Error Monitoring (Image 2)
  "airbrake.io", "notifier.airbrake.io", "api.airbrake.io",

  // Cryptominers (Image 3)
  "afminer.com",

  // Tracking (Image 4 & 5)
  "app.link",
  "unagi-na.amazon.com", "unagi.amazon.com", "unagi-eu.amazon.com", "unagi-fe.amazon.com"
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
