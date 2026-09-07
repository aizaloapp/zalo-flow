/**
 * Zalo-Flow Community Portal — Blog Enhancements Suite
 * - Sticky Table of Contents Generator (Desktop & Mobile)
 * - Anti-Flicker Scrollspy with IntersectionObserver
 * - High-Performance 60FPS Reading Progress Bar
 * - Clean URL Copy-to-Clipboard Utility
 */

document.addEventListener('DOMContentLoaded', () => {
  initReadingProgressBar();
  initTableOfContents();
});

/* 1. High-Performance Reading Progress Bar */
function initReadingProgressBar() {
  const progressBar = document.getElementById('readingProgress');
  if (!progressBar) return;

  let ticking = false;

  function updateProgress() {
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (totalHeight <= 0) {
      progressBar.style.width = '0%';
      ticking = false;
      return;
    }
    const currentScroll = window.scrollY || document.documentElement.scrollTop;
    const progress = Math.min(100, Math.max(0, (currentScroll / totalHeight) * 100));
    progressBar.style.width = `${progress}%`;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateProgress);
      ticking = true;
    }
  }, { passive: true });
}

/* 2. Table of Contents & Anti-Flicker Scrollspy */
function initTableOfContents() {
  const desktopTocList = document.getElementById('desktopTocList');
  const mobileTocList = document.getElementById('mobileTocList');
  const mobileTocBox = document.getElementById('mobileTocBox');
  const sidebar = document.querySelector('.article-toc-sidebar');
  const headings = Array.from(document.querySelectorAll('.article-body h2, .article-body h3'));

  if (headings.length === 0) {
    if (sidebar) sidebar.style.display = 'none';
    if (mobileTocBox) mobileTocBox.style.display = 'none';
    return;
  }

  // Fragment to build TOC items
  const desktopFrag = document.createDocumentFragment();
  const mobileFrag = mobileTocList ? document.createDocumentFragment() : null;

  const usedIds = new Set();

  headings.forEach((heading, idx) => {
    // Ensure clean text without trailing badges or symbols
    const cleanText = heading.textContent.trim();

    // Ensure valid non-duplicate ID
    let id = heading.id;
    if (!id) {
      id = slugifyText(cleanText) || `heading-${idx + 1}`;
      while (usedIds.has(id)) {
        id = `${id}-${idx + 1}`;
      }
      heading.id = id;
    }
    usedIds.add(id);

    const isH3 = heading.tagName.toLowerCase() === 'h3';

    // Desktop Item
    if (desktopTocList) {
      const a = document.createElement('a');
      a.href = `#${id}`;
      a.className = `toc-link ${isH3 ? 'depth-3' : ''}`.trim();
      a.textContent = cleanText;
      a.setAttribute('data-target', id);
      desktopFrag.appendChild(a);
    }

    // Mobile Item
    if (mobileFrag) {
      const a = document.createElement('a');
      a.href = `#${id}`;
      a.className = `toc-link ${isH3 ? 'depth-3' : ''}`.trim();
      a.textContent = cleanText;
      a.setAttribute('data-target', id);
      a.addEventListener('click', () => {
        if (mobileTocBox && mobileTocBox.hasAttribute('open')) {
          mobileTocBox.removeAttribute('open');
        }
      });
      mobileFrag.appendChild(a);
    }
  });

  if (desktopTocList) desktopTocList.appendChild(desktopFrag);
  if (mobileTocList) mobileTocList.appendChild(mobileFrag);

  // Setup Scrollspy
  setupScrollspy(headings);
}

/* 3. Anti-Flicker Scrollspy via IntersectionObserver */
function setupScrollspy(headings) {
  const desktopLinks = Array.from(document.querySelectorAll('#desktopTocList .toc-link'));
  if (desktopLinks.length === 0) return;

  let isClickScrolling = false;
  let clickTimeout = null;

  desktopLinks.forEach(link => {
    link.addEventListener('click', () => {
      isClickScrolling = true;
      clearTimeout(clickTimeout);

      // Immediately highlight clicked link
      desktopLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      // Release lock after smooth scroll settles
      clickTimeout = setTimeout(() => {
        isClickScrolling = false;
      }, 800);
    });
  });

  const observerOptions = {
    rootMargin: '-90px 0px -65% 0px',
    threshold: 0
  };

  const observer = new IntersectionObserver(entries => {
    if (isClickScrolling) return;

    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        const matchingLink = desktopLinks.find(l => l.getAttribute('data-target') === id);
        if (matchingLink) {
          desktopLinks.forEach(l => l.classList.remove('active'));
          matchingLink.classList.add('active');
        }
      }
    });
  }, observerOptions);

  headings.forEach(heading => observer.observe(heading));

  // Default active first item
  if (desktopLinks[0]) {
    desktopLinks[0].classList.add('active');
  }
}

/* 4. Copy Clean Article URL Utility */
window.copyArticleUrl = function() {
  const cleanUrl = window.location.origin + window.location.pathname;
  const copyBtn = document.getElementById('btnCopyUrl');

  navigator.clipboard.writeText(cleanUrl).then(() => {
    if (copyBtn) {
      const originalText = copyBtn.innerHTML;
      copyBtn.innerHTML = '✅ Đã chép link!';
      copyBtn.style.color = 'var(--cyan)';
      setTimeout(() => {
        copyBtn.innerHTML = originalText;
        copyBtn.style.color = '';
      }, 2000);
    } else {
      alert('Đã sao chép liên kết bài viết!');
    }
  }).catch(() => {
    prompt('Sao chép liên kết bài viết bên dưới:', cleanUrl);
  });
};

/* Helper: Slugify Vietnamese text cleanly */
function slugifyText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
