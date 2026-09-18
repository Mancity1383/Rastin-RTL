// Inspired by uBlock Origin Lite's MV3 architecture



const RULESET_ID = 'ruleset_adblock';
const CACHE_KEY = 'adblocker_filter_cache';
const CACHE_TIMESTAMP_KEY = 'adblocker_filter_cache_ts';
const CACHE_TTL = 6 * 60 * 60 * 1000; // quick-fix lists change frequently
const SESSION_BLOCK_RULE_LIMIT = 5000;
const ACTIVATION_RULE_IDS = [5001, 5002, 5003];
const YOUTUBE_DOMAINS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be'];
const FILTER_REFRESH_ALARM = 'rastin-filter-refresh';
const FILTER_COMPILER_VERSION = 2;
const DEFAULT_BLOCK_RESOURCE_TYPES = [
  'script', 'image', 'stylesheet', 'font', 'xmlhttprequest', 'sub_frame',
  'ping', 'websocket', 'object', 'other'
];
const RESOURCE_OPTION_MAP = Object.freeze({
  script: 'script', image: 'image', stylesheet: 'stylesheet', font: 'font',
  media: 'media', xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest',
  subdocument: 'sub_frame', frame: 'sub_frame', document: 'main_frame',
  ping: 'ping', websocket: 'websocket', object: 'object', other: 'other'
});

// Filter list sources (same as uBlock Origin Lite)
const FILTER_LISTS = [
  'https://raw.githubusercontent.com/MasterKia/PersianBlocker/main/PersianBlocker.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.min.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.min.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/thirdparties/easylist.txt',
];

// Function to update the declarativeNetRequest ruleset state
function updateRuleset(enabled) {
  if (chrome.declarativeNetRequest) {
    chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? [RULESET_ID] : [],
      disableRulesetIds: enabled ? [] : [RULESET_ID]
    }).then(() => {
      console.log(`[Rastin RTL] Ad Blocker ruleset ${enabled ? 'enabled' : 'disabled'}.`);
    }).catch(err => {
      console.warn('[Rastin RTL] Ruleset update error:', err);
    });
  }
}

// Parse filter text and extract network rules + cosmetic rules
// Parse filter text and extract network rules + cosmetic rules
function parseFilters(text) {
  const networkDomains = new Set();
  const networkRules = [];
  const cosmeticGeneric = [];
  const cosmeticSpecific = {};

  const lines = text.split(/\r?\n/);
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;

    // Safe MV3 subset of EasyList network syntax. Unlike the old parser this
    // preserves path filters, resource types, first/third-party scope, domain
    // scope and exception rules instead of reducing everything to a hostname.
    const networkRule = parseNetworkFilter(line);
    if (networkRule) {
      networkRules.push(networkRule);
      if (networkRule.simpleDomain && networkRule.action === 'block') {
        networkDomains.add(networkRule.simpleDomain);
      }
      continue;
    }

    // Cosmetic rules: domain##selector or ##selector
    if (line.includes('##') && !line.includes('#@#') && !line.includes('!')) {
      const hashIdx = line.indexOf('##');
      const domainsPart = line.slice(0, hashIdx).trim();
      const selector = line.slice(hashIdx + 2).trim();

      // Skip invalid or JS injection rules
      if (!selector || selector.startsWith('script') || selector.includes('{')) continue;
      
      if (domainsPart === '') {
        // Generic cosmetic rule - apply to all sites
        cosmeticGeneric.push(selector);
      } else {
        // Specific cosmetic rules per domain
        const domains = domainsPart.split(',');
        for (let d of domains) {
          d = d.trim().toLowerCase();
          if (!d || d.startsWith('~')) continue;
          if (!cosmeticSpecific[d]) cosmeticSpecific[d] = [];
          cosmeticSpecific[d].push(selector);
        }
      }
    }
  }

  return { networkDomains, networkRules, cosmeticGeneric, cosmeticSpecific };
}

