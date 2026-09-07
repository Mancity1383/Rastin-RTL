const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const genericPrefixes = [
  "analytics.", "metrics.", "telemetry.", "track.", "tracking.", "pixel.",
  "ad.", "ads.", "adserver.", "log.", "logs.", "stats.", "consent.", "cmp.", 
  "vortex.", "device-metrics-", "events."
];

const genericSuffixes = [
  ".optimizely.com", ".dynamicyield.com", ".launchdarkly.com",
  ".hubspot.com", ".marketo.net", ".mailchimp.com", ".intercom.io",
  ".braze.com", ".onesignal.com", ".klaviyo.com", ".customer.io",
  ".impact.com", ".skimresources.com", ".viglink.com", ".refersion.com",
  ".appsflyer.com", ".adjust.com", ".kochava.com", ".singular.net"
];

const genericKeywords = [
  "/google-analytics/", "/gtm.js", "/analytics.js", "/tracking.js", 
  "/telemetry.js", "?action=track", "&action=track", "/pixel.gif"
];

const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
let lastId = rules[rules.length - 1].id;

const resourceTypes = ["script", "image", "xmlhttprequest", "ping", "sub_frame", "websocket"];

// 1. Prefix Rules
for (const prefix of genericPrefixes) {
  lastId++;
  rules.push({
    "id": lastId,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": `||${prefix}*`,
      "resourceTypes": resourceTypes
    }
  });
}

// 2. Suffix/Domain Rules (from the new screenshots to generalize them)
for (const suffix of genericSuffixes) {
  lastId++;
  rules.push({
    "id": lastId,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": `||*${suffix}^`,
      "resourceTypes": resourceTypes
    }
  });
}

// 3. Keyword/Path Rules
for (const keyword of genericKeywords) {
  lastId++;
  rules.push({
    "id": lastId,
    "priority": 1,
    "action": { "type": "block" },
    "condition": {
      "urlFilter": `*${keyword}*`,
      "resourceTypes": resourceTypes
    }
  });
}

fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
console.log(`Added generalized rules. Total rules: ${rules.length}`);
