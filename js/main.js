/* ================================================================
   HATCH KITCHEN — main.js
   Mobile nav · Accordion · Scroll reveals · Active nav tabs
   ================================================================ */

(function () {
  'use strict';

  /* ---------- Helpers ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ---------- Auto-update copyright year ---------- */
  $$('[data-year]').forEach(el => (el.textContent = new Date().getFullYear()));

  /* ---------- Mobile Navigation ---------- */
  const navToggle = $('.nav-toggle');
  const navLinks  = $('.nav-links');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!isOpen));
      navLinks.setAttribute('data-open', String(!isOpen));
      document.body.style.overflow = isOpen ? '' : 'hidden';
    });

    // Close nav when a link is clicked
    $$('a', navLinks).forEach(link => {
      link.addEventListener('click', () => {
        navToggle.setAttribute('aria-expanded', 'false');
        navLinks.setAttribute('data-open', 'false');
        document.body.style.overflow = '';
      });
    });

    // Close nav on Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && navLinks.getAttribute('data-open') === 'true') {
        navToggle.setAttribute('aria-expanded', 'false');
        navLinks.setAttribute('data-open', 'false');
        document.body.style.overflow = '';
        navToggle.focus();
      }
    });

    // Close nav on outside click
    document.addEventListener('click', e => {
      if (
        navLinks.getAttribute('data-open') === 'true' &&
        !navLinks.contains(e.target) &&
        !navToggle.contains(e.target)
      ) {
        navToggle.setAttribute('aria-expanded', 'false');
        navLinks.setAttribute('data-open', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  /* ---------- Sticky Header Scroll Shadow ---------- */
  const header = $('.site-header');
  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 10);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Accordion (FAQ) ---------- */
  $$('.accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
      const panelId    = trigger.getAttribute('aria-controls');
      const panel      = panelId ? document.getElementById(panelId) : null;

      // Close all other open panels
      $$('.accordion-trigger[aria-expanded="true"]').forEach(open => {
        if (open !== trigger) {
          open.setAttribute('aria-expanded', 'false');
          const otherId = open.getAttribute('aria-controls');
          const other   = otherId ? document.getElementById(otherId) : null;
          if (other) other.style.maxHeight = '0';
        }
      });

      // Toggle current
      trigger.setAttribute('aria-expanded', String(!isExpanded));
      if (panel) {
        panel.style.maxHeight = isExpanded ? '0' : panel.scrollHeight + 'px';
      }
    });
  });

  // Open the first accordion by default if it has aria-expanded="true"
  $$('.accordion-trigger[aria-expanded="true"]').forEach(trigger => {
    const panelId = trigger.getAttribute('aria-controls');
    const panel   = panelId ? document.getElementById(panelId) : null;
    if (panel && panel.style.maxHeight === '' && panel.style.maxHeight !== '0') {
      panel.style.maxHeight = panel.scrollHeight + 'px';
    }
  });

  /* ---------- Menu Tabs (active on scroll) ---------- */
  const menuTabs     = $$('.menu-tab');
  const menuSections = $$('.menu-category[id]');

  if (menuTabs.length && menuSections.length) {
    // Tab click → smooth scroll
    menuTabs.forEach(tab => {
      tab.addEventListener('click', e => {
        e.preventDefault();
        const targetId = tab.getAttribute('href')?.slice(1);
        const target   = targetId ? document.getElementById(targetId) : null;
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setActiveTab(tab);
      });
    });

    // Scroll → update active tab
    const setActiveTab = (activeTab) => {
      menuTabs.forEach(t => t.setAttribute('aria-current', 'false'));
      activeTab.setAttribute('aria-current', 'true');
    };

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id        = entry.target.id;
            const matchTab  = menuTabs.find(t => t.getAttribute('href') === `#${id}`);
            if (matchTab) setActiveTab(matchTab);
          }
        });
      },
      { rootMargin: '-30% 0px -60% 0px' }
    );

    menuSections.forEach(s => observer.observe(s));
  }

  /* ---------- Scroll Reveal Animations ---------- */
  const revealEls = $$('[data-reveal], .value-card, .menu-card, .dish, .spotlight, .split');

  if ('IntersectionObserver' in window && revealEls.length) {
    // Add CSS for reveals
    const style = document.createElement('style');
    style.textContent = `
      [data-reveal],
      .value-card, .menu-card, .spotlight, .split {
        opacity: 0;
        transform: translateY(28px);
        transition: opacity 0.55s ease, transform 0.55s ease;
      }
      [data-reveal].revealed,
      .value-card.revealed, .menu-card.revealed,
      .spotlight.revealed, .split.revealed {
        opacity: 1;
        transform: translateY(0);
      }
      /* Dish items just fade */
      .dish {
        opacity: 0;
        transition: opacity 0.4s ease;
      }
      .dish.revealed {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // Stagger children if parent (value-cards inside grid etc.)
            const el = entry.target;
            el.classList.add('revealed');
            revealObserver.unobserve(el);
          }
        });
      },
      { rootMargin: '0px 0px -60px 0px', threshold: 0.1 }
    );

    revealEls.forEach((el, i) => {
      // Stagger siblings by adding a small delay
      const siblings = $$(':scope > *', el.parentElement);
      const idx      = siblings.indexOf(el);
      el.style.transitionDelay = `${idx * 0.06}s`;
      revealObserver.observe(el);
    });
  }

  /* ---------- Hero parallax (subtle) ---------- */
  const heroMedia = $('.hero-media');
  if (heroMedia) {
    const onParallax = () => {
      const scrolled = window.scrollY;
      heroMedia.style.transform = `translateY(${scrolled * 0.25}px)`;
    };
    window.addEventListener('scroll', onParallax, { passive: true });
  }

  /* ---------- Topbar hide on scroll ---------- */
  const topbar = $('.topbar');
  if (topbar) {
    let lastY = 0;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      topbar.style.transform = y > lastY && y > 80 ? 'translateY(-100%)' : 'translateY(0)';
      lastY = y;
    }, { passive: true });
    topbar.style.transition = 'transform 0.3s ease';
  }

  /* ---------- Today's hours highlight ---------- */
  const hoursRows = $$('.hours-table tr');
  if (hoursRows.length) {
    const day = new Date().getDay(); // 0=Sun, 1=Mon, 5=Fri, 6=Sat
    hoursRows.forEach(row => row.classList.remove('today'));

    if (day >= 0 && day <= 4) {
      // Sun–Thu → first row
      if (hoursRows[0]) hoursRows[0].classList.add('today');
    } else if (day === 5) {
      // Friday → second row
      if (hoursRows[1]) hoursRows[1].classList.add('today');
    } else {
      // Saturday → third row
      if (hoursRows[2]) hoursRows[2].classList.add('today');
    }
  }

  /* ---------- Smooth scroll for all anchor links ---------- */
  $$('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const targetId = anchor.getAttribute('href')?.slice(1);
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

})();
