/**
 * DOSTI CONNECT / JODIVERSE · INTERACTIVE LANDING PAGE SCRIPT
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initFaqAccordion();
  initSmoothScroll();
});

// Mobile Navbar Toggle
function initNavbar() {
  const toggleBtn = document.getElementById('mobileToggle');
  const navMenu = document.getElementById('navMenu');

  if (toggleBtn && navMenu) {
    toggleBtn.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });

    // Close menu when clicking a link
    navMenu.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
      });
    });
  }

  // Scroll effect on navbar
  window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (navbar) {
      if (window.scrollY > 40) {
        navbar.style.background = 'rgba(11, 13, 20, 0.95)';
        navbar.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.5)';
      } else {
        navbar.style.background = 'rgba(18, 21, 30, 0.72)';
        navbar.style.boxShadow = 'none';
      }
    }
  });
}

// App Preview Tab Switcher
function switchPreview(tabKey) {
  // Update Tab buttons
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => tab.classList.remove('active'));

  const activeTab = Array.from(tabs).find(b => b.getAttribute('onclick')?.includes(tabKey));
  if (activeTab) activeTab.classList.add('active');

  // Update Information description columns
  const allInfos = ['deck', 'profile', 'likes', 'requests'];
  allInfos.forEach(k => {
    const el = document.getElementById(`info-${k}`);
    if (el) {
      if (k === tabKey) {
        el.style.display = 'block';
        el.classList.add('active');
      } else {
        el.style.display = 'none';
        el.classList.remove('active');
      }
    }

    // Update screen mockup view
    const viewEl = document.getElementById(`view-${k}`);
    if (viewEl) {
      if (k === tabKey) {
        viewEl.style.display = 'flex';
        viewEl.classList.add('active');
      } else {
        viewEl.style.display = 'none';
        viewEl.classList.remove('active');
      }
    }
  });
}

// Interactive Vibe Check Quiz
let quizAnswers = {};

function selectQuiz(step, answer) {
  quizAnswers[`step${step}`] = answer;

  if (step === 1) {
    document.getElementById('qStep1').style.display = 'none';
    document.getElementById('qStep2').style.display = 'block';
  } else if (step === 2) {
    document.getElementById('qStep2').style.display = 'none';
    document.getElementById('qStep3').style.display = 'block';
  } else if (step === 3) {
    document.getElementById('qStep3').style.display = 'none';
    const resultEl = document.getElementById('quizResult');
    if (resultEl) {
      resultEl.style.display = 'block';
    }
  }
}

// FAQ Accordion
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');

      // Close all items
      faqItems.forEach(i => i.classList.remove('active'));

      // Toggle current
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });

  // Open first item by default
  if (faqItems.length > 0) {
    faqItems[0].classList.add('active');
  }
}

// QR Code Modal
function openQrModal(platform = 'all') {
  const modal = document.getElementById('qrModal');
  if (modal) {
    modal.classList.add('active');
  }
}

function closeQrModal() {
  const modal = document.getElementById('qrModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

// Close modal when clicking backdrop
window.addEventListener('click', (e) => {
  const modal = document.getElementById('qrModal');
  if (e.target === modal) {
    closeQrModal();
  }
});

// Smooth Scroll for anchor links
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
          e.preventDefault();
          targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      }
    });
  });
}
