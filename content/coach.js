// RTL Beautifier & Fixer - Smart Focus Coach (ADHD/OCD Tools)
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  let progressContainer = null;
  let progressElement = null;
  let percentageElement = null;
  let pulseElement = null;
  let inactivityTimer = null;
  let coachActive = false;
  let scrollRafId = null;
  
  // Dragging state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  
  const INACTIVITY_THRESHOLD = 30000; 

  function clampPosition(x, y) {
    const maxX = Math.max(0, window.innerWidth - 120);
    const maxY = Math.max(0, window.innerHeight - 50);
    return {
      x: Math.max(0, Math.min(parseInt(x, 10) || 20, maxX)) + 'px',
      y: Math.max(0, Math.min(parseInt(y, 10) || 20, maxY)) + 'px'
    };
  }

  function saveBatteryPosition(x, y) {
    const clamped = clampPosition(x, y);
    if (!chrome.storage || !chrome.storage.local) return;
    if (RtlFixer.config) {
      RtlFixer.config.batteryPositionX = clamped.x;
      RtlFixer.config.batteryPositionY = clamped.y;
    }
    chrome.storage.local.set({ 
      batteryPositionX: clamped.x, 
      batteryPositionY: clamped.y 
    });
  }

  function createProgressBar() {
    if (!progressContainer) {
      const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
      
      // Modern iOS-style status bar pill
      progressContainer = document.createElement('div');
      progressContainer.id = 'rtl-fixer-progress-container';
      progressContainer.style.position = 'fixed';
      progressContainer.style.top = config.batteryPositionY || '20px';
      progressContainer.style.left = config.batteryPositionX || '20px';
      
      // Flex pill layout
      progressContainer.style.display = 'inline-flex';
      progressContainer.style.alignItems = 'center';
      progressContainer.style.gap = '6px';
      progressContainer.style.padding = '5px 9px';
      progressContainer.style.zIndex = '2147483647';
      progressContainer.style.cursor = 'grab';
      progressContainer.style.userSelect = 'none';
      
      // High-end glassmorphism
      progressContainer.style.backdropFilter = 'blur(12px) saturate(180%)';
      progressContainer.style.webkitBackdropFilter = 'blur(12px) saturate(180%)';
      progressContainer.style.backgroundColor = 'rgba(28, 28, 30, 0.75)'; // iOS Dark Slate
      progressContainer.style.border = '1px solid rgba(255, 255, 255, 0.12)';
      progressContainer.style.borderRadius = '30px';
      progressContainer.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.1)';
      progressContainer.title = 'پیشرفت مطالعه (برای جابجایی بکشید)';
      progressContainer.style.transition = 'box-shadow 0.2s ease';

      // 1. Percentage Text
      percentageElement = document.createElement('span');
      percentageElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      percentageElement.style.fontSize = '11px';
      percentageElement.style.fontWeight = '600';
      percentageElement.style.color = 'rgba(255, 255, 255, 0.9)';
      percentageElement.style.lineHeight = '1';
      percentageElement.textContent = '0%';
      progressContainer.appendChild(percentageElement);

      // 2. Battery Icon Container
      const batteryBody = document.createElement('div');
      batteryBody.style.position = 'relative';
      batteryBody.style.width = '20px';
      batteryBody.style.height = '10px';
      batteryBody.style.border = '1px solid rgba(255, 255, 255, 0.55)';
      batteryBody.style.borderRadius = '3px';
      batteryBody.style.padding = '1px';
      batteryBody.style.boxSizing = 'border-box';
      batteryBody.style.display = 'flex';
      batteryBody.style.alignItems = 'center';

      // Battery Terminal
      const terminal = document.createElement('div');
      terminal.style.position = 'absolute';
      terminal.style.right = '-2.5px';
      terminal.style.top = '50%';
      terminal.style.transform = 'translateY(-50%)';
      terminal.style.width = '1.5px';
      terminal.style.height = '4px';
      terminal.style.backgroundColor = 'rgba(255, 255, 255, 0.55)';
      terminal.style.borderRadius = '0 1px 1px 0';
      batteryBody.appendChild(terminal);

      // Battery Inner Fill
      progressElement = document.createElement('div');
      progressElement.id = 'rtl-fixer-progress-bar';
      progressElement.style.height = '100%';
      progressElement.style.width = '0%';
      progressElement.style.backgroundColor = '#ff453a'; // Starts iOS dark red
      progressElement.style.borderRadius = '1.2px';
      progressElement.style.transition = 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.4s ease';
      batteryBody.appendChild(progressElement);

      progressContainer.appendChild(batteryBody);
      document.documentElement.appendChild(progressContainer);
      
      // Drag events
      progressContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        progressContainer.style.cursor = 'grabbing';
        progressContainer.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25)';
        dragStartX = e.clientX - progressContainer.getBoundingClientRect().left;
        dragStartY = e.clientY - progressContainer.getBoundingClientRect().top;
        e.preventDefault();
      });
      
      document.addEventListener('mousemove', (e) => {
        if (!isDragging || !progressContainer) return;
        const newLeft = e.clientX - dragStartX;
        const newTop = e.clientY - dragStartY;
        progressContainer.style.left = `${newLeft}px`;
        progressContainer.style.top = `${newTop}px`;
      });
      
      document.addEventListener('mouseup', () => {
        if (isDragging && progressContainer) {
          isDragging = false;
          progressContainer.style.cursor = 'grab';
          progressContainer.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.1)';
          saveBatteryPosition(progressContainer.style.left, progressContainer.style.top);
        }
      });
    }
  }

  function createPulseElement() {
    if (!pulseElement) {
      pulseElement = document.createElement('div');
      pulseElement.id = 'rtl-fixer-focus-pulse';
      pulseElement.style.position = 'fixed';
      pulseElement.style.inset = '0';
      pulseElement.style.pointerEvents = 'none';
      pulseElement.style.zIndex = '2147483646';
      pulseElement.style.boxShadow = 'inset 0 0 0 8px rgba(76, 110, 245, 0)';
      pulseElement.style.transition = 'box-shadow 2s ease-in-out';
      
      const messageContainer = document.createElement('div');
      messageContainer.style.position = 'absolute';
      messageContainer.style.bottom = '40px';
      messageContainer.style.left = '50%';
      messageContainer.style.transform = 'translateX(-50%)';
      messageContainer.style.backgroundColor = 'rgba(15, 23, 42, 0.85)';
      messageContainer.style.color = '#fff';
      messageContainer.style.padding = '12px 24px';
      messageContainer.style.borderRadius = '24px';
      messageContainer.style.fontFamily = 'Vazirmatn, Tahoma, Arial, sans-serif';
      messageContainer.style.fontSize = '15px';
      messageContainer.style.fontWeight = '500';
      messageContainer.style.opacity = '0';
      messageContainer.style.transition = 'opacity 1.5s ease-in-out, transform 1.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      messageContainer.style.backdropFilter = 'blur(8px)';
      messageContainer.style.boxShadow = '0 8px 16px rgba(0,0,0,0.2)';
      messageContainer.style.border = '1px solid rgba(255,255,255,0.1)';
      messageContainer.style.display = 'flex';
      messageContainer.style.alignItems = 'center';
      messageContainer.style.gap = '8px';
      
      const icon = document.createElement('span');
      icon.innerHTML = '✨';
      icon.style.fontSize = '18px';
      
      const text = document.createElement('span');
      text.textContent = 'حواست اینجاست؟';
      
      messageContainer.appendChild(icon);
      messageContainer.appendChild(text);
      pulseElement.appendChild(messageContainer);
      
      document.documentElement.appendChild(pulseElement);
    }
  }

  let cachedMainContainer = null;

  function updateProgress(e) {
    if (!progressElement) return;
    
    let target = null;
    
    if (e && e.type === 'scroll') {
      target = (e.target === document) ? (document.scrollingElement || document.documentElement) : e.target;
    } else {
      target = document.scrollingElement || document.documentElement;
      if (target.scrollHeight - target.clientHeight <= 10) {
        if (cachedMainContainer) {
          target = cachedMainContainer;
        } else {
          const containers = document.querySelectorAll('main, div, section, article');
          let bestContainer = target;
          let maxScroll = 0;
          for (let i = 0; i < Math.min(containers.length, 50); i++) {
            const scrollArea = containers[i].scrollHeight - containers[i].clientHeight;
            if (scrollArea > maxScroll && scrollArea > 100) {
              maxScroll = scrollArea;
              bestContainer = containers[i];
            }
          }
          cachedMainContainer = bestContainer;
          target = bestContainer;
        }
      }
    }
    
    const scrollTop = target.scrollTop || window.scrollY || 0;
    const scrollHeight = target.scrollHeight || 0;
    const clientHeight = target.clientHeight || window.innerHeight;
    const maxScroll = scrollHeight - clientHeight;
    
    if (maxScroll > 50) {
      const scrolled = (scrollTop / maxScroll) * 100;
      const clamped = Math.min(100, Math.max(0, scrolled));
      
      progressElement.style.width = `${clamped}%`;
      
      // Dynamic modern iOS color transitions
      if (clamped < 25) {
        progressElement.style.backgroundColor = '#ff453a'; // iOS Red
      } else if (clamped < 70) {
        progressElement.style.backgroundColor = '#ff9f0a'; // iOS Orange
      } else {
        progressElement.style.backgroundColor = '#30d158'; // iOS Green
      }
      
      if (percentageElement) {
        percentageElement.textContent = `${Math.round(clamped)}%`;
      }
    }
  }

  function triggerCoachPulse() {
    if (!pulseElement) return;
    pulseElement.style.boxShadow = 'inset 0 0 0 12px rgba(76, 110, 245, 0.25)';
    const msg = pulseElement.firstChild;
    msg.style.opacity = '1';
    msg.style.transform = 'translateX(-50%) translateY(-10px)'; 
  }

  function hideCoachPulse() {
    if (pulseElement) {
      pulseElement.style.boxShadow = 'inset 0 0 0 8px rgba(76, 110, 245, 0)';
      const msg = pulseElement.firstChild;
      msg.style.opacity = '0';
      msg.style.transform = 'translateX(-50%) translateY(0)';
    }
  }

  function resetInactivityTimer() {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    hideCoachPulse(); 
    
    if (!config.focusCoachEnabled) return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    
    inactivityTimer = setTimeout(() => {
      triggerCoachPulse();
    }, INACTIVITY_THRESHOLD);
  }

  function handleUserActivity(e) {
    if (!coachActive) return;
    
    if (e && e.type === 'scroll') {
      if (scrollRafId) return;
      scrollRafId = requestAnimationFrame(() => {
        updateProgress(e);
        scrollRafId = null;
      });
    } else {
      updateProgress(e);
    }
    resetInactivityTimer();
  }

  RtlFixer.initCoach = function() {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const isDomainEnabled = config.globalEnabled && config.enabled;
    
    if (isDomainEnabled && (config.readingProgressEnabled || config.focusCoachEnabled)) {
      coachActive = true;
      
      if (config.readingProgressEnabled) {
        createProgressBar();
        updateProgress(null);
      } else if (progressContainer) {
        progressContainer.style.opacity = '0';
        setTimeout(() => { if (progressContainer) progressContainer.remove(); progressContainer = null; progressElement = null; }, 300);
      }
      
      if (config.focusCoachEnabled) {
        createPulseElement();
        resetInactivityTimer();
      } else if (pulseElement) {
        hideCoachPulse();
        setTimeout(() => { if (pulseElement) pulseElement.remove(); pulseElement = null; }, 2000);
      }

      document.addEventListener('scroll', handleUserActivity, { capture: true, passive: true });
      document.addEventListener('mousemove', handleUserActivity, { passive: true });
      document.addEventListener('keydown', handleUserActivity, { passive: true });
      document.addEventListener('click', handleUserActivity, { passive: true });
    } else {
      RtlFixer.removeCoach();
    }
  };

  RtlFixer.removeCoach = function() {
    coachActive = false;
    cachedMainContainer = null;
    
    if (progressContainer) {
      progressContainer.style.opacity = '0';
      setTimeout(() => { if (progressContainer && progressContainer.parentNode) progressContainer.remove(); progressContainer = null; progressElement = null; }, 300);
    }
    
    if (pulseElement) {
      hideCoachPulse();
      setTimeout(() => { if (pulseElement && pulseElement.parentNode) pulseElement.remove(); pulseElement = null; }, 2000);
    }
    
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    if (scrollRafId) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }

    document.removeEventListener('scroll', handleUserActivity, { capture: true });
    document.removeEventListener('mousemove', handleUserActivity);
    document.removeEventListener('keydown', handleUserActivity);
    document.removeEventListener('click', handleUserActivity);
  };

})(window.RtlFixer);
