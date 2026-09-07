const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const domains = [
  // Social Widgets / Trackers (Image 1 & 2)
  "platform.instagram.com", "badges.instagram.com",
  "sharethis.com", "ws.sharethis.com",
  "plus.google.com",
  "st-widget.s3.amazonaws.com",
  "staticxx.facebook.com", "connect.facebook.net", "pixel.facebook.com",
  "platform.twitter.com", "syndication.twitter.com", "t.co", "static.ads-twitter.com",
  "platform.linkedin.com", "snap.licdn.com",
  "addthis.com", "s7.addthis.com",

  // Cryptomining (Image 3)
  "cpu.js.org", "fastpool.xyz", "hashforcash.us", "coin-hive.com", "coinhive.com", "authedmine.com", "minr.pw", "crypto-webminer.com",

  // Error Reporting / Logging (Image 4)
  "trackjs.com", "capture.trackjs.com", "usage.trackjs.com",
  "honeybadger.io", "api.honeybadger.io", "js.honeybadger.io",
  "bugsnag.com", "app.bugsnag.com",
  "rollbar.com", "api.rollbar.com",
  "sentry.io", "browser.sentry-cdn.com",
  "newrelic.com", "bam.nr-data.net", "js-agent.newrelic.com",

  // OEM / System Telemetry & Ads
  "advertising.apple.com", "tr.iadsdk.apple.com", "iadsdk.apple.com", "metrics.icloud.com", "metrics.mzstatic.com", "api-adservices.apple.com", "books-analytics-events.apple.com", "weather-analytics-events.apple.com", "notes-analytics-events.apple.com", "xp.apple.com",
  "metrics.data.hicloud.com", "metrics2.data.hicloud.com", "grs.hicloud.com", "logservice.hicloud.com", "logservice1.hicloud.com", "logbak.hicloud.com", "ads.huawei.com",
  "api.ad.xiaomi.com", "data.mistat.xiaomi.com", "data.mistat.india.xiaomi.com", "data.mistat.rus.xiaomi.com", "sdkconfig.ad.xiaomi.com", "sdkconfig.ad.intl.xiaomi.com", "tracking.rus.miui.com", "tracking.miui.com",
  "samsungads.com", "smetrics.samsung.com", "samsung-com.112.2o7.net", "analytics-api.samsunghealthcn.com", "config.samsungads.com",
  "iot-eu-logser.realme.com", "iot-logser.realme.com", "bdapi-ads.realmemobile.com", "bdapi-in-ads.realmemobile.com",
  "adsfs.oppomobile.com", "adx.ads.oppomobile.com", "ck.ads.oppomobile.com", "data.ads.oppomobile.com",
  "open.oneplus.net",
  "us.info.lgsmartad.com", "ngfts.lge.com", "smartclip.net", "smartclip.com",
  "settings-win.data.microsoft.com", "vortex.data.microsoft.com", "vortex-win.data.microsoft.com", "watson.telemetry.microsoft.com", "browser.events.data.msn.com",
  "device-metrics-us.amazon.com", "device-metrics-us-2.amazon.com", "mads-eu.amazon.com",
  "ads.roku.com", "amoeba.web.roku.com"
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
