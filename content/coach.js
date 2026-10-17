// Reading progress and gentle focus reminders, with one disposable listener scope.
window.RtlFixer = window.RtlFixer || {};
(function (RtlFixer) {
  'use strict';
  let scope = null, progress = null, fill = null, label = null, pulse = null;
  let inactivity = null, frame = null, lastActivity = 0, container = null;
  const config = () => RtlFixer.config || RtlFixer.DEFAULT_CONFIG || {};
  function position(x, y) {
    const parse = v => Number.isFinite(parseFloat(v)) ? parseFloat(v) : 20;
    return { x: Math.max(8, Math.min(innerWidth - 108, parse(x))), y: Math.max(8, Math.min(innerHeight - 40, parse(y))) };
  }
  function updateProgress(event) {
    if (!progress) return;
    let target = event?.target;
    if (RtlFixer.isExtensionNode?.(target)) return;
    if (!target || target === document || target === window) {
      target = document.scrollingElement || document.documentElement;
      if (target.scrollHeight <= target.clientHeight + 10) {
        if (!container?.isConnected) {
          container = [...document.querySelectorAll('main,article,[role="main"],section,div')]
            .slice(0,150).filter(el => !RtlFixer.isExtensionNode?.(el) && el.scrollHeight > el.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(el).overflowY))
            .sort((a,b) => (b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
        }
        if (container) target = container;
      }
    }
    const total = Math.max(0, target.scrollHeight - target.clientHeight);
    const value = total ? Math.max(0, Math.min(100, target.scrollTop / total * 100)) : 100;
    fill.style.width = value + '%'; label.textContent = Math.round(value).toLocaleString('fa-IR') + '٪';
    progress.setAttribute('aria-valuenow', Math.round(value));
  }
  function scheduleProgress(event) {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; updateProgress(event); });
  }
  function resetFocus() {
    clearTimeout(inactivity); if (pulse) pulse.style.opacity = '0';
    if (!config().focusCoachEnabled || document.hidden) return;
    inactivity = setTimeout(() => { if (pulse && !document.hidden) pulse.style.opacity = '1'; }, 30000);
  }
  function onActivity(event) {
    if (event.type === 'scroll') scheduleProgress(event);
    const time = performance.now();
    if (time - lastActivity > 250 || event.type !== 'pointermove') { lastActivity = time; resetFocus(); }
  }
  function createProgress() {
    progress = document.createElement('div'); progress.id = 'rtl-fixer-progress-container';
    progress.setAttribute('role','progressbar'); progress.setAttribute('aria-label','پیشرفت مطالعه');
    progress.setAttribute('aria-valuemin','0'); progress.setAttribute('aria-valuemax','100');
    progress.title = 'پیشرفت مطالعه • برای جابه‌جایی بکشید';
    progress.style.cssText = 'position:fixed;z-index:2147483642;display:flex;align-items:center;gap:9px;padding:8px 11px;width:104px;height:34px;border:1px solid #e7e9ef;border-radius:11px;background:#fffffff2;box-shadow:0 5px 20px #20233310;font:10px RastinUi,Tahoma,sans-serif;direction:ltr;color:#9d91ba;cursor:grab;touch-action:none;user-select:none';
    const track = document.createElement('div'); track.style.cssText='width:43px;height:4px;border-radius:4px;background:#eeeaf7;overflow:hidden';
    fill = document.createElement('div'); fill.id='rtl-fixer-progress-bar'; fill.style.cssText='height:100%;width:0;background:#a796db;border-radius:4px;transition:width .15s ease';
    label = document.createElement('span'); label.style.cssText='font-variant-numeric:tabular-nums;width:27px;text-align:center';
    track.appendChild(fill); progress.append(track,label); document.documentElement.appendChild(progress);
    const p = position(config().batteryPositionX,config().batteryPositionY); progress.style.left=p.x+'px'; progress.style.top=p.y+'px';
    let drag = null;
    progress.addEventListener('pointerdown', e => { if(e.button!==0)return; const b=progress.getBoundingClientRect(); drag={x:e.clientX-b.left,y:e.clientY-b.top}; progress.setPointerCapture(e.pointerId); e.preventDefault(); }, {signal:scope.signal});
    progress.addEventListener('pointermove', e => { if(!drag)return; const p=position(e.clientX-drag.x,e.clientY-drag.y); progress.style.left=p.x+'px';progress.style.top=p.y+'px'; }, {signal:scope.signal});
    const finish = () => {
      if(!drag)return;drag=null;
      const x=progress.style.left,y=progress.style.top;
      config().batteryPositionX=x;config().batteryPositionY=y;
      const key=RtlFixer.getSiteConfigKey();
      chrome.storage.local.get(RtlFixer.getSiteConfigKeys()).then(items=>chrome.storage.local.set({[key]:{...RtlFixer.getStoredSiteConfig(items),batteryPositionX:x,batteryPositionY:y}})).catch(()=>{});
    };
    progress.addEventListener('pointerup',finish,{signal:scope.signal});
    progress.addEventListener('pointercancel',()=>{drag=null;},{signal:scope.signal});
  }
  function createFocus() {
    pulse=document.createElement('div');pulse.id='rtl-fixer-focus-pulse';
    pulse.style.cssText='position:fixed;inset:0;z-index:2147483641;pointer-events:none;opacity:0;transition:opacity .8s ease;box-shadow:inset 0 0 60px #a797db18';
    const message=document.createElement('div');message.textContent='یک مکث کوتاه؛ ادامهٔ مطالعه';
    message.style.cssText='position:absolute;bottom:24px;left:50%;transform:translateX(-50%);background:#fffffff5;border:1px solid #e7e2f1;border-radius:12px;box-shadow:0 8px 30px #20233312;padding:10px 16px;font:12px RastinUi,Tahoma,sans-serif;color:#aa98c6;direction:rtl';
    pulse.appendChild(message);document.documentElement.appendChild(pulse);
  }
  function resize() {
    container=null;
    if(progress){const b=progress.getBoundingClientRect(),p=position(b.left,b.top);progress.style.left=p.x+'px';progress.style.top=p.y+'px';}
    scheduleProgress();
  }
  RtlFixer.initCoach=function(){
    const c=config();
    if(!c.globalEnabled||!c.enabled||(!c.focusCoachEnabled&&!c.readingProgressEnabled)){RtlFixer.removeCoach();return;}
    if(!scope){
      scope=new AbortController();
      ['scroll','pointermove','keydown','click'].forEach(type=>document.addEventListener(type,onActivity,{capture:type==='scroll',passive:true,signal:scope.signal}));
      document.addEventListener('visibilitychange',resetFocus,{signal:scope.signal});
      window.addEventListener('resize',resize,{passive:true,signal:scope.signal});
    }
    if(c.readingProgressEnabled&&!progress)createProgress();
    if(!c.readingProgressEnabled&&progress){progress.remove();progress=fill=label=null;}
    if(c.focusCoachEnabled&&!pulse)createFocus();
    if(!c.focusCoachEnabled&&pulse){pulse.remove();pulse=null;}
    updateProgress();resetFocus();
  };
  RtlFixer.removeCoach=function(){
    scope?.abort();scope=null;clearTimeout(inactivity);inactivity=null;
    if(frame!==null)cancelAnimationFrame(frame);frame=null;
    progress?.remove();pulse?.remove();progress=fill=label=pulse=container=null;
  };
})(window.RtlFixer);
