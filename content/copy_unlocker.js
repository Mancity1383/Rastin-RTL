// RTL Beautifier & Fixer - Right-Click & Copy Unlocker
window.RtlFixer = window.RtlFixer || {};

(function (RtlFixer) {
  let stylesElement = null;

  function enableCopyAndRightClick() {
    const eventsToBypass = ['contextmenu', 'copy', 'selectstart'];
    eventsToBypass.forEach(eventName => {
      document.addEventListener(eventName, preventBypasses, { capture: true, passive: false });
      window.addEventListener(eventName, preventBypasses, { capture: true, passive: false });
    });

    if (!stylesElement) {
      stylesElement = document.createElement('style');
      stylesElement.id = 'rtl-fixer-copy-unlocker-styles';
      stylesElement.textContent = `
        body *:not(input):not(textarea):not(button):not(select):not(option):not([contenteditable]):not([role="textbox"]):not([role="slider"]):not(canvas):not(video):not(svg) {
          -webkit-user-select: text !important;
          -moz-user-select: text !important;
          -ms-user-select: text !important;
          user-select: text !important;
        }
      `;
      if (document.documentElement) {
        document.documentElement.appendChild(stylesElement);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (document.documentElement && stylesElement && !stylesElement.parentNode) {
            document.documentElement.appendChild(stylesElement);
          }
        });
      }
    }
  }

  function preventBypasses(e) {
    if (!e || !e.target || RtlFixer.isExtensionNode?.(e.target)) return;
    const target = e.target;
    const tag = target.tagName ? target.tagName.toUpperCase() : '';
    if (target.closest?.('input,textarea,button,select,option,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]')) return;

    // Do NOT intercept on interactive elements, text inputs, or rich editors
    if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'OPTION', 'CANVAS', 'VIDEO', 'SVG'].includes(tag) ||
        target.isContentEditable || (target.getAttribute && target.getAttribute('role') === 'textbox')) {
      return;
    }

    e.stopPropagation();
  }

  function disableCopyAndRightClick() {
    const eventsToBypass = ['contextmenu', 'copy', 'selectstart'];
    eventsToBypass.forEach(eventName => {
      document.removeEventListener(eventName, preventBypasses, { capture: true });
      window.removeEventListener(eventName, preventBypasses, { capture: true });
    });

    if (stylesElement) {
      stylesElement.remove();
      stylesElement = null;
    }
  }

  RtlFixer.disableCopyUnlocker = disableCopyAndRightClick;

  RtlFixer.initCopyUnlocker = function () {
    const config = RtlFixer.config || RtlFixer.DEFAULT_CONFIG;
    const isDomainEnabled = config.globalEnabled && config.enabled;

    if (isDomainEnabled && config.allowCopyEnabled) {
      enableCopyAndRightClick();
    } else {
      disableCopyAndRightClick();
    }
  };

  RtlFixer.initCopyUnlocker();

})(window.RtlFixer);