function parseNetworkFilter(line) {
  const isException = line.startsWith('@@');
  const raw = isException ? line.slice(2) : line;
  if (!raw.startsWith('||') || raw.includes('##') || raw.length > 1000) return null;

  const dollarIndex = raw.indexOf('$');
  const pattern = (dollarIndex === -1 ? raw : raw.slice(0, dollarIndex)).trim();
  const optionText = dollarIndex === -1 ? '' : raw.slice(dollarIndex + 1);
  const hostMatch = pattern.match(/^\|\|([^/^*|]+)(\^|\/|$)/);
  if (!hostMatch || !hostMatch[1].includes('.')) return null;

  const host = hostMatch[1].toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return null;

  const options = optionText.split(',').map(value => value.trim()).filter(Boolean);
  const unsupported = options.some(option =>
    /^(?:redirect|redirect-rule|removeparam|csp|replace|urlskip|header|permissions|rewrite)=?/i.test(option)
  );
  if (unsupported || options.includes('badfilter')) return null;

  const includedTypes = [];
  const excludedTypes = [];
  const initiatorDomains = [];
  const excludedInitiatorDomains = [];
  let domainType;
  let priority = isException ? 10 : 1;
  let caseSensitive = false;

  for (const option of options) {
    const negated = option.startsWith('~');
    const normalized = negated ? option.slice(1) : option;
    const resourceType = RESOURCE_OPTION_MAP[normalized];
    if (resourceType) {
      (negated ? excludedTypes : includedTypes).push(resourceType);
      continue;
    }
    if (normalized === 'third-party' || normalized === '3p') {
      domainType = negated ? 'firstParty' : 'thirdParty';
    } else if (normalized === 'first-party' || normalized === '1p') {
      domainType = negated ? 'thirdParty' : 'firstParty';
    } else if (normalized === 'match-case') {
      caseSensitive = !negated;
    } else if (normalized === 'important') {
      priority = isException ? 20 : 5;
    } else if (normalized.startsWith('domain=')) {
      for (const domainEntry of normalized.slice(7).split('|')) {
        const excluded = domainEntry.startsWith('~');
        const domain = (excluded ? domainEntry.slice(1) : domainEntry).toLowerCase();
        if (/^[a-z0-9.-]+$/.test(domain)) {
          (excluded ? excludedInitiatorDomains : initiatorDomains).push(domain);
        }
      }
    }
  }

  const condition = { urlFilter: pattern };
  condition.resourceTypes = includedTypes.length
    ? [...new Set(includedTypes)]
    : DEFAULT_BLOCK_RESOURCE_TYPES;
  if (excludedTypes.length) condition.excludedResourceTypes = [...new Set(excludedTypes)];
  if (initiatorDomains.length) condition.initiatorDomains = [...new Set(initiatorDomains)];
  if (excludedInitiatorDomains.length) {
    condition.excludedInitiatorDomains = [...new Set(excludedInitiatorDomains)];
  }
  if (domainType) condition.domainType = domainType;
  if (caseSensitive) condition.isUrlFilterCaseSensitive = true;

  return {
    action: isException ? 'allow' : 'block',
    priority,
    condition,
    simpleDomain: pattern === `||${host}^` && options.length === 0 ? host : null
  };
}

const HIGH_PRIORITY_KEYWORDS = [
  'yektanet', 'sabavision', 'tapsell', 'mediaad', 'najva', 'pushe', 'onetag', 'deyakco', 'kaprila', 'sanjagh', 'sorenad', 'popupdl', 'adtrace', 'adtodate', 'ibcup',
  'doubleclick', 'googleads', 'googlesyndication', 'youtube', 'aparat', 'saba-e', 'telewebion', 'filimo', 'namava', 'filmnet', 'arvancloud',
  'mailerlite', 'convertkit', 'mailgun', 'aweber', 'mandrillapp', 'vimeocdn', 'jwplayer', 'bcovlive', 'vwo', 'flagsmith', 'statsig', 'featuregates', 'configcat', 'kameleoon', 'onetrust', 'sp-prod', 'trustarc', 'optanon',
  'instagram', 'sharethis', 'facebook', 'twitter', 'linkedin', 'trackjs', 'honeybadger', 'fastpool', 'hashforcash', 'cpu.js',
  'piwik', 'pendo', 'airbrake', 'afminer', 'app.link', 'unagi'
];

function buildSessionBlockRules(domains) {
  return domains.slice(0, SESSION_BLOCK_RULE_LIMIT).map((domain, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'websocket', 'other']
    }
  }));
}

