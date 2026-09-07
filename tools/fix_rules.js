const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '../ruleset_adblock.json');

const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

for (let r of rules) {
  if (r.condition && r.condition.urlFilter) {
    // Fix ||*.domain.com^ -> ||domain.com^
    if (r.condition.urlFilter.startsWith('||*.')) {
      r.condition.urlFilter = '||' + r.condition.urlFilter.substring(4);
    }
    // Fix ||*domain.com^ -> ||domain.com^
    else if (r.condition.urlFilter.startsWith('||*')) {
      r.condition.urlFilter = '||' + r.condition.urlFilter.substring(3);
    }
  }
}

fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
console.log('Fixed urlFilters in ruleset. Total rules:', rules.length);
