const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const domains = [
  // Email Marketing / Newsletter Trackers (Image 1 & 2)
  "sendinblue.com", "prox.sendinblue.com",
  "mailerlite.com", "assets.mailerlite.com", "click.mailerlite.com", "track.mailerlite.com",
  "convertkit.com", "app.convertkit.com", "open.convertkit.com",
  "list-manage.com", "mailchimp.com",
  "mailgun.net", "email.mailgun.net", "mailgun.com",
  "getresponse.com", "email.getresponse.com",
  "aweber.com", "clicks.aweber.com",
  "mandrillapp.com",
  "activecampaign.com", "open.activecampaign.com", "lt.activecampaign.com",

  // Video Players & Media Analytics (Image 3)
  "bcvp0rtal.com",
  "vimeocdn.com", "f.vimeocdn.com", "fresnel.vimeocdn.com", "vimeo.com",
  "jwplayer.com", "cdn.jwplayer.com",
  "bcovlive.io", "api.bcovlive.io", "brightcove.com", "players.brightcove.net",

  // A/B Testing, Feature Gates, Analytics (Image 4)
  "vwo.com", "dev.visualwebsiteoptimizer.com",
  "flagsmith.com", "edge.api.flagsmith.com",
  "statsigapi.net", "statsig.com",
  "featuregates.org",
  "configcat.com", "cdn.configcat.com", "cdn-eu.configcat.com",
  "kameleoon.io", "data.kameleoon.io", "static.kameleoon.com",

  // CMP / Cookie Consent Trackers (Image 5)
  "trustarc.com", "consent.trustarc.com", "gdpr.trustarc.com",
  "onetrust.com", "cdn.onetrust.com", "geolocation.onetrust.com", "privacyportal.onetrust.com",
  "onetrust.io", "cookies-data.onetrust.io",
  "sp-prod.net", "wrapper-api.sp-prod.net",
  "optanon.blob.core.windows.net",
  "privacy-center.org", "sdk.privacy-center.org",
  "cookiebot.com", "consent.cookiebot.com", "consentcdn.cookiebot.com",
  "cookielaw.org", "cdn.cookielaw.org",
  "usercentrics.eu", "app.usercentrics.eu",
  "osano.com", "cmp.osano.com"
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