function buildSessionRules(compiledRules, fallbackDomains = []) {
  if (!Array.isArray(compiledRules) || compiledRules.length === 0) {
    return buildSessionBlockRules(fallbackDomains);
  }

  return compiledRules.slice(0, SESSION_BLOCK_RULE_LIMIT).map((rule, index) => ({
    id: index + 1,
    priority: rule.priority || (rule.action === 'allow' ? 10 : 1),
    action: { type: rule.action === 'allow' ? 'allow' : 'block' },
    condition: rule.condition
  }));
}

async function replaceSessionBlockRules(rules) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: Array.from({ length: SESSION_BLOCK_RULE_LIMIT }, (_, i) => i + 1),
    addRules: rules
  });
}

// Fetch and compile filter lists, store in chrome.storage
async function compileAndStoreFilters() {
  console.log('[Rastin RTL] Downloading and compiling filter lists...');
  
  let allNetworkDomains = new Set();
  const allNetworkRules = new Map();
  let persianBlockerDomains = new Set();
  const persianBlockerRuleKeys = new Set();
  let allCosmeticGeneric = [];
  let allCosmeticSpecific = {};

  for (const url of FILTER_LISTS) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) { console.warn(`[Rastin RTL] Failed to fetch: ${url}`); continue; }
      const text = await resp.text();
      const { networkDomains, networkRules, cosmeticGeneric, cosmeticSpecific } = parseFilters(text);

      for (const d of networkDomains) {
        allNetworkDomains.add(d);
        if (url.toLowerCase().includes('persianblocker')) {
          persianBlockerDomains.add(d);
        }
      }
      for (const rule of networkRules) {
        const key = JSON.stringify([rule.action, rule.priority, rule.condition]);
        if (!allNetworkRules.has(key)) allNetworkRules.set(key, rule);
        if (url.toLowerCase().includes('persianblocker')) persianBlockerRuleKeys.add(key);
      }
      allCosmeticGeneric.push(...cosmeticGeneric);

      for (const [domain, selectors] of Object.entries(cosmeticSpecific)) {
        if (!allCosmeticSpecific[domain]) allCosmeticSpecific[domain] = [];
        allCosmeticSpecific[domain].push(...selectors);
      }

      console.log(`[Rastin RTL] Fetched ${url}: ${networkRules.length} network rules, ${cosmeticGeneric.length} generic cosmetic rules`);
    } catch (err) {
      console.warn(`[Rastin RTL] Error fetching ${url}:`, err);
    }
  }

  // Cap generic cosmetics to 3000 most-used rules to keep storage reasonable
  const cappedGeneric = [...new Set(allCosmeticGeneric)].slice(0, 3000);

  // Prioritize domains: PersianBlocker first + HIGH_PRIORITY_KEYWORDS
  const highPriorityList = [];
  const normalPriorityList = [];
  
  for (const domain of allNetworkDomains) {
    const isPersian = persianBlockerDomains.has(domain);
    const hasKeyword = HIGH_PRIORITY_KEYWORDS.some(keyword => domain.includes(keyword));
    
    if (isPersian || hasKeyword) {
      highPriorityList.push(domain);
    } else {
      normalPriorityList.push(domain);
    }
  }
  
  const prioritizedDomains = [...highPriorityList, ...normalPriorityList];

  const highPriorityRules = [];
  const normalPriorityRules = [];
  for (const [key, rule] of allNetworkRules) {
    const serialized = JSON.stringify(rule.condition).toLowerCase();
    const isHighPriority = persianBlockerRuleKeys.has(key) ||
      HIGH_PRIORITY_KEYWORDS.some(keyword => serialized.includes(keyword));
    (isHighPriority ? highPriorityRules : normalPriorityRules).push(rule);
  }
  // Exceptions must be retained before block rules when the MV3 quota is full.
  const prioritizedNetworkRules = [...highPriorityRules, ...normalPriorityRules]
    .sort((a, b) => (b.action === 'allow') - (a.action === 'allow'));

  // Build dynamic DNR rules. IDs 5001+ are reserved for activation rules.
  const cachedNetworkDomains = prioritizedDomains.slice(0, SESSION_BLOCK_RULE_LIMIT);
  const cachedNetworkRules = prioritizedNetworkRules.slice(0, SESSION_BLOCK_RULE_LIMIT);
  const dnrRules = buildSessionRules(cachedNetworkRules, cachedNetworkDomains);

  // Store cosmetic rules in storage (for content script to read)
  const cosmeticData = {
    generic: cappedGeneric,
    specific: allCosmeticSpecific,
    networkDomains: cachedNetworkDomains,
    networkRules: cachedNetworkRules,
    compilerVersion: FILTER_COMPILER_VERSION,
    compiledAt: Date.now()
  };

  // Apply dynamic DNR rules (session rules don't need manifest declaration)
  try {
    await replaceSessionBlockRules(dnrRules);
    console.log(`[Rastin RTL] Applied ${dnrRules.length} dynamic network blocking rules.`);
  } catch (err) {
    console.warn('[Rastin RTL] Session rules error:', err);
  }

  // Store cosmetic rules for content script
  await chrome.storage.local.set({
    [CACHE_KEY]: cosmeticData,
    [CACHE_TIMESTAMP_KEY]: Date.now()
  });

  console.log(`[Rastin RTL] Filters compiled: ${dnrRules.length} network rules, ${cappedGeneric.length} cosmetic rules`);
  
  // Notify all tabs to refresh cosmetic filters
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
      chrome.tabs.sendMessage(tab.id, { action: 'refreshCosmeticFilters' }).catch(() => {});
    }
  }
}

