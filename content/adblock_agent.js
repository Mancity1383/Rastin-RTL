/**
 * Rastin RTL - Smart Adblocking Agent v2.0
 * Multi-layer feature extraction with confidence scoring
 * Target: 90%+ precision with minimal false positives
 */

(function () {
  'use strict';

  // ============================================================
  // SECTION 1: UTILITIES & SAFETY HELPERS
  // ============================================================

  const Logger = {
    prefix: '[Rastin RTL v2]',
    log:   (...a) => console?.log?.(Logger.prefix, ...a),
    warn:  (...a) => console?.warn?.(Logger.prefix, ...a),
    error: (...a) => console?.error?.(Logger.prefix, ...a),
    debug: (...a) => {
      if (Logger.debugMode) console?.log?.(`${Logger.prefix} [DEBUG]`, ...a);
    },
    debugMode: false
  };

  // Media platforms where the heuristic agent must never hide elements — its
  // guesses collapse real UI (e.g. the YouTube masthead). Matched on the
  // registrable-domain boundary so "notyoutube.com" / "youtube.com.evil.org"
  // are NOT treated as YouTube.
  const MEDIA_BLOCKLIST = [
    'youtube.com', 'youtu.be', 'youtube-nocookie.com',
    'netflix.com', 'spotify.com', 'twitch.tv'
  ];

  function isMediaBlocklistedSite() {
    const host = location.hostname.toLowerCase();
    return MEDIA_BLOCKLIST.some(d => host === d || host.endsWith('.' + d));
  }

  function checkDomainEnabled(enabledDomains, hostname) {
    if (!Array.isArray(enabledDomains) || typeof hostname !== 'string') return false;
    const host = hostname.toLowerCase();
    return enabledDomains.some(domain => {
      if (typeof domain !== 'string') return false;
      const d = domain.toLowerCase();
      return host === d || host.endsWith('.' + d);
    });
  }

  function getParentElement(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    try {
      const root = node.getRootNode();
      if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
        return root.host;
      }
    } catch (e) {}
    return null;
  }

  // Safe computed style getter with caching
  function getStyle(node, styleCache) {
    if (styleCache.has(node)) return styleCache.get(node);
    try {
      const style = window.getComputedStyle(node);
      styleCache.set(node, style);
      return style;
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // SECTION 2: PATTERN LIBRARIES
  // ============================================================

  /**
   * Tiered pattern system:
   * TIER_1 = Definitive ad signals (very high confidence)
   * TIER_2 = Strong ad signals
   * TIER_3 = Supporting signals (need corroboration)
   */
  const Patterns = {

    // Known ad network domains - exact matches only
    // These are definitive: if src contains these, it's an ad
    TIER_1_NETWORKS: new Set([
      'yektanet.com', 'sabavision.com', 'tapsell.ir', 'mediaad.org',
      'najva.com', 'pushe.co', 'doubleclick.net', 'googlesyndication.com',
      'adnxs.com', 'rubiconproject.com', 'openx.net', 'pubmatic.com',
      'criteo.com', 'taboola.com', 'outbrain.com', 'revcontent.com',
      'mgid.com', 'adcolony.com', 'smartadserver.com', 'appnexus.com',
      '33across.com', 'sharethrough.com', 'sovrn.com', 'lijit.com',
      'indexexchange.com', 'rhythmone.com', 'adform.net', 'flashtalking.com',
      'advertising.com', 'adtech.de', 'casalemedia.com', 'contextweb.com',
      'bidswitch.net', 'eyeota.net', 'liveintent.com', 'conversantmedia.com',
      'adroll.com', 'quantserve.com', 'scorecardresearch.com',
      // Iranian ad networks
      'iran-ad.com', 'clickyab.com', 'clirad.com', 'irankhodro.com',
      'adro.ir', 'hamkaranSystem.ir'
    ]),

    // Tier 1 class/id patterns - definitive ad containers
    // These patterns are so specific they almost never appear in content
    TIER_1_CLASS_ID: '\\b(' + [
      'google[-_]ad',
      'google[-_]ads',
      'googletag',
      'dfp[-_]ad',
      'gpt[-_]ad',
      'adsense',
      'adsbygoogle',
      'yektanet[-_]?widget',
      'tapsell[-_]?ad',
      'sabavision[-_]?ad',
      'najva[-_]?widget',
      'pushe[-_]?container',
      'mediaad[-_]?container',
      'ad[-_]slot',
      'ad[-_]unit',
      'ad[-_]container(?!er)',
      'ad[-_]wrapper(?!per)',
      'ad[-_]placement',
      'ad[-_]placeholder',
      'ad[-_]frame',
      'ad[-_]zone',
      'advert[-_]container',
      'advertisement[-_]container',
      'sponsored[-_]content(?![-_]article)',
      'promoted[-_]content(?![-_]article)'
    ].join('|') + ')\\b',

    // Tier 2 patterns - strong signals but need corroboration
    TIER_2_CLASS_ID: '\\b(' + [
      'banner[-_]ad',
      'leaderboard',
      'skyscraper',
      'interstitial',
      'ad[-_]banner',
      'ad[-_]block(?![-_](?:chain|er|plus))',
      'ad[-_]box',
      'ad[-_]cell',
      'ad[-_]space',
      'ad[-_]widget',
      'ads[-_]section',
      'ads[-_]widget',
      'sponsored[-_]post',
      'sponsored[-_]link',
      'partner[-_]content',
      'native[-_]ad',
      'inline[-_]ad',
      'sidebar[-_]ad',
      'header[-_]ad',
      'footer[-_]ad'
    ].join('|') + ')\\b',

    // Persian ad text markers - exact text nodes only
    PERSIAN_AD_BADGES: new Set([
      'آگهی', 'تبلیغ', 'تبلیغات', 'رپورتاژ',
      'رپورتاژ آگهی', 'محتوای حمایت شده', 'پیشنهاد ویژه تجاری',
      'آگهی تجاری', 'تبلیغ تجاری'
    ]),

    // English ad text markers - exact text nodes only
    ENGLISH_AD_BADGES: new Set([
      'ad', 'ads', 'advertisement', 'advertisements',
      'sponsored', 'promoted', 'paid content',
      'partner content', 'brand content'
    ]),

    // Content-site patterns that should NEVER be blocked
    // These protect against false positives
    CONTENT_SAFEGUARDS: '\\b(' + [
      'article',
      'post[-_]content',
      'main[-_]content',
      'page[-_]content',
      'entry[-_]content',
      'story[-_]content',
      'news[-_]content',
      'blog[-_]post',
      'comment',
      'nav(?:bar|igation)',
      'header(?![-_]ad)',
      'footer(?![-_]ad)',
      'menu',
      'search',
      'breadcrumb',
      'pagination',
      'sidebar(?![-_]ad)',
      'widget(?![-_]ad)',
      'gallery',
      'carousel',
      'slider(?![-_]ad)',
      'modal(?![-_]ad)',
      'dialog',
      'tooltip',
      'dropdown',
      'accordion',
      'tab(?:s|panel|content)',
      'hero(?![-_]ad)',
      'logo',
      'avatar',
      'profile',
      'user[-_]info',
      'author'
    ].join('|') + ')\\b'
  };

  // Build RegExp objects from pattern strings (cleaned)
  // We store as strings above for readability, convert here:
  function buildPattern(patternStr) {
    // Remove the toString wrapper artifacts
    const clean = patternStr
      .replace(/^\//, '')    // remove leading /
      .replace(/\/[a-z]*$/, '') // remove trailing flags
      .replace(/\(\?:/g, '(?:'); // ensure non-capturing
    return new RegExp(clean, 'i');
  }

  Patterns.TIER_1_REGEX = buildPattern(Patterns.TIER_1_CLASS_ID);
  Patterns.TIER_2_REGEX = buildPattern(Patterns.TIER_2_CLASS_ID);
  Patterns.SAFEGUARD_REGEX = buildPattern(Patterns.CONTENT_SAFEGUARDS);

  // ============================================================
  // SECTION 3: FEATURE EXTRACTOR
  // ============================================================

  class FeatureExtractor {

    constructor() {
      // Standard IAB ad sizes with tolerance
      // Format: [width, height, tolerance_ratio]
      this.adSizes = [
        // Desktop sizes
        [728,  90,  0.05], // Leaderboard
        [300, 250,  0.05], // Medium Rectangle
        [160, 600,  0.05], // Wide Skyscraper
        [300, 600,  0.05], // Half Page
        [970, 250,  0.05], // Billboard
        [970,  90,  0.05], // Super Leaderboard
        [336, 280,  0.05], // Large Rectangle
        [468,  60,  0.05], // Full Banner
        [234,  60,  0.05], // Half Banner
        [120, 600,  0.05], // Skyscraper
        [120,  90,  0.05], // Button 1
        [120,  60,  0.05], // Button 2
        [88,   31,  0.10], // Micro Bar
        [250, 250,  0.05], // Square
        [200, 200,  0.05], // Small Square
        [180, 150,  0.05], // Small Rectangle
        [125, 125,  0.05], // Square Button
        // Mobile sizes
        [320,  50,  0.05], // Mobile Banner
        [320, 100,  0.05], // Large Mobile Banner
        [320, 480,  0.05], // Mobile Interstitial
        [300,  50,  0.05], // Mobile Banner (Alt)
        [360,  60,  0.08], // Mobile Banner (Wide)
        [360, 300,  0.08], // Mobile Rectangle
        // Native/responsive common sizes
        [600, 500,  0.08],
        [400, 300,  0.08],
      ];

      this.styleCache = new Map();
    }

    clearStyleCache() {
      this.styleCache.clear();
    }

    // Drop one node's cached computed style — call when its class/style/etc.
    // changed so the next classification doesn't reuse stale layout.
    invalidateStyle(node) {
      this.styleCache.delete(node);
    }

    /**
     * Main extraction method
     * Returns a detailed feature object with confidence hints
     */
    extract(node, rect) {
      const features = {
        // TIER 1 signals (definitive)
        isKnownAdNetwork:    0, // src points to known ad network
        isTier1ClassId:      0, // class/id matches tier-1 patterns
        isAdBadgeText:       0, // exact text match to ad label

        // TIER 2 signals (strong)
        isTier2ClassId:      0,
        isIframe:            0,
        isStandardAdSize:    0,
        isInsTag:            0, // <ins> is almost exclusively used for AdSense

        // TIER 3 signals (supporting)
        hasFixedPosition:    0,
        hasAbsolutePosition: 0,
        highZIndex:          0,
        isImageLink:         0, // <a><img></a> pattern
        hasDataAdAttr:       0, // data-ad-* attributes
        outsideMainContent:  0, // positioned outside article/main

        // NEGATIVE signals (reduce ad score)
        hasSafeguardClass:   0, // class matches content safeguards
        hasSubstantialText:  0, // node has 200+ chars of text
        isNavElement:        0, // inside nav/header/footer
        isFormElement:       0, // inside form
        isHiddenOrTiny:      0, // invisible - likely tracker

        // Meta
        rawScore:            0,
        confidence:          0,
        tier:                0  // highest tier signal found
      };

      const tag       = node.tagName || '';
      const className = typeof node.className === 'string' ? node.className : '';
      const id        = node.id || '';
      const classAndId = `${className} ${id}`;

      // --- Safeguard check FIRST (prevents false positives) ---
      if (Patterns.SAFEGUARD_REGEX.test(classAndId)) {
        features.hasSafeguardClass = 1;
        // Still continue - a node can have both content and ad classes
        // but the safeguard will heavily penalize the score
      }

      // --- TIER 1: Known ad network in src/href ---
      features.isKnownAdNetwork = this._checkAdNetworkSrc(node);
      if (features.isKnownAdNetwork) features.tier = 1;

      // --- TIER 1: Class/ID pattern ---
      if (Patterns.TIER_1_REGEX.test(classAndId)) {
        features.isTier1ClassId = 1;
        features.tier = Math.max(features.tier, 1);
      }

      // --- TIER 1: <ins> tag (almost exclusively AdSense) ---
      if (tag === 'INS') {
        features.isInsTag = 1;
        features.tier = Math.max(features.tier, 1);
      }

      // --- TIER 1: Exact ad badge text ---
      features.isAdBadgeText = this._checkAdBadgeText(node);
      if (features.isAdBadgeText) features.tier = Math.max(features.tier, 1);

      // --- TIER 2: Class/ID pattern ---
      if (!features.isTier1ClassId && Patterns.TIER_2_REGEX.test(classAndId)) {
        features.isTier2ClassId = 1;
        features.tier = Math.max(features.tier, 2);
      }

      // --- TIER 2: iframe ---
      if (tag === 'IFRAME') {
        features.isIframe = 1;
        features.tier = Math.max(features.tier, 2);
      }

      // --- TIER 2: Standard ad size ---
      features.isStandardAdSize = this._checkAdSize(rect);
      if (features.isStandardAdSize) {
        features.tier = Math.max(features.tier, 2);
      }

      // --- TIER 3: data-ad-* attributes ---
      features.hasDataAdAttr = this._checkDataAdAttributes(node);

      // --- TIER 3: Image-link pattern ---
      features.isImageLink = this._checkImageLinkPattern(node, tag);

      // --- Style-based signals ---
      this._extractStyleFeatures(node, features);

      // --- Hidden/Tiny check ---
      if (rect.width > 0 && rect.height > 0) {
        if (rect.width <= 5 || rect.height <= 5) {
          features.isHiddenOrTiny = 1;
        }
      }

      // --- Content signals (negative) ---
      const text = node.textContent || '';
      if (text.length > 200) {
        features.hasSubstantialText = 1;
      }

      // --- Structural signals ---
      features.isNavElement  = this._isInsideNavigation(node);
      features.isFormElement = this._isInsideForm(node);

      return features;
    }

    _checkAdNetworkSrc(node) {
      let src = '', href = '';
      try {
        src  = node.getAttribute('src')  || node.getAttribute('data-src') || '';
        href = node.getAttribute('href') || '';
      } catch (e) { return 0; }

      const urls = [src, href].filter(Boolean);
      for (const url of urls) {
        try {
          // Extract hostname from URL
          let hostname = '';
          if (url.startsWith('http')) {
            hostname = new URL(url).hostname.replace(/^www\./, '');
          } else if (url.startsWith('//')) {
            hostname = new URL('https:' + url).hostname.replace(/^www\./, '');
          } else {
            // Relative URL - extract domain-like segment
            const match = url.match(/\/\/([^/]+)/);
            if (match) hostname = match[1].replace(/^www\./, '');
          }

          if (!hostname) continue;

          // Check exact match and parent domains
          if (Patterns.TIER_1_NETWORKS.has(hostname)) return 1;

          // Check if hostname ends with any known network domain
          for (const network of Patterns.TIER_1_NETWORKS) {
            if (hostname.endsWith('.' + network)) return 1;
          }
        } catch (e) {}
      }
      return 0;
    }

    _checkAdBadgeText(node) {
      // Strategy: check direct text nodes only (not full textContent)
      // This prevents false positives from articles that mention "ads"
      let directText = '';
      if (node.childNodes) {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) { // TEXT_NODE
            directText += child.nodeValue;
          }
        }
      }
      directText = directText.trim().toLowerCase();

      // Also check full text if node is small (likely a label)
      const fullText = (node.textContent || '').trim().toLowerCase();

      // Only treat as badge if the ENTIRE content of the node is the ad label
      // i.e., don't flag "In this article, advertisements are clearly labeled"
      const textToCheck = directText.length > 0 ? directText : fullText;

      if (
        textToCheck.length > 0 &&
        textToCheck.length < 50   // Short text only
      ) {
        if (Patterns.PERSIAN_AD_BADGES.has(textToCheck)) return 1;
        if (Patterns.ENGLISH_AD_BADGES.has(textToCheck)) return 1;
      }
      return 0;
    }

    _checkAdSize(rect) {
      if (rect.width < 10 || rect.height < 10) return 0;

      for (const [w, h, tol] of this.adSizes) {
        const widthDiff  = Math.abs(rect.width  - w) / w;
        const heightDiff = Math.abs(rect.height - h) / h;
        if (widthDiff <= tol && heightDiff <= tol) return 1;
      }
      return 0;
    }

    _checkDataAdAttributes(node) {
      try {
        const attrs = node.attributes;
        if (!attrs) return 0;
        for (let i = 0; i < attrs.length; i++) {
          const name = attrs[i].name.toLowerCase();
          if (
            name.startsWith('data-ad')   ||
            name.startsWith('data-ads')  ||
            name === 'data-sponsor'      ||
            name === 'data-promoted'     ||
            name === 'data-native-ad'
          ) return 1;
        }
      } catch (e) {}
      return 0;
    }

    _checkImageLinkPattern(node, tag) {
      // <a href="..."><img src="..."></a> with no other text
      if (tag !== 'A') return 0;
      try {
        const children = node.children;
        if (children.length === 1 && children[0].tagName === 'IMG') {
          const text = (node.textContent || '').trim();
          if (text.length === 0) return 1;
        }
      } catch (e) {}
      return 0;
    }

    _extractStyleFeatures(node, features) {
      const style = getStyle(node, this.styleCache);
      if (!style) return;

      if (style.position === 'fixed') {
        features.hasFixedPosition = 1;
      } else if (style.position === 'absolute') {
        features.hasAbsolutePosition = 1;
      }

      const zIndex = parseInt(style.zIndex, 10);
      if (!isNaN(zIndex) && zIndex > 999) {
        features.highZIndex = 1;
      }
    }

    _isInsideNavigation(node) {
      let current = getParentElement(node);
      for (let i = 0; i < 5; i++) {
        if (!current) break;
        const tag = current.tagName ? current.tagName.toUpperCase() : '';
        const id = (current.id || '').toLowerCase();
        if (tag === 'NAV' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'YTD-MASTHEAD' || id.includes('masthead') || id.includes('header')) return 1;
        if (tag === 'MAIN' || tag === 'ARTICLE' || tag === 'BODY') break;
        current = getParentElement(current);
      }
      return 0;
    }

    _isInsideForm(node) {
      let current = getParentElement(node);
      for (let i = 0; i < 5; i++) {
        if (!current) break;
        if (current.tagName === 'FORM') return 1;
        if (current.tagName === 'BODY') break;
        current = getParentElement(current);
      }
      return 0;
    }
  }

  // ============================================================
  // SECTION 4: MULTI-LAYER CLASSIFIER
  // ============================================================

  /**
   * Tiered decision classifier
   *
   * Decision flow:
   * 1. Hard whitelist check  → immediate PASS
   * 2. Tier-1 signal check   → immediate BLOCK (very high precision)
   * 3. Score aggregation     → weighted combination
   * 4. Threshold check       → BLOCK if score > threshold
   *
   * This is NOT a simple perceptron.
   * It uses tiered rules + weighted scoring, which gives
   * much higher precision than a single linear classifier.
   */
  class Classifier {

    constructor() {
      // Weights tuned for precision over recall
      // (prefer to miss some ads rather than block content)
      this.weights = {
        // TIER 1 - definitive (any single signal is enough)
        isKnownAdNetwork:    10.0,
        isTier1ClassId:       9.0,
        isAdBadgeText:        9.0,
        isInsTag:             8.5,

        // TIER 2 - strong (need 1-2 corroborating signals)
        isTier2ClassId:       5.0,
        isIframe:             3.5,
        isStandardAdSize:     3.0,

        // TIER 3 - supporting (need multiple)
        hasDataAdAttr:        4.0,
        isImageLink:          2.0,
        hasFixedPosition:     1.5,
        hasAbsolutePosition:  0.5,
        highZIndex:           1.0,

        // NEGATIVE weights (false-positive prevention)
        hasSafeguardClass:   -6.0,
        hasSubstantialText:  -5.0,
        isNavElement:        -4.0,
        isFormElement:       -8.0,
        isHiddenOrTiny:      -3.0, // tracker pixels are handled separately

        // Bias: requires multiple signals to classify as ad
        bias: -5.5
      };

      // Tier-1 threshold: if any single tier-1 signal fires AND
      // no strong safeguard is present, immediately block
      this.tier1Threshold = 8.0;

      // General score threshold for blocking
      this.scoreThreshold = 0;
    }

    /**
     * Returns classification result:
     * { shouldBlock: bool, score: number, reason: string }
     */
    classify(features) {
      // === Hard pass rules ===

      // Never block form elements
      if (features.isFormElement) {
        return { shouldBlock: false, score: -99, reason: 'form-element' };
      }

      // Never block navigation elements
      if (features.isNavElement && !features.isKnownAdNetwork) {
        return { shouldBlock: false, score: -99, reason: 'nav-element' };
      }

      // === Tier-1 fast path ===
      // If a definitive signal fires, block immediately
      // UNLESS a strong safeguard is present
      const tier1Score = (
        features.isKnownAdNetwork * this.weights.isKnownAdNetwork +
        features.isTier1ClassId   * this.weights.isTier1ClassId   +
        features.isAdBadgeText    * this.weights.isAdBadgeText     +
        features.isInsTag         * this.weights.isInsTag
      );

      if (tier1Score >= this.tier1Threshold) {
        // Even tier-1 can be wrong if strong safeguard fires
        if (features.hasSafeguardClass && features.hasSubstantialText) {
          return {
            shouldBlock: false,
            score: tier1Score,
            reason: 'tier1-overridden-by-safeguard'
          };
        }
        return {
          shouldBlock: true,
          score: tier1Score,
          reason: 'tier1-definitive',
          tier: 1
        };
      }

      // === Full weighted scoring ===
      let score = this.weights.bias;

      const weightKeys = Object.keys(this.weights).filter(k => k !== 'bias');
      for (const key of weightKeys) {
        const val = features[key];
        if (typeof val === 'number' && val !== 0) {
          score += val * this.weights[key];
        }
      }

      const shouldBlock = score > this.scoreThreshold;

      return {
        shouldBlock,
        score,
        reason: shouldBlock ? 'weighted-score' : 'below-threshold',
        tier: shouldBlock ? features.tier : 0
      };
    }
  }

  // ============================================================
  // SECTION 5: AD CONTAINER FINDER
  // ============================================================

  /**
   * Smarter container finder that:
   * 1. Looks UP the DOM for logical ad wrapper
   * 2. Stops at content boundaries
   * 3. Validates the container before returning it
   */
  class ContainerFinder {

    constructor(classifier, extractor) {
      this.classifier = classifier;
      this.extractor  = extractor;
    }

    find(node) {
      let best     = node;
      let current  = getParentElement(node);

      // Ancestors we definitely should not climb past
      const stopTags = new Set(['BODY', 'HTML', 'MAIN', 'ARTICLE', 'SECTION', 'FORM']);

      for (let depth = 0; depth < 5; depth++) {
        if (!current) break;
        if (stopTags.has(current.tagName)) break;

        const classId = `${current.className || ''} ${current.id || ''}`;

        // Strong content safeguard on parent → stop immediately
        if (Patterns.SAFEGUARD_REGEX.test(classId) && !Patterns.TIER_1_REGEX.test(classId)) {
          break;
        }

        // Parent has tier-1 ad signal → use parent as target
        if (
          Patterns.TIER_1_REGEX.test(classId) ||
          Patterns.TIER_2_REGEX.test(classId)
        ) {
          best = current;
          current = getParentElement(current);
          continue;
        }

        // Parent is a naked <a> wrapping our node → include it
        if (current.tagName === 'A' && current.children.length <= 2) {
          best = current;
          current = getParentElement(current);
          continue;
        }

        // Parent is a single-child wrapper with no significant text → include it
        if (this._isThinWrapper(current, node)) {
          best = current;
          current = getParentElement(current);
          continue;
        }

        break;
      }

      // Final safety check
      if (best.tagName === 'BODY' || best.tagName === 'HTML') {
        return node;
      }

      return best;
    }

    _isThinWrapper(parent, originalNode) {
      // A "thin wrapper" has:
      // - Only the original node (or its ancestor) as meaningful content
      // - No substantial text of its own
      try {
        const visibleChildren = Array.from(parent.children).filter(child => {
          const tag = child.tagName;
          return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'NOSCRIPT';
        });

        if (visibleChildren.length > 2) return false;

        // Any sibling that is NOT on the original node's ancestor path and has
        // real content means this parent wraps more than just the ad — don't
        // climb into it.
        if (originalNode) {
          const hasUnrelatedContent = visibleChildren.some(child => {
            if (child === originalNode || child.contains(originalNode)) return false;
            if (child.hasAttribute('data-ai-adblocked') || child.hasAttribute('data-ai-collapsed')) return false;
            return (child.textContent || '').trim().length > 0 || child.querySelector('img, video, iframe, canvas, svg') !== null;
          });
          if (hasUnrelatedContent) return false;
        }

        const directText = Array.from(parent.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.nodeValue.trim())
          .join('');

        if (directText.length > 30) return false;

        return true;
      } catch (e) {
        return false;
      }
    }
  }

  // ============================================================
  // SECTION 6: CANDIDATE SELECTOR
  // ============================================================

  // Pre-compiled selector for initial DOM scan efficiency
  const CANDIDATE_SELECTOR = [
    // Definitive elements
    'iframe',
    'ins',
    'object',
    'embed',

    // Ad network class patterns
    '[class*="yektanet"]',
    '[class*="tapsell"]',
    '[class*="sabavision"]',
    '[class*="mediaad"]',
    '[class*="najva"]',
    '[class*="pushe"]',
    '[class*="adsbygoogle"]',
    '[class*="googletag"]',

    // Generic ad class patterns (careful - must be specific enough)
    '[class~="ad"]',
    '[class~="ads"]',
    '[id~="ad"]',
    '[id~="ads"]',
    '[class*="-ad-slot"]',
    '[class*="_ad-slot"]',
    '[class^="ad-slot"]',
    '[class*="ad_slot"]',
    '[class*="-ad-unit"]',
    '[class*="_ad-unit"]',
    '[class^="ad-unit"]',
    '[class*="ad_unit"]',
    '[class*="-ad-container"]',
    '[class*="_ad-container"]',
    '[class^="ad-container"]',
    '[class*="ad_container"]',
    '[class*="-ad-wrapper"]',
    '[class*="_ad-wrapper"]',
    '[class^="ad-wrapper"]',
    '[class*="advert"]',
    '[class*="advertisement"]',
    '[class*="banner-ad"]',
    '[class*="banner_ad"]',
    '[class*="sponsor"]',

    // Persian class patterns
    '[class*="تبلیغ"]',
    '[class*="آگهی"]',
    '[class*="رپورتاژ"]',

    // ID-based patterns
    '[id*="yektanet"]',
    '[id*="tapsell"]',
    '[id*="ad-slot"]',
    '[id*="ad_slot"]',
    '[id*="ad-unit"]',
    '[id*="advert"]',
    '[id*="banner-ad"]',
    '[id*="sponsor"]',

    // Data attribute patterns
    '[data-ad-slot]',
    '[data-ad-client]',
    '[data-ad-unit]',
    '[data-ad-format]',
    '[data-native-ad]',
    '[data-sponsor]'
  ].join(', ');

  // ============================================================
  // SECTION 7: DOM ELIMINATOR
  // ============================================================

  const originalAgentStyles = new WeakMap();
  const managedAgentElements = new Set();

  function pruneAgentDisconnectedNodes() {
    for (const el of managedAgentElements) {
      if (!el || !el.isConnected) {
        managedAgentElements.delete(el);
        if (el) originalAgentStyles.delete(el);
      }
    }
  }

  class DomEliminator {

    eliminate(node, result) {
      if (!node || node.hasAttribute('data-ai-adblocked')) return;

      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      const id = (node.id || '').toLowerCase();
      const classStr = typeof node.className === 'string' ? node.className.toLowerCase() : '';
      if (tag === 'HEADER' || tag === 'NAV' || id.includes('masthead') || classStr.includes('ytd-masthead') ||
          (node.closest && node.closest('header, nav, ytd-masthead, #masthead, #masthead-container, #header'))) {
        return;
      }

      try {
        if (!originalAgentStyles.has(node)) {
          originalAgentStyles.set(node, {
            display: node.style.getPropertyValue('display'),
            displayPriority: node.style.getPropertyPriority('display'),
            visibility: node.style.getPropertyValue('visibility'),
            visibilityPriority: node.style.getPropertyPriority('visibility'),
            height: node.style.getPropertyValue('height'),
            heightPriority: node.style.getPropertyPriority('height'),
            overflow: node.style.getPropertyValue('overflow'),
            overflowPriority: node.style.getPropertyPriority('overflow')
          });
          managedAgentElements.add(node);
        }
        node.style.setProperty('display',    'none',      'important');
        node.style.setProperty('visibility', 'hidden',    'important');
        node.style.setProperty('height',     '0',       'important');
        node.style.setProperty('width',      '0',       'important');
        node.style.setProperty('overflow',   'hidden',  'important');
        node.style.setProperty('margin',     '0',       'important');
        node.style.setProperty('padding',    '0',       'important');
        node.setAttribute('data-ai-adblocked', `${result.score.toFixed(2)}|${result.reason}`);
      } catch (e) {
        Logger.warn('Could not hide node:', e);
        return;
      }

      if (node.tagName === 'IFRAME') {
        try {
          const originalSrc = node.getAttribute('src');
          if (originalSrc && originalSrc !== 'about:blank' && !node.hasAttribute('data-ai-orig-src')) {
            node.setAttribute('data-ai-orig-src', originalSrc);
          }
          node.removeAttribute('src');
          node.setAttribute('src', 'about:blank');
        } catch (e) {}
      }

      this._collapseEmptyWrappers(node);
      pruneAgentDisconnectedNodes();
    }

    _collapseEmptyWrappers(node) {
      let current = getParentElement(node);

      for (let depth = 0; depth < 3; depth++) {
        if (!current) break;
        const tag = current.tagName ? current.tagName.toUpperCase() : '';
        const id = (current.id || '').toLowerCase();
        const classStr = typeof current.className === 'string' ? current.className.toLowerCase() : '';
        if (['BODY', 'HTML', 'MAIN', 'ARTICLE', 'HEADER', 'NAV', 'YTD-MASTHEAD', 'YTD-APP', 'YTD-PAGE-MANAGER'].includes(tag) ||
            id.includes('masthead') || id.includes('header') || id.includes('navbar') || (id === 'container' && classStr.includes('ytd-masthead')) ||
            classStr.includes('masthead') || classStr.includes('header') || classStr.includes('navbar') ||
            (current.closest && current.closest('header, nav, ytd-masthead, #masthead, #masthead-container, #header'))) {
          break;
        }

        if (!this._hasVisibleContent(current)) {
          try {
            if (!originalAgentStyles.has(current)) {
              originalAgentStyles.set(current, {
                display: current.style.getPropertyValue('display'),
                displayPriority: current.style.getPropertyPriority('display'),
                margin: current.style.getPropertyValue('margin'),
                marginPriority: current.style.getPropertyPriority('margin'),
                padding: current.style.getPropertyValue('padding'),
                paddingPriority: current.style.getPropertyPriority('padding')
              });
              managedAgentElements.add(current);
            }
            current.style.setProperty('display', 'none', 'important');
            current.style.setProperty('margin',  '0',    'important');
            current.style.setProperty('padding', '0',    'important');
            current.setAttribute('data-ai-collapsed', 'true');
          } catch (e) {}

          // Schedule restoration check for lazy-loaded content
          this._scheduleRestorationCheck(current);

          current = getParentElement(current);
        } else {
          break;
        }
      }
    }

    _hasVisibleContent(node) {
      if (!node || !node.children) return false;

      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      const id = (node.id || '').toLowerCase();
      const classStr = typeof node.className === 'string' ? node.className.toLowerCase() : '';
      if (['HEADER', 'NAV', 'YTD-MASTHEAD', 'YTD-APP', 'YTD-PAGE-MANAGER'].includes(tag) ||
          id.includes('masthead') || id.includes('header') || id.includes('navbar') ||
          classStr.includes('masthead') || classStr.includes('header') || classStr.includes('navbar') ||
          (node.closest && node.closest('header, nav, ytd-masthead, #masthead, #masthead-container, #header'))) {
        return true;
      }

      for (const child of node.children) {
        const childTag = child.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'YT-INTERACTION'].includes(childTag)) continue;
        if (child.hasAttribute('data-ai-adblocked')) continue;
        if (child.hasAttribute('data-ai-collapsed')) continue;

        try {
          const style = window.getComputedStyle(child);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            return true;
          }
        } catch (e) {
          return true; // Assume visible if we can't check
        }
      }

      // Check direct text nodes
      for (const child of node.childNodes) {
        if (child.nodeType === 3 && child.nodeValue.trim().length > 0) {
          return true;
        }
      }

      return false;
    }

    _scheduleRestorationCheck(container) {
      setTimeout(() => {
        if (!container.isConnected) return;
        if (!container.hasAttribute('data-ai-collapsed')) return;

        if (this._hasVisibleContent(container)) {
          try {
            container.style.removeProperty('display');
            container.style.removeProperty('margin');
            container.style.removeProperty('padding');
            container.removeAttribute('data-ai-collapsed');
          } catch (e) {}
        }
      }, 3000);
    }
  }

  // ============================================================
  // SECTION 8: MAIN AGENT ORCHESTRATOR
  // ============================================================

  class AdblockAgent {

    constructor() {
      this.extractor       = new FeatureExtractor();
      this.classifier      = new Classifier();
      this.containerFinder = new ContainerFinder(this.classifier, this.extractor);
      this.eliminator      = new DomEliminator();

      this.processedNodes = new WeakSet();
      this.blockedNodes   = new WeakSet();
      this.retryCounts    = new WeakMap();
      this.batchedNodes   = [];
      this.pendingFlush   = false;
      this.destroyed      = false;
      this.observer       = null;

      // Statistics for debugging
      this.stats = { evaluated: 0, blocked: 0, skipped: 0 };
    }

    init() {
      if (this.destroyed) return;

      const hostname = location.hostname.toLowerCase();

      // Sites where we must not interfere
      if (isMediaBlocklistedSite()) {
        Logger.log('Disabled on media platform:', hostname);
        return;
      }

      this.observer = new MutationObserver(this._handleMutations.bind(this));

      // Start observing immediately
      this._startObserver();

      // Scan existing DOM
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this._scanDocument());
      } else {
        this._scanDocument();
      }

      // Final scan after all resources load (ads often inject late)
      window.addEventListener('load', () => {
        setTimeout(() => this._scanDocument(), 500);
        setTimeout(() => this._scanDocument(), 2000);
      });

      Logger.log('Agent initialized on:', hostname);
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.observer) {
        try { this.observer.disconnect(); } catch (e) {}
        this.observer = null;
      }
      this.batchedNodes = [];
      this.extractor.clearStyleCache();

      // Restore everything the agent hid/collapsed so disabling adblock takes
      // effect without a page reload.
      try {
        for (const el of managedAgentElements) {
          try {
            const snapshot = originalAgentStyles.get(el);
            if (snapshot) {
              ['display', 'visibility', 'height', 'width', 'overflow', 'margin', 'padding'].forEach(prop => {
                const currentVal = el.style.getPropertyValue(prop);
                if (currentVal === 'none' || currentVal === 'hidden' || currentVal === '0') {
                  if (snapshot[prop]) {
                    el.style.setProperty(prop, snapshot[prop], snapshot[prop + 'Priority'] || '');
                  } else {
                    el.style.removeProperty(prop);
                  }
                }
              });
              originalAgentStyles.delete(el);
            }
            if (el.tagName === 'IFRAME' && el.hasAttribute('data-ai-orig-src')) {
              el.setAttribute('src', el.getAttribute('data-ai-orig-src'));
              el.removeAttribute('data-ai-orig-src');
            }
            el.removeAttribute('data-ai-adblocked');
            el.removeAttribute('data-ai-collapsed');
          } catch (_) {}
        }
        managedAgentElements.clear();
      } catch (e) { Logger.warn('Restore on destroy failed:', e); }

      Logger.log('Agent destroyed');
    }

    reactivate() {
      if (!this.destroyed) return;
      this.destroyed      = false;
      this.processedNodes = new WeakSet();
      this.blockedNodes   = new WeakSet();
      this.retryCounts    = new WeakMap();
      this.batchedNodes   = [];
      this.pendingFlush   = false;
      this.stats          = { evaluated: 0, blocked: 0, skipped: 0 };
      this.init();
    }

    _startObserver() {
      if (!document.documentElement || !this.observer) return;
      try {
        this.observer.observe(document.documentElement, {
          childList:       true,
          subtree:         true,
          attributes:      true,
          attributeFilter: ['class', 'id', 'src', 'href', 'data-ad-slot', 'style']
        });
      } catch (e) {
        Logger.warn('Observer failed:', e);
      }
    }

    _scanDocument() {
      if (!document.body || this.destroyed) return;
      // Same guard as init(): never run heuristic scans on media platforms,
      // even when reached via the first-visit scanner path.
      if (isMediaBlocklistedSite()) return;
      try {
        const candidates = document.querySelectorAll(CANDIDATE_SELECTOR);
        // Use requestIdleCallback if available for non-blocking scan
        if (window.requestIdleCallback) {
          const items = Array.from(candidates);
          const processChunk = (deadline) => {
            while (items.length > 0 && deadline.timeRemaining() > 1) {
              this._evaluateNode(items.shift());
            }
            if (items.length > 0) {
              requestIdleCallback(processChunk);
            }
          };
          requestIdleCallback(processChunk);
        } else {
          candidates.forEach(node => this._evaluateNode(node));
        }
      } catch (e) {
        Logger.warn('Scan failed:', e);
      }
    }

    _handleMutations(mutations) {
      if (this.destroyed) return;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (target?.nodeType === 1 && !target.hasAttribute('data-ai-adblocked')) {
            // The node's class/style/etc. just changed — its cached computed
            // style is now stale, so drop it before re-evaluating.
            this.extractor.invalidateStyle(target);
            this.processedNodes.delete(target);
            this._queueNode(target);
          }
        } else if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) {
              this._queueNode(node);
            }
          }
        }
      }

      this._scheduleFlush();
    }

    _queueNode(node) {
      if (this.batchedNodes.length < 500) {
        this.batchedNodes.push(node);
      }
    }

    _scheduleFlush() {
      if (this.pendingFlush || this.destroyed) return;
      this.pendingFlush = true;

      // Use requestAnimationFrame for non-blocking processing
      const flush = () => {
        this.pendingFlush = false;
        if (this.destroyed) return;

        const batch = this.batchedNodes.splice(0, 50);

        for (const node of batch) {
          if (!node.isConnected) continue;
          this._evaluateNode(node);

          // Also check children of added nodes
          if (node.querySelectorAll) {
            try {
              node.querySelectorAll(CANDIDATE_SELECTOR)
                .forEach(child => {
                  if (child.isConnected) this._evaluateNode(child);
                });
            } catch (e) {}
          }
        }

        // Continue processing remaining nodes
        if (this.batchedNodes.length > 0) {
          this.pendingFlush = true;
          requestAnimationFrame(flush);
        }
      };

      requestAnimationFrame(flush);
    }

    _evaluateNode(node) {
      if (this.destroyed)                          return;
      if (!node || !node.isConnected)              return;
      if (node.nodeType !== 1)                     return;
      if (this.processedNodes.has(node))           return;
      if (this.blockedNodes.has(node))             return;
      if (['BODY','HTML','HEAD'].includes(node.tagName)) return;

      // Skip already-blocked nodes
      if (node.hasAttribute('data-ai-adblocked')) {
        this.processedNodes.add(node);
        return;
      }

      // Get bounding rect
      const rect = node.getBoundingClientRect();

      // If not laid out yet, retry with backoff
      if (rect.width === 0 && rect.height === 0) {
        const retries = this.retryCounts.get(node) || 0;
        if (retries < 4) {
          this.retryCounts.set(node, retries + 1);
          const delay = [100, 300, 700, 1500][retries];
          setTimeout(() => {
            if (node.isConnected && !this.destroyed) {
              this._evaluateNode(node);
            }
          }, delay);
          return;
        }
        // After 4 retries, still evaluate (might be hidden ad)
      }

      // Mark as processed BEFORE evaluation to prevent re-entry
      this.processedNodes.add(node);
      this.stats.evaluated++;

      // Extract features
      const features = this.extractor.extract(node, rect);

      // Classify
      const result = this.classifier.classify(features);

      Logger.debug(
        `[${result.shouldBlock ? 'BLOCK' : 'PASS'}] ${node.tagName}`,
        `score=${result.score.toFixed(2)}`,
        `reason=${result.reason}`,
        node
      );

      if (result.shouldBlock) {
        const target = this.containerFinder.find(node);
        this.eliminator.eliminate(target, result);
        this.blockedNodes.add(target);
        this.stats.blocked++;
        Logger.log(
          `Blocked: ${target.tagName}#${target.id}.${target.className}`,
          `Score: ${result.score.toFixed(2)}`,
          `Reason: ${result.reason}`
        );
      } else {
        this.stats.skipped++;
      }
    }
  }

  // ============================================================
  // SECTION 9: EXTENSION INTEGRATION & LIFECYCLE
  // ============================================================

  let agentInstance = null;

  function updateAgentState() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const host = location.hostname.toLowerCase().replace(/^www\./, '');
      const hostKey = 'site_config_' + host;

      chrome.storage.local.get(null, (allStorage) => {
        if (chrome.runtime?.lastError) {
          Logger.warn('Storage error:', chrome.runtime.lastError.message);
          _ensureAgentRunning();
          return;
        }

        const globalEnabled = allStorage.enabled !== false;
        const globalAdBlockEnabled = allStorage.adBlockEnabled !== false;
        const disabledAdBlockDomains = allStorage.disabledAdBlockDomains || [];

        const siteConfig = allStorage[hostKey] || {};
        const siteEnabled = siteConfig.enabled !== false;
        const siteAdBlockEnabled = siteConfig.adBlockEnabled !== false;

        const isAdBlockDisabledForSite = disabledAdBlockDomains.some(d => {
          const dom = d.toLowerCase().replace(/^www\./, '');
          return host === dom || host.endsWith('.' + dom);
        });

        const shouldRun = globalEnabled &&
                          globalAdBlockEnabled &&
                          siteEnabled &&
                          siteAdBlockEnabled &&
                          !isAdBlockDisabledForSite;

        if (shouldRun) {
          _ensureAgentRunning();
        } else {
          if (agentInstance) agentInstance.destroy();
        }
      });
    } else {
      Logger.log('Standalone mode (no extension API)');
      _ensureAgentRunning();
    }
  }

  // ============================================================
  // FIRST-VISIT SMART AD SCANNER & NOTIFICATION TOAST
  // ============================================================

  function runFirstVisitAdScanner(agent) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    const domain = location.hostname.toLowerCase().replace(/^www\./, '');
    if (!domain || domain === 'localhost' || domain.includes('127.0.0.1')) return;
    // Media platforms are blocklisted for the agent; the first-visit scanner
    // must honor the same rule or it re-hides YouTube UI that init() protects.
    if (isMediaBlocklistedSite()) return;

    chrome.storage.local.get(['scanned_domains'], (res) => {
      const scannedDomains = res.scanned_domains || [];

      if (scannedDomains.includes(domain)) {
        return; // Already scanned on a previous visit
      }

      // Show Futuristic Scanner Toast
      const toast = document.createElement('div');
      toast.id = 'rastin-first-visit-toast';
      toast.innerHTML = `
        <style>
          #rastin-first-visit-toast {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 2147483647;
            background: rgba(15, 23, 42, 0.93);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: 1px solid rgba(56, 189, 248, 0.45);
            box-shadow: 0 12px 35px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.25);
            color: #f8fafc;
            padding: 14px 18px;
            border-radius: 14px;
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            direction: rtl;
            text-align: right;
            min-width: 290px;
            max-width: 380px;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            animation: rastinSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes rastinSlideIn {
            from { transform: translateX(120%) scale(0.9); opacity: 0; }
            to { transform: translateX(0) scale(1); opacity: 1; }
          }
          #rastin-first-visit-toast .r-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            font-size: 14px;
            color: #38bdf8;
            margin-bottom: 6px;
          }
          #rastin-first-visit-toast .r-title {
            font-size: 13px;
            color: #e2e8f0;
            line-height: 1.4;
          }
          #rastin-first-visit-toast .r-badge {
            display: inline-block;
            margin-top: 6px;
            padding: 3px 10px;
            background: rgba(56, 189, 248, 0.15);
            border-radius: 6px;
            font-size: 12px;
            color: #7dd3fc;
            font-weight: 600;
          }
          #rastin-first-visit-toast .r-pulse {
            width: 10px;
            height: 10px;
            background-color: #38bdf8;
            border-radius: 50%;
            display: inline-block;
            box-shadow: 0 0 10px #38bdf8;
            animation: rastinPulse 1.2s infinite alternate;
          }
          @keyframes rastinPulse {
            from { opacity: 0.4; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1.2); }
          }
        </style>
        <div class="r-header">
          <span class="r-pulse" id="rastin-toast-pulse"></span>
          <span>🛡️ اسکن و ایمن‌سازی هوشمند (ورود اول)</span>
        </div>
        <div class="r-title" id="rastin-toast-msg">در حال بررسی کانتینرها و بنرهای ${domain}...</div>
        <div class="r-badge" id="rastin-toast-count">۰ تبلیغ مسدود گردید</div>
      `;

      const mount = () => {
        if (!document.getElementById('rastin-first-visit-toast')) {
          (document.body || document.documentElement).appendChild(toast);
        }
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
      } else {
        mount();
      }

      let blockedInFirstVisit = 0;

      const performDeepScan = () => {
        // Stop if the agent was torn down (adblock disabled) after we scheduled.
        if (agent && agent.destroyed) return;
        const adSelectors = [
          '.close-extras',
          '[class*="close-extras"]',
          'img[src*="/media/extra/"]',
          'a[href*="/media/extra/"]',
          'a[href*="/advertising"]',
          'img[src*="static.shahrekhabar.com/banner/"]',
          'img[src*="/banner/"]',
          '[class*="type-resource"]',
          '.advertise',
          '.advertise-item',
          'section.advertise',
          '[class*="advertise"]',
          '[id*="advertise"]',
          'a[href*="24d.ir"]',
          'a[href*="l.24d.ir"]',
          'img[src*="servev2"]',
          'img[src*="/assets/ads/"]',
          'a[href*="/assets/ads/"]',
          'a[href*="irannewspaper.ir/ads"]',
          '.ad-banner a[href*="/ad/"]',
          '.ad-wrapper a[href*="/ad/"]',
          'a[href*="/click/"]',
          'a[href*="/redirect/"]'
        ];

        adSelectors.forEach(sel => {
          try {
            const els = document.querySelectorAll(sel);
            els.forEach(el => {
              if (el && el.style.display !== 'none') {
                el.style.setProperty('display', 'none', 'important');
                el.setAttribute('data-ai-adblocked', 'true');
                blockedInFirstVisit++;
              }
            });
          } catch(e) {}
        });

        if (agent && typeof agent._scanDocument === 'function') {
          try { agent._scanDocument(); } catch(e) {}
        }

        const countEl = document.getElementById('rastin-toast-count');
        if (countEl) {
          countEl.textContent = `${blockedInFirstVisit} تبلیغ شناسایی و مسدود شد`;
        }
      };

      performDeepScan();
      setTimeout(performDeepScan, 1000);
      setTimeout(performDeepScan, 2200);

      setTimeout(() => {
        const pulse = document.getElementById('rastin-toast-pulse');
        const msg = document.getElementById('rastin-toast-msg');
        const countEl = document.getElementById('rastin-toast-count');

        if (pulse) {
          pulse.style.backgroundColor = '#22c55e';
          pulse.style.boxShadow = '0 0 10px #22c55e';
          pulse.style.animation = 'none';
        }
        if (msg) {
          msg.textContent = `✅ اسکن هوشمند با موفقیت انجام شد.`;
        }
        if (countEl) {
          countEl.textContent = `${blockedInFirstVisit} تبلیغ از دست‌رفته پاکسازی و فیلتر گردید`;
          countEl.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
          countEl.style.color = '#86efac';
        }

        scannedDomains.push(domain);
        chrome.storage.local.set({ scanned_domains: scannedDomains });

        setTimeout(() => {
          if (toast && toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(120%) scale(0.9)';
            setTimeout(() => toast.remove(), 400);
          }
        }, 2200);

      }, 3000);
    });
  }

  function _ensureAgentRunning() {
    if (isMediaBlocklistedSite()) return;
    if (!agentInstance) {
      agentInstance = new AdblockAgent();
      agentInstance.init();
      runFirstVisitAdScanner(agentInstance);
    } else if (agentInstance.destroyed) {
      agentInstance.reactivate();
      runFirstVisitAdScanner(agentInstance);
    }
  }

  // Listen for settings changes
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      updateAgentState();
    });
  }

  // Start
  updateAgentState();

})();
