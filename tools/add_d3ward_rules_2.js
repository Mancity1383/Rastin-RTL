const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const domains = [
  // Fingerprinting
  "fingerprintjs.com", "fpjs.io", "api.fpjs.io",
  "siftscience.com", "cdn.siftscience.com", "permutive.com", "cdn.permutive.com",
  "pippio.com", "id5-sync.com", "sync.mathtag.com", "pixel.mathtag.com", "tapad.com", "prod.uidapi.com",
  "idsync.rlcdn.com", "api.rlcdn.com",
  
  // Mobile Attribution
  "app.appsflyer.com", "appsflyer.com", "app.adjust.com", "adjust.com", "api2.branch.io", "bnc.lt", "kochava.com", "control.kochava.com", "singular.net", "sdk-api-v1.singular.net",
  "wzrkt.com", "clevertap-prod.com",
  
  // OEM Vendors - Apple
  "advertising.apple.com", "tr.iadsdk.apple.com", "iadsdk.apple.com", "metrics.icloud.com", "metrics.mzstatic.com", "api-adservices.apple.com", "books-analytics-events.apple.com", "weather-analytics-events.apple.com", "notes-analytics-events.apple.com", "xp.apple.com",
  
  // Huawei
  "metrics.data.hicloud.com", "metrics2.data.hicloud.com", "grs.hicloud.com", "logservice.hicloud.com", "logservice1.hicloud.com", "logbak.hicloud.com", "ads.huawei.com",
  
  // Xiaomi
  "api.ad.xiaomi.com", "data.mistat.xiaomi.com", "data.mistat.india.xiaomi.com", "data.mistat.rus.xiaomi.com", "sdkconfig.ad.xiaomi.com", "sdkconfig.ad.intl.xiaomi.com", "tracking.rus.miui.com", "tracking.miui.com",
  
  // Samsung
  "samsungads.com", "smetrics.samsung.com", "samsung-com.112.2o7.net", "analytics-api.samsunghealthcn.com", "config.samsungads.com",
  
  // Realme, Oppo, OnePlus
  "iot-eu-logser.realme.com", "iot-logser.realme.com", "bdapi-ads.realmemobile.com", "bdapi-in-ads.realmemobile.com",
  "adsfs.oppomobile.com", "adx.ads.oppomobile.com", "ck.ads.oppomobile.com", "data.ads.oppomobile.com",
  "open.oneplus.net",
  
  // LG, Microsoft, FireTV, SmartTV
  "us.info.lgsmartad.com", "ngfts.lge.com", "smartclip.net", "smartclip.com",
  "settings-win.data.microsoft.com", "vortex.data.microsoft.com", "vortex-win.data.microsoft.com", "watson.telemetry.microsoft.com", "browser.events.data.msn.com",
  "device-metrics-us.amazon.com", "device-metrics-us-2.amazon.com", "mads-eu.amazon.com",
  "ads.roku.com", "amoeba.web.roku.com",
  
  // CMP Vendors
  "cdn.cookielaw.org", "geolocation.onetrust.com", "privacyportal.onetrust.com", "consent.cookiebot.com", "consentcdn.cookiebot.com", "cookiebot.com", "consent.trustarc.com", "sdk.privacy-center.org", "cdn.privacy-mgmt.com", "app.usercentrics.eu", "cmp.osano.com", "fundingchoicesmessages.google.com"
];

const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
let lastId = rules[rules.length - 1].id;

for (const domain of domains) {
  const filter = `||${domain}^`;
  if (rules.some(r => r.condition.urlFilter === filter)) {
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
}

fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
console.log(`Added domains. Total rules: ${rules.length}`);