// Check if cached filters are fresh
async function loadOrRefreshFilters() {
  const items = await chrome.storage.local.get([CACHE_TIMESTAMP_KEY, CACHE_KEY]);
  const ts = items[CACHE_TIMESTAMP_KEY] || 0;
  const now = Date.now();
  const cacheUsesCurrentCompiler = items[CACHE_KEY]?.compilerVersion === FILTER_COMPILER_VERSION;

  if ((now - ts) > CACHE_TTL || !cacheUsesCurrentCompiler) {
    console.log('[Rastin RTL] Filter cache expired or missing. Fetching fresh filters...');
    await compileAndStoreFilters();
  } else {
    console.log('[Rastin RTL] Filter cache is fresh, restoring session rules from storage...');
    // Re-apply session rules from stored data on browser restart
    await restoreSessionRulesFromCache();
  }
}

async function restoreSessionRulesFromCache() {
  const items = await chrome.storage.local.get([CACHE_KEY]);
  const data = items[CACHE_KEY];
  if (!data || !Array.isArray(data.networkDomains)) {
    await compileAndStoreFilters();
    return;
  }

  try {
    const rules = buildSessionRules(data.networkRules, data.networkDomains);
    await replaceSessionBlockRules(rules);
    console.log(`[Rastin RTL] Restored ${rules.length} session rules from cache.`);
  } catch (err) {
    console.warn('[Rastin RTL] Session rule restore error:', err);
  }
}

// Sync the static ruleset toggle
function syncAdBlockerState(enabled) {
  updateRuleset(enabled === true);
}

// Sync the site activation state for dynamic DNR rules
async function syncSiteActivationRules() {
  const items = await chrome.storage.local.get({
    enabled: true,
    adBlockEnabled: true,
    disabledAdBlockDomains: []
  });
  const rules = [];
  const allResourceTypes = [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
    'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'
  ];
  const globallyDisabled = items.enabled === false || items.adBlockEnabled === false;
  const disabledDomains = [...new Set((items.disabledAdBlockDomains || [])
    .map(domain => String(domain).toLowerCase().replace(/^www\./, ''))
    .filter(Boolean))];

  if (globallyDisabled) {
    rules.push({
      id: 5001,
      priority: 1000,
      action: { type: 'allowAllRequests' },
      condition: { resourceTypes: ['main_frame', 'sub_frame'] }
    }, {
      id: 5002,
      priority: 1000,
      action: { type: 'allow' },
      condition: { resourceTypes: allResourceTypes }
    });
  } else {
    // Blocking YouTube/Google Video requests can make the player retry the same
    // ad indefinitely. Keep network filtering out of YouTube frames and let the
    // dedicated adapter handle only the official skip control.
    rules.push({
      id: 5003,
      priority: 2000,
      action: { type: 'allow' },
      condition: {
        initiatorDomains: YOUTUBE_DOMAINS,
        resourceTypes: allResourceTypes
      }
    });

    if (disabledDomains.length > 0) rules.push({
      id: 5001,
      priority: 1000,
      action: { type: 'allowAllRequests' },
      condition: {
        requestDomains: disabledDomains,
        resourceTypes: ['main_frame', 'sub_frame']
      }
    }, {
      id: 5002,
      priority: 1000,
      action: { type: 'allow' },
      condition: {
        initiatorDomains: disabledDomains,
        resourceTypes: allResourceTypes
      }
    });
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ACTIVATION_RULE_IDS,
      addRules: rules
    });
    console.log('[Rastin RTL] Site activation DNR rule synced.');
  } catch (err) {
    console.warn('[Rastin RTL] Site activation rule error:', err);
  }
}

