/**
 * VoiceBridge — Main JavaScript
 * Handles UDL accessibility controls, themes, typography, mobile navigation, and FAQ accordion.
 */

document.addEventListener('DOMContentLoaded', () => {
  initThemeAndFont();
  initA11yControls();
  initMobileNav();
  initFaqAccordion();
});

/**
 * Initialize saved theme & font preferences from localStorage
 */
function initThemeAndFont() {
  const savedTheme = localStorage.getItem('vb_theme') || 'light';
  const savedFont = localStorage.getItem('vb_font') || 'lexend';
  const savedScale = parseFloat(localStorage.getItem('vb_font_scale')) || 1.0;

  applyTheme(savedTheme);
  applyFont(savedFont);
  applyFontScale(savedScale);
}

/**
 * Apply selected theme to document
 */
function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('vb_theme', theme);

  // Update active state in UI
  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-set-theme') === theme);
  });
}

/**
 * Apply selected font to document
 */
function applyFont(font) {
  document.documentElement.setAttribute('data-font', font);
  localStorage.setItem('vb_font', font);

  // Update active state in UI
  document.querySelectorAll('[data-set-font]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-set-font') === font);
  });
}

/**
 * Apply font scaling factor
 */
function applyFontScale(scale) {
  scale = Math.max(0.85, Math.min(1.35, scale));
  document.documentElement.style.setProperty('--font-size-scale', scale);
  localStorage.setItem('vb_font_scale', scale);
}

/**
 * Setup event listeners for UDL Accessibility Bar
 */
function initA11yControls() {
  // Theme Switchers
  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-set-theme');
      applyTheme(theme);
    });
  });

  // Font Switchers
  document.querySelectorAll('[data-set-font]').forEach(btn => {
    btn.addEventListener('click', () => {
      const font = btn.getAttribute('data-set-font');
      applyFont(font);
    });
  });

  // Font Size Adjusters
  const decBtn = document.getElementById('decreaseFontSize');
  const incBtn = document.getElementById('increaseFontSize');
  const resetBtn = document.getElementById('resetFontSize');

  if (decBtn) {
    decBtn.addEventListener('click', () => {
      const current = parseFloat(localStorage.getItem('vb_font_scale')) || 1.0;
      applyFontScale(current - 0.1);
    });
  }

  if (incBtn) {
    incBtn.addEventListener('click', () => {
      const current = parseFloat(localStorage.getItem('vb_font_scale')) || 1.0;
      applyFontScale(current + 0.1);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      applyFontScale(1.0);
    });
  }
}

/**
 * Setup mobile navigation toggle
 */
function initMobileNav() {
  const toggleBtn = document.querySelector('.mobile-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = navLinks.style.display === 'flex';
      navLinks.style.display = isOpen ? 'none' : 'flex';
      if (!isOpen) {
        navLinks.style.flexDirection = 'column';
        navLinks.style.position = 'absolute';
        navLinks.style.top = '76px';
        navLinks.style.left = '0';
        navLinks.style.right = '0';
        navLinks.style.background = 'var(--bg-surface-elevated)';
        navLinks.style.padding = '20px';
        navLinks.style.borderBottom = '1px solid var(--border-subtle)';
      }
    });
  }
}

/**
 * Setup FAQ Accordion interaction
 */
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    if (question) {
      question.addEventListener('click', () => {
        const isActive = item.classList.contains('active');
        faqItems.forEach(other => other.classList.remove('active'));
        if (!isActive) {
          item.classList.add('active');
        }
      });
    }
  });
}
