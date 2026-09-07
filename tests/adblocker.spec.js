/* oxlint-disable react-hooks/rules-of-hooks -- Playwright fixture callback, not React */
import { test as base, expect, chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const extensionPath = path.join(__dirname, '..');

const test = base.extend({
  context: async ({ }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  }
});

test.describe('Adblocker Scenarios', () => {

  test.beforeEach(async ({ context }) => {
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent('serviceworker');
    }
    await worker.evaluate(() => chrome.storage.local.set({
      enabled: true,
      adBlockEnabled: true,
      disabledAdBlockDomains: [],
      'site_config_example.com': { enabled: true, adBlockEnabled: true },
      'site_config_youtube.com': { enabled: true, adBlockEnabled: true },
      'site_config_zardfilm.in': { enabled: true, adBlockEnabled: true },
      'site_config_par30games.net': { enabled: true, adBlockEnabled: true }
    }));
  });

  test('1. Network Interception - Doubleclick & Analytics', async ({ page }) => {
    await test.step('Navigate to safe page', async () => {
      await page.route('https://example.com/**', route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body></body></html>'
      }));
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    });

    let doubleclickBlocked = false;
    let googleAnalyticsBlocked = false;

    page.on('requestfailed', request => {
      const url = request.url();
      if (url.includes('doubleclick.net')) doubleclickBlocked = true;
      if (url.includes('google-analytics.com')) googleAnalyticsBlocked = true;
    });

    await test.step('Attempt to load ad scripts', async () => {
      await page.evaluate(() => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = 'https://googleads.g.doubleclick.net/pagead/id';
            
            const script = document.createElement('script');
            script.src = 'https://www.google-analytics.com/analytics.js';
            document.body.appendChild(script);

            setTimeout(resolve, 1500); 
        });
      });
    });

    await test.step('Verify requests were blocked', async () => {
      expect(doubleclickBlocked || googleAnalyticsBlocked).toBeTruthy();
    });
  });

  test('2. Cached network rules restore after session loss', async ({ context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const result = await worker.evaluate(async () => {
      const cacheKey = 'adblocker_filter_cache';
      const originalCache = await chrome.storage.local.get([cacheKey]);
      const originalRules = await chrome.declarativeNetRequest.getSessionRules();
      const blockRuleIds = Array.from({ length: 5000 }, (_, index) => index + 1);

      try {
        await chrome.storage.local.set({
          [cacheKey]: {
            generic: [],
            specific: {},
            networkDomains: ['cached-ad.example'],
            compiledAt: Date.now()
          }
        });
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: blockRuleIds
        });
        await restoreSessionRulesFromCache();
        await syncSiteActivationRules();

        const restoredRules = await chrome.declarativeNetRequest.getSessionRules();
        const restoredRule = restoredRules.find(rule => rule.id === 1);
        return {
          urlFilter: restoredRule?.condition?.urlFilter,
          activationIdsReserved: !restoredRules.some(rule =>
            rule.id > 5000 && ![5001, 5002, 5003].includes(rule.id)
          ),
          youtubeCompatibility: restoredRules.some(rule =>
            rule.id === 5003 &&
            rule.action.type === 'allow' &&
            rule.condition.initiatorDomains?.includes('youtube.com')
          )
        };
      } finally {
        if (originalCache[cacheKey] === undefined) {
          await chrome.storage.local.remove(cacheKey);
        } else {
          await chrome.storage.local.set({ [cacheKey]: originalCache[cacheKey] });
        }
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: blockRuleIds,
          addRules: originalRules.filter(rule => rule.id <= 5000)
        });
      }
    });

    expect(result).toEqual({
      urlFilter: '||cached-ad.example^',
      activationIdsReserved: true,
      youtubeCompatibility: true
    });
  });

  test('2a. EasyList compiler preserves paths, scopes and exceptions', async ({ context }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const result = await worker.evaluate(() => {
      const parsed = parseFilters(`
        ||ads.example/path^$script,third-party,domain=site.com|~shop.site.com
        @@||ads.example/allowed.js$script,domain=site.com
      `);
      return buildSessionRules(parsed.networkRules).map(rule => ({
        priority: rule.priority,
        action: rule.action.type,
        condition: rule.condition
      }));
    });

    expect(result).toEqual([
      {
        priority: 1,
        action: 'block',
        condition: {
          urlFilter: '||ads.example/path^',
          resourceTypes: ['script'],
          initiatorDomains: ['site.com'],
          excludedInitiatorDomains: ['shop.site.com'],
          domainType: 'thirdParty'
        }
      },
      {
        priority: 10,
        action: 'allow',
        condition: {
          urlFilter: '||ads.example/allowed.js',
          resourceTypes: ['script'],
          initiatorDomains: ['site.com']
        }
      }
    ]);
  });

  test('2b. YouTube cold-load player objects are pruned in MAIN world', async ({ page }) => {
    await page.route('https://www.youtube.com/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><head><script>
          window.ytInitialPlayerResponse = {
            adPlacements: [{ id: 'cold-ad' }],
            adSlots: [{ id: 'cold-slot' }],
            playerAds: [{ id: 'cold-player-ad' }],
            adBreakHeartbeatParams: 'heartbeat',
            videoDetails: { videoId: 'content-video', title: 'Keep me' }
          };
          window.__parsedPlayerResponse = JSON.parse('{"playerAds":[{"id":"parsed-ad"}],"adSlots":[{"id":"parsed-slot"}],"videoDetails":{"videoId":"parsed-video"}}');
          window.ytInitialData = {
            playerAds: [{ id: 'initial-data-ad' }],
            contents: { keep: true }
          };
          window.ytcfg = { data_: { EXPERIMENT_FLAGS: {
            all_web_enable_network_machine: true,
            all_web_network_machine_raw_request: true,
            unrelated_experiment: true
          } } };
        </script></head><body></body></html>`
      });
    });

    await page.goto('https://www.youtube.com/watch?v=cold', { waitUntil: 'domcontentloaded' });

    await expect.poll(() => page.evaluate(() =>
      window.ytcfg?.data_?.EXPERIMENT_FLAGS?.all_web_enable_network_machine
    )).toBe(true);

    const result = await page.evaluate(() => ({
      interceptorActive: window.RastinYouTubeAdInterceptor?.active,
      player: window.ytInitialPlayerResponse,
      parsedPlayer: window.__parsedPlayerResponse,
      initialData: window.ytInitialData,
      experimentFlags: window.ytcfg.data_.EXPERIMENT_FLAGS,
      stats: window.RastinYouTubeAdInterceptor?.getStats()
    }));

    expect(result.interceptorActive).toBe(true);
    expect(result.player).toEqual({
      playerAds: [{ id: 'cold-player-ad' }],
      adBreakHeartbeatParams: 'heartbeat',
      videoDetails: { videoId: 'content-video', title: 'Keep me' }
    });
    expect(result.parsedPlayer).toEqual({
      playerAds: [{ id: 'parsed-ad' }],
      videoDetails: { videoId: 'parsed-video' }
    });
    expect(result.initialData).toEqual({
      playerAds: [{ id: 'initial-data-ad' }],
      contents: { keep: true }
    });
    expect(result.experimentFlags).toEqual({
      all_web_enable_network_machine: true,
      all_web_network_machine_raw_request: true,
      unrelated_experiment: true
    });
    expect(result.stats.jsonParses).toBeGreaterThanOrEqual(1);
    expect(result.stats.initialObjects).toBeGreaterThanOrEqual(2);
    expect(result.stats.removedProperties).toBeGreaterThanOrEqual(3);
  });

  test('2b-2. YouTube remains active when its optional site config is absent', async ({ context, page }) => {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.remove('site_config_youtube.com'));

    await page.route('https://www.youtube.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body></body></html>'
    }));

    await page.goto('https://www.youtube.com/watch?v=no-site-config', {
      waitUntil: 'domcontentloaded'
    });

    await expect.poll(() => page.evaluate(() =>
      document.documentElement.getAttribute('data-rastin-youtube-adblock')
    )).toBe('on');
    await expect.poll(() => page.evaluate(() =>
      window.RastinYouTubeAdInterceptor?.active
    )).toBe(true);
  });

  test('2c. YouTube fetch/XHR responses respect live enable state', async ({ context, page }) => {
    const playerPayload = {
      adPlacements: [{ id: 'response-ad' }],
      adSlots: [{ id: 'response-slot' }],
      playerAds: [{ id: 'response-player-ad' }],
      adBreakHeartbeatParams: 'heartbeat',
      videoDetails: { videoId: 'content-video' },
      nested: { playerResponse: { adPlacements: [{ id: 'nested-ad' }], keep: true } }
    };

    await page.route('https://www.youtube.com/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/youtubei/v1/player') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(playerPayload)
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><head></head><body></body></html>'
      });
    });

    await page.goto('https://www.youtube.com/watch?v=responses', { waitUntil: 'domcontentloaded' });

    const enabledResult = await page.evaluate(async () => {
      const fetchResponse = await fetch('/youtubei/v1/player?source=fetch');
      const nativeBrandClone = Response.prototype.clone.call(fetchResponse);
      const fetchClone = fetchResponse.clone();
      const fetchJson = await fetchResponse.json();
      const fetchText = JSON.parse(await fetchClone.text());
      const nativeBrandJson = await nativeBrandClone.json();

      const xhrJson = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/youtubei/v1/player?source=xhr');
        xhr.responseType = 'json';
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = reject;
        xhr.send();
      });

      return {
        responseIsNative: fetchResponse instanceof Response &&
          Object.getPrototypeOf(fetchResponse) === Response.prototype &&
          !Object.prototype.hasOwnProperty.call(fetchResponse, 'json'),
        payloads: { fetchJson, fetchText, nativeBrandJson, xhrJson }
      };
    });

    expect(enabledResult.responseIsNative).toBe(true);
    for (const payload of Object.values(enabledResult.payloads)) {
      expect(payload.videoDetails).toEqual({ videoId: 'content-video' });
      expect(payload.nested.playerResponse).toEqual({ keep: true });
      expect(payload.adPlacements).toBeUndefined();
      expect(payload.adSlots).toBeUndefined();
      expect(payload.playerAds).toEqual([{ id: 'response-player-ad' }]);
      expect(payload.adBreakHeartbeatParams).toBe('heartbeat');
    }

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({
      disabledAdBlockDomains: ['youtube.com'],
      'site_config_youtube.com': { enabled: true, adBlockEnabled: false }
    }));
    await expect.poll(() => page.evaluate(() => window.RastinYouTubeAdInterceptor?.active)).toBe(false);

    const disabledPayload = await page.evaluate(async () => {
      const response = await fetch('/youtubei/v1/player?source=disabled');
      return response.json();
    });
    expect(disabledPayload.adPlacements).toEqual([{ id: 'response-ad' }]);
    expect(disabledPayload.adSlots).toEqual([{ id: 'response-slot' }]);
    expect(disabledPayload.playerAds).toEqual([{ id: 'response-player-ad' }]);
    expect(disabledPayload.videoDetails).toEqual({ videoId: 'content-video' });

    await worker.evaluate(() => chrome.storage.local.set({
      disabledAdBlockDomains: [],
      'site_config_youtube.com': { enabled: true, adBlockEnabled: true }
    }));
    await expect.poll(() => page.evaluate(() => window.RastinYouTubeAdInterceptor?.active)).toBe(true);

    const reenabledPayload = await page.evaluate(async () => {
      const response = await fetch('/youtubei/v1/player?source=reenabled');
      return response.json();
    });
    expect(reenabledPayload.adPlacements).toBeUndefined();
    expect(reenabledPayload.playerAds).toEqual([{ id: 'response-player-ad' }]);
    expect(reenabledPayload.videoDetails).toEqual({ videoId: 'content-video' });
  });

  test('2d. YouTube MAIN-world player API skips server-side and classic ad pods', async ({ page }) => {
    await page.route('https://www.youtube.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><head></head><body></body></html>'
    }));
    await page.goto('https://www.youtube.com/watch?v=main-world-skips', {
      waitUntil: 'domcontentloaded'
    });

    await page.evaluate(() => {
      window.__serverAd = { active: true, id: 'server-ad-1', duration: 12 };
      window.__serverSeeks = [];
      window.__classicSkipCalls = 0;

      const player = document.createElement('div');
      player.id = 'movie_player';
      player.className = 'html5-video-player';
      player.getStatsForNerds = () => ({
        debugInfo: window.__serverAd.active ? 'CPN: test; mode=SSAP; type=AD' : 'CPN, CONTENT'
      });
      player.getProgressState = () => ({
        current: 0,
        duration: window.__serverAd.duration,
        loaded: window.__serverAd.duration
      });
      player.getVideoData = () => ({ video_id: window.__serverAd.id });
      player.seekTo = duration => { window.__serverSeeks.push(duration); };
      player.skipAd = () => { window.__classicSkipCalls++; };

      const video = document.createElement('video');
      video.className = 'html5-main-video';
      const marker = document.createElement('div');
      marker.className = 'ytp-ad-player-overlay';
      player.append(video, marker);
      document.body.appendChild(player);
    });

    await expect.poll(() => page.evaluate(() => window.__serverSeeks)).toEqual([12]);
    await page.waitForTimeout(750);
    await expect.poll(() => page.evaluate(() => window.__serverSeeks)).toEqual([12]);

    await page.evaluate(() => {
      window.__serverAd.id = 'server-ad-2';
      window.__serverAd.duration = 7;
    });
    await expect.poll(() => page.evaluate(() => window.__serverSeeks)).toEqual([12, 7]);
    await page.waitForTimeout(750);
    await expect.poll(() => page.evaluate(() => window.__serverSeeks)).toEqual([12, 7]);

    await page.evaluate(() => {
      window.__serverAd.active = false;
      document.getElementById('movie_player').classList.add('ad-showing');
    });
    await expect.poll(() => page.evaluate(() => window.__classicSkipCalls)).toBe(1);
    await page.waitForTimeout(750);
    await expect.poll(() => page.evaluate(() => window.__classicSkipCalls)).toBe(1);

    await page.evaluate(() => {
      const marker = document.querySelector('.ytp-ad-player-overlay');
      marker.replaceWith(marker.cloneNode(true));
    });
    await expect.poll(() => page.evaluate(() => window.__classicSkipCalls)).toBe(2);

    const stats = await page.evaluate(() => window.RastinYouTubeAdInterceptor.getStats());
    expect(stats.serverSideSkips).toBe(2);
    expect(stats.classicSkips).toBeGreaterThanOrEqual(2);
  });

  test('3. Cosmetic Banner Hiding (Generic Rules)', async ({ page }) => {
    await test.step('Navigate to safe page', async () => {
      await page.route('https://example.com/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
      });
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    });

    await test.step('Inject an ad banner element', async () => {
      await page.evaluate(() => {
        const banner = document.createElement('div');
        banner.className = 'ad-banner';
        banner.id = 'test-banner';
        banner.textContent = 'This is an annoying ad';
        document.body.appendChild(banner);
      });
    });

    await test.step('Verify banner is hidden', async () => {
      // Playwright's toHaveCSS will automatically retry until the extension's async CSS injection completes
      await expect(page.locator('#test-banner')).toHaveCSS('display', 'none', { timeout: 5000 });
    });
  });

  test('3. Site-Specific Cosmetic Hiding (YouTube)', async ({ page }) => {
    await test.step('Navigate to YouTube', async () => {
      await page.route('https://www.youtube.com/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
      });
      await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
    });

    await test.step('Inject YouTube specific ad elements and YouTube masthead', async () => {
      await page.evaluate(() => {
        const adSlot = document.createElement('ytd-ad-slot-renderer');
        adSlot.id = 'test-yt-ad';
        adSlot.textContent = 'YT Ad Content';
        document.body.appendChild(adSlot);

        // Masthead structure
        const mastheadContainer = document.createElement('div');
        mastheadContainer.id = 'masthead-container';
        
        const masthead = document.createElement('ytd-masthead');
        masthead.id = 'masthead';
        masthead.className = 'style-scope ytd-app';
        
        const container = document.createElement('div');
        container.id = 'container';
        container.className = 'style-scope ytd-masthead';
        
        masthead.appendChild(container);
        mastheadContainer.appendChild(masthead);
        document.body.appendChild(mastheadContainer);
      });
    });

    await test.step('Verify YouTube ad slots are hidden while masthead remains visible', async () => {
      await expect(page.locator('#test-yt-ad')).toHaveCSS('display', 'none', { timeout: 5000 });
      await expect(page.locator('#masthead-container')).not.toHaveCSS('display', 'none');
      await expect(page.locator('#masthead')).not.toHaveCSS('display', 'none');
      await expect(page.locator('#container.ytd-masthead')).not.toHaveCSS('display', 'none');
    });
  });

  test('4. YouTube late player ad handling and state restoration', async ({ page }) => {
    await page.route('https://www.youtube.com/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><head></head><body><div id="page-ready"></div></body></html>'
      });
    });
    await page.goto('https://www.youtube.com/watch?v=test', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#rastin-youtube-ad-styles')).toHaveCount(1);

    await page.evaluate(() => {
      window.__youtubeSkipClicks = 0;

      const player = document.createElement('div');
      player.id = 'movie_player';
      player.className = 'html5-video-player ad-showing';

      const video = document.createElement('video');
      video.className = 'html5-main-video';
      video.playbackRate = 1.25;
      video.muted = false;
      Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 3 });
      Object.defineProperty(video, 'duration', { configurable: true, value: 15 });

      const skipButton = document.createElement('button');
      skipButton.className = 'ytp-ad-skip-button-modern';
      skipButton.addEventListener('click', () => { window.__youtubeSkipClicks++; });

      player.append(video, skipButton);
      document.body.appendChild(player);
    });

    await expect.poll(() => page.evaluate(() => {
      const video = document.querySelector('video');
      return {
        playbackRate: video.playbackRate,
        muted: video.muted,
        skipClicked: window.__youtubeSkipClicks > 0
      };
    })).toEqual({ playbackRate: 1.25, muted: true, skipClicked: true });

    // The same control may remain mounted while YouTube transitions out of the
    // ad. It must not be clicked repeatedly during that period.
    await page.waitForTimeout(1100);
    await expect.poll(() => page.evaluate(() => ({
      currentTime: document.querySelector('video').currentTime,
      playbackRate: document.querySelector('video').playbackRate,
      skipClicks: window.__youtubeSkipClicks
    }))).toEqual({ currentTime: 3, playbackRate: 1.25, skipClicks: 1 });

    await page.evaluate(() => {
      const player = document.getElementById('movie_player');
      const video = player.querySelector('video');
      const reusedSkipButton = player.querySelector('.ytp-ad-skip-button-modern');

      // YouTube reuses the same control for the second ad in a pod. The time
      // rewind must open a new click episode even though the node is unchanged.
      video.currentTime = 0;
      reusedSkipButton.setAttribute('aria-label', 'Skip Ad 2');
    });

    await expect.poll(() => page.evaluate(() => window.__youtubeSkipClicks)).toBe(2);

    await page.waitForTimeout(1100);
    await expect.poll(() => page.evaluate(() => window.__youtubeSkipClicks)).toBe(2);

    await page.evaluate(() => {
      document.getElementById('movie_player').classList.remove('ad-showing');
    });

    await expect.poll(() => page.evaluate(() => ({
      playbackRate: document.querySelector('video').playbackRate,
      muted: document.querySelector('video').muted
    }))).toEqual({ playbackRate: 1.25, muted: false });
  });

  test('4b. YouTube fallback accelerates an unskippable ad and restores playback', async ({ page }) => {
    await page.route('https://www.youtube.com/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><head></head><body></body></html>'
      });
    });
    await page.goto('https://www.youtube.com/watch?v=repeat', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.className = 'html5-video-player ad-showing';

      const video = document.createElement('video');
      video.className = 'html5-main-video';
      video.playbackRate = 1.25;
      video.muted = false;
      Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 2 });
      Object.defineProperty(video, 'duration', { configurable: true, value: 10 });

      const adOverlay = document.createElement('div');
      adOverlay.className = 'ytp-ad-player-overlay';
      player.append(video, adOverlay);
      document.body.appendChild(player);
    });

    // If an unskippable classic ad leaks through, accelerate its own media.
    await expect(page.locator('video')).toHaveJSProperty('playbackRate', 16);

    // Replacing the overlay must not create a seek/reload loop; the same video
    // remains accelerated without touching currentTime.
    await page.evaluate(() => {
      const overlay = document.querySelector('.ytp-ad-player-overlay');
      overlay.replaceWith(overlay.cloneNode(true));
    });
    await page.waitForTimeout(1000);
    await expect(page.locator('video')).toHaveJSProperty('playbackRate', 16);
    await expect(page.locator('video')).toHaveJSProperty('currentTime', 2);

    await page.evaluate(() => {
      document.getElementById('movie_player').classList.remove('ad-showing');
    });
    await expect(page.locator('video')).toHaveJSProperty('playbackRate', 1.25);
  });

  test('4c. YouTube hides only the interruption toast', async ({ page }) => {
    await page.route('https://www.youtube.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body></body></html>'
    }));
    await page.goto('https://www.youtube.com/watch?v=toast', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      const interruption = document.createElement('yt-notification-action-renderer');
      interruption.id = 'interruption-toast';
      interruption.textContent = 'Experiencing interruptions? Find out why';

      const normal = document.createElement('yt-notification-action-renderer');
      normal.id = 'normal-toast';
      normal.textContent = 'Saved to Watch later';
      document.body.append(interruption, normal);
    });

    await expect(page.locator('#interruption-toast')).toBeHidden();
    await expect(page.locator('#interruption-toast')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#normal-toast')).toBeVisible();
    await expect(page.locator('#normal-toast')).not.toHaveAttribute('aria-hidden', 'true');
  });

  test('5. YouTube settings stop and restart the adapter', async ({ context, page }) => {
    await page.route('https://www.youtube.com/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><head></head><body></body></html>'
      });
    });
    await page.goto('https://www.youtube.com/watch?v=settings', { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      window.__youtubeSkipCalls = 0;
      const player = document.createElement('div');
      player.id = 'movie_player';
      player.className = 'ad-showing';
      player.skipAd = () => { window.__youtubeSkipCalls++; };

      const video = document.createElement('video');
      video.className = 'html5-main-video';
      video.playbackRate = 1.5;
      video.muted = false;
      player.appendChild(video);
      document.body.appendChild(player);
    });

    await expect.poll(() => page.locator('video').evaluate(video => ({
      playbackRate: video.playbackRate,
      muted: video.muted
    }))).toEqual({ playbackRate: 16, muted: true });

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({
      disabledAdBlockDomains: ['youtube.com'],
      'site_config_youtube.com': { enabled: true, adBlockEnabled: false }
    }));

    await expect(page.locator('#rastin-youtube-ad-styles')).toHaveCount(0);
    await expect.poll(() => page.locator('video').evaluate(video => ({
      playbackRate: video.playbackRate,
      muted: video.muted
    }))).toEqual({ playbackRate: 1.5, muted: false });

    await page.evaluate(() => {
      const promoted = document.createElement('ytd-ad-slot-renderer');
      promoted.id = 'disabled-promoted-slot';
      document.body.appendChild(promoted);
    });
    await expect(page.locator('#disabled-promoted-slot')).not.toHaveCSS('display', 'none');

    await worker.evaluate(() => chrome.storage.local.set({
      disabledAdBlockDomains: [],
      'site_config_youtube.com': { enabled: true, adBlockEnabled: true }
    }));

    await expect(page.locator('#rastin-youtube-ad-styles')).toHaveCount(1);
    await expect(page.locator('#disabled-promoted-slot')).toHaveCSS('display', 'none');
    await expect.poll(() => page.locator('video').evaluate(video => ({
      playbackRate: video.playbackRate,
      muted: video.muted
    }))).toEqual({ playbackRate: 16, muted: true });
  });

  test('6. Site-Specific Cosmetic Hiding (Zardfilm)', async ({ page }) => {
    await test.step('Navigate to Zardfilm', async () => {
      await page.route('https://zardfilm.in/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
      });
      await page.goto('https://zardfilm.in/', { waitUntil: 'domcontentloaded' });
    });

    await test.step('Inject Zardfilm specific ad elements', async () => {
      await page.evaluate(() => {
        const banner = document.createElement('div');
        banner.className = 'banner-desktop';
        banner.id = 'test-zf-ad';
        banner.textContent = 'Zardfilm Desktop Ad';
        document.body.appendChild(banner);
      });
    });

    await test.step('Verify Zardfilm ads are hidden', async () => {
      await expect(page.locator('#test-zf-ad')).toHaveCSS('display', 'none', { timeout: 5000 });
    });
  });

  test('5. Site-Specific Cosmetic Hiding (Par30games)', async ({ page }) => {
    await test.step('Navigate to Par30games', async () => {
      await page.route('https://par30games.net/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
      });
      await page.goto('https://par30games.net/', { waitUntil: 'domcontentloaded' });
    });

    await test.step('Inject Par30games specific ad elements', async () => {
      await page.evaluate(() => {
        const banner = document.createElement('div');
        banner.className = 'sidebar-box-shop';
        banner.id = 'test-p30-ad';
        banner.textContent = 'Par30games Shop Ad';
        document.body.appendChild(banner);
      });
    });

    await test.step('Verify Par30games ads are hidden', async () => {
      await expect(page.locator('#test-p30-ad')).toHaveCSS('display', 'none', { timeout: 5000 });
    });
  });

  test('6. Popup Blocker Interception', async ({ page }) => {
    await test.step('Navigate to safe page', async () => {
      await page.route('https://example.com/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
      });
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    });

    await test.step('Attempt to trigger popups programmatically', async () => {
      const isPopupBlocked = await page.evaluate(() => {
        // Try opening a popup to a blacklisted domain without user interaction
        const result = window.open('https://yektanet.com', '_blank');
        return result === null; 
      });
      expect(isPopupBlocked).toBeTruthy();
    });
  });

  test('7. Tracking Parameter Stripping', async ({ page }) => {
    await test.step('Navigate to URL with tracking query params', async () => {
      await page.route('https://example.com/**', async route => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
      });
      await page.goto('https://example.com/?utm_source=test_source&fbclid=12345', { waitUntil: 'domcontentloaded' });
    });

    await test.step('Verify tracking params are stripped from URL', async () => {
      await page.waitForTimeout(1000); // Allow extension history.replaceState to execute
      const currentUrl = page.url();
      expect(currentUrl).not.toContain('utm_source');
      expect(currentUrl).not.toContain('fbclid');
    });
  });
});