// One coordinator for every tab/frame. Content-script queues cannot protect a
// read-modify-write against another tab (or a tab closing before its read ends).
let highlightWrites = Promise.resolve();
function highlightIdentity(item) {
  return item.id ? `id:${item.id}` : `legacy:${JSON.stringify([
    item.timestamp, item.text, item.url, item.startPath, item.startNodeIndex,
    item.startOffset, item.endPath, item.endNodeIndex, item.endOffset
  ])}`;
}
async function assignLegacyHighlightIds(items) {
  return Promise.all(items.map(async item => {
    if (item.id) return item;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(highlightIdentity(item)));
    const suffix = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { ...item, id: `hl_legacy_${suffix}` };
  }));
}
async function mutateHighlights(message) {
  const { key, operation } = message;
  if (!operation || !/^rtl_fixer_hl_[^/]+$/.test(key || '')) throw new Error('Invalid highlight request');
  if (operation.type === 'clearAll') {
    const all = await chrome.storage.local.get(null);
    await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('rtl_fixer_hl_')));
    return [];
  }
  const oldKey = key.replace('rtl_fixer_hl_', 'rtl_fixer_hl_www.');
  const stored = await chrome.storage.local.get([key, oldKey]);
  for (const name of [key, oldKey]) {
    if (stored[name] !== undefined && !Array.isArray(stored[name])) throw new Error('Invalid highlight data; original preserved');
  }
  const before = JSON.stringify(stored[key] || []);
  let items = await assignLegacyHighlightIds(stored[key] || []);
  const identities = new Set(items.map(highlightIdentity));
  for (const item of await assignLegacyHighlightIds(stored[oldKey] || [])) {
    if (!identities.has(highlightIdentity(item))) {
      items.push(item);
      identities.add(highlightIdentity(item));
    }
  }
  switch (operation.type) {
    case 'migrate': break;
    case 'add':
      if (!operation.item?.id) throw new Error('Missing highlight ID');
      if (!items.some(h => h.id === operation.item.id)) items.push(operation.item);
      break;
    case 'remove': items = items.filter(h => h.id !== operation.id); break;
    case 'patch':
      items = items.map(h => h.id !== operation.id ? h : {
        ...h, ...operation.fields,
        ...(operation.note ? { note: { ...h.note, ...operation.note } } : {})
      });
      break;
    case 'repair': {
      const repairs = new Map(operation.repairs);
      items = items.map(h => ({ ...h, ...(repairs.get(highlightIdentity(h)) || {}) }));
      break;
    }
    case 'deletePage':
      items = items.filter(h => {
        if (h.pageKey) return h.pageKey !== operation.pageKey;
        if (!h.url) return false;
        const u = new URL(h.url);
        const hash = /^#!?\//.test(u.hash) ? u.hash.replace(/\/+$/, '') : '';
        return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}${hash}` !== operation.pageKey;
      });
      break;
    default: throw new Error('Unknown highlight operation');
  }
  if (JSON.stringify(items) !== before || stored[oldKey]?.length) await chrome.storage.local.set({ [key]: items });
  // Only remove legacy data AFTER the new copy has been successfully persisted.
  if (stored[oldKey] !== undefined) await chrome.storage.local.remove(oldKey);
  return items;
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'mutateHighlights') {
    const run = highlightWrites.then(() => mutateHighlights(message));
    highlightWrites = run.catch(() => {});
    run.then(items => sendResponse({ ok: true, ...(message.operation.type === 'migrate' ? { items } : {}) }),
      error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'getCosmeticRules') {
    chrome.storage.local.get([CACHE_KEY], (items) => {
      sendResponse({ data: items[CACHE_KEY] || null });
    });
    return true; // async response
  }
  if (message.action === 'forceRefreshFilters') {
    compileAndStoreFilters().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.action === 'fetchAbadis') {
    const rawWord = (message.word || '').trim().toLowerCase();
    const slug = encodeURIComponent(rawWord.replace(/[\s_]+/g, '-'));
    const url = `https://abadis.ir/entofa/${slug}/`;

    fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.text();
      })
      .then(html => {
        sendResponse({ success: true, html, url });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }

  const createScraperBot = (url, extractFunc, fallbackPrompt, sendResponse) => {
    chrome.tabs.create({ url: url, active: false }, (tab) => {
      const tabId = tab.id;
      let attempts = 0;
      let resolved = false;

      const finishWithAI = () => {
        if (resolved) return;
        resolved = true;
        clearInterval(checkInterval);
        try { chrome.tabs.remove(tabId); } catch(e) {}
        
        const rawText = (fallbackPrompt.split('"')[1] || fallbackPrompt).trim();
        const targetLang = fallbackPrompt.includes('to Persian') || fallbackPrompt.includes('to fa') ? 'fa' : 'en';
        
        // Pass clean raw text without "Translate..." prompt envelope to prevent echo
        fetch(`https://text.pollinations.ai/${encodeURIComponent(rawText)}?model=openai&seed=42`)
          .then(res => res.text())
          .then(text => {
            if (text && !text.includes('402 Payment') && !text.includes('deprecated') && !text.toLowerCase().includes('translate the following')) {
              sendResponse({ success: true, translation: text.trim() });
            } else {
              // Switch to official free Google Translate endpoint with clean raw text
              const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(rawText)}`;
              fetch(gUrl)
                .then(r => r.json())
                .then(gData => {
                  const trans = gData?.[0]?.[0]?.[0] || 'ترجمه یافت نشد';
                  sendResponse({ success: true, translation: trans });
                })
                .catch(() => sendResponse({ success: false, error: 'خطا در دریافت ترجمه' }));
            }
          })
          .catch(() => sendResponse({ success: false, error: 'پاسخی دریافت نشد' }));
      };
      
      const checkInterval = setInterval(() => {
        attempts++;
        if (attempts > 6) { // 3 seconds max for web tab scrape before fast AI failover
          finishWithAI();
          return;
        }

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: extractFunc
        }, (results) => {
          if (chrome.runtime.lastError || resolved) return;
          
          const text = results?.[0]?.result;
          if (text) {
            resolved = true;
            clearInterval(checkInterval);
            try { chrome.tabs.remove(tabId); } catch(e) {}
            sendResponse({ success: true, translation: text.trim() });
          }
        });
      }, 500);
    });
  };

  if (message.action === 'fetchQuillbot') {
    const text = (message.text || '').trim();
    const sl = message.sl === 'fa' ? 'fa' : 'auto';
    const tl = message.tl === 'en' ? 'en-US' : (message.tl || 'en-US');
    
    const url = `https://quillbot.com/translate?sl=${sl}&tl=${tl}&tone=auto&text=${encodeURIComponent(text)}`;
    const fallbackPrompt = `Translate the following text to ${tl}: "${text}"`;
    
    createScraperBot(url, () => {
      try {
        // 1. Remove OneTrust overlay blocking interaction
        const ot = document.getElementById('onetrust-consent-sdk');
        if (ot) ot.remove();
        const filter = document.querySelector('.onetrust-pc-dark-filter');
        if (filter) filter.remove();

        // 2. Auto-click Translate button if present
        if (!window._quillbotClicked) {
          const btn = document.querySelector('#tltr-translate-button, button[id*="translate"]');
          if (btn) {
            btn.click();
            window._quillbotClicked = true;
          }
        }

        const forbiddenPhrases = ['translate', 'loading...', 'premium', 'upgrade', 'copy', 'upgrade to premium', 'get premium', 'history', 'saved', 'add text', 'start writing', 'choose language'];
        const forbiddenPrefixes = ['type, paste, or upload', 'there are no limits', 'choose language'];
        const isValid = (txt) => {
          if (!txt || txt.trim().length === 0) return false;
          const lower = txt.trim().toLowerCase();
          if (forbiddenPhrases.includes(lower)) return false;
          if (forbiddenPrefixes.some(prefix => lower.startsWith(prefix) || lower.includes(prefix))) return false;
          if (lower.length < 30 && (lower.includes('premium') || lower.includes('upgrade') || lower.includes('choose'))) return false;
          return true;
        };

        // Target QuillBot ProseMirror editor
        const editors = document.querySelectorAll('.tiptap.ProseMirror, [data-testid="translated-text"]');
        if (editors.length >= 2) {
          const outText = editors[1].innerText || editors[1].textContent;
          if (isValid(outText)) return outText;
        } else if (editors.length === 1) {
          const outText = editors[0].innerText || editors[0].textContent;
          const inputTxt = new URL(window.location.href).searchParams.get('text');
          if (isValid(outText) && outText.trim() !== inputTxt) return outText;
        }

        const outputEditor = document.querySelector('#editable-message-box, .translation-output');
        if (outputEditor && isValid(outputEditor.innerText)) {
          return outputEditor.innerText;
        }
      } catch(e) {}
      return null;
    }, fallbackPrompt, sendResponse);
    
    return true; // async
  }

  if (message.action === 'fetchMachineTranslation') {
    const text = (message.text || '').trim();
    const sl = message.sl === 'fa' ? 'Persian' : 'English';
    const tl = message.tl === 'en' ? 'English' : 'Persian';
    
    const url = `https://www.machinetranslation.com/?text=${encodeURIComponent(text)}`;
    const fallbackPrompt = `Translate the following text from ${sl} to ${tl} with multi-model consensus AI precision: "${text}"`;
    
    createScraperBot(url, () => {
      try {
        const btn = document.querySelector('button[type="submit"], button.translate-btn');
        if (btn && !window._btnClicked) {
           btn.click();
           window._btnClicked = true;
        }
        
        const results = document.querySelectorAll('.translated-text, [data-testid="result"], .result-box, .mt-4 p, .translation-result, [id*="target"]');
        for (const el of results) {
          const txt = el.innerText || '';
          if (txt.trim().length > 0 && !txt.toLowerCase().includes('loading') && txt.trim().toLowerCase() !== 'translate' && !txt.toLowerCase().includes('choose language')) {
            return txt;
          }
        }
      } catch(e) {}
      return null;
    }, fallbackPrompt, sendResponse);
    
    return true; // async
  }
});

// Listen for storage changes to dynamically toggle ad blocker
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.adBlockEnabled) {
      syncAdBlockerState(changes.adBlockEnabled.newValue);
      syncSiteActivationRules();
      if (changes.adBlockEnabled.newValue === true) {
        loadOrRefreshFilters();
      }
    }
    if (changes.enabled || changes.disabledAdBlockDomains) {
      syncSiteActivationRules();
    }
  }
});

function scheduleFilterRefresh() {
  chrome.alarms?.create(FILTER_REFRESH_ALARM, {
    delayInMinutes: 5,
    periodInMinutes: CACHE_TTL / 60000
  });
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== FILTER_REFRESH_ALARM) return;
  chrome.storage.local.get({ enabled: true, adBlockEnabled: true }, (items) => {
    if (items.enabled !== false && items.adBlockEnabled !== false) loadOrRefreshFilters();
  });
});

// Extension install/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Rastin RTL] Extension installed/updated.');
  chrome.storage.local.get({ adBlockEnabled: true }, (items) => {
    syncAdBlockerState(items.adBlockEnabled);
    if (items.adBlockEnabled) loadOrRefreshFilters();
  });
  syncSiteActivationRules();
  scheduleFilterRefresh();
});

// Browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Rastin RTL] Browser started.');
  chrome.storage.local.get({ adBlockEnabled: true }, (items) => {
    syncAdBlockerState(items.adBlockEnabled);
    if (items.adBlockEnabled) loadOrRefreshFilters();
  });
  syncSiteActivationRules();
  scheduleFilterRefresh();
});
