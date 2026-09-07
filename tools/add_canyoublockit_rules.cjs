const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const domains = [
  // CanYouBlockIt & Ad Player / Pop-under / Ad Network Domains
  "fluidplayer.com", "cdn.fluidplayer.com",
  "popads.net", "popcash.net", "propellerads.com", "adcash.com",
  "hilltopads.net", "exoclick.com", "juicyads.com",
  "adsterra.com", "evadav.com", "monetag.com",
  "bidvertiser.com", "infolinks.com",
  "a-ads.com", "coinzilla.com", "clickadu.com", "clickaine.com",
  "adthrive.com", "mediavine.com", "ezoic.com",
  "ad-delivery.net", "engine.adzerk.net", "adzerk.net"
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
