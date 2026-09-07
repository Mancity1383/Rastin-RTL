const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const extraRules = [
  // AdMob
  "||pagead2.googlesyndication.com^",
  "||tpc.googlesyndication.com^",
  "||admob.com^",
  "||media.admob.com^",
  "||e.admob.com^",
  "||googleads.g.doubleclick.net^",
  "||s0.2mdn.net^",
  
  // Facebook Pixel & SDK
  "*facebook.com/tr*",
  "*facebook.com/signals*",
  "*connect.facebook.net/en_US/fbevents.js*",
  "*connect.facebook.net/en_US/sdk.js*",
  "||connect.facebook.com^",
  "||www.facebook.com/plugins/*",
  "||www.facebook.com/v*/plugins/*"
];

const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
let lastId = rules[rules.length - 1].id;

const existingFilters = new Set(rules.map(r => r.condition.urlFilter));

let added = 0;
for (const filter of extraRules) {
  if (!existingFilters.has(filter)) {
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
    added++;
  }
}

fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
console.log(`Added ${added} rules for AdMob and Facebook tracking. Total rules: ${rules.length}`);
